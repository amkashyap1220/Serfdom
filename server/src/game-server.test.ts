import {
  encodeMessage,
  MAX_MESSAGE_BYTES,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@serfdom/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { GameServer } from "./game-server.ts";
import { silentLogger } from "./log.ts";

/** A test client that queues every server message for step-by-step assertions. */
interface TestClient {
  socket: WebSocket;
  next(): Promise<ServerMessage>;
  closed: Promise<{ code: number; reason: string }>;
  send(raw: string | Buffer): void;
}

async function connect(port: number): Promise<TestClient> {
  const socket = new WebSocket(`ws://localhost:${port}`);
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  socket.on("message", (data) => {
    const parsed = parseServerMessage(data.toString());
    if (!parsed.ok)
      throw new Error(`server sent invalid message: ${parsed.error}`);
    const waiter = waiters.shift();
    if (waiter) waiter(parsed.message);
    else queue.push(parsed.message);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return {
    socket,
    closed,
    send: (raw) => socket.send(raw),
    next: () =>
      new Promise((resolve, reject) => {
        const queued = queue.shift();
        if (queued) return resolve(queued);
        const timer = setTimeout(
          () => reject(new Error("timed out waiting for a message")),
          2000,
        );
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      }),
  };
}

const hello = encodeMessage({ type: "hello", protocol: PROTOCOL_VERSION });

/**
 * The client can see its socket close slightly before the server has run
 * its own cleanup, so wait (briefly) for the server side instead of
 * asserting immediately.
 */
async function serverHasNoPlayers(): Promise<void> {
  for (let i = 0; i < 50 && server.playerIds.length > 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(server.playerIds).toEqual([]);
}

let server: GameServer;
let clients: TestClient[];

beforeEach(async () => {
  server = await GameServer.start({
    port: 0,
    helloTimeoutMs: 200,
    autoTick: false,
    log: silentLogger,
  });
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.socket.terminate();
  await server.close();
});

async function joined(): Promise<{
  client: TestClient;
  welcome: ServerMessage;
}> {
  const client = await connect(server.port);
  clients.push(client);
  client.send(hello);
  return { client, welcome: await client.next() };
}

describe("handshake and presence", () => {
  it("gives each client a distinct guest id and lists who is online", async () => {
    const a = await joined();
    expect(a.welcome).toEqual({ type: "welcome", playerId: 1, players: [1] });
    const b = await joined();
    expect(b.welcome).toEqual({
      type: "welcome",
      playerId: 2,
      players: [1, 2],
    });
    expect(await a.client.next()).toEqual({
      type: "playerJoined",
      playerId: 2,
    });
    expect(server.playerIds).toEqual([1, 2]);
  });

  it("tells the others when a client disconnects, and forgets it", async () => {
    const a = await joined();
    const b = await joined();
    await a.client.next(); // playerJoined 2
    b.client.socket.close();
    expect(await a.client.next()).toEqual({ type: "playerLeft", playerId: 2 });
    expect(server.playerIds).toEqual([1]);
  });

  it("never reuses a guest id", async () => {
    const a = await joined();
    a.client.socket.close();
    await a.client.closed;
    const b = await joined();
    expect(b.welcome).toMatchObject({ playerId: 2 });
  });

  it("does not announce connections that never said hello", async () => {
    const a = await joined();
    const lurker = await connect(server.port);
    clients.push(lurker);
    expect(server.playerIds).toEqual([1]);
    // The lurker is closed by the hello timeout without any announcement.
    expect((await lurker.closed).code).toBe(1008);
    a.client.send(hello); // provoke a reply so we know nothing else was queued
    expect(await a.client.next()).toEqual({
      type: "error",
      reason: "already joined",
    });
  });
});

describe("rejecting bad input", () => {
  it("refuses a different protocol version and closes", async () => {
    const c = await connect(server.port);
    clients.push(c);
    c.send(encodeMessage({ type: "hello", protocol: PROTOCOL_VERSION + 1 }));
    const msg = await c.next();
    expect(msg.type).toBe("error");
    expect((await c.closed).code).toBe(1008);
    await serverHasNoPlayers();
  });

  it("replies with an error to malformed messages and stays connected", async () => {
    const { client } = await joined();
    client.send("this is not json");
    expect(await client.next()).toEqual({
      type: "error",
      reason: "invalid JSON",
    });
    client.send('{"type":"teleport","x":9999}');
    expect(await client.next()).toEqual({
      type: "error",
      reason: 'unknown message type "teleport"',
    });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes a connection after 5 invalid messages", async () => {
    const { client } = await joined();
    for (let i = 0; i < 5; i++) client.send("{");
    expect((await client.closed).code).toBe(1008);
    await serverHasNoPlayers();
  });

  it("rejects binary frames", async () => {
    const { client } = await joined();
    client.send(Buffer.from(hello));
    expect(await client.next()).toEqual({
      type: "error",
      reason: "binary messages are not accepted",
    });
  });

  it("drops a client that sends an oversized message", async () => {
    const { client } = await joined();
    client.send("x".repeat(MAX_MESSAGE_BYTES + 1));
    expect((await client.closed).code).toBe(1009);
    await serverHasNoPlayers();
  });

  it("closes connections that never send hello", async () => {
    const c = await connect(server.port);
    clients.push(c);
    expect(await c.closed).toEqual({ code: 1008, reason: "hello timeout" });
  });
});

describe("startup", () => {
  it("fails clearly when the port is already in use", async () => {
    await expect(
      GameServer.start({ port: server.port, log: silentLogger }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});

/** Skips messages until one of the given type arrives. */
async function nextOfType<T extends ServerMessage["type"]>(
  client: TestClient,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  for (let i = 0; i < 100; i++) {
    const m = await client.next();
    if (m.type === type) return m as Extract<ServerMessage, { type: T }>;
  }
  throw new Error(`no ${type} message`);
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(cond()).toBe(true);
}

const input = (seq: number, x: number, y: number) =>
  JSON.stringify({ type: "input", seq, move: { x, y } });

describe("authoritative movement (4b)", () => {
  it("moves a player only by its inputs, one per tick, and acks them", async () => {
    const { client } = await joined();
    for (let seq = 0; seq < 30; seq++) {
      client.send(input(seq, 1, 0));
      await until(() => server.queuedInputs(1) === 1);
      server.tick();
    }
    // 30 ticks × 150 px/s × 1/60 s = 75 px.
    expect(server.players[0]?.x).toBeCloseTo(1075, 9);
    expect(server.players[0]?.ack).toBe(29);
    const snap = await nextOfType(client, "snapshot");
    expect(snap.players[0]).toMatchObject({ id: 1, y: 1000 });
  });

  it("sends a snapshot every tick with every player in them", async () => {
    const a = await joined();
    await joined();
    server.tick();
    const snap = await nextOfType(a.client, "snapshot");
    expect(snap.tick).toBe(1);
    expect(snap.players.map((p) => p.id).sort()).toEqual([1, 2]);
  });

  it("rejects a too-long direction and does not move", async () => {
    const { client } = await joined();
    client.send(input(0, 2, 0));
    expect(await nextOfType(client, "error")).toEqual({
      type: "error",
      reason: "input: move must have length <= 1",
    });
    server.tick();
    expect(server.players[0]?.x).toBe(1000);
  });

  it("rejects a position sent instead of an intent", async () => {
    const { client } = await joined();
    client.send(JSON.stringify({ type: "input", seq: 0, x: 1900, y: 1900 }));
    expect((await nextOfType(client, "error")).reason).toBe(
      "input: unexpected fields",
    );
  });

  it("rejects input before hello and replayed seq numbers", async () => {
    const c = await connect(server.port);
    clients.push(c);
    c.send(input(0, 1, 0));
    expect((await c.next()).type).toBe("error");
    const { client } = await joined();
    client.send(input(5, 1, 0));
    client.send(input(5, 1, 0));
    expect((await nextOfType(client, "error")).reason).toBe(
      "input seq must increase",
    );
  });

  it("drops a disconnected player from later snapshots", async () => {
    const a = await joined();
    const b = await joined();
    b.client.socket.close();
    await serverHasPlayers([1]);
    server.tick();
    const snap = await nextOfType(a.client, "snapshot");
    expect(snap.players.map((p) => p.id)).toEqual([1]);
  });

  it("closes a client that floods messages", async () => {
    const { client } = await joined();
    for (let seq = 0; seq < 400; seq++) client.send(input(seq, 1, 0));
    expect(await client.closed).toEqual({ code: 1008, reason: "rate limit" });
  });
});

describe("real-time loop", () => {
  it("processes queued inputs at about 60 ticks per second on its own", async () => {
    const live = await GameServer.start({ port: 0, log: silentLogger });
    try {
      const c = await connect(live.port);
      clients.push(c);
      c.send(hello);
      await nextOfType(c, "welcome");
      // Send like a real client: one input every 1/60 s for 0.5 s.
      for (let seq = 0; seq < 30; seq++) {
        c.send(input(seq, 0, 1));
        await new Promise((r) => setTimeout(r, 1000 / 60));
      }
      await new Promise((r) => setTimeout(r, 200));
      const p = live.players[0];
      expect(p?.ack).toBe(29);
      // Timer jitter may make the server drop a stale input or two, never add any.
      expect(p?.y).toBeGreaterThan(1075 - 3 * 2.5 - 1e-9);
      expect(p?.y).toBeLessThanOrEqual(1075 + 1e-9);
    } finally {
      await live.close();
    }
  });
});

async function serverHasPlayers(ids: number[]): Promise<void> {
  await until(() => server.playerIds.join() === ids.join());
}
