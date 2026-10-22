import { describe, expect, it } from "vitest";
import { stepProjectile, type Projectile } from "./projectile.ts";

function shot(overrides: Partial<Projectile> = {}): Projectile {
  return {
    id: 1,
    owner: "player",
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    speed: 400,
    remaining: 300,
    damage: 25,
    size: 4,
    ...overrides,
  };
}

const target = (id: number, x: number) => ({
  id,
  box: { x, y: -8, width: 16, height: 16 },
});

describe("stepProjectile", () => {
  it("flies speed × dt and uses up range", () => {
    const r = stepProjectile(shot(), 0.25, [], []);
    expect(r.kind).toBe("flying");
    if (r.kind !== "flying") return;
    expect(r.projectile.position).toEqual({ x: 100, y: 0 });
    expect(r.projectile.remaining).toBe(200);
  });

  it("expires after exactly its range", () => {
    let p = shot();
    let travelled = 0;
    for (let i = 0; i < 100; i++) {
      const r = stepProjectile(p, 1 / 60, [], []);
      if (r.kind !== "flying") {
        expect(r.kind).toBe("expired");
        travelled = r.position.x;
        break;
      }
      p = r.projectile;
    }
    expect(travelled).toBeCloseTo(300, 9);
  });

  it("hits a target in its path", () => {
    const r = stepProjectile(shot(), 1, [], [target(7, 100)]);
    expect(r).toMatchObject({ kind: "hit", targetId: 7 });
    if (r.kind === "hit") expect(r.position.x).toBeCloseTo(98, 9);
  });

  it("does not hit a target beyond its range", () => {
    const r = stepProjectile(shot({ remaining: 50 }), 1, [], [target(7, 100)]);
    expect(r.kind).toBe("expired");
  });

  it("is blocked by a wall in front of a target", () => {
    const wall = { x: 50, y: -100, width: 10, height: 200 };
    const r = stepProjectile(shot(), 1, [wall], [target(7, 100)]);
    expect(r.kind).toBe("blocked");
  });

  it("hits a target in front of a wall", () => {
    const wall = { x: 200, y: -100, width: 10, height: 200 };
    const r = stepProjectile(shot(), 1, [wall], [target(7, 100)]);
    expect(r).toMatchObject({ kind: "hit", targetId: 7 });
  });

  it("hits the nearer of two targets", () => {
    const r = stepProjectile(shot(), 1, [], [target(2, 200), target(3, 100)]);
    expect(r).toMatchObject({ kind: "hit", targetId: 3 });
  });

  it("cannot pass through a thin target at very high speed", () => {
    const thin = { id: 4, box: { x: 150, y: -8, width: 1, height: 16 } };
    const r = stepProjectile(
      shot({ speed: 100000, remaining: 300 }),
      1,
      [],
      [thin],
    );
    expect(r).toMatchObject({ kind: "hit", targetId: 4 });
  });

  it("is blocked immediately when fired from inside a wall", () => {
    const wall = { x: -10, y: -10, width: 20, height: 20 };
    const r = stepProjectile(shot(), 1 / 60, [wall], []);
    expect(r).toMatchObject({ kind: "blocked", position: { x: 0, y: 0 } });
  });
});
