import { layoutFor } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { MINIMAP, minimapShapes, toMinimap } from "./minimap";

const layout = layoutFor("goblin-warrens", 0);
const first = layout.rooms[0]!;
const second = layout.rooms[1]!;
const base = {
  layout,
  seen: new Set<string>(),
  cleared: new Set<string>(),
  closedDoors: [] as string[],
  portalOpen: false,
  me: layout.spawn,
  others: [],
  rotation: 0,
};

describe("the minimap (D-147)", () => {
  it("centres on you and scales the world down", () => {
    const mid = MINIMAP.size / 2;
    expect(toMinimap({ x: 100, y: 100 }, { x: 100, y: 100 }, 0)).toEqual({
      x: mid,
      y: mid,
    });
    expect(toMinimap({ x: 200, y: 100 }, { x: 100, y: 100 }, 0).x).toBeCloseTo(
      mid + 100 * MINIMAP.scale,
    );
  });

  it("turns with the view: a quarter turn moves east to north or south", () => {
    const p = toMinimap({ x: 200, y: 100 }, { x: 100, y: 100 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(MINIMAP.size / 2);
    expect(Math.abs(p.y - MINIMAP.size / 2)).toBeCloseTo(100 * MINIMAP.scale);
  });

  it("hides rooms the run has not woken, and their doors (fog)", () => {
    const door = layout.doors.find((d) => d.room === second.id)!;
    const none = minimapShapes({ ...base, closedDoors: [door.id] });
    expect(none.rooms).toEqual([]);
    expect(none.doors).toEqual([]);
    const some = minimapShapes({
      ...base,
      seen: new Set([first.id, second.id]),
      cleared: new Set([first.id]),
      closedDoors: [door.id],
    });
    expect(some.rooms.map((r) => r.cleared)).toEqual([true, false]);
    expect(some.doors).toHaveLength(1);
  });

  it("shows the portal only once it is open, and every player", () => {
    expect(minimapShapes(base).portal).toBeNull();
    const open = minimapShapes({
      ...base,
      portalOpen: true,
      others: [{ x: 0, y: 0 }],
    });
    expect(open.portal).not.toBeNull();
    expect(open.others).toHaveLength(1);
    expect(open.me).toEqual({ x: MINIMAP.size / 2, y: MINIMAP.size / 2 });
  });
});
