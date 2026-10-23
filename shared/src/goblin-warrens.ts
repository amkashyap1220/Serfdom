import {
  wallsAroundRooms,
  type DoorDef,
  type DungeonLayout,
  type EnemySpawnDef,
  type RoomDef,
} from "./dungeon-layout.ts";
import type { EnemyKind } from "./enemy-config.ts";

/*
 * Goblin Warrens v0 (T-029, Phase 6b). PROVISIONAL layout and encounter
 * counts by Claude (design delegated by the user, D-047), aimed at a
 * ~5-minute solo clear once the boss exists (6c); tuned in 6d.
 *
 * Mostly linear west → east along y ≈ 1000, one optional side room:
 *
 *                          [den]
 *                            |
 *  [entrance]-[  tunnel  ]-[camp]-[ambush hall]-[guard]-[throne]
 *
 * Doors are 64 px gaps in the 32 px walls, centered on y = 1000 (the den's
 * on the camp's north wall). Each door opens when the room it belongs to
 * (the one before it) is cleared. The Goblin Warlord waits in the throne
 * room; when it dies the exit portal opens where it stood, and each player
 * completes by stepping into it (D-057).
 *
 * Solo HP on the way (6c): tunnel 750, camp 1630, ambush 3050 (two waves),
 * guard 2360, Warlord 4500 → 12290 required; den 820 optional.
 */

const DOOR = 64;
const DOOR_Y = 1000 - DOOR / 2;

const spawns = (kind: EnemyKind, points: [number, number][]): EnemySpawnDef[] =>
  points.map(([x, y]) => ({ kind, at: { x, y } }));

const rooms: RoomDef[] = [
  {
    id: "entrance",
    name: "Entrance cave",
    bounds: { x: 100, y: 800, width: 400, height: 400 },
    waves: [],
    required: true,
  },
  {
    id: "tunnel",
    name: "Tunnel",
    bounds: { x: 532, y: 920, width: 800, height: 160 },
    waves: [
      spawns("grunt", [
        [950, 970],
        [1000, 1030],
        [1100, 1000],
        [1200, 960],
        [1250, 1040],
      ]),
    ],
    required: true,
  },
  {
    id: "camp",
    name: "Goblin camp",
    bounds: { x: 1364, y: 760, width: 640, height: 480 },
    waves: [
      [
        ...spawns("grunt", [
          [1600, 900],
          [1650, 1100],
          [1700, 1000],
          [1750, 1000],
          [1800, 850],
          [1800, 1150],
        ]),
        ...spawns("slinger", [
          [1950, 850],
          [1950, 1000],
          [1950, 1150],
        ]),
        ...spawns("brute", [[1880, 1000]]),
      ],
    ],
    required: true,
  },
  {
    id: "den",
    name: "Side den",
    bounds: { x: 1524, y: 408, width: 320, height: 320 },
    waves: [
      [
        ...spawns("grunt", [
          [1600, 500],
          [1760, 500],
          [1600, 650],
          [1760, 650],
        ]),
        ...spawns("slinger", [
          [1560, 450],
          [1810, 450],
        ]),
      ],
    ],
    required: false,
  },
  {
    id: "ambush",
    name: "Ambush hall",
    bounds: { x: 2036, y: 700, width: 720, height: 600 },
    waves: [
      [
        ...spawns("grunt", [
          [2300, 800],
          [2300, 1200],
          [2500, 750],
          [2500, 1250],
          [2650, 900],
          [2650, 1100],
        ]),
        ...spawns("slinger", [
          [2700, 800],
          [2700, 1200],
        ]),
      ],
      [
        // The second wave also comes from behind, near the entry door.
        ...spawns("grunt", [
          [2100, 760],
          [2100, 1240],
          [2400, 760],
          [2400, 1240],
          [2500, 1000],
          [2600, 1000],
          [2700, 760],
          [2700, 1240],
        ]),
        ...spawns("slinger", [
          [2720, 1000],
          [2720, 780],
          [2720, 1220],
        ]),
        ...spawns("brute", [[2650, 1000]]),
      ],
    ],
    required: true,
  },
  {
    id: "guard",
    name: "Guard room",
    bounds: { x: 2788, y: 800, width: 640, height: 400 },
    waves: [
      [
        ...spawns("grunt", [
          [3000, 900],
          [3000, 1100],
          [3050, 1000],
          [3100, 1000],
          [3150, 850],
          [3150, 1150],
        ]),
        ...spawns("slinger", [
          [3300, 900],
          [3300, 1100],
          [3380, 850],
          [3380, 950],
          [3380, 1050],
          [3380, 1150],
        ]),
        ...spawns("brute", [
          [3220, 900],
          [3220, 1100],
        ]),
      ],
    ],
    required: true,
  },
  {
    id: "throne",
    name: "Warlord's throne",
    bounds: { x: 3460, y: 700, width: 640, height: 600 },
    waves: [spawns("warlord", [[3780, 1000]])],
    required: true,
  },
];

/** An east-west door in the wall just east of x = `wallX`. */
const eastDoor = (id: string, wallX: number, room: string): DoorDef => ({
  id,
  rect: { x: wallX, y: DOOR_Y, width: 32, height: DOOR },
  room,
});

const doors: DoorDef[] = [
  eastDoor("entrance-tunnel", 500, "entrance"),
  eastDoor("tunnel-camp", 1332, "tunnel"),
  {
    id: "camp-den",
    rect: { x: 1684 - DOOR / 2, y: 728, width: DOOR, height: 32 },
    room: "camp",
  },
  eastDoor("camp-ambush", 2004, "camp"),
  eastDoor("ambush-guard", 2756, "ambush"),
  eastDoor("guard-throne", 3428, "guard"),
];

export const GOBLIN_WARRENS: DungeonLayout = {
  world: { width: 4200, height: 1400 },
  walls: wallsAroundRooms(rooms, doors),
  spawn: { x: 300, y: 1000 },
  rooms,
  doors,
  exitPortal: { x: 3780, y: 1000 },
};
