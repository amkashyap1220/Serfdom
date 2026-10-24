import { describe, expect, it } from "vitest";
import { pieceHp } from "./dungeon-gen.ts";
import { dungeonInfo, entryProblem, layoutFor } from "./dungeons.ts";
import { enemyAct, type AiTarget } from "./enemy-ai.ts";
import { ARCHER, ENEMY_STATS, SKELETON } from "./enemy-config.ts";
import { damageEnemy, isAlive, isPile, newEnemy } from "./enemy.ts";
import { buildCrypt, CRYPT_PIECES, CRYPT_RECIPE } from "./forgotten-crypt.ts";
import { LOOT_POOLS, rollItem } from "./items.ts";
import { findLeak, mainPath, recipeProblems } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { POTION_CHANCE } from "./potions.ts";
import { clearExp } from "./progression.ts";
import {
  addPlayer,
  createSimState,
  spawnEnemies,
  stepWorld,
  type SimEvent,
} from "./sim.ts";
import { seededRandom } from "./seeded-random.ts";

const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);
const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number): AiTarget => ({
  id: 1,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});

describe("the Forgotten Crypt (D-120)", () => {
  it("is listed for levels 12–15 and opens once the Warrens is completed (D-107)", () => {
    expect(dungeonInfo("forgotten-crypt")).toMatchObject({
      name: "Forgotten Crypt",
      blurb: "Levels 12–15 · 6–8 min · opens after the Warrens",
      listed: true,
    });
    expect(entryProblem("forgotten-crypt", 0)).toBe(
      "Complete the Goblin Warrens first.",
    );
    expect(entryProblem("forgotten-crypt", 1)).toBeNull();
  });

  it("gives 200 EXP up to level 15, then 10% less per level", () => {
    expect(clearExp("forgotten-crypt", 12)).toBe(200);
    expect(clearExp("forgotten-crypt", 15)).toBe(200);
    expect(clearExp("forgotten-crypt", 16)).toBe(180);
  });

  it("drops T3–T5 (30/45/25) and potions at 30% per Luck point", () => {
    expect(LOOT_POOLS["forgotten-crypt"].tiers).toEqual([
      [3, 30],
      [4, 45],
      [5, 25],
    ]);
    const random = seededRandom(7);
    const tiers = new Set(
      Array.from(
        { length: 300 },
        () => rollItem("forgotten-crypt", random).tier,
      ),
    );
    expect([...tiers].sort()).toEqual([3, 4, 5]);
    expect(POTION_CHANCE["forgotten-crypt"]).toBe(0.3);
  });

  it("11 rooms of undead only, with 12j's ghosts, necromancers, and knights where planned (D-122)", () => {
    expect(CRYPT_PIECES.map((p) => p.band)).toEqual([
      ...Array(3).fill("light"),
      ...Array(4).fill("medium"),
      ...Array(4).fill("heavy"),
    ]);
    const kinds = new Set(
      CRYPT_PIECES.flatMap((p) => p.piece.waves.flat().map((s) => s.kind)),
    );
    expect([...kinds].sort()).toEqual([
      "archer",
      "ghost",
      "knight",
      "necromancer",
      "skeleton",
    ]);
    const count = (key: string, kind: string) =>
      CRYPT_PIECES.find((p) => p.piece.key === key)!
        .piece.waves.flat()
        .filter((s) => s.kind === kind).length;
    const planned: [string, number, number, number][] = [
      // room, ghosts, necromancers, knights
      ["stair", 0, 0, 0],
      ["gallery", 0, 0, 0],
      ["mourners", 0, 0, 0],
      ["catacomb", 2, 0, 0],
      ["chapel", 2, 0, 0],
      ["ossuary", 0, 1, 0],
      ["embalming", 0, 0, 1],
      ["vault", 0, 1, 0],
      ["charnel", 0, 2, 1],
      ["deadhall", 3, 0, 1],
      ["kings", 0, 1, 2],
    ];
    for (const [key, ghosts, necros, knights] of planned) {
      expect(
        [count(key, "ghost"), count(key, "necromancer"), count(key, "knight")],
        key,
      ).toEqual([ghosts, necros, knights]);
    }
    // Knights come at you: they take the skeletons nearest the entrance.
    const kings = CRYPT_PIECES.find((p) => p.piece.key === "kings")!.piece;
    const front = Math.min(
      ...kings.waves[0]!.filter((s) => s.kind !== "archer").map((s) => s.at.x),
    );
    expect(
      kings.waves[0]!.filter((s) => s.kind === "knight").map((s) => s.at.x),
    ).toEqual([front, front]);
  });

  it("every possible main path lands inside 40,000–48,000 with the Lich (D-120, D-125)", () => {
    const band = (b: string) =>
      CRYPT_PIECES.filter((p) => p.band === b).map((p) => pieceHp(p.piece));
    const choose = (xs: number[], k: number): number[][] =>
      k === 0
        ? [[]]
        : xs.flatMap((x, i) =>
            choose(xs.slice(i + 1), k - 1).map((rest) => [x, ...rest]),
          );
    const boss = pieceHp(CRYPT_RECIPE.boss);
    let paths = 0;
    for (const light of band("light"))
      for (const mediums of choose(band("medium"), 3))
        for (const heavies of choose(band("heavy"), 3)) {
          const total =
            light +
            mediums.reduce((a, b) => a + b, 0) +
            heavies.reduce((a, b) => a + b, 0) +
            boss;
          expect(total).toBeGreaterThanOrEqual(CRYPT_RECIPE.requiredHp.min);
          expect(total).toBeLessThanOrEqual(CRYPT_RECIPE.requiredHp.max);
          paths++;
        }
    expect(paths).toBe(3 * 4 * 4);
  });

  it("1,000 seeds follow the rules: gate, light, 3 medium, 3 heavy, sanctum", () => {
    for (const seed of SEEDS) {
      expect(
        recipeProblems(CRYPT_RECIPE, buildCrypt(seed)),
        `seed ${seed}`,
      ).toEqual([]);
    }
    const first = mainPath(buildCrypt(1));
    expect(first[0]?.name).toBe("Crypt gate");
    expect(first.at(-1)?.name).toBe("Sanctum");
    expect(
      first
        .at(-1)
        ?.waves.flat()
        .map((s) => s.kind),
    ).toEqual(["lich"]);
  });

  it("a seed always rebuilds the same map; seed 0 is seed 1's; no gaps in the walls", () => {
    expect(buildCrypt(77)).toEqual(buildCrypt(77));
    expect(layoutFor("forgotten-crypt", 0)).toEqual(buildCrypt(1));
    for (const seed of SEEDS.slice(0, 60)) {
      expect(findLeak(buildCrypt(seed)), `seed ${seed}`).toBeNull();
    }
  });
});

describe("skeletons and their bone piles (D-120)", () => {
  const skeleton = () => newEnemy(1, "skeleton", { x: 0, y: 0 }, null, null);

  it("the first death leaves a bone pile: alive, not defeated, 1 HP", () => {
    const hit = damageEnemy(skeleton(), 999);
    expect(hit.defeated).toBe(false);
    expect(isAlive(hit.enemy)).toBe(true);
    expect(isPile(hit.enemy)).toBe(true);
    expect(hit.enemy.hp).toBe(SKELETON.pileHp);
    // Any hit on the pile shatters it for good.
    const shattered = damageEnemy(hit.enemy, 1);
    expect(shattered.defeated).toBe(true);
    expect(isAlive(shattered.enemy)).toBe(false);
  });

  it("a pile lies still for 4 s, then stands up at half HP, once", () => {
    let e = damageEnemy(skeleton(), 999).enemy;
    const start = e.position;
    for (let t = 0; t < ticks(SKELETON.reviveSeconds) - 1; t++) {
      const a = enemyAct(e, [still(10, 0)], [], TICK_SECONDS);
      // Right beside a player: no move, no hit.
      expect(a.contacts).toEqual([]);
      expect(a.enemy.position).toEqual(start);
      e = a.enemy;
    }
    expect(isPile(e)).toBe(true);
    e = enemyAct(e, [still(10, 0)], [], TICK_SECONDS).enemy;
    expect(isPile(e)).toBe(false);
    expect(e.hp).toBe(SKELETON.maxHp * SKELETON.reviveShare);
    // The second death is final: no second pile.
    const again = damageEnemy(e, 999);
    expect(again.defeated).toBe(true);
    expect(isPile(again.enemy)).toBe(false);
  });

  it("a standing skeleton walks at you and hits for 8, once per 1.2 s (D-121)", () => {
    let e = { ...skeleton(), attackCooldown: 0 };
    const hits: number[] = [];
    for (let t = 0; t < ticks(2); t++) {
      const a = enemyAct(e, [still(10, 0)], [], TICK_SECONDS);
      e = a.enemy;
      hits.push(...a.contacts.map((c) => c.damage));
    }
    expect(hits).toEqual([8, 8]);
  });

  it("in the world: no kill until the pile is shattered, and shots hit piles", () => {
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 0,
      y: 0,
    });
    sim = spawnEnemies(sim, [
      { kind: "skeleton", at: { x: 200, y: 0 }, roomId: null },
    ]);
    const id = sim.enemies[0]!.id;
    sim = {
      ...sim,
      enemies: sim.enemies.map((e) => damageEnemy(e, 999).enemy),
    };
    // A player shot flying at the pile.
    sim = {
      ...sim,
      projectiles: [
        {
          id: 1,
          owner: "player",
          ownerId: 1,
          position: { x: 150, y: 0 },
          direction: { x: 1, y: 0 },
          speed: 600,
          remaining: 400,
          damage: 30,
          size: 6,
        },
      ],
    };
    const events: SimEvent[] = [];
    for (let t = 0; t < ticks(0.5); t++) {
      const r = stepWorld(sim, [], TICK_SECONDS);
      sim = r.state;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.type === "defeated")).toEqual([
      { type: "defeated", enemyId: id, playerId: 1 },
    ]);
    expect(sim.enemies.some((e) => e.id === id)).toBe(false);
  });
});

describe("skeleton archers (D-120)", () => {
  it("loose 2 arrows 8° apart, 7 damage each, every 2.6 s (D-121)", () => {
    let e = {
      ...newEnemy(1, "archer", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
    };
    const volleys: number[][] = [];
    for (let t = 0; t < ticks(5.3); t++) {
      const a = enemyAct(e, [still(250, 0)], [], TICK_SECONDS);
      e = a.enemy;
      if (a.bullets.length > 0) {
        volleys.push(a.bullets.map((b) => b.spec.damage));
        const [l, r] = a.bullets.map((b) =>
          Math.atan2(b.direction.y, b.direction.x),
        );
        expect(Math.abs(l! - r!)).toBeCloseTo(
          (ARCHER.spreadDegrees * Math.PI) / 180,
        );
      }
    }
    expect(volleys).toEqual([
      [7, 7],
      [7, 7],
      [7, 7],
    ]);
  });

  it("always aim where you are heading, and back off when you come close", () => {
    const e = {
      ...newEnemy(1, "archer", { x: 0, y: 0 }, null, null),
      attackCooldown: 0,
      leads: false,
    };
    const running: AiTarget = {
      id: 1,
      position: { x: 250, y: 0 },
      velocity: { x: 0, y: 150 },
    };
    const shot = enemyAct(e, [running], [], TICK_SECONDS);
    const mid = shot.bullets
      .map((b) => b.direction.y)
      .reduce((a, b) => a + b, 0);
    // Aimed below (ahead of) the runner, not straight at it.
    expect(mid).toBeGreaterThan(0.2);
    const near = enemyAct(e, [still(100, 0)], [], TICK_SECONDS).enemy;
    expect(near.position.x).toBeLessThan(0);
    expect(ENEMY_STATS.archer.maxHp).toBe(200);
  });
});
