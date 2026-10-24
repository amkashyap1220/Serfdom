import {
  applyPlayerInput,
  combatFor,
  newPlayer,
  SERF_BASE,
  TICK_SECONDS,
  type PlayerInput,
  type SimState,
} from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { PlayerPredictor } from "./prediction";

const RIGHT: PlayerInput = {
  move: { x: 1, y: 0 },
  fire: { trigger: false, aim: null },
};

describe("prediction uses your stats (8c-2)", () => {
  it("a Speed-30 serf predicts 225 px/s and matches the server exactly", () => {
    const stats = { ...SERF_BASE, speed: 30 };
    const predictor = new PlayerPredictor(
      1,
      { x: 0, y: 0 },
      [],
      combatFor(stats),
    );
    // The server's view of the same player, stepped by the same inputs.
    let server: SimState = {
      players: [newPlayer(1, { x: 0, y: 0 }, stats)],
      enemies: [],
      projectiles: [],
      nextProjectileId: 1,
      nextEnemyId: 1,
      hazards: [],
      blasts: [],
      zones: [],
      sludge: [],
      fires: [],
    };
    for (let i = 0; i < 60; i++) {
      predictor.predict(RIGHT);
      if (i < 30)
        server = applyPlayerInput(server, 1, RIGHT, [], TICK_SECONDS).state;
    }
    expect(predictor.position.x).toBeCloseTo(225, 6);
    // Server acknowledges input 29; the other 30 are replayed on top.
    const me = server.players[0]!;
    predictor.reconcile({
      id: 1,
      x: me.position.x,
      y: me.position.y,
      ack: 29,
      hp: me.hp,
      maxHp: me.maxHp,
      mp: me.mp,
      maxMp: me.combat.maxMp,
      buffs: [],
      cooldown: me.fireCooldown,
      pull: null,
    });
    expect(predictor.lastCorrection).toBe(0);
  });
});

describe("prediction wades through sludge like the server (D-113)", () => {
  it("slows in a pool exactly as the server does, so nothing snaps back", () => {
    const pool = { x: 100, y: -50, width: 200, height: 100 };
    const combat = combatFor(SERF_BASE);
    const predictor = new PlayerPredictor(1, { x: 0, y: 0 }, [], combat, [
      pool,
    ]);
    let server: SimState = {
      players: [newPlayer(1, { x: 0, y: 0 })],
      enemies: [],
      projectiles: [],
      nextProjectileId: 1,
      nextEnemyId: 1,
      hazards: [],
      blasts: [],
      zones: [],
      sludge: [pool],
      fires: [],
    };
    for (let i = 0; i < 120; i++) {
      predictor.predict(RIGHT);
      server = applyPlayerInput(server, 1, RIGHT, [], TICK_SECONDS).state;
    }
    const me = server.players[0]!;
    // Slower than 2 s at full speed: part of the walk was in the sludge.
    expect(me.position.x).toBeLessThan(2 * combat.moveSpeed - 1);
    expect(predictor.position.x).toBeCloseTo(me.position.x, 9);
    predictor.reconcile({
      id: 1,
      x: me.position.x,
      y: me.position.y,
      ack: 119,
      hp: me.hp,
      maxHp: me.maxHp,
      mp: me.mp,
      maxMp: me.combat.maxMp,
      buffs: [],
      cooldown: me.fireCooldown,
      pull: null,
    });
    expect(predictor.lastCorrection).toBe(0);
  });
});

describe("prediction follows the Sunken Temple's water (D-135)", () => {
  it("deep tides and an eel-priest's pull replay exactly: no correction", () => {
    const pool = { x: 0, y: -200, width: 2000, height: 400 };
    const pull = { to: { x: 600, y: 0 }, from: 4.7, speed: 240, left: 0.45 };
    const predictor = new PlayerPredictor(
      1,
      { x: 100, y: 0 },
      [],
      combatFor(SERF_BASE),
      [],
      [pool],
    );
    // The tide rises at 4 s and is deep from 5 s; the pull starts at 4.7 s.
    const start = 4.5;
    let server: SimState = {
      players: [
        {
          ...newPlayer(1, { x: 100, y: 0 }, SERF_BASE),
          pull: { ...pull, by: 9 },
        },
      ],
      enemies: [],
      projectiles: [],
      nextProjectileId: 1,
      nextEnemyId: 1,
      hazards: [],
      blasts: [],
      zones: [],
      sludge: [],
      fires: [],
      tides: [pool],
      clock: start,
    };
    const snap = (s: SimState, ack: number) => {
      const me = s.players[0]!;
      return {
        id: 1,
        x: me.position.x,
        y: me.position.y,
        ack,
        hp: me.hp,
        maxHp: me.maxHp,
        mp: me.mp,
        maxMp: me.combat.maxMp,
        buffs: [],
        cooldown: me.fireCooldown,
        pull: me.pull
          ? {
              x: me.pull.to.x,
              y: me.pull.to.y,
              from: me.pull.from,
              speed: me.pull.speed,
              left: me.pull.left,
            }
          : null,
      };
    };
    predictor.setWater(start, []);
    predictor.reset(snap(server, -1));
    // The server applies each input, then its world step moves the clock on.
    const states: SimState[] = [];
    for (let i = 0; i < 60; i++) {
      predictor.predict(RIGHT);
      server = applyPlayerInput(server, 1, RIGHT, [], TICK_SECONDS).state;
      server = { ...server, clock: server.clock! + TICK_SECONDS };
      states.push(server);
    }
    // The pull and the deep water both happened in those 60 ticks.
    expect(server.players[0]!.pull).toBeUndefined();
    const after30 = states[29]!;
    predictor.setWater(after30.clock!, []);
    predictor.reconcile(snap(after30, 29));
    expect(predictor.lastCorrection).toBeCloseTo(0, 9);
    expect(predictor.position.x).toBeCloseTo(server.players[0]!.position.x, 9);
  });
});

describe("prediction follows Frost Hollow's frost (D-136)", () => {
  it("slowing on frost replays exactly: no correction", () => {
    const frost = [{ at: { x: 160, y: 0 }, radius: 60, from: 0.2, until: 0.9 }];
    const predictor = new PlayerPredictor(
      1,
      { x: 100, y: 0 },
      [],
      combatFor(SERF_BASE),
    );
    let server: SimState = {
      players: [newPlayer(1, { x: 100, y: 0 }, SERF_BASE)],
      enemies: [],
      projectiles: [],
      nextProjectileId: 1,
      nextEnemyId: 1,
      hazards: [],
      blasts: [],
      zones: [],
      sludge: [],
      fires: [],
      frost,
      clock: 0,
    };
    predictor.setWater(0, [], frost);
    const states: SimState[] = [];
    for (let i = 0; i < 60; i++) {
      predictor.predict(RIGHT);
      server = applyPlayerInput(server, 1, RIGHT, [], TICK_SECONDS).state;
      server = { ...server, clock: server.clock! + TICK_SECONDS };
      states.push(server);
    }
    const at = states[19]!;
    const me = at.players[0]!;
    predictor.setWater(at.clock!, [], frost);
    predictor.reconcile({
      id: 1,
      x: me.position.x,
      y: me.position.y,
      ack: 19,
      hp: me.hp,
      maxHp: me.maxHp,
      mp: me.mp,
      maxMp: me.combat.maxMp,
      buffs: [],
      cooldown: me.fireCooldown,
      pull: null,
    });
    expect(predictor.lastCorrection).toBeCloseTo(0, 9);
    // Slower than a straight walk: the frost really slowed it.
    expect(server.players[0]!.position.x).toBeLessThan(100 + 150 - 1);
  });
});

describe("prediction follows Stormspire's wind (D-139)", () => {
  it("a gust replays exactly: no correction", () => {
    const winds = [
      {
        rect: { x: 0, y: -300, width: 3000, height: 600 },
        dir: { x: 0, y: 1 },
      },
    ];
    const predictor = new PlayerPredictor(
      1,
      { x: 100, y: 0 },
      [],
      combatFor(SERF_BASE),
      [],
      [],
      winds,
    );
    let server: SimState = {
      players: [newPlayer(1, { x: 100, y: 0 }, SERF_BASE)],
      enemies: [],
      projectiles: [],
      nextProjectileId: 1,
      nextEnemyId: 1,
      hazards: [],
      blasts: [],
      zones: [],
      sludge: [],
      fires: [],
      winds,
      clock: 2.5,
    };
    // First contact, as in a run: the predictor adopts the server's clock.
    predictor.setWater(2.5, []);
    predictor.reset({
      id: 1,
      x: 100,
      y: 0,
      ack: -1,
      hp: server.players[0]!.hp,
      maxHp: server.players[0]!.maxHp,
      mp: server.players[0]!.mp,
      maxMp: server.players[0]!.combat.maxMp,
      buffs: [],
      cooldown: 0,
      pull: null,
    });
    const states: SimState[] = [];
    for (let i = 0; i < 60; i++) {
      predictor.predict(RIGHT);
      server = applyPlayerInput(server, 1, RIGHT, [], TICK_SECONDS).state;
      server = { ...server, clock: server.clock! + TICK_SECONDS };
      states.push(server);
    }
    const at = states[24]!;
    const me = at.players[0]!;
    predictor.setWater(at.clock!, []);
    predictor.reconcile({
      id: 1,
      x: me.position.x,
      y: me.position.y,
      ack: 24,
      hp: me.hp,
      maxHp: me.maxHp,
      mp: me.mp,
      maxMp: me.combat.maxMp,
      buffs: [],
      cooldown: me.fireCooldown,
      pull: null,
    });
    expect(predictor.lastCorrection).toBeCloseTo(0, 9);
    // The gust (from 3 s, half a second of it here) really pushed it south: about 45 px.
    expect(server.players[0]!.position.y).toBeGreaterThan(30);
  });
});
