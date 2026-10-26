import { describe, expect, it } from "vitest";
import {
  actionOnKey,
  DEFAULT_BINDS,
  DEFAULT_SETTINGS,
  GAME_ACTIONS,
  isBindableKey,
  isValidBinds,
  keyName,
  parseSettings,
  rebind,
  RESERVED_KEYS,
  settingsOrDefaults,
} from "./settings.ts";

describe("settings (D-159)", () => {
  it("the defaults are today's keys, each used once", () => {
    expect(DEFAULT_BINDS).toMatchObject({
      up: "KeyW",
      fireMode: "KeyT",
      ability: "Space",
      leave: "KeyR",
      debug: "Backquote",
    });
    expect(isValidBinds(DEFAULT_BINDS)).toBe(true);
    expect(DEFAULT_SETTINGS.fireMode).toBe("fullAuto");
  });

  it("names keys for people; the menus' keys and browser keys cannot be bound", () => {
    expect(keyName("KeyW")).toBe("W");
    expect(keyName("Space")).toBe("Space");
    expect(keyName("ShiftLeft")).toBe("Left Shift");
    expect(keyName("Numpad4")).toBe("Num 4");
    for (const code of [
      ...RESERVED_KEYS,
      "Tab",
      "F5",
      "F11",
      "ControlLeft",
      "AltLeft",
      "MetaLeft",
    ]) {
      expect(isBindableKey(code), code).toBe(false);
    }
    expect(isBindableKey("ArrowUp")).toBe(true);
  });

  it("taking a key in use swaps the two, so no key holds two actions", () => {
    const swapped = rebind(DEFAULT_BINDS, "up", "KeyT");
    expect(swapped.up).toBe("KeyT");
    expect(swapped.fireMode).toBe("KeyW");
    expect(isValidBinds(swapped)).toBe(true);
    const free = rebind(DEFAULT_BINDS, "ability", "KeyF");
    expect(free.ability).toBe("KeyF");
    expect(actionOnKey(free, "Space")).toBeNull();
    // Every action onto every other action's key stays valid.
    for (const a of GAME_ACTIONS) {
      for (const b of GAME_ACTIONS) {
        expect(
          isValidBinds(rebind(DEFAULT_BINDS, a.id, DEFAULT_BINDS[b.id])),
        ).toBe(true);
      }
    }
  });

  it("refuses broken settings from a client, but fills in broken stored ones", () => {
    expect(parseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    const twice = { ...DEFAULT_BINDS, left: "KeyW" };
    expect(parseSettings({ ...DEFAULT_SETTINGS, binds: twice })).toBeNull();
    expect(
      parseSettings({
        ...DEFAULT_SETTINGS,
        binds: { ...DEFAULT_BINDS, up: "Escape" },
      }),
    ).toBeNull();
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, fireMode: "turbo" }),
    ).toBeNull();
    expect(parseSettings({ ...DEFAULT_SETTINGS, extra: 1 })).toBeNull();
    const missing: Record<string, string> = { ...DEFAULT_BINDS };
    delete missing.debug;
    expect(isValidBinds(missing)).toBe(false);
    expect(settingsOrDefaults(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsOrDefaults({ fireMode: "manual", binds: twice })).toEqual({
      ...DEFAULT_SETTINGS,
      fireMode: "manual",
    });
  });
});

describe("first-run hints in settings (D-159)", () => {
  it("are on, and none seen, by default; seen ones must be known and once each", () => {
    expect(DEFAULT_SETTINGS.hints).toBe(true);
    expect(DEFAULT_SETTINGS.seenHints).toEqual([]);
    const seen = { ...DEFAULT_SETTINGS, seenHints: ["welcome", "move"] };
    expect(parseSettings(seen)).toEqual(seen);
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, seenHints: ["welcome", "welcome"] }),
    ).toBeNull();
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, seenHints: ["secret"] }),
    ).toBeNull();
    expect(parseSettings({ ...DEFAULT_SETTINGS, hints: "yes" })).toBeNull();
    // Older saves without hints read as hints on, none seen.
    expect(
      settingsOrDefaults({ binds: DEFAULT_BINDS, fireMode: "manual" }),
    ).toMatchObject({
      hints: true,
      seenHints: [],
    });
  });
});
