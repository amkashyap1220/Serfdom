import * as Phaser from "phaser";
import type { KeyBinds } from "@serfdom/shared";
import { KeyTracker, type KeyState } from "./key-tracker";

export type { KeyState };

export interface PointerInput {
  /** Mouse position on the canvas in CSS pixels, or null before it has moved over the game. */
  screen: { x: number; y: number } | null;
  /** Left mouse button held. */
  leftDown: boolean;
}

/**
 * The game keys, read from the browser by the account's binds (D-159).
 * While inactive (menus, typing) it ignores every key, so forms type
 * normally; while active it keeps bound keys from scrolling the page or
 * reaching anything else. Keys are forgotten when the window loses focus,
 * so nothing stays stuck after alt-tab.
 */
export function createKeyReader(binds: () => KeyBinds): {
  read: () => KeyState;
  setActive: (active: boolean) => void;
} {
  const keys = new KeyTracker(binds);
  let active = false;
  window.addEventListener("keydown", (e) => {
    if (!active || !keys.isBound(e.code)) return;
    e.preventDefault();
    keys.press(e.code);
  });
  window.addEventListener("keyup", (e) => {
    if (!active) return;
    keys.release(e.code);
  });
  window.addEventListener("blur", () => keys.clear());
  return {
    read: () => keys.read(),
    setActive: (on) => {
      if (on === active) return;
      active = on;
      keys.clear();
    },
  };
}

/** Tracks the mouse over the game canvas. */
export function createPointerReader(scene: Phaser.Scene): () => PointerInput {
  // Phaser reports (0, 0) before the mouse has ever moved; treat that as
  // "unknown" so auto fire does not shoot toward a corner on load.
  let seen = false;
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, () => {
    seen = true;
  });
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
    seen = true;
  });
  // Right-click is unused; stop the browser menu from covering the game.
  scene.input.mouse?.disableContextMenu();

  return () => {
    const p = scene.input.activePointer;
    return {
      screen: seen ? { x: p.x, y: p.y } : null,
      leftDown: p.leftButtonDown(),
    };
  };
}
