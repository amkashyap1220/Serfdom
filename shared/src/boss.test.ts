import { describe, expect, it } from "vitest";
import { enemyAct, isTelegraphing, type AiTarget } from "./enemy-ai.ts";
import { BRUTE, WARLORD } from "./enemy-config.ts";
import { newEnemy, type EnemyState } from "./enemy.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  createSimState,
  findPlayer,
  spawnEnemies,
  stepWorld,
  type SimEvent,
  type SimState,
} from "./sim.ts";

const T = TICK_SECONDS;
const ticks = (seconds: number) => Math.round(seconds / T);
const player = (id: number, x: number, y: number): AiTarget => ({
  id,
  position: { x, y },
});

function runEnemy(
  enemy: EnemyState,
  targets: AiTarget[],
  n: number,
  walls: { x: number; y: number; width: number; height: number }[] = [],
) {
  let e = enemy;
  const log: { tick: number; mode: string; contacts: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = enemyAct(e, targets, walls, T);
    e = a.enemy;
    log.push({
      tick: i,
      mode: e.ai.kind === "brute" ? e.ai.mode : "-",
      contacts: a.contacts.length,
    });
  }
  return { enemy: e, log };
}

describe("brute", () => {
  const ready = (x: number, y: number) => ({
    ...newEnemy(1, "brute", { x, y }, "r", null),
    attackCooldown: 0,
  });

  it("walks up, telegraphs for the windup, then charges", () => {
    const { log } = runEnemy(ready(200, 0), [player(1, 0, 0)], 120);
    const windupStart = log.findIndex((l) => l.mode === "windup");
    const chargeStart = log.findIndex((l) => l.mode === "charge");
    expect(windupStart).toBe(0); // 200 px away: already in trigger range
    expect(chargeStart - windupStart).toBe(ticks(BRUTE.windupSeconds));
    const { enemy } = runEnemy(ready(200, 0), [player(1, 0, 0)], 10);
    expect(isTelegraphing(enemy)).toBe(true);
  });

  it("stays still while telegraphing, and only the charge hurts", () => {
    const { log } = runEnemy(ready(200, 0), [player(1, 0, 0)], ticks(0.6));
    expect(log.every((l) => l.contacts === 0)).toBe(true);
    const { enemy } = runEnemy(ready(200, 0), [player(1, 0, 0)], ticks(0.6));
    expect(enemy.position).toEqual({ x: 200, y: 0 });
  });

  it("locks its direction at the end of the windup: stepping aside dodges it", () => {
    // Player moves 60 px sideways after the charge started.
    let e = ready(200, 0);
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const chargingAlready = e.ai.kind === "brute" && e.ai.mode === "charge";
      const target = chargingAlready ? player(1, 0, 60) : player(1, 0, 0);
      const a = enemyAct(e, [target], [], T);
      e = a.enemy;
      hits += a.contacts.length;
    }
    expect(hits).toBe(0);
  });

  it("hits each player in its path once per charge", () => {
    const { log, enemy } = runEnemy(
      ready(200, 0),
      [player(1, 0, 0), player(2, 0, 5)],
      ticks(BRUTE.windupSeconds + BRUTE.chargeSeconds) + 5,
    );
    expect(log.reduce((n, l) => n + l.contacts, 0)).toBe(2);
    expect(enemy.ai.kind === "brute" && enemy.ai.mode).toBe("recover");
  });

  it("stops charging when it hits a wall", () => {
    const wall = { x: -40, y: -100, width: 10, height: 200 };
    const { enemy, log } = runEnemy(
      ready(100, 0),
      [player(1, -100, 0)],
      ticks(BRUTE.windupSeconds) + 60,
      [wall],
    );
    expect(enemy.position.x).toBeCloseTo(-30 + BRUTE.size / 2, 6);
    expect(log.some((l) => l.mode === "recover")).toBe(true);
  });
});

describe("Goblin Warlord", () => {
  const boss = (hpFraction = 1): EnemyState => {
    const e = newEnemy(1, "warlord", { x: 0, y: 0 }, "throne", null);
    return {
      ...e,
      hp: e.maxHp * hpFraction,
      ai:
        e.ai.kind === "warlord"
          ? { ...e.ai, spread: 0, ring: 0, summon: 0, rockfall: 0 }
          : e.ai,
    };
  };

  it("phase 1: an aimed 5-shot spread and a 12-bullet ring, no summons or rockfall", () => {
    const a = enemyAct(boss(), [player(1, 300, 0)], [], T);
    expect(a.bullets).toHaveLength(5 + 12);
    const spread = a.bullets.filter((b) => b.spec === WARLORD.spread.bullet);
    // The middle shot points straight at the player.
    expect(spread[2]?.direction.x).toBeCloseTo(1, 9);
    expect(spread[2]?.direction.y).toBeCloseTo(0, 9);
    expect(a.summons).toEqual([]);
    expect(a.hazards).toEqual([]);
  });

  it("phase 2 (below half HP): 7-shot spread, 16-bullet ring, summons, rockfall on every player", () => {
    const a = enemyAct(
      boss(0.4),
      [player(1, 300, 0), player(2, -200, 50)],
      [],
      T,
    );
    expect(a.bullets).toHaveLength(7 + 16);
    expect(a.summons.map((s) => s.kind)).toEqual(["grunt", "grunt"]);
    expect(a.hazards.map((h) => h.at)).toEqual([
      { x: 300, y: 0 },
      { x: -200, y: 50 },
    ]);
  });

  it("does not summon past the cap", () => {
    const a = enemyAct(boss(0.4), [player(1, 300, 0)], [], T, {
      aliveSummons: () => WARLORD.summon.maxAlive,
    });
    expect(a.summons).toEqual([]);
  });

  it("alternates its ring offset so the gaps move", () => {
    let e = boss();
    const first = enemyAct(e, [player(1, 300, 0)], [], T);
    e = first.enemy;
    const ringFirst = first.bullets.filter(
      (b) => b.spec === WARLORD.ring.bullet,
    );
    let second = enemyAct(e, [player(1, 300, 0)], [], T);
    for (
      let i = 0;
      i < 600 && second.bullets.every((b) => b.spec !== WARLORD.ring.bullet);
      i++
    ) {
      e = second.enemy;
      second = enemyAct(e, [player(1, 300, 0)], [], T);
    }
    const ringSecond = second.bullets.filter(
      (b) => b.spec === WARLORD.ring.bullet,
    );
    expect(ringSecond[0]?.direction.x).not.toBeCloseTo(
      ringFirst[0]!.direction.x,
      3,
    );
  });

  it("ignores players out of aggro range", () => {
    const a = enemyAct(boss(), [player(1, WARLORD.aggroRange + 10, 0)], [], T);
    expect(a.bullets).toEqual([]);
  });
});

describe("in the world tick", () => {
  function world(at = { x: 0, y: 0 }): SimState {
    return addPlayer(createSimState([], { respawnSeconds: null }), 1, at);
  }
  function run(s: SimState, n: number) {
    const events: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      const r = stepWorld(s, [], T);
      s = r.state;
      events.push(...r.events);
    }
    return { s, events };
  }

  it("rockfall lands after its delay and hurts only players inside it", () => {
    let s = world();
    s = addPlayer(s, 2, { x: 100, y: 0 });
    s = {
      ...s,
      hazards: [
        {
          position: { x: 0, y: 0 },
          radius: 32,
          damage: 3,
          landsIn: 1.2,
          ownerId: 9,
        },
      ],
    };
    const before = run(s, ticks(1.1));
    expect(before.events.filter((e) => e.type === "playerHit")).toEqual([]);
    const after = run(s, ticks(1.3));
    expect(after.events.filter((e) => e.type === "playerHit")).toEqual([
      expect.objectContaining({ playerId: 1, enemyId: 9, damage: 3 }),
    ]);
    expect(after.s.hazards).toEqual([]);
  });

  it("summons join the boss's room, and all die with the boss", () => {
    let s = spawnEnemies(world({ x: 300, y: 0 }), [
      { kind: "warlord", at: { x: 0, y: 0 }, roomId: "throne" },
    ]);
    // Phase 2 and ready to summon.
    s = {
      ...s,
      enemies: s.enemies.map((e) => ({
        ...e,
        hp: e.maxHp * 0.4,
        ai: e.ai.kind === "warlord" ? { ...e.ai, summon: 0 } : e.ai,
      })),
    };
    s = run(s, 1).s;
    const summoned = s.enemies.filter((e) => e.kind === "grunt");
    expect(summoned).toHaveLength(2);
    expect(
      summoned.every((e) => e.roomId === "throne" && e.summonerId === 1),
    ).toBe(true);
    // The Warlord dies: its grunts vanish with it.
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.kind === "warlord" ? { ...e, hp: 0 } : e,
      ),
    };
    expect(run(s, 1).s.enemies).toEqual([]);
  });

  it("the Warlord's phase-2 rockfall reaches the world as hazards", () => {
    let s = spawnEnemies(world({ x: 300, y: 0 }), [
      { kind: "warlord", at: { x: 0, y: 0 }, roomId: "throne" },
    ]);
    s = {
      ...s,
      enemies: s.enemies.map((e) => ({
        ...e,
        hp: e.maxHp * 0.4,
        ai: e.ai.kind === "warlord" ? { ...e.ai, rockfall: 0 } : e.ai,
      })),
    };
    const next = run(s, 1).s;
    expect(next.hazards).toHaveLength(1);
    expect(next.hazards[0]).toMatchObject({
      position: { x: 300, y: 0 },
      ownerId: 1,
    });
    expect(findPlayer(next, 1)).toBeDefined();
  });
});
