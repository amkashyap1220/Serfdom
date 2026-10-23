import { describe, expect, it } from "vitest";
import { boxAround } from "./collision.ts";
import { overlaps } from "./enemy-ai.ts";
import {
  roomAt,
  validateLayout,
  wallsAroundRooms,
  type DungeonLayout,
  type RoomDef,
} from "./dungeon-layout.ts";
import {
  blockingWalls,
  closedDoorIds,
  requiredRoomsCleared,
  newRunProgress,
  stepRooms,
  type RunProgress,
} from "./dungeon-run.ts";
import { DUNGEONS, entryProblem, INTRO_DUNGEON } from "./dungeons.ts";
import { GOBLIN_WARRENS } from "./goblin-warrens.ts";
import { PLAYER_BODY, TICK_SECONDS } from "./movement-config.ts";
import {
  addPlayer,
  applyPlayerInput,
  createSimState,
  removePlayer,
  spawnEnemies,
  type SimState,
} from "./sim.ts";

const GW = GOBLIN_WARRENS;

describe("dungeon layouts", () => {
  it.each(DUNGEONS.map((d) => [d.id, d.layout] as const))(
    "%s passes the structural checks",
    (_id, layout) => {
      expect(validateLayout(layout)).toEqual([]);
    },
  );

  it("Goblin Warrens: spawn in the entrance, rooms in the intended order", () => {
    expect(roomAt(GW, GW.spawn)?.id).toBe("entrance");
    expect(GW.rooms.map((r) => r.id)).toEqual([
      "entrance",
      "tunnel",
      "camp",
      "den",
      "ambush",
      "guard",
      "throne",
    ]);
    expect(GW.rooms.find((r) => r.id === "den")?.required).toBe(false);
  });

  it("walls leave exactly the door gaps open", () => {
    for (const door of GW.doors) {
      expect(GW.walls.some((w) => overlaps(w, door.rect))).toBe(false);
    }
    // ...and a player-sized box fits through a door gap.
    const door = GW.doors[0]!;
    expect(door.rect.height).toBeGreaterThan(PLAYER_BODY.height);
  });

  it("generated walls are kept once where rooms share them", () => {
    const a: RoomDef = {
      id: "a",
      name: "A",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      waves: [],
      required: true,
    };
    const b: RoomDef = {
      ...a,
      id: "b",
      bounds: { x: 132, y: 0, width: 100, height: 100 },
    };
    const walls = wallsAroundRooms([a, b], []);
    const keys = walls.map((w) => `${w.x},${w.y},${w.width},${w.height}`);
    expect(new Set(keys).size).toBe(keys.length);
    // a's right wall and b's left wall are the same rectangle: 7, not 8.
    expect(walls.length).toBe(7);
  });

  it("catches broken layouts", () => {
    const broken: DungeonLayout = {
      ...GW,
      spawn: { x: 10, y: 10 },
      doors: GW.doors.filter((d) => d.id !== "ambush-guard"),
    };
    const problems = validateLayout(broken);
    expect(problems).toContain("spawn is not inside a room");

    const deadlock: DungeonLayout = {
      ...GW,
      // The tunnel door is opened by the camp, which is behind it.
      doors: GW.doors.map((d) =>
        d.id === "tunnel-camp" ? { ...d, room: "camp" } : d,
      ),
    };
    expect(validateLayout(deadlock)).toContain("room camp is unreachable");
  });
});

describe("room progress", () => {
  const start = (players: [number, { x: number; y: number }][]): SimState => {
    let s = createSimState([], { respawnSeconds: null });
    for (const [id, at] of players) s = addPlayer(s, id, at);
    return s;
  };
  const status = (p: RunProgress, id: string) =>
    p[GW.rooms.findIndex((r) => r.id === id)]?.status;

  it("the empty entrance clears at once and opens its door", () => {
    let progress = newRunProgress(GW);
    expect(closedDoorIds(progress, GW)).toContain("entrance-tunnel");
    progress = stepRooms(progress, start([[1, GW.spawn]]), GW).progress;
    expect(status(progress, "entrance")).toBe("cleared");
    expect(closedDoorIds(progress, GW)).not.toContain("entrance-tunnel");
    expect(closedDoorIds(progress, GW)).toContain("tunnel-camp");
  });

  it("a room wakes when a player enters, spawning its first wave for that room", () => {
    const r = stepRooms(
      newRunProgress(GW),
      start([[1, { x: 600, y: 1000 }]]),
      GW,
    );
    expect(status(r.progress, "tunnel")).toBe("active");
    expect(r.spawns).toHaveLength(5);
    expect(
      r.spawns.every((s) => s.kind === "grunt" && s.roomId === "tunnel"),
    ).toBe(true);
    expect(r.events).toContainEqual({ type: "roomWoke", roomId: "tunnel" });
  });

  it("dead players do not wake rooms", () => {
    let s = start([[1, { x: 600, y: 1000 }]]);
    s = { ...s, players: s.players.map((p) => ({ ...p, hp: 0 })) };
    expect(stepRooms(newRunProgress(GW), s, GW).spawns).toEqual([]);
  });

  it("waves follow one another, then the room clears and its door opens", () => {
    const at = { x: 2400, y: 1000 }; // ambush hall
    let sim = start([[1, at]]);
    let progress = newRunProgress(GW);
    const step = () => {
      const r = stepRooms(progress, sim, GW);
      progress = r.progress;
      sim = spawnEnemies(sim, r.spawns);
      return r;
    };
    expect(step().spawns).toHaveLength(8); // wave 0
    expect(step().spawns).toEqual([]); // still alive
    sim = { ...sim, enemies: sim.enemies.map((e) => ({ ...e, hp: 0 })) };
    expect(step().spawns).toHaveLength(12); // wave 1
    expect(status(progress, "ambush")).toBe("active");
    sim = { ...sim, enemies: sim.enemies.map((e) => ({ ...e, hp: 0 })) };
    expect(step().events).toContainEqual({
      type: "roomCleared",
      roomId: "ambush",
    });
    expect(closedDoorIds(progress, GW)).not.toContain("ambush-guard");
  });

  it("closed doors block movement; open ones do not", () => {
    const before = { x: 1320, y: 1000 }; // tunnel, next to the camp door
    const progress = newRunProgress(GW);
    const blocked = blockingWalls(GW, closedDoorIds(progress, GW));
    const box = boxAround({ x: 1348, y: 1000 }, 16);
    expect(blocked.some((w) => overlaps(w, box))).toBe(true);
    expect(blockingWalls(GW, []).some((w) => overlaps(w, box))).toBe(false);
    expect(roomAt(GW, before)?.id).toBe("tunnel");
  });
});

describe("walking a party through the Goblin Warrens", () => {
  it("doors open in order and the run completes on reaching the throne; the den is optional", () => {
    let sim = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      GW.spawn,
    );
    sim = addPlayer(sim, 2, GW.spawn);
    let progress = newRunProgress(GW);
    const opened: string[] = [];
    let completedAtX: number | null = null;
    const east = { move: { x: 1, y: 0 }, fire: { trigger: false, aim: null } };

    for (let tick = 0; tick < 60 * 40 && completedAtX === null; tick++) {
      const before = closedDoorIds(progress, GW);
      const walls = blockingWalls(GW, before);
      for (const id of [1, 2]) {
        sim = applyPlayerInput(sim, id, east, walls, TICK_SECONDS).state;
      }
      // Stand-in for fighting: every enemy dies as soon as it appears.
      sim = { ...sim, enemies: [] };
      const r = stepRooms(progress, sim, GW);
      progress = r.progress;
      sim = spawnEnemies(sim, r.spawns);
      for (const id of before) {
        if (!closedDoorIds(progress, GW).includes(id)) opened.push(id);
      }
      if (requiredRoomsCleared(progress, GW)) {
        completedAtX = sim.players[0]!.position.x;
      }
    }
    expect(opened).toEqual([
      "entrance-tunnel",
      "tunnel-camp",
      "camp-den",
      "camp-ambush",
      "ambush-guard",
      "guard-throne",
    ]);
    // Complete the moment the party steps onto the throne room floor.
    expect(completedAtX).toBeGreaterThan(3460);
    expect(completedAtX).toBeLessThan(3470);
    const den = GW.rooms.findIndex((r) => r.id === "den");
    expect(progress[den]?.status).toBe("dormant");
  });

  it("a party member who leaves does not block progress", () => {
    let sim = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      GW.spawn,
    );
    sim = addPlayer(sim, 2, GW.spawn);
    sim = removePlayer(sim, 2);
    const r = stepRooms(newRunProgress(GW), sim, GW);
    expect(closedDoorIds(r.progress, GW)).not.toContain("entrance-tunnel");
  });
});

describe("dungeon entry (D-107)", () => {
  it("the Goblin Warrens is open to every serf, at any level", () => {
    expect(INTRO_DUNGEON).toBe("goblin-warrens");
    expect(entryProblem("goblin-warrens", 0)).toBeNull();
    expect(entryProblem("goblin-warrens", 40)).toBeNull();
  });

  it("every other dungeon opens once the serf has completed the Warrens", () => {
    // The Training Yard stands in for a second dungeon here.
    expect(entryProblem("training", 0)).toBe(
      "Complete the Goblin Warrens first.",
    );
    expect(entryProblem("training", 1)).toBeNull();
  });
});
