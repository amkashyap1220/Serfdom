import { DEFAULT_BINDS, rebind, type KeyBinds } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { KeyTracker } from "./key-tracker";

describe("game keys follow the account's binds (D-159)", () => {
  it("a rebound key does the action, and the old key no longer does", () => {
    let binds: KeyBinds = DEFAULT_BINDS;
    const keys = new KeyTracker(() => binds);
    keys.press("KeyW");
    expect(keys.read().move.up).toBe(true);
    keys.release("KeyW");
    binds = rebind(DEFAULT_BINDS, "up", "ArrowUp");
    keys.press("KeyW");
    expect(keys.read().move.up).toBe(false);
    keys.press("ArrowUp");
    expect(keys.read().move.up).toBe(true);
    expect(keys.isBound("ArrowUp")).toBe(true);
    expect(keys.isBound("KeyW")).toBe(false);
  });

  it("a swap moves both actions; every action reads from its own key", () => {
    const binds = rebind(DEFAULT_BINDS, "ability", "KeyT");
    const keys = new KeyTracker(() => binds);
    keys.press("KeyT");
    const s = keys.read();
    expect(s.ability).toBe(true);
    expect(s.toggleFireMode).toBe(false);
    keys.release("KeyT");
    keys.press("Space");
    expect(keys.read().toggleFireMode).toBe(true);
  });

  it("fire mode and leave count once per press, however long the key is held", () => {
    const keys = new KeyTracker(() => DEFAULT_BINDS);
    keys.press("KeyT");
    keys.press("KeyT"); // the browser repeats a held key
    expect(keys.read().toggleFireMode).toBe(true);
    expect(keys.read().toggleFireMode).toBe(false);
    keys.release("KeyT");
    keys.press("KeyT");
    expect(keys.read().toggleFireMode).toBe(true);
    keys.press("KeyR");
    keys.clear();
    expect(keys.read().exitDungeon).toBe(false);
  });
});
