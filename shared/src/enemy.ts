import {
  ENEMY_STATS,
  FIRST_ATTACK_DELAY,
  WARLORD,
  type EnemyKind,
  WARCHIEF,
  SKELETON,
  GHOST,
  NECROMANCER,
  LICH,
  GOLEM,
  FORGEMASTER,
  TIDEPRIEST,
  WRAITH,
} from "./enemy-config.ts";
import type { Vec2 } from "./geometry.ts";
import { applyDamage } from "./health.ts";
import { rescaleHp, scaledMaxHp } from "./party-scaling.ts";

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  /** Dungeon room it belongs to (counts toward clearing that room), or null. */
  roomId: string | null;
  position: Vec2;
  /** Square hit box size. */
  size: number;
  hp: number;
  /** Current max HP, after party scaling. */
  maxHp: number;
  /** Solo (1-player) max HP before party scaling. */
  baseMaxHp: number;
  /** Party size `maxHp` is currently scaled for. */
  scaledFor: number;
  /** Seconds until it comes back; 0 while alive (and forever if it never respawns). */
  respawnIn: number;
  /** Respawn delay after defeat, or null for enemies that stay dead (dungeons). */
  respawnSeconds: number | null;
  /** Seconds until its next attack is allowed. */
  attackCooldown: number;
  /** The enemy that summoned it (it dies with its summoner), or null. */
  summonerId: number | null;
  /** A slinger that aims where its target will be (D-109). */
  leads: boolean;
  /** Seconds left of a shaman's chant: it deals more damage (D-115). */
  chant?: number;
  /** Per-kind behavior state (enemy-ai.ts). */
  ai: EnemyAi;
  /** Inside a Nature's Reach this tick: moves at half speed (D-097). Set by the world step. */
  slowed?: boolean;
  /** Warlock Curse (D-098): takes `bonus` more damage from every source while `remaining` > 0. */
  curse?: { remaining: number; bonus: number };
}

/**
 * Behavior state that only some kinds need. Timers count down in seconds.
 * - brute: walk → windup (telegraph) → charge (locked direction) → recover.
 * - warlord: one timer per attack; `ringTurn` alternates the ring's offset.
 */
export type EnemyAi =
  | { kind: "none" }
  | {
      /** A brute, or a fishfolk spearman: the same charge with its own numbers (D-135). */
      kind: "brute" | "spearman";
      /** "dazed": after charging into a wall (D-112), before recovering. */
      mode: "walk" | "windup" | "charge" | "dazed" | "recover";
      timer: number;
      direction: Vec2;
      /** Players already hit by the current charge. */
      hit: readonly number[];
    }
  | {
      kind: "wraith";
      /** Seconds until it leaves its next patch of frost (D-136). */
      trail: number;
    }
  | {
      kind: "wyrm";
      /** Walking, breathing (holding still while the cone warns), or raising its tail. */
      mode: "walk" | "breath" | "tail";
      timer: number;
      breath: number;
      tail: number;
      summon: number;
      called: number;
    }
  | {
      kind: "eelpriest";
      /** Seconds until it may tether again. */
      pull: number;
      /** The player it has tethered, and seconds until the pull (and its hit) starts. */
      tethered: number | null;
      strikeIn: number;
    }
  | {
      kind: "tidepriest";
      /** Seconds until each attack is ready. */
      surge: number;
      bolts: number;
      whirls: number;
      /** Surges and whirlpool rounds so far (each surge's gaps move). */
      surges: number;
      rounds: number;
    }
  | {
      kind: "lich";
      /** spiral: attacking; warded: crystals up, cannot be hit; stunned: crystals broken. */
      mode: "spiral" | "warded" | "stunned";
      /** Wards begun so far (0, 1, 2): two means its final phase. */
      wards: number;
      /** Seconds in the current mode (the ward waits for its crystals to appear). */
      timer: number;
      /** The spiral's angle (radians), and seconds to its next shot. */
      spin: number;
      shot: number;
      /** Spinning while it attacks (its spiral, or a ring's quick turn), else standing idle (D-129). */
      firing: boolean;
      /** Radians toward the nearest player, whom it faces while idle (D-129); the same on every screen. */
      look: number;
      ring: number;
      ringTurn: number;
      rise: number;
      /** Final phase: seconds to the next runes, and how far they have turned. */
      runes: number;
      runeTurn: number;
    }
  | {
      kind: "forgemaster";
      /** Walking, or raising the hammer (the slam's windup, D-134). */
      mode: "walk" | "windup";
      timer: number;
      /** Where the hammer is coming down, locked when it goes up. */
      direction: Vec2;
      /** Seconds until each attack is ready. */
      slam: number;
      spread: number;
      golems: number;
      plates: number;
      /** Slams so far (each gap is new) and plate bursts so far (the lane sweeps). */
      slams: number;
      plateSteps: number;
      /** Golems called so far, so the forge doors take turns. */
      called: number;
    }
  | {
      kind: "elemental";
      /** Seconds left of its flare before it explodes, or null while it rushes (D-132). */
      fuse: number | null;
    }
  | {
      kind: "golem";
      /** Seconds until it next vents, and seconds left of the vent (D-132). */
      vent: number;
      venting: number;
    }
  | {
      kind: "ghost";
      /** Faded out: cannot hit or be hit (D-120). */
      faded: boolean;
      /** Seconds left in the current state (visible or faded). */
      timer: number;
    }
  | {
      kind: "necromancer";
      /** Seconds until it can raise a bone pile. */
      raise: number;
    }
  | {
      kind: "knight";
      mode: "walk" | "windup";
      /** Where its shield faces (unit vector); turns at a limited rate. */
      facing: Vec2;
      timer: number;
      /** Seconds until it may slam again. */
      slam: number;
    }
  | {
      kind: "skeleton";
      /** Seconds until a bone pile stands up again, or null while standing (D-120). */
      pile: number | null;
      /** Already stood up once: the next death is final. */
      revived: boolean;
    }
  | {
      kind: "warchief";
      mode:
        | "walk"
        | "sweepWindup"
        | "chargeWindup"
        | "charge"
        | "dazed"
        | "recover";
      timer: number;
      /** Locked at the end of a windup. */
      direction: Vec2;
      /** Players already hit by the current charge. */
      hit: readonly number[];
      /** Seconds until each attack is ready. */
      sweep: number;
      axes: number;
      charge: number;
      warCry: number;
      slam: number;
      /** Holes the war cry has used, so they take turns. */
      cries: number;
    }
  | {
      kind: "warlord";
      spread: number;
      ring: number;
      ringTurn: number;
      summon: number;
      rockfall: number;
    };

function initialAi(kind: EnemyKind): EnemyAi {
  switch (kind) {
    case "brute":
      return {
        kind,
        mode: "walk",
        timer: 0,
        direction: { x: 0, y: 0 },
        hit: [],
      };
    case "skeleton":
      return { kind, pile: null, revived: false };
    case "ghost":
      return { kind, faded: false, timer: GHOST.visibleSeconds };
    case "elemental":
      return { kind, fuse: null };
    case "spearman":
      return {
        kind,
        mode: "walk",
        timer: 0,
        direction: { x: 0, y: 0 },
        hit: [],
      };
    case "wraith":
      return { kind, trail: WRAITH.trail.everySeconds / 2 };
    case "wyrm":
      return {
        kind,
        mode: "walk",
        timer: 0,
        breath: FIRST_ATTACK_DELAY.wyrm,
        tail: 0,
        summon: 0,
        called: 0,
      };
    case "eelpriest":
      return {
        kind,
        pull: FIRST_ATTACK_DELAY.eelpriest,
        tethered: null,
        strikeIn: 0,
      };
    case "tidepriest":
      return {
        kind,
        surge: TIDEPRIEST.surge.intervalSeconds / 2,
        bolts: FIRST_ATTACK_DELAY.tidepriest,
        whirls: 0,
        surges: 0,
        rounds: 0,
      };
    case "forgemaster":
      return {
        kind,
        mode: "walk",
        timer: 0,
        direction: { x: 0, y: 0 },
        slam: FORGEMASTER.slam.intervalSeconds / 2,
        spread: FIRST_ATTACK_DELAY.forgemaster,
        // The golems come, and the plates start, as soon as their phase does.
        golems: 0,
        plates: 0,
        slams: 0,
        plateSteps: 0,
        called: 0,
      };
    case "golem":
      return { kind, vent: GOLEM.ventEverySeconds, venting: 0 };
    case "lich":
      return {
        kind,
        mode: "spiral",
        wards: 0,
        timer: 0,
        spin: 0,
        shot: FIRST_ATTACK_DELAY.lich,
        firing: false,
        look: Math.PI / 2,
        ring: 0,
        ringTurn: 0,
        rise: LICH.rise.intervalSeconds / 2,
        runes: LICH.runes.intervalSeconds,
        runeTurn: 0,
      };
    case "necromancer":
      return { kind, raise: NECROMANCER.raiseIntervalSeconds / 2 };
    case "knight":
      // Facing west: a room's entrance is on its west side.
      return {
        kind,
        mode: "walk",
        facing: { x: -1, y: 0 },
        timer: 0,
        slam: FIRST_ATTACK_DELAY.knight,
      };
    case "warchief":
      return {
        kind,
        mode: "walk",
        timer: 0,
        direction: { x: 0, y: 0 },
        hit: [],
        sweep: 0,
        axes: FIRST_ATTACK_DELAY.warchief,
        charge: WARCHIEF.charge.intervalSeconds / 2,
        warCry: WARCHIEF.warCry.intervalSeconds / 2,
        slam: WARCHIEF.slam.intervalSeconds / 2,
        cries: 0,
      };
    case "warlord": {
      const delay = FIRST_ATTACK_DELAY.warlord;
      return {
        kind,
        spread: delay,
        ring: delay,
        ringTurn: 0,
        summon: WARLORD.summon.intervalSeconds / 3,
        rockfall: WARLORD.rockfall.intervalSeconds / 2,
      };
    }
    default:
      return { kind: "none" };
  }
}

/** A fresh enemy of `kind` at full (solo) HP. */
export function newEnemy(
  id: number,
  kind: EnemyKind,
  position: Vec2,
  roomId: string | null,
  respawnSeconds: number | null,
  summonerId: number | null = null,
  leads = false,
): EnemyState {
  const { maxHp, size } = ENEMY_STATS[kind];
  return {
    summonerId,
    leads,
    ai: initialAi(kind),
    id,
    kind,
    roomId,
    position: { ...position },
    size,
    hp: maxHp,
    maxHp,
    baseMaxHp: maxHp,
    scaledFor: 1,
    respawnIn: 0,
    respawnSeconds,
    attackCooldown: FIRST_ATTACK_DELAY[kind],
  };
}

export function isAlive(enemy: EnemyState): boolean {
  return enemy.hp > 0;
}

/**
 * Cannot be hit right now: a ghost faded out (D-122), or the Lich warded
 * by its soul crystals (D-125). Shots pass through; nothing targets it.
 */
export function isFaded(enemy: EnemyState): boolean {
  return (
    (enemy.ai.kind === "ghost" && enemy.ai.faded) ||
    (enemy.ai.kind === "lich" && enemy.ai.mode === "warded")
  );
}

/**
 * Whether players' attacks can hit or target it: alive and not a faded
 * ghost (D-122). Every shot, blast, zone, chain, curse, and auto-aim asks.
 */
export function isHittable(enemy: EnemyState): boolean {
  return isAlive(enemy) && !isFaded(enemy);
}

/** A magma golem venting (D-132): it takes double damage now. */
export function isVenting(enemy: EnemyState): boolean {
  return enemy.ai.kind === "golem" && enemy.ai.venting > 0;
}

/** A skeleton lying as a bone pile (D-120): alive, but it neither moves nor attacks. */
export function isPile(enemy: EnemyState): boolean {
  return enemy.ai.kind === "skeleton" && enemy.ai.pile !== null;
}

/**
 * Applies damage. Returns the new state and whether this hit defeated it.
 * Hits on a defeated enemy do nothing (it is not targetable anyway).
 */
export function damageEnemy(
  enemy: EnemyState,
  damage: number,
): { enemy: EnemyState; defeated: boolean; damage: number } {
  if (!Number.isFinite(damage) || damage < 0) {
    throw new RangeError(`damage must be finite and >= 0, got ${damage}`);
  }
  if (!isAlive(enemy)) return { enemy, defeated: false, damage: 0 };
  // A cursed enemy takes more from every source (D-098); a magma golem's
  // crust halves it, unless it is venting (D-132: then double).
  const crust =
    enemy.ai.kind === "golem"
      ? enemy.ai.venting > 0
        ? GOLEM.ventTaken
        : GOLEM.crustTaken
      : 1;
  const taken = damage * (1 + (enemy.curse?.bonus ?? 0)) * crust;
  const { hp, died } = applyDamage(enemy.hp, taken);
  // A skeleton's first death leaves a bone pile instead (D-120); a hit on
  // the pile is the real death.
  const ai = enemy.ai;
  if (died && ai.kind === "skeleton" && ai.pile === null && !ai.revived) {
    return {
      enemy: {
        ...enemy,
        hp: SKELETON.pileHp,
        ai: { ...ai, pile: SKELETON.reviveSeconds },
      },
      defeated: false,
      damage: taken,
    };
  }
  return {
    enemy: { ...enemy, hp, respawnIn: died ? (enemy.respawnSeconds ?? 0) : 0 },
    defeated: died,
    damage: taken,
  };
}

/** Counts down a defeated enemy's respawn timer; back to full HP at zero. */
export function stepRespawn(
  enemy: EnemyState,
  dtSeconds: number,
): { enemy: EnemyState; respawned: boolean } {
  if (isAlive(enemy) || enemy.respawnSeconds === null) {
    return { enemy, respawned: false };
  }
  const respawnIn = enemy.respawnIn - dtSeconds;
  if (respawnIn > 1e-9)
    return { enemy: { ...enemy, respawnIn }, respawned: false };
  return {
    enemy: { ...enemy, hp: enemy.maxHp, respawnIn: 0, attackCooldown: 0 },
    respawned: true,
  };
}

/** Rescales max HP for a new party size, keeping the current HP fraction (D-045). */
export function scaleEnemyForParty(
  enemy: EnemyState,
  players: number,
): EnemyState {
  const n = Math.max(1, players);
  if (enemy.scaledFor === n) return enemy;
  const maxHp = scaledMaxHp(enemy.baseMaxHp, n);
  return {
    ...enemy,
    maxHp,
    hp: rescaleHp(enemy.hp, enemy.maxHp, maxHp),
    scaledFor: n,
  };
}

/**
 * Unit directions for a ring of `count` evenly spaced bullets, the first
 * pointing east (+x) and continuing clockwise on screen (world y is down).
 */
export function ringDirections(count: number): Vec2[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
}
