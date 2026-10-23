import type { Vec2 } from "./geometry.ts";

/**
 * The four modes T cycles through (D-099, replacing D-034's three; names
 * PROVISIONAL):
 * - fullAuto: aims at and fires on the closest enemy in range, and uses
 *   the ability by itself whenever an enemy is in its reach (never a
 *   movement ability); Space still works.
 * - autoAim: aims and fires on its own; the ability needs Space.
 * - autoFire: fires toward the mouse all the time; the ability needs Space.
 * - manual: fires while the left mouse button is held, toward the mouse;
 *   the ability needs Space.
 */
export type FireMode = "fullAuto" | "autoAim" | "autoFire" | "manual";

export const FIRE_MODES: readonly FireMode[] = [
  "fullAuto",
  "autoAim",
  "autoFire",
  "manual",
];

export const FIRE_MODE_LABELS: Readonly<Record<FireMode, string>> = {
  fullAuto: "Full auto",
  autoAim: "Auto aim + Space",
  autoFire: "Auto fire + Space",
  manual: "Manual",
};

/** The mode after `mode` in the toggle cycle. */
export function nextFireMode(mode: FireMode): FireMode {
  const i = FIRE_MODES.indexOf(mode);
  return FIRE_MODES[(i + 1) % FIRE_MODES.length] ?? "autoAim";
}

/** A possible auto-aim target: an id and its center. */
export interface AimTarget {
  id: number;
  position: Vec2;
}

/**
 * Closest target whose center is within `range` of `origin` (inclusive), or
 * null. Equal distances go to the lowest id, so the choice is deterministic.
 */
export function closestTargetInRange(
  origin: Vec2,
  targets: readonly AimTarget[],
  range: number,
): AimTarget | null {
  let best: AimTarget | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.position.x - origin.x, t.position.y - origin.y);
    if (d > range) continue;
    if (d < bestDist || (d === bestDist && best !== null && t.id < best.id)) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/** Unit vector from `from` toward `to`, or null if they coincide. */
export function aimDirection(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9) || !Number.isFinite(len)) return null;
  return { x: dx / len, y: dy / len };
}

export interface PointerState {
  /** Mouse position in world pixels, or null if the mouse has not been over the game yet. */
  world: Vec2 | null;
  /** Left button held. */
  down: boolean;
}

/** What the player wants this tick: fire or not, and in which direction. */
export interface FireIntent {
  trigger: boolean;
  /** Unit direction; null means "no valid aim", which never fires. */
  aim: Vec2 | null;
}

export const NO_FIRE: FireIntent = { trigger: false, aim: null };

/** Turns the current fire mode, mouse, and nearby enemies into a fire intent. */
export function resolveFireIntent(
  mode: FireMode,
  pointer: PointerState,
  playerPosition: Vec2,
  targets: readonly AimTarget[],
  range: number,
): FireIntent {
  if (mode === "autoAim" || mode === "fullAuto") {
    const target = closestTargetInRange(playerPosition, targets, range);
    if (!target) return NO_FIRE;
    const aim = aimDirection(playerPosition, target.position);
    return { trigger: aim !== null, aim };
  }
  const aim = pointer.world
    ? aimDirection(playerPosition, pointer.world)
    : null;
  const trigger = mode === "autoFire" ? true : pointer.down;
  return { trigger: trigger && aim !== null, aim };
}

/**
 * Advances a weapon cooldown by one step and decides whether it fires.
 * `remaining` is seconds until the next shot is allowed. While firing, the
 * leftover fraction carries over so the long-run rate is exact; while not
 * firing, it bottoms out at 0 so no "saved up" burst can happen later.
 */
export function stepFireCooldown(
  remaining: number,
  dtSeconds: number,
  trigger: boolean,
  shotsPerSecond: number,
): { fired: boolean; remaining: number } {
  if (!(shotsPerSecond > 0) || !Number.isFinite(shotsPerSecond)) {
    throw new RangeError(
      `shotsPerSecond must be finite and > 0, got ${shotsPerSecond}`,
    );
  }
  const interval = 1 / shotsPerSecond;
  // Already ready (e.g. first shot after idling): fire now, full interval.
  if (trigger && remaining <= 1e-9) {
    return { fired: true, remaining: interval };
  }
  // Became ready during this step: fire, carrying the overshoot.
  const r = remaining - dtSeconds;
  if (trigger && r <= 1e-9) {
    return { fired: true, remaining: r + interval };
  }
  return { fired: false, remaining: Math.max(r, 0) };
}
