import { describe, expect, it } from "vitest";
import { VAULT_LAYOUT, VAULT_PIECES, VAULT_RECIPE } from "./clockwork-vault.ts";
import { pieceHp } from "./dungeon-gen.ts";
import { BLADES } from "./dungeon-layout.ts";
import { activeBlades, type RunProgress } from "./dungeon-run.ts";
import { dungeonInfo, entryProblem, layoutFor } from "./dungeons.ts";
import {
  enemyAct,
  shieldBlocks,
  type AiContext,
  type AiTarget,
  type EnemyAction,
} from "./enemy-ai.ts";
import { AUTOMATON, BOSS_KINDS, SENTRY, TURRET } from "./enemy-config.ts";
import { damageEnemy, isVenting, newEnemy, type EnemyState } from "./enemy.ts";
import { LOOT_POOLS } from "./items.ts";
import { findLeak, recipeProblems } from "./layout-test-helpers.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import { ENEMY_STATS } from "./enemy-config.ts";
import {
  addPlayer,
  bladeHits,
  createSimState,
  stepWorld,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const ticks = (s: number) => Math.round(s / TICK_SECONDS);
const still = (x: number, y: number, id = 1): AiTarget => ({
  id,
  position: { x, y },
  velocity: { x: 0, y: 0 },
});

function run(
  enemy: EnemyState,
  seconds: number,
  targets: AiTarget[],
  context: Partial<AiContext> = {},
): { enemy: EnemyState; actions: EnemyAction[] } {
  const ctx: AiContext = { aliveSummons: () => 0, ...context };
  const actions: EnemyAction[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const a = enemyAct(enemy, targets, [], TICK_SECONDS, ctx);
    actions.push(a);
    enemy = a.enemy;
  }
  return { enemy, actions };
}

function step(sim: SimState, seconds: number) {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks(seconds); t++) {
    const r = stepWorld(sim, [], TICK_SECONDS);
    sim = r.state;
    events.push(...r.events);
  }
  return { sim, events };
}

describe("the Clockwork Vault (D-137)", () => {
  it("is an endgame dungeon with a fixed map: the same layout for every seed", () => {
    const info = dungeonInfo("clockwork-vault");
    expect(info).toMatchObject({
      name: "Clockwork Vault",
      listed: true,
      minLevel: 20,
    });
    expect(info.generate).toBeUndefined();
    expect(layoutFor("clockwork-vault", 1)).toBe(VAULT_LAYOUT);
    expect(layoutFor("clockwork-vault", 987654)).toBe(VAULT_LAYOUT);
    expect(entryProblem("clockwork-vault", 3, 19)).toBe(
      "Reach level 20 first.",
    );
    expect(LOOT_POOLS["clockwork-vault"].tiers).toEqual([
      [6, 30],
      [7, 45],
      [8, 25],
    ]);
  });

  it("its rooms are 4,600 / 7,260 / 9,920; the map follows the rules, has no gaps, and comes to 78,140", () => {
    const hp = (band: string) => [
      ...new Set(
        VAULT_PIECES.filter((p) => p.band === band).map((p) =>
          pieceHp(p.piece),
        ),
      ),
    ];
    expect([hp("light"), hp("medium"), hp("heavy")]).toEqual([
      [4600],
      [7260],
      [9920],
    ]);
    expect(recipeProblems(VAULT_RECIPE, VAULT_LAYOUT)).toEqual([]);
    expect(findLeak(VAULT_LAYOUT)).toBeNull();
    const required = VAULT_LAYOUT.rooms
      .filter((r) => r.required)
      .flatMap((r) => r.waves.flat())
      .reduce((t, s) => t + ENEMY_STATS[s.kind].maxHp, 0);
    expect(required).toBe(78_140);
    expect(
      VAULT_LAYOUT.rooms.filter((r) => r.blades).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("blade arms (D-137)", () => {
  it("turn only in a fighting room", () => {
    const room = VAULT_LAYOUT.rooms.findIndex((r) => r.blades);
    const progress = VAULT_LAYOUT.rooms.map((_, i) => ({
      status: i === room ? "active" : "dormant",
      wave: 0,
      clock: 0,
      released: 0,
      waveStart: 0,
      dropped: 0,
      volleys: 0,
      gap: -1,
      runeSteps: 0,
    })) as RunProgress;
    expect(activeBlades(progress, VAULT_LAYOUT)).toEqual(
      VAULT_LAYOUT.rooms[room]!.blades,
    );
    expect(
      activeBlades(
        progress.map((p) => ({ ...p, status: "cleared" })) as RunProgress,
        VAULT_LAYOUT,
      ),
    ).toEqual([]);
  });

  it("a turning arm hits a player it sweeps over for 14, the room's hit, at most once a second", () => {
    // An arm from (0, 0), 150 long, a quarter turn a second: it sweeps
    // over the player at (100, 0) as it passes angle 0.
    let sim = addPlayer(createSimState([]), 1, { x: 100, y: 0 });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
      roomBlades: [
        { pivot: { x: 0, y: 0 }, length: 150, degreesPerSecond: 90 },
      ],
      clock: 0,
    };
    const { events } = step(sim, 4.05);
    const hits = events.filter((e) => e.type === "hazardHit") as {
      hazard: string;
      damage: number;
    }[];
    // Once at angle 0, once again a full turn (4 s) later.
    expect(hits.map((h) => [h.hazard, h.damage])).toEqual([
      ["blades", BLADES.damage],
      ["blades", BLADES.damage],
    ]);
    expect(
      bladeHits(
        { pivot: { x: 0, y: 0 }, length: 150, angle: 0 },
        // Band half-thickness 8 + hurtbox half 15.5: 30 px past the tip is clear.
        { x: 180, y: 0 },
      ),
    ).toBe(false);
  });
});

describe("the Vault's enemies (D-137)", () => {
  it("a clockwork sentry's shield blocks shots from the front, like a grave knight's", () => {
    const e = { ...newEnemy(1, "sentry", { x: 0, y: 0 }, null, null) };
    const facingEast = {
      ...e,
      ai: { ...(e.ai as { kind: "sentry" }), facing: { x: 1, y: 0 } },
    } as EnemyState;
    expect(shieldBlocks(facingEast, { x: -1, y: 0 })).toBe(true);
    expect(shieldBlocks(facingEast, { x: 1, y: 0 })).toBe(false);
    const { actions } = run(e, 3, [still(40, 0)]);
    expect(actions.flatMap((a) => a.contacts.map((c) => c.damage))).toContain(
      SENTRY.slam.damage,
    );
  });

  it("a floor turret never moves and fires fans of three", () => {
    const { enemy, actions } = run(
      newEnemy(1, "turret", { x: 0, y: 0 }, null, null),
      3,
      [still(300, 0)],
    );
    expect(enemy.position).toEqual({ x: 0, y: 0 });
    const fans = actions.filter((a) => a.bullets.length > 0);
    expect(fans[0]!.bullets).toHaveLength(3);
    expect(fans[0]!.bullets[0]!.spec.damage).toBe(TURRET.rock.damage);
  });
});

describe("the Automaton (D-137)", () => {
  const bot = (share = 1) => {
    const e = newEnemy(1, "automaton", { x: 400, y: 360 }, "core", null);
    return { ...e, hp: e.maxHp * share };
  };

  it("has 22,000 HP and is never healed; its plating lets through a quarter of every hit, overheated it takes double", () => {
    expect(AUTOMATON.maxHp).toBe(22000);
    expect(BOSS_KINDS).toContain("automaton");
    expect(damageEnemy(bot(), 100).damage).toBe(25);
    const hot = {
      ...bot(),
      ai: { ...(bot().ai as { kind: "automaton" }), venting: 1 },
    } as EnemyState;
    expect(damageEnemy(hot, 100).damage).toBe(200);
  });

  it("overheats for 3 s every 10 s; meanwhile no laser and no rifle", () => {
    const { actions } = run(bot(), 13.5, [still(700, 360)]);
    const hot = actions.filter((a) => isVenting(a.enemy));
    expect(hot.length * TICK_SECONDS).toBeCloseTo(3, 1);
    expect(hot.every((a) => !a.blades && a.bullets.length === 0)).toBe(true);
    // Otherwise its laser turns, and rifle bursts of 7 come.
    expect(actions[0]!.blades).toHaveLength(1);
    expect(
      actions.some((a) => a.bullets.length === AUTOMATON.rifle.count),
    ).toBe(true);
  });

  it("below half HP calls cog drones, at most 4 alive; enraged, two laser arms and overheating every 7 s", () => {
    const drones = run(bot(0.49), 1, [still(700, 360)]).actions.flatMap(
      (a) => a.summons,
    );
    expect(drones.map((d) => d.kind)).toEqual(["drone", "drone"]);
    expect(
      run(bot(0.49), 1, [still(700, 360)], {
        aliveSummons: () => 4,
      }).actions.flatMap((a) => a.summons),
    ).toEqual([]);
    const enraged = run(bot(0.24), 1, [still(700, 360)]).actions;
    expect(enraged[0]!.blades).toHaveLength(2);
  });

  it("its laser cuts players like a room's arm, but as the Automaton's hit", () => {
    let sim = addPlayer(createSimState([], { respawnSeconds: null }), 1, {
      x: 400 + 150,
      y: 360,
    });
    sim = {
      ...sim,
      players: sim.players.map((p) => ({ ...p, hp: 1e6, maxHp: 1e6 })),
      clock: 0,
    };
    sim = { ...sim, enemies: [bot()] };
    const { events } = step(sim, 4.6);
    const laser = events.filter(
      (e) =>
        e.type === "playerHit" &&
        (e as { damage: number }).damage === AUTOMATON.laser.damage,
    );
    expect(laser.length).toBeGreaterThanOrEqual(1);
  });
});
