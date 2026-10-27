import { describe, expect, it } from "vitest";
import {
  encodeMessage,
  parseServerMessage,
  type SnapshotDelta,
  type SnapshotEnemy,
  type SnapshotMessage,
  type SnapshotPlayer,
  type SnapshotProjectile,
} from "./protocol.ts";
import { applySnapshotDelta, diffSnapshot } from "./snapshot-delta.ts";

const player: SnapshotPlayer = {
  id: 1,
  x: 1000,
  y: 1000,
  ack: 4,
  hp: 200,
  maxHp: 200,
  mp: 12.5,
  maxMp: 16,
  buffs: [],
  cooldown: 0,
  abilityCooldown: 0,
  boost: 0,
  pull: null,
};
const enemy = (id: number, x = 1300): SnapshotEnemy => ({
  id,
  kind: "grunt",
  x,
  y: 1100,
  size: 32,
  hp: 40,
  maxHp: 40,
  respawnIn: 0,
  alert: false,
  cursed: false,
  leads: false,
  dazed: false,
  chanted: false,
  pile: false,
  faded: false,
  facing: null,
  spinning: false,
  vented: false,
});
const shot = (id: number, x = 1010): SnapshotProjectile => ({
  id,
  owner: "enemy",
  by: 3,
  x,
  y: 1000,
  dx: 1,
  dy: 0,
  speed: 220,
  size: 8,
  ability: false,
  trap: false,
  fireball: false,
});
const snapshot = (over: Partial<SnapshotMessage> = {}): SnapshotMessage => ({
  type: "snapshot",
  tick: 10,
  players: [player],
  enemies: [enemy(3), enemy(4, 1400)],
  projectiles: [shot(7)],
  closedDoors: ["hall-gate"],
  hazards: [],
  fires: [],
  beams: [],
  waves: [],
  plates: [],
  clock: 2.5,
  whirlpools: [],
  surges: [],
  frost: [],
  cones: [],
  blades: [],
  swings: [],
  traps: [],
  runes: [],
  portalOpen: false,
  blasts: [],
  chains: [],
  zones: [],
  ...over,
});

/** The delta as the client gets it: encoded, sent, and parsed. */
function overTheWire(delta: SnapshotDelta): SnapshotDelta {
  const parsed = parseServerMessage(encodeMessage(delta));
  if (!parsed.ok || parsed.message.type !== "delta") {
    throw new Error(parsed.ok ? "not a delta" : parsed.error);
  }
  return parsed.message;
}

function roundTrip(prev: SnapshotMessage, next: SnapshotMessage) {
  const delta = diffSnapshot(prev, next);
  if (!delta) throw new Error("no delta");
  return { delta, rebuilt: applySnapshotDelta(prev, overTheWire(delta)) };
}

describe("snapshots send only what changed (T-053)", () => {
  it("nothing changed: the delta is only the tick", () => {
    const prev = snapshot();
    const { delta, rebuilt } = roundTrip(prev, { ...prev, tick: 11 });
    expect(delta).toEqual({ type: "delta", tick: 11, base: 10 });
    expect(rebuilt).toEqual({ ok: true, message: { ...prev, tick: 11 } });
  });

  it("a moving enemy sends its id and new position only", () => {
    const prev = snapshot();
    const next = snapshot({
      tick: 11,
      enemies: [{ ...enemy(3), x: 1302.5 }, enemy(4, 1400)],
    });
    const { delta, rebuilt } = roundTrip(prev, next);
    expect(delta.enemies).toEqual({ change: [{ id: 3, x: 1302.5 }] });
    expect(delta.players).toBeUndefined();
    expect(rebuilt).toEqual({ ok: true, message: next });
  });

  it("new, gone, changed, and reordered entries and fields all rebuild exactly", () => {
    const prev = snapshot();
    const next = snapshot({
      tick: 11,
      players: [{ ...player, hp: 180, buffs: ["guard"] }],
      // 4 now first, 3 gone, 5 new.
      enemies: [{ ...enemy(4, 1400), alert: true }, enemy(5, 900)],
      projectiles: [shot(8, 1200), shot(7, 1014)],
      closedDoors: [],
      clock: 2.52,
      portalOpen: true,
      blasts: [{ kind: "slam", by: 4, x: 1400, y: 1100, radius: 90 }],
    });
    const { delta, rebuilt } = roundTrip(prev, next);
    expect(delta.enemies?.remove).toEqual([3]);
    expect(delta.set).toEqual({
      closedDoors: [],
      clock: 2.52,
      portalOpen: true,
      blasts: [{ kind: "slam", by: 4, x: 1400, y: 1100, radius: 90 }],
    });
    expect(rebuilt).toEqual({ ok: true, message: next });
  });

  it("random changes always rebuild exactly (200 ticks in a row)", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let nextId = 100;
    let prev = snapshot();
    let client = prev;
    for (let t = 11; t < 211; t++) {
      const enemies = prev.enemies
        .filter(() => rand() > 0.1)
        .map((e) =>
          rand() < 0.7
            ? { ...e, x: e.x + Math.round(rand() * 400) / 100, hp: e.hp }
            : rand() < 0.5
              ? { ...e, hp: Math.max(0, e.hp - 5), alert: !e.alert }
              : e,
        );
      while (rand() < 0.3) enemies.push(enemy(nextId++, rand() * 2000));
      if (rand() < 0.1) enemies.reverse();
      const projectiles = prev.projectiles
        .filter(() => rand() > 0.2)
        .map((p) => ({ ...p, x: p.x + 3.67 }));
      while (rand() < 0.4) projectiles.push(shot(nextId++, rand() * 2000));
      const next = snapshot({
        tick: t,
        enemies,
        projectiles,
        clock: t / 60,
        portalOpen: rand() < 0.5,
      });
      const delta = diffSnapshot(prev, next);
      if (!delta) throw new Error("no delta");
      const rebuilt = applySnapshotDelta(client, overTheWire(delta));
      if (!rebuilt.ok) throw new Error(rebuilt.error);
      expect(rebuilt.message).toEqual(next);
      client = rebuilt.message;
      prev = next;
    }
  });

  it("a repeated id means only a whole snapshot will do", () => {
    const next = snapshot({ tick: 11, enemies: [enemy(3), enemy(3)] });
    expect(diffSnapshot(snapshot(), next)).toBeNull();
  });
});

describe("a delta that does not fit is refused, never guessed at (T-053)", () => {
  const prev = snapshot();
  const delta = (over: Partial<SnapshotDelta>): SnapshotDelta => ({
    type: "delta",
    tick: 11,
    base: 10,
    ...over,
  });
  const refused = (d: SnapshotDelta) => applySnapshotDelta(prev, d).ok;

  it("for another snapshot than the last one", () => {
    expect(applySnapshotDelta(prev, delta({ base: 9 }))).toMatchObject({
      ok: false,
      error: "delta is for snapshot 9, the last one was 10",
    });
  });

  it("changing or ordering ids that are not there", () => {
    expect(refused(delta({ enemies: { change: [{ id: 99, x: 1 }] } }))).toBe(
      false,
    );
    expect(refused(delta({ enemies: { order: [3] } }))).toBe(false);
    expect(refused(delta({ enemies: { order: [3, 99] } }))).toBe(false);
    expect(refused(delta({ enemies: { order: [3, 3] } }))).toBe(false);
  });

  it("tampered values fail the same checks as a whole snapshot", () => {
    expect(refused(delta({ set: { portalOpen: "yes" } }))).toBe(false);
    expect(refused(delta({ enemies: { change: [{ id: 3, hp: -5 }] } }))).toBe(
      false,
    );
    expect(
      refused(delta({ enemies: { change: [{ id: 3, owner: "player" }] } })),
    ).toBe(false);
    expect(refused(delta({ projectiles: { add: [{ id: 9, x: 1 }] } }))).toBe(
      false,
    );
  });

  it("the wire format refuses unknown fields and broken lists", () => {
    const bad = (v: unknown) => parseServerMessage(JSON.stringify(v)).ok;
    expect(bad({ type: "delta", tick: 11, base: 10 })).toBe(true);
    expect(bad({ type: "delta", tick: 11, base: 10, extra: 1 })).toBe(false);
    expect(bad({ type: "delta", tick: 11, base: 10, set: { tick: 3 } })).toBe(
      false,
    );
    // From the wire, "__proto__" is a plain key, refused like any unknown one.
    expect(
      parseServerMessage(
        '{"type":"delta","tick":11,"base":10,"set":{"__proto__":{"portalOpen":true}}}',
      ).ok,
    ).toBe(false);
    expect(
      bad({
        type: "delta",
        tick: 11,
        base: 10,
        enemies: { change: [{ x: 1 }] },
      }),
    ).toBe(false);
    expect(
      bad({ type: "delta", tick: 11, base: 10, enemies: { remove: ["3"] } }),
    ).toBe(false);
    expect(
      bad({ type: "delta", tick: 11, base: 10, enemies: { teleport: [] } }),
    ).toBe(false);
  });
});
