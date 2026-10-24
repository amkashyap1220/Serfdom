import { describe, expect, it } from "vitest";
import type { DungeonLayout } from "./dungeon-layout.ts";
import { buildCrypt } from "./forgotten-crypt.ts";
import { buildStronghold } from "./goblin-stronghold.ts";
import { buildWarrens, GOBLIN_WARRENS } from "./goblin-warrens.ts";
import { PLAYER_BODY } from "./movement-config.ts";
import type { Rect } from "./geometry.ts";

// D-127 doubled the player body to 32×32. Walls, doors and obstacles were
// laid out for a 16 px body, so this walks every dungeon with the real body
// and checks it can still reach every room and the exit portal.

const STEP = 4;

/**
 * Which grid points (STEP apart) a player's center can reach from spawn with
 * every door open. A point is free when the body around it overlaps no wall,
 * so each wall is grown by half the body and rasterized once.
 */
function reachable(layout: DungeonLayout) {
  const cols = Math.ceil(layout.world.width / STEP) + 1;
  const rows = Math.ceil(layout.world.height / STEP) + 1;
  const blocked = new Uint8Array(cols * rows);
  const half = PLAYER_BODY.width / 2;
  for (const w of layout.walls) {
    // Body overlaps the wall when the center is strictly inside the grown rect.
    const c0 = Math.max(0, Math.floor((w.x - half) / STEP) + 1);
    const c1 = Math.min(cols - 1, Math.ceil((w.x + w.width + half) / STEP) - 1);
    const r0 = Math.max(0, Math.floor((w.y - half) / STEP) + 1);
    const r1 = Math.min(
      rows - 1,
      Math.ceil((w.y + w.height + half) / STEP) - 1,
    );
    for (let r = r0; r <= r1; r++)
      blocked.fill(1, r * cols + c0, r * cols + c1 + 1);
  }
  const seen = new Uint8Array(cols * rows);
  const start =
    Math.round(layout.spawn.y / STEP) * cols +
    Math.round(layout.spawn.x / STEP);
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const i = queue.pop()!;
    const c = i % cols;
    for (const j of [
      c + 1 < cols ? i + 1 : -1,
      c > 0 ? i - 1 : -1,
      i + cols < cols * rows ? i + cols : -1,
      i - cols,
    ]) {
      if (j >= 0 && !seen[j] && !blocked[j]) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  /** Whether any reached point lies inside `r`. */
  return (r: Rect) => {
    for (let y = Math.ceil(r.y / STEP); y * STEP <= r.y + r.height; y++) {
      for (let x = Math.ceil(r.x / STEP); x * STEP <= r.x + r.width; x++) {
        if (seen[y * cols + x]) return true;
      }
    }
    return false;
  };
}

/** Rooms with no reachable point inside, plus "portal" if the portal can't be reached. */
function unreachable(layout: DungeonLayout): string[] {
  const reaches = reachable(layout);
  const missing = layout.rooms
    .filter((r) => !reaches(r.bounds))
    .map((r) => r.id);
  const p = layout.exitPortal;
  if (p && !reaches({ x: p.x - 24, y: p.y - 24, width: 48, height: 48 })) {
    missing.push("portal");
  }
  return missing;
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

describe("a 32×32 player body fits everywhere (D-127)", () => {
  it("reaches every room and the portal of the fixed Warrens", () => {
    expect(unreachable(GOBLIN_WARRENS)).toEqual([]);
  });

  it.each([
    ["Warrens", buildWarrens],
    ["Stronghold", buildStronghold],
    ["Crypt", buildCrypt],
  ] as const)("reaches every room and the portal of the %s", (_, build) => {
    for (const seed of SEEDS) {
      expect(unreachable(build(seed)), `seed ${seed}`).toEqual([]);
    }
  });
});
