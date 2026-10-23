import * as Phaser from "phaser";
import type { MoveInput } from "@serfdom/shared";
import type { RotateInput } from "./camera-math";

export interface KeyState {
  move: MoveInput;
  rotate: RotateInput;
  /** T was pressed this frame (cycle fire mode, D-034; key PROVISIONAL). */
  toggleFireMode: boolean;
  /** Space held (ability, D-035; no effect yet). */
  ability: boolean;
  /** R pressed this frame (leave the dungeon at once, D-036). */
  exitDungeon: boolean;
}

export interface PointerInput {
  /** Mouse position on the canvas in CSS pixels, or null before it has moved over the game. */
  screen: { x: number; y: number } | null;
  /** Left mouse button held. */
  leftDown: boolean;
}

/**
 * Binds W/A/S/D for movement (D-031; arrow keys intentionally unbound),
 * Q/E/Z for view rotation (D-040; Z reset is PROVISIONAL), T for fire mode,
 * Space for the ability, and R to exit the dungeon. Menus are DOM screens
 * with their own keys (screens.ts). Returns a function that reads the keys now.
 * Phaser releases all keys when the window loses focus, so nothing can get
 * stuck after alt-tab.
 */
export function createKeyReader(scene: Phaser.Scene): () => KeyState {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    throw new Error("Keyboard input is not available in this scene");
  }
  const { W, A, S, D, Q, E, Z, T, R, SPACE } = Phaser.Input.Keyboard.KeyCodes;
  const key = (code: number) => keyboard.addKey(code);
  const up = key(W);
  const left = key(A);
  const down = key(S);
  const right = key(D);
  const turnLeft = key(Q);
  const turnRight = key(E);
  const resetView = key(Z);
  const fireMode = key(T);
  const ability = key(SPACE);
  const exit = key(R);

  return () => ({
    move: {
      up: up.isDown,
      down: down.isDown,
      left: left.isDown,
      right: right.isDown,
    },
    rotate: {
      left: turnLeft.isDown,
      right: turnRight.isDown,
      reset: resetView.isDown,
    },
    // JustDown is true once per press, so holding T does not cycle repeatedly.
    toggleFireMode: Phaser.Input.Keyboard.JustDown(fireMode),
    ability: ability.isDown,
    exitDungeon: Phaser.Input.Keyboard.JustDown(exit),
  });
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
