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
import { buildStronghold } from "./goblin-stronghold.ts";
import { buildWarrens, GOBLIN_WARRENS } from "./goblin-warrens.ts";
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

  it("doors start open, so rooms can be rushed (D-114); the empty entrance clears at once", () => {
    let progress = newRunProgress(GW);
    expect(closedDoorIds(progress, GW)).toEqual([]);
    progress = stepRooms(progress, start([[1, GW.spawn]]), GW).progress;
    expect(status(progress, "entrance")).toBe("cleared");
    expect(closedDoorIds(progress, GW)).toEqual([]);
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

  it("a gated room shuts all its doors while it fights, never on a player in a doorway (D-114)", () => {
    const i = GW.rooms.findIndex((r) => r.id === "ambush");
    const as = (status: "active" | "cleared") =>
      newRunProgress(GW).map((p, k) => (k === i ? { ...p, status } : p));
    const fighting = as("active");
    expect(closedDoorIds(fighting, GW).sort()).toEqual([
      "ambush-guard",
      "camp-ambush",
    ]);
    // The camp side of the ambush hall's door is blocked while it fights.
    const box = boxAround({ x: 2020, y: 1000 }, 16);
    const walls = blockingWalls(GW, closedDoorIds(fighting, GW));
    expect(walls.some((w) => overlaps(w, box))).toBe(true);
    expect(blockingWalls(GW, []).some((w) => overlaps(w, box))).toBe(false);
    // Someone in the doorway keeps it open until they step clear.
    const inDoor = start([[1, { x: 2030, y: 1000 }]]).players;
    expect(closedDoorIds(fighting, GW, inDoor)).toEqual(["ambush-guard"]);
    expect(closedDoorIds(as("cleared"), GW)).toEqual([]);
    expect(roomAt(GW, { x: 1320, y: 1000 })?.id).toBe("tunnel");
  });
});

describe("walking a party through the Goblin Warrens", () => {
  it("a party walks straight through, locked in only by the ambush hall; the Warlord's room completes it (D-114)", () => {
    let sim = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      GW.spawn,
    );
    sim = addPlayer(sim, 2, GW.spawn);
    let progress = newRunProgress(GW);
    const everClosed = new Set<string>();
    let completedAtX: number | null = null;
    const east = { move: { x: 1, y: 0 }, fire: { trigger: false, aim: null } };

    for (let tick = 0; tick < 60 * 40 && completedAtX === null; tick++) {
      const walls = blockingWalls(GW, closedDoorIds(progress, GW, sim.players));
      for (const id of [1, 2]) {
        sim = applyPlayerInput(sim, id, east, walls, TICK_SECONDS).state;
      }
      // Stand-in for fighting: every enemy dies as soon as it appears.
      sim = { ...sim, enemies: [] };
      const r = stepRooms(progress, sim, GW);
      progress = r.progress;
      sim = spawnEnemies(sim, r.spawns);
      for (const id of closedDoorIds(progress, GW, sim.players))
        everClosed.add(id);
      if (requiredRoomsCleared(progress, GW)) {
        completedAtX = sim.players[0]!.position.x;
      }
    }
    // Each wave dies the moment it appears, so the hall clears while the
    // party still stands in its west doorway (which never shuts on a
    // player); only its far door shut behind it.
    expect([...everClosed]).toEqual(["ambush-guard"]);
    // Complete the moment the party steps onto the throne room floor.
    expect(completedAtX).toBeGreaterThan(3460);
    expect(completedAtX).toBeLessThan(3470);
    const den = GW.rooms.findIndex((r) => r.id === "den");
    expect(progress[den]?.status).toBe("dormant");
  });

  it("retreat is free: doors never close again, even while the next room fights", () => {
    let sim = addPlayer(
      createSimState([], { respawnSeconds: null }),
      1,
      GW.spawn,
    );
    let progress = newRunProgress(GW);
    const step = (move: { x: number; y: number }, killAll: boolean) => {
      const walls = blockingWalls(GW, closedDoorIds(progress, GW));
      const input = { move, fire: { trigger: false, aim: null } };
      sim = applyPlayerInput(sim, 1, input, walls, TICK_SECONDS).state;
      if (killAll) sim = { ...sim, enemies: [] };
      const r = stepRooms(progress, sim, GW);
      progress = r.progress;
      sim = spawnEnemies(sim, r.spawns);
    };
    // East through the tunnel (cleared as it wakes) into the goblin camp.
    const at = () => sim.players[0]!.position;
    for (let t = 0; t < 60 * 15 && roomAt(GW, at())?.id !== "camp"; t++) {
      step({ x: 1, y: 0 }, true);
    }
    expect(roomAt(GW, at())?.id).toBe("camp");
    step({ x: 0, y: 0 }, false); // the camp wakes; its enemies stay alive
    expect(sim.enemies.length).toBeGreaterThan(0);
    // Back west all the way to the entrance: both doors behind stay open.
    for (let t = 0; t < 60 * 12; t++) step({ x: -1, y: 0 }, false);
    expect(closedDoorIds(progress, GW)).not.toContain("entrance-tunnel");
    expect(closedDoorIds(progress, GW)).not.toContain("tunnel-camp");
    expect(roomAt(GW, at())?.id).toBe("entrance");
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

describe("rushing and gated rooms (D-114)", () => {
  it("the portal opens once the boss room is cleared, even if every other room was rushed past", () => {
    const throne = GW.rooms.findIndex((r) => r.id === "throne");
    const onlyBoss = newRunProgress(GW).map((p, k) =>
      k === throne ? { ...p, status: "cleared" as const } : p,
    );
    expect(requiredRoomsCleared(onlyBoss, GW)).toBe(true);
    const allButBoss = newRunProgress(GW).map((p, k) =>
      k === throne ? p : { ...p, status: "cleared" as const },
    );
    expect(requiredRoomsCleared(allButBoss, GW)).toBe(false);
  });

  it("gated rooms: the Ambush hall in the Warrens; it and the Barracks in the Stronghold; every map starts with its doors open", () => {
    const gated = (build: (s: number) => typeof GW) => {
      const keys = new Set<string>();
      for (let seed = 1; seed <= 200; seed++) {
        const layout = build(seed);
        expect(closedDoorIds(newRunProgress(layout), layout)).toEqual([]);
        for (const r of layout.rooms) {
          if (r.gated) keys.add(r.id.replace(/-\d+$/, ""));
        }
      }
      return [...keys].sort();
    };
    expect(gated(buildWarrens)).toEqual(["ambush"]);
    expect(gated(buildStronghold)).toEqual(["ambush", "barracks"]);
    expect(GW.rooms.filter((r) => r.gated).map((r) => r.id)).toEqual([
      "ambush",
    ]);
  });
});
