import { boxAround } from "./collision.ts";
import {
  contains,
  ARROWS,
  ROCKFALL,
  type DungeonLayout,
  type RoomDef,
  BRAZIERS,
  RUNES,
  type RuneSpot,
} from "./dungeon-layout.ts";
import { isAlive } from "./enemy.ts";
import type { Rect, Vec2 } from "./geometry.ts";
import { PLAYER_BODY, TICK_SECONDS } from "./movement-config.ts";
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
  /** Arrow volleys fired so far, and the gap (first slit) of the next (D-113); -1 until chosen. */
  volleys: number;
  gap: number;
  /** Rune columns burst so far (D-123). */
  runeSteps: number;
}

const DORMANT: RoomProgress = {
  status: "dormant",
  wave: 0,
  clock: 0,
  released: 0,
  waveStart: 0,
  dropped: 0,
  volleys: 0,
  gap: -1,
  runeSteps: 0,
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

/** An arrow to fire: from a slit, across the room. */
export interface ArrowShot {
  at: Vec2;
  direction: Vec2;
  damage: number;
  /** A spirit brazier's fireball (D-123). */
  fire?: boolean;
}

/** An arrow trap's or a brazier row's timing (D-113, D-123). */
const timingOf = (trap: { fire?: boolean }) => (trap.fire ? BRAZIERS : ARROWS);

/**
 * Arrow traps of fighting rooms (D-113): volley k fires at
 * ARROWS.warnSeconds + k × ARROWS.everySeconds of the room's clock, from
 * every slit but ARROWS.gap neighbours starting at the chosen gap. Each
 * gap is chosen (from `random`, the run's stream) before its slits glow,
 * so players see it coming.
 */
export function arrowVolleys(
  progress: RunProgress,
  layout: DungeonLayout,
  random: () => number,
): { progress: RunProgress; shots: ArrowShot[] } {
  const shots: ArrowShot[] = [];
  const next = layout.rooms.map((room, i): RoomProgress => {
    let p = progress[i] ?? DORMANT;
    const trap = room.arrows;
    if (!trap || p.status !== "active") return p;
    const t = timingOf(trap);
    // Braziers (D-123) take turns: `gap` is which half fires (0 even, 1
    // odd), switching every time. Arrow traps leave a random gap.
    const pickGap = () =>
      trap.fire
        ? p.gap < 0
          ? 0
          : 1 - p.gap
        : Math.floor(random() * (trap.slits.length - ARROWS.gap + 1));
    if (p.gap < 0) p = { ...p, gap: pickGap() };
    const due = t.warnSeconds + p.volleys * t.everySeconds;
    if (p.clock + 1e-9 < due) return p;
    trap.slits.forEach((at, k) => {
      if (!firesThisVolley(trap, p.gap, k)) return;
      shots.push({
        at,
        direction: trap.direction,
        damage: trap.damage,
        ...(trap.fire ? { fire: true } : {}),
      });
    });
    return { ...p, volleys: p.volleys + 1, gap: pickGap() };
  });
  return { progress: next, shots };
}

/** Whether slit `k` fires in a volley whose gap is `gap` (D-113, D-123). */
export function firesThisVolley(
  trap: { fire?: boolean },
  gap: number,
  k: number,
): boolean {
  return trap.fire ? k % 2 === gap : k < gap || k >= gap + ARROWS.gap;
}

/** A trap about to fire: its room, the gap's first slit, and 0 → 1 through the glow. */
export interface TrapWarning {
  room: string;
  gap: number;
  warn: number;
}

/** Arrow traps glowing before their next volley (D-113), for drawing. */
export function trapWarnings(
  progress: RunProgress,
  layout: DungeonLayout,
): TrapWarning[] {
  const out: TrapWarning[] = [];
  layout.rooms.forEach((room, i) => {
    const p = progress[i];
    if (!room.arrows || p?.status !== "active" || p.gap < 0) return;
    const t = timingOf(room.arrows);
    const due = t.warnSeconds + p.volleys * t.everySeconds;
    const left = due - p.clock;
    if (left <= t.warnSeconds + 1e-9) {
      out.push({
        room: room.id,
        gap: p.gap,
        warn: Math.min(1, Math.max(0, 1 - left / t.warnSeconds)),
      });
    }
  });
  return out;
}

/** A rune burst to land: where, how wide, how hard (D-123). */
export interface RuneBurst {
  at: Vec2;
  radius: number;
  damage: number;
}

/** The column of sweep step `k` among `columns`: west to east and back. */
export function runeColumn(k: number, columns: number): number {
  if (columns <= 1) return 0;
  const period = 2 * columns - 2;
  const i = k % period;
  return i < columns ? i : period - i;
}

const columnsOf = (runes: readonly RuneSpot[]) =>
  runes.reduce((n, r) => Math.max(n, r.column + 1), 0);

/**
 * Cursed runes of fighting rooms (D-123): step k's column glows from
 * k × RUNES.everySeconds of the room's clock and bursts RUNES.warnSeconds
 * later on everyone within RUNES.radius of each of its runes.
 */
export function runeBursts(
  progress: RunProgress,
  layout: DungeonLayout,
): { progress: RunProgress; bursts: RuneBurst[] } {
  const bursts: RuneBurst[] = [];
  const next = layout.rooms.map((room, i): RoomProgress => {
    const p = progress[i] ?? DORMANT;
    const runes = room.runes;
    if (!runes || runes.length === 0 || p.status !== "active") return p;
    const due = RUNES.warnSeconds + p.runeSteps * RUNES.everySeconds;
    if (p.clock + 1e-9 < due) return p;
    const column = runeColumn(p.runeSteps, columnsOf(runes));
    for (const r of runes) {
      if (r.column === column) {
        bursts.push({ at: r.at, radius: RUNES.radius, damage: RUNES.damage });
      }
    }
    return { ...p, runeSteps: p.runeSteps + 1 };
  });
  return { progress: next, bursts };
}

/** A rune column glowing before it bursts: its room, which column, 0 → 1. */
export interface RuneWarning {
  room: string;
  column: number;
  warn: number;
}

/** Rune columns glowing right now (D-123), for drawing. */
export function runeWarnings(
  progress: RunProgress,
  layout: DungeonLayout,
): RuneWarning[] {
  const out: RuneWarning[] = [];
  layout.rooms.forEach((room, i) => {
    const p = progress[i];
    if (!room.runes || room.runes.length === 0 || p?.status !== "active") {
      return;
    }
    const start = p.runeSteps * RUNES.everySeconds;
    const into = p.clock - start;
    if (into < -1e-9 || into > RUNES.warnSeconds + 1e-9) return;
    out.push({
      room: room.id,
      column: runeColumn(p.runeSteps, columnsOf(room.runes)),
      warn: Math.min(1, Math.max(0, into / RUNES.warnSeconds)),
    });
  });
  return out;
}

/** For each door, the indexes of the two rooms it joins (cached per layout). */
const doorRooms = new WeakMap<DungeonLayout, number[][]>();

function roomsOfDoors(layout: DungeonLayout): number[][] {
  let rooms = doorRooms.get(layout);
  if (!rooms) {
    rooms = layout.doors.map((d) =>
      layout.rooms.flatMap((r, i) =>
        touchesRect(r.bounds, d.rect) ? [i] : [],
      ),
    );
    doorRooms.set(layout, rooms);
  }
  return rooms;
}

/**
 * Ids of doors closed right now (D-114). Doors are open, so players may
 * rush through rooms (dragging their goblins along), except round a gated
 * room while it fights: every door of it shuts behind you until it is
 * cleared. A door never shuts on a living player standing in it; it shuts
 * once they are clear.
 */
export function closedDoorIds(
  progress: RunProgress,
  layout: DungeonLayout,
  players: readonly PlayerState[] = [],
): string[] {
  const joined = roomsOfDoors(layout);
  return layout.doors
    .filter((d, k) => {
      const locked = (joined[k] ?? []).some(
        (i) => layout.rooms[i]?.gated && progress[i]?.status === "active",
      );
      if (!locked) return false;
      return !players.some(
        (p) =>
          isPlayerAlive(p) &&
          overlapsRect(d.rect, boxAround(p.position, PLAYER_BODY.width)),
      );
    })
    .map((d) => d.id);
}

const touchesRect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width &&
  b.x <= a.x + a.width &&
  a.y <= b.y + b.height &&
  b.y <= a.y + a.height;

const overlapsRect = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

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

/**
 * The run's goal is met: the exit portal opens (D-057) once the room
 * holding it, the boss's, is cleared; rooms rushed past do not count
 * (D-114). Without a portal (test fixtures), every required room.
 */
export function requiredRoomsCleared(
  progress: RunProgress,
  layout: DungeonLayout,
): boolean {
  const portal = layout.exitPortal;
  if (portal) {
    const i = layout.rooms.findIndex((r) => contains(r.bounds, portal));
    return progress[i]?.status === "cleared";
  }
  return layout.rooms.every(
    (r, i) => !r.required || progress[i]?.status === "cleared",
  );
}
