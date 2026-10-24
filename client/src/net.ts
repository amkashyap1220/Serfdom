import {
  encodeMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClassId,
  type ClientMessage,
  type DungeonId,
  type EquipSlot,
  type PlayerInput,
  type ServerMessage,
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

/** Messages about accounts, the menu, queue, and runs (everything but snapshots and presence). */
export type LobbyMessage = Extract<
  ServerMessage,
  {
    type:
      | "queueStatus"
      | "runStarted"
      | "runEnded"
      | "authOk"
      | "authError"
      | "loggedOut"
      | "serfList"
      | "serfError"
      | "leaderboard"
      | "stash"
      | "stashError";
  }
>;

export interface ConnectionHandlers {
  /** A validated snapshot arrived; `receivedAtMs` is performance.now() at arrival. */
  onSnapshot?: (
    snapshot: SnapshotMessage,
    receivedAtMs: number,
    bytes: number,
  ) => void;
  /** The connection dropped (it will retry automatically). */
  onDisconnect?: (reason: string) => void;
  /** The server accepted our hello. */
  onConnected?: (playerId: number) => void;
  onLobby?: (message: LobbyMessage, receivedAtMs: number) => void;
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

  /** Sends one tick of intent (movement + fire); does nothing unless connected. */
  sendInput(seq: number, input: PlayerInput): void {
    this.send({
      type: "input",
      seq,
      move: input.move,
      fire: input.fire,
      ability: input.ability ?? null,
    });
  }

  /** Waits for a run of this dungeon (D-048). */
  sendQueue(dungeon: DungeonId): void {
    this.send({ type: "queue", dungeon });
  }

  sendLeaveQueue(): void {
    this.send({ type: "leaveQueue" });
  }

  /** R: leave the current run at once (D-036). */
  sendExitDungeon(): void {
    this.send({ type: "exitDungeon" });
  }

  sendRegister(email: string, password: string): void {
    this.send({ type: "register", email, password });
  }

  sendLogin(email: string, password: string): void {
    this.send({ type: "login", email, password });
  }

  /** Log back in with a saved token (reload, reconnect). */
  sendResume(token: string): void {
    this.send({ type: "resume", token });
  }

  sendLogout(): void {
    this.send({ type: "logout" });
  }

  sendCreateSerf(name: string): void {
    this.send({ type: "createSerf", name });
  }

  sendGetStash(): void {
    this.send({ type: "getStash" });
  }

  sendSellItem(itemId: number): void {
    this.send({ type: "sellItem", itemId });
  }

  sendEquip(itemId: number, serfId: number, slot: EquipSlot): void {
    this.send({ type: "equipItem", itemId, serfId, slot });
  }

  sendUnequip(serfId: number, slot: EquipSlot): void {
    this.send({ type: "unequipItem", serfId, slot });
  }

  sendDrinkPotion(potionId: number, serfId: number): void {
    this.send({ type: "drinkPotion", potionId, serfId });
  }

  sendPourPotion(potionId: number): void {
    this.send({ type: "pourPotion", potionId });
  }

  sendGetLeaderboard(): void {
    this.send({ type: "getLeaderboard" });
  }

  sendChooseClass(serfId: number, classId: ClassId): void {
    this.send({ type: "chooseClass", serfId, classId });
  }

  sendSelectSerf(serfId: number): void {
    this.send({ type: "selectSerf", serfId });
  }

  /** Sends only once joined; before that there is nothing to say but hello. */
  private send(message: ClientMessage): void {
    if (this.state.status.kind !== "connected") return;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMessage(message));
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
      this.handle(parsed.message, event.data.length);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      const reason = event.reason || `code ${event.code}`;
      this.state = {
        ...this.state,
        status: { kind: "disconnected", reason },
        players: [],
      };
      this.handlers.onDisconnect?.(reason);
      // A "connection refused" while the server is down is expected during
      // development, so this is informational, not an error.
      console.info(
        `[net] disconnected (${reason}); retrying in ${RECONNECT_DELAY_MS / 1000}s`,
      );
      setTimeout(() => this.open(), RECONNECT_DELAY_MS);
    });
  }

  private handle(msg: ServerMessage, bytes: number): void {
    switch (msg.type) {
      case "welcome":
        this.state = {
          ...this.state,
          status: { kind: "connected", playerId: msg.playerId },
          players: msg.players,
        };
        console.info(`[net] connected as guest #${msg.playerId}`);
        this.handlers.onConnected?.(msg.playerId);
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
        this.handlers.onSnapshot?.(msg, performance.now(), bytes);
        break;
      case "queueStatus":
      case "runStarted":
      case "runEnded":
      case "authOk":
      case "authError":
      case "loggedOut":
      case "serfList":
      case "serfError":
      case "leaderboard":
      case "stash":
      case "stashError":
        this.handlers.onLobby?.(msg, performance.now());
        break;
    }
  }
}
