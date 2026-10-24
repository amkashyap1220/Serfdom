/**
 * Image sprites (the first real art; everything else is still placeholder
 * squares). A sprite file lives at
 * `src/assets/sprites/<character>/<state>/<direction>.png`, one 8-direction
 * export per state, and is loaded under the key
 * `sprite-<character>-<state>-<direction>` (see sprite-files.ts).
 */

/** The 8 facings, in the order their screen angle increases (y points down). */
export const DIRECTIONS = [
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
] as const;

export type Direction = (typeof DIRECTIONS)[number];

/** The texture key of one sprite image. */
export function spriteKey(
  character: string,
  state: string,
  direction: Direction,
): string {
  return `sprite-${character}-${state}-${direction}`;
}

const SPRITE_PATH = /sprites\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z-]+)\.png$/;

/**
 * The texture key for a sprite file's path, or undefined when the path is
 * not `<character>/<state>/<direction>.png` with a known direction (so a
 * misnamed file fails loudly instead of loading under a key nobody uses).
 */
export function spriteKeyFromPath(path: string): string | undefined {
  const match = SPRITE_PATH.exec(path);
  if (!match) return undefined;
  const [, character, state, direction] = match;
  if (!DIRECTIONS.includes(direction as Direction)) return undefined;
  return spriteKey(character!, state!, direction as Direction);
}

/**
 * The nearest of the 8 directions to a screen angle in radians (0 is east,
 * a quarter turn is south because screen y points down).
 */
export function directionFromAngle(angle: number): Direction {
  const step = Math.PI / 4;
  const index = ((Math.round(angle / step) % 8) + 8) % 8;
  return DIRECTIONS[index]!;
}
