import { contains, type DungeonLayout } from "./dungeon-layout.ts";
import { isAlive } from "./enemy.ts";
import type { Rect } from "./geometry.ts";
import { isPlayerAlive, type EnemySpawn, type SimState } from "./sim.ts";

export type RoomStatus = "dormant" | "active" | "cleared";

export interface RoomProgress {
  status: RoomStatus;
  /** Index of the wave currently alive (meaningful while active). */
  wave: number;
}

/** One entry per room, in the layout's room order. */
export type RunProgress = readonly RoomProgress[];

export type RoomEvent =
  | { type: "roomWoke"; roomId: string }
  | { type: "waveSpawned"; roomId: string; wave: number }
  | { type: "roomCleared"; roomId: string };

export function newRunProgress(layout: DungeonLayout): RunProgress {
  return layout.rooms.map(() => ({ status: "dormant", wave: 0 }));
}

/**
 * Advances every room one step (Phase 6b), after the world tick. Pure: the
 * caller adds the returned spawns to the simulation.
 * - dormant → a living player's center is on its floor: spawn wave 0
 *   (active), or cleared at once if it has no waves.
 * - active → none of its enemies alive: spawn the next wave, or cleared.
 *   Enemies that wander out of the room still count for it.
 */
export function stepRooms(
  progress: RunProgress,
  sim: SimState,
  layout: DungeonLayout,
): { progress: RunProgress; spawns: EnemySpawn[]; events: RoomEvent[] } {
  const spawns: EnemySpawn[] = [];
  const events: RoomEvent[] = [];
  const living = sim.players.filter(isPlayerAlive);
  const next = layout.rooms.map((room, i): RoomProgress => {
    const current = progress[i] ?? { status: "dormant", wave: 0 };
    const spawnWave = (wave: number) => {
      for (const s of room.waves[wave] ?? []) {
        spawns.push({ kind: s.kind, at: s.at, roomId: room.id });
      }
      events.push({ type: "waveSpawned", roomId: room.id, wave });
    };

    if (current.status === "dormant") {
      if (!living.some((p) => contains(room.bounds, p.position))) {
        return current;
      }
      events.push({ type: "roomWoke", roomId: room.id });
      if (room.waves.length === 0) {
        events.push({ type: "roomCleared", roomId: room.id });
        return { status: "cleared", wave: 0 };
      }
      spawnWave(0);
      return { status: "active", wave: 0 };
    }

    if (current.status === "active") {
      const alive = sim.enemies.some((e) => e.roomId === room.id && isAlive(e));
      if (alive) return current;
      if (current.wave + 1 < room.waves.length) {
        spawnWave(current.wave + 1);
        return { status: "active", wave: current.wave + 1 };
      }
      events.push({ type: "roomCleared", roomId: room.id });
      return { status: "cleared", wave: current.wave };
    }
    return current;
  });
  return { progress: next, spawns, events };
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
