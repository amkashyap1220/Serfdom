import {
  encodeMessage,
  MAX_MESSAGE_BYTES,
  ENEMY_RING_ATTACK,
  MAX_PARTY_SIZE,
  PLAYER_HEALTH,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@serfdom/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { MemoryAccountRepo } from "./auth/account-repo.ts";
import { AccountService } from "./auth/account-service.ts";
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

/** Accounts in memory with a cheap password hash, so tests are fast and need no database. */
function testAccounts(): AccountService {
  return new AccountService(new MemoryAccountRepo(), {
    passwordCost: { log2N: 4, r: 1, p: 1 },
  });
}

let emailSeq = 0;
const PASSWORD = "correct horse";

/** Registers a fresh account on an already-welcomed connection. */
async function register(client: TestClient): Promise<string> {
  const email = `player${++emailSeq}@test.example`;
  client.send(encodeMessage({ type: "register", email, password: PASSWORD }));
  const ok = await nextOfType(client, "authOk");
  return ok.token;
}

/** hello → welcome → register → authOk. */
async function helloAndLogin(client: TestClient): Promise<void> {
  client.send(hello);
  await nextOfType(client, "welcome");
  await register(client);
}

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
    accounts: testAccounts(),
    port: 0,
    helloTimeoutMs: 200,
    autoTick: false,
    // Runs start on the next tick, so tests decide exactly who is in a party.
    queueWaitSeconds: 0,
    log: silentLogger,
  });
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.socket.terminate();
  await server.close();
});

/** A connected, welcomed, and (unless `login: false`) logged-in client. */
async function joined(options: { login?: boolean } = {}): Promise<{
  client: TestClient;
  welcome: ServerMessage;
}> {
  const client = await connect(server.port);
  clients.push(client);
  client.send(hello);
  const welcome = await client.next();
  if (options.login ?? true) await register(client);
  return { client, welcome };
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
      GameServer.start({
        port: server.port,
        accounts: testAccounts(),
        log: silentLogger,
      }),
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

const input = (
  seq: number,
  x: number,
  y: number,
  aim: { x: number; y: number } | null = null,
) =>
  JSON.stringify({
    type: "input",
    seq,
    move: { x, y },
    fire: { trigger: aim !== null, aim },
  });

/** The one-room debug map with its dummy (deterministic test fixture). */
const GW = "training";
const ids = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + i);
const queue = encodeMessage({ type: "queue", dungeon: GW });

/** Queues every client and starts one run with all of them. Ids are 1..n in order. */
async function inRun(n: number): Promise<TestClient[]> {
  const party: TestClient[] = [];
  for (let i = 0; i < n; i++) party.push((await joined()).client);
  for (const c of party) c.send(queue);
  const firstId = server.playerIds.length - n + 1;
  await until(() => party.every((_, i) => server.isQueued(firstId + i)));
  server.tick();
  for (const c of party) await nextOfType(c, "runStarted");
  return party;
}

/** The simulation of player `id`'s run. */
function sim(id = 1) {
  const run = server.instanceOf(id);
  if (!run) throw new Error(`player ${id} is not in a run`);
  return run.state;
}

function playerOf(id: number) {
  const p = sim(id).players.find((pl) => pl.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

/** Moves a player within their run's sim (test setup only). */
function placePlayer(
  id: number,
  at: { x: number; y: number },
  hp?: number,
): void {
  const run = server.instanceOf(id)!;
  const s = run.state;
  run.setStateForTest({
    ...s,
    players: s.players.map((p) =>
      p.id === id ? { ...p, position: { ...at }, hp: hp ?? p.hp } : p,
    ),
  });
}

function setDummyHp(id: number, hp: number): void {
  const run = server.instanceOf(id)!;
  const s = run.state;
  run.setStateForTest({
    ...s,
    enemies: s.enemies.map((e) => ({ ...e, hp })),
  });
}

/** Sends one input per tick for `ticks` ticks, waiting for each to arrive. */
async function drive(
  client: TestClient,
  id: number,
  firstSeq: number,
  ticks: number,
  aim: { x: number; y: number } | null,
): Promise<void> {
  for (let i = 0; i < ticks && server.instanceOf(id); i++) {
    client.send(input(firstSeq + i, 0, 0, aim));
    await until(() => server.queuedInputs(id) >= 1);
    server.tick();
  }
}

const dummy = (id = 1) => sim(id).enemies[0]!;

describe("menu and queue (6a)", () => {
  it("a joined player waits at the menu: not in any run, no snapshots", async () => {
    const { client } = await joined();
    server.tick();
    expect(server.instanceOf(1)).toBeUndefined();
    expect(server.runCount).toBe(0);
    // Provoke a reply: if a snapshot had been sent it would arrive first.
    client.send(hello);
    expect((await client.next()).type).toBe("error");
  });

  it("queue → queueStatus → runStarted → snapshots", async () => {
    const { client } = await joined();
    client.send(queue);
    expect(await client.next()).toEqual({
      type: "queueStatus",
      dungeon: GW,
      queued: 1,
      startsIn: 0,
    });
    server.tick();
    expect(await client.next()).toEqual({
      type: "runStarted",
      dungeon: GW,
      players: [1],
    });
    const snap = await nextOfType(client, "snapshot");
    expect(snap.players).toEqual([
      expect.objectContaining({
        id: 1,
        x: 1000,
        y: 1000,
        ack: -1,
        hp: PLAYER_HEALTH.maxHp,
      }),
    ]);
  });

  it("waits up to the queue time, then starts solo (T-030)", async () => {
    const live = await GameServer.start({
      accounts: testAccounts(),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 5,
      log: silentLogger,
    });
    try {
      const c = await connect(live.port);
      clients.push(c);
      await helloAndLogin(c);
      c.send(queue);
      expect(await nextOfType(c, "queueStatus")).toMatchObject({
        queued: 1,
        startsIn: 5,
      });
      for (let t = 0; t < 300; t++) live.tick();
      expect(live.runCount).toBe(0);
      live.tick();
      expect(live.runCount).toBe(1);
      expect(await nextOfType(c, "runStarted")).toMatchObject({ players: [1] });
    } finally {
      await live.close();
    }
  });

  it("tells everyone waiting when someone else joins the queue", async () => {
    const live = await GameServer.start({
      accounts: testAccounts(),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 5,
      log: silentLogger,
    });
    try {
      const [a, b] = [await connect(live.port), await connect(live.port)];
      clients.push(a, b);
      for (const c of [a, b]) {
        await helloAndLogin(c);
      }
      a.send(queue);
      await nextOfType(a, "queueStatus");
      b.send(queue);
      expect(await nextOfType(a, "queueStatus")).toMatchObject({ queued: 2 });
      expect(await nextOfType(b, "queueStatus")).toMatchObject({ queued: 2 });
      b.socket.close();
      expect(await nextOfType(a, "queueStatus")).toMatchObject({ queued: 1 });
    } finally {
      await live.close();
    }
  });

  it("puts at most MAX_PARTY_SIZE (10) players in one run; the next gets a run of their own", async () => {
    const n = MAX_PARTY_SIZE + 1;
    const party: TestClient[] = [];
    for (let i = 0; i < n; i++) party.push((await joined()).client);
    for (const c of party) c.send(queue);
    await until(() => ids(1, n).every((id) => server.isQueued(id)));
    server.tick();
    expect(server.runCount).toBe(2);
    expect(server.instanceOf(1)?.playerIds).toEqual(ids(1, MAX_PARTY_SIZE));
    expect(server.instanceOf(n)?.playerIds).toEqual([n]);
  });

  it("leaving the queue means no run starts", async () => {
    const { client } = await joined();
    client.send(queue);
    client.send(encodeMessage({ type: "leaveQueue" }));
    await until(() => !server.isQueued(1));
    server.tick();
    expect(server.runCount).toBe(0);
  });

  it("rejects queueing twice, while in a run, or for an unknown dungeon", async () => {
    const [c] = await inRun(1);
    c!.send(queue);
    expect((await nextOfType(c!, "error")).reason).toBe("already in a run");
    const { client } = await joined();
    client.send(JSON.stringify({ type: "queue", dungeon: "dragon-lair" }));
    expect((await nextOfType(client, "error")).reason).toBe(
      "queue: unknown dungeon",
    );
    client.send(queue);
    client.send(queue);
    expect((await nextOfType(client, "error")).reason).toBe("already queued");
  });

  it("joins a run in progress within its first 15 s (D-052)", async () => {
    const [a] = await inRun(1);
    for (let t = 0; t < 14 * 60; t++) server.tick(); // 14 s in
    const { client: b } = await joined();
    b.send(queue);
    await until(() => server.isQueued(2));
    server.tick();
    expect(await nextOfType(b, "runStarted")).toEqual({
      type: "runStarted",
      dungeon: GW,
      players: [1, 2],
    });
    expect(server.instanceOf(2)).toBe(server.instanceOf(1));
    // The joiner starts fresh at the spawn; enemies rescale for two.
    expect(playerOf(2)).toMatchObject({
      position: { x: 1000, y: 1000 },
      hp: PLAYER_HEALTH.maxHp,
    });
    server.tick();
    expect(dummy().maxHp).toBe(750);
    let snap = await nextOfType(a!, "snapshot");
    while (snap.players.length < 2) snap = await nextOfType(a!, "snapshot");
    expect(snap.players.map((p) => p.id)).toEqual([1, 2]);
  });

  it("after 15 s the run is locked; a new queuer gets a separate world", async () => {
    const [a] = await inRun(1);
    for (let t = 0; t < 15 * 60; t++) server.tick();
    const [b] = await inRun(1);
    expect(server.instanceOf(1)).not.toBe(server.instanceOf(2));
    expect(server.instanceOf(1)?.playerIds).toEqual([1]);
    server.tick();
    const snapA = await nextOfType(a!, "snapshot");
    expect(snapA.players.map((p) => p.id)).toEqual([1]);
    await nextOfType(b!, "snapshot");
  });

  it("a player who left cannot rejoin the same run, even inside the window", async () => {
    const [a] = await inRun(2);
    const firstRun = server.instanceOf(1);
    a!.send(encodeMessage({ type: "exitDungeon" }));
    await nextOfType(a!, "runEnded");
    a!.send(queue);
    await until(() => server.isQueued(1));
    server.tick();
    await nextOfType(a!, "runStarted");
    expect(server.instanceOf(1)).not.toBe(firstRun);
    expect(firstRun?.playerIds).toEqual([2]);
  });

  it("does not let anyone into a full run, even inside the window", async () => {
    await inRun(MAX_PARTY_SIZE);
    await inRun(1);
    const next = MAX_PARTY_SIZE + 1;
    expect(server.instanceOf(next)?.playerIds).toEqual([next]);
    expect(server.instanceOf(1)?.playerIds).toEqual(ids(1, MAX_PARTY_SIZE));
  });
});

describe("authoritative movement (4b)", () => {
  it("moves a player only by its inputs, one per tick, and acks them", async () => {
    const [client] = await inRun(1);
    for (let seq = 0; seq < 30; seq++) {
      client!.send(input(seq, 1, 0));
      await until(() => server.queuedInputs(1) === 1);
      server.tick();
    }
    // 30 ticks × 150 px/s × 1/60 s = 75 px.
    expect(playerOf(1).position.x).toBeCloseTo(1075, 9);
    expect(server.instanceOf(1)?.snapshotPlayers()[0]?.ack).toBe(29);
  });

  it("sends each run's snapshot, with every member, every tick", async () => {
    const [a] = await inRun(2);
    server.tick();
    const snap = await nextOfType(a!, "snapshot");
    expect(snap.players.map((p) => p.id).sort()).toEqual([1, 2]);
  });

  it("rejects a too-long direction and does not move", async () => {
    const [client] = await inRun(1);
    client!.send(input(0, 2, 0));
    expect(await nextOfType(client!, "error")).toEqual({
      type: "error",
      reason: "input: move must have length <= 1",
    });
    server.tick();
    expect(playerOf(1).position.x).toBe(1000);
  });

  it("rejects a position sent instead of an intent", async () => {
    const [client] = await inRun(1);
    client!.send(JSON.stringify({ type: "input", seq: 0, x: 1900, y: 1900 }));
    expect((await nextOfType(client!, "error")).reason).toBe(
      "input: unexpected fields",
    );
  });

  it("rejects input before hello and replayed seq numbers", async () => {
    const c = await connect(server.port);
    clients.push(c);
    c.send(input(0, 1, 0));
    expect((await c.next()).type).toBe("error");
    const [client] = await inRun(1);
    client!.send(input(5, 1, 0));
    client!.send(input(5, 1, 0));
    expect((await nextOfType(client!, "error")).reason).toBe(
      "input seq must increase",
    );
  });

  it("drops a disconnected player from their run", async () => {
    const [a, b] = await inRun(2);
    b!.socket.close();
    await until(() => server.instanceOf(2) === undefined);
    expect(sim(1).players.map((p) => p.id)).toEqual([1]);
    server.tick();
    let snap = await nextOfType(a!, "snapshot");
    while (snap.players.length > 1) snap = await nextOfType(a!, "snapshot");
    expect(snap.players.map((p) => p.id)).toEqual([1]);
  });

  it("closes a client that floods messages", async () => {
    const [client] = await inRun(1);
    for (let seq = 0; seq < 400; seq++) client!.send(input(seq, 1, 0));
    expect(await client!.closed).toEqual({ code: 1008, reason: "rate limit" });
  });
});

describe("real-time loop", () => {
  it("processes queued inputs at about 60 ticks per second on its own", async () => {
    const live = await GameServer.start({
      accounts: testAccounts(),
      port: 0,
      queueWaitSeconds: 0,
      log: silentLogger,
    });
    try {
      const c = await connect(live.port);
      clients.push(c);
      await helloAndLogin(c);
      c.send(queue);
      await nextOfType(c, "runStarted");
      // Send like a real client: one input every 1/60 s for 0.5 s.
      for (let seq = 0; seq < 30; seq++) {
        c.send(input(seq, 0, 1));
        await new Promise((r) => setTimeout(r, 1000 / 60));
      }
      await new Promise((r) => setTimeout(r, 200));
      const p = live.instanceOf(1)?.snapshotPlayers()[0];
      expect(p?.ack).toBe(29);
      // Timer jitter may make the server drop a stale input or two, never add any.
      expect(p?.y).toBeGreaterThan(1075 - 3 * 2.5 - 1e-9);
      expect(p?.y).toBeLessThanOrEqual(1075 + 1e-9);
    } finally {
      await live.close();
    }
  });
});

describe("shared combat on the server (5b)", () => {
  it("a player's shots damage the shared dummy, and the party sees the same HP", async () => {
    const [a, b] = await inRun(2);
    // Dummy at (1300, 1100); put player 1 100 px to its left.
    placePlayer(1, { x: 1200, y: 1100 });
    await drive(a!, 1, 0, 60, { x: 1, y: 0 });
    expect(dummy().hp).toBeLessThan(dummy().maxHp);
    server.tick();
    const snapA = await nextOfType(a!, "snapshot");
    let snapB = await nextOfType(b!, "snapshot");
    while (snapB.tick < snapA.tick) snapB = await nextOfType(b!, "snapshot");
    expect(snapA.enemies[0]?.hp).toBe(snapB.enemies[0]?.hp);
  });

  it("scales the dummy's HP for two living players (D-045)", async () => {
    await inRun(2);
    server.tick();
    expect(dummy().maxHp).toBe(750);
  });

  it("cannot be tricked into a faster fire rate by sending extra inputs", async () => {
    const [client] = await inRun(1);
    placePlayer(1, { x: 1200, y: 1100 });
    let seq = 0;
    // Twice the honest rate (2 inputs per tick = 120/s). Not 5 per tick:
    // that would trip the 180 messages/s flood limit, a different safeguard.
    for (let t = 0; t < 60; t++) {
      for (let i = 0; i < 2; i++)
        client!.send(input(seq++, 0, 0, { x: 1, y: 0 }));
      await until(() => server.queuedInputs(1) >= 1);
      server.tick();
    }
    for (let t = 0; t < 30; t++) server.tick(); // let shots land
    // At most (60 ticks + 4 credit) inputs applied → at most 5 shots at 4/s.
    const damage = dummy().maxHp - dummy().hp;
    expect(damage).toBeLessThanOrEqual(5 * 25);
    expect(damage).toBeGreaterThan(0);
  });

  it("snapshots carry players' HP and cooldown, enemies, and projectiles", async () => {
    const [client] = await inRun(1);
    placePlayer(1, { x: 1200, y: 1100 });
    await drive(client!, 1, 0, 2, { x: 1, y: 0 });
    let snap = await nextOfType(client!, "snapshot");
    while (snap.projectiles.length === 0)
      snap = await nextOfType(client!, "snapshot");
    expect(snap.players[0]).toMatchObject({
      id: 1,
      hp: PLAYER_HEALTH.maxHp,
      maxHp: PLAYER_HEALTH.maxHp,
    });
    expect(snap.players[0]!.cooldown).toBeGreaterThan(0);
    expect(snap.enemies[0]).toMatchObject({
      id: 1,
      x: 1300,
      y: 1100,
      size: 16,
    });
    expect(
      snap.projectiles.some((p) => p.owner === "player" && p.by === 1),
    ).toBe(true);
    expect(server.lastSnapshotBytes).toBeGreaterThan(0);
    expect(server.lastSnapshotBytes).toBeLessThan(65536);
  });

  it("rejects an input claiming a hit", async () => {
    const [client] = await inRun(1);
    client!.send(
      JSON.stringify({
        type: "input",
        seq: 0,
        move: { x: 0, y: 0 },
        fire: { trigger: true, aim: { x: 1, y: 0 }, hit: 1 },
      }),
    );
    expect((await nextOfType(client!, "error")).reason).toBe(
      "input: fire must be {trigger, aim}",
    );
  });
});

describe("how runs end (6a)", () => {
  it("death ends the run at once with server-counted stats; survivors keep going (D-050)", async () => {
    const [a, b] = await inRun(2);
    // 1 HP (plus a little regen), directly west of the dummy: the next ring kills.
    placePlayer(1, { x: 1250, y: 1100 }, 1);
    for (let t = 0; t < 120 && server.instanceOf(1); t++) server.tick();
    const ended = await nextOfType(a!, "runEnded");
    expect(ended).toMatchObject({ dungeon: GW, result: "died" });
    expect(ended.stats.damageTaken).toBe(ENEMY_RING_ATTACK.damage);
    expect(ended.stats.seconds).toBeGreaterThan(0);
    // Player 2 is still in the run, and the dummy rescales for one player.
    server.tick();
    expect(server.instanceOf(2)?.playerIds).toEqual([2]);
    expect(dummy(2).maxHp).toBe(500);
    // Late inputs from the dead player are ignored, not errors.
    a!.send(input(0, -1, 0));
    a!.send(hello);
    expect((await nextOfType(a!, "error")).reason).toBe("already joined");
    await nextOfType(b!, "snapshot");
  });

  it("clearing every enemy completes the run for every survivor", async () => {
    const [a, b] = await inRun(2);
    placePlayer(1, { x: 1200, y: 1100 });
    setDummyHp(1, 25);
    await drive(a!, 1, 0, 30, { x: 1, y: 0 });
    for (const c of [a!, b!]) {
      const ended = await nextOfType(c, "runEnded");
      expect(ended.result).toBe("completed");
    }
    expect(server.runCount).toBe(0);
  });

  it("counts shots, hits, damage, and the defeat for the player who landed them", async () => {
    const [a] = await inRun(1);
    placePlayer(1, { x: 1200, y: 1100 });
    setDummyHp(1, 50);
    await drive(a!, 1, 0, 40, { x: 1, y: 0 });
    for (let t = 0; t < 30 && server.instanceOf(1); t++) server.tick();
    const { stats } = await nextOfType(a!, "runEnded");
    expect(stats).toMatchObject({
      shotsHit: 2,
      damageDealt: 50,
      enemiesDefeated: 1,
    });
    expect(stats.shotsFired).toBeGreaterThanOrEqual(2);
  });

  it("R (exitDungeon) leaves at once; the player can requeue and seqs restart at 0", async () => {
    const [a] = await inRun(1);
    await drive(a!, 1, 0, 5, null);
    a!.send(encodeMessage({ type: "exitDungeon" }));
    expect((await nextOfType(a!, "runEnded")).result).toBe("left");
    expect(server.instanceOf(1)).toBeUndefined();
    server.tick();
    expect(server.runCount).toBe(0);

    a!.send(queue);
    await until(() => server.isQueued(1));
    server.tick();
    await nextOfType(a!, "runStarted");
    // A fresh run: back at the spawn with full HP, accepting seq 0 again.
    expect(playerOf(1)).toMatchObject({
      position: { x: 1000, y: 1000 },
      hp: PLAYER_HEALTH.maxHp,
    });
    await drive(a!, 1, 0, 1, null);
    expect(server.instanceOf(1)?.snapshotPlayers()[0]?.ack).toBe(0);
  });

  it("exitDungeon and leaveQueue at the menu are harmless no-ops", async () => {
    const { client } = await joined();
    client.send(encodeMessage({ type: "exitDungeon" }));
    client.send(encodeMessage({ type: "leaveQueue" }));
    client.send(hello);
    expect((await nextOfType(client, "error")).reason).toBe("already joined");
  });
});

describe("accounts (7a)", () => {
  const send = (c: TestClient, m: Parameters<typeof encodeMessage>[0]) =>
    c.send(encodeMessage(m));

  it("refuses to queue before logging in", async () => {
    const { client } = await joined({ login: false });
    client.send(queue);
    expect((await nextOfType(client, "error")).reason).toBe("log in first");
  });

  it("register → authOk with a token; a new connection resumes with it", async () => {
    const { client } = await joined({ login: false });
    send(client, {
      type: "register",
      email: "Serf@Test.example",
      password: PASSWORD,
    });
    const ok = await nextOfType(client, "authOk");
    expect(ok.email).toBe("serf@test.example");
    expect(ok.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    client.socket.close();

    const { client: again } = await joined({ login: false });
    send(again, { type: "resume", token: ok.token });
    expect(await nextOfType(again, "authOk")).toEqual({
      type: "authOk",
      email: "serf@test.example",
      token: ok.token,
    });
    again.send(queue);
    expect((await nextOfType(again, "queueStatus")).queued).toBe(1);
  });

  it("wrong passwords get one message, and are not counted as invalid messages", async () => {
    const { client } = await joined({ login: false });
    send(client, {
      type: "register",
      email: "x@test.example",
      password: PASSWORD,
    });
    await nextOfType(client, "authOk");
    const { client: other } = await joined({ login: false });
    // Six wrong tries: more than the 5 invalid messages that would close a connection.
    for (let i = 0; i < 6; i++) {
      send(other, {
        type: "login",
        email: "x@test.example",
        password: "wrong pass",
      });
      const err = await nextOfType(other, "authError");
      expect(err.reason).toMatch(/incorrect|Too many/);
    }
    expect(other.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("logging in elsewhere logs the older connection out (but keeps it connected)", async () => {
    const { client: first } = await joined({ login: false });
    send(first, {
      type: "register",
      email: "dup@test.example",
      password: PASSWORD,
    });
    await nextOfType(first, "authOk");
    first.send(queue);
    await nextOfType(first, "queueStatus");

    const { client: second } = await joined({ login: false });
    send(second, {
      type: "login",
      email: "dup@test.example",
      password: PASSWORD,
    });
    await nextOfType(second, "authOk");
    expect(await nextOfType(first, "loggedOut")).toEqual({
      type: "loggedOut",
      reason: "This account logged in somewhere else.",
    });
    expect(server.isQueued(1)).toBe(false);
    expect(first.socket.readyState).toBe(WebSocket.OPEN);
    first.send(queue);
    expect((await nextOfType(first, "error")).reason).toBe("log in first");
  });

  it("logout ends the session: the token no longer resumes", async () => {
    const { client } = await joined({ login: false });
    const token = await register(client);
    send(client, { type: "logout" });
    expect((await nextOfType(client, "loggedOut")).reason).toBe("Logged out.");
    send(client, { type: "resume", token });
    expect((await nextOfType(client, "authError")).reason).toBe(
      "Your login has expired. Please log in again.",
    );
  });

  it("logging out mid-run leaves the run", async () => {
    const [c] = await inRun(1);
    send(c!, { type: "logout" });
    expect((await nextOfType(c!, "runEnded")).result).toBe("left");
    await nextOfType(c!, "loggedOut");
    expect(server.instanceOf(1)).toBeUndefined();
  });

  it("rejects logging in twice and malformed tokens", async () => {
    const { client } = await joined();
    send(client, {
      type: "login",
      email: "a@test.example",
      password: PASSWORD,
    });
    expect((await nextOfType(client, "error")).reason).toBe(
      "already logged in",
    );
    client.send(JSON.stringify({ type: "resume", token: "short" }));
    expect((await nextOfType(client, "error")).reason).toBe(
      "resume: bad token",
    );
  });
});
