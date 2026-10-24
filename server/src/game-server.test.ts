import {
  clearExp,
  combatFor,
  encodeMessage,
  MAX_MESSAGE_BYTES,
  ENEMY_RING_ATTACK,
  MAX_PARTY_SIZE,
  PLAYER_HEALTH,
  parseServerMessage,
  PROTOCOL_VERSION,
  SERF_BASE,
  newRunStats,
  totalExpForLevel,
  sellPrice,
  STASH_SIZE,
  RACK_SIZE,
  SERF_MAX,
  type ServerMessage,
} from "@serfdom/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { MemoryAccountRepo } from "./auth/account-repo.ts";
import { AccountService } from "./auth/account-service.ts";
import { MemorySerfRepo } from "./serfs/serf-repo.ts";
import { SerfService } from "./serfs/serf-service.ts";
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

/** Registers a fresh account on an already-welcomed connection (no serf yet). */
async function register(client: TestClient): Promise<string> {
  const email = `player${++emailSeq}@test.example`;
  client.send(encodeMessage({ type: "register", email, password: PASSWORD }));
  const ok = await nextOfType(client, "authOk");
  await nextOfType(client, "serfList");
  return ok.token;
}

let serfSeq = 0;
/** Creates a serf on a logged-in connection; it is played at once. Returns its id. */
async function createSerf(client: TestClient): Promise<number> {
  client.send(encodeMessage({ type: "createSerf", name: `Serf${++serfSeq}` }));
  // Skip lists sent before this one (e.g. the one right after login).
  for (let i = 0; i < 10; i++) {
    const list = await nextOfType(client, "serfList");
    if (list.selectedId !== null) return list.selectedId;
  }
  throw new Error("serf not selected");
}

/** hello → welcome → register → serf: ready to queue. */
async function helloAndLogin(client: TestClient): Promise<void> {
  client.send(hello);
  await nextOfType(client, "welcome");
  await register(client);
  await createSerf(client);
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
    allowTestDungeons: true,
    accounts: testAccounts(),
    serfs: new SerfService(new MemorySerfRepo()),
    port: 0,
    helloTimeoutMs: 200,
    autoTick: false,
    // Runs start on the next tick, so tests decide exactly who is in a party.
    queueWaitSeconds: 0,
    // Seed 0: the handcrafted Warrens, so positions in these tests hold.
    dungeonSeed: () => 0,
    log: silentLogger,
  });
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.socket.terminate();
  await server.close();
});

/** A connected, welcomed client; by default logged in and playing a new serf. */
async function joined(
  options: { login?: boolean; serf?: boolean } = {},
): Promise<{
  client: TestClient;
  welcome: ServerMessage;
}> {
  const client = await connect(server.port);
  clients.push(client);
  client.send(hello);
  const welcome = await client.next();
  if (options.login ?? true) {
    await register(client);
    if (options.serf ?? true) await createSerf(client);
  }
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
        allowTestDungeons: true,
        port: server.port,
        accounts: testAccounts(),
        serfs: new SerfService(new MemorySerfRepo()),
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
    ability: null,
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
      seed: 0,
      players: [1],
      stats: SERF_BASE,
      weaponTier: null,
      ability: null,
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

  it("sends each run's layout seed to its starters and late joiners (D-104)", async () => {
    const live = await GameServer.start({
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(new MemorySerfRepo()),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 0,
      dungeonSeed: () => 987654,
      log: silentLogger,
    });
    try {
      const warrens = encodeMessage({
        type: "queue",
        dungeon: "goblin-warrens",
      });
      const a = await connect(live.port);
      clients.push(a);
      await helloAndLogin(a);
      a.send(warrens);
      await until(() => live.isQueued(1));
      live.tick();
      expect(await nextOfType(a, "runStarted")).toMatchObject({ seed: 987654 });
      expect(live.instanceOf(1)?.seed).toBe(987654);
      const b = await connect(live.port);
      clients.push(b);
      await helloAndLogin(b);
      b.send(warrens);
      await until(() => live.isQueued(2));
      live.tick();
      expect(await nextOfType(b, "runStarted")).toMatchObject({
        seed: 987654,
        players: [1, 2],
      });
    } finally {
      await live.close();
    }
  });

  it("waits up to the queue time, then starts solo (T-030)", async () => {
    const live = await GameServer.start({
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(new MemorySerfRepo()),
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
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(new MemorySerfRepo()),
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

  it("refuses the unlisted Training Yard unless test dungeons are on (D-107)", async () => {
    const live = await GameServer.start({
      accounts: testAccounts(),
      serfs: new SerfService(new MemorySerfRepo()),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 0,
      log: silentLogger,
    });
    try {
      const c = await connect(live.port);
      clients.push(c);
      await helloAndLogin(c);
      c.send(encodeMessage({ type: "queue", dungeon: "training" }));
      expect((await nextOfType(c, "error")).reason).toBe(
        "queue: unknown dungeon",
      );
      expect(live.isQueued(1)).toBe(false);
      // A listed dungeon queues at any level (D-107).
      c.send(encodeMessage({ type: "queue", dungeon: "goblin-warrens" }));
      await until(() => live.isQueued(1));
    } finally {
      await live.close();
    }
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
      seed: 0,
      players: [1, 2],
      stats: SERF_BASE,
      weaponTier: null,
      ability: null,
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
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(new MemorySerfRepo()),
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
        ability: null,
      }),
    );
    expect((await nextOfType(client!, "error")).reason).toBe(
      "input: fire must be {trigger, aim} (auto optional)",
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
    expect((await nextOfType(again, "error")).reason).toBe(
      "choose a serf first",
    );
    await createSerf(again);
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
    await createSerf(first);
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

  it("logging out mid-run leaves the run (no results screen, just loggedOut)", async () => {
    const [c] = await inRun(1);
    send(c!, { type: "logout" });
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

describe("serfs (7b)", () => {
  const send = (c: TestClient, m: Parameters<typeof encodeMessage>[0]) =>
    c.send(encodeMessage(m));

  it("a fresh account has no serfs and cannot queue until it creates one", async () => {
    const { client } = await joined({ serf: false });
    client.send(queue);
    expect((await nextOfType(client, "error")).reason).toBe(
      "choose a serf first",
    );
    send(client, { type: "createSerf", name: "  Edda   Rye " });
    const list = await nextOfType(client, "serfList");
    expect(list).toMatchObject({ slots: 2, selectedId: list.serfs[0]?.id });
    expect(list.serfs).toEqual([
      expect.objectContaining({ name: "Edda Rye", level: 1, alive: true }),
    ]);
    client.send(queue);
    expect((await nextOfType(client, "queueStatus")).queued).toBe(1);
  });

  it("refuses bad names, a third living serf, and duplicate living names", async () => {
    const { client } = await joined({ serf: false });
    send(client, { type: "createSerf", name: "x!" });
    expect((await nextOfType(client, "serfError")).reason).toBe(
      "Use at least 3 characters.",
    );
    await createSerf(client);
    await createSerf(client);
    send(client, { type: "createSerf", name: "Third One" });
    expect((await nextOfType(client, "serfError")).reason).toBe(
      "You already have 2 living serfs.",
    );
    const { client: other } = await joined({ serf: false });
    send(other, { type: "createSerf", name: `serf${serfSeq}` });
    expect((await nextOfType(other, "serfError")).reason).toBe(
      "A living serf already has that name.",
    );
  });

  it("you can only play your own serf", async () => {
    await joined(); // creates serf #1 (each test server starts empty)
    const { client: b } = await joined({ serf: false });
    send(b, { type: "selectSerf", serfId: 1 });
    expect((await nextOfType(b, "serfError")).reason).toBe("No such serf.");
    b.send(queue);
    expect((await nextOfType(b, "error")).reason).toBe("choose a serf first");
  });

  it("cannot switch serfs while queued or in a run", async () => {
    const [c] = await inRun(1);
    send(c!, { type: "selectSerf", serfId: 1 });
    expect((await nextOfType(c!, "error")).reason).toBe(
      "not while queued or in a run",
    );
  });

  it("death is permanent: runEnded carries the dead serf and its killer; it cannot be played again", async () => {
    const [a] = await inRun(1);
    placePlayer(1, { x: 1250, y: 1100 }, 1);
    for (let t = 0; t < 120 && server.instanceOf(1); t++) server.tick();
    const ended = await nextOfType(a!, "runEnded");
    expect(ended).toMatchObject({
      result: "died",
      killedBy: "dummy",
      serf: { alive: false, death: { dungeon: GW, killedBy: "dummy" } },
    });
    expect(ended.serf?.life.runs).toBe(1);
    const list = await nextOfType(a!, "serfList");
    expect(list.selectedId).toBeNull();
    expect(list.serfs[0]).toMatchObject({ alive: false });
    a!.send(queue);
    expect((await nextOfType(a!, "error")).reason).toBe("choose a serf first");
    send(a!, { type: "selectSerf", serfId: list.serfs[0]!.id });
    expect((await nextOfType(a!, "serfError")).reason).toMatch(/is dead\.$/);
  });

  it("completing adds a clear to the serf's life; leaving adds a run", async () => {
    const [a] = await inRun(1);
    a!.send(encodeMessage({ type: "exitDungeon" }));
    const left = await nextOfType(a!, "runEnded");
    expect(left.serf).toMatchObject({
      alive: true,
      life: { runs: 1, clears: 0 },
    });
    a!.send(queue);
    await until(() => server.isQueued(1));
    server.tick();
    await nextOfType(a!, "runStarted");
    placePlayer(1, { x: 1200, y: 1100 });
    setDummyHp(1, 25);
    await drive(a!, 1, 0, 30, { x: 1, y: 0 });
    const done = await nextOfType(a!, "runEnded");
    expect(done).toMatchObject({ result: "completed", killedBy: null });
    expect(done.serf?.life).toMatchObject({ runs: 2, clears: 1 });
  });
});

/** Plays one training run to completion (the dummy dies to one shot). */
async function clearOnce(c: TestClient, id: number, firstSeq: number) {
  c.send(queue);
  await until(() => server.isQueued(id));
  server.tick();
  await nextOfType(c, "runStarted");
  placePlayer(id, { x: 1200, y: 1100 });
  setDummyHp(id, 25);
  await drive(c, id, firstSeq, 30, { x: 1, y: 0 });
  return nextOfType(c, "runEnded");
}

describe("dungeon entry (D-107, D-108)", () => {
  it("the Stronghold refuses a serf with no completion, even by a hand-made queue message", async () => {
    const { client } = await joined();
    client.send(encodeMessage({ type: "queue", dungeon: "goblin-stronghold" }));
    expect((await nextOfType(client, "error")).reason).toBe(
      "Complete the Goblin Warrens first.",
    );
    expect(server.isQueued(1)).toBe(false);
    // One completion opens it (in tests the Training Yard stands in for
    // the Warrens; real players cannot queue for it).
    await clearOnce(client, 1, 0);
    client.send(encodeMessage({ type: "queue", dungeon: "goblin-stronghold" }));
    await until(() => server.isQueued(1));
  });

  it("the Forgotten Crypt follows the same rule (D-107, D-120)", async () => {
    const { client } = await joined();
    client.send(encodeMessage({ type: "queue", dungeon: "forgotten-crypt" }));
    expect((await nextOfType(client, "error")).reason).toBe(
      "Complete the Goblin Warrens first.",
    );
    expect(server.isQueued(1)).toBe(false);
    await clearOnce(client, 1, 0);
    client.send(encodeMessage({ type: "queue", dungeon: "forgotten-crypt" }));
    await until(() => server.isQueued(1));
  });
});

describe("a party clears the new dungeons (Phase 12 acceptance, D-126)", () => {
  for (const [dungeon, tiers] of [
    ["goblin-stronghold", [2, 3, 4]],
    ["forgotten-crypt", [3, 4, 5]],
  ] as const) {
    it(`two players clear the ${dungeon} together, each with their own EXP and chest`, async () => {
      const a = (await joined()).client;
      const b = (await joined()).client;
      // Each serf has completed something, so the dungeon is open (D-107).
      await clearOnce(a, 1, 0);
      await clearOnce(b, 2, 0);
      const go = encodeMessage({ type: "queue", dungeon });
      a.send(go);
      b.send(go);
      await until(() => server.isQueued(1) && server.isQueued(2));
      server.tick();
      await nextOfType(a, "runStarted");
      await nextOfType(b, "runStarted");
      const run = server.instanceOf(1)!;
      expect(server.instanceOf(2)).toBe(run);
      const portal = run.layout.exitPortal!;
      // Into the boss room together: it wakes and its boss appears.
      for (const id of [1, 2]) {
        placePlayer(
          id,
          { x: portal.x - 120, y: portal.y + (id === 1 ? -40 : 40) },
          1e6,
        );
      }
      for (let t = 0; t < 3; t++) server.tick();
      const boss = run.state.enemies.find((e) => e.roomId === "throne");
      expect(boss?.kind).toBe(
        dungeon === "goblin-stronghold" ? "warchief" : "lich",
      );
      // Its health scales for two (D-045).
      expect(boss!.maxHp).toBeGreaterThan(boss!.baseMaxHp);
      run.setStateForTest({ ...run.state, enemies: [] });
      for (let t = 0; t < 3; t++) server.tick();
      for (const id of [1, 2]) placePlayer(id, portal);
      server.tick();
      const ends = [
        await nextOfType(a, "runEnded"),
        await nextOfType(b, "runEnded"),
      ];
      for (const end of ends) {
        expect(end.result).toBe("completed");
        expect(end.dungeon).toBe(dungeon);
        // Each serf earns its own EXP by its own level (D-071).
        expect(end.expGained).toBe(clearExp(dungeon, 2));
        // One chest each (Luck 1), from the dungeon's own tiers.
        expect(end.loot).toHaveLength(1);
        expect(tiers as readonly number[]).toContain(end.loot[0]!.item.tier);
        // At most one potion each (one roll per Luck point).
        expect(end.potions.length).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe("EXP and the leaderboard (8a)", () => {
  it("completion gives 100 EXP and level 2; the next clear adds 100 more", async () => {
    const { client } = await joined();
    const first = await clearOnce(client, 1, 0);
    expect(first.expGained).toBe(100);
    expect(first.serf).toMatchObject({ exp: 100, level: 2 });
    // Level 2 rolled Serf gains (D-074): HP always grows 1–3.
    expect(first.statGains.hp).toBeGreaterThanOrEqual(1);
    expect(first.serf?.stats.hp).toBe(20 + first.statGains.hp);
    // One chest at Luck 1 (D-068); its item is in the bag (D-080).
    expect(first.loot).toHaveLength(1);
    expect(first.loot[0]?.pending).toBe(false);
    expect(first.serf?.items).toEqual([]); // to the stash, not worn (D-086)
    const second = await clearOnce(client, 1, 0);
    expect(second.serf).toMatchObject({ exp: 200, level: 2 });
  });

  it("R and death earn nothing, and a dead serf keeps the EXP it had", async () => {
    const { client } = await joined();
    await clearOnce(client, 1, 0);
    client.send(queue);
    await until(() => server.isQueued(1));
    server.tick();
    await nextOfType(client, "runStarted");
    placePlayer(1, { x: 1250, y: 1100 }, 1);
    for (let t = 0; t < 120 && server.instanceOf(1); t++) server.tick();
    const died = await nextOfType(client, "runEnded");
    expect(died).toMatchObject({ result: "died", expGained: 0 });
    expect(died.serf).toMatchObject({ alive: false, exp: 100, level: 2 });
  });

  it("the leaderboard lists serfs by EXP with no account data, and needs a login", async () => {
    const { client: anon } = await joined({ login: false });
    anon.send(encodeMessage({ type: "getLeaderboard" }));
    expect((await nextOfType(anon, "error")).reason).toBe("log in first");

    const { client } = await joined();
    await clearOnce(client, 2, 0);
    client.send(encodeMessage({ type: "getLeaderboard" }));
    const board = await nextOfType(client, "leaderboard");
    expect(board.entries[0]).toEqual({
      rank: 1,
      name: expect.any(String),
      level: 2,
      exp: 100,
      classId: null,
      alive: true,
    });
    expect(JSON.stringify(board)).not.toContain("@");
  });
});

describe("class choice at level 5 (8b, D-073)", () => {
  const choose = (serfId: number, classId: string) =>
    // Raw JSON: one test sends a class the type system would not allow.
    JSON.stringify({ type: "chooseClass", serfId, classId });

  it("a level-5 serf must choose before queueing; the class is then permanent", async () => {
    const { client } = await joined();
    const serfId = (await clearOnce(client, 1, 0)).serf!.id;
    client.send(choose(serfId, "fighter"));
    expect((await nextOfType(client, "serfError")).reason).toMatch(
      /picks a class at level 5.$/,
    );
    let last = await clearOnce(client, 1, 0);
    for (let i = 0; i < 3; i++) last = await clearOnce(client, 1, 0);
    expect(last.serf).toMatchObject({ level: 5, classId: null });

    client.send(queue);
    expect((await nextOfType(client, "error")).reason).toBe(
      "choose a class first",
    );
    expect(server.isQueued(1)).toBe(false);

    client.send(choose(serfId, "fighter"));
    let list = await nextOfType(client, "serfList");
    while (list.serfs[0]?.classId !== "fighter") {
      list = await nextOfType(client, "serfList");
    }
    expect(list.selectedId).toBe(serfId);

    client.send(choose(serfId, "wizard"));
    expect((await nextOfType(client, "serfError")).reason).toMatch(
      /already a Fighter; a class is permanent.$/,
    );
    const next = await clearOnce(client, 1, 0);
    expect(next.serf).toMatchObject({ classId: "fighter", level: 5 });
  });

  it("refuses unknown classes at the parser and other accounts' serfs", async () => {
    const { client: a } = await joined();
    const serfId = (await clearOnce(a, 1, 0)).serf!.id;
    a.send(choose(serfId, "paladin"));
    expect((await nextOfType(a, "error")).reason).toMatch(/unknown class/);

    const { client: b } = await joined();
    b.send(choose(serfId, "rogue"));
    expect((await nextOfType(b, "serfError")).reason).toBe("No such serf.");
  });
});

describe("stats in combat (8c-2, D-077)", () => {
  it("a run uses the serf's rolled stats, and runStarted tells the client", async () => {
    const { client } = await joined();
    client.send(queue);
    await until(() => server.isQueued(1));
    server.tick();
    const fresh = await nextOfType(client, "runStarted");
    expect(fresh.stats).toEqual(SERF_BASE);
    client.send(encodeMessage({ type: "exitDungeon" }));
    await nextOfType(client, "runEnded");

    const leveled = (await clearOnce(client, 1, 0)).serf!;
    expect(leveled.stats.hp).toBeGreaterThan(SERF_BASE.hp);
    client.send(queue);
    await until(() => server.isQueued(1));
    server.tick();
    expect((await nextOfType(client, "runStarted")).stats).toEqual(
      leveled.stats,
    );
    const me = server.instanceOf(1)!.state.players.find((p) => p.id === 1)!;
    expect(me.maxHp).toBe(leveled.stats.hp);
    expect(me.hp).toBe(leveled.stats.hp);
    expect(me.combat).toEqual(combatFor(leveled.stats));
  });
});

describe("stash, selling, and held rewards (9a, D-085–D-088)", () => {
  it("a full stash holds the reward, blocks the serf, and selling settles it", async () => {
    await server.close();
    const repo = new MemorySerfRepo();
    server = await GameServer.start({
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(repo),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 0,
      log: silentLogger,
    });
    const { client } = await joined();
    const serfId = (await clearOnce(client, 1, 0)).serf!.id;
    const cape = {
      slot: "cape" as const,
      type: "hp" as const,
      tier: 0,
      rolls: [],
      luck: 0,
    };
    // Account 1 (the first registered): the first clear left 1 item; fill the rest.
    await repo.addLoot(1, serfId, Array(STASH_SIZE - 1).fill(cape), STASH_SIZE);

    const full = await clearOnce(client, 1, 0);
    expect(full.loot).toHaveLength(1);
    expect(full.loot[0]?.pending).toBe(true);
    let stash = await nextOfType(client, "stash");
    while (stash.pending.length === 0)
      stash = await nextOfType(client, "stash");
    expect(stash.items).toHaveLength(STASH_SIZE);

    client.send(queue);
    expect((await nextOfType(client, "error")).reason).toBe(
      "settle your rewards first",
    );
    expect(server.isQueued(1)).toBe(false);

    client.send(
      encodeMessage({ type: "sellItem", itemId: stash.items[0]!.id }),
    );
    const after = await nextOfType(client, "stash");
    expect(after.gold).toBe(sellPrice(stash.items[0]!));
    expect(after.pending).toEqual([]);
    expect(after.items.map((i) => i.id)).toContain(full.loot[0]!.item.id);

    client.send(queue);
    await until(() => server.isQueued(1));
  });

  it("a held reward survives a disconnect and still blocks the serf (D-088)", async () => {
    await server.close();
    const repo = new MemorySerfRepo();
    server = await GameServer.start({
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(repo),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 0,
      log: silentLogger,
    });
    const { client } = await joined({ login: false });
    const token = await register(client);
    const serfId = await createSerf(client);
    const cape = {
      slot: "cape" as const,
      type: "hp" as const,
      tier: 0,
      rolls: [],
      luck: 0,
    };
    await repo.addLoot(1, serfId, Array(STASH_SIZE).fill(cape), STASH_SIZE);
    expect((await clearOnce(client, 1, 0)).loot[0]?.pending).toBe(true);
    client.socket.close();

    const { client: again } = await joined({ login: false });
    again.send(encodeMessage({ type: "resume", token }));
    let stash = await nextOfType(again, "stash");
    while (stash.pending.length === 0) stash = await nextOfType(again, "stash");
    expect(stash.pending).toHaveLength(1);
    expect(stash.pending[0]?.serfId).toBe(serfId);
    again.send(encodeMessage({ type: "selectSerf", serfId }));
    let list = await nextOfType(again, "serfList");
    while (list.selectedId !== serfId)
      list = await nextOfType(again, "serfList");
    again.send(queue);
    expect((await nextOfType(again, "error")).reason).toBe(
      "settle your rewards first",
    );
  });

  it("stash requests need a login; unknown or others' items do not sell", async () => {
    const { client: anon } = await joined({ login: false });
    anon.send(encodeMessage({ type: "getStash" }));
    expect((await nextOfType(anon, "error")).reason).toBe("log in first");

    const { client } = await joined();
    client.send(encodeMessage({ type: "getStash" }));
    expect(await nextOfType(client, "stash")).toMatchObject({
      capacity: STASH_SIZE,
      gold: 0,
    });
    client.send(encodeMessage({ type: "sellItem", itemId: 424242 }));
    expect((await nextOfType(client, "stashError")).reason).toBe(
      "No such item in your stash.",
    );
  });
});

describe("equipping over the network (9b)", () => {
  it("equips a stash item, the next run fights with it, and not while queued", async () => {
    await server.close();
    const repo = new MemorySerfRepo();
    server = await GameServer.start({
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(repo),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 0,
      log: silentLogger,
    });
    const { client } = await joined();
    const serfId = 1; // the first serf in a fresh repo
    const ring = {
      slot: "ring" as const,
      type: "speed" as const,
      tier: 1,
      rolls: [],
      luck: 0,
    };
    const [drop] = (await repo.addLoot(1, serfId, [ring], STASH_SIZE)) ?? [];

    client.send(
      encodeMessage({
        type: "equipItem",
        itemId: drop!.item.id,
        serfId,
        slot: "ring1",
      }),
    );
    let serfs = await nextOfType(client, "serfList");
    while (serfs.serfs[0]?.items.length === 0)
      serfs = await nextOfType(client, "serfList");
    expect(serfs.serfs[0]?.items).toEqual([
      { ...drop!.item, equipped: "ring1" },
    ]);

    client.send(queue);
    await until(() => server.isQueued(1));
    client.send(encodeMessage({ type: "unequipItem", serfId, slot: "ring1" }));
    expect((await nextOfType(client, "error")).reason).toBe(
      "not while queued or in a run",
    );
    server.tick();
    const started = await nextOfType(client, "runStarted");
    expect(started.stats.speed).toBe(SERF_BASE.speed + 2);
    expect(started.weaponTier).toBeNull();
    const me = server.instanceOf(1)!.state.players.find((p) => p.id === 1)!;
    expect(me.combat.moveSpeed).toBe(
      combatFor({ ...SERF_BASE, speed: 12 }).moveSpeed,
    );
  });
});

describe("the potion rack over the network (D-118)", () => {
  it("drinks and pours out rack potions; no drinking while queued", async () => {
    await server.close();
    const repo = new MemorySerfRepo();
    server = await GameServer.start({
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(repo),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 0,
      log: silentLogger,
    });
    const { client } = await joined();
    const serfId = 1;
    const drops = (await repo.addPotions(
      1,
      serfId,
      ["vitality", "vitality", "mp"],
      RACK_SIZE,
    ))!;
    const [first, second, third] = drops.map((d) => d.potion.id);
    client.send(encodeMessage({ type: "getStash" }));
    expect(await nextOfType(client, "stash")).toMatchObject({
      rackCapacity: RACK_SIZE,
      rack: drops.map((d) => d.potion),
      pendingPotions: [],
    });
    // Before a class, a Serf drinks up to the Serf max (D-119); here VIT is there already.
    await repo.saveStats(
      1,
      serfId,
      { ...SERF_BASE, vitality: SERF_MAX.vitality },
      1,
      1,
    );
    client.send(
      encodeMessage({ type: "drinkPotion", potionId: first!, serfId }),
    );
    expect((await nextOfType(client, "stashError")).reason).toContain(
      "a class raises it",
    );
    await repo.chooseClass(1, serfId, "druid", 0, { ...SERF_BASE }, 1);
    client.send(
      encodeMessage({ type: "drinkPotion", potionId: first!, serfId }),
    );
    let serfs = await nextOfType(client, "serfList");
    while (serfs.serfs[0]?.stats.vitality === SERF_BASE.vitality)
      serfs = await nextOfType(client, "serfList");
    expect(serfs.serfs[0]?.stats.vitality).toBe(SERF_BASE.vitality + 1);
    let stash = await nextOfType(client, "stash");
    while (stash.rack.length === 3) stash = await nextOfType(client, "stash");
    expect(stash.rack.map((p) => p.id)).toEqual([second, third]);

    client.send(queue);
    await until(() => server.isQueued(1));
    client.send(
      encodeMessage({ type: "drinkPotion", potionId: second!, serfId }),
    );
    expect((await nextOfType(client, "error")).reason).toBe(
      "not while queued or in a run",
    );
    // Pouring out is fine while queued, like selling.
    client.send(encodeMessage({ type: "pourPotion", potionId: third! }));
    stash = await nextOfType(client, "stash");
    while (stash.rack.length === 2) stash = await nextOfType(client, "stash");
    expect(stash.rack.map((p) => p.id)).toEqual([second]);
  });
});

describe("Arcane Blast over the network (10a, D-092–D-096)", () => {
  it("a Wizard with the free Spellbook casts at the dummy: MP spent, damage dealt, blast sent", async () => {
    await server.close();
    const repo = new MemorySerfRepo();
    server = await GameServer.start({
      allowTestDungeons: true,
      accounts: testAccounts(),
      serfs: new SerfService(repo),
      port: 0,
      autoTick: false,
      queueWaitSeconds: 0,
      log: silentLogger,
    });
    const { client } = await joined();
    const serfId = 1;
    await repo.recordRun(
      1,
      serfId,
      "completed",
      { ...newRunStats(), seconds: 1 },
      null,
      totalExpForLevel(5),
    );
    client.send(encodeMessage({ type: "selectSerf", serfId }));
    // One serf request at a time: wait for the select to finish first.
    let picked = await nextOfType(client, "serfList");
    while (picked.serfs[0]?.level !== 5)
      picked = await nextOfType(client, "serfList");
    client.send(
      encodeMessage({ type: "chooseClass", serfId, classId: "wizard" }),
    );
    let list = await nextOfType(client, "serfList");
    while (!list.serfs[0]?.items.some((i) => i.type === "spellbook")) {
      list = await nextOfType(client, "serfList");
    }

    client.send(queue);
    await until(() => server.isQueued(1));
    server.tick();
    await nextOfType(client, "runStarted");
    placePlayer(1, { x: 1200, y: 1100 }); // the dummy is 100 px east
    setDummyHp(1, 400);
    const mpBefore = server.instanceOf(1)!.state.players[0]!.mp;
    client.send(
      JSON.stringify({
        type: "input",
        seq: 0,
        move: { x: 0, y: 0 },
        fire: { trigger: false, aim: null },
        ability: { x: 100, y: 0 },
      }),
    );
    await until(() => server.queuedInputs(1) >= 1);
    server.tick();
    const state = server.instanceOf(1)!.state;
    expect(state.players[0]!.mp).toBeLessThan(mpBefore - 14); // 15 MP (plus a tick of regen)
    expect(state.enemies[0]!.hp).toBeLessThan(400);
    let snap = await nextOfType(client, "snapshot");
    while (snap.blasts.length === 0)
      snap = await nextOfType(client, "snapshot");
    expect(snap.blasts[0]).toMatchObject({
      by: 1,
      x: 1300,
      y: 1100,
      radius: 40,
    });
  });
});
