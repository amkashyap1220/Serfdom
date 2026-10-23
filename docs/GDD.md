# Serfdom — Game Design Document

**Document status:** Living design document  
**Current design baseline:** Consolidated from available project decisions as of 2026-10-22  
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

- **Total game container:** 960×640 CSS pixels.
- **Fixed HUD on the left:** 240×640 CSS pixels.
- **Gameplay viewport on the right:** 720×640 CSS pixels.
- HUD and gameplay are separate regions. The HUD must not cover the world.
- These are CSS layout dimensions, not automatically the internal renderer resolution or device-pixel dimensions.

### Approved camera behavior

- Top-down camera follows the player, who is normally centered **inside the gameplay viewport**.
- Target visibility is at least **300 world pixels above, below, left, and right** of the player's center in normal gameplay.
- The gameplay viewport must therefore display at least 600×600 world pixels.
- At one CSS pixel per world pixel, a 720×640 viewport gives 360 world pixels to the left/right and 320 above/below.
- The HUD width is excluded from camera-center calculations.
- At map boundaries, camera clamping or alternative edge treatment must be chosen intentionally and tested.

### Rendering and UI

- Player and player-sized ordinary enemy source sprites are 16×16 pixels; larger enemies/bosses may use larger canvases.
- Keep source pixels, world pixels, CSS pixels, and device pixels distinct.
- Configure Phaser zoom/scale to preserve approved world-space visibility.
- Disable pixel-art smoothing; prefer integer scaling where practical.
- HUD stays fixed as the world scrolls and can house player stats, equipment, inventory, and other approved UI elements. Internal HUD arrangement remains OPEN.
- Wider windows may display additional world space; multiplayer visibility fairness needs evaluation.
- Minimum supported window size, compact layout, and mobile treatment remain OPEN.

### First-client acceptance

- Game container measures 960×640 CSS pixels at target desktop size.
- HUD measures 240×640; gameplay viewport measures 720×640, with no overlap.
- A 16×16 player placeholder renders crisply.
- Camera centers the player within gameplay, not the whole container.
- Debug world bounds confirm at least 300 world pixels visible in every cardinal direction.
- Browser resizing and map boundaries have documented, tested behavior.

## 2A. Visual direction and asset pipeline

### Confirmed art direction

- **Style reference:** chunky, readable retro pixel art resembling the user's supplied sprite-sheet reference: strong silhouettes, compact shapes, limited clusters of color, and crisp pixel edges.
- **Player-sized ordinary enemies:** baseline sprite canvas of **16×16 source pixels**.
- **Player characters:** baseline sprite canvas of **16×16 source pixels**.
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

- A new character is a **Serf at level 1 only**.
- At **level 2**, the player chooses one of **13 launch classes**.
- Maximum character level is **20**.
- There are no further levels or stat increases after level 20.
- Lifetime EXP continues to be tracked after the level cap and feeds a single lifetime EXP leaderboard.
- A dead character retains its final lifetime EXP score on the leaderboard.
- The Goblin Warrens is aimed primarily at levels 1–9, but access is based on dungeon eligibility rather than a blanket rule that only those levels may enter.
- Dungeon EXP is awarded on successful completion; a character that dies before completion receives no completion rewards.

### Design details still to resolve

- The exact 13 launch class names and final class roster are not fully present in this context package. Do not assume the earlier ten-class draft is the final roster.
- XP curve, exact per-level requirements, and whether any other sources of XP exist need explicit approval.
- Exact class stat caps and level-up stat growth need explicit approval.

## 4. Classes and abilities

The current requirement is 13 launch classes, with class selection at level 2. The prior design draft had ten classes and class-specific active ability items. That draft is useful as design material, but it must not be silently treated as the final 13-class roster.

### Prior class/ability concepts — provisional pending roster reconciliation

| Draft class | Ability item | Core concept                                                                              | Draft Artifact twist                                                                                    |
| ----------- | ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fighter     | Shield       | Guard: briefly reduce incoming damage or use a defensive bash; implementation unresolved. | Aegis of the Last Stand: blocked damage powers a shockwave, capped.                                     |
| Barbarian   | War Horn     | Battle Cry temporarily increases attack power.                                            | Horn of the Blood King: kills during the buff restore a small amount of health.                         |
| Rogue       | Cloak        | Vanish disrupts targeting and grants evasiveness.                                         | Veil of the Unseen End: leaves a decoy/shadow that draws attacks before bursting.                       |
| Ranger      | Quiver       | Volley fires a special arrow or small volley.                                             | Quiver of the Worldseeker: piercing special arrows trigger a secondary seeking arrow on elite/boss hit. |
| Wizard      | Spellbook    | Arcane Blast detonates area damage.                                                       | Aetherion's Codex: pulls enemies together before detonating.                                            |
| Cleric      | Tome         | Healing restores the user and nearby allies.                                              | The Tome of the First Dawn: healing also grants capped temporary shielding.                             |
| Bard        | Instrument   | Inspiration temporarily buffs nearby allies.                                              | The Worldsong: pulse destroys or deflects a limited number of nearby enemy projectiles.                 |
| Warlock     | Grimoire     | Curse marks enemies for increased damage.                                                 | The Black Testament: cursed kills leave fragments that restore mana and briefly extend nearby curses.   |
| Druid       | Totem        | Nature's Reach creates a targeted damaging or entangling area.                            | The Worldroot Totem: periodically roots enemies and empowers the next hit against them.                 |
| Sorcerer    | Scepter      | Chain Lightning jumps between enemies.                                                    | Eternity's Conduit: final strike creates a short-lived field that arcs between enemies entering it.     |

These concepts are not proof that the final class roster is ten classes. Ask the user to reconcile the prior draft with the current 13-class requirement before implementing the full roster.

## 5. Combat model

The current high-level direction is **hybrid auto-combat and skillful dodging**. Do not assume the earlier fully manual aiming/firing proposal is final without asking.

Confirmed high-level intent:

- Real-time combat.
- Enemy projectiles and readable attack patterns.
- Player positioning and dodging matter.
- Weapons/classes should feel distinct.
- Bosses use multiple phases and mechanics, not just larger health pools.
- Combat must remain responsive while server-authoritative.

Still unresolved:

- Whether normal attacks auto-fire, require input, or vary by weapon/class.
- Whether aiming is manual, automatic, or hybrid.
- Exact controls for movement, aiming, rotation, and abilities.
- Weapon attack identities and final weapon list.
- Damage, defense, attack-speed, range, and regeneration formulas.
- Ability MP costs, cooldowns, durations, ranges, and numerical effects.

Never implement a final combat formula or input scheme based only on a prior proposal. Ask if the missing decision materially affects the milestone.

## 6. Stats

Previously proposed stats:

- HP
- MP
- Attack
- Dexterity
- Speed
- Defense
- Vitality
- Wisdom

Prior meanings:

- HP: health.
- MP: resource for class abilities.
- Attack: outgoing damage.
- Dexterity: attack speed/firing rate.
- Speed: movement speed.
- Defense: incoming damage reduction.
- Vitality: health regeneration.
- Wisdom: mana regeneration.

These names and roles are prior design material; confirm any change against the latest decisions. Exact formulas, caps, class growth, and potion effects remain unresolved.

## 7. Death and account persistence

### Confirmed direction

- Character permadeath is a core game pillar.
- A character that dies before dungeon completion does not receive completion rewards.
- A dead character's final lifetime EXP remains on the lifetime EXP leaderboard.
- A Resurrection Necklace Artifact is part of the prior equipment concept and is intended to preserve a character once, subject to final rule confirmation.
- Account-level resources and eligible shared storage were previously planned to persist through character death.

### Prior persistence concepts requiring final reconciliation

- Gold persists through character death.
- Shared stash is account-wide and can transfer eligible items between characters.
- Two free character slots; additional slots purchasable with gold.
- Shared stash capacity and potion rack may be upgradeable.
- Equipped items are lost on death under normal rules.
- Handling of unequipped inventory, carried potions, and resurrection edge cases needs a definitive rule.

Do not implement death handling until the exact inventory-loss and reward rules for the target milestone are recorded as confirmed.

## 8. Equipment

Prior draft equipment slots:

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

Prior weapon types:

- Sword
- Dagger
- Axe
- Bow
- Staff
- Wand
- Mace

Prior armor types:

- Cloth
- Leather
- Plate

Prior accessories:

- Rings, necklaces, capes.
- Stat variants based on HP, MP, Attack, Dexterity, Speed, Defense, Vitality, and Wisdom.

Equipment restrictions and class proficiencies were previously drafted but are not final unless confirmed in the decision log.

## 9. Tiers, modifiers, Artifacts, and Shiny items

Prior draft:

- Ordinary gear tiers T0–T10.
- Artifacts are a separate special category with unique fixed effects.
- Item stats may be randomized independently from the fixed Artifact effect.
- T0 has zero stat rolls; intermediate tiers gain rolls progressively; T10 has five rolls.
- Stat modifiers may be positive or negative.
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

These effects must be reconciled with the final 13-class roster and latest design decisions before implementation.

## 10. Dungeons

Dungeon design is a mix of procedural assembly and handcrafted content:

- A library of handcrafted rooms can be assembled procedurally.
- Fixed handcrafted dungeons and unique/special dungeon modes are also possible.
- Generation must validate connectivity, reachable objectives, valid encounter order, and other structural constraints.
- Reproducible seeds should help reproduce generation bugs.
- Dungeon progression and formats may vary; do not assume every dungeon follows the same linear template.
- Enemies include different roles and dense waves.
- Major bosses use multiple phases, mechanics, and readable attacks.
- Dungeon access is open to characters who meet that dungeon's eligibility rules.
- Players may retreat freely through rooms they have already cleared.
- Loot is specific to dungeon difficulty.
- The first dungeon should be gentle enough to teach core play.

### Goblin Warrens

- Introductory dungeon, primarily aimed at levels 1–9.
- Target first-time clear: 3–5 minutes: about 5 minutes solo, about 3 minutes for a full party (D-047).
- A full simple level with several encounter rooms, then the boss (D-047).
- Geared veterans should be able to stomp it; difficulty is primarily gated by clear speed for them.
- Mostly linear with occasional branches.
- Enemies include melee, ranged, charging/throwing, and tougher roles.
- Goblin Warlord uses projectile patterns, reinforcements, and limited arena hazards.
- Rewards may include completion XP, gold, dungeon-specific potions, and equipment, but exact rates need confirmation.
- A character dying before completion receives no completion rewards.

## 11. Multiplayer and reward rules

- Maximum party size: ten players (D-012; was four).
- Players enter dungeons from a main menu (stash, serfs, leaderboard, dungeon select) and can quickly requeue for the same dungeon after a run (D-048).
- Parties form through an open queue that fills a run with up to 4 queued players (D-051); a run accepts joiners for its first 15 seconds, then is locked (D-052).
- Completion should feel rewarding: strong celebratory effects and a slot-machine-like reward chest (D-049). Death is abrupt and tragic: a stats screen about the serf's life, then return to choose a serf and dungeon (D-050).
- Browser and Steam desktop clients share the same game servers and can play together.
- Mixed-platform parties can enter the same dungeon instance and fight the same enemies/boss.
- Every player who completes a dungeon receives their own randomized reward results; rewards are individual rather than a single shared loot roll.
- A player who dies before completion receives no completion rewards.
- Enemy HP scales by party size; the exact formula remains unresolved.
- Solo play should remain viable.
- Reconnect, disconnect, session ownership, and party-leader behavior require explicit rules.

## 12. Economy and leaderboards

Prior economy direction:

- Persistent gold.
- Grand Serf Exchange marketplace for eligible gear/potions traded for gold.
- Lord's Vendor buys back eligible items at 50% of reference value.
- Shared stash and account upgrades may use gold.
- Shiny status and unique effects may affect collectible market value.
- Economy transactions must be server-authoritative and shared across platforms.

Confirmed leaderboard direction:

- One lifetime EXP leaderboard.
- EXP continues accumulating after level 20 even though no further levels or stat gains occur.
- Living characters display current accumulated lifetime EXP.
- Dead characters retain final EXP score.

Other leaderboard ideas (survival time, dungeon clears, bosses, fastest clears, etc.) are optional future candidates, not committed launch requirements.

## 13. Technical requirements implied by the design

- One game, multiple clients: browser first, Steam desktop later.
- Shared account identity and persistent character data.
- Shared online backend and economy.
- Server-authoritative consequential state.
- Server validates movement/collision as needed, damage, HP/MP, ability cooldowns, enemy state, death/resurrection, inventory, loot, XP, gold, party state, and market transactions.
- Clients may predict presentation for responsiveness, but cannot decide consequential outcomes.
- Browser and desktop clients must use compatible network protocols and gameplay rules.
- Version compatibility, authentication, reconnects, and session conflicts must be considered before release.

## 14. Current prototype goal

Build a small vertical slice before building the full game:

1. The browser client shows the approved 960×640 layout, fixed 240-pixel HUD, 720×640 gameplay viewport, 16×16 player, and player-centered camera with at least 300 world pixels of cardinal visibility.
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
