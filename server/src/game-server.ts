import {
  addPlayer,
  applyPlayerInput,
  consumeFixedSteps,
  createSimState,
  DUMMY_POSITIONS,
  encodeMessage,
  findPlayer,
  isPlayerAlive,
  MAX_FRAME_SECONDS,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PLAYER_START,
  PROTOCOL_VERSION,
  removePlayer,
  roundCoord,
  stepWorld,
  TEST_WALLS,
  TICK_SECONDS,
  type ServerMessage,
  type SimState,
  type SnapshotPlayer,
} from "@serfdom/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  newInputQueue,
  queueInput,
  takeInputsForTick,
  type InputQueue,
} from "./input-queue.ts";
import { consoleLogger, type Logger } from "./log.ts";
import { MessageRateLimiter } from "./rate-limit.ts";

export interface GameServerOptions {
  /** TCP port; 0 picks a free port (used by tests). */
  port: number;
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
  /** Present once joined. */
  inputs: InputQueue | null;
}

/**
 * Authoritative game server.
 *
 * Phase 4: connections, guest ids, presence (4a); server-owned movement with
 * snapshots (4b); tuned for the D-042 delay target (4c).
 * Phase 5b: owns the whole combat simulation (D-043): every player, the
 * dummy, and every projectile live in one shared `SimState`. Each tick it
 * applies each player's queued inputs (movement + fire) through the shared
 * rules, advances the world once, and broadcasts a snapshot. Clients only
 * ever send intents; HP, hits, and defeats are decided here.
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
  private readonly maxMessagesPerSecond: number;
  private nextPlayerId = 1;
  private tickCount = 0;
  private loop: ReturnType<typeof setInterval> | undefined;
  private sim: SimState = createSimState(DUMMY_POSITIONS);
  /** Size in bytes of the most recent snapshot (diagnostics). */
  lastSnapshotBytes = 0;

  private constructor(wss: WebSocketServer, options: GameServerOptions) {
    this.wss = wss;
    this.log = options.log ?? consoleLogger;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
    this.maxInvalidMessages = options.maxInvalidMessages ?? 5;
    this.snapshotEveryTicks = options.snapshotEveryTicks ?? 1;
    this.maxQueuedInputs = options.maxQueuedInputs ?? 30;
    this.maxMessagesPerSecond = options.maxMessagesPerSecond ?? 180;
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

  /** The authoritative simulation (tests and diagnostics). */
  get state(): SimState {
    return this.sim;
  }

  /** Authoritative player state as sent in snapshots. */
  get players(): SnapshotPlayer[] {
    const out: SnapshotPlayer[] = [];
    for (const s of this.sessions.values()) {
      if (s.id === null || !s.inputs) continue;
      const p = findPlayer(this.sim, s.id);
      if (!p) continue;
      out.push({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        ack: s.inputs.ack,
        hp: p.hp,
        maxHp: p.maxHp,
        cooldown: p.fireCooldown,
      });
    }
    return out;
  }

  /** Number of inputs waiting to be applied for a player (tests and diagnostics). */
  queuedInputs(playerId: number): number {
    for (const s of this.sessions.values()) {
      if (s.id === playerId) return s.inputs?.pending.length ?? 0;
    }
    return 0;
  }

  /** Replaces the simulation (tests only, e.g. to set up a near-death player). */
  setStateForTest(state: SimState): void {
    this.sim = state;
  }

  /** Advances the simulation one fixed tick (called by the loop, or directly by tests). */
  tick(): void {
    for (const [socket, session] of this.sessions) {
      if (session.id === null || !session.inputs) continue;
      const { apply } = takeInputsForTick(session.inputs);
      try {
        for (const input of apply) {
          this.sim = applyPlayerInput(
            this.sim,
            session.id,
            input,
            TEST_WALLS,
            TICK_SECONDS,
          ).state;
        }
      } catch (err) {
        // Should be impossible after validation; if it happens, drop only
        // this player rather than crashing the server for everyone.
        this.log.warn(`${label(session)} input error: ${String(err)}`);
        socket.close(CLOSE_POLICY, "invalid state");
      }
    }
    const world = stepWorld(this.sim, TEST_WALLS, TICK_SECONDS);
    this.sim = world.state;
    for (const e of world.events) {
      if (e.type === "playerDied") this.log.info(`guest #${e.playerId} died`);
    }

    this.tickCount++;
    if (this.tickCount % this.snapshotEveryTicks === 0) {
      const encoded = encodeMessage(this.snapshot());
      this.lastSnapshotBytes = Buffer.byteLength(encoded);
      this.broadcastEncoded(encoded);
    }
  }

  close(): Promise<void> {
    clearInterval(this.loop);
    for (const socket of this.sessions.keys()) socket.terminate();
    return new Promise((resolve, reject) =>
      this.wss.close((err) => (err ? reject(err) : resolve())),
    );
  }

  private snapshot(): ServerMessage {
    return {
      type: "snapshot",
      tick: this.tickCount,
      players: this.players,
      enemies: this.sim.enemies.map((e) => ({
        id: e.id,
        x: e.position.x,
        y: e.position.y,
        size: e.size,
        hp: e.hp,
        maxHp: e.maxHp,
        respawnIn: e.respawnIn,
      })),
      projectiles: this.sim.projectiles.map((p) => ({
        id: p.id,
        owner: p.owner,
        by: p.ownerId,
        x: roundCoord(p.position.x),
        y: roundCoord(p.position.y),
        dx: p.direction.x,
        dy: p.direction.y,
        speed: p.speed,
        size: p.size,
      })),
    };
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
      inputs: null,
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
        if (!session.inputs) {
          this.reject(socket, session, "send hello first");
          return;
        }
        const result = queueInput(
          session.inputs,
          message.seq,
          { move: message.move, fire: message.fire },
          this.maxQueuedInputs,
        );
        if (result.kind === "rejected") {
          this.reject(socket, session, result.reason);
        }
        return;
      }
      case "playAgain": {
        if (session.id === null) {
          this.reject(socket, session, "send hello first");
          return;
        }
        const player = findPlayer(this.sim, session.id);
        if (player && isPlayerAlive(player)) {
          this.reject(socket, session, "playAgain is only allowed when dead");
          return;
        }
        // D-046 prototype: a fresh state at the start; the enemy is not
        // reset for anyone else.
        this.sim = addPlayer(this.sim, session.id, PLAYER_START);
        this.log.info(`${label(session)} plays again`);
        return;
      }
    }
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
    session.inputs = newInputQueue();
    // PROVISIONAL: everyone spawns at the debug start; players do not
    // collide with each other.
    this.sim = addPlayer(this.sim, session.id, PLAYER_START);
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
    if (session.id !== null) {
      this.sim = removePlayer(this.sim, session.id);
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
