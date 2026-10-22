import * as Phaser from "phaser";
import type { MoveInput } from "@serfdom/shared";
import type { RotateInput } from "./camera-math";

export interface KeyState {
  move: MoveInput;
  rotate: RotateInput;
}

/**
 * Binds W/A/S/D for movement (D-031; arrow keys intentionally unbound) and
 * Q/E/Z for view rotation (D-040; Z reset is PROVISIONAL). Returns a function
 * that reads which keys are held right now. Phaser releases all keys when the
 * window loses focus, so nothing can get stuck after alt-tab.
 */
export function createKeyReader(scene: Phaser.Scene): () => KeyState {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    throw new Error("Keyboard input is not available in this scene");
  }
  const { W, A, S, D, Q, E, Z } = Phaser.Input.Keyboard.KeyCodes;
  const key = (code: number) => keyboard.addKey(code);
  const up = key(W);
  const left = key(A);
  const down = key(S);
  const right = key(D);
  const turnLeft = key(Q);
  const turnRight = key(E);
  const resetView = key(Z);

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
  });
}
