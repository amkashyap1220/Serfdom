// Movement tuning. PROVISIONAL test values chosen by the user for Phase 2;
// not final balance. Change here only, never inline elsewhere.

/** Player movement speed in world pixels per second. */
export const PLAYER_SPEED = 150;

/** Size of the player's collision box against walls, in world pixels (PROVISIONAL: matches the 16×16 sprite). */
export const PLAYER_BODY = { width: 16, height: 16 } as const;

/** Simulation updates per second. Movement advances in fixed steps of 1/TICK_RATE seconds. */
export const TICK_RATE = 60;
export const TICK_SECONDS = 1 / TICK_RATE;

/**
 * Most simulated time processed in one rendered frame. After a long stall
 * (e.g. a background tab), extra time is dropped instead of being replayed
 * as a burst of catch-up movement.
 */
export const MAX_FRAME_SECONDS = 0.25;
