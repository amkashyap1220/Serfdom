import {
  parseSnapshot,
  SNAPSHOT_FIELDS,
  SNAPSHOT_LISTS,
  type DeltaEntry,
  type ListDelta,
  type ParseResult,
  type SnapshotDelta,
  type SnapshotMessage,
} from "./protocol.ts";

/*
 * Snapshots send only what changed (T-053, Phase 19b). The server still
 * builds a whole snapshot every tick, then sends how it differs from the
 * one before; the client rebuilds the whole snapshot from that. A
 * WebSocket delivers every message, in order, so no acknowledgements (and
 * no extra delay) are needed. The rule both sides rely on:
 *
 *   applySnapshotDelta(prev, diffSnapshot(prev, next)) gives exactly next.
 */

/**
 * The changes from `prev` to `next`, or null when only a whole snapshot
 * will do (a list repeats an id, which never happens in a working server).
 */
export function diffSnapshot(
  prev: SnapshotMessage,
  next: SnapshotMessage,
): SnapshotDelta | null {
  const delta: SnapshotDelta = {
    type: "delta",
    tick: next.tick,
    base: prev.tick,
  };
  const set: Record<string, unknown> = {};
  let changed = false;
  for (const field of SNAPSHOT_FIELDS) {
    if (!same(prev[field], next[field])) {
      set[field] = next[field];
      changed = true;
    }
  }
  if (changed) delta.set = set;
  for (const list of SNAPSHOT_LISTS) {
    const entries = next[list] as unknown as readonly DeltaEntry[];
    if (new Set(entries.map((e) => e.id)).size !== entries.length) return null;
    const d = diffList(prev[list] as unknown as readonly DeltaEntry[], entries);
    if (d) delta[list] = d;
  }
  return delta;
}

/**
 * The snapshot `delta` describes, rebuilt on `prev` and validated like a
 * whole snapshot from the wire. Fails if `prev` is not the delta's base.
 */
export function applySnapshotDelta(
  prev: SnapshotMessage,
  delta: SnapshotDelta,
): ParseResult<SnapshotMessage> {
  if (delta.base !== prev.tick) {
    return {
      ok: false,
      error: `delta is for snapshot ${delta.base}, the last one was ${prev.tick}`,
    };
  }
  const next: Record<string, unknown> = {
    ...prev,
    ...delta.set,
    tick: delta.tick,
  };
  for (const list of SNAPSHOT_LISTS) {
    const entries = applyList(
      prev[list] as unknown as readonly DeltaEntry[],
      delta[list],
    );
    if (typeof entries === "string") {
      return { ok: false, error: `delta ${list}: ${entries}` };
    }
    next[list] = entries;
  }
  return parseSnapshot(next);
}

function diffList(
  prev: readonly DeltaEntry[],
  next: readonly DeltaEntry[],
): ListDelta | null {
  const before = new Map(prev.map((e) => [e.id, e]));
  const kept = new Set(next.map((e) => e.id));
  const add: DeltaEntry[] = [];
  const change: DeltaEntry[] = [];
  for (const entry of next) {
    const old = before.get(entry.id);
    const diff = old ? diffEntry(old, entry) : "whole";
    if (diff === "whole") add.push(entry);
    else if (diff) change.push(diff);
  }
  const remove = prev.filter((e) => !kept.has(e.id)).map((e) => e.id);
  const d: ListDelta = {};
  if (add.length > 0) d.add = add;
  if (change.length > 0) d.change = change;
  if (remove.length > 0) d.remove = remove;
  // Applying keeps the old order and puts new entries last; say the order
  // only when that would come out different.
  const applied = applyList(prev, d);
  if (
    typeof applied === "string" ||
    applied.some((e, i) => e.id !== next[i]?.id)
  ) {
    d.order = next.map((e) => e.id);
  }
  return Object.keys(d).length > 0 ? d : null;
}

/** The changed fields (with the id), null if none, or "whole" if the fields themselves differ. */
function diffEntry(
  old: DeltaEntry,
  entry: DeltaEntry,
): DeltaEntry | null | "whole" {
  const keys = Object.keys(entry);
  if (
    keys.length !== Object.keys(old).length ||
    !keys.every((k) => Object.hasOwn(old, k))
  ) {
    return "whole";
  }
  const out: DeltaEntry = { id: entry.id };
  let changed = false;
  for (const k of keys) {
    if (!same(old[k], entry[k])) {
      out[k] = entry[k];
      changed = true;
    }
  }
  return changed ? out : null;
}

function applyList(
  prev: readonly DeltaEntry[],
  d: ListDelta | undefined,
): DeltaEntry[] | string {
  if (!d) return [...prev];
  const removed = new Set(d.remove ?? []);
  const changes = new Map((d.change ?? []).map((c) => [c.id, c]));
  const whole = new Map((d.add ?? []).map((a) => [a.id, a]));
  const out: DeltaEntry[] = [];
  for (const entry of prev) {
    if (removed.has(entry.id)) continue;
    const replaced = whole.get(entry.id);
    if (replaced) {
      out.push(replaced);
      whole.delete(entry.id);
      continue;
    }
    const change = changes.get(entry.id);
    out.push(change ? { ...entry, ...change } : entry);
    changes.delete(entry.id);
  }
  if (changes.size > 0) return "a change for an id that is not there";
  out.push(...whole.values());
  if (!d.order) return out;
  const byId = new Map(out.map((e) => [e.id, e]));
  const ordered = d.order.map((id) => byId.get(id));
  if (ordered.length !== out.length || new Set(d.order).size !== out.length) {
    return "an order that does not list every entry once";
  }
  if (ordered.some((e) => e === undefined)) {
    return "an order with an id that is not there";
  }
  return ordered as DeltaEntry[];
}

/** Equal as JSON: numbers, strings, and booleans by value, lists and objects by content. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
