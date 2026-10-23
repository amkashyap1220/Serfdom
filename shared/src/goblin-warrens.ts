import {
  OPPOSITE,
  pieceHp,
  RoomAssembly,
  type RoomPiece,
  type Side,
} from "./dungeon-gen.ts";
import {
  validateLayout,
  wallsAroundRooms,
  type DoorDef,
  type DungeonLayout,
  type EnemySpawnDef,
  type RoomDef,
} from "./dungeon-layout.ts";
import type { EnemyKind } from "./enemy-config.ts";
import { pick, randomInt, seededRandom, shuffled } from "./seeded-random.ts";

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
 * Solo HP on the way (6d tuning): tunnel 850, camp 1845, ambush 3455 (two
 * waves), guard 2670, Warlord 5000 → 13820 required; den 930 optional.
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

/*
 * Procedural Warrens (D-104, Phase 11a). Every run builds its own Warrens
 * from the rooms above, used as pieces, under these rules:
 * - Entrance first, the Warlord's throne last (portal where the Warlord
 *   stands); each door opens when the room before it is cleared.
 * - Main path: 4 combat rooms ramping light → medium → medium → heavy, with
 *   12,500–15,000 solo HP required, Warlord included (3–5 min, D-047).
 * - The path runs east, north, or south; it never turns back west.
 * - 0–2 optional side rooms (light or medium) branch off combat rooms.
 * Seed 0 is the handcrafted layout above, kept as a fixed fixture.
 */

export type RoomBand = "light" | "medium" | "heavy";

export const WARRENS_RULES = {
  mainPath: ["light", "medium", "medium", "heavy"] as readonly RoomBand[],
  requiredHp: { min: 12_500, max: 15_000 },
  sideRooms: { min: 0, max: 2 },
  sideBands: ["light", "medium"] as readonly RoomBand[],
  /** Main-path turns: east twice as likely as north or south. */
  turnWeights: { east: 2, north: 1, south: 1 },
} as const;

const asPiece = (id: string, name?: string): RoomPiece => {
  const room = rooms.find((r) => r.id === id);
  if (!room) throw new RangeError(`no Warrens room ${id}`);
  const { x, y, width, height } = room.bounds;
  return {
    key: id,
    name: name ?? room.name,
    width,
    height,
    waves: room.waves.map((wave) =>
      wave.map((s) => ({ kind: s.kind, at: { x: s.at.x - x, y: s.at.y - y } })),
    ),
  };
};

const ENTRANCE = asPiece("entrance");
const THRONE = asPiece("throne");

/**
 * The combat pieces and their bands. The Guard room counts as medium
 * (PROVISIONAL, D-104): with it as heavy no main path reached the HP band.
 */
export const WARRENS_PIECES: readonly { piece: RoomPiece; band: RoomBand }[] = [
  { piece: asPiece("tunnel"), band: "light" },
  { piece: asPiece("camp"), band: "medium" },
  { piece: asPiece("den", "Goblin den"), band: "medium" },
  { piece: asPiece("guard"), band: "medium" },
  { piece: asPiece("ambush"), band: "heavy" },
];

const ofBand = (band: RoomBand) =>
  WARRENS_PIECES.filter((p) => p.band === band).map((p) => p.piece);

/** Whole-layout attempts before falling back (never expected; tested). */
const ATTEMPTS = 50;

/** The Goblin Warrens for `seed`: the same seed always builds the same map. */
export function buildWarrens(seed: number): DungeonLayout {
  if (seed === 0) return GOBLIN_WARRENS;
  const random = seededRandom(seed);
  for (let i = 0; i < ATTEMPTS; i++) {
    const layout = tryWarrens(random);
    if (layout && validateLayout(layout).length === 0) return layout;
  }
  return GOBLIN_WARRENS;
}

/** Combat rooms for the main path, in order, within the HP band. */
function mainPathPieces(random: () => number): RoomPiece[] {
  for (let tries = 0; tries < 1000; tries++) {
    const used = new Set<string>();
    const chosen = WARRENS_RULES.mainPath.map((band) => {
      const piece = pick(
        random,
        ofBand(band).filter((p) => !used.has(p.key)),
      );
      used.add(piece.key);
      return piece;
    });
    const hp = [...chosen, THRONE].reduce((sum, p) => sum + pieceHp(p), 0);
    const { min, max } = WARRENS_RULES.requiredHp;
    if (hp >= min && hp <= max) return chosen;
  }
  throw new Error("no Warrens main path fits the HP band: check the pieces");
}

/** Sides to try for the next main-path room, by weight, never west. */
function turnOrder(random: () => number, previous: Side | null): Side[] {
  const pool = (["east", "north", "south"] as const).filter(
    (s) => previous === null || s !== OPPOSITE[previous],
  );
  const order: Side[] = [];
  const left = [...pool];
  while (left.length > 0) {
    const total = left.reduce((n, s) => n + WARRENS_RULES.turnWeights[s], 0);
    let roll = random() * total;
    const i = left.findIndex((s) => (roll -= WARRENS_RULES.turnWeights[s]) < 0);
    order.push(...left.splice(i < 0 ? left.length - 1 : i, 1));
  }
  return order;
}

function tryWarrens(random: () => number): DungeonLayout | null {
  const build = new RoomAssembly(ENTRANCE, "entrance", random);
  const ids = new Set(["entrance"]);
  const uniqueId = (key: string) => {
    let id = key;
    for (let n = 2; ids.has(id); n++) id = `${key}-${n}`;
    ids.add(id);
    return id;
  };

  let at = 0;
  let previous: Side | null = null;
  const combat: number[] = [];
  for (const piece of [...mainPathPieces(random), THRONE]) {
    const id = piece === THRONE ? "throne" : uniqueId(piece.key);
    let next: number | null = null;
    for (const side of turnOrder(random, previous)) {
      next = build.attach(at, side, piece, id, true);
      if (next !== null) {
        previous = side;
        break;
      }
    }
    if (next === null) return null;
    if (piece !== THRONE) combat.push(next);
    at = next;
  }
  const throne = at;

  const { min, max } = WARRENS_RULES.sideRooms;
  const sidePool = WARRENS_RULES.sideBands.flatMap(ofBand);
  const count = randomInt(random, min, max);
  for (let n = 0; n < count; n++) {
    const piece = pick(random, sidePool);
    const id = uniqueId(piece.key);
    placing: for (const parent of shuffled(random, combat)) {
      const sides = build.freeSides(parent).filter((s) => s !== "west");
      for (const side of shuffled(random, sides)) {
        if (build.attach(parent, side, piece, id, false) !== null)
          break placing;
      }
    }
  }
  return build.finish(throne);
}
