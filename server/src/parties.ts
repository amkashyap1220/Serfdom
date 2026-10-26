import { MAX_PARTY_SIZE } from "@serfdom/shared";

/** A party: its members in the order they joined; the first one leads (D-143). */
export interface Party {
  id: number;
  members: number[];
}

/** "Join me": an invite from one player to another, open until `expiresAt`. */
export interface Invite {
  id: number;
  from: number;
  to: number;
  /** Server tick at which it lapses. */
  expiresAt: number;
}

export type InviteRefusal =
  "self" | "alreadyMember" | "inParty" | "alreadyInvited" | "full" | "tooMany";

export type AnswerRefusal = "gone" | "inParty" | "full";

/** What a player leaving (or being removed) did to their party. */
export interface Leaving {
  /** Who is still in the party (everyone told of the change). */
  remaining: number[];
  /** The party broke up: one member was left, and they are partyless now. */
  disbanded: boolean;
  /** The member who leads now, if the leader left and the party goes on. */
  newLeader: number | null;
}

export interface PartyOptions {
  /** An invite lapses after this many ticks (60 s, D-143). */
  inviteTicks: number;
  /** At most `maxInvites` invites per player in any `rateWindowTicks`. */
  rateWindowTicks: number;
  maxInvites: number;
  /** Members a party can hold (10, D-012). */
  maxSize?: number;
}

/**
 * Parties and invites (Phase 14, D-142, D-143). Pure bookkeeping, like the
 * Matchmaker: players are guest ids, time is the server's tick count, and
 * the game server turns every result into messages. An invite means "join
 * me": accepting it joins the inviter's party, or starts one with them.
 * Pending invites hold places, so a party never grows past its size.
 */
export class Parties {
  private readonly partyOfPlayer = new Map<number, Party>();
  private readonly invites = new Map<number, Invite>();
  /** Ticks of each player's recent invites (rate limit). */
  private readonly recent = new Map<number, number[]>();
  private nextPartyId = 1;
  private nextInviteId = 1;
  private readonly options: Required<PartyOptions>;

  constructor(options: PartyOptions) {
    this.options = { maxSize: MAX_PARTY_SIZE, ...options };
  }

  partyOf(player: number): Readonly<Party> | null {
    return this.partyOfPlayer.get(player) ?? null;
  }

  leaderOf(player: number): number | null {
    return this.partyOfPlayer.get(player)?.members[0] ?? null;
  }

  invitesFrom(player: number): Invite[] {
    return [...this.invites.values()].filter((i) => i.from === player);
  }

  invitesTo(player: number): Invite[] {
    return [...this.invites.values()].filter((i) => i.to === player);
  }

  invite(
    from: number,
    to: number,
    tick: number,
  ): { ok: true; invite: Invite } | { ok: false; reason: InviteRefusal } {
    if (from === to) return { ok: false, reason: "self" };
    const party = this.partyOfPlayer.get(from);
    if (party?.members.includes(to)) {
      return { ok: false, reason: "alreadyMember" };
    }
    if (this.partyOfPlayer.has(to)) return { ok: false, reason: "inParty" };
    if (this.invitesFrom(from).some((i) => i.to === to)) {
      return { ok: false, reason: "alreadyInvited" };
    }
    const members = party?.members ?? [from];
    const held = [...this.invites.values()].filter((i) =>
      members.includes(i.from),
    ).length;
    if (members.length + held >= this.options.maxSize) {
      return { ok: false, reason: "full" };
    }
    const since = tick - this.options.rateWindowTicks;
    const recent = (this.recent.get(from) ?? []).filter((t) => t > since);
    if (recent.length >= this.options.maxInvites) {
      return { ok: false, reason: "tooMany" };
    }
    this.recent.set(from, [...recent, tick]);
    const invite: Invite = {
      id: this.nextInviteId++,
      from,
      to,
      expiresAt: tick + this.options.inviteTicks,
    };
    this.invites.set(invite.id, invite);
    return { ok: true, invite };
  }

  /**
   * Accepts or declines an invite addressed to `to`. Accepting joins the
   * inviter's party (or starts one, the inviter leading) and withdraws every
   * other invite to `to`, returned as `withdrawn`.
   */
  answer(
    to: number,
    inviteId: number,
    accept: boolean,
  ):
    | { ok: true; invite: Invite; party: Party | null; withdrawn: Invite[] }
    | { ok: false; reason: AnswerRefusal } {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.to !== to) return { ok: false, reason: "gone" };
    if (!accept) {
      this.invites.delete(inviteId);
      return { ok: true, invite, party: null, withdrawn: [] };
    }
    if (this.partyOfPlayer.has(to)) return { ok: false, reason: "inParty" };
    let party = this.partyOfPlayer.get(invite.from);
    if (party && party.members.length >= this.options.maxSize) {
      return { ok: false, reason: "full" };
    }
    this.invites.delete(inviteId);
    if (!party) {
      party = { id: this.nextPartyId++, members: [invite.from] };
      this.partyOfPlayer.set(invite.from, party);
    }
    party.members.push(to);
    this.partyOfPlayer.set(to, party);
    const withdrawn = this.invitesTo(to);
    for (const i of withdrawn) this.invites.delete(i.id);
    return { ok: true, invite, party, withdrawn };
  }

  /** Leaves the party; null if not in one. A party of one breaks up (D-143). */
  leave(player: number): Leaving | null {
    const party = this.partyOfPlayer.get(player);
    if (!party) return null;
    const wasLeader = party.members[0] === player;
    party.members = party.members.filter((m) => m !== player);
    this.partyOfPlayer.delete(player);
    const disbanded = party.members.length <= 1;
    if (disbanded) {
      for (const m of party.members) this.partyOfPlayer.delete(m);
    }
    return {
      remaining: [...party.members],
      disbanded,
      newLeader: wasLeader && !disbanded ? (party.members[0] ?? null) : null,
    };
  }

  /** The leader removes a member. */
  kick(
    leader: number,
    target: number,
  ):
    | { ok: true; leaving: Leaving }
    | { ok: false; reason: "notLeader" | "notMember" } {
    const party = this.partyOfPlayer.get(leader);
    if (!party || party.members[0] !== leader) {
      return { ok: false, reason: "notLeader" };
    }
    if (target === leader || !party.members.includes(target)) {
      return { ok: false, reason: "notMember" };
    }
    const leaving = this.leave(target);
    if (!leaving) return { ok: false, reason: "notMember" };
    return { ok: true, leaving };
  }

  /**
   * Gone from the game (disconnected or logged out): leaves the party and
   * withdraws every invite to or from them.
   */
  drop(player: number): { leaving: Leaving | null; withdrawn: Invite[] } {
    const withdrawn = [...this.invites.values()].filter(
      (i) => i.from === player || i.to === player,
    );
    for (const i of withdrawn) this.invites.delete(i.id);
    this.recent.delete(player);
    return { leaving: this.leave(player), withdrawn };
  }

  /** Removes and returns the invites that have lapsed by `tick`. */
  expire(tick: number): Invite[] {
    const lapsed = [...this.invites.values()].filter(
      (i) => i.expiresAt <= tick,
    );
    for (const i of lapsed) this.invites.delete(i.id);
    return lapsed;
  }
}
