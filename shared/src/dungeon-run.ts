import {
  contains,
  ROCKFALL,
  type DungeonLayout,
  type RoomDef,
} from "./dungeon-layout.ts";
import { isAlive } from "./enemy.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  isPlayerAlive,
  type EnemySpawn,
  type PlayerState,
  type SimState,
} from "./sim.ts";

/** Ambush holes (D-109): this many goblins come out together, this often. */
export const HOLES = { perBurst: 2, everySeconds: 4 } as const;

export type RoomStatus = "dormant" | "active" | "cleared";

export interface RoomProgress {
  status: RoomStatus;
  /** Index of the wave currently alive (meaningful while active). */
  wave: number;
  /** Seconds since the room woke (its traps run on this, D-109). */
  clock: number;
  /** Goblins of the current hole wave already out of the holes. */
  released: number;
  /** `clock` when the current wave started (hole bursts count from it). */
  waveStart: number;
  /** Boulders dropped so far (rockfall rooms, D-110). */
  dropped: number;
}

const DORMANT: RoomProgress = {
  status: "dormant",
  wave: 0,
  clock: 0,
  released: 0,
  waveStart: 0,
  dropped: 0,
};

/** One entry per room, in the layout's room order. */
export type RunProgress = readonly RoomProgress[];

export type RoomEvent =
  | { type: "roomWoke"; roomId: string }
  | { type: "waveSpawned"; roomId: string; wave: number }
  | { type: "roomCleared"; roomId: string };

export function newRunProgress(layout: DungeonLayout): RunProgress {
  return layout.rooms.map(() => DORMANT);
}

/**
 * Advances every room one step (Phase 6b), after the world tick. Pure: the
 * caller adds the returned spawns to the simulation.
 * - dormant → a living player's center is on its floor: spawn wave 0
 *   (active), or cleared at once if it has no waves.
 * - active → none of its enemies alive: spawn the next wave, or cleared.
 *   Enemies that wander out of the room still count for it.
 * - A hole wave (D-109) comes out of the room's holes HOLES.perBurst at a
 *   time, every HOLES.everySeconds, the first at once; the room stays
 *   active until all are out and dead.
 */
export function stepRooms(
  progress: RunProgress,
  sim: SimState,
  layout: DungeonLayout,
  dtSeconds = TICK_SECONDS,
): { progress: RunProgress; spawns: EnemySpawn[]; events: RoomEvent[] } {
  const spawns: EnemySpawn[] = [];
  const events: RoomEvent[] = [];
  const living = sim.players.filter(isPlayerAlive);
  const next = layout.rooms.map((room, i): RoomProgress => {
    const current = progress[i] ?? DORMANT;
    const spawn = (s: {
      kind: EnemySpawn["kind"];
      at: Vec2;
      leads?: boolean;
    }) =>
      spawns.push({
        kind: s.kind,
        at: s.at,
        roomId: room.id,
        ...(s.leads ? { leads: true } : {}),
      });
    // A wave appears at once, or (a hole wave) starts coming out of the holes.
    const startWave = (wave: number, clock: number): RoomProgress => {
      events.push({ type: "waveSpawned", roomId: room.id, wave });
      if (wave !== room.holeWave) {
        for (const s of room.waves[wave] ?? []) spawn(s);
        return {
          ...current,
          status: "active",
          wave,
          clock,
          released: 0,
          waveStart: clock,
        };
      }
      return release({
        ...current,
        status: "active",
        wave,
        clock,
        released: 0,
        waveStart: clock,
      });
    };
    // Lets the next burst out of the holes when it is due.
    const release = (p: RoomProgress): RoomProgress => {
      if (p.wave !== room.holeWave) return p;
      const wave = room.waves[p.wave] ?? [];
      const bursts = p.released / HOLES.perBurst;
      const due = p.waveStart + bursts * HOLES.everySeconds;
      // A hair of slack: summed ticks land just under each due time.
      if (p.released >= wave.length || p.clock + 1e-9 < due) {
        return p;
      }
      const out = wave.slice(p.released, p.released + HOLES.perBurst);
      out.forEach((s, k) => spawn({ ...s, at: holeSpot(room, bursts, k) }));
      return { ...p, released: p.released + out.length };
    };

    if (current.status === "dormant") {
      if (!living.some((p) => contains(room.bounds, p.position))) {
        return current;
      }
      events.push({ type: "roomWoke", roomId: room.id });
      if (room.waves.length === 0) {
        events.push({ type: "roomCleared", roomId: room.id });
        return { ...DORMANT, status: "cleared" };
      }
      return startWave(0, 0);
    }

    if (current.status === "active") {
      const ticked = release({ ...current, clock: current.clock + dtSeconds });
      const alive = sim.enemies.some((e) => e.roomId === room.id && isAlive(e));
      const waiting =
        ticked.wave === room.holeWave &&
        ticked.released < (room.waves[ticked.wave]?.length ?? 0);
      if (alive || waiting) return ticked;
      if (ticked.wave + 1 < room.waves.length) {
        return startWave(ticked.wave + 1, ticked.clock);
      }
      events.push({ type: "roomCleared", roomId: room.id });
      return { ...ticked, status: "cleared" };
    }
    return current;
  });
  return { progress: next, spawns, events };
}

/**
 * Where goblin `k` of burst `burst` comes out: the holes take turns (in
 * a stride, so it is not simply round the room), and a burst's goblins
 * stand side by side along the wall.
 */
export function holeSpot(room: RoomDef, burst: number, k: number): Vec2 {
  const holes = room.holes ?? [];
  if (holes.length === 0) return { ...room.bounds };
  const hole = holes[(burst * 3) % holes.length]!;
  const b = room.bounds;
  const toSide = Math.min(hole.x - b.x, b.x + b.width - hole.x);
  const toEnd = Math.min(hole.y - b.y, b.y + b.height - hole.y);
  const along = (k - (HOLES.perBurst - 1) / 2) * 28;
  // In the side walls the goblins line up vertically, otherwise across.
  return toSide < toEnd
    ? { x: hole.x, y: hole.y + along }
    : { x: hole.x + along, y: hole.y };
}

/** A boulder to drop: where it lands and how hard it hits. */
export interface BoulderDrop {
  at: Vec2;
  damage: number;
}

/**
 * Boulders for every fighting rockfall room (D-110): one each
 * ROCKFALL.everySeconds of the room's clock, the first at once. Most land
 * anywhere on its floor, ROCKFALL.nearShare within ROCKFALL.nearRadius of a
 * living player in the room. Always inside the floor, a boulder's radius
 * from the walls. `random` is the run's own stream (the server's choice).
 */
export function rockfallDrops(
  progress: RunProgress,
  layout: DungeonLayout,
  players: readonly PlayerState[],
  random: () => number,
): { progress: RunProgress; drops: BoulderDrop[] } {
  const drops: BoulderDrop[] = [];
  const next = layout.rooms.map((room, i): RoomProgress => {
    const p = progress[i] ?? DORMANT;
    if (!room.rockfall || p.status !== "active") return p;
    const due = Math.floor(p.clock / ROCKFALL.everySeconds + 1e-9) + 1;
    if (p.dropped >= due) return p;
    const b = room.bounds;
    const m = ROCKFALL.radius;
    const clamp = (v: Vec2): Vec2 => ({
      x: Math.min(b.x + b.width - m, Math.max(b.x + m, v.x)),
      y: Math.min(b.y + b.height - m, Math.max(b.y + m, v.y)),
    });
    const inRoom = players.filter(
      (pl) => isPlayerAlive(pl) && contains(b, pl.position),
    );
    for (let n = p.dropped; n < due; n++) {
      let at: Vec2;
      if (inRoom.length > 0 && random() < ROCKFALL.nearShare) {
        const target = inRoom[Math.floor(random() * inRoom.length)]!;
        const angle = random() * 2 * Math.PI;
        const r = random() * ROCKFALL.nearRadius;
        at = clamp({
          x: target.position.x + Math.cos(angle) * r,
          y: target.position.y + Math.sin(angle) * r,
        });
      } else {
        at = clamp({
          x: b.x + random() * b.width,
          y: b.y + random() * b.height,
        });
      }
      drops.push({ at, damage: room.rockfall.damage });
    }
    return { ...p, dropped: due };
  });
  return { progress: next, drops };
}

function isCleared(
  progress: RunProgress,
  layout: DungeonLayout,
  roomId: string,
): boolean {
  const i = layout.rooms.findIndex((r) => r.id === roomId);
  return progress[i]?.status === "cleared";
}

/** Ids of doors still closed (their room is not cleared). */
export function closedDoorIds(
  progress: RunProgress,
  layout: DungeonLayout,
): string[] {
  return layout.doors
    .filter((d) => !isCleared(progress, layout, d.room))
    .map((d) => d.id);
}

/** Everything that blocks movement right now: static walls plus closed doors. */
export function blockingWalls(
  layout: DungeonLayout,
  closedDoors: readonly string[],
): Rect[] {
  const closed = new Set(closedDoors);
  return [
    ...layout.walls,
    ...layout.doors.filter((d) => closed.has(d.id)).map((d) => d.rect),
  ];
}

/** Every required room is cleared: the exit portal opens (D-057), or, without a portal, the run is complete. */
export function requiredRoomsCleared(
  progress: RunProgress,
  layout: DungeonLayout,
): boolean {
  return layout.rooms.every(
    (r, i) => !r.required || progress[i]?.status === "cleared",
  );
}
