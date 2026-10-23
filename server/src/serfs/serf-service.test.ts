import {
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
