import {
  encodeMessage,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@serfdom/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { consoleLogger, type Logger } from "./log.ts";

export interface GameServerOptions {
  /** TCP port; 0 picks a free port (used by tests). */
  port: number;
  /** Close connections that have not sent a valid hello within this time. */
  helloTimeoutMs?: number;
  /** Close a connection after this many invalid messages. */
  maxInvalidMessages?: number;
  log?: Logger;
}

/** WebSocket close code for "policy violation" (RFC 6455). */
const CLOSE_POLICY = 1008;

interface Session {
  /** Guest id, assigned after a valid hello; null until then. */
  id: number | null;
  invalidMessages: number;
  helloTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Phase 4a authoritative server: accepts connections, hands out guest ids
 * (T-022), and tells everyone who is online. It owns the canonical list of
 * players; clients only ever learn about others from it.
 *
 * Every incoming message is validated (T-021). Bad messages get an error
 * reply; repeated bad messages, oversized messages, a wrong protocol
 * version, or no hello in time close the connection.
 */
export class GameServer {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly log: Logger;
  private readonly helloTimeoutMs: number;
  private readonly maxInvalidMessages: number;
  private nextPlayerId = 1;

  private constructor(wss: WebSocketServer, options: GameServerOptions) {
    this.wss = wss;
    this.log = options.log ?? consoleLogger;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
    this.maxInvalidMessages = options.maxInvalidMessages ?? 5;
    wss.on("connection", (socket) => this.onConnection(socket));
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

  close(): Promise<void> {
    for (const socket of this.sessions.keys()) socket.terminate();
    return new Promise((resolve, reject) =>
      this.wss.close((err) => (err ? reject(err) : resolve())),
    );
  }

  private onConnection(socket: WebSocket): void {
    const session: Session = {
      id: null,
      invalidMessages: 0,
      helloTimer: setTimeout(() => {
        this.log.warn("connection closed: no hello in time");
        socket.close(CLOSE_POLICY, "hello timeout");
      }, this.helloTimeoutMs),
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
      case "hello": {
        if (session.id !== null) {
          this.reject(socket, session, "already joined");
          return;
        }
        if (message.protocol !== PROTOCOL_VERSION) {
          this.send(socket, {
            type: "error",
            reason: `protocol mismatch: server speaks ${PROTOCOL_VERSION}, client sent ${message.protocol}`,
          });
          this.log.warn(`connection refused: protocol ${message.protocol}`);
          socket.close(CLOSE_POLICY, "protocol mismatch");
          return;
        }
        clearTimeout(session.helloTimer);
        session.id = this.nextPlayerId++;
        this.send(socket, {
          type: "welcome",
          playerId: session.id,
          players: this.playerIds,
        });
        this.broadcast({ type: "playerJoined", playerId: session.id }, socket);
        this.log.info(
          `${label(session)} joined (${this.playerIds.length} online)`,
        );
        return;
      }
    }
  }

  private onClose(socket: WebSocket, session: Session): void {
    clearTimeout(session.helloTimer);
    this.sessions.delete(socket);
    if (session.id !== null) {
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
    if (socket.readyState === WebSocket.OPEN)
      socket.send(encodeMessage(message));
  }

  /** Sends to every joined player, optionally excluding one socket. */
  private broadcast(message: ServerMessage, except?: WebSocket): void {
    for (const [socket, session] of this.sessions) {
      if (socket !== except && session.id !== null) this.send(socket, message);
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
