import {
  normalizeSerfName,
  SERF_SLOTS,
  serfNameProblem,
  addStats,
  applyGains,
  CLASS_CHOICE_LEVEL,
  classBonus,
  className,
  clearExp,
  rollLevelGains,
  zeroStats,
  type Stats,
  totalExpForLevel,
  type ClassId,
  type DungeonId,
  type LeaderboardEntry,
  type RunResult,
  type RunStats,
  type SerfSummary,
} from "@serfdom/shared";
import type { Death, SerfRepo } from "./serf-repo.ts";

/** PROVISIONAL: how many serfs the leaderboard shows. */
export const LEADERBOARD_SIZE = 20;

export type SerfResult =
  { ok: true; serf: SerfSummary } | { ok: false; reason: string };

/**
 * Serf rules (Phase 7b): create within the slot limit (D-061) with a valid,
 * living-unique name (D-063, D-064); play only your own living serf; a
 * finished run adds to the serf's life, and a death ends it for good
 * (D-062). The client is untrusted: names are re-validated here.
 */
export class SerfService {
  private readonly repo: SerfRepo;
  private readonly slots: number;
  /** Stat rolls (D-074); injectable so tests are deterministic. */
  private readonly random: () => number;

  constructor(
    repo: SerfRepo,
    slots: number = SERF_SLOTS,
    random: () => number = Math.random,
  ) {
    this.repo = repo;
    this.slots = slots;
    this.random = random;
  }

  get slotCount(): number {
    return this.slots;
  }

  list(accountId: number): Promise<SerfSummary[]> {
    return this.repo.list(accountId);
  }

  async create(accountId: number, rawName: string): Promise<SerfResult> {
    const name = normalizeSerfName(rawName);
    const problem = serfNameProblem(name);
    if (problem) return { ok: false, reason: problem };
    const created = await this.repo.create(accountId, name, this.slots);
    if (created === "slotsFull") {
      return {
        ok: false,
        reason: `You already have ${this.slots} living serfs.`,
      };
    }
    if (created === "nameTaken") {
      return { ok: false, reason: "A living serf already has that name." };
    }
    return { ok: true, serf: created };
  }

  /** The serf this account may play as: its own and alive. */
  async choose(accountId: number, serfId: number): Promise<SerfResult> {
    const serf = await this.repo.find(accountId, serfId);
    // Someone else's serf looks exactly like one that does not exist.
    if (!serf) return { ok: false, reason: "No such serf." };
    if (!serf.alive) return { ok: false, reason: `${serf.name} is dead.` };
    // Serfs from before Phase 8c (or given EXP by hand) catch up here.
    const settled = await this.settle(accountId, serfId);
    return { ok: true, serf: settled?.serf ?? serf };
  }

  /**
   * Records a finished run on the serf and awards its EXP: only on
   * completion (D-069), scaled down when the serf is above the dungeon's
   * level range (D-071). Null if the serf is missing or already dead.
   */
  async recordRun(
    accountId: number,
    serfId: number,
    dungeon: DungeonId,
    result: RunResult,
    run: RunStats,
    death: Death | null,
  ): Promise<{
    serf: SerfSummary;
    expGained: number;
    statGains: Stats;
  } | null> {
    // The level is read before the update. A serf plays one run at a time
    // (it is fixed for the run, one connection per account), so no other
    // write can change its EXP in between.
    const before = await this.repo.find(accountId, serfId);
    if (!before?.alive) return null;
    const expGained =
      result === "completed" ? clearExp(dungeon, before.level) : 0;
    const serf = await this.repo.recordRun(
      accountId,
      serfId,
      result,
      run,
      death,
      expGained,
    );
    if (!serf) return null;
    if (!serf.alive || expGained === 0) {
      return { serf, expGained, statGains: zeroStats() };
    }
    const settled = await this.settle(accountId, serfId);
    return {
      serf: settled?.serf ?? serf,
      expGained,
      statGains: settled?.gains ?? zeroStats(),
    };
  }

  /**
   * Rolls the stats for every level the serf has reached but not yet rolled
   * (D-074): Serf ranges to level 5, class ranges after. A classless serf
   * stops at level 5 until it chooses (D-073). The save is guarded on the
   * old stats level, so if another write got there first, its rolls stand
   * and these are dropped. Null if the serf is not this account's.
   */
  private async settle(
    accountId: number,
    serfId: number,
  ): Promise<{ serf: SerfSummary; gains: Stats; statsLevel: number } | null> {
    const found = await this.repo.findWithStatsLevel(accountId, serfId);
    if (!found) return null;
    const { serf, statsLevel } = found;
    const target =
      serf.classId === null
        ? Math.min(serf.level, CLASS_CHOICE_LEVEL)
        : serf.level;
    if (!serf.alive || target <= statsLevel) {
      return { serf, gains: zeroStats(), statsLevel };
    }
    let stats = serf.stats;
    let gains = zeroStats();
    for (let level = statsLevel + 1; level <= target; level++) {
      const rolled = rollLevelGains(stats, level, serf.classId, this.random);
      stats = applyGains(
        stats,
        rolled,
        level > CLASS_CHOICE_LEVEL ? serf.classId : null,
      );
      gains = addStats(gains, rolled);
    }
    const saved = await this.repo.saveStats(
      accountId,
      serfId,
      stats,
      statsLevel,
      target,
    );
    if (saved) return { serf: saved, gains, statsLevel: target };
    const again = await this.repo.findWithStatsLevel(accountId, serfId);
    return again ? { ...again, gains: zeroStats() } : null;
  }

  /**
   * Gives one of the account's serfs its permanent class (D-073): it must
   * be alive, classless, and at least level 5. The reasons are safe to show.
   */
  async chooseClass(
    accountId: number,
    serfId: number,
    classId: ClassId,
  ): Promise<SerfResult> {
    const serf = await this.repo.find(accountId, serfId);
    if (!serf) return { ok: false, reason: "No such serf." };
    if (!serf.alive) return { ok: false, reason: `${serf.name} is dead.` };
    if (serf.classId !== null) {
      return {
        ok: false,
        reason: `${serf.name} is already a ${className(serf.classId)}; a class is permanent.`,
      };
    }
    if (serf.level < CLASS_CHOICE_LEVEL) {
      return {
        ok: false,
        reason: `${serf.name} picks a class at level ${CLASS_CHOICE_LEVEL}.`,
      };
    }
    // The checks above give good messages; the write re-checks them all at
    // once, so a concurrent pick or death cannot slip between.
    // Roll any Serf levels still owed (up to 5), then give the class bonus
    // in the same write as the class, so it lands exactly once.
    const settled = await this.settle(accountId, serfId);
    if (!settled) return { ok: false, reason: "No such serf." };
    const chosen = await this.repo.chooseClass(
      accountId,
      serfId,
      classId,
      totalExpForLevel(CLASS_CHOICE_LEVEL),
      applyGains(settled.serf.stats, classBonus(classId), classId),
      settled.statsLevel,
    );
    if (!chosen) return { ok: false, reason: "Could not choose a class." };
    // A serf already past level 5 rolls its class levels now.
    const after = await this.settle(accountId, serfId);
    return { ok: true, serf: after?.serf ?? chosen };
  }

  /** The lifetime EXP leaderboard: serf names and scores only. */
  leaderboard(): Promise<LeaderboardEntry[]> {
    return this.repo.leaderboard(LEADERBOARD_SIZE);
  }
}
