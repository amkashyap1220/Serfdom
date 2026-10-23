import {
  dungeonInfo,
  EMAIL_MAX,
  emailProblem,
  normalizeEmail,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
  LISTED_DUNGEONS,
  MAX_PARTY_SIZE,
  PLACEHOLDER_ROLL_MAX,
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
  submitLogin(
    mode: "login" | "register",
    email: string,
    password: string,
  ): void;
  switchLoginMode(): void;
  logout(): void;
}

/** The death screen's Return button appears after this, so the moment lands (D-050). */
const DEATH_RETURN_DELAY_MS = 1500;
/** Confetti per wave; three waves (D-049: maximum celebration). */
const CONFETTI_PIECES = 60;
const CONFETTI_WAVES = 3;
const CONFETTI_WAVE_GAP_S = 0.8;
/** Stats count up from zero, one after another. */
const COUNT_UP_MS = 900;
const COUNT_UP_STAGGER_MS = 250;
const COUNT_UP_START_MS = 500;
/** Slot-machine reveal of the reward roll (D-049): spins after the chest lands, reels stop one by one. */
const REEL_START_MS = 1400;
const REEL_FIRST_STOP_MS = 2300;
const REEL_STOP_GAP_MS = 450;
const REEL_TICK_MS = 55;
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
  /** Email of the logged-in account, shown in the menu. */
  private email: string | null = null;
  /** What was typed into the email field, kept across redraws (never the password). */
  private typedEmail = "";

  constructor(root: HTMLElement, actions: ScreenActions) {
    this.root = root;
    this.actions = actions;
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  setAccount(email: string | null): void {
    this.email = email;
    this.shown = null; // redraw with the new header
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
      case "resuming":
        this.root.append(
          el("h1", "title", "SERFDOM"),
          el("p", "", "Logging you back in…"),
        );
        return;
      case "login":
        this.buildLogin(screen);
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

  /**
   * Email + password form (D-058). A real <form>, so Enter submits and
   * password managers work. Checks the shared rules first for quick
   * feedback; the server checks again.
   */
  private buildLogin(screen: Extract<Screen, { kind: "login" }>): void {
    const registering = screen.mode === "register";
    const form = document.createElement("form");
    form.className = "login-form";
    const email = input("email", "Email", registering ? "email" : "username");
    const password = input(
      "password",
      `Password (${PASSWORD_MIN}+ characters)`,
      registering ? "new-password" : "current-password",
    );
    email.value = this.typedEmail;
    email.addEventListener("input", () => (this.typedEmail = email.value));
    const problem = el("p", "error", screen.error ?? "");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = screen.busy
      ? "Please wait…"
      : registering
        ? "Create account"
        : "Log in";
    submit.disabled = screen.busy;
    form.append(email, password, problem, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const address = normalizeEmail(email.value);
      const local =
        emailProblem(address) ??
        (registering ? passwordProblem(password.value) : null);
      if (local) {
        problem.textContent = local;
        return;
      }
      this.actions.submitLogin(screen.mode, address, password.value);
    });
    const toggle = button(
      registering ? "I already have an account" : "Create an account",
      () => this.actions.switchLoginMode(),
    );
    toggle.classList.add("link");
    this.root.append(el("h1", "title", "SERFDOM"));
    if (screen.notice) this.root.append(el("p", "notice", screen.notice));
    this.root.append(
      el("h2", "", registering ? "Create an account" : "Log in"),
      form,
      toggle,
      el(
        "p",
        "hint",
        "No email is sent yet: verification and password reset come before release.",
      ),
    );
    (email.value ? password : email).focus();
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
    const account = el("div", "account-bar");
    account.append(
      el("span", "", this.email ? `Logged in as ${this.email}` : ""),
      button("Log out", () => this.actions.logout()),
    );
    this.root.append(account, el("h1", "title", "SERFDOM"), nav);
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
    for (let wave = 0; wave < CONFETTI_WAVES; wave++) {
      for (let i = 0; i < CONFETTI_PIECES; i++) {
        const piece = el("i", "");
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background =
          CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? "#fff";
        piece.style.animationDelay = `${wave * CONFETTI_WAVE_GAP_S + Math.random() * 0.6}s`;
        piece.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
        confetti.append(piece);
      }
    }
    const actions = el("div", "actions");
    actions.append(
      button(`Requeue ${info.name} (Enter)`, () =>
        this.actions.queue(screen.dungeon),
      ),
      button("Menu (Esc)", () => this.actions.dismissResults()),
    );
    const shots = s.shotsFired;
    const stats = countingStatList([
      ["Clear time", s.seconds, (n) => formatDuration(n)],
      ["Enemies slain", s.enemiesDefeated, (n) => String(Math.round(n))],
      ["Damage dealt", s.damageDealt, (n) => String(Math.round(n))],
      [
        "Accuracy",
        shots === 0 ? 0 : (100 * s.shotsHit) / shots,
        (n) => (shots === 0 ? accuracy(s) : `${Math.round(n)}%`),
      ],
      ["Damage taken", s.damageTaken, (n) => String(Math.round(n))],
    ]);
    const chest = el("div", "chest-stage");
    chest.append(el("div", "chest-rays"), el("div", "chest"));
    this.root.append(
      el("div", "gold-flash"),
      confetti,
      el("h1", "cleared-title", "DUNGEON CLEARED"),
      el("p", "", `${info.name} · ${formatDuration(s.seconds)}`),
      stats,
      chest,
      screen.reward
        ? rewardReel(screen.reward.roll)
        : el("p", "hint", "No reward roll."),
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

function input(
  type: "email" | "password",
  placeholder: string,
  autocomplete: string,
): HTMLInputElement {
  const i = document.createElement("input");
  i.type = type;
  i.placeholder = placeholder;
  i.autocomplete = autocomplete as AutoFill;
  i.required = true;
  i.maxLength = type === "email" ? EMAIL_MAX : PASSWORD_MAX;
  i.setAttribute("aria-label", placeholder);
  return i;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Stats that count up from zero one by one (D-049). Uses
 * requestAnimationFrame; the final values are exact when it finishes.
 */
function countingStatList(
  rows: [string, number, (n: number) => string][],
): HTMLElement {
  const dl = el("dl", "stats counting");
  const start = performance.now();
  const cells = rows.map(([label, target, format], i) => {
    const dd = el("dd", "", format(0));
    dl.append(el("dt", "", label), dd);
    return {
      dd,
      target,
      format,
      begin: start + COUNT_UP_START_MS + i * COUNT_UP_STAGGER_MS,
    };
  });
  const frame = (now: number) => {
    let running = false;
    for (const c of cells) {
      const t = Math.min(1, Math.max(0, (now - c.begin) / COUNT_UP_MS));
      // Ease out, so numbers rush up then settle.
      const eased = 1 - (1 - t) ** 3;
      c.dd.textContent = c.format(t >= 1 ? c.target : c.target * eased);
      c.dd.classList.toggle("done", t >= 1);
      if (t < 1) running = true;
    }
    // Stop once finished or once the screen has been replaced.
    if (running && dl.isConnected) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return dl;
}

/**
 * The chest's slot machine: one reel per digit of the server's roll. The
 * roll was decided by the server before this screen appeared; the spin is
 * presentation only. Placeholder until Phase 9 defines real rewards.
 */
function rewardReel(roll: number): HTMLElement {
  const digits = String(roll).padStart(
    String(PLACEHOLDER_ROLL_MAX).length,
    "0",
  );
  const box = el("div", "reel-box");
  const reels = el("div", "reels");
  const cells = [...digits].map(() => {
    const cell = el("span", "reel", "0");
    reels.append(cell);
    return cell;
  });
  const label = el("p", "hint", "Rolling…");
  box.append(reels, label);

  const start = performance.now();
  const timer = setInterval(() => {
    if (!box.isConnected && performance.now() - start > 100) {
      clearInterval(timer);
      return;
    }
    const t = performance.now() - start;
    if (t < REEL_START_MS) return;
    let spinning = 0;
    cells.forEach((cell, i) => {
      const stopsAt = REEL_FIRST_STOP_MS + i * REEL_STOP_GAP_MS;
      if (t < stopsAt) {
        cell.textContent = String(Math.floor(Math.random() * 10));
        cell.classList.add("spinning");
        spinning++;
      } else if (
        cell.classList.contains("spinning") ||
        cell.textContent !== digits[i]
      ) {
        cell.textContent = digits[i] ?? "0";
        cell.classList.remove("spinning");
        cell.classList.add("stopped");
      }
    });
    if (spinning === 0) {
      clearInterval(timer);
      box.classList.add("revealed");
      label.textContent = `Placeholder roll ${roll} / ${PLACEHOLDER_ROLL_MAX}: real rewards arrive in Phase 9.`;
    }
  }, REEL_TICK_MS);
  return box;
}

function statList(rows: [string, string][]): HTMLElement {
  const dl = el("dl", "stats");
  for (const [k, v] of rows) dl.append(el("dt", "", k), el("dd", "", v));
  return dl;
}
