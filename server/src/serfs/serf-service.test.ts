import {
  STASH_SIZE,
  isValidItemSpec,
  newRunStats,
  SERF_BASE,
  totalExpForLevel,
  zeroStats,
} from "@serfdom/shared";
import { describe, expect, it } from "vitest";
import { MemorySerfRepo } from "./serf-repo.ts";
import { SerfService } from "./serf-service.ts";

const run = { ...newRunStats(), seconds: 30 };

/** A service with one serf on account 1 that already has `exp`. */
async function serfWith(exp: number) {
  const repo = new MemorySerfRepo();
  const serfs = new SerfService(repo);
  const made = await serfs.create(1, "Odo Flax");
  if (!made.ok) throw new Error(made.reason);
  await repo.recordRun(1, made.serf.id, "completed", run, null, exp);
  return { serfs, id: made.serf.id };
}

describe("SerfService.recordRun EXP (D-069, D-071)", () => {
  it("a level-1 serf gets the Goblin Warrens' full 100 EXP", async () => {
    const { serfs, id } = await serfWith(0);
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r).toMatchObject({ expGained: 100, serf: { exp: 100, level: 2 } });
  });

  it("a serf above level 9 gets less: level 12 gets 73", async () => {
    const { serfs, id } = await serfWith(totalExpForLevel(12));
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r?.expGained).toBe(73);
  });

  it("a level-20 serf still earns a little for the leaderboard", async () => {
    const { serfs, id } = await serfWith(totalExpForLevel(20) + 500);
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r).toMatchObject({ expGained: 31, serf: { level: 20 } });
    expect(r?.serf.exp).toBe(totalExpForLevel(20) + 531);
  });

  it("leaving or dying earns nothing; a dead serf records nothing more", async () => {
    const { serfs, id } = await serfWith(0);
    const quit = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "left",
      run,
      null,
    );
    expect(quit?.expGained).toBe(0);
    const death = { dungeon: "goblin-warrens" as const, killedBy: "grunt" };
    const died = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "died",
      run,
      death,
    );
    expect(died).toMatchObject({ expGained: 0, serf: { alive: false } });
    expect(
      await serfs.recordRun(1, id, "goblin-warrens", "completed", run, null),
    ).toBeNull();
  });

  it("another account's serf records nothing", async () => {
    const { serfs, id } = await serfWith(0);
    expect(
      await serfs.recordRun(2, id, "goblin-warrens", "completed", run, null),
    ).toBeNull();
  });
});

describe("SerfService.chooseClass (D-073)", () => {
  it("refuses below level 5 with a reason, then accepts once at level 5", async () => {
    const { serfs, id } = await serfWith(totalExpForLevel(5) - 1);
    expect(await serfs.chooseClass(1, id, "ranger")).toEqual({
      ok: false,
      reason: "Odo Flax picks a class at level 5.",
    });
    await serfs.recordRun(1, id, "goblin-warrens", "completed", run, null);
    const chosen = await serfs.chooseClass(1, id, "ranger");
    expect(chosen).toMatchObject({
      ok: true,
      serf: { classId: "ranger", level: 5 },
    });
    expect(await serfs.chooseClass(1, id, "wizard")).toEqual({
      ok: false,
      reason: "Odo Flax is already a Ranger; a class is permanent.",
    });
  });

  it("refuses dead serfs and other accounts' serfs", async () => {
    const { serfs, id } = await serfWith(totalExpForLevel(6));
    expect(await serfs.chooseClass(2, id, "bard")).toEqual({
      ok: false,
      reason: "No such serf.",
    });
    const death = { dungeon: "goblin-warrens" as const, killedBy: "grunt" };
    await serfs.recordRun(1, id, "goblin-warrens", "died", run, death);
    expect(await serfs.chooseClass(1, id, "bard")).toEqual({
      ok: false,
      reason: "Odo Flax is dead.",
    });
  });
});

describe("stat rolls on level-up (D-074, D-075)", () => {
  const highest = () => 0.999999;

  /** A service that always rolls the top of each range. */
  async function lucky(exp: number) {
    const repo = new MemorySerfRepo();
    const serfs = new SerfService(repo, 2, highest);
    const made = await serfs.create(1, "Hamon Rye");
    if (!made.ok) throw new Error(made.reason);
    await repo.recordRun(1, made.serf.id, "completed", run, null, exp);
    return { repo, serfs, id: made.serf.id };
  }

  it("the clear that reaches level 2 rolls Serf gains and saves them", async () => {
    const { serfs, id } = await lucky(0);
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r?.statGains).toEqual({
      hp: 3,
      mp: 2,
      attack: 1,
      dexterity: 1,
      speed: 1,
      defense: 0,
      vitality: 1,
      wisdom: 1,
    });
    expect(r?.serf.stats).toEqual({
      ...SERF_BASE,
      hp: 23,
      mp: 12,
      attack: 11,
      dexterity: 11,
      speed: 11,
      vitality: 11,
      wisdom: 11,
    });
    // The next clear (still level 2) rolls nothing.
    const next = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(next?.serf.level).toBe(2);
    expect(next?.statGains).toEqual(zeroStats());
    expect(next?.serf.stats.hp).toBe(23);
  });

  it("a serf with EXP but no rolls catches up once, only to level 5 while classless", async () => {
    const { serfs, id } = await lucky(totalExpForLevel(9));
    const first = await serfs.choose(1, id);
    if (!first.ok) throw new Error(first.reason);
    expect(first.serf.stats.hp).toBe(20 + 4 * 3); // levels 2–5 only
    const again = await serfs.choose(1, id);
    expect(again.ok && again.serf.stats).toEqual(first.serf.stats); // no double roll
  });

  it("choosing a class adds its bonus once, then rolls class levels owed", async () => {
    const { serfs, id } = await lucky(totalExpForLevel(7));
    const before = await serfs.choose(1, id);
    if (!before.ok) throw new Error(before.reason);
    const chosen = await serfs.chooseClass(1, id, "barbarian");
    if (!chosen.ok) throw new Error(chosen.reason);
    // Barbarian HP is High: +10 bonus, then levels 6 and 7 roll 3–6 → 6 each.
    expect(chosen.serf.stats.hp).toBe(before.serf.stats.hp + 10 + 6 + 6);
    // MP is Low: no bonus, 1–2 per level → 2 each.
    expect(chosen.serf.stats.mp).toBe(before.serf.stats.mp + 2 + 2);
  });

  it("at level 20 a clear still adds EXP but never stats (the cap)", async () => {
    const { serfs, id } = await lucky(totalExpForLevel(20));
    await serfs.choose(1, id);
    const chosen = await serfs.chooseClass(1, id, "ranger");
    if (!chosen.ok) throw new Error(chosen.reason);
    expect(chosen.serf.level).toBe(20);
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r?.expGained).toBeGreaterThan(0);
    expect(r?.serf.exp).toBe(totalExpForLevel(20) + (r?.expGained ?? 0));
    expect(r?.statGains).toEqual(zeroStats());
    expect(r?.serf.stats).toEqual(chosen.serf.stats);
  });

  it("dying earns no stat gains", async () => {
    const { serfs, id } = await lucky(totalExpForLevel(2) - 1);
    const death = { dungeon: "goblin-warrens" as const, killedBy: "grunt" };
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "died",
      run,
      death,
    );
    expect(r?.statGains).toEqual(zeroStats());
    expect(r?.serf.stats).toEqual(SERF_BASE);
  });
});

describe("reward chests (D-065, D-068, D-080, D-086)", () => {
  it("a completion gives one chest (Luck 1) whose item lands in the stash", async () => {
    const { serfs, id } = await serfWith(0);
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r?.loot).toHaveLength(1);
    const drop = r!.loot[0]!;
    expect(isValidItemSpec(drop.item)).toBe(true);
    expect(drop.item.tier).toBeLessThanOrEqual(2);
    expect(drop.pending).toBe(false);
    expect(r?.serf.items).toEqual([]); // nothing is worn without equipping
    const stash = await serfs.stash(1);
    expect(stash).toMatchObject({ capacity: STASH_SIZE, gold: 0, pending: [] });
    expect(stash.items).toEqual([drop.item]);
  });

  it("leaving or dying gives no chest; the stash survives a death", async () => {
    const { serfs, id } = await serfWith(0);
    await serfs.recordRun(1, id, "goblin-warrens", "completed", run, null);
    const left = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "left",
      run,
      null,
    );
    expect(left?.loot).toEqual([]);
    const death = { dungeon: "goblin-warrens" as const, killedBy: "grunt" };
    const died = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "died",
      run,
      death,
    );
    expect(died?.loot).toEqual([]);
    expect((await serfs.stash(1)).items).toHaveLength(1);
  });

  it("with a full stash the reward waits, blocks the serf, and selling settles it", async () => {
    const repo = new MemorySerfRepo();
    const serfs = new SerfService(repo);
    const made = await serfs.create(1, "Full Stash");
    if (!made.ok) throw new Error(made.reason);
    const cape = {
      slot: "cape" as const,
      type: null,
      tier: 0,
      rolls: [{ stat: "hp" as const, amount: 1 }],
      luck: 0,
    };
    await repo.addLoot(
      1,
      made.serf.id,
      Array(STASH_SIZE).fill(cape),
      STASH_SIZE,
    );
    const r = await serfs.recordRun(
      1,
      made.serf.id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r?.loot[0]?.pending).toBe(true);
    expect(await serfs.hasPending(1, made.serf.id)).toBe(true);
    const stash = await serfs.stash(1);
    expect(stash.items).toHaveLength(STASH_SIZE);
    expect(stash.pending).toHaveLength(1);
    // Sell a stash cape (T0, no Luck: 2 gold): the reward moves in.
    const sold = await serfs.sell(1, stash.items[0]!.id);
    expect(sold).toEqual({ ok: true, price: 2 });
    expect(await serfs.hasPending(1, made.serf.id)).toBe(false);
    const after = await serfs.stash(1);
    expect(after.gold).toBe(2);
    expect(after.items.map((i) => i.id)).toContain(r!.loot[0]!.item.id);
    expect(await serfs.sell(1, 999)).toEqual({
      ok: false,
      reason: "No such item in your stash.",
    });
    expect(await serfs.sell(2, after.items[0]!.id)).toEqual({
      ok: false,
      reason: "No such item in your stash.",
    });
  });
});
