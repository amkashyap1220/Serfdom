import { DUMMY_ENEMY, ENEMY_RING_ATTACK } from "./combat-config.ts";

// Goblin Warrens enemy roles (T-029, Phases 6b–6c). PROVISIONAL first-pass
// numbers chosen by Claude (the user delegated dungeon design, D-047),
// balanced for a fresh level-1 Serf (D-054: 20 HP, 0.5 HP/s); to be tuned
// in 6d (6d tuning: HP +~12% after the user's 2-player clear in 4:00). Change here only.

export const ENEMY_KINDS = [
  "dummy",
  "grunt",
  "slinger",
  "brute",
  "warlord",
  "skulker",
  "bomber",
  "shaman",
  "warchief",
  "skeleton",
  "archer",
  "ghost",
  "necromancer",
  "knight",
  "lich",
  "crystal",
  "imp",
  "caster",
  "elemental",
  "golem",
  "bellows",
  "forgemaster",
  "acolyte",
  "caller",
  "spearman",
  "eelpriest",
  "tidepriest",
  "wraith",
  "yeti",
  "frostarcher",
  "iceimp",
  "wyrm",
] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/** A projectile an enemy fires. */
export interface EnemyBulletSpec {
  damage: number;
  /** World pixels per second. */
  speed: number;
  size: number;
  /** Max travel distance. */
  range: number;
}

/** Stationary target that fires rings at nearby players (Phases 3–5). */
export const DUMMY = {
  maxHp: DUMMY_ENEMY.maxHp,
  size: DUMMY_ENEMY.size,
} as const;

/** Melee: runs at the nearest player and hurts on contact. */
export const GRUNT = {
  maxHp: 170,
  size: 32,
  /** Slower than the player (150), so it can be kited (D-111: was 95). */
  speed: 76,
  /** 7 contact hits kill a fresh 20 HP Serf (D-055; D-111: was 2). */
  contactDamage: 3,
  /** At most one contact hit per this many seconds, per grunt (D-111: was 0.8). */
  contactCooldownSeconds: 1.2,
} as const;

/**
 * Undead melee (D-120, the crypt): walks at you and hits like a grunt.
 * Killed the first time, it falls into a bone pile that stands up again
 * at half HP after `reviveSeconds`, unless a hit shatters the pile first.
 */
export const SKELETON = {
  maxHp: 260,
  size: 32,
  speed: 70,
  /** D-121: the crypt's undead hit harder than goblins (was 4). */
  contactDamage: 8,
  contactCooldownSeconds: 1.2,
  reviveSeconds: 4,
  /** A bone pile's HP: any hit shatters it. */
  pileHp: 1,
  /** It stands up with this share of its max HP. */
  reviveShare: 0.5,
} as const;

/** Ranged: keeps its distance and throws aimed rocks. */
export const SLINGER = {
  maxHp: 125,
  size: 32,
  /** D-111: was 70. */
  speed: 56,
  /** Backs away when the nearest player is closer than this… */
  minRange: 140,
  /** …and approaches when farther than this. */
  maxRange: 240,
  /** Throws only at players within this distance. */
  throwRange: 360,
  /** D-111: was 1.6 s and 2 damage; the rock flies as fast as before. */
  throwIntervalSeconds: 2.4,
  rock: { damage: 3, speed: 200, size: 6, range: 400 },
} as const satisfies { rock: EnemyBulletSpec } & Record<string, unknown>;

/**
 * Skeleton archer (D-120): a slinger's habits with a bow: stays 200–320 px
 * away and every 2.6 s looses 2 arrows at where you are heading.
 */
export const ARCHER = {
  maxHp: 200,
  size: 32,
  speed: 50,
  minRange: 200,
  maxRange: 320,
  throwRange: 400,
  throwIntervalSeconds: 2.6,
  /** Arrows per volley, this many degrees apart. */
  volley: 2,
  spreadDegrees: 8,
  /** Always aims where you are heading (slingers only sometimes, D-109). */
  alwaysLeads: true,
  /** D-121: was 4 per arrow. */
  rock: { damage: 7, speed: 230, size: 6, range: 450 },
} as const satisfies { rock: EnemyBulletSpec } & Record<string, unknown>;

/**
 * Ghost (D-120, D-122): floats straight at you through walls, pillars, and
 * closed doors. Every `visibleSeconds` it fades out for `fadedSeconds`:
 * shots pass through it and it cannot touch you.
 */
export const GHOST = {
  maxHp: 300,
  size: 32,
  speed: 55,
  contactDamage: 10,
  contactCooldownSeconds: 1.2,
  visibleSeconds: 3,
  fadedSeconds: 1.5,
} as const;

/**
 * Necromancer (D-120, D-122): keeps its distance and throws 3 slow skulls;
 * every 6 s it raises the nearest bone pile within 250 px as a full-HP
 * skeleton (whose next death is final). Kill it first.
 */
export const NECROMANCER = {
  maxHp: 400,
  size: 32,
  speed: 50,
  minRange: 200,
  maxRange: 260,
  throwRange: 400,
  throwIntervalSeconds: 3,
  volley: 3,
  spreadDegrees: 15,
  rock: { damage: 9, speed: 150, size: 8, range: 450 },
  raiseIntervalSeconds: 6,
  raiseRange: 250,
} as const satisfies { rock: EnemyBulletSpec } & Record<string, unknown>;

/**
 * Grave knight (D-120, D-122): slow and tough. Its shield faces the nearest
 * player but turns only `turnDegreesPerSecond`, and stops player shots
 * that hit its front `shieldArcDegrees`. Up close it raises its weapon
 * for 0.9 s and slams a circle in front of it.
 */
export const KNIGHT = {
  maxHp: 1200,
  size: 44,
  speed: 40,
  turnDegreesPerSecond: 120,
  shieldArcDegrees: 120,
  slam: {
    triggerRange: 70,
    windupSeconds: 0.9,
    /** Hits a circle this far in front, this wide. */
    reach: 40,
    radius: 50,
    damage: 18,
    cooldownSeconds: 3,
  },
} as const;

/**
 * The Lich (D-120, D-125), the crypt's boss: it floats at the centre of the
 * Sanctum. Phase 1, a two-armed bullet spiral and skeletons from the
 * sarcophagi; below 60% and again below 30% it is warded (cannot be hit)
 * while 3 soul crystals stand, firing rings; breaking them stuns it for
 * 4 s. After the second ward its spiral is faster and runes burst round it.
 * Human-sized: 32 px like a serf (D-128; was 88 under D-127).
 */
export const LICH = {
  maxHp: 11000,
  size: 32,
  wardBelow: [0.6, 0.3],
  spiral: {
    arms: 2,
    degreesPerSecond: 90,
    intervalSeconds: 0.15,
    bullet: { damage: 8, speed: 150, size: 8, range: 520 },
  },
  /** After the second ward. */
  finalSpiral: { degreesPerSecond: 135, intervalSeconds: 0.1 },
  rise: { intervalSeconds: 12, count: 2, maxAlive: 4, kind: "skeleton" },
  ward: {
    crystals: 3,
    crystalDistance: 200,
    ringIntervalSeconds: 2.5,
    /** Each ring comes with one quick full turn of the Lich, this long (D-129). */
    ringSpinSeconds: 0.5,
    ringBullets: 16,
    bullet: { damage: 8, speed: 120, size: 8, range: 520 },
  },
  stunSeconds: 4,
  runes: {
    intervalSeconds: 1.5,
    warnSeconds: 1,
    radius: 32,
    damage: 12,
    /** Besides one under each player: two at each distance, turning 45° each time. */
    distances: [160, 260],
  },
} as const;

/** A soul crystal (D-125): stands still; while any stands, the Lich is warded. */
export const CRYSTAL = {
  maxHp: 600,
  size: 40,
} as const;

/** Tough charger (6c): walks up, telegraphs, then charges in a straight line. Only the charge hurts. */
export const BRUTE = {
  maxHp: 450,
  size: 40,
  /** D-111: was 60. */
  speed: 48,
  /** Starts a charge when the nearest player is this close and it is ready. */
  chargeTriggerRange: 240,
  /** Stands still and flashes (the telegraph) for this long (D-111: was 0.7). */
  windupSeconds: 0.9,
  /** D-111: was 320. */
  chargeSpeed: 260,
  chargeSeconds: 0.9,
  /** Stands still after a charge (D-111: was 1.2). */
  recoverSeconds: 2.4,
  /** Per player, at most once per charge (D-111: was 4). */
  chargeDamage: 6,
  /** Dazed after charging into a wall or obstacle, then it recovers (D-112). */
  dazeSeconds: 1.5,
} as const;

/**
 * Goblin Warlord boss (6c). Stationary; two phases split at half HP.
 * Phase 2 adds reinforcements and rockfall (the GDD's limited arena hazard).
 */
export const WARLORD = {
  maxHp: 5000,
  size: 56,
  /** Attacks while any player is this close. */
  aggroRange: 600,
  /** Phase 2 below this fraction of max HP. */
  phaseTwoBelow: 0.5,
  // D-111: attacks 1.5× less often, 1.5× the damage (was 1.4/1.2 s, 3/2 s,
  // 2 damage; summons every 9 s; rockfall every 3.5 s for 3).
  spread: {
    phase1: { count: 5, intervalSeconds: 2.1 },
    phase2: { count: 7, intervalSeconds: 1.8 },
    angleStepDegrees: 15,
    bullet: { damage: 3, speed: 170, size: 8, range: 520 },
  },
  ring: {
    phase1: { count: 12, intervalSeconds: 4.5 },
    phase2: { count: 16, intervalSeconds: 3 },
    bullet: { damage: 3, speed: 110, size: 8, range: 500 },
  },
  summon: {
    kind: "grunt",
    count: 2,
    intervalSeconds: 12,
    /** No more summons while this many of its summons are alive. */
    maxAlive: 6,
    /** Summons appear this far left and right of the Warlord. */
    offset: 60,
  },
  rockfall: {
    intervalSeconds: 5,
    /** A warning circle under each living player… */
    radius: 32,
    /** …that hits whoever is inside it this long later. */
    delaySeconds: 1.2,
    damage: 5,
  },
} as const;

/** Flanker (D-115): runs to where you are heading, then lunges. */
export const SKULKER = {
  maxHp: 150,
  size: 32,
  /** Faster than a grunt (76), slower than the player (150). */
  speed: 95,
  /** Aims this far ahead of a moving player. */
  leadSeconds: 0.8,
  /** Within this distance it goes straight for you. */
  lungeRange: 60,
  contactDamage: 3,
  contactCooldownSeconds: 1.2,
} as const;

/**
 * Forge imp (D-130, the Ember Forge): the skulker's flanking on the
 * forge's scale: fast, runs to where you are heading, lunges.
 */
export const IMP = {
  maxHp: 300,
  size: 32,
  speed: 100,
  leadSeconds: 0.8,
  lungeRange: 60,
  contactDamage: 10,
  contactCooldownSeconds: 1.2,
} as const;

/** Lobs bombs that leave burning floor (D-115). */
export const BOMBER = {
  maxHp: 140,
  size: 32,
  speed: 50,
  minRange: 180,
  maxRange: 300,
  throwRange: 380,
  throwIntervalSeconds: 3.6,
  /** Aims this far ahead of a moving player. */
  leadSeconds: 0.5,
  /** The bomb's shadow grows this long before it lands. */
  flightSeconds: 0.9,
  radius: 40,
  damage: 4,
  fire: { seconds: 3, tickSeconds: 0.5, damage: 2 },
} as const;

/**
 * Ember caster (D-130): the bomber's lob on the forge's scale: a fireball
 * that lands where you will be, then burning floor.
 */
export const CASTER = {
  maxHp: 280,
  size: 32,
  speed: 50,
  minRange: 180,
  maxRange: 300,
  throwRange: 380,
  throwIntervalSeconds: 3.6,
  leadSeconds: 0.5,
  flightSeconds: 0.9,
  radius: 40,
  damage: 10,
  fire: { seconds: 3, tickSeconds: 0.5, damage: 3 },
} as const;

/**
 * Fire elemental (D-130, D-132): rushes you; within `triggerRange` it
 * flares for `fuseSeconds` (a telegraph), then explodes for `damage` on
 * every player its circle touches and is gone. Killed during the flare, it
 * does not explode. (New block: the exploder.)
 */
export const ELEMENTAL = {
  maxHp: 200,
  size: 32,
  speed: 120,
  triggerRange: 50,
  fuseSeconds: 0.6,
  radius: 50,
  damage: 14,
} as const;

/**
 * Magma golem (D-130, D-132): slow and heavy; its crust halves all damage,
 * except for `ventSeconds` every `ventEverySeconds` when it vents and
 * takes double. (New block: the armour cycle.)
 */
export const GOLEM = {
  maxHp: 1600,
  size: 44,
  speed: 35,
  contactDamage: 14,
  contactCooldownSeconds: 1.2,
  ventEverySeconds: 6,
  ventSeconds: 1.5,
  /** Share of a hit it takes: crusted, and venting. */
  crustTaken: 0.5,
  ventTaken: 2,
} as const;

/**
 * Bellows-keeper (D-130, D-132): never attacks; moves like a shaman, and
 * every `pulseSeconds` heals enemies within `radius` by `healShare` of
 * their max HP per second (not itself, other bellows-keepers, bone piles,
 * or bosses). (New block: the healer.)
 */
export const BELLOWS = {
  maxHp: 450,
  size: 32,
  speed: 60,
  seekRange: 300,
  keepAway: 200,
  pulseSeconds: 1,
  radius: 120,
  healShare: 0.03,
} as const;

/** Bosses: never healed by a bellows-keeper (D-132), so a fight cannot stall. */
export const BOSS_KINDS: readonly EnemyKind[] = [
  "warlord",
  "warchief",
  "lich",
  "forgemaster",
  "tidepriest",
  "wyrm",
];

/** Ice wraith (D-136): walks at you like a grunt and leaves a trail of frost that slows you. */
export const WRAITH = {
  maxHp: 520,
  size: 32,
  speed: 70,
  contactDamage: 13,
  contactCooldownSeconds: 1.2,
  trail: { everySeconds: 3, radius: 48, seconds: 4 },
} as const;

/** Yeti (D-136): a big, slow, hard-hitting walker. */
export const YETI = {
  maxHp: 1100,
  size: 40,
  speed: 55,
  contactDamage: 16,
  contactCooldownSeconds: 1.4,
} as const;

/** Frost archer (D-136): the slinger's band, volleys of three icy arrows. */
export const FROSTARCHER = {
  maxHp: 300,
  size: 32,
  speed: 55,
  minRange: 160,
  maxRange: 280,
  throwRange: 400,
  throwIntervalSeconds: 2.4,
  rock: { damage: 12, speed: 230, size: 6, range: 440 },
  volley: 3,
  spreadDegrees: 10,
} as const;

/** Ice imp (D-136): the skulker's flanking, quick and cold. */
export const ICEIMP = {
  maxHp: 340,
  size: 32,
  speed: 105,
  leadSeconds: 0.8,
  lungeRange: 60,
  contactDamage: 13,
  contactCooldownSeconds: 1.2,
} as const;

/**
 * The Frost Wyrm (D-136), Frost Hollow's boss: frost-breath cones; a tail
 * sweep round itself that leaves frost; below `summonBelow` ice wraiths;
 * below `enragedBelow` its breath comes faster.
 */
export const WYRM = {
  maxHp: 20000,
  size: 96,
  speed: 30,
  keep: 140,
  summonBelow: 0.5,
  enragedBelow: 0.25,
  breath: {
    intervalSeconds: 4,
    enragedIntervalSeconds: 2.5,
    warnSeconds: 1,
    range: 280,
    halfAngleDegrees: 35,
    damage: 16,
    frostRadius: 90,
    frostSeconds: 4,
  },
  tail: {
    intervalSeconds: 3,
    triggerRange: 130,
    windupSeconds: 0.6,
    radius: 120,
    damage: 14,
    frostSeconds: 4,
  },
  summon: { intervalSeconds: 12, count: 2, maxAlive: 3, kind: "wraith" },
} as const;

/** Drowned acolyte (D-135): walks at you and hits, like a grunt. */
export const ACOLYTE = {
  maxHp: 260,
  size: 32,
  speed: 80,
  contactDamage: 12,
  contactCooldownSeconds: 1.2,
} as const;

/** Tide caller (D-135): keeps its distance and throws pairs of water bolts, like a slinger. */
export const CALLER = {
  maxHp: 240,
  size: 32,
  speed: 55,
  minRange: 150,
  maxRange: 260,
  throwRange: 380,
  throwIntervalSeconds: 2.6,
  rock: { damage: 11, speed: 220, size: 8, range: 420 },
  volley: 2,
  spreadDegrees: 12,
} as const;

/** Fishfolk spearman (D-135): a brute's charge, quicker and harder; tides do not slow it. */
export const SPEARMAN = {
  maxHp: 420,
  size: 32,
  speed: 60,
  chargeTriggerRange: 230,
  windupSeconds: 0.7,
  chargeSpeed: 300,
  chargeSeconds: 0.7,
  recoverSeconds: 1.8,
  chargeDamage: 14,
  dazeSeconds: 1.2,
} as const;

/**
 * Eel-priest (D-135): keeps its distance like a slinger (it throws
 * nothing); every few seconds it tethers the nearest player in clear
 * sight, and after the warning pulls them towards where it stood.
 */
export const EELPRIEST = {
  maxHp: 400,
  size: 32,
  speed: 50,
  minRange: 170,
  maxRange: 280,
  pull: {
    intervalSeconds: 5,
    range: 320,
    warnSeconds: 0.8,
    seconds: 0.45,
    speed: 240,
    damage: 8,
  },
} as const;

/**
 * The Tide Priest (D-135), the Sunken Temple's boss: tidal surges that
 * sweep the arena with gaps, fans of water bolts; below `whirlBelow`
 * whirlpools; below `enragedBelow` surges come faster and turn.
 */
export const TIDEPRIEST = {
  maxHp: 16000,
  size: 56,
  speed: 25,
  /** It stops walking this close to its target. */
  keep: 160,
  whirlBelow: 0.5,
  enragedBelow: 0.25,
  surge: { intervalSeconds: 6, enragedIntervalSeconds: 4 },
  bolts: {
    intervalSeconds: 2,
    count: 3,
    angleStepDegrees: 18,
    bullet: { damage: 10, speed: 180, size: 10, range: 520 },
  },
  whirlpools: { intervalSeconds: 5, count: 2 },
} as const;

/**
 * The Forgemaster (D-134), the Ember Forge's boss. Walks after the nearest
 * player. Phase 1: a hammer slam (a 0.8 s windup, then `slam.damage` in a
 * circle in front of it) that sends out a shockwave ring with a gap, and
 * aimed spreads of molten bullets. Below `golemsBelow`: magma golems out
 * of the forge doors. Below `enragedBelow`: floor plates burn round a
 * moving safe lane, and slams come faster.
 */
export const FORGEMASTER = {
  maxHp: 14000,
  size: 88,
  speed: 30,
  golemsBelow: 0.6,
  enragedBelow: 0.3,
  slam: {
    intervalSeconds: 5,
    enragedIntervalSeconds: 3.5,
    windupSeconds: 0.8,
    /** The hammer lands this far in front of its centre. */
    reach: 60,
    radius: 70,
    damage: 14,
  },
  wave: {
    speed: 180,
    maxRadius: 420,
    thickness: 16,
    gapDegrees: 60,
    damage: 12,
  },
  spread: {
    intervalSeconds: 2.5,
    count: 5,
    angleStepDegrees: 15,
    bullet: { damage: 9, speed: 170, size: 10, range: 520 },
  },
  golems: { intervalSeconds: 10, count: 2, maxAlive: 2, kind: "golem" },
  plates: {
    intervalSeconds: 2.5,
    warnSeconds: 1.5,
    /** How long a burst stays drawn. */
    burnSeconds: 0.25,
    size: 80,
    /** The safe lane is this many plates wide. */
    laneWidth: 2,
    damage: 14,
  },
} as const;

/** Never attacks; strengthens goblins near it (D-108, D-115). */
export const SHAMAN = {
  maxHp: 200,
  size: 32,
  speed: 60,
  /** Looks for goblins to strengthen this far away… */
  seekRange: 300,
  /** …while keeping at least this far from the nearest player. */
  keepAway: 200,
  chantIntervalSeconds: 4,
  chantRadius: 120,
  chantSeconds: 5,
  /** Chanted goblins deal this much more damage. */
  damageBonus: 0.5,
} as const;

/**
 * The Goblin Warchief (D-117), the Stronghold's boss: it walks after you.
 * Phase 1 sweeps its axe and throws axes; phase 2 (below 66% HP) adds a
 * charge and a war cry; phase 3 (below 33%) adds a ground slam, and every
 * attack comes 25% more often.
 */
export const WARCHIEF = {
  maxHp: 8000,
  size: 80,
  speed: 40,
  phaseTwoBelow: 0.66,
  phaseThreeBelow: 0.33,
  /** Phase 3: every interval times this. */
  enragedRate: 0.75,
  sweep: {
    triggerRange: 90,
    windupSeconds: 0.8,
    /** Hits a circle this far in front, this wide. */
    reach: 50,
    radius: 60,
    damage: 8,
    cooldownSeconds: 2.5,
    recoverSeconds: 0.6,
  },
  axes: {
    intervalSeconds: 3,
    count: 3,
    angleStepDegrees: 20,
    bullet: { damage: 6, speed: 200, size: 10, range: 500 },
  },
  charge: {
    intervalSeconds: 7,
    triggerRange: 320,
    windupSeconds: 1,
    speed: 300,
    seconds: 1,
    damage: 10,
    dazeSeconds: 2.5,
    recoverSeconds: 1,
  },
  warCry: { intervalSeconds: 10, count: 2, maxAlive: 4, kind: "skulker" },
  slam: {
    intervalSeconds: 6,
    count: 20,
    bullet: { damage: 5, speed: 110, size: 10, range: 500 },
  },
} as const;

export const RING_BULLET: EnemyBulletSpec = {
  damage: ENEMY_RING_ATTACK.damage,
  speed: ENEMY_RING_ATTACK.speed,
  size: ENEMY_RING_ATTACK.size,
  range: ENEMY_RING_ATTACK.range,
};

export const ENEMY_STATS: Record<EnemyKind, { maxHp: number; size: number }> = {
  dummy: DUMMY,
  grunt: GRUNT,
  slinger: SLINGER,
  brute: BRUTE,
  warlord: WARLORD,
  skulker: SKULKER,
  bomber: BOMBER,
  shaman: SHAMAN,
  warchief: WARCHIEF,
  skeleton: SKELETON,
  archer: ARCHER,
  ghost: GHOST,
  necromancer: NECROMANCER,
  knight: KNIGHT,
  lich: LICH,
  crystal: CRYSTAL,
  imp: IMP,
  caster: CASTER,
  elemental: ELEMENTAL,
  golem: GOLEM,
  bellows: BELLOWS,
  forgemaster: FORGEMASTER,
  acolyte: ACOLYTE,
  caller: CALLER,
  spearman: SPEARMAN,
  eelpriest: EELPRIEST,
  tidepriest: TIDEPRIEST,
  wraith: WRAITH,
  yeti: YETI,
  frostarcher: FROSTARCHER,
  iceimp: ICEIMP,
  wyrm: WYRM,
};

/**
 * Seconds before a freshly spawned enemy's first attack, so a room waking
 * up does not hit the player on the very first frame.
 */
export const FIRST_ATTACK_DELAY: Record<EnemyKind, number> = {
  dummy: 0,
  grunt: GRUNT.contactCooldownSeconds / 2,
  slinger: SLINGER.throwIntervalSeconds / 2,
  /** Before its first charge. */
  brute: 1,
  /** Before its first spread and ring. */
  warlord: 1,
  skulker: SKULKER.contactCooldownSeconds / 2,
  bomber: BOMBER.throwIntervalSeconds / 2,
  shaman: SHAMAN.chantIntervalSeconds / 2,
  /** Before its first throw. */
  warchief: 1.5,
  skeleton: SKELETON.contactCooldownSeconds / 2,
  archer: ARCHER.throwIntervalSeconds / 2,
  ghost: GHOST.contactCooldownSeconds / 2,
  necromancer: NECROMANCER.throwIntervalSeconds / 2,
  /** Before its first slam. */
  knight: 1,
  /** Before its spiral starts. */
  lich: 1.5,
  crystal: 0,
  imp: IMP.contactCooldownSeconds / 2,
  caster: CASTER.throwIntervalSeconds / 2,
  elemental: 0,
  golem: GOLEM.contactCooldownSeconds / 2,
  bellows: BELLOWS.pulseSeconds,
  forgemaster: 1.5,
  acolyte: ACOLYTE.contactCooldownSeconds / 2,
  caller: CALLER.throwIntervalSeconds / 2,
  spearman: 0,
  eelpriest: EELPRIEST.pull.intervalSeconds / 2,
  tidepriest: 1.5,
  wraith: WRAITH.contactCooldownSeconds / 2,
  yeti: YETI.contactCooldownSeconds / 2,
  frostarcher: FROSTARCHER.throwIntervalSeconds / 2,
  iceimp: ICEIMP.contactCooldownSeconds / 2,
  wyrm: 2,
};

export function isEnemyKind(v: unknown): v is EnemyKind {
  return ENEMY_KINDS.some((k) => k === v);
}
