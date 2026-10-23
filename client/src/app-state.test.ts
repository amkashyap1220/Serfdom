import { SERF_BASE, zeroStats } from "@serfdom/shared";
import { newRunStats, type ServerMessage } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import {
  accuracy,
  formatDuration,
  INITIAL_SCREEN,
  nextScreen,
  type Screen,
  type ScreenEvent,
} from "./app-state";

const GW = "goblin-warrens";
const server = (message: ServerMessage, nowMs = 0): ScreenEvent => ({
  type: "server",
  message,
  nowMs,
});
const run = (...events: ScreenEvent[]): Screen =>
  events.reduce(nextScreen, INITIAL_SCREEN);
const stats = { ...newRunStats(), seconds: 42, shotsFired: 10, shotsHit: 7 };
/** Connected with a saved token, and the server accepted it. */
const LOGGED_IN: ScreenEvent[] = [
  { type: "connected", hasToken: true },
  {
    type: "server",
    message: { type: "authOk", email: "a@b.co", token: "t" },
    nowMs: 0,
  },
];

describe("screen flow", () => {
  it("connecting → resuming → menu with a saved login", () => {
    expect(run({ type: "connected", hasToken: true })).toEqual({
      kind: "resuming",
    });
    expect(run(...LOGGED_IN)).toEqual({
      kind: "menu",
      tab: "dungeons",
      notice: null,
    });
  });

  it("connecting → login screen without a saved login; register → menu", () => {
    const shown = run({ type: "connected", hasToken: false });
    expect(shown).toEqual({
      kind: "login",
      mode: "login",
      busy: false,
      error: null,
      notice: null,
    });
    const register = run(
      { type: "connected", hasToken: false },
      { type: "switchLoginMode" },
      { type: "loginSubmitted" },
    );
    expect(register).toMatchObject({
      kind: "login",
      mode: "register",
      busy: true,
    });
    expect(
      nextScreen(
        register,
        server({ type: "authOk", email: "a@b.co", token: "t" }),
      ),
    ).toMatchObject({ kind: "menu" });
  });

  it("a refused login shows the reason and lets you try again", () => {
    const refused = run(
      { type: "connected", hasToken: false },
      { type: "loginSubmitted" },
      server({ type: "authError", reason: "Email or password is incorrect." }),
    );
    expect(refused).toMatchObject({
      kind: "login",
      busy: false,
      error: "Email or password is incorrect.",
    });
  });

  it("an expired saved login falls back to the login screen with the reason", () => {
    expect(
      run(
        { type: "connected", hasToken: true },
        server({
          type: "authError",
          reason: "Your login has expired. Please log in again.",
        }),
      ),
    ).toMatchObject({
      kind: "login",
      notice: "Your login has expired. Please log in again.",
    });
  });

  it("logged out (or logged in elsewhere) from anywhere → login screen", () => {
    const inRun = run(
      ...LOGGED_IN,
      server({
        type: "runStarted",
        dungeon: GW,
        players: [1],
        stats: SERF_BASE,
        weaponTier: null,
      }),
    );
    expect(
      nextScreen(
        inRun,
        server({
          type: "loggedOut",
          reason: "This account logged in somewhere else.",
        }),
      ),
    ).toMatchObject({
      kind: "login",
      notice: "This account logged in somewhere else.",
    });
  });

  it("menu → queued (at once) → countdown from the server → in the run", () => {
    const queued = run(...LOGGED_IN, { type: "queueRequested", dungeon: GW });
    expect(queued).toEqual({
      kind: "queued",
      dungeon: GW,
      queued: null,
      startsAtMs: null,
    });
    const counting = nextScreen(
      queued,
      server(
        { type: "queueStatus", dungeon: GW, queued: 2, startsIn: 3.5 },
        1000,
      ),
    );
    expect(counting).toMatchObject({ queued: 2, startsAtMs: 4500 });
    expect(
      nextScreen(
        counting,
        server({
          type: "runStarted",
          dungeon: GW,
          players: [1, 2],
          stats: SERF_BASE,
          weaponTier: null,
        }),
      ),
    ).toEqual({ kind: "inRun", dungeon: GW });
  });

  it("death and completion show results; Return goes back to the menu", () => {
    for (const result of ["died", "completed"] as const) {
      const shown = run(
        ...LOGGED_IN,
        server({
          type: "runStarted",
          dungeon: GW,
          players: [1],
          stats: SERF_BASE,
          weaponTier: null,
        }),
        server({
          type: "runEnded",
          dungeon: GW,
          result,
          stats,
          loot: [],
          killedBy: null,
          serf: null,
          expGained: 0,
          statGains: zeroStats(),
        }),
      );
      expect(shown).toEqual({
        kind: "results",
        result,
        dungeon: GW,
        stats,
        loot: [],
        killedBy: null,
        serf: null,
        expGained: 0,
        statGains: zeroStats(),
      });
      // After a death you go choose a serf; after a clear, back to dungeons.
      expect(nextScreen(shown, { type: "dismissResults" })).toMatchObject({
        kind: "menu",
        tab: result === "died" ? "serfs" : "dungeons",
      });
    }
  });

  it("requeue straight from the completion screen (D-048)", () => {
    const done = run(
      ...LOGGED_IN,
      server({
        type: "runEnded",
        dungeon: GW,
        result: "completed",
        stats,
        loot: [],
        killedBy: null,
        serf: null,
        expGained: 0,
        statGains: zeroStats(),
      }),
    );
    expect(
      nextScreen(done, { type: "queueRequested", dungeon: GW }),
    ).toMatchObject({ kind: "queued", dungeon: GW });
  });

  it("R (left) goes straight to the menu with a notice, no results screen", () => {
    expect(
      run(
        ...LOGGED_IN,
        server({
          type: "runEnded",
          dungeon: GW,
          result: "left",
          stats,
          loot: [],
          killedBy: null,
          serf: null,
          expGained: 0,
          statGains: zeroStats(),
        }),
      ),
    ).toEqual({
      kind: "menu",
      tab: "dungeons",
      notice: "You fled the Goblin Warrens. No rewards.",
    });
  });

  it("ignores a queue status that arrives after leaving the queue", () => {
    const menu = run(
      ...LOGGED_IN,
      { type: "queueRequested", dungeon: GW },
      { type: "leaveQueue" },
    );
    expect(
      nextScreen(
        menu,
        server({ type: "queueStatus", dungeon: GW, queued: 1, startsIn: 4 }),
      ),
    ).toBe(menu);
  });

  it("the server wins a race: runStarted after leaving still puts us in the run", () => {
    const menu = run(
      ...LOGGED_IN,
      { type: "queueRequested", dungeon: GW },
      { type: "leaveQueue" },
    );
    expect(
      nextScreen(
        menu,
        server({
          type: "runStarted",
          dungeon: GW,
          players: [1],
          stats: SERF_BASE,
          weaponTier: null,
        }),
      ),
    ).toEqual({ kind: "inRun", dungeon: GW });
  });

  it("any screen → connecting on disconnect; tabs only switch in the menu", () => {
    const inRun = run(
      ...LOGGED_IN,
      server({
        type: "runStarted",
        dungeon: GW,
        players: [1],
        stats: SERF_BASE,
        weaponTier: null,
      }),
    );
    expect(nextScreen(inRun, { type: "openTab", tab: "stash" })).toBe(inRun);
    expect(nextScreen(inRun, { type: "disconnected", reason: "x" })).toEqual({
      kind: "connecting",
      reason: "x",
    });
    expect(run(...LOGGED_IN, { type: "openTab", tab: "stash" })).toMatchObject({
      kind: "menu",
      tab: "stash",
    });
  });
});

describe("stat formatting", () => {
  it("formats durations and accuracy", () => {
    expect(formatDuration(125.9)).toBe("2:05");
    expect(formatDuration(0)).toBe("0:00");
    expect(accuracy(stats)).toBe("70%");
    expect(accuracy(newRunStats())).toBe("—");
  });
});
