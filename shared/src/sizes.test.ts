import { describe, expect, it } from "vitest";
import { PLAYER_HEALTH } from "./combat-config.ts";
import { circleHitsPlayer } from "./enemy-ai.ts";
import { ENEMY_KINDS, ENEMY_STATS } from "./enemy-config.ts";
import { PLAYER_BODY, TICK_SECONDS } from "./movement-config.ts";
import { addPlayer, createSimState, dropBoulders, stepWorld } from "./sim.ts";
import { ROCKFALL } from "./dungeon-layout.ts";

describe("32×32 serfs and enemies (D-127)", () => {
  it("the player is 32 px with a 31 px hurtbox", () => {
    expect(PLAYER_BODY).toEqual({ width: 32, height: 32 });
    expect(PLAYER_HEALTH.hurtboxSize).toBe(31);
  });

  it("ordinary enemies and the Lich are the player's size; bigger ones doubled", () => {
    const sizes = Object.fromEntries(
      ENEMY_KINDS.map((k) => [k, ENEMY_STATS[k].size]),
    );
    expect(sizes).toEqual({
      dummy: 32,
      grunt: 32,
      slinger: 32,
      skulker: 32,
      bomber: 32,
      shaman: 32,
      skeleton: 32,
      archer: 32,
      ghost: 32,
      necromancer: 32,
      imp: 32,
      caster: 32,
      elemental: 32,
      bellows: 32,
      golem: 44,
      brute: 40,
      knight: 44,
      crystal: 40,
      warlord: 56,
      warchief: 80,
      acolyte: 32,
      caller: 32,
      spearman: 32,
      eelpriest: 32,
      tidepriest: 56,
      wraith: 32,
      yeti: 40,
      frostarcher: 32,
      iceimp: 32,
      wyrm: 96,
      forgemaster: 88,
      lich: 32,
    });
  });

  it("a circle hits when it touches the hurtbox, not only the centre", () => {
    const at = { x: 0, y: 0 };
    // Radius 28, the box's near edge 15.5 px from the player's centre.
    expect(circleHitsPlayer({ x: 43, y: 0 }, 28, at)).toBe(true);
    expect(circleHitsPlayer({ x: 44, y: 0 }, 28, at)).toBe(false);
    // Diagonally the box corner counts.
    expect(circleHitsPlayer({ x: 30, y: 30 }, 21, at)).toBe(true);
    expect(circleHitsPlayer({ x: 30, y: 30 }, 20, at)).toBe(false);
  });

  it("a boulder landing beside a player hits if its circle reaches the hurtbox", () => {
    const land = (dx: number) => {
      let sim = addPlayer(createSimState([]), 1, { x: 100, y: 100 });
      sim = dropBoulders(sim, [{ at: { x: 100 + dx, y: 100 }, damage: 5 }]);
      const events = [];
      for (
        let t = 0;
        t <= Math.round(ROCKFALL.warnSeconds / TICK_SECONDS);
        t++
      ) {
        const r = stepWorld(sim, [], TICK_SECONDS);
        sim = r.state;
        events.push(...r.events);
      }
      return events.some((e) => e.type === "hazardHit");
    };
    // Radius 28: the centre 40 px away is outside, but the hurtbox is not.
    expect(land(40)).toBe(true);
    expect(land(ROCKFALL.radius + 16)).toBe(false);
  });
});
