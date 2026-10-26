import { describe, expect, it } from "vitest";
import { Parties } from "./parties.ts";

const MINUTE = 3600;

function parties(maxInvites = 10) {
  return new Parties({
    inviteTicks: MINUTE,
    rateWindowTicks: MINUTE,
    maxInvites,
  });
}

/** Invites `to` from `from` at `tick` and accepts it. */
function join(p: Parties, from: number, to: number, tick = 0) {
  const sent = p.invite(from, to, tick);
  if (!sent.ok) throw new Error(sent.reason);
  const answered = p.answer(to, sent.invite.id, true);
  if (!answered.ok) throw new Error(answered.reason);
  return answered;
}

describe("forming a party (D-142, D-143)", () => {
  it("accepting an invite starts a party led by the inviter", () => {
    const p = parties();
    const sent = p.invite(1, 2, 0);
    expect(sent.ok).toBe(true);
    // Nothing forms until the invite is accepted.
    expect(p.partyOf(1)).toBeNull();
    join(p, 1, 3);
    expect(p.partyOf(1)?.members).toEqual([1, 3]);
    expect(p.leaderOf(3)).toBe(1);
  });

  it("an invite means 'join me': it joins the inviter's current party", () => {
    const p = parties();
    join(p, 1, 2);
    // A member who is not the leader invites; the new player joins them.
    join(p, 2, 3);
    expect(p.partyOf(3)?.members).toEqual([1, 2, 3]);
    expect(p.leaderOf(3)).toBe(1);
  });

  it("declining just withdraws the invite", () => {
    const p = parties();
    const sent = p.invite(1, 2, 0);
    if (!sent.ok) throw new Error();
    expect(p.answer(2, sent.invite.id, false)).toMatchObject({ ok: true });
    expect(p.partyOf(1)).toBeNull();
    expect(p.invitesTo(2)).toEqual([]);
  });

  it("joining withdraws every other invite to the new member", () => {
    const p = parties();
    const other = p.invite(5, 2, 0);
    const { withdrawn } = join(p, 1, 2);
    expect(other.ok && withdrawn.map((i) => i.id)).toEqual([
      other.ok && other.invite.id,
    ]);
    expect(p.invitesTo(2)).toEqual([]);
  });
});

describe("refused invites and answers (D-143)", () => {
  it("refuses yourself, a member, someone in a party, and a repeat", () => {
    const p = parties();
    join(p, 1, 2);
    join(p, 3, 4);
    expect(p.invite(1, 1, 0)).toEqual({ ok: false, reason: "self" });
    expect(p.invite(1, 2, 0)).toEqual({ ok: false, reason: "alreadyMember" });
    expect(p.invite(1, 4, 0)).toEqual({ ok: false, reason: "inParty" });
    expect(p.invite(1, 5, 0).ok).toBe(true);
    expect(p.invite(1, 5, 0)).toEqual({
      ok: false,
      reason: "alreadyInvited",
    });
  });

  it("a party of 10 is full, and pending invites hold places", () => {
    const p = parties(100);
    for (let i = 2; i <= 9; i++) join(p, 1, i);
    expect(p.partyOf(1)?.members).toHaveLength(9);
    // The tenth place is held by an invite, so no eleventh can be sent.
    expect(p.invite(1, 10, 0).ok).toBe(true);
    expect(p.invite(5, 11, 0)).toEqual({ ok: false, reason: "full" });
  });

  it("an invite can only be answered by the one invited, once", () => {
    const p = parties();
    const sent = p.invite(1, 2, 0);
    if (!sent.ok) throw new Error();
    expect(p.answer(3, sent.invite.id, true)).toEqual({
      ok: false,
      reason: "gone",
    });
    expect(p.answer(2, 999, true)).toEqual({ ok: false, reason: "gone" });
    expect(p.answer(2, sent.invite.id, true).ok).toBe(true);
    expect(p.answer(2, sent.invite.id, true)).toEqual({
      ok: false,
      reason: "gone",
    });
  });

  it("limits how many invites one player sends in a minute", () => {
    const p = parties(3);
    for (let i = 2; i <= 4; i++) expect(p.invite(1, i, i).ok).toBe(true);
    expect(p.invite(1, 5, 10)).toEqual({ ok: false, reason: "tooMany" });
    // A minute after the first, one more is allowed.
    expect(p.invite(1, 5, MINUTE + 2).ok).toBe(true);
  });

  it("invites lapse after a minute", () => {
    const p = parties();
    const sent = p.invite(1, 2, 0);
    if (!sent.ok) throw new Error();
    expect(p.expire(MINUTE - 1)).toEqual([]);
    expect(p.expire(MINUTE)).toEqual([sent.invite]);
    expect(p.answer(2, sent.invite.id, true)).toEqual({
      ok: false,
      reason: "gone",
    });
  });
});

describe("leaving a party (D-143)", () => {
  it("the longest-standing member leads when the leader leaves", () => {
    const p = parties();
    join(p, 1, 2);
    join(p, 1, 3);
    expect(p.leave(1)).toEqual({
      remaining: [2, 3],
      disbanded: false,
      newLeader: 2,
    });
    expect(p.leaderOf(3)).toBe(2);
    expect(p.partyOf(1)).toBeNull();
  });

  it("a party of one breaks up", () => {
    const p = parties();
    join(p, 1, 2);
    expect(p.leave(2)).toEqual({
      remaining: [1],
      disbanded: true,
      newLeader: null,
    });
    expect(p.partyOf(1)).toBeNull();
    expect(p.leave(1)).toBeNull();
  });

  it("only the leader removes members, and not themselves", () => {
    const p = parties();
    join(p, 1, 2);
    join(p, 1, 3);
    expect(p.kick(2, 3)).toEqual({ ok: false, reason: "notLeader" });
    expect(p.kick(1, 1)).toEqual({ ok: false, reason: "notMember" });
    expect(p.kick(1, 9)).toEqual({ ok: false, reason: "notMember" });
    expect(p.kick(1, 3)).toMatchObject({ ok: true });
    expect(p.partyOf(1)?.members).toEqual([1, 2]);
  });

  it("dropping out of the game leaves the party and withdraws your invites", () => {
    const p = parties();
    join(p, 1, 2);
    join(p, 1, 3);
    const fromMe = p.invite(1, 5, 0);
    const { leaving, withdrawn } = p.drop(1);
    expect(leaving?.newLeader).toBe(2);
    expect(withdrawn.map((i) => i.id)).toEqual([fromMe.ok && fromMe.invite.id]);
    expect(p.invitesTo(5)).toEqual([]);
    // Invites waiting for someone who drops are withdrawn too.
    const toThem = p.invite(2, 6, 0);
    expect(p.drop(6).withdrawn.map((i) => i.id)).toEqual([
      toThem.ok && toThem.invite.id,
    ]);
    expect(p.invitesFrom(2)).toEqual([]);
  });
});
