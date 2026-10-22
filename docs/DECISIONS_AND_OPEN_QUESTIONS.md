# Serfdom — Decisions and Open Questions

Use this as the canonical decision register. Never mark a decision confirmed unless the user explicitly confirms it or it is clearly a direct statement of their requirement.

## Confirmed requirements

| ID    | Decision                                                                                                                                                                                                         | Status                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| D-001 | Serfdom is a browser-first multiplayer top-down action RPG.                                                                                                                                                      | CONFIRMED                                                |
| D-002 | A future Steam release should launch as a windowed desktop application.                                                                                                                                          | CONFIRMED                                                |
| D-003 | Browser and Steam players must be able to play together.                                                                                                                                                         | CONFIRMED                                                |
| D-004 | Browser and desktop clients share the same authoritative backend, accounts, progression, and economy.                                                                                                            | CONFIRMED                                                |
| D-005 | The current design target is 13 launch classes.                                                                                                                                                                  | CONFIRMED                                                |
| D-006 | Level 1 is Serf only; choose one of 13 classes at level 2.                                                                                                                                                       | CONFIRMED                                                |
| D-007 | Maximum character level is 20; no levels or stat increases after level 20.                                                                                                                                       | CONFIRMED                                                |
| D-008 | Lifetime EXP continues to be tracked after level 20 on one lifetime EXP leaderboard.                                                                                                                             | CONFIRMED                                                |
| D-009 | A dead character retains its final lifetime EXP score.                                                                                                                                                           | CONFIRMED                                                |
| D-010 | Dungeon rewards are individualized randomized rewards for each player who completes the dungeon.                                                                                                                 | CONFIRMED                                                |
| D-011 | A player who dies before dungeon completion receives no completion rewards.                                                                                                                                      | CONFIRMED                                                |
| D-012 | Party size is up to four players.                                                                                                                                                                                | CONFIRMED                                                |
| D-013 | Dungeon design combines procedural assembly with handcrafted/fixed or special modes.                                                                                                                             | CONFIRMED                                                |
| D-014 | Dungeon access is open to characters that meet the dungeon's eligibility rules.                                                                                                                                  | CONFIRMED                                                |
| D-015 | Players can retreat freely through rooms they have already cleared.                                                                                                                                              | CONFIRMED                                                |
| D-016 | Loot pools are specific to dungeon difficulty.                                                                                                                                                                   | CONFIRMED                                                |
| D-017 | Goblin Warrens targets 3–5 minutes for new players; geared veterans should be able to clear it quickly.                                                                                                          | CONFIRMED                                                |
| D-018 | Goblin Warrens is primarily aimed at levels 1–9, but eligibility rules can allow higher-level players.                                                                                                           | CONFIRMED                                                |
| D-019 | The game uses a hybrid auto-combat/dodging direction; exact controls and behavior are not yet fully specified.                                                                                                   | CONFIRMED at high level                                  |
| D-020 | There is one head armor slot, not a separate cap slot.                                                                                                                                                           | CONFIRMED                                                |
| D-021 | Claude should teach the user how to run and test each milestone and help debug based on concrete feedback.                                                                                                       | CONFIRMED                                                |
| D-022 | Player sized enemies target 16×16 pixel sprites; player characters target 16×16 pixels.                                                                                                                          | CONFIRMED                                                |
| D-023 | Visual direction is chunky, readable retro pixel art based on the user's sprite-sheet reference.                                                                                                                 | CONFIRMED                                                |
| D-024 | Use Pokémon Emerald as the requested palette reference, while creating original Serfdom assets rather than copying game sprites or characters. Exact palette entries must be verified before being called exact. | CONFIRMED direction; exact RGB list pending verification |
| D-025 | AI-generate art just in time as assets become necessary; use placeholders during early gameplay work.                                                                                                            | CONFIRMED                                                |
| D-026 | Initial desktop game container targets 960×640 CSS pixels.                                                                                                                                                       | CONFIRMED                                                |
| D-027 | Fixed 240×640 CSS-pixel HUD on the left; separate 720×640 CSS-pixel gameplay viewport on the right; no overlap.                                                                                                  | CONFIRMED                                                |
| D-028 | Camera follows and normally centers the player within the gameplay viewport, excluding the HUD.                                                                                                                  | CONFIRMED                                                |
| D-029 | Target at least 300 world pixels of visibility in every cardinal direction during normal gameplay; initial 1:1 CSS/world scale shows 360 horizontally and 320 vertically from player center.                     | CONFIRMED                                                |
| D-030 | Crisp pixel art without smoothing; Phaser zoom/display scale preserves visibility; source/world/CSS/device pixels are distinct.                                                                                  | CONFIRMED                                                |

## Technical direction — proposed, verify during setup

| ID    | Direction                                                                                                                              | Status                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| T-001 | Phaser + TypeScript for the shared game client, built with Vite and tested with Vitest.                                                | CONFIRMED direction (2026-10-22); versions pinned when installed in Phase 1 |
| T-002 | Electron or a comparable wrapper for the Steam desktop build.                                                                          | PROPOSED                                                                    |
| T-003 | WebSockets for real-time multiplayer.                                                                                                  | PROPOSED                                                                    |
| T-004 | Authoritative game server.                                                                                                             | STRONG ARCHITECTURAL REQUIREMENT                                            |
| T-005 | PostgreSQL for persistent data.                                                                                                        | PROPOSED                                                                    |
| T-006 | One canonical Serfdom account, with optional Steam account linking.                                                                    | PROPOSED; account UX unresolved                                             |
| T-007 | Node.js 24 LTS runtime, enforced via `.nvmrc`, `engines`, and `engine-strict`.                                                         | CONFIRMED (2026-10-22)                                                      |
| T-008 | npm with workspaces; one repository with `client/`, `server/`, `shared/` packages added only when their phase needs them.              | CONFIRMED (2026-10-22)                                                      |
| T-009 | Prettier (pinned exact version) formats the whole repo, including docs; LF line endings enforced via `.gitattributes`/`.editorconfig`. | PROVISIONAL default (2026-10-22); reversible                                |
| T-010 | ESLint is added in Phase 1 once TypeScript code exists. No `.env.example` until a configuration value or secret is actually needed.    | PROVISIONAL default (2026-10-22)                                            |

## Older draft material — do not silently treat as final

- An earlier design draft had ten named classes (Fighter, Barbarian, Rogue, Ranger, Wizard, Cleric, Bard, Warlock, Druid, Sorcerer), but the current requirement is 13 classes. Reconcile the full roster before implementing classes.
- An earlier draft placed class selection at level 10; this is superseded by the current level-2 class selection.
- An earlier combat proposal used manual aiming/firing and specific damage/defense formulas; the current high-level direction is hybrid auto-combat and dodging. Do not treat those old controls/formulas as final.
- Earlier item slots included weapon, class ability item, head armor, chest, legs, gloves, two rings, necklace, cape. One head armor slot is confirmed; validate the rest before locking equipment schema.
- Earlier draft rates of 1/1,000 Artifact drops and 1/2,000 Shiny chance are proposals, not confirmed final balance values.
- Earlier draft says two free character slots, gold persistence, stash persistence, equipment loss on death, and 50% vendor buyback. Reconfirm details before implementing persistent economy/death systems if not reaffirmed in current design discussions.

## Highest-priority questions

Ask these when needed by the current implementation phase, not all at once.

1. **13-class roster:** What are the exact names of all 13 launch classes, and which ability/identity belongs to each? The old ten-class draft is incomplete.
2. **Combat inputs:** What is the exact hybrid auto-combat model? For example, what auto-attacks, what does the player control, and how is dodging performed?
3. **Weapons:** Which weapon types are in the current launch design, and how do they map to classes?
4. **Class abilities:** Are class-specific ability items still part of the current design for all 13 classes? If yes, define the ability item and Artifact effect for each class.
5. **Death inventory rules:** Exactly what happens to equipped items, carried inventory, potions, stash contents, gold, and account upgrades on death?
6. **Dungeon rewards:** When does the reward roll occur, what qualifies as completion, and how are disconnects or late joins treated?
7. **Eligibility and party rules:** How is dungeon eligibility determined, and what happens when party members are at different levels?
8. **Stats/formulas:** What are the approved stat names, formulas, caps, and class growth rules?
9. **Economy launch scope:** Is the player marketplace required for the first public release or a later milestone?
10. **Account model:** Is email/password login needed initially, or should the prototype use a simpler temporary/local identity until account design is finalized?
11. **Minimum window size:** What is the smallest supported desktop browser window?
12. **Responsive layout:** How should the HUD and gameplay adapt below 960×640 without obscuring gameplay?
13. **Larger windows/fullscreen:** Should extra space show more world or use margins/fixed visibility?
14. **Camera edges:** Clamp to map boundaries or render beyond the playable map?
15. **Multiplayer visibility fairness:** Should larger displays be allowed more world visibility?

## How to add a decision

Append an entry using:

- **ID**
- **Date**
- **Question**
- **Decision**
- **Status:** CONFIRMED / PROVISIONAL / REJECTED
- **Consequences:** docs/code/tests affected

Do not erase old decisions; mark superseded entries clearly so future work can understand why a rule changed.
