import { describe, expect, it } from "vitest";
import { OBSTACLE_MARGIN } from "./dungeon-layout.ts";
import { enemyAct, lineBlocked, steerToward } from "./enemy-ai.ts";
import { BRUTE, SLINGER } from "./enemy-config.ts";
import { newEnemy } from "./enemy.ts";
import { buildStronghold } from "./goblin-stronghold.ts";
import { buildWarrens } from "./goblin-warrens.ts";
import { findLeak, findSealedFloor } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const target = (x: number, y: number) => ({ id: 1, position: { x, y } });

describe("obstacles in the rooms (D-112)", () => {
  it("rubble in the Collapsed passage and pillars in the Guard room; the Stronghold adds barricades, bunks, and the War hall's pillars", () => {
    const seen = (build: (s: number) => ReturnType<typeof buildWarrens>) => {
      const keys = new Set<string>();
      for (const seed of SEEDS) {
        for (const r of build(seed).rooms) {
          if (r.obstacles) keys.add(r.id.replace(/-\d+$/, ""));
        }
      }
      return [...keys].sort();
    };
    expect(seen(buildWarrens)).toEqual(["guard", "passage"]);
    expect(seen(buildStronghold)).toEqual([
      "barracks",
      "gatehouse",
      "guard",
      "passage",
      "throne",
    ]);
  });

  it("are solid (in the walls), keep 64 px from every wall, and never seal off floor", () => {
    for (const [build, name] of [
      [buildWarrens, "warrens"],
      [buildStronghold, "stronghold"],
    ] as const) {
      for (const seed of SEEDS) {
        const layout = build(seed);
        const where = `${name} seed ${seed}`;
        for (const room of layout.rooms) {
          for (const o of room.obstacles ?? []) {
            expect(layout.walls, where).toContainEqual(o);
            const b = room.bounds;
            expect(o.x - b.x, where).toBeGreaterThanOrEqual(OBSTACLE_MARGIN);
            expect(
              b.x + b.width - (o.x + o.width),
              where,
            ).toBeGreaterThanOrEqual(OBSTACLE_MARGIN);
          }
        }
        expect(findSealedFloor(layout), where).toBeNull();
        expect(findLeak(layout), where).toBeNull();
      }
    }
  });
});

describe("goblins and cover (D-112)", () => {
  const pillar = { x: 100, y: -24, width: 48, height: 48 };

  it("steering heads straight for a clear target, round the near corner of a blocking one", () => {
    expect(steerToward({ x: 0, y: 0 }, { x: 300, y: 200 }, 7, [])).toEqual({
      x: 300,
      y: 200,
    });
    const via = steerToward({ x: 0, y: 0 }, { x: 300, y: 10 }, 7, [pillar]);
    // A corner of the pillar, padded by the body and a little clearance.
    expect(via.x).toBe(100 - 13);
    expect(Math.abs(via.y)).toBe(24 + 13);
    expect(lineBlocked({ x: 0, y: 0 }, { x: 300, y: 0 }, 3, [pillar])).toBe(
      true,
    );
  });

  it("a slinger does not throw into cover: it steps sideways until its line is clear, then throws", () => {
    let s = {
      ...newEnemy(2, "slinger", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const player = target(220, 0);
    const wall = [pillar];
    let firstRock = -1;
    for (let t = 0; t < 60 * 4 && firstRock < 0; t++) {
      const a = enemyAct(s, [player], wall, TICK_SECONDS);
      if (a.bullets.length > 0) {
        firstRock = t;
        expect(
          lineBlocked(s.position, player.position, SLINGER.rock.size / 2, wall),
        ).toBe(false);
      }
      s = a.enemy;
    }
    expect(firstRock).toBeGreaterThan(0); // not at once: it had to move first
    expect(Math.abs(s.position.y)).toBeGreaterThan(20);
  });

  it("a brute that charges into a pillar is dazed", () => {
    let b = {
      ...newEnemy(3, "brute", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const modes: string[] = [];
    for (let t = 0; t < 60 * 3; t++) {
      b = enemyAct(
        b,
        [target(220, 0)],
        [{ x: 60, y: -40, width: 48, height: 80 }],
        TICK_SECONDS,
      ).enemy;
      if (b.ai.kind === "brute") modes.push(b.ai.mode);
    }
    expect(modes).toContain("dazed");
    expect(BRUTE.dazeSeconds).toBe(1.5);
  });
});
