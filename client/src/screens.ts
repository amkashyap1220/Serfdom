import {
  dungeonInfo,
  LISTED_DUNGEONS,
  MAX_PARTY_SIZE,
  type DungeonId,
} from "@serfdom/shared";
import {
  accuracy,
  formatDuration,
  type MenuTab,
  type Screen,
} from "./app-state";

export interface ScreenActions {
  queue(dungeon: DungeonId): void;
  leaveQueue(): void;
  dismissResults(): void;
  openTab(tab: MenuTab): void;
}

/** The death screen's Return button appears after this, so the moment lands (D-050). */
const DEATH_RETURN_DELAY_MS = 1500;
const CONFETTI_PIECES = 80;
// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const CONFETTI_COLORS = ["#f0c419", "#5bc0de", "#ff6b6b", "#7ed957", "#ffffff"];

const TABS: { tab: MenuTab; label: string; comingIn: string | null }[] = [
  { tab: "dungeons", label: "Dungeons", comingIn: null },
  { tab: "serfs", label: "Serfs", comingIn: "Phases 7–8 (characters)" },
  { tab: "stash", label: "Stash", comingIn: "Phase 12 (shared stash)" },
  {
    tab: "leaderboard",
    label: "Leaderboard",
    comingIn: "Phase 8 (lifetime EXP)",
  },
];

/**
 * Draws the non-gameplay screens as DOM over the whole 960×640 container
 * (T-032): connecting, main menu, queue, death, and completion. Hidden
 * during a run so nothing covers gameplay. Rebuilt only when the screen
 * changes; the queue countdown updates every frame.
 */
export class ScreenView {
  private readonly root: HTMLElement;
  private readonly actions: ScreenActions;
  private shown: Screen | null = null;
  private countdown: HTMLElement | null = null;
  private shownAtMs = 0;

  constructor(root: HTMLElement, actions: ScreenActions) {
    this.root = root;
    this.actions = actions;
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  render(screen: Screen, nowMs: number): void {
    if (screen !== this.shown) {
      this.shown = screen;
      this.shownAtMs = nowMs;
      this.rebuild(screen);
    }
    if (screen.kind === "queued" && this.countdown) {
      this.countdown.textContent =
        screen.startsAtMs === null
          ? "Joining the queue…"
          : `Starting in ${Math.max(0, Math.ceil((screen.startsAtMs - nowMs) / 1000))} s`;
    }
  }

  private rebuild(screen: Screen): void {
    this.root.replaceChildren();
    this.countdown = null;
    this.root.className = `screen screen-${screen.kind}`;
    this.root.hidden = screen.kind === "inRun";
    switch (screen.kind) {
      case "connecting":
        this.root.append(
          el("h1", "title", "SERFDOM"),
          el("p", "", "Connecting to the game server…"),
          el(
            "p",
            "hint",
            screen.reason
              ? `Last attempt: ${screen.reason}. Retrying every 2 s. Is \`npm run dev\` running?`
              : "",
          ),
        );
        return;
      case "menu":
        this.buildMenu(screen.tab, screen.notice);
        return;
      case "queued": {
        const name = dungeonInfo(screen.dungeon).name;
        this.countdown = el("p", "countdown", "");
        this.root.append(
          el("h1", "", `Finding a party for ${name}`),
          el(
            "p",
            "",
            screen.queued === null
              ? "—"
              : `${screen.queued} / ${MAX_PARTY_SIZE} players waiting`,
          ),
          this.countdown,
          button("Leave queue (Esc)", () => this.actions.leaveQueue()),
        );
        return;
      }
      case "inRun":
        return;
      case "results":
        if (screen.result === "died") this.buildDeath(screen);
        else this.buildCompletion(screen);
        return;
    }
  }

  private buildMenu(tab: MenuTab, notice: string | null): void {
    const nav = el("nav", "tabs");
    for (const t of TABS) {
      const b = button(t.label, () => this.actions.openTab(t.tab));
      if (t.tab === tab) b.classList.add("active");
      nav.append(b);
    }
    const body = el("section", "tab-body");
    const current = TABS.find((t) => t.tab === tab);
    if (current?.comingIn) {
      body.append(el("p", "hint", `Coming in ${current.comingIn}.`));
    } else {
      for (const d of LISTED_DUNGEONS) {
        const card = el("div", "dungeon-card");
        card.append(
          el("h2", "", d.name),
          el("p", "hint", d.blurb),
          button("Enter queue (Enter)", () => this.actions.queue(d.id)),
        );
        body.append(card);
      }
      body.append(
        el(
          "p",
          "hint",
          `Open queue: you join a run that started under 15 s ago if it has room; otherwise a new run starts with up to ${MAX_PARTY_SIZE - 1} others, or alone after 5 s.`,
        ),
      );
    }
    this.root.append(el("h1", "title", "SERFDOM"), nav);
    if (notice) this.root.append(el("p", "notice", notice));
    this.root.append(body);
  }

  private buildDeath(screen: Extract<Screen, { kind: "results" }>): void {
    const name = dungeonInfo(screen.dungeon).name;
    const s = screen.stats;
    const ret = button("Return (Enter)", () => this.actions.dismissResults());
    ret.classList.add("delayed");
    ret.style.animationDelay = `${DEATH_RETURN_DELAY_MS}ms`;
    this.root.append(
      el("div", "death-flash"),
      el("h1", "death-title", "YOUR SERF HAS DIED"),
      el(
        "p",
        "epitaph",
        `Slain in the ${name} after ${formatDuration(s.seconds)}. Their story ends here.`,
      ),
      statList([
        ["Time survived", formatDuration(s.seconds)],
        ["Enemies slain", String(s.enemiesDefeated)],
        ["Damage dealt", String(s.damageDealt)],
        ["Shots fired", String(s.shotsFired)],
        ["Accuracy", accuracy(s)],
        ["Damage taken", String(s.damageTaken)],
      ]),
      el(
        "p",
        "hint",
        "Placeholder life record: serfs, levels and lifetime stats arrive in Phases 7–8.",
      ),
      ret,
    );
  }

  private buildCompletion(screen: Extract<Screen, { kind: "results" }>): void {
    const info = dungeonInfo(screen.dungeon);
    const s = screen.stats;
    const confetti = el("div", "confetti");
    for (let i = 0; i < CONFETTI_PIECES; i++) {
      const piece = el("i", "");
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background =
        CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? "#fff";
      piece.style.animationDelay = `${Math.random() * 0.6}s`;
      piece.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
      confetti.append(piece);
    }
    const actions = el("div", "actions");
    actions.append(
      button(`Requeue ${info.name} (Enter)`, () =>
        this.actions.queue(screen.dungeon),
      ),
      button("Menu (Esc)", () => this.actions.dismissResults()),
    );
    this.root.append(
      confetti,
      el("h1", "cleared-title", "DUNGEON CLEARED"),
      el("p", "", `${info.name} · ${formatDuration(s.seconds)}`),
      statList([
        ["Clear time", formatDuration(s.seconds)],
        ["Enemies slain", String(s.enemiesDefeated)],
        ["Damage dealt", String(s.damageDealt)],
        ["Accuracy", accuracy(s)],
        ["Damage taken", String(s.damageTaken)],
      ]),
      el("div", "chest"),
      el("p", "hint", "Reward chest: rewards arrive in Phase 9."),
      actions,
    );
  }

  private onKey(e: KeyboardEvent): void {
    const screen = this.shown;
    // A focused button already handles Enter itself (as a click).
    if (!screen || e.repeat || e.target instanceof HTMLButtonElement) return;
    if (e.key === "Enter") {
      if (screen.kind === "menu" && screen.tab === "dungeons") {
        const first = LISTED_DUNGEONS[0];
        if (first) this.actions.queue(first.id);
      } else if (screen.kind === "results" && screen.result === "completed") {
        this.actions.queue(screen.dungeon);
      } else if (
        screen.kind === "results" &&
        performance.now() - this.shownAtMs >= DEATH_RETURN_DELAY_MS
      ) {
        this.actions.dismissResults();
      }
    } else if (e.key === "Escape") {
      if (screen.kind === "queued") this.actions.leaveQueue();
      else if (screen.kind === "results" && screen.result === "completed") {
        this.actions.dismissResults();
      }
    }
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function statList(rows: [string, string][]): HTMLElement {
  const dl = el("dl", "stats");
  for (const [k, v] of rows) dl.append(el("dt", "", k), el("dd", "", v));
  return dl;
}
