import { DEFAULT_FIRE_MODE, FIRE_MODES, type FireMode } from "./weapon.ts";

/*
 * Player settings (D-159): saved per account, so they follow the player
 * between the browser and Steam. Keys are KeyboardEvent.code values
 * ("KeyW", "Space"), which name the physical key whatever the layout.
 */

/** Every rebindable action, in the order Settings lists them, with its default key. */
export const GAME_ACTIONS = [
  { id: "up", label: "Move up", key: "KeyW" },
  { id: "left", label: "Move left", key: "KeyA" },
  { id: "down", label: "Move down", key: "KeyS" },
  { id: "right", label: "Move right", key: "KeyD" },
  { id: "turnLeft", label: "Turn view left", key: "KeyQ" },
  { id: "turnRight", label: "Turn view right", key: "KeyE" },
  { id: "resetView", label: "Reset view", key: "KeyZ" },
  { id: "fireMode", label: "Change fire mode", key: "KeyT" },
  { id: "ability", label: "Ability", key: "Space" },
  { id: "leave", label: "Leave dungeon", key: "KeyR" },
  { id: "debug", label: "Debug readout", key: "Backquote" },
] as const;

export type ActionId = (typeof GAME_ACTIONS)[number]["id"];
export type KeyBinds = Record<ActionId, string>;

export const DEFAULT_BINDS: KeyBinds = Object.fromEntries(
  GAME_ACTIONS.map((a) => [a.id, a.key]),
) as KeyBinds;

export interface Settings {
  binds: KeyBinds;
  /** The fire mode, kept between runs; the fire mode key cycles it. */
  fireMode: FireMode;
}

export const DEFAULT_SETTINGS: Settings = {
  binds: DEFAULT_BINDS,
  fireMode: DEFAULT_FIRE_MODE,
};

/** Keys the menus keep for themselves: never bindable. */
export const RESERVED_KEYS: readonly string[] = ["Escape", "Enter"];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");

/**
 * Keys a game action may use. Left out: Escape and Enter (the menus), Tab
 * and the F keys (focus, reload, fullscreen, developer tools), and Ctrl,
 * Alt, and the OS key (browser shortcuts like Ctrl+W close the tab).
 */
const NAMED: Readonly<Record<string, string>> = {
  Space: "Space",
  Backquote: "Backtick (`)",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ArrowUp: "Up arrow",
  ArrowDown: "Down arrow",
  ArrowLeft: "Left arrow",
  ArrowRight: "Right arrow",
  ...Object.fromEntries(LETTERS.map((l) => [`Key${l}`, l])),
  ...Object.fromEntries(DIGITS.map((d) => [`Digit${d}`, d])),
  ...Object.fromEntries(DIGITS.map((d) => [`Numpad${d}`, `Num ${d}`])),
};

export function isBindableKey(code: unknown): code is string {
  return typeof code === "string" && Object.hasOwn(NAMED, code);
}

/** "W", "Space", "Left Shift", "Num 1"; an unknown code as itself. */
export function keyName(code: string): string {
  return NAMED[code] ?? code;
}

/** The action using this key, if any. */
export function actionOnKey(binds: KeyBinds, code: string): ActionId | null {
  return GAME_ACTIONS.find((a) => binds[a.id] === code)?.id ?? null;
}

/**
 * Binds `action` to `code`. If another action had that key, the two swap
 * (D-159), so no key ever holds two actions.
 */
export function rebind(
  binds: KeyBinds,
  action: ActionId,
  code: string,
): KeyBinds {
  const other = actionOnKey(binds, code);
  const next = { ...binds, [action]: code };
  if (other && other !== action) next[other] = binds[action];
  return next;
}

/** Every action has a bindable key and no key is used twice. */
export function isValidBinds(v: unknown): v is KeyBinds {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== GAME_ACTIONS.length) return false;
  const used = new Set<string>();
  for (const a of GAME_ACTIONS) {
    const code = (v as Record<string, unknown>)[a.id];
    if (!isBindableKey(code) || used.has(code)) return false;
    used.add(code);
  }
  return true;
}

/** Strictly checked settings from a client; null if anything is wrong. */
export function parseSettings(v: unknown): Settings | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== 2) return null;
  if (!isValidBinds(o.binds)) return null;
  if (!(FIRE_MODES as readonly unknown[]).includes(o.fireMode)) return null;
  return {
    binds: { ...(o.binds as KeyBinds) },
    fireMode: o.fireMode as FireMode,
  };
}

/**
 * Settings as stored, made whole: a missing or broken part (older saves,
 * settings added later) falls back to its default instead of failing.
 */
export function settingsOrDefaults(v: unknown): Settings {
  const o =
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  return {
    binds: isValidBinds(o.binds) ? { ...o.binds } : { ...DEFAULT_BINDS },
    fireMode: (FIRE_MODES as readonly unknown[]).includes(o.fireMode)
      ? (o.fireMode as FireMode)
      : DEFAULT_FIRE_MODE,
  };
}
