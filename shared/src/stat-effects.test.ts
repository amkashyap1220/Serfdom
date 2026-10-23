import { describe, expect, it } from "vitest";
import { ENEMY_RING_ATTACK, PLAYER_WEAPON } from "./combat-config.ts";
import { TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  findPlayer,
  spawnEnemies,
  stepWorld,
  type PlayerInput,
  type SimEvent,
  type SimState,
} from "./sim.ts";
import { SERF_BASE, type Stats } from "./stats.ts";

const RIGHT: PlayerInput = {
  move: { x: 1, y: 0 },
  fire: { trigger: false, aim: null },
};
const FIRE: PlayerInput = {
  move: { x: 0, y: 0 },
  fire: { trigger: true, aim: { x: 1, y: 0 } },
};

function playerWith(
  stats: Partial<Stats>,
  enemies: { x: number; y: number }[] = [],
) {
  return addPlayer(
    createSimState(enemies),
    1,
    { x: 0, y: 0 },
    { ...SERF_BASE, ...stats },
  );
}

function inputs(state: SimState, input: PlayerInput, ticks: number) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = applyPlayerInput(state, 1, input, [], TICK_SECONDS);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

function world(state: SimState, ticks: number) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepWorld(state, [], TICK_SECONDS);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe("stats change combat (8c-2, D-077, D-078)", () => {
  it("HP sets max HP and starting HP", () => {
    const p = findPlayer(playerWith({ hp: 38 }), 1)!;
    expect([p.hp, p.maxHp]).toEqual([38, 38]);
  });

  it("Speed 30 moves 225 px/s instead of 150", () => {
    const slow = inputs(playerWith({}), RIGHT, 60).state;
    const fast = inputs(playerWith({ speed: 30 }), RIGHT, 60).state;
    expect(findPlayer(slow, 1)!.position.x).toBeCloseTo(150, 6);
    expect(findPlayer(fast, 1)!.position.x).toBeCloseTo(225, 6);
  });

  it("Dexterity 30 fires 6 shots/s instead of 4", () => {
    const shots = (dexterity: number) =>
      inputs(playerWith({ dexterity }), FIRE, 60).events.filter(
        (e) => e.type === "shot",
      ).length;
    expect(shots(10)).toBe(4);
    expect(shots(30)).toBe(6);
  });

  it("Attack 30 shots carry 50 damage instead of 25", () => {
    const shot = (attack: number) =>
      inputs(playerWith({ attack }), FIRE, 1).state.projectiles[0]!.damage;
    expect(shot(10)).toBe(PLAYER_WEAPON.damage);
    expect(shot(30)).toBe(50);
  });

  it("Defense 30 takes a quarter of each hit, and the event says so", () => {
    const hitOf = (defense: number) => {
      const { events } = world(playerWith({ defense }, [{ x: 100, y: 0 }]), 60);
      return events.find((e) => e.type === "playerHit");
    };
    expect(hitOf(0)).toMatchObject({ damage: ENEMY_RING_ATTACK.damage });
    expect(hitOf(30)).toMatchObject({ damage: ENEMY_RING_ATTACK.damage / 4 });
  });

  it("Vitality 30 regenerates 1.5 HP/s", () => {
    let s = playerWith({ vitality: 30 });
    s = { ...s, players: s.players.map((p) => ({ ...p, hp: 5 })) };
    expect(findPlayer(world(s, 60).state, 1)!.hp).toBeCloseTo(6.5, 6);
  });
});

describe("MP (D-093, D-096)", () => {
  it("starts full at the MP stat and regenerates WIS / 10 per second, capped", () => {
    let s = playerWith({ mp: 26, wisdom: 20 });
    expect(findPlayer(s, 1)!.mp).toBe(26);
    s = { ...s, players: s.players.map((p) => ({ ...p, mp: 5 })) };
    expect(findPlayer(world(s, 60).state, 1)!.mp).toBeCloseTo(7, 6);
    expect(findPlayer(world(s, 60 * 30).state, 1)!.mp).toBe(26);
  });
});

describe("Arcane Blast (D-092–D-096)", () => {
  const CAST = (x: number, y: number): PlayerInput => ({
    move: { x: 0, y: 0 },
    fire: { trigger: false, aim: null },
    ability: { x, y },
  });
  /** A Wizard at the origin with a tier-`tier` Spellbook, enemies around. */
  function wizard(
    enemies: { x: number; y: number }[],
    stats: Partial<Stats> = {},
    tier = 0,
  ) {
    return addPlayer(
      createSimState(enemies),
      1,
      { x: 0, y: 0 },
      { ...SERF_BASE, mp: 40, ...stats },
      null,
      { kind: "arcaneBlast", tier },
    );
  }
  const hp = (s: SimState) => s.enemies.map((e) => e.hp);

  it("hits every enemy within 40 px of the target, once, for (80 + 20 × tier) × attack", () => {
    // Dummies at 100 and 130 px east are both within 40 px of x = 115; the
    // one at 300 px is not.
    let s = wizard(
      [
        { x: 100, y: 0 },
        { x: 130, y: 0 },
        { x: 300, y: 0 },
      ],
      { attack: 30 },
      1,
    );
    const before = hp(s);
    s = applyPlayerInput(s, 1, CAST(115, 0), [], TICK_SECONDS).state;
    expect(s.blasts).toHaveLength(1);
    const { state, events } = world(s, 1);
    const damage = (80 + 20) * 2; // ATK 30 → ×2
    expect(hp(state)).toEqual([
      before[0]! - damage,
      before[1]! - damage,
      before[2],
    ]);
    expect(
      events.filter((e) => e.type === "hit" && e.playerId === 1),
    ).toHaveLength(2);
    expect(events.some((e) => e.type === "blast")).toBe(true);
    expect(state.blasts).toEqual([]);
  });

  it("costs 15 MP and waits 1.5 s; no cast without MP", () => {
    let s = wizard([{ x: 100, y: 0 }], { mp: 20 });
    s = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS).state;
    expect(findPlayer(s, 1)!.mp).toBe(5);
    s = world(s, 1).state;
    // Held for the rest of the cooldown: no second blast (and only 5 MP).
    for (let i = 0; i < 89; i++) {
      s = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS).state;
      expect(s.blasts).toEqual([]);
    }
    s = { ...s, players: s.players.map((p) => ({ ...p, mp: 40 })) };
    s = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS).state;
    expect(s.blasts).toHaveLength(1); // 1.5 s later, with MP again
  });

  it("lands at most 250 px away; nothing without the ability item", () => {
    let s = wizard([]);
    s = applyPlayerInput(s, 1, CAST(1000, 0), [], TICK_SECONDS).state;
    expect(s.blasts[0]?.at).toEqual({ x: 250, y: 0 });
    let plain = addPlayer(
      createSimState([]),
      1,
      { x: 0, y: 0 },
      { ...SERF_BASE, mp: 40 },
    );
    plain = applyPlayerInput(plain, 1, CAST(50, 0), [], TICK_SECONDS).state;
    expect(plain.blasts).toEqual([]);
    expect(findPlayer(plain, 1)!.mp).toBe(40);
  });
});

describe("Ranger Volley (D-097)", () => {
  const CAST = (x: number, y: number): PlayerInput => ({
    move: { x: 0, y: 0 },
    fire: { trigger: false, aim: null },
    ability: { x, y },
  });
  function ranger(
    enemies: { x: number; y: number }[],
    stats: Partial<Stats> = {},
    tier = 0,
  ) {
    return addPlayer(
      createSimState(enemies),
      1,
      { x: 0, y: 0 },
      { ...SERF_BASE, mp: 30, ...stats },
      null,
      { kind: "volley", tier },
    );
  }

  it("fires 5 arrows in an even 30° fan around the aim, 500 px/s, 350 px", () => {
    const s = applyPlayerInput(
      ranger([]),
      1,
      CAST(100, 0),
      [],
      TICK_SECONDS,
    ).state;
    expect(s.projectiles).toHaveLength(5);
    const angles = s.projectiles.map(
      (p) =>
        Math.round(
          ((Math.atan2(p.direction.y, p.direction.x) * 180) / Math.PI) * 10,
        ) / 10,
    );
    expect(angles).toEqual([-15, -7.5, 0, 7.5, 15]);
    for (const p of s.projectiles) {
      expect(p).toMatchObject({
        owner: "player",
        ownerId: 1,
        speed: 500,
        remaining: 350,
        size: 4,
      });
    }
    expect(findPlayer(s, 1)!.mp).toBe(18); // 30 − 12
  });

  it("each arrow does (30 + 8 × tier) × attack and stops at the first enemy", () => {
    const s = applyPlayerInput(
      ranger([{ x: 60, y: 0 }], { attack: 30 }, 2),
      1,
      CAST(60, 0),
      [],
      TICK_SECONDS,
    ).state;
    expect(s.projectiles.every((p) => p.damage === (30 + 16) * 2)).toBe(true);
    const before = s.enemies[0]!.hp;
    const { state } = world(s, 30);
    // At 60 px the middle three arrows (±7.5° is ~8 px off the line) hit the
    // 16 px dummy; the outer two (±15°, ~16 px off) miss: close range is
    // where a Volley hits hardest.
    expect(before - state.enemies[0]!.hp).toBe(3 * 92);
  });

  it("waits 1.2 s between volleys and needs a direction", () => {
    let s = ranger([], { mp: 40 });
    s = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS).state;
    for (let i = 0; i < 71; i++)
      s = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS).state;
    expect(s.projectiles).toHaveLength(5); // no second volley within 1.2 s
    s = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS).state;
    expect(s.projectiles).toHaveLength(10); // the 72nd tick: 1.2 s
    const zero = applyPlayerInput(
      ranger([]),
      1,
      CAST(0, 0),
      [],
      TICK_SECONDS,
    ).state;
    expect(zero.projectiles).toEqual([]);
    expect(findPlayer(zero, 1)!.mp).toBe(30); // nothing spent
  });
});

describe("Sorcerer Chain Lightning (D-097)", () => {
  const CAST = (x: number, y: number): PlayerInput => ({
    move: { x: 0, y: 0 },
    fire: { trigger: false, aim: null },
    ability: { x, y },
  });
  const sorcerer = (
    enemies: { x: number; y: number }[],
    tier = 0,
    stats: Partial<Stats> = {},
  ) =>
    addPlayer(
      createSimState(enemies),
      1,
      { x: 0, y: 0 },
      { ...SERF_BASE, mp: 40, ...stats },
      null,
      { kind: "chainLightning", tier },
    );
  const hpLost = (before: SimState, after: SimState) =>
    before.enemies.map((e, i) => e.hp - after.enemies[i]!.hp);

  it("hits the enemy nearest the target, then jumps 3 times at 80% each", () => {
    // A line of five dummies 100 px apart, starting 100 px east.
    const s = sorcerer([100, 200, 300, 400, 500].map((x) => ({ x, y: 0 })));
    const r = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS);
    expect(hpLost(s, r.state)).toEqual(
      [70, 56, 44.8, 35.84, 0].map((d) => expect.closeTo(d, 6)),
    );
    expect(r.events.find((e) => e.type === "chain")).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 300, y: 0 },
        { x: 400, y: 0 },
      ],
    });
    expect(findPlayer(r.state, 1)!.mp).toBe(25);
  });

  it("jumps once more at T5 and again at T10; damage scales with tier and ATK", () => {
    const line = [100, 200, 300, 400, 500, 600, 700].map((x) => ({ x, y: 0 }));
    const hits = (tier: number) =>
      applyPlayerInput(
        sorcerer(line, tier),
        1,
        CAST(100, 0),
        [],
        TICK_SECONDS,
      ).events.filter((e) => e.type === "hit").length;
    expect([hits(0), hits(5), hits(10)]).toEqual([4, 5, 6]);
    const s = sorcerer([{ x: 100, y: 0 }], 2, { attack: 30 });
    const r = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS);
    expect(hpLost(s, r.state)[0]).toBe((70 + 30) * 2);
  });

  it("stops when no unhit enemy is within 120 px", () => {
    const s = sorcerer([
      { x: 100, y: 0 },
      { x: 230, y: 0 },
    ]);
    const r = applyPlayerInput(s, 1, CAST(100, 0), [], TICK_SECONDS);
    expect(hpLost(s, r.state)).toEqual([70, 0]);
  });

  it("needs a first target within 80 px of the point and 250 px of the caster, or nothing is spent", () => {
    const far = sorcerer([{ x: 300, y: 0 }]); // 300 px away: out of reach
    const r1 = applyPlayerInput(far, 1, CAST(300, 0), [], TICK_SECONDS);
    expect(hpLost(far, r1.state)).toEqual([0]);
    expect(findPlayer(r1.state, 1)!.mp).toBe(40);
    const off = sorcerer([{ x: 100, y: 0 }]); // aimed 90 px from it
    const r2 = applyPlayerInput(off, 1, CAST(100, 90), [], TICK_SECONDS);
    expect(findPlayer(r2.state, 1)!.mp).toBe(40);
  });
});

describe("Druid Nature's Reach (D-097)", () => {
  const CAST = (x: number, y: number): PlayerInput => ({
    move: { x: 0, y: 0 },
    fire: { trigger: false, aim: null },
    ability: { x, y },
  });
  const druid = (enemies: { x: number; y: number }[], tier = 0) =>
    addPlayer(
      createSimState(enemies),
      1,
      { x: 0, y: 0 },
      { ...SERF_BASE, mp: 40 },
      null,
      { kind: "naturesReach", tier },
    );

  it("pulses (20 + 5 × tier) every 0.5 s for 3 s to enemies inside, then vanishes", () => {
    let s = druid(
      [
        { x: 150, y: 0 },
        { x: 150, y: 70 },
      ],
      2,
    ); // second is 70 px from the centre: outside
    s = applyPlayerInput(s, 1, CAST(150, 0), [], TICK_SECONDS).state;
    expect(findPlayer(s, 1)!.mp).toBe(20);
    const before = s.enemies.map((e) => e.hp);
    const { state } = world(s, 4 * 60);
    expect(before[0]! - state.enemies[0]!.hp).toBe(6 * 30); // pulses at 0, 0.5 … 2.5 s
    expect(before[1]! - state.enemies[1]!.hp).toBe(0);
    expect(state.zones).toEqual([]);
  });

  it("enemies inside move at half speed, outside at full", () => {
    const grunt: SimState = { ...createSimState([]), enemies: [] };
    let s = addPlayer(
      grunt,
      1,
      { x: 0, y: 0 },
      { ...SERF_BASE, mp: 40 },
      null,
      { kind: "naturesReach", tier: 0 },
    );
    s = spawnEnemies(s, [
      { kind: "grunt", at: { x: 200, y: 0 }, roomId: null },
    ]);
    const start = s.enemies[0]!.position.x;
    const free = world(s, 30).state.enemies[0]!.position.x;
    const rooted = applyPlayerInput(s, 1, CAST(200, 0), [], TICK_SECONDS).state;
    const slowed = world(rooted, 30).state.enemies[0]!.position.x;
    expect(start - slowed).toBeCloseTo((start - free) / 2, 1);
  });
});
