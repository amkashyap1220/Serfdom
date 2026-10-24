import { PLAYER_HEALTH } from "./combat-config.ts";
import { FORGEMASTER } from "./enemy-config.ts";
import { sweepIndex, type Rect, type Vec2 } from "./geometry.ts";

/*
 * The Forgemaster's shapes (D-134), shared by the simulation (what hits)
 * and the client (what is drawn), so the two never disagree.
 */

/** Plates across the floor: the floor's width split into whole plates. */
export function plateColumns(area: Rect): number {
  return Math.max(1, Math.floor(area.width / FORGEMASTER.plates.size));
}

/** Where the safe lane can stand: one position per plate it can start on. */
export function lanePositions(area: Rect): number {
  return Math.max(1, plateColumns(area) - FORGEMASTER.plates.laneWidth + 1);
}

/** Lane position for the `step`th burst: west to east and back (like the crypt's runes). */
export function laneAt(area: Rect, step: number): number {
  return sweepIndex(step, lanePositions(area));
}

/** The safe lane's floor, for lane position `lane`. */
export function safeLane(area: Rect, lane: number): Rect {
  const plate = area.width / plateColumns(area);
  return {
    x: area.x + lane * plate,
    y: area.y,
    width: FORGEMASTER.plates.laneWidth * plate,
    height: area.height,
  };
}

/** The burning floor around the safe lane: the strips west and east of it. */
export function burningStrips(area: Rect, lane: number): Rect[] {
  const safe = safeLane(area, lane);
  const end = area.x + area.width;
  return [
    { x: area.x, y: area.y, width: safe.x - area.x, height: area.height },
    {
      x: safe.x + safe.width,
      y: area.y,
      width: end - (safe.x + safe.width),
      height: area.height,
    },
  ].filter((r) => r.width > 1e-9);
}

/** Is `angle` (radians) inside a shockwave's gap centred on `gap`? */
export function inGap(gap: number, angle: number): boolean {
  const half = (FORGEMASTER.wave.gapDegrees / 2) * (Math.PI / 180);
  const diff = Math.atan2(Math.sin(angle - gap), Math.cos(angle - gap));
  return Math.abs(diff) <= half;
}

/**
 * Does a shockwave of `radius` from `at` touch a player at `player`? Any
 * overlap of its band with the hurtbox counts (D-127), unless the player's
 * centre is in the gap.
 */
export function waveHits(
  wave: { at: Vec2; radius: number; gap: number },
  player: Vec2,
): boolean {
  const dx = player.x - wave.at.x;
  const dy = player.y - wave.at.y;
  const reach = FORGEMASTER.wave.thickness / 2 + PLAYER_HEALTH.hurtboxSize / 2;
  if (Math.abs(Math.hypot(dx, dy) - wave.radius) > reach) return false;
  return !inGap(wave.gap, Math.atan2(dy, dx));
}

/**
 * The gap of the Forgemaster's `slams`th slam (radians): a new direction
 * each time, stepping by the golden angle so it never settles into a
 * pattern you can stand in.
 */
export function slamGap(enemyId: number, slams: number): number {
  const degrees = (enemyId * 61 + slams * 137.508) % 360;
  return (degrees * Math.PI) / 180;
}
