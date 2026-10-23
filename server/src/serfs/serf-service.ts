import {
  normalizeSerfName,
  SERF_SLOTS,
  serfNameProblem,
  type RunResult,
  type RunStats,
  type SerfSummary,
} from "@serfdom/shared";
import type { Death, SerfRepo } from "./serf-repo.ts";

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

  constructor(repo: SerfRepo, slots: number = SERF_SLOTS) {
    this.repo = repo;
    this.slots = slots;
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
    return { ok: true, serf };
  }

  recordRun(
    accountId: number,
    serfId: number,
    result: RunResult,
    run: RunStats,
    death: Death | null,
  ): Promise<SerfSummary | null> {
    return this.repo.recordRun(accountId, serfId, result, run, death);
  }
}
