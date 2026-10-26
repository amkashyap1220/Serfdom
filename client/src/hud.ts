import {
  ABILITIES,
  ABILITY_NAMES,
  className,
  dungeonInfo,
  FIRE_MODE_LABELS,
  levelProgress,
  MAX_LEVEL,
  type AbilityLoadout,
  type DungeonId,
  type FireMode,
  type PartyMember,
  type SerfSummary,
  type SnapshotPlayer,
} from "@serfdom/shared";
import { formatDuration } from "./app-state";

/** What the in-run HUD shows (D-146), gathered each frame by main.ts. */
export interface HudInput {
  serf: SerfSummary | null;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  ability: AbilityLoadout | null;
  /** Seconds until the ability can be cast again, from the server. */
  abilityCooldown: number;
  fireMode: FireMode;
  dungeon: DungeonId | null;
  /** The run's clock (seconds since it started), from the server. */
  clock: number | null;
  /** Your party, or null; members' HP come from `players`. */
  party: { leaderId: number; members: PartyMember[] } | null;
  myId: number | null;
  /** Everyone in your run, from the latest snapshot. */
  players: readonly SnapshotPlayer[];
}

/** "Guard (T7) · 20 MP · ready", or the cooldown, or what is missing. */
export function abilityLine(
  ability: AbilityLoadout | null,
  cooldown: number,
  mp: number,
): string {
  if (!ability) return "Space: no ability";
  const { mpCost } = ABILITIES[ability.kind];
  const head = `Space: ${ABILITY_NAMES[ability.kind]} (T${ability.tier}) · ${mpCost} MP`;
  if (cooldown > 0.05) return `${head} · ${cooldown.toFixed(1)} s`;
  if (mp < mpCost) return `${head} · need MP`;
  return `${head} · ready`;
}

export interface PartyRow {
  name: string;
  /** HP as a fraction 0–1, or null when they are not in this run. */
  hp: number | null;
  leader: boolean;
}

/**
 * The other party members, in party order: each one's HP if they are in
 * your run (a dead one shows 0), else null. Without a party: none.
 */
export function partyRows(
  party: HudInput["party"],
  myId: number | null,
  players: readonly SnapshotPlayer[],
): PartyRow[] {
  if (!party) return [];
  return party.members
    .filter((m) => m.playerId !== myId)
    .map((m) => {
      const p = players.find((x) => x.id === m.playerId);
      return {
        name: m.name ?? "Choosing a serf",
        hp: p ? (p.maxHp > 0 ? p.hp / p.maxHp : 0) : null,
        leader: m.playerId === party.leaderId,
      };
    });
}

/** The fraction of the way to the next level, and its label (1 and "Max level" at 20). */
export function expBar(serf: SerfSummary): { fill: number; text: string } {
  const p = levelProgress(serf.exp);
  if (p.level >= MAX_LEVEL)
    return { fill: 1, text: `Max level · ${serf.exp} EXP` };
  return {
    fill: p.into / Math.max(1, p.needed),
    text: `${p.into} / ${p.needed} EXP`,
  };
}

/**
 * The player HUD in the 240×800 panel (D-146): DOM, outside the gameplay
 * viewport. Text is written each frame; the party rows are rebuilt only
 * when they change.
 */
export class Hud {
  private partyKey = "";

  constructor(
    private readonly els: {
      name: HTMLElement;
      hpFill: HTMLElement;
      hpText: HTMLElement;
      mpFill: HTMLElement;
      mpText: HTMLElement;
      expFill: HTMLElement;
      expText: HTMLElement;
      ability: HTMLElement;
      fire: HTMLElement;
      run: HTMLElement;
      party: HTMLElement;
    },
  ) {}

  render(input: HudInput): void {
    const { els } = this;
    const serf = input.serf;
    els.name.textContent = serf
      ? `${serf.name} · ${className(serf.classId)} · Lv ${serf.level}`
      : "—";
    setBar(els.hpFill, els.hpText, input.hp, input.maxHp, "HP");
    setBar(els.mpFill, els.mpText, input.mp, input.maxMp, "MP");
    const exp = serf ? expBar(serf) : { fill: 0, text: "" };
    els.expFill.style.width = `${exp.fill * 100}%`;
    els.expText.textContent = exp.text;
    els.ability.textContent = abilityLine(
      input.ability,
      input.abilityCooldown,
      input.mp,
    );
    els.fire.textContent = `Fire (T): ${FIRE_MODE_LABELS[input.fireMode]}`;
    els.run.textContent =
      input.dungeon && input.clock !== null
        ? `${dungeonInfo(input.dungeon).name} · ${formatDuration(input.clock)}`
        : "";
    this.renderParty(input);
  }

  private renderParty(input: HudInput): void {
    const rows = partyRows(input.party, input.myId, input.players);
    const others = input.players.filter(
      (p) =>
        p.id !== input.myId &&
        !input.party?.members.some((m) => m.playerId === p.id),
    ).length;
    // Rounded to whole percents so the rows rebuild only on visible change.
    const key = JSON.stringify([
      rows.map((r) => [
        r.name,
        r.hp === null ? null : Math.round(r.hp * 100),
        r.leader,
      ]),
      others,
    ]);
    if (key === this.partyKey) return;
    this.partyKey = key;
    const box = this.els.party;
    box.replaceChildren();
    if (rows.length > 0) box.append(text("h2", "Party"));
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "hud-member";
      row.append(text("span", `${r.leader ? "★ " : ""}${r.name}`));
      if (r.hp === null) {
        row.append(text("span", "not here"));
      } else {
        const bar = document.createElement("div");
        bar.className = "bar hp";
        const fill = document.createElement("span");
        fill.style.width = `${r.hp * 100}%`;
        bar.append(fill);
        row.append(bar);
      }
      box.append(row);
    }
    if (others > 0) {
      box.append(
        text("p", `With ${others} other player${others === 1 ? "" : "s"}`),
      );
    }
  }
}

function setBar(
  fill: HTMLElement,
  label: HTMLElement,
  value: number,
  max: number,
  name: string,
): void {
  fill.style.width = `${max > 0 ? (100 * value) / max : 0}%`;
  label.textContent = max > 0 ? `${name} ${Math.ceil(value)}/${max}` : name;
}

function text(tag: string, content: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = content;
  return e;
}
