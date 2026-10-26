import type { ActionId, KeyBinds, MoveInput } from "@serfdom/shared";
import type { RotateInput } from "./camera-math";

export interface KeyState {
  move: MoveInput;
  rotate: RotateInput;
  /** The fire mode key was pressed since the last read (D-099). */
  toggleFireMode: boolean;
  /** The ability key held (D-092). */
  ability: boolean;
  /** The leave key pressed since the last read (D-036). */
  exitDungeon: boolean;
}

/**
 * Which game keys are down, by the account's binds (D-159). Pure, so the
 * rules are tested without a browser: `press` / `release` take
 * KeyboardEvent.code values; `read` reports each action and forgets the
 * presses since the last read (one fire mode change per press, however
 * long the key is held).
 */
export class KeyTracker {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(private readonly binds: () => KeyBinds) {}

  press(code: string): void {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }

  /** Forgets every key (leaving a run, or the window losing focus). */
  clear(): void {
    this.down.clear();
    this.pressed.clear();
  }

  /** Whether a game action uses this key. */
  isBound(code: string): boolean {
    return Object.values(this.binds()).includes(code);
  }

  read(): KeyState {
    const b = this.binds();
    const held = (a: ActionId) => this.down.has(b[a]);
    const tapped = (a: ActionId) => this.pressed.has(b[a]);
    const state: KeyState = {
      move: {
        up: held("up"),
        down: held("down"),
        left: held("left"),
        right: held("right"),
      },
      rotate: {
        left: held("turnLeft"),
        right: held("turnRight"),
        reset: held("resetView"),
      },
      toggleFireMode: tapped("fireMode"),
      ability: held("ability"),
      exitDungeon: tapped("leave"),
    };
    this.pressed.clear();
    return state;
  }
}
