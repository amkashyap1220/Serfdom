import { describe, expect, it } from "vitest";
import { type DungeonLayout } from "./dungeon-layout.ts";
import { buildStronghold } from "./goblin-stronghold.ts";
import { buildWarrens } from "./goblin-warrens.ts";
import { mainPath } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { Navigator, SizedNavigator } from "./pathing.ts";
import { buildCrypt } from "./forgotten-crypt.ts";
import {
  addPlayer,
  createSimState,
  spawnEnemies,
  stepWorld,
  type SimState,
} from "./sim.ts";

/**
 * Goblins in the corners of rooms along the path, the player waiting in
 * the boss room with every door open (a rushed run, D-114). Each must make
 * its way there: the bug was goblins pressing into room corners forever.
 */
function chase(
  layout: DungeonLayout,
  useGrid: boolean,
  seconds: number,
  kind: "grunt" | "knight" = "grunt",
) {
  const path = mainPath(layout);
  const boss = path.at(-1)!.bounds;
  const goal = { x: boss.x + boss.width / 2, y: boss.y + boss.height / 2 };
  let sim: SimState = addPlayer(
    createSimState([], { respawnSeconds: null }),
    1,
    goal,
    undefined,
  );
  // A far corner of each combat room, 30 px in from its walls.
  const starts = path.slice(1, -1).map((r) => ({
    x: r.bounds.x + 30,
    y: r.bounds.y + r.bounds.height - 30,
  }));
  sim = spawnEnemies(
    sim,
    starts.map((at) => ({ kind, at, roomId: null })),
  );
  // They must not hurt the player for this test: no regen race.
  sim = {
    ...sim,
    players: sim.players.map((p) => ({ ...p, hp: 1e9, maxHp: 1e9 })),
  };
  const nav = useGrid ? new SizedNavigator(layout.walls) : undefined;
  for (let t = 0; t < seconds / TICK_SECONDS; t++) {
    // Knights keep walking for this test: no slam to stop them.
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) =>
        e.ai.kind === "knight" ? { ...e, ai: { ...e.ai, slam: 99 } } : e,
      ),
    };
    sim = stepWorld(sim, layout.walls, TICK_SECONDS, nav).state;
  }
  return sim.enemies.map((e) =>
    Math.hypot(e.position.x - goal.x, e.position.y - goal.y),
  );
}

describe("goblins find their way (D-114)", () => {
  it("from every room's corner to a player in the boss room, through the doorways", () => {
    for (const [build, seeds] of [
      [buildWarrens, [1, 2, 3, 9]],
      [buildStronghold, [1, 4]],
    ] as const) {
      for (const seed of seeds) {
        const distances = chase(build(seed), true, 70);
        for (const d of distances) expect(d, `seed ${seed}`).toBeLessThan(40);
      }
    }
  });

  it("44 px grave knights find their way too, on the wider grid (D-127)", () => {
    for (const build of [buildWarrens, buildStronghold, buildCrypt]) {
      for (const seed of [1, 2, 3]) {
        for (const d of chase(build(seed), true, 200, "knight")) {
          expect(d, `seed ${seed}`).toBeLessThan(40);
        }
      }
    }
    // 200 s of play on nine maps: slow, so it gets more than the default 5 s.
  }, 30_000);

  it("without the grid, corner steering alone leaves some stuck (the reported bug)", () => {
    const stuck = [1, 2, 3, 9].some((seed) =>
      chase(buildWarrens(seed), false, 70).some((d) => d > 200),
    );
    expect(stuck).toBe(true);
  });

  it("goes straight when nothing is in the way, and returns null for an unreachable spot", () => {
    const box = [
      { x: 0, y: 0, width: 400, height: 16 },
      { x: 0, y: 384, width: 400, height: 16 },
      { x: 0, y: 0, width: 16, height: 400 },
      { x: 384, y: 0, width: 16, height: 400 },
      // A wall splitting the box in two.
      { x: 192, y: 0, width: 16, height: 400 },
    ];
    const nav = new Navigator(box);
    expect(nav.next({ x: 60, y: 200 }, { x: 150, y: 200 }, 7)).toEqual({
      x: 152,
      y: 200,
    });
    expect(nav.next({ x: 60, y: 200 }, { x: 300, y: 200 }, 7)).toBeNull();
  });
});
