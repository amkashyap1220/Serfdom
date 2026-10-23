import type { SnapshotProjectile } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { serverProjectilesToDraw } from "./combat-view-model";

const base: SnapshotProjectile = {
  id: 1,
  owner: "player",
  by: 7,
  x: 100,
  y: 50,
  dx: 1,
  dy: 0,
  speed: 400,
  size: 4,
  ability: false,
};

describe("which server projectiles are drawn", () => {
  it("skips our own basic shots (predicted locally) but keeps our Volley arrows", () => {
    const drawn = serverProjectilesToDraw(
      [
        base,
        { ...base, id: 2, ability: true, speed: 500 },
        { ...base, id: 3, by: 8 },
        { ...base, id: 4, owner: "enemy", by: 7 },
      ],
      7,
      0,
    );
    expect(drawn.map((p) => [p.owner, p.ability])).toEqual([
      ["player", true], // our arrow: was invisible before this fix
      ["player", false], // another player's shot
      ["enemy", false], // an enemy bullet, whatever its id
    ]);
  });

  it("moves each projectile forward by its age", () => {
    const [p] = serverProjectilesToDraw([{ ...base, by: 9 }], 7, 0.05);
    expect(p).toMatchObject({ x: 120, y: 50 });
  });
});
