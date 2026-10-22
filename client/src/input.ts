import * as Phaser from "phaser";
import type { MoveInput } from "@serfdom/shared";

/**
 * Binds W/A/S/D (D-031; arrow keys intentionally unbound) and returns a
 * function that reads which are held right now. Phaser releases all keys
 * when the window loses focus, so movement cannot get stuck after alt-tab.
 */
export function createWasdReader(scene: Phaser.Scene): () => MoveInput {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    throw new Error("Keyboard input is not available in this scene");
  }
  const { W, A, S, D } = Phaser.Input.Keyboard.KeyCodes;
  const up = keyboard.addKey(W);
  const left = keyboard.addKey(A);
  const down = keyboard.addKey(S);
  const right = keyboard.addKey(D);

  return () => ({
    up: up.isDown,
    down: down.isDown,
    left: left.isDown,
    right: right.isDown,
  });
}
