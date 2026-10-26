# Serfdom — Game Design Document

**Document status:** Living design document  
**Current design baseline:** Reconciled with the decision log (D-001–D-122) and the code as of 2026-10-24  
**Important:** This document distinguishes confirmed direction from unresolved or provisional details. It intentionally does not invent missing class names or final balance numbers.

## 1. High concept

Serfdom is a browser-first, multiplayer top-down bullet-hell action RPG with short repeatable dungeons, class progression, skillful combat, permadeath, endgame loot, and a persistent player economy. It is intended to launch in a browser first and later be released on Steam as a windowed desktop application.

Browser and Steam players must be able to play together. Both versions use the same online game servers, accounts, character progression, and economy.

Design pillars:

- Readable, skill-based combat with enemy patterns and projectiles.
- Short, repeatable dungeon runs.
- High-stakes permadeath and meaningful equipment loss.
- Distinct classes and build choices.
- Long-term loot collection, including rare Artifacts and Shiny items.
- Cooperative multiplayer for parties of up to ten players (D-012).
- Persistent account progression and a player-driven economy.
- Browser accessibility and future cross-platform Steam release.

## 2. Platform, game window, HUD, and camera

### Platform

- Browser-first: players visit the website, log in, and play without downloading a client.
- A future Steam desktop client may package the shared web client using Electron or a comparable wrapper.
- Browser and desktop clients use the same authoritative backend, accounts, progression, and economy.

### Approved initial desktop layout

- **Total game container:** 1200×800 CSS pixels (D-131; was 960×640).
- **Fixed HUD on the left:** 240×800 CSS pixels.
- **Gameplay viewport on the right:** 960×800 CSS pixels.
- HUD and gameplay are separate regions. The HUD must not cover the world.
- These are CSS layout dimensions, not automatically the internal renderer resolution or device-pixel dimensions.

### Approved camera behavior

- Top-down camera follows the player, who is normally centered **inside the gameplay viewport**.
- Target visibility is at least **300 world pixels above, below, left, and right** of the player's center in normal gameplay.
- The gameplay viewport must therefore display at least 600×600 world pixels.
- At one CSS pixel per world pixel (zoom 1, D-131), the 960×800 viewport gives 480 world pixels to the left/right and 400 above/below.
- The HUD width is excluded from camera-center calculations.
- At map boundaries, camera clamping or alternative edge treatment must be chosen intentionally and tested.

### Rendering and UI

- Player and player-sized ordinary enemy source sprites are 32×32 pixels (D-127; was 16×16); larger enemies/bosses use larger canvases.
- Keep source pixels, world pixels, CSS pixels, and device pixels distinct.
- Configure Phaser zoom/scale to preserve approved world-space visibility.
- Disable pixel-art smoothing; prefer integer scaling where practical.
- HUD stays fixed as the world scrolls. In a run it shows (D-146): the serf's name, class, and level; HP, MP, and EXP bars with numbers; the ability and whether it is ready; the fire mode (Full auto by default, D-149); the minimap (D-147: the rooms your run has woken, closed doors, the open portal, you and the other players, turning with the view); the dungeon and run time; each party member's HP; and the keys. The debug readout hides behind the ` key or the Settings switch.
- Wider windows may display additional world space; multiplayer visibility fairness needs evaluation.
- Minimum supported window size, compact layout, and mobile treatment remain OPEN.

### First-client acceptance

- Game container measures 1200×800 CSS pixels at target desktop size (D-131).
- HUD measures 240×800; gameplay viewport measures 960×800, with no overlap.
- A 32×32 player placeholder renders crisply (D-127).
- Camera centers the player within gameplay, not the whole container.
- Debug world bounds confirm at least 300 world pixels visible in every cardinal direction.
- Browser resizing and map boundaries have documented, tested behavior.

## 2A. Visual direction and asset pipeline

### Confirmed art direction

- **Style reference:** chunky, readable retro pixel art resembling the user's supplied sprite-sheet reference: strong silhouettes, compact shapes, limited clusters of color, and crisp pixel edges.
- **Player-sized ordinary enemies:** baseline sprite canvas of **32×32 source pixels** (D-127).
- **Player characters:** baseline sprite canvas of **32×32 source pixels** (D-127).
- **Camera (D-131):** zoom 1, so 32×32 sprites draw at 32 CSS pixels, one art pixel per screen pixel (D-127's 0.5 zoom is superseded).
- **Palette reference:** use the **Pokémon Emerald palette as the requested color reference** for the game's palette direction. Do not copy Pokémon characters, sprites, tiles, logos, or other game assets. Create original Serfdom designs and original sprite assets using the chosen palette reference.
- The same visual language should apply to enemies, players, items, projectiles, UI icons, and environments, while keeping combat elements easy to distinguish.
- Larger bosses may use larger canvases when needed, but their pixel density and palette should remain consistent with the ordinary sprites.
- Prefer transparent PNG sprites and documented frame/canvas dimensions. Avoid smoothing, antialiasing, or scaling that blurs pixel edges.

### AI-generated assets

The user wants assets to be **AI-generated as they become necessary**, not to create a huge art library before gameplay needs it.

Workflow:

1. Begin with simple placeholder shapes during early gameplay and networking work.
2. When a real asset is needed for a milestone, create only the minimum asset or sprite set needed for that feature.
3. Use an available image-generation capability when the development environment supports it. If Claude's current environment cannot generate an actual image file, do not pretend it can; ask the user how they want to handle that asset or provide a ready-to-use generation prompt and integration requirements.
4. Generate original Serfdom designs, not copied Pokémon sprites or characters.
5. Inspect each asset for correct canvas size, transparency, palette consistency, silhouette readability, and animation/frame layout before integrating it.
6. Keep a short asset manifest documenting filename, dimensions, intended use, animation frames, palette notes, and generation prompt/source.
7. Do not generate multiple large asset packs speculatively. Create assets just in time, test them in the actual game scene, and revise from user feedback.

The exact hexadecimal RGB palette entries and permitted color variants should be documented in a dedicated palette file once the palette has been reliably sampled/defined. Do not guess that a list of colors is the exact Pokémon Emerald palette. The palette should be verified from an appropriate reference before being labeled exact.

## 3. Progression

### Confirmed

- A new character is a classless **Serf** (levels 1–4).
- At **level 5**, the player chooses one of **10 launch classes** (D-072, D-073), permanently for that serf's life; it must choose before entering another dungeon. A new serf starts classless again: Fighter, Barbarian, Rogue, Ranger, Wizard, Cleric, Bard, Warlock, Druid, Sorcerer.
- Maximum character level is **20**.
- There are no further levels or stat increases after level 20.
- Lifetime EXP continues to be tracked after the level cap and feeds a single lifetime EXP leaderboard.
- A dead character retains its final lifetime EXP score on the leaderboard.
- The Goblin Warrens is aimed primarily at levels 1–9, but access is based on dungeon eligibility rather than a blanket rule that only those levels may enter.
- Dungeon EXP is awarded on successful completion; a character that dies before completion receives no completion rewards. EXP comes only from completion (D-069); the pace is fast (D-070).
- A dungeon gives less EXP to serfs above its level range (D-071): grinding only the Goblin Warrens reaches level 20 in about 75 clears (the first clear gives exactly one level, no later clear more than one), while progressing through harder dungeons reaches it in about 5 dungeons. Levels 1–20 are meant to be fast and easy; the real grind is stat potions and rare item drops from high-tier dungeons. PROVISIONAL numbers (T-045): each level costs 100 + 15 × (level − 1) EXP (level 20 at 4,465); the Goblin Warrens gives 100 EXP through level 9, then 10% less per level above 9.

### Design details still to resolve

- The EXP curve and the per-dungeon falloff are PROVISIONAL numbers (T-045); the direction (D-069–D-071) is confirmed. EXP comes only from completions (D-069).
- Stat growth and class maxes are confirmed and tunable (D-074–D-078, D-119); see §6.

## 4. Classes and abilities

The launch roster is the **10 classes** below, chosen permanently at level 5 (D-072, D-073, CONFIRMED). Each has a class-specific active ability item. All ten abilities are built (Phase 10) with confirmed, tunable numbers: D-096 to D-102. The Artifact twists are still concepts only.

### Class ability concepts

| Class     | Ability item | Core concept                                                      | Draft Artifact twist                                                                                    |
| --------- | ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fighter   | Shield       | Guard briefly reduces incoming damage (no defensive bash, D-100). | Aegis of the Last Stand: blocked damage powers a shockwave, capped.                                     |
| Barbarian | War Horn     | Battle Cry temporarily increases attack power.                    | Horn of the Blood King: kills during the buff restore a small amount of health.                         |
| Rogue     | Cloak        | Vanish disrupts targeting and grants evasiveness.                 | Veil of the Unseen End: leaves a decoy/shadow that draws attacks before bursting.                       |
| Ranger    | Quiver       | Volley fires a special arrow or small volley.                     | Quiver of the Worldseeker: piercing special arrows trigger a secondary seeking arrow on elite/boss hit. |
| Wizard    | Spellbook    | Arcane Blast detonates area damage.                               | Aetherion's Codex: pulls enemies together before detonating.                                            |
| Cleric    | Tome         | Healing restores the user and nearby allies.                      | The Tome of the First Dawn: healing also grants capped temporary shielding.                             |
| Bard      | Instrument   | Inspiration temporarily buffs nearby allies.                      | The Worldsong: pulse destroys or deflects a limited number of nearby enemy projectiles.                 |
| Warlock   | Grimoire     | Curse marks enemies for increased damage.                         | The Black Testament: cursed kills leave fragments that restore mana and briefly extend nearby curses.   |
| Druid     | Totem        | Nature's Reach creates a targeted damaging or entangling area.    | The Worldroot Totem: periodically roots enemies and empowers the next hit against them.                 |
| Sorcerer  | Scepter      | Chain Lightning jumps between enemies.                            | Eternity's Conduit: final strike creates a short-lived field that arcs between enemies entering it.     |

Confirmed for Phase 10 (D-092–D-095): the ability needs the class's ability item worn (a T0 one comes with the class choice); Space uses it for MP and a short cooldown, Wisdom regenerates MP; aimed abilities follow the fire mode; higher-tier ability items make the ability stronger.

Built (CONFIRMED, numbers tunable; T = item tier):

| Ability         | MP / cooldown | Effect                                                                                                                     | Decision    |
| --------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Arcane Blast    | 15 / 1.5 s    | Area damage at a target point.                                                                                             | D-096       |
| Volley          | 12 / 1.2 s    | A spread of arrows.                                                                                                        | D-097       |
| Chain Lightning | 15 / 1.5 s    | Hits the enemy nearest the target, then jumps between enemies.                                                             | D-097       |
| Nature's Reach  | 20 / 4 s      | A damaging area that pulses for a few seconds.                                                                             | D-097       |
| Battle Cry      | 15 / 10 s     | You deal more damage for a few seconds.                                                                                    | D-098       |
| Inspiration     | 20 / 12 s     | You and nearby allies deal more damage and heal faster.                                                                    | D-098       |
| Curse           | 15 / 6 s      | Enemies in a small area take more damage from everyone.                                                                    | D-098       |
| Guard           | 12 / 6 s      | 2.5 s of (50 + 3T)% less damage (max 80%), on top of Defense.                                                              | D-100       |
| Vanish          | 15 / 8 s      | (2 + 0.2T) s out of enemy sight; flying bullets hit for half; a click or a cast ends it; automatic fire holds; Space only. | D-100–D-102 |
| Healing         | 20 / 8 s      | You and allies within 160 px heal (10 + 3T) + 10% max HP.                                                                  | D-100       |

The four fire modes on T (D-099) decide whether the ability needs Space: Full auto casts it by itself when an enemy is in reach, except movement abilities (Vanish).

## 5. Combat model

The current high-level direction is **hybrid auto-combat and skillful dodging**. Do not assume the earlier fully manual aiming/firing proposal is final without asking.

Confirmed high-level intent:

- Real-time combat.
- Enemy projectiles and readable attack patterns.
- Player positioning and dodging matter.
- Weapons/classes should feel distinct.
- Bosses use multiple phases and mechanics, not just larger health pools.
- Combat must remain responsive while server-authoritative.

Confirmed controls and rules (built):

- **Keys:** every game key below is the default and can be rebound in Settings (D-159): a key in use offers a swap, so no key does two things; Escape and Enter stay the menus'. Settings follow the account.
- **Movement:** WASD by default, 8 directions, diagonals normalized, instant start and stop (D-031, D-032); up is always up the screen (D-040). Dodging is movement only, no dash (D-037).
- **View:** Q/E rotate the camera, Z resets it (D-040; speed and keys PROVISIONAL, T-017).
- **Attacks and aiming:** four fire modes cycled with T (D-099; names D-159): **Full auto** (the default, D-149), **Auto aim**, **Mouse aim**, **Manual** (left click). The mode is kept on the account between runs. Basic attacks follow the weapon (D-141).
- **Ability:** Space (D-035); costs and cooldowns per class in §4.
- **Leave a run:** R, at no cost except that run's rewards (D-036, D-053).
- **First run (D-159):** a welcome card on the home screen, one-at-a-time hints in the first runs (moving, the fire mode, turning, leaving; being hit, a boss, the portal, the ability), and a note after the first clear; each once per account (Settings: Show hints, Show all hints again).
- **Window and text (D-159):** the 1200×800 game scales to fit any window from 900×600 up (Full screen in Settings), always showing the same amount of world; text size Normal or Large; enemy bullets are round and yours square.
- **Formulas:** damage, fire rate, speed, Defense, and regen are D-078, with Defense changed by D-121 (§6). Hit authority is the server's (D-043, D-044).

Still open:

- Weapon attack identities: every weapon type currently fires the same basic shot; each type's own style is planned for Phase 16.

Never implement a new combat formula or input scheme based only on a prior proposal. Ask if the missing decision materially affects the milestone.

## 6. Stats

Confirmed stats (D-065, D-077, D-078), all live in combat:

- HP
- MP
- Attack
- Dexterity
- Speed
- Defense
- Vitality
- Wisdom
- Luck (confirmed, D-065)

Meanings:

- HP: health.
- MP: resource for class abilities.
- Attack: outgoing damage.
- Dexterity: attack speed/firing rate.
- Speed: movement speed.
- Defense: incoming damage reduction.
- Vitality: health regeneration.
- Wisdom: mana regeneration.
- Luck (confirmed, D-065–D-068): the number of reward chests a player rolls at the end of a completed dungeon, one chest per Luck point. A level-1 Serf starts with **1 Luck**. Luck never grows with level or class; it only comes from **equipped** items, each carrying **+1 Luck** at most and never negative Luck. Any item that can roll stats can roll Luck, Artifacts included. There is no Luck cap.

Formulas, caps, and class growth are confirmed and tunable (D-078, D-121); potion effects are D-118 and D-119 (§10).

Confirmed starting values: a level-1 Serf has **20 HP** (D-055) and regenerates **0.5 HP/s**, always on (D-056). Dungeon difficulty is balanced for a fresh level-1 Serf (D-054).

Growth (D-074–D-078, CONFIRMED): every level gained rolls each stat within a range, chosen by the server: the Serf's ranges for levels 2–5, then the class's ranges by its High/Mid/Low tier for each stat. Choosing a class gives a one-time bonus to its High stats. Leveling takes each stat partway; each class has a max per stat that only stat potions (from high-tier dungeons) reach. A level-1 Serf's stats (HP 20, DEF 0, the rest 10) reproduce the starting values above exactly. The tables and formulas are D-078. Since 8c-2 the combat stats are live: HP (max HP), Attack (shot damage), Dexterity (fire rate), Speed (movement), Defense (damage taken: hit × 40/(40 + DEF), D-121), Vitality (regen). MP and Wisdom are live since Phase 10a (max MP, and MP regen = WIS/10 per second, D-096).

## 7. Death and account persistence

### Confirmed direction

- Character permadeath is a core game pillar.
- A character that dies before dungeon completion does not receive completion rewards.
- A dead character's final lifetime EXP remains on the lifetime EXP leaderboard.
- A Resurrection Necklace Artifact is intended to preserve a character once; the exact rule is still to be confirmed (Phase 16).

### Confirmed item and reward rules (Phase 9)

- A serf carries only its **equipped** items; there is no bag (D-085). Death loses them (D-079).
- Unequipped items live in the account's **shared stash**, which survives death and serves every serf (D-085).
- **Gold** is account-wide and survives death; it comes from selling items (D-087).
- Stat potions not drunk at once wait in the account's **potion rack** (D-089).

- An account has **2 serf slots** to start; a dead serf frees its slot (D-061). More can be bought with gold, up to 10 (D-154).
- Drunk potions die with the serf; undrunk potions in the rack survive (D-118).

### Still open

- Gold upgrades (D-154): serf slots (2 → 10, 2,000 × n gold), stash space (20 → 100, +10 for 500 × n), potion rack space (20 → 60, +10 for 1,000 × n), bought in the Stash tab; they belong to the account and survive any death.
- The Resurrection Necklace's exact rule and its edge cases: Phase 16.

## 8. Equipment

Equipment slots (CONFIRMED, D-082):

1. Weapon
2. Class ability item
3. Head armor
4. Chest armor
5. Leg armor
6. Gloves
7. Ring 1
8. Ring 2
9. Necklace
10. Cape

Important correction: there is **one head armor slot**; do not add a separate cap/hat slot.

Weapon types (CONFIRMED, D-083):

- Sword
- Dagger
- Axe
- Bow
- Staff
- Wand
- Mace

Armor types (CONFIRMED, D-083; piece names D-091):

- Cloth
- Leather
- Plate

Accessories:

- Rings, necklaces, capes.
- Stat variants based on HP, MP, Attack, Dexterity, Speed, Defense, Vitality, and Wisdom.
- CONFIRMED (D-106): each ring, necklace, and cape has one of those as its **base stat** ("T5 Ring of Defense"), worth tier + 1 (×3 for HP and MP); never Luck. Any class can wear any of them.

Class restrictions (CONFIRMED, D-081, D-083): each class can use certain weapon types and one armor type; a classless Serf can use T0 weapons and armor and every accessory. Weapon damage is 27 + 4 × tier. Ability items are wearable only by their class (D-096).

### Weapon attacks (D-141)

Each weapon type attacks in its own way; the wand is the only long-range single shot:

- **Wand:** one fast bolt, the longest reach.
- **Bow:** one arrow that pierces every enemy in its line.
- **Staff:** a slow orb that bursts where it lands, hitting everything round it.
- **Sword:** a slash: an instant swing cutting everything in an arc in front of you.
- **Axe:** a heavy cleave: slower, wider, and further than the sword.
- **Dagger:** quick, narrow stabs straight ahead, the fastest melee weapon.
- **Mace:** a ground smash hitting everything all round you.

Melee weapons swing rather than shoot, slowly and heavily: a new character's sword swings once a second, each blow several times a wand bolt. On one target each comes close to the wand's damage.

## 9. Tiers, modifiers, Artifacts, and Shiny items

### Confirmed (Phase 16, D-152, D-153)

- **Tiered items** (T0–T10) are the dependable way to get stronger.
- **Artifacts** are a separate, rarer kind of item: **always stronger than any tiered item**. Each has T12 power (two tiers past T10) and **6 random rolls** (T10 has 5) of the usual sizes and rates, works like a normal item of its type, and adds a **special effect**. Its own name, no T number. Only the **five endgame dungeons** drop them: a reward chest there holds one **1 time in 500**, one of that dungeon's own (Frost Hollow, the Clockwork Vault, and Dragon's Roost have 5 each; the Abyssal Gauntlet and Stormspire 4 each). All **23** concepts below exist, adjusted to the weapon attacks of D-141; the exact effects are in D-153 and on each item. The same Artifact never stacks with itself.
- **Shiny** is purely visual: any item, Artifacts included, is Shiny **1 time in 2,000**; its name starts with "Shiny" and it shimmers gold.

The list below was the earlier draft (kept for history):

Prior draft:

- Ordinary gear tiers T0–T10.
- Artifacts are a separate special category with unique fixed effects.
- Item stats may be randomized independently from the fixed Artifact effect.
- Extra stat rolls start at T4 on every item (none at T0–T3), then 2, 3, 3, 4, 4, 5, 5 for T4–T10; each at most +3 (+9 HP and MP), always below an accessory's base (D-106).
- Stat modifiers may be positive or negative, **except Luck**: an item's Luck modifier is always exactly +1, at most one per item, never negative (D-067).
- Shiny chance was proposed at 1/2,000, independent of tier and stat rolls.
- Shiny status does not automatically grant an Artifact effect; Artifacts can also be Shiny.
- A T10 item with five favorable rolls and Shiny status is a top-end collectible target.
- Artifact drop chance was proposed at 1/1,000 but has not been confirmed as final.

These rates and modifier rules are balance proposals, not immutable requirements. Do not bake unapproved rates into scattered code; use centralized configuration and ask before locking them.

### Prior named Artifact concepts

- Axe: Doomrend, the World-Ender — spectral axes chain to nearby enemies.
- Sword: Excalibur, the Dawn's Judgment — consecutive hits build Radiance toward a piercing beam.
- Dagger: Whisper, the Unseen End — kills enable a brief shadowstep and empowered next attack.
- Bow: Artemis, the Moon's Pursuit — piercing arrows gain damage per additional enemy hit.
- Staff: Aetherion, the First Spell — singularity pulls enemies and explodes.
- Wand: Eternity, the Unbound Spark — charged hits produce seeking split bolts.
- Mace: Golgorr, the Mountain's Wrath — periodic ground slam and shockwave.
- Cloth: The Mantle of Creation — ability creates brief projectile protection.
- Leather: The Hide of the First Beast — projectile dodge grants a speed burst and empowers the next attack.
- Plate: Aegis of the Eternal King — a once-per-dungeon critical-health trigger grants a temporary shield, subject to final rules.
- Ring: The Ouroboros — kills restore small HP/MP amounts.
- Necklace: Resurrection Necklace — once-preservation concept.
- Cape: The Veil Between Worlds — brief intangibility/phase shift.

These effects must be reconciled with the 10-class roster (D-072) and latest design decisions before implementation.

## 10. Dungeons

Dungeon design is a mix of procedural assembly and handcrafted content:

- A library of handcrafted rooms can be assembled procedurally.
- Fixed handcrafted dungeons and unique/special dungeon modes are also possible.
- Generation must validate connectivity, reachable objectives, valid encounter order, and other structural constraints.
- Reproducible seeds should help reproduce generation bugs.
- Dungeon progression and formats may vary; do not assume every dungeon follows the same linear template.
- Enemies include different roles and dense waves.
- Major bosses use multiple phases, mechanics, and readable attacks.
- Dungeon access is open to characters who meet that dungeon's eligibility rules. CONFIRMED (D-107): the Goblin Warrens is open to every serf; once a serf completes it, every other dungeon is open to that serf at any level. Serfs of any level play together in one queue.
- Players may retreat freely through rooms they have already cleared.
- Rooms can be rushed (D-114): doors are open from the start, but every room you enter wakes and its goblins follow you. Only gated rooms (the Ambush hall; in the Stronghold also the Barracks) shut their doors until cleared. The exit portal opens when the boss dies.
- Each dungeon has its own loot pool (D-016); there are no pools by difficulty.
- The first dungeon should be gentle enough to teach core play.

### Goblin Warrens

- Procedural since Phase 11a (D-104): each run assembles its own Warrens from handcrafted rooms (rules in D-104); the original handcrafted map remains as seed 0. Since 11b it draws from 11 combat rooms, each with two enemy setups (D-105).

- Introductory dungeon, primarily aimed at levels 1–9.
- Target first-time clear: 3–5 minutes: about 5 minutes solo, about 3 minutes for a full party (D-047).
- A full simple level with several encounter rooms, then the boss (D-047).
- Geared veterans should be able to stomp it; difficulty is primarily gated by clear speed for them.
- Mostly linear with occasional branches.
- Enemies include melee, ranged, charging/throwing, and tougher roles.
- Goblin Warlord uses projectile patterns, reinforcements, and limited arena hazards.
- Rewards may include completion XP, gold, dungeon-specific potions, and equipment, but exact rates need confirmation.
- Each completing player rolls one reward chest per point of Luck (D-065, D-068): 1 chest for a fresh Serf, +1 for each equipped Luck item, no cap. Each chest is one item (D-080).
- Reward flow (D-086–D-088): each item goes to the shared stash, or onto the serf with **Equip now** when its class can use it. Hovering a reward compares it with what is equipped in that slot (stats up in green, down in red). A replaced item goes to the stash. When the stash is full the player must sell the new item or a stash item for gold (50% of reference value); an undecided reward is held by the server and that serf cannot start another dungeon until it is settled.
- Potion dungeons (not the Goblin Warrens) roll a stat-potion chance once per Luck point; a won potion is drunk at once by that serf or sent to the potion rack (D-089). Built (12h, D-118): the Goblin Stronghold gives a 20% chance per Luck point; each potion adds +1 to a stat (+5 HP or MP) for the serf's whole life, up to its max; no Luck potions. Like Realm of the Mad God (D-119): potions and level-ups add up to one max per stat, and a serf can drink at any level. Before a class the max is the Serf max (HP 32, MP 18, DEF 0, the rest 14); after, the class max. Drinking early works but wastes the free level-up gains that would pass the max. The 20-potion account rack survives death; a full rack holds the new potion and blocks that serf until you drink or pour one out.
- A character dying before completion receives no completion rewards.

### Goblin Stronghold

- Second tier of about five (D-108): the goblins' fortified home past the Warrens, aimed at levels 9–12, open once a serf has completed the Warrens (D-107).
- Procedural like the Warrens: the Stronghold gate, then 6 combat rooms (light, three medium, two heavy), then the War hall; 0–2 optional side rooms. About 6 minutes solo for a level-9 serf.
- Ordinary goblins in greater numbers; no general buff. Shamans (12e) strengthen goblins near them. Its boss is the Goblin Warchief in the War hall (12g, D-117).
- Loot T2–T4 (the first T4 drops, so the first extra rolls and Luck items); EXP base 160 up to level 12.

### Forgotten Crypt

- Third tier (D-120): an undead crypt for levels 12–15, open once a serf has completed the Warrens (D-107). Crypt gate, 7 combat rooms (light, three medium, three heavy), then the boss room; 0–2 side rooms. About 7 minutes solo for a level-12 serf.
- Loot T3–T5; EXP base 200 up to level 15; stat potions at 30% per Luck point.
- Undead hit harder than goblins (D-121): a skeleton's touch does 8, an archer's arrow 7.
- Built (12i): **skeletons** fall into a **bone pile** the first time they die and stand up again at half HP after 4 s unless you shoot the pile; **skeleton archers** loose two arrows at where you are heading; **sarcophagi** along the walls of the Ossuary and the Burial vault open for a second wave. Its boss is the Lich (12l).
- Built (12j, D-122): **ghosts** float through walls and fade out every few seconds (faded, they cannot hurt you or be hit); **necromancers** throw slow skulls and raise bone piles as whole skeletons, so shattering piles also starves them; **grave knights** carry a shield that stops your shots from the front and turns slowly, so circle round them, and they slam the ground in front after a 0.9 s warning.
- Built (12k, D-123): **cursed runes** in the Chapel, Embalming room, and Charnel pit glow red one column at a time and burst a second later, sweeping across the room and back, so you keep stepping over the wave; **spirit braziers** in the Catacomb, Burial vault, and Tomb of kings take turns sending slow blue-white fireballs across the room. Those rooms have 20% fewer skeletons and archers.
- Built (12l, D-125): **the Lich** in the Sanctum, the crypt's boss. It pours out a two-armed bullet spiral and calls skeletons from the sarcophagi. Below 60% and again below 30% it is warded behind three soul crystals (firing rings meanwhile); break them and it is stunned for 4 s. After the second ward its spiral speeds up and runes burst under you and around it.

### Tiers 4 and 5

- **The Ember Forge** (tier 4, D-130): a burning forge for levels 15–18, open once a serf has completed the Warrens. Forge gate, 7 combat rooms, then the boss room; about 7.5 minutes solo for a level-15 serf. Loot T4–T6 (the first T6); EXP base 240 up to level 18; stat potions at 40% per Luck point.
- Built (13a): **forge imps** that cut you off like skulkers but faster and harder; **ember casters** whose fireballs leave burning floor; **lava channels** across some rooms that burn you if you touch them, while enemies walk round them. The Lich stands in as the boss until the Forgemaster.
- Built (13b, D-132): **fire elementals** that rush you, flash yellow for 0.6 s, then explode for 14 (kill one during its flash and it doesn't); **magma golems**, slow and heavy, whose crust halves all damage except for 1.5 s every 6 s, when they glow bright orange and take double; **bellows-keepers** that never attack but heal nearby enemies 3% of their max HP every second (an orange ring), never themselves, each other, or bosses.
- Built (13c, D-133): **fire jets** along the north wall of the Bellows room, Chain gallery, and Great furnace: alternate nozzles glow orange, then shoot a beam of fire across the room (12), taking turns every 2 s; obstacles block them. **Slag spills** in the Ore store, Anvil hall, and Slag pit: molten boulders that land like falling boulders (10) and leave burning floor. Those six rooms have 20% fewer imps and casters.
- Built (13d, D-134): **the Forgemaster**, 14,000 HP, in the Forge heart. Its hammer slams (14 up close) send a shockwave ring across the arena with a gap to step through (12), and it fires spreads of molten bullets (9). Below 60% two magma golems come out of the forge doors; below 30% the floor plates burn (14) around a safe lane that moves across the arena, and it slams faster.
- **The Sunken Temple** (tier 5, D-135, PROVISIONAL numbers): a drowned temple for levels 18–20, the last of the first five dungeons. Drowned acolytes, tide callers that throw water bolts, fishfolk spearmen that charge, and eel-priests that tether you and pull you in (kill one while its tether shows to break it). Tide pools turn deep on a 9-second cycle and halve your speed. The Tide Priest sweeps its arena with tidal surges that have gaps to stand in, and calls whirlpools that drag you towards their core. Loot T5–T7; potions 50% per Luck point.
- **Endgame dungeons** (D-126, D-136): every dungeon after the first five is for level-20 serfs (the server checks it), with loot one tier higher each, up to T10 in the last.
- **Frost Hollow** (endgame 1, D-136, PROVISIONAL numbers): ice caves. Ice imps, ice wraiths that leave slowing frost behind them, yetis, frost archers; icicles that fall and leave frost. The Frost Wyrm breathes cones of frost, sweeps its tail round itself, and calls ice wraiths. Loot T6–T8.
- **The Clockwork Vault** (endgame 2, D-137, PROVISIONAL numbers): the first fixed map, the same every run so it can be learned. Shielded clockwork sentries, cog drones, floor turrets, and steel blade arms that sweep rooms while they fight. The Automaton's plating shrugs off most damage except while it overheats; it fires rifle bursts and turns a laser arm round itself. Loot T6–T8.
- **The Abyssal Gauntlet** (endgame 3, D-138, PROVISIONAL numbers): no rooms to cross: one arena and eight waves drawn from every earlier dungeon, each coming when you beat the last or after 45 s. Its braziers, runes, and slag switch on as the waves go. The last wave is the Warden of the Abyss, who spirals like the Lich, charges like the Warchief, and slams shockwaves like the Forgemaster. Loot T7–T9.
- **Stormspire** (endgame 4, D-139, PROVISIONAL numbers): a tower climbed floor by floor. Storm hawks dive at you, storm adepts throw fast bolts, gargoyles hit hard; lightning comes down where you stand; gusts of wind push you towards the walls. The Storm Caller calls lightning on everyone, then raises pylons that shield it and arc lightning between them; break them to stun it. Loot T7–T9.
- **Dragon's Roost** (endgame 5, the tenth dungeon, D-140, PROVISIONAL numbers): a volcanic peak with the hardest mix of everything so far, and fire drakes that lob burning bombs. The Elder Dragon breathes cones of fire that leave the floor burning, sweeps its tail, and beats its wings to blow you back; at half health it takes to the air, out of reach, while meteors rain down, then lands to finish the fight. The only dungeon with T10 loot.

### Toward 40 dungeons

- How they spread (D-126): the **first 5 dungeons cover levels 1–20**; **every dungeon after that is for level 20 and up**, an endgame dungeon for level-20 serfs.

- The user wants **at least 10 dungeons before the website alpha** (Phase 13) and **at least 40 before the Steam release** (D-124), the rest added in batches during the alpha (Phase 22) together with more item kinds and other content. How the 40 are spread (several per level band, endgame and special dungeons) is open question 24.

### Room mechanics (D-109)

Pace (D-111): in the intro dungeons enemies attack 1.5× less often and move 20% slower than first tuned, and each hit does 1.5× the damage, so the screen stays readable.

Rooms must not all be beatable by running in a circle, and difficulty should not rest on enemy numbers alone. Chosen mechanics: falling boulders (in place of spike traps, D-110), obstacles and cover, sweeping traps, slow or burning floor; slingers that lead their shots, flankers, bombers that leave fire, ambush holes. Intro dungeons use some of them.

- Built (12b): **leading slingers** (aim where you will be; drawn lighter): 1 in 3 in the Warrens, all in the Stronghold. **Falling boulders** (D-110, replacing spike traps): in rockfall rooms (Warrens Tunnel and Guard room; Stronghold also the Armory), while the room fights a boulder falls every 1.05 s, mostly anywhere on the floor, 1 in 4 near a player; its shadow grows for 1.2 s, then it lands (5 damage in the Warrens, 9 in the Stronghold, D-111). **Ambush holes**: the Ambush hall's second wave and the Barracks' reinforcements come out of holes in the walls, 2 every 4 s.
- Built (12c, D-112): **obstacles and cover**: rubble in the Collapsed passage, pillars in the Guard room, barricades in the Gatehouse, bunks in the Barracks. Solid both ways for movement and shots; goblins walk round them, slingers step aside for a clear throw, and a brute that charges into one is dazed for 1.5 s.
- Built (12d, D-113): **arrow traps** in the Stronghold's Gatehouse (slits glow, then a volley crosses the room with a gap of 3 slits to stand in, every 3.5 s; 6 damage; barricades shelter you) and **sludge** in the Fungus grotto (60% speed for players; goblins wade through).
- Built (12e, D-115): **Goblin skulkers** cut you off by running to where you are heading; **Goblin bombers** lob bombs that leave burning floor; **Goblin shamans** never attack but chant, making goblins near them hit 50% harder for 5 s (kill them first). Stronghold only.
- Built (12f, D-116): **fewer goblins** where rooms have a mechanic (Warrens 25%, Stronghold 30%, and 20% in the Stronghold's other rooms), so difficulty comes from the room, not the crowd.
- Built (12g, D-117): the **Goblin Warchief**, the Stronghold's boss, in a War hall with 4 pillars and 4 holes. Phase 1: an axe sweep in front of it (a red circle shows exactly where, 0.8 s ahead) and fans of 3 throwing axes. Below 66%: a charge (1 s warning) that dazes it for 2.5 s if it slams into a pillar or wall, and a war cry that calls skulkers out of the holes (at most 4). Below 33%: everything 25% more often, plus a ground slam ring of 20 slow shockwaves. Lure its charge into a pillar to get free hits.

## 11. Multiplayer and reward rules

- Maximum party size: ten players (D-012; was four).
- Players enter dungeons from the home screen (D-048, D-145): a standing left panel with the played serf (EXP bar, stats, gear) and the party (members, Invite, Leave, incoming invites), and the tabs Play, Serfs, Party, Stash, Potion rack, Leaderboards, and Settings. After a run they can quickly requeue for the same dungeon.
- Parties form through an open queue that fills a run with up to 10 queued players (D-051, D-012); a run accepts joiners for its first 15 seconds, then is locked (D-052). Friends party up by invite (Phase 14, D-142, D-143): invite an online player by their serf's name; they accept or decline (an invite lapses after 60 s). The first inviter leads; any member can invite; the leader can remove members; parties of up to 10 last across runs; a player who leaves or disconnects drops out, and the longest-standing member leads if the leader goes. Only the leader queues the party: everyone must be able to enter the dungeon (a refusal names who), and the party always shares a run (a new one, or an open one with room for all); players from the open queue may fill its empty places. If anyone leaves the queue or the party changes while waiting, the whole party leaves the queue (D-144, PROVISIONAL). No friends list or chat yet.
- Completion should feel rewarding: strong celebratory effects and a slot-machine-like reward chest (D-049). Death is abrupt and tragic: a stats screen about the serf's life, then return to choose a serf and dungeon (D-050).
- Browser and Steam desktop clients share the same game servers and can play together.
- Mixed-platform parties can enter the same dungeon instance and fight the same enemies/boss.
- Every player who completes a dungeon receives their own randomized reward results; rewards are individual rather than a single shared loot roll. The number of item rolls each player gets equals their own Luck (D-065).
- A player who dies before completion receives no completion rewards.
- Enemy HP scales by party size: × (1 + 0.5 × (players − 1)) (D-045, PROVISIONAL).
- Solo play should remain viable.
- Reconnect, disconnect, session ownership, and party-leader behavior require explicit rules (Phase 20). Today: one connection per account (T-042); a player who disconnects leaves the run and cannot rejoin it (D-052).

## 12. Economy and leaderboards

Confirmed in Phase 9 (D-085–D-087): a shared account stash and account money that survives death. Since D-157 money is **coins**: 1,000 Bronze = 1 Silver, 1,000 Silver = 1 Gold, 1,000 Gold = 1 Platinum, kept as one number of Bronze and shown as the non-zero coins; selling to the vendor became **Sell to Lord** at a fixed 10 × (tier + 1)² Bronze. **Tier 0 is free starter gear**: a new serf wears a Tier 0 Sword and leather armor; choosing a class offers the class's free Tier 0 set (Equip or No thanks); no dungeon drops Tier 0; the Exchange gives any Tier 0 item away without limit, and it cannot be listed. Since 2026-10-26: gold buys account upgrades (D-154), and the **Grand Serf Exchange** (D-155, D-156), in the spirit of RuneScape's Grand Exchange and Dark and Darker's marketplace, is the only place to sell to players. List a stash item or rack potion at a price (1 to 1,000,000 gold, up to 10 listings, no expiry), or place a **buy order** (an item, optional required rolls, the most you pay; the gold is set aside; up to 10; cancel refunds). Whichever came first sets the price: a listing at or under an order sells at once to the highest order at the order's price; an order at or over a listing buys the cheapest at its price; sellers can also Sell now to an order. The seller gets the price less a **5% fee** (destroyed). Everything bought waits in a **collection box** until collected. Browse filters by slot, type, tier (T0–T10 or Artifact), Shiny, usable class, and required positive rolls, sorted newest, cheapest (the default), or most expensive; buy orders are written with the same dropdowns. Every tier has its own card colour, Tier 0 grey (the worst) up to Tier 10, Artifacts orange; a name no longer carries its tier ("Sword", not "T5 Sword"): the tooltip shows "Tier 5" or "Artifact" under the name. Each kind of item (the same Artifact, the same tier and type, the same potion; Shiny apart) shows its average sale price over 24 hours, a week, a month, and all time. Item cards everywhere show just the name in its rarity colour, with the details on hover.

Prior economy direction:

- Persistent gold.
- Grand Serf Exchange marketplace for eligible gear/potions traded for gold.
- Sell to Lord (D-157): the Lord buys any item for a fixed 10 × (tier + 1)² Bronze (an Artifact 1,690), whatever its Luck, rolls, or Shine; Tier 0 is worth nothing (Discard).
- Shared stash and account upgrades may use gold.
- Shiny status and unique effects may affect collectible market value.
- Economy transactions must be server-authoritative and shared across platforms.

Confirmed leaderboard direction:

- One lifetime EXP leaderboard.
- EXP continues accumulating after level 20 even though no further levels or stat gains occur.
- Living characters display current accumulated lifetime EXP.
- Dead characters retain final EXP score.

Since Phase 15 there are **four leaderboards** (D-148), each the top 20, living and dead, worked out on the server from recorded data: **lifetime EXP** (all classes or one), **most clears**, **most enemies slain**, and **fastest clear** of each dungeon (each serf's best time, with its party size; a Solo only filter). Clear times count from Phase 15 on.

## 13. Technical requirements implied by the design

- One game, multiple clients: browser first, Steam desktop later.
- Shared account identity and persistent character data.
- Shared online backend and economy.
- Server-authoritative consequential state.
- Server validates movement/collision as needed, damage, HP/MP, ability cooldowns, enemy state, death/resurrection, inventory, loot, XP, gold, party state, and market transactions.
- Clients may predict presentation for responsiveness, but cannot decide consequential outcomes.
- Browser and desktop clients must use compatible network protocols and gameplay rules.
- Version compatibility, authentication, reconnects, and session conflicts must be considered before release.

## 14. First vertical slice (achieved)

The first vertical slice is complete (Phases 1–11): every step below is built except the desktop client (Phase 25). Current work and its order live in `docs/ROADMAP.md`.

1. The browser client shows the approved 1200×800 layout (D-131), fixed 240-pixel HUD, 960×800 gameplay viewport, 32×32 player (D-127), and player-centered camera with at least 300 world pixels of cardinal visibility.
2. A browser game loads.
3. Player can move and interact with the world.
4. One enemy demonstrates the chosen combat model.
5. A second client can connect and see synchronized play.
6. A tiny dungeon can be completed.
7. Completion and death rules can be tested.
8. Basic progression/persistence can be added only after the relevant rules are confirmed.
9. A packaged desktop client later connects to the same backend as browser clients.

Do not implement the entire content catalogue, marketplace, all classes, or full procedural generation before the core play loop is tested.

## 15. Design-change policy

Any rule not explicitly confirmed must be marked `PROVISIONAL` or `OPEN`. Ask the user when it blocks a meaningful implementation. Once the user decides, update this document and `DECISIONS_AND_OPEN_QUESTIONS.md`.
