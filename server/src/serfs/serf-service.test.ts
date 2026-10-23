import {
  loadoutOf,
  rollsFor,
  STASH_SIZE,
  type ItemSpec,
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
      type: "hp" as const,
      tier: 0,
      rolls: [],
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

describe("equipping (9b, D-081, D-086)", () => {
  async function withItems(specs: ItemSpec[], classId: "wizard" | null = null) {
    const repo = new MemorySerfRepo();
    const serfs = new SerfService(repo);
    const made = await serfs.create(1, "Ada Gear");
    if (!made.ok) throw new Error(made.reason);
    if (classId) {
      await repo.recordRun(
        1,
        made.serf.id,
        "completed",
        run,
        null,
        totalExpForLevel(5),
      );
      await serfs.choose(1, made.serf.id);
      const chosen = await serfs.chooseClass(1, made.serf.id, classId);
      if (!chosen.ok) throw new Error(chosen.reason);
    }
    const drops =
      (await repo.addLoot(1, made.serf.id, specs, STASH_SIZE)) ?? [];
    return { repo, serfs, id: made.serf.id, ids: drops.map((d) => d.item.id) };
  }
  const wand = (tier: number): ItemSpec => ({
    slot: "weapon",
    type: "wand",
    tier,
    rolls: Array.from({ length: rollsFor("weapon", tier) }, () => ({
      stat: "attack" as const,
      amount: 1,
    })),
    luck: 0,
  });
  const luckyRing: ItemSpec = {
    slot: "ring",
    type: "attack",
    tier: 4,
    rolls: [
      { stat: "hp", amount: 2 },
      { stat: "wisdom", amount: 1 },
    ],
    luck: 1,
  };

  it("a classless Serf may wear T0 weapons and any accessory, but not T1 weapons", async () => {
    const { serfs, id, ids } = await withItems([wand(0), wand(1), luckyRing]);
    expect(await serfs.equip(1, id, ids[0]!, "weapon")).toEqual({ ok: true });
    expect(await serfs.equip(1, id, ids[1]!, "weapon")).toEqual({
      ok: false,
      reason:
        "Before choosing a class, Ada Gear can only wear T0 weapons and armor.",
    });
    expect(await serfs.equip(1, id, ids[2]!, "ring2")).toEqual({ ok: true });
  });

  it("classes use only their weapons; items go only in their slot", async () => {
    const bow: ItemSpec = {
      slot: "weapon",
      type: "bow",
      tier: 1,
      rolls: [],
      luck: 0,
    };
    const { serfs, id, ids } = await withItems(
      [wand(1), bow, luckyRing],
      "wizard",
    );
    expect(await serfs.equip(1, id, ids[0]!, "weapon")).toEqual({ ok: true });
    expect(await serfs.equip(1, id, ids[1]!, "weapon")).toEqual({
      ok: false,
      reason: "A Wizard cannot use a T1 Bow.",
    });
    expect(await serfs.equip(1, id, ids[2]!, "cape")).toEqual({
      ok: false,
      reason: "A T4 Ring of Attack does not go there.",
    });
    expect(await serfs.equip(1, id, 999, "cape")).toEqual({
      ok: false,
      reason: "No such item in your stash.",
    });
  });

  it("a +1 Luck item in the stash adds no chest; only worn ones count (D-068)", async () => {
    const { serfs, id } = await withItems([luckyRing]);
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r?.loot).toHaveLength(1);
  });

  it("an equipped +1 Luck item gives a second chest; gear counts in the loadout", async () => {
    const { serfs, id, ids } = await withItems([luckyRing, wand(0)]);
    await serfs.equip(1, id, ids[0]!, "ring1");
    await serfs.equip(1, id, ids[1]!, "weapon");
    const r = await serfs.recordRun(
      1,
      id,
      "goblin-warrens",
      "completed",
      run,
      null,
    );
    expect(r?.loot).toHaveLength(2); // Luck 1 + 1 (D-068)
    const loadout = loadoutOf(r!.serf);
    expect(loadout.weaponTier).toBe(0);
    expect(loadout.stats.hp).toBe(r!.serf.stats.hp + 2);
  });

  it("unequipping needs room in the stash", async () => {
    const { repo, serfs, id, ids } = await withItems([luckyRing]);
    await serfs.equip(1, id, ids[0]!, "ring1");
    const cape: ItemSpec = {
      slot: "cape",
      type: "hp",
      tier: 0,
      rolls: [],
      luck: 0,
    };
    await repo.addLoot(1, id, Array(STASH_SIZE).fill(cape), STASH_SIZE);
    expect(await serfs.unequip(1, id, "ring1")).toEqual({
      ok: false,
      reason: "Your stash is full: sell something first.",
    });
    expect(await serfs.unequip(1, id, "cape")).toEqual({
      ok: false,
      reason: "Nothing is worn there.",
    });
  });
});

describe("the free ability item (D-092)", () => {
  it("choosing a class wears a T0 one at once; it is given only once", async () => {
    const repo = new MemorySerfRepo();
    const serfs = new SerfService(repo);
    const made = await serfs.create(1, "Ada Book");
    if (!made.ok) throw new Error(made.reason);
    await repo.recordRun(
      1,
      made.serf.id,
      "completed",
      run,
      null,
      totalExpForLevel(5),
    );
    await serfs.choose(1, made.serf.id);
    const chosen = await serfs.chooseClass(1, made.serf.id, "wizard");
    if (!chosen.ok) throw new Error(chosen.reason);
    expect(chosen.serf.items).toEqual([
      expect.objectContaining({
        slot: "ability",
        type: "spellbook",
        tier: 0,
        rolls: [],
        equipped: "ability",
      }),
    ]);
    // Unequip and sell it: selecting the serf again does not give another.
    expect(await serfs.unequip(1, made.serf.id, "ability")).toEqual({
      ok: true,
    });
    const book = (await serfs.stash(1)).items[0]!;
    expect(await serfs.sell(1, book.id)).toMatchObject({ ok: true });
    const again = await serfs.choose(1, made.serf.id);
    expect(again.ok && again.serf.items).toEqual([]);
  });

  it("a serf that chose its class before 10a gets one when next played", async () => {
    const repo = new MemorySerfRepo();
    const serfs = new SerfService(repo);
    const made = await serfs.create(1, "Old Wizard");
    if (!made.ok) throw new Error(made.reason);
    await repo.recordRun(
      1,
      made.serf.id,
      "completed",
      run,
      null,
      totalExpForLevel(5),
    );
    // The class set the old way: straight in the store, no grant.
    await repo.chooseClass(1, made.serf.id, "druid", 0, SERF_BASE, 1);
    const picked = await serfs.choose(1, made.serf.id);
    expect(picked.ok && picked.serf.items.map((i) => i.type)).toEqual([
      "totem",
    ]);
  });
});
