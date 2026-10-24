import {
  dungeonInfo,
  type DungeonId,
  type EnemyKind,
  type HazardKind,
  type SerfSummary,
  type LootDrop,
  type PotionDrop,
  type RunStats,
  type ServerMessage,
  type Stats,
} from "@serfdom/shared";

export type MenuTab = "dungeons" | "serfs" | "stash" | "rack" | "leaderboard";

/**
 * Which screen the player sees (D-048, D-050). The server decides every
 * transition that matters (a run starting, a run ending, the stats); the
 * client only adds instant feedback for its own clicks.
 */
export type Screen =
  | { kind: "connecting"; reason: string | null }
  /** Logging back in with a saved token. */
  | { kind: "resuming" }
  | {
      kind: "login";
      mode: "login" | "register";
      /** Waiting for the server's answer. */
      busy: boolean;
      /** Why the last attempt failed. */
      error: string | null;
      /** Why we are here (logged out, logged in elsewhere, expired). */
      notice: string | null;
    }
  | { kind: "menu"; tab: MenuTab; notice: string | null }
  | {
      kind: "queued";
      dungeon: DungeonId;
      /** Players waiting, including us (null until the server answers). */
      queued: number | null;
      /** performance.now() time the run should start (null until the server answers). */
      startsAtMs: number | null;
    }
  | { kind: "inRun"; dungeon: DungeonId }
  | {
      kind: "results";
      result: "completed" | "died";
      dungeon: DungeonId;
      stats: RunStats;
      /** The server's roll for us alone (placeholder until Phase 9); null on death. */
      /** One item per chest (D-080); empty unless completed. */
      loot: LootDrop[];
      /** Stat potions won (D-118); empty unless completed. */
      potions: PotionDrop[];
      /** What landed the killing blow (deaths). */
      killedBy: EnemyKind | HazardKind | null;
      /** The serf's life including this run (its final record on death). */
      serf: SerfSummary | null;
      /** EXP this run earned (completion only). */
      expGained: number;
      /** Stats rolled for the levels gained (all zero without a level-up). */
      statGains: Stats;
    };

export type ScreenEvent =
  /** The server said welcome. `hasToken`: a saved login will be resumed. */
  | { type: "connected"; hasToken: boolean }
  | { type: "loginSubmitted" }
  | { type: "switchLoginMode" }
  | { type: "disconnected"; reason: string }
  | { type: "server"; message: ServerMessage; nowMs: number }
  | { type: "openTab"; tab: MenuTab }
  /** We just asked to queue (shown at once; the server confirms with queueStatus). */
  | { type: "queueRequested"; dungeon: DungeonId }
  | { type: "leaveQueue" }
  /** Return / Menu on a results screen. */
  | { type: "dismissResults" };

export const INITIAL_SCREEN: Screen = { kind: "connecting", reason: null };

const MENU: Screen = { kind: "menu", tab: "dungeons", notice: null };

const login = (notice: string | null = null): Screen => ({
  kind: "login",
  mode: "login",
  busy: false,
  error: null,
  notice,
});

/** Pure: the next screen after an event. Returns the same object when nothing changes. */
export function nextScreen(screen: Screen, event: ScreenEvent): Screen {
  switch (event.type) {
    case "connected":
      if (screen.kind !== "connecting") return screen;
      return event.hasToken ? { kind: "resuming" } : login();
    case "loginSubmitted":
      return screen.kind === "login"
        ? { ...screen, busy: true, error: null }
        : screen;
    case "switchLoginMode":
      return screen.kind === "login"
        ? {
            ...screen,
            mode: screen.mode === "login" ? "register" : "login",
            error: null,
          }
        : screen;
    case "disconnected":
      return { kind: "connecting", reason: event.reason };
    case "openTab":
      return screen.kind === "menu"
        ? { kind: "menu", tab: event.tab, notice: null }
        : screen;
    case "queueRequested":
      return screen.kind === "menu" || screen.kind === "results"
        ? {
            kind: "queued",
            dungeon: event.dungeon,
            queued: null,
            startsAtMs: null,
          }
        : screen;
    case "leaveQueue":
      return screen.kind === "queued" ? MENU : screen;
    case "dismissResults":
      if (screen.kind !== "results") return screen;
      // After a death: choose a new or existing serf (D-050).
      return screen.result === "died"
        ? { kind: "menu", tab: "serfs", notice: null }
        : MENU;
    case "server":
      return onServerMessage(screen, event.message, event.nowMs);
  }
}

function onServerMessage(
  screen: Screen,
  msg: ServerMessage,
  nowMs: number,
): Screen {
  switch (msg.type) {
    case "authOk":
      return screen.kind === "login" || screen.kind === "resuming"
        ? MENU
        : screen;
    case "authError":
      if (screen.kind === "resuming") return login(msg.reason);
      if (screen.kind === "login") {
        return { ...screen, busy: false, error: msg.reason };
      }
      return screen;
    case "loggedOut":
      return login(msg.reason);
    case "queueStatus":
      // Ignore a late status after we left the queue or the run began.
      if (screen.kind !== "queued" || screen.dungeon !== msg.dungeon) {
        return screen;
      }
      return {
        ...screen,
        queued: msg.queued,
        startsAtMs: nowMs + msg.startsIn * 1000,
      };
    case "runStarted":
      return { kind: "inRun", dungeon: msg.dungeon };
    case "runEnded":
      if (msg.result === "left") {
        return {
          kind: "menu",
          tab: "dungeons",
          notice: `You fled the ${dungeonInfo(msg.dungeon).name}. No rewards.`,
        };
      }
      return {
        kind: "results",
        result: msg.result,
        dungeon: msg.dungeon,
        stats: msg.stats,
        loot: msg.loot,
        potions: msg.potions,
        killedBy: msg.killedBy,
        serf: msg.serf,
        expGained: msg.expGained,
        statGains: msg.statGains,
      };
    default:
      return screen;
  }
}

/** "2:05" for 125.3 seconds. */
export function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Shots that hit, as a whole percentage ("—" before the first shot). */
export function accuracy(stats: RunStats): string {
  if (stats.shotsFired === 0) return "—";
  return `${Math.round((100 * stats.shotsHit) / stats.shotsFired)}%`;
}
