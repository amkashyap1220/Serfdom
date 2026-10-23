import { describe, expect, it } from "vitest";
import { newRunStats, recordRunEvents } from "./run-stats.ts";
import type { SimEvent } from "./sim.ts";

const at = { x: 0, y: 0 };

describe("run stats", () => {
  it("counts only the given player's shots, hits, defeats, and damage taken", () => {
    const events: SimEvent[] = [
      { type: "shot", playerId: 1, projectileId: 1 },
      { type: "shot", playerId: 2, projectileId: 2 },
      { type: "hit", enemyId: 1, playerId: 1, damage: 25, position: at },
      { type: "hit", enemyId: 1, playerId: 2, damage: 25, position: at },
      { type: "defeated", enemyId: 1, playerId: 1 },
      { type: "playerHit", playerId: 1, enemyId: 1, damage: 20, position: at },
      { type: "playerHit", playerId: 2, enemyId: 1, damage: 20, position: at },
      { type: "blocked", position: at },
    ];
    expect(recordRunEvents(newRunStats(), 1, events)).toEqual({
      seconds: 0,
      shotsFired: 1,
      shotsHit: 1,
      damageDealt: 25,
      enemiesDefeated: 1,
      damageTaken: 20,
    });
  });

  it("does not modify the stats it was given", () => {
    const before = newRunStats();
    recordRunEvents(before, 1, [
      { type: "shot", playerId: 1, projectileId: 1 },
    ]);
    expect(before.shotsFired).toBe(0);
  });
});
