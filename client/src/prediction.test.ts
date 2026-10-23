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
      cooldown: me.fireCooldown,
    });
    expect(predictor.lastCorrection).toBe(0);
  });
});
