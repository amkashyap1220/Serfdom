import { MAX_PARTY_SIZE } from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { Matchmaker } from "./matchmaking.ts";

const GW = "goblin-warrens";
const ids = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + i);

describe("Matchmaker", () => {
  it("starts a solo run once the wait is over, not before", () => {
    const m = new Matchmaker(300);
    m.join(1, GW, 0);
    expect(m.takeReady(299)).toEqual([]);
    expect(m.ticksUntilStart(GW, 299)).toBe(1);
    expect(m.takeReady(300)).toEqual([{ dungeon: GW, players: [1] }]);
    expect(m.has(1)).toBe(false);
  });

  it("is 10 players per run (D-012)", () => {
    expect(MAX_PARTY_SIZE).toBe(10);
  });

  it("starts immediately when a full party is waiting", () => {
    const m = new Matchmaker(300);
    for (const id of ids(1, MAX_PARTY_SIZE)) m.join(id, GW, 10);
    expect(m.takeReady(10)).toEqual([
      { dungeon: GW, players: ids(1, MAX_PARTY_SIZE) },
    ]);
  });

  it("fills parties first come, first served, at most MAX_PARTY_SIZE per run", () => {
    const m = new Matchmaker(300);
    for (const id of ids(1, MAX_PARTY_SIZE + 2)) m.join(id, GW, id);
    expect(m.takeReady(MAX_PARTY_SIZE + 2)).toEqual([
      { dungeon: GW, players: ids(1, MAX_PARTY_SIZE) },
    ]);
    // The wait for the rest counts from the earliest of them.
    const first = MAX_PARTY_SIZE + 1;
    expect(m.ticksUntilStart(GW, MAX_PARTY_SIZE + 2)).toBe(299);
    expect(m.takeReady(first + 300)).toEqual([
      { dungeon: GW, players: [first, first + 1] },
    ]);
  });

  it("takes everyone who is waiting when the timer runs out", () => {
    const m = new Matchmaker(300);
    m.join(1, GW, 0);
    m.join(2, GW, 200);
    expect(m.takeReady(300)).toEqual([{ dungeon: GW, players: [1, 2] }]);
  });

  it("forgets players who leave, and the timer moves to the next in line", () => {
    const m = new Matchmaker(300);
    m.join(1, GW, 0);
    m.join(2, GW, 100);
    expect(m.leave(1)).toEqual({ dungeon: GW, players: [1] });
    expect(m.leave(1)).toBeNull();
    expect(m.takeReady(300)).toEqual([]);
    expect(m.takeReady(400)).toEqual([{ dungeon: GW, players: [2] }]);
  });

  it("refuses to queue the same player twice", () => {
    const m = new Matchmaker(300);
    m.join(1, GW, 0);
    expect(() => m.join(1, GW, 1)).toThrow();
  });

  it("with no wait, starts whoever is queued on the next tick", () => {
    const m = new Matchmaker(0);
    m.join(1, GW, 5);
    m.join(2, GW, 5);
    expect(m.takeReady(5)).toEqual([{ dungeon: GW, players: [1, 2] }]);
  });

  describe("parties wait as one place (14b, D-143)", () => {
    it("a party always starts in the same run", () => {
      const m = new Matchmaker(300);
      m.join(1, GW, 0);
      m.joinGroup([2, 3, 4], GW, 10);
      expect(m.queuedFor(GW)).toEqual([1, 2, 3, 4]);
      expect(m.takeReady(300)).toEqual([
        { dungeon: GW, players: [1, 2, 3, 4] },
      ]);
    });

    it("a party that would overflow the run waits for the next; later solos fill the gap", () => {
      const m = new Matchmaker(300);
      m.joinGroup(ids(1, 6), GW, 0);
      m.joinGroup(ids(7, 5), GW, 1);
      m.join(12, GW, 2);
      m.join(13, GW, 3);
      m.join(14, GW, 4);
      m.join(15, GW, 5);
      // 6 + four solos fill a run at once; the party of five waits.
      expect(m.takeReady(5)).toEqual([
        { dungeon: GW, players: [...ids(1, 6), 12, 13, 14, 15] },
      ]);
      expect(m.queuedFor(GW)).toEqual(ids(7, 5));
      expect(m.takeReady(301)).toEqual([{ dungeon: GW, players: ids(7, 5) }]);
    });

    it("a full party of ten starts at once", () => {
      const m = new Matchmaker(300);
      m.joinGroup(ids(1, 10), GW, 0);
      expect(m.takeReady(0)).toEqual([{ dungeon: GW, players: ids(1, 10) }]);
    });

    it("any member leaving takes the whole party out of the queue", () => {
      const m = new Matchmaker(300);
      m.joinGroup([1, 2, 3], GW, 0);
      expect(m.leave(2)).toEqual({ dungeon: GW, players: [1, 2, 3] });
      expect(m.has(1)).toBe(false);
      expect(m.has(3)).toBe(false);
    });

    it("refuses an empty or oversized group, or someone already queued", () => {
      const m = new Matchmaker(300);
      m.join(1, GW, 0);
      expect(() => m.joinGroup([], GW, 0)).toThrow();
      expect(() => m.joinGroup(ids(2, 11), GW, 0)).toThrow();
      expect(() => m.joinGroup([5, 1], GW, 0)).toThrow();
      expect(m.queuedFor(GW)).toEqual([1]);
    });
  });
});
