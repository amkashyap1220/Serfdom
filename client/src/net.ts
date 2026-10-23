import {
  encodeMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Vec2,
} from "@serfdom/shared";

/** Default dev server; override with VITE_SERVER_URL (see .env.example). */
const DEFAULT_SERVER_URL = "ws://localhost:8080";
/** Wait this long before trying to reconnect after the connection drops. */
const RECONNECT_DELAY_MS = 2000;

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected"; playerId: number }
  | { kind: "disconnected"; reason: string };

export interface NetState {
  status: ConnectionStatus;
  /** Guest ids currently online according to the server (including ours). */
  players: readonly number[];
  /** Last error message the server sent, if any. */
  lastServerError: string | null;
}

export type SnapshotMessage = Extract<ServerMessage, { type: "snapshot" }>;

export interface ConnectionHandlers {
  /** A validated snapshot arrived; `receivedAtMs` is performance.now() at arrival. */
  onSnapshot?: (snapshot: SnapshotMessage, receivedAtMs: number) => void;
  /** The connection dropped (it will retry automatically). */
  onDisconnect?: () => void;
}

export function serverUrl(): string {
  const fromEnv: unknown = import.meta.env.VITE_SERVER_URL;
  return typeof fromEnv === "string" && fromEnv !== ""
    ? fromEnv
    : DEFAULT_SERVER_URL;
}

/**
 * Keeps one WebSocket connection to the game server, reconnecting after it
 * drops. The server is the source of truth for who is online and where
 * players are; this only mirrors what it says. Messages are validated before
 * use, because the network is untrusted in both directions.
 *
 * The game keeps running locally while disconnected.
 */
export class Connection {
  private socket: WebSocket | null = null;
  private state: NetState = {
    status: { kind: "connecting" },
    players: [],
    lastServerError: null,
  };
  private readonly url: string;
  private readonly handlers: ConnectionHandlers;

  constructor(handlers: ConnectionHandlers = {}, url: string = serverUrl()) {
    this.url = url;
    this.handlers = handlers;
    this.open();
  }

  get snapshot(): NetState {
    return this.state;
  }

  /** Sends one tick of movement intent; does nothing unless connected. */
  sendInput(seq: number, move: Vec2): void {
    if (this.state.status.kind !== "connected") return;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMessage({ type: "input", seq, move }));
  }

  private open(): void {
    this.state = { ...this.state, status: { kind: "connecting" } };
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      socket.send(encodeMessage({ type: "hello", protocol: PROTOCOL_VERSION }));
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        console.warn("[net] ignoring non-text message from server");
        return;
      }
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        console.warn(`[net] ignoring invalid server message: ${parsed.error}`);
        return;
      }
      this.handle(parsed.message);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      const reason = event.reason || `code ${event.code}`;
      this.state = {
        ...this.state,
        status: { kind: "disconnected", reason },
        players: [],
      };
      this.handlers.onDisconnect?.();
      // A "connection refused" while the server is down is expected during
      // development, so this is informational, not an error.
      console.info(
        `[net] disconnected (${reason}); retrying in ${RECONNECT_DELAY_MS / 1000}s`,
      );
      setTimeout(() => this.open(), RECONNECT_DELAY_MS);
    });
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome":
        this.state = {
          ...this.state,
          status: { kind: "connected", playerId: msg.playerId },
          players: msg.players,
        };
        console.info(`[net] connected as guest #${msg.playerId}`);
        break;
      case "playerJoined":
        if (!this.state.players.includes(msg.playerId)) {
          this.state = {
            ...this.state,
            players: [...this.state.players, msg.playerId],
          };
        }
        break;
      case "playerLeft":
        this.state = {
          ...this.state,
          players: this.state.players.filter((id) => id !== msg.playerId),
        };
        break;
      case "error":
        this.state = { ...this.state, lastServerError: msg.reason };
        console.warn(`[net] server error: ${msg.reason}`);
        break;
      case "snapshot":
        this.handlers.onSnapshot?.(msg, performance.now());
        break;
    }
  }
}
