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

describe("screen flow", () => {
  it("connecting → menu once connected", () => {
    expect(run({ type: "connected" })).toEqual({
      kind: "menu",
      tab: "dungeons",
      notice: null,
    });
  });

  it("menu → queued (at once) → countdown from the server → in the run", () => {
    const queued = run(
      { type: "connected" },
      { type: "queueRequested", dungeon: GW },
    );
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
        server({ type: "runStarted", dungeon: GW, players: [1, 2] }),
      ),
    ).toEqual({ kind: "inRun", dungeon: GW });
  });

  it("death and completion show results; Return goes back to the menu", () => {
    for (const result of ["died", "completed"] as const) {
      const shown = run(
        { type: "connected" },
        server({ type: "runStarted", dungeon: GW, players: [1] }),
        server({ type: "runEnded", dungeon: GW, result, stats }),
      );
      expect(shown).toEqual({ kind: "results", result, dungeon: GW, stats });
      expect(nextScreen(shown, { type: "dismissResults" })).toMatchObject({
        kind: "menu",
      });
    }
  });

  it("requeue straight from the completion screen (D-048)", () => {
    const done = run(
      { type: "connected" },
      server({ type: "runEnded", dungeon: GW, result: "completed", stats }),
    );
    expect(
      nextScreen(done, { type: "queueRequested", dungeon: GW }),
    ).toMatchObject({ kind: "queued", dungeon: GW });
  });

  it("R (left) goes straight to the menu with a notice, no results screen", () => {
    expect(
      run(
        { type: "connected" },
        server({ type: "runEnded", dungeon: GW, result: "left", stats }),
      ),
    ).toEqual({
      kind: "menu",
      tab: "dungeons",
      notice: "You fled the Goblin Warrens. No rewards.",
    });
  });

  it("ignores a queue status that arrives after leaving the queue", () => {
    const menu = run(
      { type: "connected" },
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
      { type: "connected" },
      { type: "queueRequested", dungeon: GW },
      { type: "leaveQueue" },
    );
    expect(
      nextScreen(
        menu,
        server({ type: "runStarted", dungeon: GW, players: [1] }),
      ),
    ).toEqual({ kind: "inRun", dungeon: GW });
  });

  it("any screen → connecting on disconnect; tabs only switch in the menu", () => {
    const inRun = run(
      { type: "connected" },
      server({ type: "runStarted", dungeon: GW, players: [1] }),
    );
    expect(nextScreen(inRun, { type: "openTab", tab: "stash" })).toBe(inRun);
    expect(nextScreen(inRun, { type: "disconnected", reason: "x" })).toEqual({
      kind: "connecting",
      reason: "x",
    });
    expect(
      run({ type: "connected" }, { type: "openTab", tab: "stash" }),
    ).toMatchObject({ kind: "menu", tab: "stash" });
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
