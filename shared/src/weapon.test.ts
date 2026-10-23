import { describe, expect, it } from "vitest";
import {
  aimDirection,
  closestTargetInRange,
  nextFireMode,
  resolveFireIntent,
  stepFireCooldown,
  type PointerState,
} from "./weapon.ts";

const origin = { x: 0, y: 0 };
const NO_POINTER: PointerState = { world: null, down: false };

describe("nextFireMode", () => {
  it("cycles full auto → auto aim → auto fire → manual → full auto (D-099)", () => {
    expect(nextFireMode("fullAuto")).toBe("autoAim");
    expect(nextFireMode("autoAim")).toBe("autoFire");
    expect(nextFireMode("autoFire")).toBe("manual");
    expect(nextFireMode("manual")).toBe("fullAuto");
  });
});

describe("closestTargetInRange", () => {
  it("picks the closest target", () => {
    const t = closestTargetInRange(
      origin,
      [
        { id: 1, position: { x: 200, y: 0 } },
        { id: 2, position: { x: 0, y: -100 } },
      ],
      300,
    );
    expect(t?.id).toBe(2);
  });

  it("ignores targets beyond range and includes one exactly at range", () => {
    expect(
      closestTargetInRange(
        origin,
        [{ id: 1, position: { x: 301, y: 0 } }],
        300,
      ),
    ).toBeNull();
    expect(
      closestTargetInRange(origin, [{ id: 1, position: { x: 300, y: 0 } }], 300)
        ?.id,
    ).toBe(1);
  });

  it("breaks distance ties by lowest id", () => {
    const t = closestTargetInRange(
      origin,
      [
        { id: 5, position: { x: 100, y: 0 } },
        { id: 3, position: { x: -100, y: 0 } },
      ],
      300,
    );
    expect(t?.id).toBe(3);
  });
});

describe("aimDirection", () => {
  it("is a unit vector toward the point", () => {
    expect(aimDirection(origin, { x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
  });

  it("is null when the points coincide", () => {
    expect(aimDirection(origin, origin)).toBeNull();
  });
});

describe("resolveFireIntent", () => {
  const near = [{ id: 1, position: { x: 100, y: 0 } }];
  const far = [{ id: 1, position: { x: 500, y: 0 } }];
  const mouseUp: PointerState = { world: { x: 0, y: -50 }, down: false };
  const mouseDown: PointerState = { world: { x: 0, y: -50 }, down: true };

  it("auto aim fires at the closest enemy in range, ignoring the mouse", () => {
    expect(resolveFireIntent("autoAim", mouseUp, origin, near, 300)).toEqual({
      trigger: true,
      aim: { x: 1, y: 0 },
      auto: true,
    });
  });

  it("auto aim does not fire with no enemy in range", () => {
    expect(
      resolveFireIntent("autoAim", mouseDown, origin, far, 300).trigger,
    ).toBe(false);
  });

  it("auto fire always fires toward the mouse, no click needed", () => {
    expect(resolveFireIntent("autoFire", mouseUp, origin, [], 300)).toEqual({
      trigger: true,
      aim: { x: 0, y: -1 },
      auto: true,
    });
    // Clicking in auto fire is a deliberate shot (D-101).
    expect(resolveFireIntent("autoFire", mouseDown, origin, [], 300).auto).toBe(
      false,
    );
  });

  it("while vanished, every mode fires only on a click, toward the mouse (D-101)", () => {
    for (const mode of ["fullAuto", "autoAim", "autoFire", "manual"] as const) {
      expect(
        resolveFireIntent(mode, mouseUp, origin, near, 300, true).trigger,
      ).toBe(false);
      expect(
        resolveFireIntent(mode, mouseDown, origin, near, 300, true),
      ).toEqual({ trigger: true, aim: { x: 0, y: -1 } });
    }
  });

  it("manual fires only while the button is held, toward the mouse", () => {
    expect(
      resolveFireIntent("manual", mouseUp, origin, near, 300).trigger,
    ).toBe(false);
    expect(resolveFireIntent("manual", mouseDown, origin, near, 300)).toEqual({
      trigger: true,
      aim: { x: 0, y: -1 },
    });
  });

  it("mouse modes never fire before the mouse position is known", () => {
    expect(
      resolveFireIntent("autoFire", NO_POINTER, origin, [], 300).trigger,
    ).toBe(false);
  });

  it("does not fire with the mouse exactly on the player", () => {
    const onPlayer = { world: origin, down: true };
    expect(resolveFireIntent("manual", onPlayer, origin, [], 300).trigger).toBe(
      false,
    );
  });
});

describe("stepFireCooldown", () => {
  const DT = 1 / 60;

  function shotsOverTicks(ticks: number, shotsPerSecond: number): number[] {
    let remaining = 0;
    const firedAt: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const r = stepFireCooldown(remaining, DT, true, shotsPerSecond);
      remaining = r.remaining;
      if (r.fired) firedAt.push(i);
    }
    return firedAt;
  }

  it("fires immediately, then exactly 4 shots per second at 60 Hz", () => {
    expect(shotsOverTicks(60, 4)).toEqual([0, 15, 30, 45]);
  });

  it("keeps a non-integer rate exact over time (7 shots/s)", () => {
    expect(shotsOverTicks(600, 7)).toHaveLength(70);
  });

  it("does not save up shots while idle", () => {
    let remaining = 0;
    for (let i = 0; i < 600; i++) {
      remaining = stepFireCooldown(remaining, DT, false, 4).remaining;
    }
    expect(remaining).toBe(0);
    // Pressing fire after a long idle gives one shot, not a burst.
    let fired = 0;
    for (let i = 0; i < 5; i++) {
      const r = stepFireCooldown(remaining, DT, true, 4);
      remaining = r.remaining;
      if (r.fired) fired++;
    }
    expect(fired).toBe(1);
  });

  it("rejects a non-positive fire rate", () => {
    expect(() => stepFireCooldown(0, DT, true, 0)).toThrow(RangeError);
  });
});
