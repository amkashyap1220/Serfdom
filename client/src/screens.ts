import {
  dungeonInfo,
  EMAIL_MAX,
  emailProblem,
  normalizeEmail,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
  CLASS_CHOICE_LEVEL,
  CLASS_IDS,
  canEquip,
  compareItems,
  EQUIP_SLOTS,
  loadoutOf,
  slotsFor,
  type EquipSlot,
  luckOf,
  STAT_KEYS,
  STAT_LABELS,
  type StatKey,
  type Stats,
  CLASSES,
  className,
  needsClass,
  type ClassId,
  DUNGEON_EXP,
  entryProblem,
  levelForExp,
  LISTED_DUNGEONS,
  levelProgress,
  normalizeSerfName,
  type LeaderboardEntry,
  type LeaderboardBoard,
  type LeaderboardQuery,
  LEADERBOARD_BOARDS,
  normalizeLeaderboardQuery,
  SERF_NAME_MAX,
  SERF_NAME_MIN,
  serfNameProblem,
  suggestSerfName,
  type SerfSummary,
  type ServerMessage,
  type PartyInviter,
  MAX_LEVEL,
  boughtFor,
  nextPrice,
  UPGRADE_KINDS,
  UPGRADES,
  type UpgradeKind,
  BASE_LUCK,
  MAX_PARTY_SIZE,
  sellPrice,
  formatMoney,
  type Item,
  itemFullName,
  weaponDamage,
  type ItemSpec,
  type DungeonId,
  potionProblem,
  type Potion,
  classSet,
  itemName,
} from "@serfdom/shared";
import {
  accuracy,
  formatDuration,
  type MenuTab,
  type Screen,
} from "./app-state";
import { ExchangeScreen, type ExchangeActions } from "./exchange-screen";
import { ENEMY_NAMES } from "./names";
import {
  button,
  el,
  hideTip,
  itemCard,
  moneyEl,
  potionCard,
  select,
} from "./ui-parts";

export interface ScreenActions extends ExchangeActions {
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
  createSerf(name: string): void;
  selectSerf(serfId: number): void;
  sellItem(itemId: number): void;
  equip(itemId: number, serfId: number, slot: EquipSlot): void;
  unequip(serfId: number, slot: EquipSlot): void;
  drinkPotion(potionId: number, serfId: number): void;
  pourPotion(potionId: number): void;
  chooseClass(serfId: number, classId: ClassId): void;
  /** Equip the free Tier 0 class set, or not (D-157). */
  answerClassSet(serfId: number, accept: boolean): void;
  logout(): void;
  /** Parties (D-142, D-143). */
  invite(name: string): void;
  answerInvite(inviteId: number, accept: boolean): void;
  leaveParty(): void;
  removeMember(playerId: number): void;
  /** The HUD's debug readout (D-146). */
  setDebugHud(on: boolean): void;
  /** Another leaderboard or filter (D-148). */
  getLeaderboard(query: LeaderboardQuery): void;
  /** Buy the next step of an account upgrade with gold (D-154). */
  buyUpgrade(kind: UpgradeKind): void;
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
/** Chests open one by one after the chest lands (D-049): first at this, then a gap each. */
const LOOT_FIRST_MS = 1900;
const LOOT_GAP_MS = 700;
// Placeholder colors only; not the verified palette (see ASSET_MANIFEST.md).
const CONFETTI_COLORS = ["#f0c419", "#5bc0de", "#ff6b6b", "#7ed957", "#ffffff"];

/** How long party news stays on screen. */
const PARTY_MESSAGE_MS = 8000;

const TABS: { tab: MenuTab; label: string; comingIn: string | null }[] = [
  { tab: "dungeons", label: "Play", comingIn: null },
  { tab: "serfs", label: "Serfs", comingIn: null },
  { tab: "party", label: "Party", comingIn: null },
  { tab: "stash", label: "Stash", comingIn: null },
  { tab: "rack", label: "Potion rack", comingIn: null },
  { tab: "exchange", label: "Exchange", comingIn: null },
  { tab: "leaderboard", label: "Leaderboards", comingIn: null },
  { tab: "settings", label: "Settings", comingIn: null },
];

/**
 * Draws the non-gameplay screens as DOM over the whole 1200×800 container
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
  /** This account's serfs from the server (null until known). */
  private serfs: Extract<ServerMessage, { type: "serfList" }> | null = null;
  private serfError: string | null = null;
  private leaderboard: LeaderboardEntry[] | null = null;
  /** The account's stash, gold, and waiting rewards (null until known). */
  private stash: Extract<ServerMessage, { type: "stash" }> | null = null;
  private stashError: string | null = null;
  private typedSerfName = "";
  /** Class highlighted in the picker, waiting for Confirm (the choice is permanent). */
  private pickedClass: ClassId | null = null;
  /** Your party and the invites you sent, as the server last said (D-143). */
  private party: Extract<ServerMessage, { type: "party" }> | null = null;
  private myPlayerId: number | null = null;
  /** Invites to you, still open, with when they lapse (performance.now() ms). */
  private invites: {
    inviteId: number;
    from: PartyInviter;
    expiresAtMs: number;
  }[] = [];
  /** The latest party news or refusal, shown for a few seconds. */
  private partyMessage: { text: string; error: boolean } | null = null;
  private partyMessageTimer: ReturnType<typeof setTimeout> | undefined;
  private typedInviteName = "";
  private debugHud = false;

  /** The debug switch changed (Settings or the ` key). */
  setDebugHud(on: boolean): void {
    this.debugHud = on;
    this.redraw();
  }

  constructor(root: HTMLElement, actions: ScreenActions) {
    this.root = root;
    this.actions = actions;
    this.exchange = new ExchangeScreen(actions, () => this.redraw());
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  setAccount(email: string | null): void {
    this.email = email;
    if (email === null) {
      this.serfs = null;
      this.clearParty();
    }
    this.shown = null; // redraw with the new header
  }

  setSerfs(list: Extract<ServerMessage, { type: "serfList" }>): void {
    this.serfs = list;
    this.serfError = null;
    this.typedSerfName = "";
    this.pickedClass = null;
    this.redraw();
  }

  setStash(stash: Extract<ServerMessage, { type: "stash" }>): void {
    this.stash = stash;
    this.stashError = null;
    this.redraw();
  }

  /**
   * Shows new serf/stash data. On the completion screen only the reward
   * cards change (rebuilding would replay the celebration); elsewhere the
   * screen is rebuilt.
   */
  private redraw(): void {
    if (this.shown?.kind === "results" && this.lootRefresh) {
      this.lootRefresh();
    } else {
      this.shown = null;
    }
  }

  /** Updates the completion screen's reward cards in place (set while it shows). */
  private lootRefresh: (() => void) | null = null;

  /** A serf as the server last sent it (fresher than a results snapshot). */
  private serfById(id: number): SerfSummary | null {
    return this.serfs?.serfs.find((s) => s.id === id) ?? null;
  }

  setStashError(reason: string): void {
    this.stashError = reason;
    this.shown = null;
  }

  /** Items waiting for room for this serf: it may not start a dungeon (D-088). */
  private waitingFor(serfId: number): number {
    return this.stash?.pending.filter((p) => p.serfId === serfId).length ?? 0;
  }

  /** Potions waiting for room in the rack for this serf (D-118): it is blocked too. */
  private potionsWaitingFor(serfId: number): number {
    return (
      this.stash?.pendingPotions.filter((p) => p.serfId === serfId).length ?? 0
    );
  }

  /** Who drank which potion, from this browser's clicks (for "Drunk by …" labels). */
  private readonly drunkBy = new Map<number, string>();

  /** The board being shown (D-148); a reply for an older query is ignored. */
  leaderboardQuery: LeaderboardQuery = {
    board: "exp",
    classId: null,
    dungeon: null,
    soloOnly: false,
  };

  setLeaderboard(reply: Extract<ServerMessage, { type: "leaderboard" }>): void {
    if (
      JSON.stringify(reply.query) !==
      JSON.stringify(normalizeLeaderboardQuery(this.leaderboardQuery))
    ) {
      return;
    }
    this.leaderboard = reply.entries;
    this.shown = null;
  }

  /** Switches board or filter, and asks the server for it. */
  private pickBoard(change: Partial<LeaderboardQuery>): void {
    const next = { ...this.leaderboardQuery, ...change };
    // The fastest clears need a dungeon: the first one until another is picked.
    if (next.board === "fastest" && next.dungeon === null) {
      next.dungeon = LISTED_DUNGEONS[0]?.id ?? null;
    }
    this.leaderboardQuery = next;
    this.leaderboard = null;
    this.shown = null;
    this.actions.getLeaderboard(normalizeLeaderboardQuery(next));
  }

  setSerfError(reason: string): void {
    this.serfError = reason;
    this.shown = null;
  }

  setParty(
    party: Extract<ServerMessage, { type: "party" }>,
    myPlayerId: number | null,
  ): void {
    this.party = party;
    this.myPlayerId = myPlayerId;
    this.redraw();
  }

  addInvite(
    invite: Extract<ServerMessage, { type: "partyInvited" }>,
    nowMs: number,
  ): void {
    this.invites = [
      ...this.invites.filter((i) => i.inviteId !== invite.inviteId),
      {
        inviteId: invite.inviteId,
        from: invite.from,
        expiresAtMs: nowMs + invite.expiresIn * 1000,
      },
    ];
    this.redraw();
  }

  removeInvite(inviteId: number): void {
    this.invites = this.invites.filter((i) => i.inviteId !== inviteId);
    this.redraw();
  }

  /** Party news (or a refusal, `error`), shown on every menu tab for a few seconds. */
  setPartyNotice(text: string, error: boolean): void {
    this.partyMessage = { text, error };
    clearTimeout(this.partyMessageTimer);
    this.partyMessageTimer = setTimeout(() => {
      this.partyMessage = null;
      this.redraw();
    }, PARTY_MESSAGE_MS);
    this.redraw();
  }

  /** Logged out or disconnected: the server has dropped us from any party. */
  clearParty(): void {
    this.party = null;
    this.invites = [];
    this.partyMessage = null;
    this.redraw();
  }

  /** In a party but not its leader: the leader picks the dungeon (D-143). */
  private get followsLeader(): boolean {
    const party = this.party?.party;
    return !!party && party.leaderId !== this.myPlayerId;
  }

  /** The serf being played, if any. */
  private get playing(): SerfSummary | null {
    const list = this.serfs;
    return list?.serfs.find((s) => s.id === list.selectedId) ?? null;
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
    hideTip();
    this.root.replaceChildren();
    this.lootRefresh = null;
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
          el(
            "h1",
            "",
            this.party?.party
              ? `Your party is waiting for ${name}`
              : `Finding a party for ${name}`,
          ),
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
    // Registering asks twice, so a typo cannot lock you out of the account.
    const confirm = input("password", "Confirm password", "new-password");
    form.append(email, password);
    if (registering) form.append(confirm);
    form.append(problem, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const address = normalizeEmail(email.value);
      const local =
        emailProblem(address) ??
        (registering ? passwordProblem(password.value) : null) ??
        (registering && confirm.value !== password.value
          ? "The passwords don't match."
          : null);
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
    const members = this.party?.party?.members.length ?? 0;
    for (const t of TABS) {
      const label =
        t.tab === "party" && members > 0 ? `Party (${members})` : t.label;
      const b = button(label, () => this.actions.openTab(t.tab));
      if (t.tab === tab) b.classList.add("active");
      nav.append(b);
    }
    const body = el("section", "tab-body");
    const current = TABS.find((t) => t.tab === tab);
    if (current?.comingIn) {
      body.append(el("p", "hint", `Coming in ${current.comingIn}.`));
    } else if (tab === "leaderboard") {
      this.buildLeaderboard(body);
    } else if (tab === "stash") {
      this.buildStash(body);
    } else if (tab === "rack") {
      this.buildRack(body);
    } else if (tab === "serfs") {
      this.buildSerfs(body);
    } else if (tab === "party") {
      this.buildParty(body);
    } else if (tab === "settings") {
      this.buildSettings(body);
    } else if (tab === "exchange") {
      this.buildExchange(body);
    } else {
      const playing = this.playing;
      // The played serf is in the home panel (D-145).
      if (!playing) {
        body.append(
          el("p", "notice", "Choose or create a serf first (Serfs tab)."),
        );
      }
      const waiting = playing ? this.waitingFor(playing.id) : 0;
      if (playing && waiting > 0) {
        body.append(
          el(
            "p",
            "notice",
            `Your stash is full: ${waiting} reward${waiting === 1 ? " waits" : "s wait"} for room. Sell something in the Stash tab before the next dungeon.`,
          ),
          button("Open stash", () => this.actions.openTab("stash")),
        );
        this.finishMenu(nav, body, notice);
        return;
      }
      const potions = playing ? this.potionsWaitingFor(playing.id) : 0;
      if (playing && potions > 0) {
        body.append(
          el(
            "p",
            "notice",
            `Your potion rack is full: ${potions} potion${potions === 1 ? " waits" : "s wait"} for room. Drink or pour one out in the Potion rack tab before the next dungeon.`,
          ),
          button("Open potion rack", () => this.actions.openTab("rack")),
        );
        this.finishMenu(nav, body, notice);
        return;
      }
      if (playing && needsClass(playing)) {
        this.buildClassPicker(body, playing);
        this.finishMenu(nav, body, notice);
        return;
      }
      // Ten dungeons no longer fit one column (Phase 13): two rows, the
      // 1–20 ladder and the level-20 endgame, scrolling if ever too tall.
      const list = el("div", "dungeon-list");
      const grids = new Map<boolean, HTMLElement>();
      for (const [endgame, title] of [
        [false, "The ladder · levels 1–20"],
        [true, "Endgame · level 20"],
      ] as const) {
        const grid = el("div", "dungeon-grid");
        grids.set(endgame, grid);
        list.append(el("h3", "dungeon-group", title), grid);
      }
      for (const d of LISTED_DUNGEONS) {
        const card = el("div", "dungeon-card");
        // Locked until this serf completes the Warrens (D-107); the server
        // checks the same rule.
        const locked = playing
          ? entryProblem(d.id, playing.life.clears, levelForExp(playing.exp))
          : null;
        card.append(
          el("h2", "", d.name),
          el("p", "hint", d.blurb),
          !playing
            ? button("Choose a serf", () => this.actions.openTab("serfs"))
            : locked
              ? el("p", "notice", `Locked: ${locked}`)
              : this.followsLeader
                ? el("p", "hint", "The leader picks")
                : button(
                    this.party?.party
                      ? "Queue party (Enter)"
                      : "Enter queue (Enter)",
                    () => this.actions.queue(d.id),
                  ),
        );
        grids.get(("minLevel" in d ? d.minLevel : 1) >= 20)!.append(card);
      }
      body.append(list);
      body.append(
        el(
          "p",
          "hint",
          this.party?.party
            ? "Your party queues together and always shares a run; everyone must be able to enter. Players from the open queue may fill its empty places."
            : `Open queue: you join a run that started under 15 s ago if it has room; otherwise a new run starts with up to ${MAX_PARTY_SIZE - 1} others, or alone after 5 s.`,
        ),
      );
    }
    this.finishMenu(nav, body, notice);
  }

  private finishMenu(
    nav: HTMLElement,
    body: HTMLElement,
    notice: string | null,
  ): void {
    // The home screen (D-145): a standing panel on the left (your serf,
    // your party, invites), the tabs on the right.
    const account = el("div", "account-bar");
    account.append(
      this.stash ? moneyEl(this.stash.gold, "gold") : el("span", "gold"),
      el("span", "", this.email ? `Logged in as ${this.email}` : ""),
      button("Log out", () => this.actions.logout()),
    );
    const main = el("div", "home-main");
    main.append(account, nav);
    if (notice) main.append(el("p", "notice", notice));
    main.append(body);
    const home = el("div", "home");
    home.append(this.homeSide(), main);
    this.root.append(home);
  }

  /** The left panel at the menu (D-145): the played serf, then the party. */
  private homeSide(): HTMLElement {
    const side = el("aside", "home-side");
    side.append(el("h1", "title", "SERFDOM"));
    const serf = this.playing;
    const card = el("div", "side-card");
    if (serf) {
      const p = levelProgress(serf.exp);
      const max = p.level >= MAX_LEVEL;
      const bar = el("div", "side-exp");
      const fill = el("span", "");
      fill.style.width = `${max ? 100 : (100 * p.into) / Math.max(1, p.needed)}%`;
      bar.append(fill);
      card.append(
        el("p", "side-name", serf.name),
        el("p", "hint", `${className(serf.classId)} · Level ${p.level}`),
        bar,
        el(
          "p",
          "hint",
          max
            ? `Max level · ${serf.exp} EXP`
            : `${p.into} / ${p.needed} EXP to level ${p.level + 1}`,
        ),
      );
      // A table: the label, then the total, gear, and potions, each in its
      // own right-aligned column; the headings are the key (D-151).
      const stats = el("dl", "side-stats");
      stats.append(
        el("dt", "", ""),
        el("dd", "st-head", "Total"),
        el("dd", "st-head src-gear", "Gear"),
        el("dd", "st-head src-potion", "Potions"),
      );
      for (const key of [...STAT_KEYS, "luck" as const]) {
        const { total, gear, potions } = statParts(serf, key);
        stats.append(
          el("dt", "", key === "luck" ? "LUCK" : STAT_LABELS[key]),
          el("dd", "", String(total)),
          el("dd", "src-gear", gear !== 0 ? signed(gear) : ""),
          el("dd", "src-potion", potions !== 0 ? signed(potions) : ""),
        );
      }
      card.append(stats);
      const worn = serf.items.filter((i) => i.equipped !== null);
      card.append(
        el(
          "p",
          "side-gear",
          worn.length > 0
            ? worn.map((i) => itemFullName(i)).join(" · ")
            : "Nothing worn",
        ),
      );
    } else {
      card.append(
        el("p", "hint", "No serf chosen."),
        button("Serfs", () => this.actions.openTab("serfs")),
      );
    }
    side.append(card);
    // The party, always in view (D-145); the Party tab has the full controls.
    const party = this.party?.party ?? null;
    const box = el("div", "side-party");
    box.append(
      el("h2", "", party ? `Party (${party.members.length})` : "Party"),
    );
    if (party) {
      for (const m of party.members) {
        box.append(
          el(
            "p",
            m.playerId === this.myPlayerId ? "side-member you" : "side-member",
            `${m.playerId === party.leaderId ? "★ " : ""}${m.name ?? "Choosing a serf"}${m.name ? ` · ${className(m.classId)} ${m.level}` : ""}`,
          ),
        );
      }
    } else {
      box.append(el("p", "hint", "Not in a party."));
    }
    const buttons = el("div", "side-buttons");
    buttons.append(button("Invite", () => this.actions.openTab("party")));
    if (party) buttons.append(button("Leave", () => this.actions.leaveParty()));
    box.append(buttons);
    side.append(box);
    const offers = this.classSetStrip();
    if (offers) side.append(offers);
    const invites = this.inviteStrip();
    if (invites) side.append(invites);
    return side;
  }

  /**
   * Account upgrades (D-154): each one's capacity, the next step's price,
   * and Buy (greyed out at the max or without the gold). The server checks
   * again; prices come from the shared rules.
   */
  private upgradeBar(
    stash: Extract<ServerMessage, { type: "stash" }>,
  ): HTMLElement {
    const bar = el("div", "upgrade-bar");
    const have: Record<UpgradeKind, number> = {
      serfSlots: this.serfs?.slots ?? UPGRADES.serfSlots.base,
      stash: stash.capacity,
      rack: stash.rackCapacity,
    };
    for (const kind of UPGRADE_KINDS) {
      const u = UPGRADES[kind];
      const price = nextPrice(kind, boughtFor(kind, have[kind]));
      const row = el("div", "upgrade");
      row.append(
        el("span", "upgrade-name", `${u.name}s ${have[kind]}/${u.max}`),
      );
      if (price === null) {
        row.append(el("span", "hint", "All bought"));
      } else {
        const buy = button(`+${u.step} · ${formatMoney(price)}`, () =>
          this.actions.buyUpgrade(kind),
        );
        buy.disabled = stash.gold < price;
        row.append(buy);
      }
      bar.append(row);
    }
    return bar;
  }

  /** The Exchange tab (D-155, D-156). */
  readonly exchange: ExchangeScreen;

  /**
   * The Grand Serf Exchange (D-155, D-156): Browse, Sell, and My trades.
   * Selling starts only here.
   */
  private buildExchange(body: HTMLElement): void {
    body.append(el("h2", "", "The Grand Serf Exchange"));
    if (this.stashError) body.append(el("p", "error", this.stashError));
    this.exchange.build(body, this.stash);
  }

  /** Settings (D-145): only the debug readout for now; key binds and more are Phase 18. */
  private buildSettings(body: HTMLElement): void {
    body.append(el("h2", "", "Settings"));
    const label = document.createElement("label");
    label.className = "setting";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.debugHud;
    box.addEventListener("change", () => this.actions.setDebugHud(box.checked));
    label.append(box, " Show the debug readout in the HUD (` key)");
    body.append(label);
    body.append(
      el("p", "hint", "Key binds, sound, and more settings come in Phase 18."),
    );
  }

  /**
   * The free Tier 0 class set waiting for each newly classed serf (D-157):
   * what is in it, Equip, and No thanks (then it is never created).
   */
  private classSetStrip(): HTMLElement | null {
    const waiting = (this.serfs?.serfs ?? []).filter(
      (x) => x.alive && x.classSetOffered && x.classId,
    );
    if (waiting.length === 0) return null;
    const strip = el("div", "party-strip");
    for (const serf of waiting) {
      const name = className(serf.classId);
      const row = el("div", "party-invite class-set");
      row.append(
        el(
          "span",
          "",
          `${serf.name} is now a ${name}. Take the free Tier 0 ${name} set? ${classSet(
            serf.classId!,
          )
            .map((w) => itemName(w.item))
            .join(", ")}.`,
        ),
        button("Equip", () => this.actions.answerClassSet(serf.id, true)),
        button("No thanks", () => this.actions.answerClassSet(serf.id, false)),
      );
      strip.append(row);
    }
    return strip;
  }

  /** Invites to you, and the latest party news, above every menu tab (D-143). */
  private inviteStrip(): HTMLElement | null {
    const now = performance.now();
    this.invites = this.invites.filter((i) => i.expiresAtMs > now);
    if (this.invites.length === 0 && !this.partyMessage) return null;
    const strip = el("div", "party-strip");
    for (const i of this.invites) {
      const row = el("div", "party-invite");
      row.append(
        el(
          "span",
          "",
          `${i.from.name} (${className(i.from.classId)} · Lv ${i.from.level}) invites you to their party.`,
        ),
        button("Accept", () => this.actions.answerInvite(i.inviteId, true)),
        button("Decline", () => this.actions.answerInvite(i.inviteId, false)),
      );
      strip.append(row);
    }
    if (this.partyMessage) {
      strip.append(
        el(
          "p",
          this.partyMessage.error ? "error" : "party-news",
          this.partyMessage.text,
        ),
      );
    }
    return strip;
  }

  /**
   * Party tab (14a, D-143): who is in your party, the leader's remove
   * buttons, leaving, and inviting by serf name. Queueing together comes
   * in 14b. Minimal until the home screen (Phase 15).
   */
  private buildParty(body: HTMLElement): void {
    const party = this.party?.party ?? null;
    body.append(el("h2", "", "Party"));
    if (party) {
      const leading = party.leaderId === this.myPlayerId;
      const list = el("div", "party-list");
      for (const m of party.members) {
        const row = el("div", "party-member");
        const you = m.playerId === this.myPlayerId;
        row.append(
          el(
            "span",
            "serf-name",
            `${m.name ?? "Choosing a serf"}${you ? " (you)" : ""}`,
          ),
          el(
            "span",
            "hint",
            m.name ? `${className(m.classId)} · Lv ${m.level}` : "",
          ),
          m.playerId === party.leaderId
            ? el("span", "serf-chosen", "Leader")
            : leading
              ? button("Remove", () => this.actions.removeMember(m.playerId))
              : el("span", "", ""),
        );
        list.append(row);
      }
      body.append(
        list,
        button("Leave party", () => this.actions.leaveParty()),
      );
    } else {
      body.append(
        el(
          "p",
          "hint",
          "You're not in a party. Invite a friend by their serf's name; they must be online.",
        ),
      );
    }
    const invited = this.party?.invited ?? [];
    for (const i of invited) {
      body.append(el("p", "hint", `Invited ${i.name}: waiting for an answer.`));
    }
    if (!this.playing) {
      body.append(
        el("p", "notice", "Choose or create a serf first (Serfs tab)."),
      );
    } else if (!party || party.members.length < MAX_PARTY_SIZE) {
      body.append(this.inviteForm());
    }
    body.append(
      el(
        "p",
        "hint",
        `Up to ${MAX_PARTY_SIZE} in a party. You stay together between runs; the leader queues the party.`,
      ),
    );
  }

  private inviteForm(): HTMLElement {
    const form = document.createElement("form");
    form.className = "serf-form";
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "Friend's serf name";
    name.setAttribute("aria-label", "Friend's serf name");
    name.maxLength = SERF_NAME_MAX;
    name.value = this.typedInviteName;
    name.addEventListener("input", () => (this.typedInviteName = name.value));
    const send = document.createElement("button");
    send.type = "submit";
    send.textContent = "Invite";
    form.append(name, send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const clean = normalizeSerfName(name.value);
      if (!clean) return;
      this.typedInviteName = "";
      this.actions.invite(clean);
    });
    return form;
  }

  /**
   * Level 5 (D-073): pick one of the 10 classes (D-072), permanently. Two
   * steps, pick then confirm, so a misclick cannot decide a serf's life.
   */
  private buildClassPicker(body: HTMLElement, serf: SerfSummary): void {
    body.append(
      el(
        "h2",
        "class-title",
        `${serf.name} has reached level ${CLASS_CHOICE_LEVEL}: choose a class`,
      ),
      el(
        "p",
        "hint",
        "Permanent for this serf's life. Abilities arrive in Phase 10.",
      ),
    );
    const grid = el("div", "class-grid");
    for (const id of CLASS_IDS) {
      const c = CLASSES[id];
      const card = button("", () => {
        this.pickedClass = id;
        this.shown = null;
      });
      card.className =
        id === this.pickedClass ? "class-card picked" : "class-card";
      card.append(
        el("span", "class-name", c.name),
        el("span", "class-item", `${c.abilityItem} · ${c.ability}`),
        el("span", "class-concept", c.concept),
      );
      grid.append(card);
    }
    body.append(grid);
    const picked = this.pickedClass;
    if (picked) {
      body.append(
        button(
          `Confirm: ${serf.name} becomes a ${CLASSES[picked].name} (permanent)`,
          () => this.actions.chooseClass(serf.id, picked),
        ),
      );
    }
    if (this.serfError) body.append(el("p", "error", this.serfError));
  }

  /**
   * Death (D-050, D-062): abrupt, then the serf's whole life. The record is
   * the server's (saved permanently before it was sent).
   */
  private buildDeath(screen: Extract<Screen, { kind: "results" }>): void {
    const place = dungeonInfo(screen.dungeon).name;
    const serf = screen.serf;
    const life = serf?.life ?? null;
    const killer = screen.killedBy ? ENEMY_NAMES[screen.killedBy] : null;
    const ret = button("Choose a serf (Enter)", () =>
      this.actions.dismissResults(),
    );
    ret.classList.add("delayed");
    ret.style.animationDelay = `${DEATH_RETURN_DELAY_MS}ms`;
    this.root.append(
      el("div", "death-flash"),
      el(
        "h1",
        "death-title",
        serf ? `${serf.name.toUpperCase()} HAS DIED` : "YOUR SERF HAS DIED",
      ),
      el(
        "p",
        "epitaph",
        `Slain${killer ? ` by ${killer}` : ""} in the ${place}. Their story ends here.`,
      ),
      el("h2", "", "A life in the Warrens"),
      life
        ? statList([
            ["Class", className(serf?.classId ?? null)],
            ["Final stats", serf ? statLine(serf) : "—"],
            ["Level reached", String(serf?.level ?? 1)],
            ["Lifetime EXP", String(serf?.exp ?? 0)],
            ["Dungeons entered", String(life.runs)],
            ["Dungeons cleared", String(life.clears)],
            ["Time in dungeons", formatDuration(life.seconds)],
            ["Enemies slain", String(life.enemiesDefeated)],
            ["Damage dealt", String(life.damageDealt)],
            ["Damage taken", String(life.damageTaken)],
            ["Accuracy", accuracy(life)],
          ])
        : statList([["This run", formatDuration(screen.stats.seconds)]]),
      el(
        "p",
        "hint",
        "The dead stay dead. Their record is kept in the Serfs tab.",
      ),
      ret,
    );
  }

  /**
   * Serfs tab (Phase 7b): play as a living serf, create one in a free slot
   * (D-061), and remember the fallen (D-062).
   */
  private buildSerfs(body: HTMLElement): void {
    const list = this.serfs;
    if (!list) {
      body.append(el("p", "hint", "Loading your serfs…"));
      return;
    }
    const living = list.serfs.filter((s) => s.alive);
    const fallen = list.serfs.filter((s) => !s.alive);
    body.append(el("h2", "", `Your serfs (${living.length}/${list.slots})`));
    for (const s of living) {
      const row = el("div", "serf-row");
      const chosen = s.id === list.selectedId;
      row.append(
        el("span", "serf-name", s.name),
        el(
          "span",
          "hint",
          `${className(s.classId)} · Lv ${s.level} · ${s.exp} EXP · ${s.life.clears}/${s.life.runs} clears`,
        ),
        chosen
          ? el("span", "serf-chosen", "Playing")
          : button("Play as", () => this.actions.selectSerf(s.id)),
        statLineNode(s),
      );
      body.append(row);
    }
    if (living.length < list.slots) body.append(this.serfForm());
    if (this.serfError) body.append(el("p", "error", this.serfError));
    if (fallen.length > 0) {
      body.append(el("h2", "fallen-title", "In memoriam"));
      for (const s of fallen) {
        const killer = s.death?.killedBy
          ? (ENEMY_NAMES[s.death.killedBy as keyof typeof ENEMY_NAMES] ??
            s.death.killedBy)
          : "unknown causes";
        body.append(
          el(
            "p",
            "fallen",
            `† ${s.name}: slain by ${killer} after ${s.life.runs} run${s.life.runs === 1 ? "" : "s"}, ${s.life.enemiesDefeated} enemies slain`,
          ),
        );
      }
    }
  }

  /**
   * Stash tab (D-085–D-090): rewards waiting for room first, then the
   * shared stash. Every item can be sold for gold; selling makes room, and
   * the oldest waiting reward moves in (the server decides).
   */
  private buildStash(body: HTMLElement): void {
    const stash = this.stash;
    if (!stash) {
      body.append(el("p", "hint", "Loading your stash…"));
      return;
    }
    if (this.stashError) body.append(el("p", "error", this.stashError));
    body.append(this.upgradeBar(stash));
    const playing = this.playing;
    if (playing) body.append(this.gearPanel(playing));
    if (stash.pending.length > 0) {
      body.append(
        el("h2", "error", `Waiting for room (${stash.pending.length})`),
        el(
          "p",
          "hint",
          "Your stash is full. Sell one of these, or something below; the oldest waiting reward then moves in. The serf that won it cannot start a dungeon until then.",
        ),
        this.itemGrid(
          stash.pending.map((p) => p.item),
          "item-grid pending-grid",
        ),
      );
    }
    body.append(
      el(
        "h2",
        "",
        `Stash ${stash.items.length}/${stash.capacity} · ${formatMoney(stash.gold)}`,
      ),
    );
    if (stash.items.length === 0) {
      body.append(
        el("p", "hint", "Empty. Rewards from cleared dungeons land here."),
      );
      return;
    }
    body.append(
      this.itemGrid(
        stash.items,
        stash.pending.length > 0 || playing ? "item-grid short" : "item-grid",
      ),
    );
  }

  /**
   * Potion rack tab (D-118): potions waiting for room first, then the rack,
   * grouped by stat. Any living serf can drink one while below that stat's
   * class max (the server checks again); any potion can be poured out.
   */
  private buildRack(body: HTMLElement): void {
    const stash = this.stash;
    if (!stash) {
      body.append(el("p", "hint", "Loading your potion rack…"));
      return;
    }
    if (this.stashError) body.append(el("p", "error", this.stashError));
    const waiting = stash.pendingPotions.map((p) => p.potion);
    if (waiting.length > 0) {
      body.append(
        el("h2", "error", `Waiting for room (${waiting.length})`),
        el(
          "p",
          "hint",
          "Your rack is full. Drink or pour out one of these, or one below; the oldest waiting potion then moves in. The serf that won it cannot start a dungeon until then.",
        ),
        this.potionGrid(waiting, "item-grid pending-grid"),
      );
    }
    body.append(
      el("h2", "", `Potion rack ${stash.rack.length}/${stash.rackCapacity}`),
    );
    if (stash.rack.length === 0) {
      body.append(
        el(
          "p",
          "hint",
          "Empty. The Goblin Stronghold can give stat potions: each raises a stat toward its class max.",
        ),
      );
      return;
    }
    body.append(this.potionGrid(stash.rack, "item-grid"));
  }

  /** One card per stat, with how many; drinking or pouring uses the oldest. */
  private potionGrid(
    potions: readonly Potion[],
    className: string,
  ): HTMLElement {
    const grid = el("div", className);
    const living = this.serfs?.serfs.filter((s) => s.alive) ?? [];
    for (const key of STAT_KEYS) {
      const of = potions.filter((p) => p.stat === key);
      const first = of[0];
      if (!first) continue;
      const card = potionCard(key, of.length);
      for (const serf of living) card.append(this.drinkControl(first, serf));
      const pour = button("Pour out one", () =>
        this.actions.pourPotion(first.id),
      );
      pour.classList.add("sell");
      card.append(pour);
      grid.append(card);
    }
    return grid;
  }

  /** Drink on this serf, or the reason it cannot (greyed out, D-118). */
  private drinkControl(potion: Potion, serf: SerfSummary): HTMLElement {
    const box = el("div", "equip");
    const problem = potionProblem(serf, potion.stat);
    // The stat now; its cap stays hidden (D-150).
    const now = ` (${STAT_LABELS[potion.stat]} ${serf.stats[potion.stat]})`;
    const drink = button(`Drink on ${serf.name}${now}`, () => {
      this.drunkBy.set(potion.id, serf.name);
      this.actions.drinkPotion(potion.id, serf.id);
    });
    drink.disabled = problem !== null;
    box.append(drink);
    if (problem) box.append(el("span", "hint", problem));
    return box;
  }

  private itemGrid(items: readonly Item[], className: string): HTMLElement {
    const grid = el("div", className);
    const playing = this.playing;
    for (const item of items) {
      const card = itemCard(
        item,
        playing ? () => this.equipCompares(item, playing) : undefined,
      );
      if (playing) card.append(this.equipControls(item, playing));
      card.append(sellButton(item, () => this.actions.sellItem(item.id)));
      grid.append(card);
    }
    return grid;
  }

  /** The serf's 10 slots (D-082), each with what it wears and Unequip. */
  private gearPanel(serf: SerfSummary): HTMLElement {
    const panel = el("div", "gear");
    panel.append(el("h2", "", `${serf.name}'s gear`));
    const grid = el("div", "gear-grid");
    for (const slot of EQUIP_SLOTS) {
      const worn = serf.items.find((i) => i.equipped === slot);
      const cell = el("div", worn ? "gear-slot filled" : "gear-slot");
      cell.append(el("span", "gear-label", SLOT_LABELS[slot]));
      if (worn) {
        cell.append(itemCard(worn));
        cell.append(
          button("Unequip", () => this.actions.unequip(serf.id, slot)),
        );
      } else {
        cell.append(el("span", "hint", "empty"));
      }
      grid.append(cell);
    }
    panel.append(grid);
    return panel;
  }

  /**
   * Equip buttons for an item on a serf, each with the comparison against
   * what it would replace, shown when the item is hovered (D-086, D-090).
   * Rings go to a free ring slot, or offer both when both are taken.
   */
  private equipControls(
    item: ItemSpec & { id: number },
    serf: SerfSummary,
  ): HTMLElement {
    const box = el("div", "equip");
    if (!canEquip(item, serf.classId)) {
      box.append(
        el(
          "span",
          "hint",
          serf.classId
            ? `A ${className(serf.classId)} cannot use this`
            : "Needs a class (only Tier 0 weapons and armor before level 5)",
        ),
      );
      return box;
    }
    for (const { slot, current } of equipTargets(item, serf)) {
      const label =
        slotsFor(item.slot).length > 1 && current
          ? `Equip on ${serf.name} (${SLOT_LABELS[slot]})`
          : `Equip on ${serf.name}`;
      box.append(
        button(label, () => this.actions.equip(item.id, serf.id, slot)),
      );
    }
    return box;
  }

  /** What equipping would change, for the item's tooltip (D-086, D-156). */
  private equipCompares(item: ItemSpec, serf: SerfSummary): HTMLElement[] {
    if (!canEquip(item, serf.classId)) return [];
    return equipTargets(item, serf).map(({ current }) =>
      compareBox(item, current),
    );
  }

  /**
   * The completion screen's chests (D-049, D-080, D-086): one card per
   * chest, each opening in turn to show the item the server rolled. Each
   * says where its item is now (stash, waiting, worn, sold) and offers
   * Equip now for the serf that cleared, and Sell when it is waiting.
   */
  private lootReveal(
    screen: Extract<Screen, { kind: "results" }>,
  ): HTMLElement {
    const loot = screen.loot;
    const box = el("div", "loot");
    if (loot.length === 0) return box;
    box.append(
      el(
        "p",
        "hint",
        `${loot.length} chest${loot.length === 1 ? "" : "s"} (Luck ${loot.length})`,
      ),
    );
    const row = el("div", "loot-row");
    const statuses: (() => void)[] = [];
    loot.forEach((drop, i) => {
      const card = itemCard(drop.item);
      card.classList.add("loot-card");
      card.style.animationDelay = `${LOOT_FIRST_MS + i * LOOT_GAP_MS}ms`;
      const status = el("div", "loot-status");
      card.append(status);
      const update = () => {
        status.replaceChildren();
        const serf = screen.serf
          ? (this.serfById(screen.serf.id) ?? screen.serf)
          : null;
        const worn = serf?.items.some((it) => it.id === drop.item.id) ?? false;
        const inStash = this.stash
          ? this.stash.items.some((it) => it.id === drop.item.id)
          : !drop.pending;
        const waiting = this.stash
          ? this.stash.pending.some((p) => p.item.id === drop.item.id)
          : drop.pending;
        card.classList.toggle("waiting", waiting);
        if (worn) {
          status.append(el("span", "roll-good", `Equipped on ${serf?.name}`));
          return;
        }
        if (!inStash && !waiting) {
          status.append(el("span", "item-where", "Sold"));
          return;
        }
        status.append(
          waiting
            ? el(
                "span",
                "error",
                "Stash full: sell this or something in the stash",
              )
            : el("span", "item-where", "→ Stash"),
        );
        if (serf?.alive) status.append(this.equipControls(drop.item, serf));
        if (waiting) {
          status.append(
            sellButton(drop.item, () => this.actions.sellItem(drop.item.id)),
          );
        }
      };
      update();
      statuses.push(update);
      row.append(card);
    });
    this.lootRefresh = () => statuses.forEach((u) => u());
    box.append(row);
    return box;
  }

  /**
   * The potions this clear won (D-118), opening after the chests. Each
   * says where it is (rack, waiting, drunk, poured out) and offers Drink
   * now for the serf that cleared, and Pour out when it is waiting.
   */
  private potionReveal(
    screen: Extract<Screen, { kind: "results" }>,
  ): HTMLElement {
    const box = el("div", "loot");
    if (screen.potions.length === 0) return box;
    box.append(
      el(
        "p",
        "hint",
        `${screen.potions.length} stat potion${screen.potions.length === 1 ? "" : "s"}`,
      ),
    );
    const row = el("div", "loot-row");
    const statuses: (() => void)[] = [];
    screen.potions.forEach(({ potion, pending }, i) => {
      const card = potionCard(potion.stat, 1);
      card.classList.add("loot-card");
      card.style.animationDelay = `${LOOT_FIRST_MS + (screen.loot.length + i) * LOOT_GAP_MS}ms`;
      const status = el("div", "loot-status");
      card.append(status);
      const update = () => {
        status.replaceChildren();
        const serf = screen.serf
          ? (this.serfById(screen.serf.id) ?? screen.serf)
          : null;
        const inRack = this.stash
          ? this.stash.rack.some((p) => p.id === potion.id)
          : !pending;
        const waiting = this.stash
          ? this.stash.pendingPotions.some((p) => p.potion.id === potion.id)
          : pending;
        card.classList.toggle("waiting", waiting);
        if (!inRack && !waiting) {
          const who = this.drunkBy.get(potion.id);
          status.append(
            who
              ? el("span", "roll-good", `Drunk by ${who}`)
              : el("span", "item-where", "Poured out"),
          );
          return;
        }
        status.append(
          waiting
            ? el("span", "error", "Rack full: drink it or pour one out")
            : el("span", "item-where", "→ Potion rack"),
        );
        if (serf?.alive) status.append(this.drinkControl(potion, serf));
        if (waiting) {
          const pour = button("Pour out", () =>
            this.actions.pourPotion(potion.id),
          );
          pour.classList.add("sell");
          status.append(pour);
        }
      };
      update();
      statuses.push(update);
      row.append(card);
    });
    const chests = this.lootRefresh;
    this.lootRefresh = () => {
      chests?.();
      statuses.forEach((u) => u());
    };
    box.append(row);
    return box;
  }

  /**
   * Leaderboards (GDD §12, D-148): living and dead, serf names only. Pick a
   * board; lifetime EXP filters by class, the fastest clears by dungeon and
   * Solo only.
   */
  private buildLeaderboard(body: HTMLElement): void {
    const q = this.leaderboardQuery;
    const boards = el("div", "lb-boards");
    for (const b of LEADERBOARD_BOARDS) {
      const pick = button(BOARD_NAMES[b], () => this.pickBoard({ board: b }));
      if (b === q.board) pick.classList.add("active");
      boards.append(pick);
    }
    body.append(boards);
    const filters = el("div", "lb-filters");
    if (q.board === "exp") {
      filters.append(
        select(
          [
            ["", "All classes"],
            ...CLASS_IDS.map((c) => [c, CLASSES[c].name] as const),
          ],
          q.classId ?? "",
          (v) => this.pickBoard({ classId: v === "" ? null : (v as ClassId) }),
        ),
      );
    } else if (q.board === "fastest") {
      filters.append(
        select(
          LISTED_DUNGEONS.map((d) => [d.id, d.name] as const),
          q.dungeon ?? "",
          (v) => this.pickBoard({ dungeon: v as DungeonId }),
        ),
      );
      const solo = document.createElement("label");
      solo.className = "setting";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = q.soloOnly;
      box.addEventListener("change", () =>
        this.pickBoard({ soloOnly: box.checked }),
      );
      solo.append(box, " Solo only");
      filters.append(solo);
    }
    if (filters.childElementCount > 0) body.append(filters);
    const entries = this.leaderboard;
    if (!entries) {
      body.append(el("p", "hint", "Loading…"));
      return;
    }
    if (entries.length === 0) {
      body.append(
        el(
          "p",
          "hint",
          q.board === "fastest"
            ? "No clears recorded here yet. Clear times count from Phase 15 on."
            : "Nobody is on this board yet.",
        ),
      );
      return;
    }
    const table = el("div", "leaderboard");
    for (const e of entries) {
      const row = el("div", e.alive ? "lb-row" : "lb-row dead");
      row.append(
        el("span", "lb-rank", `#${e.rank}`),
        el("span", "lb-name", e.alive ? e.name : `† ${e.name}`),
        el("span", "", className(e.classId)),
        el("span", "", `Lv ${e.level}`),
        el("span", "lb-exp", boardValue(q.board, e)),
      );
      table.append(row);
    }
    body.append(
      table,
      el(
        "p",
        "hint",
        "The fallen keep their final score. † marks a dead serf.",
      ),
    );
  }

  private serfForm(): HTMLElement {
    const form = document.createElement("form");
    form.className = "serf-form";
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = `New serf's name (${SERF_NAME_MIN}–${SERF_NAME_MAX})`;
    name.setAttribute("aria-label", "New serf's name");
    name.maxLength = SERF_NAME_MAX;
    name.value = this.typedSerfName;
    name.addEventListener("input", () => (this.typedSerfName = name.value));
    const suggest = button("Suggest", () => {
      name.value = suggestSerfName();
      this.typedSerfName = name.value;
    });
    const create = document.createElement("button");
    create.type = "submit";
    create.textContent = "Create serf";
    form.append(name, suggest, create);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const clean = normalizeSerfName(name.value);
      const problem = serfNameProblem(clean);
      if (problem) {
        this.setSerfError(problem);
        return;
      }
      this.actions.createSerf(clean);
    });
    return form;
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
    const mustChoose = screen.serf !== null && needsClass(screen.serf);
    const waiting =
      screen.loot.some((d) => d.pending) ||
      screen.potions.some((d) => d.pending);
    actions.append(
      waiting
        ? button("Settle rewards (Enter)", () => this.settleRewards(screen))
        : mustChoose
          ? button("Choose your class (Enter)", () =>
              this.actions.dismissResults(),
            )
          : this.followsLeader
            ? el("p", "hint", "Your party's leader picks the next dungeon.")
            : button(`Requeue ${info.name} (Enter)`, () =>
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
      expGain(screen.serf, screen.expGained, screen.dungeon, screen.statGains),
      stats,
      chest,
      this.lootReveal(screen),
      this.potionReveal(screen),
      actions,
    );
  }

  /** To the Stash tab (or the Potion rack, D-118), where waiting rewards are settled. */
  private settleRewards(screen: Extract<Screen, { kind: "results" }>): void {
    this.actions.dismissResults();
    this.actions.openTab(screen.loot.some((d) => d.pending) ? "stash" : "rack");
  }

  private onKey(e: KeyboardEvent): void {
    const screen = this.shown;
    // A focused button already handles Enter itself (as a click).
    if (!screen || e.repeat || e.target instanceof HTMLButtonElement) return;
    if (e.key === "Enter") {
      if (screen.kind === "menu" && screen.tab === "dungeons") {
        const first = LISTED_DUNGEONS[0];
        const playing = this.playing;
        if (!playing) this.actions.openTab("serfs");
        else if (needsClass(playing))
          return; // pick a class with the mouse
        else if (this.followsLeader) return;
        else if (first) this.actions.queue(first.id);
      } else if (screen.kind === "results" && screen.result === "completed") {
        // A full stash first, then a class at level 5; otherwise requeue.
        if (
          screen.loot.some((d) => d.pending) ||
          screen.potions.some((d) => d.pending)
        ) {
          this.settleRewards(screen);
        } else if (
          (screen.serf && needsClass(screen.serf)) ||
          this.followsLeader
        )
          this.actions.dismissResults();
        else this.actions.queue(screen.dungeon);
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

const BOARD_NAMES: Record<LeaderboardBoard, string> = {
  exp: "Lifetime EXP",
  clears: "Most clears",
  kills: "Enemies slain",
  fastest: "Fastest clear",
};

/** A board's score: EXP, clears, kills, or a clear time with its party size. */
export function boardValue(
  board: LeaderboardBoard,
  e: LeaderboardEntry,
): string {
  switch (board) {
    case "exp":
      return `${e.value} EXP`;
    case "clears":
      return `${e.value} clear${e.value === 1 ? "" : "s"}`;
    case "kills":
      return `${e.value} slain`;
    case "fastest":
      return `${formatDuration(e.value)} · ${e.partySize === 1 ? "solo" : `party of ${e.partySize ?? "?"}`}`;
  }
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
 * "+100 EXP" with a bar filling from the old EXP to the new, and a
 * LEVEL UP burst when a level was gained (D-049: maximum celebration).
 */
function expGain(
  serf: SerfSummary | null,
  gained: number,
  dungeon: DungeonId,
  statGains: Stats,
): HTMLElement {
  const box = el("div", "exp-gain");
  if (!serf || gained <= 0) return box;
  const { base, topLevel } = DUNGEON_EXP[dungeon];
  const before = levelProgress(serf.exp - gained);
  const after = levelProgress(serf.exp);
  const leveled = after.level > before.level;
  const bar = el("div", "exp-bar");
  const fill = el("div", "exp-fill");
  const fraction = (p: { into: number; needed: number }) =>
    p.needed === 0 ? 1 : p.into / p.needed;
  // Start where the serf was; after the stats count up, fill to where it is.
  fill.style.width = `${(leveled ? 0 : fraction(before)) * 100}%`;
  setTimeout(() => (fill.style.width = `${fraction(after) * 100}%`), 900);
  bar.append(fill);
  box.append(
    el("p", "exp-plus", `+${gained} EXP`),
    bar,
    el(
      "p",
      "hint",
      after.needed === 0
        ? `Level ${after.level} (max) · ${serf.exp} lifetime EXP`
        : `Level ${after.level} · ${after.into}/${after.needed} to level ${after.level + 1}`,
    ),
  );
  if (gained < base) {
    // D-071: say why, so a smaller number does not look like a bug.
    box.append(
      el(
        "p",
        "hint",
        `Reduced EXP: this dungeon is aimed at levels up to ${topLevel}.`,
      ),
    );
  }
  if (leveled) {
    const up = el("p", "level-up", `LEVEL UP! Level ${after.level}`);
    box.append(up);
    // The server's rolls for this level (D-074), revealed after the burst.
    const rolls = STAT_KEYS.filter((key) => statGains[key] > 0);
    if (rolls.length > 0) {
      const line = el("p", "stat-gains");
      for (const key of rolls) {
        line.append(el("span", "", `+${statGains[key]} ${STAT_LABELS[key]}`));
      }
      box.append(line);
    }
    if (
      before.level < CLASS_CHOICE_LEVEL &&
      after.level >= CLASS_CHOICE_LEVEL
    ) {
      box.append(
        el(
          "p",
          "level-up-note",
          `Level ${CLASS_CHOICE_LEVEL}: choose your class!`,
        ),
      );
    }
  }
  return box;
}

/**
 * "Sell to Lord": a click shows what he pays and asks to confirm (the
 * user, 2026-10-26). Tier 0 is worth nothing (D-157). The server pays the
 * same.
 */
function sellButton(item: ItemSpec, onSell: () => void): HTMLElement {
  const wrap = el("div", "sell-control");
  const small = (b: HTMLButtonElement) => {
    b.classList.add("sell");
    return b;
  };
  const ask = small(
    button("Sell to Lord", () => {
      const price = sellPrice(item);
      const worth = el("span", "sell-worth", "Worth ");
      if (price > 0) worth.append(moneyEl(price));
      else worth.textContent = "Worth nothing: it will be gone.";
      wrap.replaceChildren(
        worth,
        small(button("Confirm", onSell)),
        small(button("Cancel", () => wrap.replaceChildren(ask))),
      );
    }),
  );
  wrap.append(ask);
  return wrap;
}

/** "HP 23 · MP 12 · … · LUCK 1"; a classed serf shows its maxes (D-075) too. */
export function statLine(serf: SerfSummary): string {
  return [
    ...STAT_KEYS.map((key) => `${STAT_LABELS[key]} ${statText(serf, key)}`),
    `LUCK ${statText(serf, "luck")}`,
  ].join(" · ");
}

/** statLine with coloured brackets, for the Serfs tab (D-151). */
export function statLineNode(serf: SerfSummary): HTMLElement {
  const out = el("span", "serf-stats");
  [...STAT_KEYS, "luck" as const].forEach((key, i) => {
    if (i > 0) out.append(" · ");
    out.append(
      key === "luck" ? "LUCK " : `${STAT_LABELS[key]} `,
      statNode(serf, key),
    );
  });
  return out;
}

/**
 * A stat's sources (D-151): the total, what worn gear adds, and what
 * potions added; the base (levels, the class bonus) is the rest. Luck is
 * 1 plus worn Luck items, and no potion raises it (D-066, D-068).
 */
export function statParts(
  serf: SerfSummary,
  key: StatKey | "luck",
): { total: number; gear: number; potions: number } {
  if (key === "luck") {
    const total = luckOf(serf.items.filter((i) => i.equipped !== null));
    return { total, gear: total - BASE_LUCK, potions: 0 };
  }
  const total = loadoutOf(serf).stats[key];
  return {
    total,
    gear: total - serf.stats[key],
    potions: serf.potionStats[key],
  };
}

const signed = (n: number) => `(${n < 0 ? "−" : "+"}${Math.abs(n)})`;

/**
 * One stat as text, "25 (+3)(+1)" (D-151, the user): the total, then gear,
 * then potions; a source adding nothing is left out. The caps are never
 * shown (D-150).
 */
export function statText(serf: SerfSummary, key: StatKey | "luck"): string {
  const { total, gear, potions } = statParts(serf, key);
  return [
    String(total),
    gear !== 0 ? signed(gear) : "",
    potions !== 0 ? signed(potions) : "",
  ]
    .filter((s) => s !== "")
    .join(" ");
}

/** The same, with gear and potion brackets coloured apart (one may show alone). */
export function statNode(
  serf: SerfSummary,
  key: StatKey | "luck",
): HTMLElement {
  const { total, gear, potions } = statParts(serf, key);
  const out = el("span", "", String(total));
  if (gear !== 0) out.append(" ", el("span", "src-gear", signed(gear)));
  if (potions !== 0) out.append(" ", el("span", "src-potion", signed(potions)));
  return out;
}

/** Display names of the 10 worn slots (D-082). */
const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: "Weapon",
  ability: "Ability item",
  head: "Head",
  chest: "Chest",
  legs: "Legs",
  gloves: "Gloves",
  ring1: "Ring 1",
  ring2: "Ring 2",
  necklace: "Necklace",
  cape: "Cape",
};

/** Where an item could go on a serf, and what it would replace there. */
function equipTargets(
  item: ItemSpec,
  serf: SerfSummary,
): { slot: EquipSlot; current: Item | null }[] {
  const worn = (slot: EquipSlot) =>
    serf.items.find((i) => i.equipped === slot) ?? null;
  const slots = slotsFor(item.slot);
  const free = slots.find((slot) => worn(slot) === null);
  if (slots.length > 1 && free) return [{ slot: free, current: null }];
  return slots.map((slot) => ({ slot, current: worn(slot) }));
}

/** "vs T0 Ring: +2 SPD −1 HP" (and damage for weapons), shown on hover. */
function compareBox(next: ItemSpec, current: Item | null): HTMLElement {
  const box = el("div", "compare");
  box.append(
    el(
      "span",
      "hint",
      current ? `vs ${itemFullName(current)}` : "vs empty slot",
    ),
  );
  const diff = compareItems(next, current);
  const line = el("span", "compare-line");
  if (next.slot === "weapon") {
    const d =
      weaponDamage(next.tier) - weaponDamage(current ? current.tier : null);
    if (d !== 0)
      line.append(
        el(
          "span",
          d > 0 ? "roll-good" : "roll-bad",
          `${d > 0 ? "+" : "−"}${Math.abs(d)} damage`,
        ),
      );
  }
  for (const key of STAT_KEYS) {
    const d = diff[key];
    if (d !== 0)
      line.append(
        el(
          "span",
          d > 0 ? "roll-good" : "roll-bad",
          `${d > 0 ? "+" : "−"}${Math.abs(d)} ${STAT_LABELS[key]}`,
        ),
      );
  }
  const luck = next.luck - (current?.luck ?? 0);
  if (luck !== 0)
    line.append(
      el(
        "span",
        luck > 0 ? "item-luck" : "roll-bad",
        `${luck > 0 ? "+" : "−"}1 LUCK`,
      ),
    );
  if (line.childElementCount === 0)
    line.append(el("span", "hint", "no change"));
  box.append(line);
  return box;
}

function statList(rows: [string, string][]): HTMLElement {
  const dl = el("dl", "stats");
  for (const [k, v] of rows) dl.append(el("dt", "", k), el("dd", "", v));
  return dl;
}
