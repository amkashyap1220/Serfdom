import {
  entryProblem,
  levelForExp,
  dungeonInfo,
  MAX_SEED,
  consumeFixedSteps,
  encodeMessage,
  MAX_FRAME_SECONDS,
  MAX_MESSAGE_BYTES,
  needsClass,
  SERF_BASE,
  zeroStats,
  parseClientMessage,
  PROTOCOL_VERSION,
  TICK_RATE,
  TICK_SECONDS,
  type ClientMessage,
  type DungeonId,
  type ServerMessage,
  loadoutOf,
  type Loadout,
  normalizeSerfName,
  normalizeLeaderboardQuery,
  type LeaderboardQuery,
  type ArtifactId,
  MAX_PARTY_SIZE,
  type ClassId,
  type PartyMember,
  type SerfSummary,
} from "@serfdom/shared";
import { randomInt } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AccountService, AuthResult } from "./auth/account-service.ts";
import type { SerfService } from "./serfs/serf-service.ts";
import { DungeonInstance, type RunEnd } from "./dungeon-instance.ts";
import { consoleLogger, type Logger } from "./log.ts";
import { Matchmaker } from "./matchmaking.ts";
import { MessageRateLimiter } from "./rate-limit.ts";
import {
  Parties,
  type AnswerRefusal,
  type Invite,
  type InviteRefusal,
  type Leaving,
} from "./parties.ts";

export interface GameServerOptions {
  /** TCP port; 0 picks a free port (used by tests). */
  port: number;
  /** Accounts and logins (Phase 7a). Every player must log in before queueing. */
  accounts: AccountService;
  /** Serfs (Phase 7b). Queueing needs a chosen living serf. */
  serfs: SerfService;
  /** Close connections that have not sent a valid hello within this time. */
  helloTimeoutMs?: number;
  /** Close a connection after this many invalid messages. */
  maxInvalidMessages?: number;
  /** Run the 60 Hz simulation on a real clock. Tests turn this off and call tick(). */
  autoTick?: boolean;
  /** Send a snapshot every N ticks (1 → 60 Hz; chosen for low delay, D-042). */
  snapshotEveryTicks?: number;
  /** Per-player input queue limit; extra inputs are dropped. */
  maxQueuedInputs?: number;
  /** Close a connection that sends more than this many messages in one second. */
  maxMessagesPerSecond?: number;
  /** Longest a queued player waits before their run starts with whoever is there (T-030). */
  queueWaitSeconds?: number;
  /** A run accepts new players from the queue for this long after it starts (D-052). */
  joinWindowSeconds?: number;
  /**
   * Picks each new run's layout seed (D-104). Default: a random seed from
   * 1 to MAX_SEED; tests pass () => 0 for the fixed handcrafted Warrens.
   */
  dungeonSeed?: () => number;
  /**
   * Let players queue for unlisted test fixtures (the Training Yard).
   * Off by default: otherwise a modified client could farm a one-dummy
   * map for EXP and loot (D-107). Tests turn it on.
   */
  allowTestDungeons?: boolean;
  log?: Logger;
}

/** WebSocket close code for "policy violation" (RFC 6455). */
const CLOSE_POLICY = 1008;

interface Session {
  /** Guest id, assigned after a valid hello; null until then. */
  id: number | null;
  invalidMessages: number;
  helloTimer: ReturnType<typeof setTimeout> | undefined;
  rate: MessageRateLimiter;
  /** Logged-in account, or null (D-058). */
  accountId: number | null;
  /** The login token, kept to delete the session on logout. */
  token: string | null;
  /** A register/login/resume is waiting for the database. */
  authBusy: boolean;
  /** The living serf this connection plays as, or null (D-062). */
  serfId: number | null;
  /** A createSerf/selectSerf/chooseClass is waiting for the database. */
  serfBusy: boolean;
  /**
   * The chosen serf has reached level 5 without a class and may not queue
   * (D-073). Updated whenever the server learns the serf's state: on
   * select/create, after each recorded run, and on chooseClass.
   */
  serfNeedsClass: boolean;
  /** Rewards wait for the chosen serf (full stash): it may not queue (D-088). */
  serfBlocked: boolean;
  /** The chosen serf's lifetime completions: none yet means only the Warrens (D-107). */
  serfClears: number;
  /** The serf's level, from its lifetime EXP (the endgame dungeons need 20, D-136). */
  serfLevel: number;
  /** The chosen serf's stats with gear and weapon, kept current at the same moments (D-077, D-083). */
  serfLoadout: Loadout;
  /** The chosen serf's name and class: how others find and see you (invites by name, D-142). */
  serfName: string | null;
  serfClass: ClassId | null;
  /** A leaderboard query is in flight; the latest one asked meanwhile waits. */
  boardBusy: boolean;
  boardNext: LeaderboardQuery | null;
}

/** PROVISIONAL (T-030): a solo player never waits longer than this for a run. */
const DEFAULT_QUEUE_WAIT_SECONDS = 5;
/** D-052 (user, 2026-10-22): runs accept joiners for their first 15 s. */
const DEFAULT_JOIN_WINDOW_SECONDS = 15;
/** D-143: an invite lapses after a minute. */
const INVITE_SECONDS = 60;
/** PROVISIONAL (D-143 "a rate limit"): at most 10 invites a minute per player. */
const MAX_INVITES_PER_MINUTE = 10;

const INVITE_REFUSALS: Record<InviteRefusal, (name: string) => string> = {
  self: () => "You can't invite yourself.",
  alreadyMember: (name) => `${name} is already in your party.`,
  inParty: (name) => `${name} is already in a party.`,
  alreadyInvited: (name) => `You have already invited ${name}.`,
  full: () => "Your party is full.",
  tooMany: () => "Too many invites. Wait a minute and try again.",
};

const ANSWER_REFUSALS: Record<AnswerRefusal, string> = {
  gone: "That invite is no longer open.",
  inParty: "Leave your party first.",
  full: "That party is full.",
};

/**
 * Authoritative game server.
 *
 * Phase 4: connections, guest ids, presence (4a); server-owned movement with
 * snapshots (4b); tuned for the D-042 delay target (4c).
 * Phase 5b: owns the combat simulation (D-043). Clients only ever send
 * intents; HP, hits, and defeats are decided here.
 * Phase 6a: every joined player is in exactly one place: the menu, the
 * dungeon queue (`Matchmaker`, D-051), or one `DungeonInstance` (a run with
 * its own simulation). Each tick it first moves queued players into a run
 * of their dungeon that is still inside its 15 s join window and has room
 * (D-052), then starts new runs that are ready, ticks every instance, sends each instance's snapshot to
 * its members only, and sends `runEnded` (with server-counted stats) to
 * anyone whose run ended by death, completion, R, or disconnect.
 *
 * Every incoming message is validated (T-021). Bad messages get an error
 * reply; repeated bad messages, floods, oversized messages, a wrong protocol
 * version, or no hello in time close the connection.
 */
export class GameServer {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly log: Logger;
  private readonly helloTimeoutMs: number;
  private readonly maxInvalidMessages: number;
  private readonly snapshotEveryTicks: number;
  private readonly maxQueuedInputs: number;
  private readonly dungeonSeed: () => number;
  private readonly allowTestDungeons: boolean;
  private readonly maxMessagesPerSecond: number;
  private readonly joinWindowTicks: number;
  private readonly matchmaker: Matchmaker;
  private readonly parties = new Parties({
    inviteTicks: INVITE_SECONDS * TICK_RATE,
    rateWindowTicks: 60 * TICK_RATE,
    maxInvites: MAX_INVITES_PER_MINUTE,
  });
  private readonly instances = new Map<number, DungeonInstance>();
  /** Each run's last room list sent, so it goes out only on change (D-147). */
  private readonly roomsSent = new Map<number, string>();
  private readonly runOf = new Map<number, DungeonInstance>();
  private readonly socketOf = new Map<number, WebSocket>();
  /** One logged-in connection per account. */
  private readonly accountSocket = new Map<number, WebSocket>();
  private readonly accounts: AccountService;
  private readonly serfs: SerfService;
  /** Whose serf each player in a run is, fixed when the run starts (for recording it). */
  private readonly runOwner = new Map<
    number,
    { accountId: number; serfId: number }
  >();
  private nextPlayerId = 1;
  private nextInstanceId = 1;
  private tickCount = 0;
  private loop: ReturnType<typeof setInterval> | undefined;
  /** Size in bytes of the most recent snapshot (diagnostics). */
  lastSnapshotBytes = 0;

  private constructor(wss: WebSocketServer, options: GameServerOptions) {
    this.wss = wss;
    this.log = options.log ?? consoleLogger;
    this.accounts = options.accounts;
    this.serfs = options.serfs;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
    this.maxInvalidMessages = options.maxInvalidMessages ?? 5;
    this.snapshotEveryTicks = options.snapshotEveryTicks ?? 1;
    this.maxQueuedInputs = options.maxQueuedInputs ?? 30;
    this.dungeonSeed =
      options.dungeonSeed ?? (() => randomInt(1, MAX_SEED + 1));
    this.allowTestDungeons = options.allowTestDungeons ?? false;
    this.maxMessagesPerSecond = options.maxMessagesPerSecond ?? 180;
    this.joinWindowTicks = Math.round(
      (options.joinWindowSeconds ?? DEFAULT_JOIN_WINDOW_SECONDS) * TICK_RATE,
    );
    this.matchmaker = new Matchmaker(
      Math.round(
        (options.queueWaitSeconds ?? DEFAULT_QUEUE_WAIT_SECONDS) * TICK_RATE,
      ),
    );
    wss.on("connection", (socket) => this.onConnection(socket));
    if (options.autoTick ?? true) this.startLoop();
  }

  /** Starts listening; rejects if the port cannot be used (e.g. already in use). */
  static start(options: GameServerOptions): Promise<GameServer> {
    return new Promise((resolve, reject) => {
      // maxPayload makes ws itself drop oversized frames (close code 1009)
      // before we ever decode them.
      const wss = new WebSocketServer({
        port: options.port,
        maxPayload: MAX_MESSAGE_BYTES,
      });
      wss.once("listening", () => resolve(new GameServer(wss, options)));
      wss.once("error", reject);
    });
  }

  get port(): number {
    const address = this.wss.address();
    if (address === null) throw new Error("Server is not listening");
    if (typeof address === "string") throw new Error("Unexpected pipe address");
    return address.port;
  }

  /** Ids of players who have completed the hello handshake. */
  get playerIds(): number[] {
    return [...this.sessions.values()]
      .map((s) => s.id)
      .filter((id): id is number => id !== null);
  }

  /** The run a player is in, if any (tests and diagnostics). */
  instanceOf(playerId: number): DungeonInstance | undefined {
    return this.runOf.get(playerId);
  }

  /** Number of runs in progress. */
  get runCount(): number {
    return this.instances.size;
  }

  /** The members of a player's party, leader first, or [] (tests and diagnostics). */
  partyMembers(playerId: number): number[] {
    return [...(this.parties.partyOf(playerId)?.members ?? [])];
  }

  isQueued(playerId: number): boolean {
    return this.matchmaker.has(playerId);
  }

  /** Number of inputs waiting to be applied for a player (tests and diagnostics). */
  queuedInputs(playerId: number): number {
    return this.runOf.get(playerId)?.queuedInputs(playerId) ?? 0;
  }

  /**
   * Advances everything one fixed tick (called by the loop, or directly by
   * tests): start runs that are ready, tick every run, send snapshots.
   */
  tick(): void {
    for (const lapsed of this.parties.expire(this.tickCount)) {
      this.inviteWithdrawn(lapsed);
      this.partyNotice(
        [lapsed.from],
        `Your invite to ${this.nameOf(lapsed.to)} expired.`,
      );
    }
    this.joinOpenRuns();
    for (const run of this.matchmaker.takeReady(this.tickCount)) {
      this.startRun(run.dungeon, run.players);
    }
    this.tickCount++;
    const sendSnapshots = this.tickCount % this.snapshotEveryTicks === 0;
    for (const instance of this.instances.values()) {
      const { ended, faulted, spent } = instance.tick();
      for (const s of spent) this.spendArtifact(s.playerId, s.artifact);
      for (const id of faulted) {
        // Should be impossible after validation; drop only this player
        // rather than crashing the server for everyone.
        this.log.warn(`guest #${id} input error; disconnecting`);
        this.runOf.delete(id);
        this.socketOf.get(id)?.close(CLOSE_POLICY, "invalid state");
      }
      for (const end of ended) this.finishRun(instance, end, true);
      this.sendRoomsIfChanged(instance);
      if (sendSnapshots && !instance.isEmpty) {
        const encoded = encodeMessage(instance.snapshot(this.tickCount));
        this.lastSnapshotBytes = Buffer.byteLength(encoded);
        for (const id of instance.playerIds) this.sendEncoded(id, encoded);
      }
      if (instance.isEmpty) {
        this.instances.delete(instance.id);
        this.roomsSent.delete(instance.id);
      }
    }
  }

  close(): Promise<void> {
    clearInterval(this.loop);
    for (const socket of this.sessions.keys()) socket.terminate();
    return new Promise((resolve, reject) =>
      this.wss.close((err) => (err ? reject(err) : resolve())),
    );
  }

  /**
   * Timers are imprecise (especially on Windows), so the loop measures real
   * elapsed time and runs however many whole 1/60 s ticks are due, the same
   * fixed-step accumulator the client uses.
   */
  private startLoop(): void {
    let last = performance.now();
    let carried = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      const { steps, remainder } = consumeFixedSteps(
        carried,
        (now - last) / 1000,
        TICK_SECONDS,
        MAX_FRAME_SECONDS,
      );
      last = now;
      carried = remainder;
      for (let i = 0; i < steps; i++) this.tick();
    }, 4);
  }

  private onConnection(socket: WebSocket): void {
    const session: Session = {
      id: null,
      invalidMessages: 0,
      helloTimer: setTimeout(() => {
        this.log.warn("connection closed: no hello in time");
        socket.close(CLOSE_POLICY, "hello timeout");
      }, this.helloTimeoutMs),
      rate: new MessageRateLimiter(this.maxMessagesPerSecond),
      accountId: null,
      token: null,
      authBusy: false,
      serfId: null,
      serfBusy: false,
      serfNeedsClass: false,
      serfBlocked: false,
      serfClears: 0,
      serfLevel: 1,
      serfLoadout: {
        stats: SERF_BASE,
        weaponTier: null,
        weaponType: null,
        ability: null,
      },
      serfName: null,
      serfClass: null,
      boardBusy: false,
      boardNext: null,
    };
    this.sessions.set(socket, session);

    socket.on("message", (data, isBinary) =>
      this.onMessage(socket, session, data, isBinary),
    );
    socket.on("close", () => this.onClose(socket, session));
    socket.on("error", (err) =>
      this.log.warn(`${label(session)} socket error: ${err.message}`),
    );
  }

  private onMessage(
    socket: WebSocket,
    session: Session,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (!session.rate.hit(performance.now())) {
      this.log.warn(`${label(session)} closed: message rate limit`);
      socket.close(CLOSE_POLICY, "rate limit");
      return;
    }
    if (isBinary) {
      this.reject(socket, session, "binary messages are not accepted");
      return;
    }
    const parsed = parseClientMessage(rawToString(data));
    if (!parsed.ok) {
      this.reject(socket, session, parsed.error);
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case "hello":
        this.onHello(socket, session, message.protocol);
        return;
      case "input": {
        if (session.id === null) {
          this.reject(socket, session, "send hello first");
          return;
        }
        // Inputs that arrive after a run ended (in flight while the client
        // learned of it) are expected and ignored, not errors.
        const instance = this.runOf.get(session.id);
        if (!instance) return;
        const result = instance.queueInput(session.id, message.seq, {
          move: message.move,
          fire: message.fire,
          ability: message.ability,
        });
        if (result.kind === "rejected") {
          this.reject(socket, session, result.reason);
        }
        return;
      }
      case "queue":
        if (session.id === null) {
          this.reject(socket, session, "send hello first");
          return;
        }
        if (session.accountId === null) {
          this.reject(socket, session, "log in first");
          return;
        }
        if (session.serfId === null) {
          this.reject(socket, session, "choose a serf first");
          return;
        }
        if (session.serfBlocked) {
          this.reject(socket, session, "settle your rewards first");
          return;
        }
        if (session.serfNeedsClass) {
          this.reject(socket, session, "choose a class first");
          return;
        }
        // The Warrens is open to all; completing it opens every other
        // listed dungeon, at any level (D-107). Unlisted test fixtures
        // exist only for tests.
        if (!dungeonInfo(message.dungeon).listed) {
          if (!this.allowTestDungeons) {
            this.reject(socket, session, "queue: unknown dungeon");
            return;
          }
        } else {
          const problem = entryProblem(
            message.dungeon,
            session.serfClears,
            session.serfLevel,
          );
          if (problem) {
            this.reject(socket, session, problem);
            return;
          }
        }
        // A party queues together, and only its leader picks (D-143).
        if (this.parties.partyOf(session.id)) {
          this.onPartyQueue(session.id, message.dungeon);
          return;
        }
        this.onQueue(socket, session, session.id, message.dungeon);
        return;
      case "register":
      case "login":
      case "resume":
        this.onAuth(socket, session, message);
        return;
      case "createSerf":
      case "selectSerf":
      case "chooseClass":
        this.onSerf(socket, session, message);
        return;
      case "getStash":
      case "sellItem":
      case "equipItem":
      case "unequipItem":
      case "drinkPotion":
      case "pourPotion":
        this.onStash(socket, session, message);
        return;
      case "partyInvite":
      case "partyAnswer":
      case "partyLeave":
      case "partyKick":
        this.onParty(socket, session, message);
        return;
      case "getLeaderboard": {
        if (session.accountId === null) {
          this.reject(socket, session, "log in first");
          return;
        }
        const query = normalizeLeaderboardQuery(message);
        if (
          query.board === "fastest" &&
          (query.dungeon === null || !dungeonInfo(query.dungeon).listed)
        ) {
          this.reject(socket, session, "getLeaderboard: pick a listed dungeon");
          return;
        }
        this.onLeaderboard(socket, session, query);
        return;
      }
      case "logout":
        if (session.accountId === null) return;
        if (session.token) {
          this.accounts
            .logout(session.token)
            .catch((err: unknown) =>
              this.log.warn(`${label(session)} logout failed: ${String(err)}`),
            );
        }
        this.logOut(socket, "Logged out.");
        return;
      case "leaveQueue": {
        if (session.id === null) return;
        if (
          this.unqueue(session.id, `${this.nameOf(session.id)} left the queue.`)
        ) {
          this.log.info(`${label(session)} left the queue`);
        }
        return;
      }
      case "exitDungeon": {
        if (session.id === null) return;
        const instance = this.runOf.get(session.id);
        const end = instance?.leave(session.id);
        if (instance && end) this.finishRun(instance, end, true);
        return;
      }
    }
  }

  /**
   * Register, login, or resume (D-058). The database answers later, so the
   * connection is marked busy meanwhile; one attempt at a time. A failed
   * attempt is not an "invalid message" (players mistype passwords); the
   * account service throttles guessing instead.
   */
  private onAuth(
    socket: WebSocket,
    session: Session,
    message: Extract<ClientMessage, { type: "register" | "login" | "resume" }>,
  ): void {
    if (session.id === null) {
      this.reject(socket, session, "send hello first");
      return;
    }
    if (session.accountId !== null) {
      this.reject(socket, session, "already logged in");
      return;
    }
    if (session.authBusy) {
      this.reject(socket, session, "already logging in");
      return;
    }
    session.authBusy = true;
    let attempt: Promise<AuthResult>;
    if (message.type === "resume") {
      attempt = this.accounts.resume(message.token);
    } else if (message.type === "register") {
      attempt = this.accounts.register(message.email, message.password);
    } else {
      attempt = this.accounts.login(message.email, message.password);
    }
    attempt
      .then((result) => {
        if (!this.sessions.has(socket)) return; // disconnected meanwhile
        if (!result.ok) {
          this.send(socket, { type: "authError", reason: result.reason });
          this.log.info(`${label(session)} ${message.type} refused`);
          return;
        }
        // One connection per account: the older one is logged out but stays
        // connected, so it does not reconnect and log itself back in.
        const previous = this.accountSocket.get(result.accountId);
        if (previous && previous !== socket) {
          this.logOut(previous, "This account logged in somewhere else.");
        }
        session.accountId = result.accountId;
        session.token = result.token;
        this.accountSocket.set(result.accountId, socket);
        session.serfId = null;
        this.sendSerfList(socket);
        this.sendStash(socket);
        this.send(socket, {
          type: "authOk",
          email: result.email,
          token: result.token,
        });
        // Account ids only: emails and tokens never go in the log.
        this.log.info(
          `${label(session)} ${message.type} ok: account #${result.accountId}`,
        );
      })
      .catch((err: unknown) => {
        this.log.warn(
          `${label(session)} ${message.type} error: ${String(err)}`,
        );
        this.send(socket, {
          type: "authError",
          reason: "Server error. Please try again.",
        });
      })
      .finally(() => {
        session.authBusy = false;
      });
  }

  /** Back to the login screen: leaves the queue or run, forgets the account. */
  private logOut(socket: WebSocket, reason: string): void {
    const session = this.sessions.get(socket);
    if (!session || session.accountId === null) return;
    // Not notified with runEnded: the client resets on loggedOut, and an
    // async runEnded arriving after it would show a results screen.
    if (session.id !== null) {
      this.leaveEverything(session.id, false, session.serfName);
      this.dropFromParties(session.id, session.serfName);
    }
    session.serfId = null;
    session.serfName = null;
    session.serfClass = null;
    if (this.accountSocket.get(session.accountId) === socket) {
      this.accountSocket.delete(session.accountId);
    }
    this.log.info(`${label(session)} logged out (${reason})`);
    session.accountId = null;
    session.token = null;
    this.send(socket, { type: "loggedOut", reason });
  }

  /** Takes a player out of the queue and out of any run; `notify` sends them runEnded. */
  private leaveEverything(
    id: number,
    notify: boolean,
    name: string | null = null,
  ): void {
    this.unqueue(id, `${name ?? "A party member"} left the game.`);
    const instance = this.runOf.get(id);
    const end = instance?.leave(id);
    // Recorded on the serf either way (as "left").
    if (instance && end) this.finishRun(instance, end, notify);
  }

  private onQueue(
    socket: WebSocket,
    session: Session,
    id: number,
    dungeon: DungeonId,
  ): void {
    if (this.runOf.has(id)) {
      this.reject(socket, session, "already in a run");
      return;
    }
    if (this.matchmaker.has(id)) {
      this.reject(socket, session, "already queued");
      return;
    }
    this.matchmaker.join(id, dungeon, this.tickCount);
    this.log.info(`${label(session)} queued for ${dungeon}`);
    this.sendQueueStatus(dungeon);
  }

  /**
   * Takes a player's whole place out of the queue (with their party, who
   * wait together, D-143) and tells each of them why; the one who asked
   * gets no reason. Returns whether anyone was queued.
   */
  private unqueue(id: number, reason: string): boolean {
    const left = this.matchmaker.leave(id);
    if (!left) return false;
    for (const p of left.players) {
      this.sendTo(p, { type: "queueLeft", reason: p === id ? null : reason });
    }
    this.sendQueueStatus(left.dungeon);
    return true;
  }

  /**
   * The party leader queues the whole party (14b, D-143). Every member must
   * be at the menu with a serf that may enter (D-107, D-073, D-088);
   * otherwise nobody is queued and the leader is told who. A refusal comes
   * as queueLeft, which brings the leader's screen back to the menu.
   */
  private onPartyQueue(id: number, dungeon: DungeonId): void {
    const members = this.parties.partyOf(id)?.members ?? [id];
    const refuse = (reason: string) =>
      this.sendTo(id, { type: "queueLeft", reason });
    if (members[0] !== id) {
      refuse("Only the party leader can choose a dungeon.");
      return;
    }
    if (members.some((m) => this.matchmaker.has(m))) {
      refuse("Your party is already waiting for a dungeon.");
      return;
    }
    for (const m of members) {
      const problem = this.memberQueueProblem(m, dungeon);
      if (problem) {
        refuse(problem);
        return;
      }
    }
    this.matchmaker.joinGroup(members, dungeon, this.tickCount);
    this.log.info(
      `party of guest #${id} (${members.length}) queued for ${dungeon}`,
    );
    this.sendQueueStatus(dungeon);
  }

  /** Why this party member cannot go into `dungeon` now, naming them; null if they can. */
  private memberQueueProblem(id: number, dungeon: DungeonId): string | null {
    const s = this.sessionOf(id);
    const name = s?.serfName ?? "A party member";
    if (!s || s.serfId === null) return `${name} must choose a serf first.`;
    if (this.runOf.has(id)) return `${name} is still in a dungeon.`;
    if (s.serfBlocked) return `${name} must settle their rewards first.`;
    if (s.serfNeedsClass) return `${name} must choose a class first.`;
    if (dungeonInfo(dungeon).listed) {
      const problem = entryProblem(dungeon, s.serfClears, s.serfLevel);
      if (problem) return `${name} can't enter: ${problem}`;
    }
    return null;
  }

  /** Tells everyone waiting for `dungeon` how many are waiting and when it starts. */
  private sendQueueStatus(dungeon: DungeonId): void {
    const waiting = this.matchmaker.queuedFor(dungeon);
    const startsIn =
      this.matchmaker.ticksUntilStart(dungeon, this.tickCount) * TICK_SECONDS;
    const encoded = encodeMessage({
      type: "queueStatus",
      dungeon,
      queued: waiting.length,
      startsIn,
    });
    for (const id of waiting) this.sendEncoded(id, encoded);
  }

  /**
   * Late join (D-052): each queued player, longest-waiting first, goes into
   * the fullest run of their dungeon that can still take them.
   */
  private joinOpenRuns(): void {
    const changed = new Set<DungeonId>();
    for (const { players, dungeon } of this.matchmaker.waitingGroups) {
      // A party goes in whole or waits (D-143).
      let best: DungeonInstance | undefined;
      for (const run of this.instances.values()) {
        if (run.dungeon !== dungeon) continue;
        if (run.playerIds.length + players.length > MAX_PARTY_SIZE) continue;
        if (!players.every((p) => run.canJoin(p))) continue;
        if (!best || run.playerIds.length > best.playerIds.length) best = run;
      }
      if (!best || players[0] === undefined) continue;
      this.matchmaker.leave(players[0]);
      changed.add(dungeon);
      for (const playerId of players) this.joinRun(best, playerId);
    }
    for (const dungeon of changed) this.sendQueueStatus(dungeon);
  }

  /** Puts a queued player into a run in progress (D-052). */
  private joinRun(best: DungeonInstance, playerId: number): void {
    const loadout = this.loadoutOf(playerId);
    best.join(playerId, loadout);
    this.runOf.set(playerId, best);
    this.setRunOwner(playerId);
    this.sendTo(playerId, {
      type: "runStarted",
      dungeon: best.dungeon,
      seed: best.seed,
      players: best.playerIds,
      stats: loadout.stats,
      weaponTier: loadout.weaponTier,
      weaponType: loadout.weaponType,
      ability: loadout.ability,
    });
    // A late joiner learns the rooms already woken (D-147).
    this.sendTo(playerId, { type: "rooms", ...best.roomsSeen });
    this.log.info(`guest #${playerId} joined run #${best.id} in progress`);
  }

  /** Sends a run's woken and cleared rooms to its members when they change (D-147). */
  private sendRoomsIfChanged(instance: DungeonInstance): void {
    const rooms = instance.roomsSeen;
    const key = JSON.stringify(rooms);
    if (this.roomsSent.get(instance.id) === key) return;
    this.roomsSent.set(instance.id, key);
    const encoded = encodeMessage({ type: "rooms", ...rooms });
    for (const id of instance.playerIds) this.sendEncoded(id, encoded);
  }

  private startRun(dungeon: DungeonId, players: readonly number[]): void {
    const instance = new DungeonInstance(
      this.nextInstanceId++,
      dungeon,
      players,
      {
        maxQueuedInputs: this.maxQueuedInputs,
        joinWindowTicks: this.joinWindowTicks,
        loadoutFor: (id) => this.loadoutOf(id),
        seed: this.dungeonSeed(),
      },
    );
    this.instances.set(instance.id, instance);
    for (const id of players) {
      this.runOf.set(id, instance);
      this.setRunOwner(id);
    }
    for (const id of players) {
      this.sendEncoded(
        id,
        encodeMessage({
          type: "runStarted",
          dungeon,
          seed: instance.seed,
          players: [...players],
          stats: this.loadoutOf(id).stats,
          weaponTier: this.loadoutOf(id).weaponTier,
          weaponType: this.loadoutOf(id).weaponType,
          ability: this.loadoutOf(id).ability,
        }),
      );
    }
    this.log.info(
      `run #${instance.id} started: ${dungeon} (seed ${instance.seed}) with ${players.map((p) => `#${p}`).join(" ")}`,
    );
  }

  /**
   * An Artifact used itself up mid-run (the Resurrection Necklace shatters,
   * D-153): it is gone from the serf at once, whatever happens next.
   */
  private spendArtifact(playerId: number, artifact: ArtifactId): void {
    const owner = this.runOwner.get(playerId);
    if (!owner) return;
    this.serfs
      .spendArtifact(owner.accountId, owner.serfId, artifact)
      .then((gone) =>
        this.log.info(
          `serf #${owner.serfId} ${gone ? "spent" : "could not spend"} ${artifact}`,
        ),
      )
      .catch((err: unknown) =>
        this.log.warn(
          `serf #${owner.serfId} ${artifact} not spent: ${String(err)}`,
        ),
      );
  }

  /** A player's run is over: back to the menu with their stats. */
  /**
   * A player's run is over: record it on their serf (a death is permanent,
   * D-062), then, if `notify`, send runEnded with the serf's updated life
   * and a fresh serf list. The serf is released at once, so a dead serf can
   * never queue again even while the database write is in flight.
   */
  private finishRun(
    instance: DungeonInstance,
    end: RunEnd,
    notify: boolean,
  ): void {
    const id = end.playerId;
    this.runOf.delete(id);
    const owner = this.runOwner.get(id);
    this.runOwner.delete(id);
    const died = end.result === "died";
    const socket = this.socketOf.get(id);
    const session = socket ? this.sessions.get(socket) : undefined;
    if (died && session && session.serfId === owner?.serfId) {
      session.serfId = null;
      session.serfName = null;
      session.serfClass = null;
      this.partyChanged(id);
    }
    this.log.info(
      `guest #${id} ${end.result} run #${instance.id} after ${end.stats.seconds.toFixed(1)} s`,
    );
    const recorded = owner
      ? this.serfs.recordRun(
          owner.accountId,
          owner.serfId,
          instance.dungeon,
          end.result,
          end.stats,
          died ? { dungeon: instance.dungeon, killedBy: end.killedBy } : null,
          instance.peakPlayers,
        )
      : Promise.resolve(null);
    recorded
      .catch((err: unknown) => {
        this.log.warn(`guest #${id} run not recorded: ${String(err)}`);
        return null;
      })
      .then((saved) => {
        const serf = saved?.serf ?? null;
        if (serf && died) this.log.info(`serf #${serf.id} died for good`);
        // Before runEnded goes out, so a quick requeue sees the new level.
        const now = this.socketOf.get(id);
        const nowSession = now ? this.sessions.get(now) : undefined;
        if (serf && nowSession && nowSession.serfId === serf.id) {
          nowSession.serfNeedsClass = needsClass(serf);
          nowSession.serfClears = serf.life.clears;
          nowSession.serfLevel = levelForExp(serf.exp);
          nowSession.serfLoadout = loadoutOf(serf);
          this.partyChanged(id);
          // A reward that did not fit blocks the next dungeon (D-088, D-118).
          if (
            saved?.loot.some((d) => d.pending) ||
            saved?.potions.some((d) => d.pending)
          ) {
            nowSession.serfBlocked = true;
          }
        }
        if (!notify) return;
        this.sendEncoded(
          id,
          encodeMessage({
            type: "runEnded",
            dungeon: instance.dungeon,
            result: end.result,
            stats: end.stats,
            loot: saved?.loot ?? [],
            potions: saved?.potions ?? [],
            killedBy: end.killedBy,
            serf,
            // Only what was actually saved counts.
            expGained: saved?.expGained ?? 0,
            statGains: saved?.statGains ?? zeroStats(),
          }),
        );
        const s = this.socketOf.get(id);
        if (s) {
          this.sendSerfList(s);
          if (saved && saved.loot.length + saved.potions.length > 0) {
            this.sendStash(s);
          }
        }
      });
  }

  /**
   * getStash / sellItem (D-085–D-088) and the potion rack (D-118): logged
   * in only, one at a time (like serf requests). Selling or pouring out may
   * free room for pending rewards, so the played serf's block is
   * recomputed before the new stash is sent. Gear and stats are fixed for a
   * run: no equipping or drinking while queued or in one.
   */
  private onStash(
    socket: WebSocket,
    session: Session,
    message: Extract<
      ClientMessage,
      {
        type:
          | "getStash"
          | "sellItem"
          | "equipItem"
          | "unequipItem"
          | "drinkPotion"
          | "pourPotion";
      }
    >,
  ): void {
    const accountId = session.accountId;
    if (accountId === null) {
      this.reject(socket, session, "log in first");
      return;
    }
    if (message.type === "getStash") {
      this.sendStash(socket);
      return;
    }
    if (session.serfBusy) {
      this.reject(socket, session, "busy");
      return;
    }
    // Gear is fixed for a run, like the serf itself.
    const id = session.id;
    if (
      message.type !== "sellItem" &&
      message.type !== "pourPotion" &&
      id !== null &&
      (this.runOf.has(id) || this.matchmaker.has(id))
    ) {
      this.reject(socket, session, "not while queued or in a run");
      return;
    }
    session.serfBusy = true;
    const attempt: Promise<
      { ok: true; price?: number } | { ok: false; reason: string }
    > =
      message.type === "sellItem"
        ? this.serfs.sell(accountId, message.itemId)
        : message.type === "drinkPotion"
          ? this.serfs.drink(accountId, message.serfId, message.potionId)
          : message.type === "pourPotion"
            ? this.serfs.pour(accountId, message.potionId)
            : message.type === "equipItem"
              ? this.serfs.equip(
                  accountId,
                  message.serfId,
                  message.itemId,
                  message.slot,
                )
              : this.serfs.unequip(accountId, message.serfId, message.slot);
    attempt
      .then(async (done) => {
        if (session.accountId !== accountId) return;
        if (!done.ok) {
          this.send(socket, { type: "stashError", reason: done.reason });
          return;
        }
        this.log.info(
          message.type === "sellItem"
            ? `${label(session)} sold item #${message.itemId} for ${done.price ?? 0} gold`
            : message.type === "drinkPotion"
              ? `${label(session)} serf #${message.serfId} drank potion #${message.potionId}`
              : message.type === "pourPotion"
                ? `${label(session)} poured out potion #${message.potionId}`
                : message.type === "equipItem"
                  ? `${label(session)} equipped item #${message.itemId} on serf #${message.serfId}`
                  : `${label(session)} unequipped serf #${message.serfId} ${message.slot}`,
        );
        // The played serf's gear or waiting rewards may have changed.
        if (session.serfId !== null) {
          const serfId = session.serfId;
          const played = (await this.serfs.list(accountId)).find(
            (x) => x.id === serfId,
          );
          if (played) session.serfLoadout = loadoutOf(played);
          session.serfBlocked = await this.serfs.hasPending(accountId, serfId);
        }
        this.sendStash(socket);
        if (message.type !== "sellItem" && message.type !== "pourPotion") {
          this.sendSerfList(socket);
        }
      })
      .catch((err: unknown) => {
        this.log.warn(
          `${label(session)} ${message.type} error: ${String(err)}`,
        );
        this.send(socket, {
          type: "stashError",
          reason: "Server error. Please try again.",
        });
      })
      .finally(() => {
        session.serfBusy = false;
      });
  }

  private sendStash(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    const accountId = session?.accountId;
    if (!session || accountId == null) return;
    this.serfs
      .stash(accountId)
      .then((stash) => {
        if (session.accountId !== accountId) return;
        this.send(socket, { type: "stash", ...stash });
      })
      .catch((err: unknown) =>
        this.log.warn(`${label(session)} stash error: ${String(err)}`),
      );
  }

  /** What a player's serf fights with (a fresh Serf's if unknown). */
  private loadoutOf(playerId: number): Loadout {
    const socket = this.socketOf.get(playerId);
    const session = socket ? this.sessions.get(socket) : undefined;
    return (
      session?.serfLoadout ?? {
        stats: SERF_BASE,
        weaponTier: null,
        weaponType: null,
        ability: null,
      }
    );
  }

  private setRunOwner(playerId: number): void {
    const socket = this.socketOf.get(playerId);
    const session = socket ? this.sessions.get(socket) : undefined;
    if (session?.accountId != null && session.serfId !== null) {
      this.runOwner.set(playerId, {
        accountId: session.accountId,
        serfId: session.serfId,
      });
    }
  }

  /**
   * createSerf / selectSerf (Phase 7b). Only while logged in and not in a
   * queue or run (the serf is fixed for a run). One request at a time.
   */
  private onSerf(
    socket: WebSocket,
    session: Session,
    message: Extract<
      ClientMessage,
      { type: "createSerf" | "selectSerf" | "chooseClass" }
    >,
  ): void {
    const accountId = session.accountId;
    if (session.id === null || accountId === null) {
      this.reject(socket, session, "log in first");
      return;
    }
    if (this.runOf.has(session.id) || this.matchmaker.has(session.id)) {
      this.reject(socket, session, "not while queued or in a run");
      return;
    }
    if (session.serfBusy) {
      this.reject(socket, session, "busy");
      return;
    }
    session.serfBusy = true;
    const attempt =
      message.type === "createSerf"
        ? this.serfs.create(accountId, message.name)
        : message.type === "selectSerf"
          ? this.serfs.choose(accountId, message.serfId)
          : this.serfs.chooseClass(accountId, message.serfId, message.classId);
    attempt
      .then(async (result) => {
        // Logged out (or reconnected) meanwhile: drop the answer.
        if (!this.sessions.has(socket) || session.accountId !== accountId) {
          return;
        }
        if (!result.ok) {
          this.send(socket, { type: "serfError", reason: result.reason });
          return;
        }
        // Known before the serf is played, so it cannot slip into a queue.
        const blocked = await this.serfs.hasPending(accountId, result.serf.id);
        if (session.accountId !== accountId) return;
        // A new serf, or one just given its class, is played right away.
        session.serfId = result.serf.id;
        session.serfBlocked = blocked;
        session.serfNeedsClass = needsClass(result.serf);
        session.serfClears = result.serf.life.clears;
        session.serfLevel = levelForExp(result.serf.exp);
        session.serfLoadout = loadoutOf(result.serf);
        this.setPlayedSerf(session, result.serf);
        this.log.info(
          message.type === "chooseClass"
            ? `${label(session)} serf #${result.serf.id} became a ${message.classId}`
            : `${label(session)} ${message.type === "createSerf" ? "created" : "chose"} serf #${result.serf.id}`,
        );
        this.sendSerfList(socket);
      })
      .catch((err: unknown) => {
        this.log.warn(
          `${label(session)} ${message.type} error: ${String(err)}`,
        );
        this.send(socket, {
          type: "serfError",
          reason: "Server error. Please try again.",
        });
      })
      .finally(() => {
        session.serfBusy = false;
      });
  }

  /**
   * One leaderboard query at a time per connection (D-148): a request made
   * while one is in flight waits, and only the latest waiting one runs, so
   * clicking through filters cannot pile up database work.
   */
  private onLeaderboard(
    socket: WebSocket,
    session: Session,
    query: LeaderboardQuery,
  ): void {
    if (session.boardBusy) {
      session.boardNext = query;
      return;
    }
    session.boardBusy = true;
    this.serfs
      .leaderboard(query)
      .then((entries) =>
        this.send(socket, { type: "leaderboard", query, entries }),
      )
      .catch((err: unknown) =>
        this.log.warn(`${label(session)} leaderboard error: ${String(err)}`),
      )
      .finally(() => {
        session.boardBusy = false;
        const next = session.boardNext;
        session.boardNext = null;
        if (next && this.sessions.has(socket)) {
          this.onLeaderboard(socket, session, next);
        }
      });
  }

  /** Records the played serf's name and class, and shows the change to its party. */
  private setPlayedSerf(session: Session, serf: SerfSummary): void {
    session.serfName = serf.name;
    session.serfClass = serf.classId;
    if (session.id !== null) this.partyChanged(session.id);
  }

  /**
   * Party requests (Phase 14a, D-142, D-143). Refusals a player can cause
   * by ordinary play (a mistyped name, a lapsed invite, a full party) are
   * partyError replies, not invalid messages. Invites are sent and accepted
   * at the menu only; leaving or removing works anywhere.
   */
  private onParty(
    socket: WebSocket,
    session: Session,
    message: Extract<
      ClientMessage,
      { type: "partyInvite" | "partyAnswer" | "partyLeave" | "partyKick" }
    >,
  ): void {
    const id = session.id;
    if (id === null || session.accountId === null) {
      this.reject(socket, session, "log in first");
      return;
    }
    const busy = this.runOf.has(id) || this.matchmaker.has(id);
    switch (message.type) {
      case "partyInvite": {
        if (session.serfName === null) {
          this.partyError(socket, "Choose a serf first.");
          return;
        }
        if (busy) {
          this.partyError(
            socket,
            "Invite from the menu, not while queued or in a run.",
          );
          return;
        }
        const name = normalizeSerfName(message.name);
        const target = this.playerPlaying(name);
        if (target === null) {
          // The same answer for unknown, dead, and offline serfs.
          this.partyError(
            socket,
            `No one is playing a serf named ${name} right now.`,
          );
          return;
        }
        const targetName = this.nameOf(target);
        if (target !== id && this.runOf.has(target)) {
          this.partyError(socket, `${targetName} is in a dungeon right now.`);
          return;
        }
        if (target !== id && this.matchmaker.has(target)) {
          this.partyError(
            socket,
            `${targetName} is waiting for a dungeon right now.`,
          );
          return;
        }
        const sent = this.parties.invite(id, target, this.tickCount);
        if (!sent.ok) {
          this.partyError(socket, INVITE_REFUSALS[sent.reason](targetName));
          return;
        }
        this.sendTo(target, {
          type: "partyInvited",
          inviteId: sent.invite.id,
          from: {
            name: session.serfName,
            classId: session.serfClass,
            level: session.serfLevel,
          },
          expiresIn: INVITE_SECONDS,
        });
        this.sendPartyState(id);
        this.log.info(`${label(session)} invited guest #${target} to a party`);
        return;
      }
      case "partyAnswer": {
        if (message.accept && session.serfName === null) {
          this.partyError(socket, "Choose a serf first.");
          return;
        }
        if (message.accept && busy) {
          this.partyError(socket, "Leave the queue first.");
          return;
        }
        // A waiting party cannot change; the invite stays open.
        const asked = this.parties
          .invitesTo(id)
          .find((i) => i.id === message.inviteId);
        if (message.accept && asked && this.matchmaker.has(asked.from)) {
          this.partyError(
            socket,
            "That party is waiting for a dungeon. Try again in a moment.",
          );
          return;
        }
        const answered = this.parties.answer(
          id,
          message.inviteId,
          message.accept,
        );
        if (!answered.ok) {
          this.send(socket, {
            type: "partyInviteGone",
            inviteId: message.inviteId,
          });
          this.partyError(socket, ANSWER_REFUSALS[answered.reason]);
          return;
        }
        const { invite, party, withdrawn } = answered;
        this.send(socket, { type: "partyInviteGone", inviteId: invite.id });
        if (!party) {
          this.partyNotice(
            [invite.from],
            `${this.nameOf(id)} declined your invite.`,
          );
          this.sendPartyState(invite.from);
          return;
        }
        for (const w of withdrawn) this.inviteWithdrawn(w);
        this.partyNotice(
          party.members.filter((m) => m !== id),
          `${this.nameOf(id)} joined the party.`,
        );
        for (const m of party.members) this.sendPartyState(m);
        this.log.info(`${label(session)} joined party #${party.id}`);
        return;
      }
      case "partyLeave": {
        const name = this.nameOf(id);
        if (!this.parties.partyOf(id)) return;
        // The party changed, so it no longer waits together (D-143).
        this.unqueue(
          id,
          `${name} left the party, so the party left the queue.`,
        );
        const leaving = this.parties.leave(id);
        if (!leaving) return;
        this.sendPartyState(id);
        this.partyLeft(leaving, `${name} left the party.`);
        this.log.info(`${label(session)} left their party`);
        return;
      }
      case "partyKick": {
        if (
          this.parties.leaderOf(id) === id &&
          this.partyMembers(id).includes(message.playerId)
        ) {
          this.unqueue(
            message.playerId,
            `${this.nameOf(message.playerId)} was removed, so the party left the queue.`,
          );
        }
        const kicked = this.parties.kick(id, message.playerId);
        if (!kicked.ok) {
          this.partyError(
            socket,
            kicked.reason === "notLeader"
              ? "Only the party leader can remove members."
              : "They are not in your party.",
          );
          return;
        }
        this.partyNotice(
          [message.playerId],
          "You were removed from the party.",
        );
        this.sendPartyState(message.playerId);
        this.partyLeft(
          kicked.leaving,
          `${this.nameOf(message.playerId)} was removed from the party.`,
        );
        this.log.info(
          `${label(session)} removed guest #${message.playerId} from their party`,
        );
        return;
      }
    }
  }

  /** Gone from the game (disconnected or logged out): out of the party, invites withdrawn. */
  private dropFromParties(id: number, name: string | null): void {
    const { leaving, withdrawn } = this.parties.drop(id);
    for (const w of withdrawn) this.inviteWithdrawn(w);
    if (leaving)
      this.partyLeft(leaving, `${name ?? "A member"} left the party.`);
  }

  /** Tells those still in a party that someone left, and who leads now. */
  private partyLeft(leaving: Leaving, text: string): void {
    if (leaving.disbanded) {
      this.partyNotice(leaving.remaining, `${text} The party broke up.`);
    } else if (leaving.newLeader !== null) {
      this.partyNotice(
        leaving.remaining,
        `${text} ${this.nameOf(leaving.newLeader)} leads the party now.`,
      );
    } else {
      this.partyNotice(leaving.remaining, text);
    }
    for (const m of leaving.remaining) this.sendPartyState(m);
  }

  /** An invite closed without an answer: the invitee's prompt goes, the inviter's list updates. */
  private inviteWithdrawn(invite: Invite): void {
    this.sendTo(invite.to, { type: "partyInviteGone", inviteId: invite.id });
    this.sendPartyState(invite.from);
  }

  /** A member's serf changed (chosen, levelled, died): their party sees it. */
  private partyChanged(id: number): void {
    for (const m of this.parties.partyOf(id)?.members ?? []) {
      this.sendPartyState(m);
    }
  }

  private sendPartyState(id: number): void {
    const party = this.parties.partyOf(id);
    this.sendTo(id, {
      type: "party",
      party: party
        ? {
            leaderId: party.members[0] ?? id,
            members: party.members.map((m) => this.memberOf(m)),
          }
        : null,
      invited: this.parties.invitesFrom(id).map((i) => ({
        inviteId: i.id,
        name: this.nameOf(i.to),
      })),
    });
  }

  private memberOf(id: number): PartyMember {
    const session = this.sessionOf(id);
    return {
      playerId: id,
      name: session?.serfName ?? null,
      classId: session?.serfClass ?? null,
      level: session?.serfLevel ?? 1,
    };
  }

  /** The joined player playing the living serf of this name (any case), if any. */
  private playerPlaying(name: string): number | null {
    const wanted = name.toLowerCase();
    for (const s of this.sessions.values()) {
      if (
        s.id !== null &&
        s.accountId !== null &&
        s.serfName?.toLowerCase() === wanted
      ) {
        return s.id;
      }
    }
    return null;
  }

  private nameOf(id: number): string {
    return this.sessionOf(id)?.serfName ?? "A player";
  }

  private sessionOf(id: number): Session | undefined {
    const socket = this.socketOf.get(id);
    return socket ? this.sessions.get(socket) : undefined;
  }

  private partyNotice(ids: Iterable<number>, text: string): void {
    const encoded = encodeMessage({ type: "partyNotice", text });
    for (const id of ids) this.sendEncoded(id, encoded);
  }

  private partyError(socket: WebSocket, reason: string): void {
    this.send(socket, { type: "partyError", reason });
  }

  private sendTo(id: number, message: ServerMessage): void {
    this.sendEncoded(id, encodeMessage(message));
  }

  /** Sends this connection its serfs and which one it plays as. */
  private sendSerfList(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    const accountId = session?.accountId;
    if (!session || accountId == null) return;
    this.serfs
      .list(accountId)
      .then((serfs) => {
        if (session.accountId !== accountId) return;
        this.send(socket, {
          type: "serfList",
          slots: this.serfs.slotCount,
          serfs,
          selectedId: session.serfId,
        });
      })
      .catch((err: unknown) =>
        this.log.warn(`${label(session)} serf list error: ${String(err)}`),
      );
  }

  private onHello(socket: WebSocket, session: Session, protocol: number): void {
    if (session.id !== null) {
      this.reject(socket, session, "already joined");
      return;
    }
    if (protocol !== PROTOCOL_VERSION) {
      this.send(socket, {
        type: "error",
        reason: `protocol mismatch: server speaks ${PROTOCOL_VERSION}, client sent ${protocol}`,
      });
      this.log.warn(`connection refused: protocol ${protocol}`);
      socket.close(CLOSE_POLICY, "protocol mismatch");
      return;
    }
    clearTimeout(session.helloTimer);
    session.id = this.nextPlayerId++;
    this.socketOf.set(session.id, socket);
    // Joined players start at the menu; nothing else happens until they queue.
    this.send(socket, {
      type: "welcome",
      playerId: session.id,
      players: this.playerIds,
    });
    this.broadcast({ type: "playerJoined", playerId: session.id }, socket);
    this.log.info(`${label(session)} joined (${this.playerIds.length} online)`);
  }

  private onClose(socket: WebSocket, session: Session): void {
    clearTimeout(session.helloTimer);
    this.sessions.delete(socket);
    if (
      session.accountId !== null &&
      this.accountSocket.get(session.accountId) === socket
    ) {
      this.accountSocket.delete(session.accountId);
    }
    if (session.id !== null) {
      const id = session.id;
      this.socketOf.delete(id);
      this.leaveEverything(id, false, session.serfName);
      this.dropFromParties(id, session.serfName);
      this.broadcast({ type: "playerLeft", playerId: session.id });
      this.log.info(`${label(session)} left (${this.playerIds.length} online)`);
    }
  }

  /** Replies with an error and closes the connection after too many. */
  private reject(socket: WebSocket, session: Session, reason: string): void {
    session.invalidMessages++;
    this.log.warn(`${label(session)} invalid message: ${reason}`);
    this.send(socket, { type: "error", reason });
    if (session.invalidMessages >= this.maxInvalidMessages) {
      this.log.warn(`${label(session)} closed: too many invalid messages`);
      socket.close(CLOSE_POLICY, "too many invalid messages");
    }
  }

  private sendEncoded(playerId: number, encoded: string): void {
    const socket = this.socketOf.get(playerId);
    if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encodeMessage(message));
    }
  }

  /** Sends to every joined player, optionally excluding one socket. */
  private broadcast(message: ServerMessage, except?: WebSocket): void {
    this.broadcastEncoded(encodeMessage(message), except);
  }

  private broadcastEncoded(encoded: string, except?: WebSocket): void {
    for (const [socket, session] of this.sessions) {
      if (
        socket !== except &&
        session.id !== null &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.send(encoded);
      }
    }
  }
}

function label(session: Session): string {
  return session.id === null ? "unjoined connection" : `guest #${session.id}`;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
