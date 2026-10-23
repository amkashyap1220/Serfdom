import {
  OPPOSITE,
  pieceHp,
  RoomAssembly,
  type RoomPiece,
  type Side,
} from "./dungeon-gen.ts";
import {
  validateLayout,
  type DungeonLayout,
  type EnemySpawnDef,
} from "./dungeon-layout.ts";
import { ENEMY_STATS } from "./enemy-config.ts";
import { pick, randomInt, seededRandom, shuffled } from "./seeded-random.ts";

/*
 * The rules that turn a seed into a dungeon (D-104, D-108): which pieces,
 * in which order and strength, how far the path may turn, how many side
 * rooms. The Warrens and the Stronghold are each one recipe.
 */

export type RoomBand = "light" | "medium" | "heavy";

export type Waves = readonly (readonly EnemySpawnDef[])[];

/** One combat room of a pool: its band and its enemy setups (D-105). */
export interface RecipePiece {
  piece: RoomPiece;
  band: RoomBand;
  /** Each run picks one. */
  setups: readonly Waves[];
}

export interface DungeonRecipe {
  /** Name for errors only. */
  name: string;
  entrance: RoomPiece;
  /** The boss room: last on the main path; the portal opens at its centre. */
  boss: RoomPiece;
  pieces: readonly RecipePiece[];
  /** Combat rooms between the entrance and the boss, by band. */
  mainPath: readonly RoomBand[];
  /** Solo enemy HP the main path requires, boss included. */
  requiredHp: { min: number; max: number };
  sideRooms: { min: number; max: number };
  sideBands: readonly RoomBand[];
  /** Main-path turns; never west. */
  turnWeights: Readonly<Record<"east" | "north" | "south", number>>;
  /** The seed-0 layout and the fallback; generated from seed 1 if absent. */
  fixed?: DungeonLayout;
}

/** Whole-layout attempts before falling back (never expected; tested). */
const ATTEMPTS = 50;

/** The dungeon for `seed`: the same seed always builds the same map. */
export function buildFromRecipe(
  recipe: DungeonRecipe,
  seed: number,
): DungeonLayout {
  if (seed === 0) return recipe.fixed ?? buildFromRecipe(recipe, 1);
  const random = seededRandom(seed);
  for (let i = 0; i < ATTEMPTS; i++) {
    const layout = tryRecipe(recipe, random);
    if (layout && validateLayout(layout).length === 0) return layout;
  }
  if (recipe.fixed) return recipe.fixed;
  throw new Error(`${recipe.name}: no valid layout for seed ${seed}`);
}

const ofBand = (recipe: DungeonRecipe, band: RoomBand) =>
  recipe.pieces.filter((p) => p.band === band);

/** The piece with one of its setups, chosen for this run. */
const withSetup = (random: () => number, entry: RecipePiece): RoomPiece => ({
  ...entry.piece,
  waves: pick(random, entry.setups),
});

/** Combat rooms for the main path, in order, within the HP band. */
function mainPathPieces(
  recipe: DungeonRecipe,
  random: () => number,
): RoomPiece[] {
  for (let tries = 0; tries < 1000; tries++) {
    const used = new Set<string>();
    const chosen = recipe.mainPath.map((band) => {
      const entry = pick(
        random,
        ofBand(recipe, band).filter((p) => !used.has(p.piece.key)),
      );
      used.add(entry.piece.key);
      return withSetup(random, entry);
    });
    const hp = [...chosen, recipe.boss].reduce((sum, p) => sum + pieceHp(p), 0);
    const { min, max } = recipe.requiredHp;
    if (hp >= min && hp <= max) return chosen;
  }
  throw new Error(`${recipe.name}: no main path fits the HP band`);
}

/** Sides to try for the next main-path room, by weight, never west. */
function turnOrder(
  recipe: DungeonRecipe,
  random: () => number,
  previous: Side | null,
): Side[] {
  const weights = recipe.turnWeights;
  const left = (["east", "north", "south"] as const).filter(
    (s) => previous === null || s !== OPPOSITE[previous],
  );
  const order: Side[] = [];
  while (left.length > 0) {
    const total = left.reduce((n, s) => n + weights[s], 0);
    let roll = random() * total;
    const i = left.findIndex((s) => (roll -= weights[s]) < 0);
    order.push(...left.splice(i < 0 ? left.length - 1 : i, 1));
  }
  return order;
}

function tryRecipe(
  recipe: DungeonRecipe,
  random: () => number,
): DungeonLayout | null {
  const build = new RoomAssembly(recipe.entrance, "entrance", random);
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
  for (const piece of [...mainPathPieces(recipe, random), recipe.boss]) {
    const boss = piece === recipe.boss;
    const id = boss ? "throne" : uniqueId(piece.key);
    let next: number | null = null;
    for (const side of turnOrder(recipe, random, previous)) {
      next = build.attach(at, side, piece, id, true);
      if (next !== null) {
        previous = side;
        break;
      }
    }
    if (next === null) return null;
    if (!boss) combat.push(next);
    at = next;
  }
  const bossRoom = at;

  const { min, max } = recipe.sideRooms;
  const sidePool = recipe.sideBands.flatMap((band) => ofBand(recipe, band));
  const count = randomInt(random, min, max);
  for (let n = 0; n < count; n++) {
    const piece = withSetup(random, pick(random, sidePool));
    const id = uniqueId(piece.key);
    placing: for (const parent of shuffled(random, combat)) {
      const sides = build.freeSides(parent).filter((s) => s !== "west");
      for (const side of shuffled(random, sides)) {
        if (build.attach(parent, side, piece, id, false) !== null)
          break placing;
      }
    }
  }
  return build.finish(bossRoom);
}

/**
 * Two setups of one room played together, wave by wave (the Stronghold's
 * denser rooms, D-108). A spawn that would overlap one already placed is
 * nudged to the nearest free spot inside the room, so no two enemies start
 * on top of each other.
 */
export function combineSetups(
  piece: Pick<RoomPiece, "width" | "height">,
  a: Waves,
  b: Waves,
): EnemySpawnDef[][] {
  const waves = Math.max(a.length, b.length);
  const out: EnemySpawnDef[][] = [];
  for (let w = 0; w < waves; w++) {
    const placed: EnemySpawnDef[] = [...(a[w] ?? [])];
    for (const s of b[w] ?? []) placed.push(freeSpot(piece, placed, s));
    out.push(placed);
  }
  return out;
}

function freeSpot(
  piece: Pick<RoomPiece, "width" | "height">,
  placed: readonly EnemySpawnDef[],
  s: EnemySpawnDef,
): EnemySpawnDef {
  const half = ENEMY_STATS[s.kind].size / 2;
  const clear = (x: number, y: number) =>
    x - half >= 0 &&
    y - half >= 0 &&
    x + half <= piece.width &&
    y + half <= piece.height &&
    placed.every((p) => {
      const gap = (ENEMY_STATS[p.kind].size / 2 + half) * 1.5;
      return Math.abs(p.at.x - x) >= gap || Math.abs(p.at.y - y) >= gap;
    });
  for (let r = 0; r <= 120; r += 12) {
    for (const [dx, dy] of [
      [0, 0],
      [0, r],
      [0, -r],
      [r, 0],
      [-r, 0],
      [r, r],
      [-r, -r],
      [r, -r],
      [-r, r],
    ] as const) {
      if (clear(s.at.x + dx, s.at.y + dy)) {
        return { kind: s.kind, at: { x: s.at.x + dx, y: s.at.y + dy } };
      }
    }
  }
  throw new Error(`no free spot near ${s.at.x},${s.at.y}`);
}
