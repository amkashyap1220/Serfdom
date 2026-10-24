# Serfdom Implementation Roadmap

The roadmap is deliberately incremental. Each phase should leave the repository runnable and testable. Do not jump ahead simply because generating more code is possible.

## Where things stand

**Current phase: 13, in progress: 13a (the Ember Forge, D-130) done; 13b (fire elementals, magma golems, bellows-keepers, D-132) done; 13c (fire jets, slag spills, D-133) done; 13d (the Forgemaster, D-134) 13e (the Sunken Temple, D-135), and 13f (Frost Hollow, D-136) built; the rest of Phase 13 (dungeons 5–10, the EXP-pace and entry checks) is being built for one combined user test (the user's choice, 2026-10-24).** Updated 2026-10-24. The roadmap runs to 27 phases (D-124): systems and the first 10 dungeons through Phase 20, the website alpha at 21, growth to 40 dungeons during the alpha, then Steam; each phase below has its goal, tasks, acceptance criteria, and status.

| Phase | Name                                               | Status                                                       |
| ----- | -------------------------------------------------- | ------------------------------------------------------------ |
| 0     | Repository orientation and development environment | Complete                                                     |
| 1     | Playable local client skeleton                     | Complete                                                     |
| 2     | Movement, collision, and camera following          | Complete                                                     |
| 3     | Combat prototype                                   | Complete                                                     |
| 4     | Authoritative multiplayer foundation               | Complete                                                     |
| 5     | Shared combat and enemies                          | Complete                                                     |
| 6     | Dungeon vertical slice                             | Complete                                                     |
| 7     | Account and persistent data                        | Complete                                                     |
| 8     | Progression and permadeath                         | Complete                                                     |
| 9     | Equipment and rewards                              | Complete                                                     |
| 10    | Classes and class abilities                        | Complete                                                     |
| 11    | Dungeon variety and procedural assembly            | Complete                                                     |
| 12    | Dungeon tiers and the endgame loop                 | Complete                                                     |
| 13    | Ten dungeons: tiers 4 and 5 and more               | **In progress:** 13a–13c done; 13d onward built for one test |
| 14    | Partying up                                        | Not started                                                  |
| 15    | Home screen, HUD, minimap, and leaderboards        | Not started                                                  |
| 16    | Rare loot                                          | Not started                                                  |
| 17    | Economy and account systems                        | Not started                                                  |
| 18    | Onboarding and settings                            | Not started                                                  |
| 19    | Production hosting                                 | Not started                                                  |
| 20    | Accounts, sessions, and player safety              | Not started                                                  |
| 21    | **Website alpha**                                  | Not started                                                  |
| 22    | Alpha content: toward 40 dungeons                  | Not started                                                  |
| 23    | Presentation: art and sound                        | Not started                                                  |
| 24    | Beta polish                                        | Not started                                                  |
| 25    | Desktop wrapper and cross-play proof               | Not started                                                  |
| 26    | Steam integration                                  | Not started                                                  |
| 27    | Steam launch                                       | Not started                                                  |

When a slice or phase finishes, update this table, the phase's Status line, `docs/WORK_LOG.md`, and the README status in the same commit.

## Phase 0 — Repository orientation and development environment

**Goal:** Know what is in the repository and make the local environment reproducible.

Tasks:

- Inspect the repository before changing files.
- Check available Node.js/package-manager versions and Git state.
- Choose and document a package manager and supported runtime version.
- Create or verify `.gitignore`, `.editorconfig`, formatting/linting configuration, and `.env.example` if needed.
- Add a minimal README with exact setup/run/test instructions.
- Do not add secrets or real credentials.
- Choose a lightweight, understandable project structure.

Acceptance:

- A clean clone can be set up by following the README.
- Git status is understood and no secret files are tracked.
- The available checks and their commands are documented.

Ask the user if a significant framework or deployment choice is needed. Do not ask about trivial reversible preferences.

Status: **complete** (2026-10-22): Node 24, npm workspaces, Prettier, and the README setup (T-007–T-010).

## Phase 1 — Playable local client skeleton

**Goal:** A browser page loads the approved game layout with a 16×16 player placeholder and a testable camera.

Candidate stack: Phaser + TypeScript, pending repository inspection and confirmation.

Tasks:

- Initialize the browser client and show a simple scene.
- Build a 960×640 CSS-pixel game container with a fixed 240×640 left HUD and a separate 720×640 gameplay viewport.
- Render a 16×16 source-pixel player placeholder.
- Set up a world-coordinate grid/debug overlay and initial camera centered on the player within gameplay.
- Configure crisp pixel rendering and a camera view of at least 600×600 world pixels.
- Add formatting, type checks, and minimal test setup as appropriate.
- Document run/check commands.

Acceptance:

- [ ] Game loads without unexpected console errors.
- [ ] Container is 960×640 CSS pixels at target desktop size.
- [ ] HUD is 240×640 and gameplay viewport 720×640, with no overlap.
- [ ] Player placeholder is 16×16 source pixels and renders crisply.
- [ ] Camera centers on player within gameplay viewport, not total container.
- [ ] Debug world bounds show at least 300 world pixels in each cardinal direction.
- [ ] Resizing behavior is observed/documented, without HUD overlap.
- [ ] Claude provides exact run, verification, troubleshooting, and feedback steps.

Do not add accounts, database, final art, classes, or marketplace.

Art policy: use placeholders initially. Player and player-sized ordinary enemies use 16×16 source pixels; Pokémon Emerald is a palette reference only. Generate original assets just in time. Minimum supported window size and compact/mobile layout remain OPEN.

Status: **complete** (2026-10-22; the user passed the manual checks). Small-window behavior stays PROVISIONAL (T-012) until Phase 18.

## Phase 2 — Movement, collision, and camera following

**Goal:** The player moves through a test world while the camera follows and preserves approved visibility.

Tasks:

- Implement the user-approved movement/control model.
- Normalize diagonal movement where applicable.
- Add walls/obstacles and collision; keep movement logic independently testable.
- Make the camera follow and normally center the player within the 720×640 gameplay viewport.
- Maintain at least 300 world pixels of visibility in each cardinal direction in normal play.
- Keep the 240-pixel HUD fixed and separate from the world camera.
- Decide and test camera behavior at map edges.
- Test browser resizing and crisp sprite rendering while moving.

Acceptance:

- [ ] Approved movement directions and diagonal speed behave correctly.
- [ ] Player cannot pass through blocking obstacles.
- [ ] No unintended sticking or teleporting.
- [ ] Camera follows and centers within gameplay, excluding HUD.
- [ ] HUD remains stationary while world scrolls.
- [ ] World-space visibility matches the approved camera target.
- [ ] Map-edge and resize behavior is intentional and documented.
- [ ] Pixel art remains crisp during movement.
- [ ] Claude provides manual tests for movement, collisions, camera, boundaries, HUD, and resize.

Blocking questions: confirm final movement controls, map-edge treatment when needed, and smaller-window behavior before finalizing responsive scaling.

Status: **complete** (2026-10-22): WASD, instant movement, no camera clamping (D-031–D-033), Q/E view rotation (D-040).

## Phase 3 — Combat prototype

**Goal:** Validate the intended hybrid auto-combat and dodging loop against one enemy.

Tasks:

- Confirm the control and attack model with the user.
- Add one simple enemy and a readable attack pattern.
- Add hit feedback, damage/health, and death/respawn behavior for the prototype only, clearly separating this from final permadeath rules.
- Add automated tests for deterministic damage/range/cooldown rules once defined.

Acceptance:

- Player can engage the enemy using the approved input model.
- Enemy attacks are readable and avoidable.
- Damage and defeat behavior match documented rules.
- Tests cover at least normal hits and one edge case.

Do not invent final balance formulas. Use clearly labeled prototype values only after the user approves or agrees to a temporary test assumption.

Status: **complete** (2026-10-22): a target dummy, three fire modes (now four, D-099), ring attacks, prototype death (T-018, T-019).

## Phase 4 — Authoritative multiplayer foundation

**Goal:** Two browser clients connect to one server and see a consistent shared world.

Tasks:

- Add a small WebSocket-based authoritative server.
- Define typed client/server messages.
- Validate incoming messages and reject invalid input.
- Synchronize player presence and movement.
- Handle disconnect cleanup.
- Add basic server logging that avoids sensitive information.

Acceptance:

- Two browser tabs/devices can connect.
- Each sees the other player.
- Invalid messages are rejected safely.
- Disconnecting a client cleans up its session.
- The server, not either client, owns the canonical multiplayer state.

Do not add public matchmaking or production-scale infrastructure yet.

Status: **complete** (2026-10-22): Node + `ws` server, server-owned movement, delay under 100 ms on localhost (D-042, T-026).

## Phase 5 — Shared combat and enemies

**Goal:** Multiplayer clients interact with the same server-authoritative enemy and combat state.

Tasks:

- Move consequential health/damage/enemy state to the server.
- Define projectile and attack resolution.
- Validate rate limits, cooldowns, range, and action eligibility.
- Add automated tests for both valid and invalid client actions.
- Handle simultaneous attacks deterministically enough for the chosen model.

Acceptance:

- Both clients see consistent enemy health and defeat state.
- Client-side tampering cannot award arbitrary damage or rewards.
- Combat tests pass.
- Manual two-client test steps are documented.

Status: **complete** (2026-10-22): the server decides every hit (D-043, D-044); two-client checklist passed.

## Phase 6 — Dungeon vertical slice

**Goal:** A small, completable dungeon demonstrates the intended loop.

Tasks:

- Implement a small handcrafted layout first.
- Add an entrance, a few encounters, and one simple boss/exit.
- Add clear completion and failure states.
- Ensure death before completion yields no completion rewards.
- Test individual reward results once rewards are defined.
- Add deterministic seeds only when procedural generation begins.

Acceptance:

- A player can enter, fight, complete, and leave the test dungeon.
- A death before completion grants no completion rewards.
- Multiplayer players share encounter state.
- Individual rewards are rolled per qualifying completing player.

Status: **complete** (2026-10-22): menu, open queue, the Goblin Warrens with the Warlord, portal, per-player rewards; tuned in 6d (T-040).

## Phase 7 — Account and persistent data

**Goal:** Characters and accounts survive a server restart.

Tasks:

- Confirm authentication and account rules.
- Select a persistence layer (PostgreSQL is the current proposal).
- Design schema/migrations.
- Persist account, character, EXP, inventory, and gold only after their rules are clear.
- Add authorization and transaction tests.

Acceptance:

- Data survives a server restart.
- One account cannot access another account's characters.
- Invalid inventory/economy updates are rejected.
- Migrations and local database setup are documented.

Do not store passwords in plaintext or put secrets in source control.

Status: **complete** (2026-10-22): email + password accounts and serfs in PostgreSQL 17 (D-058–D-064).

## Phase 8 — Progression and permadeath

**Goal:** Implement the classless Serf (levels 1–4), permanent class choice at level 5 (D-073), level cap 20, lifetime EXP, and approved death rules.

Tasks:

- Class roster: 10 classes (D-072).
- Implement progression formulas only after approval.
- Implement death, equipment loss, account persistence, and any resurrection exception according to confirmed rules.
- Preserve dead characters' final lifetime EXP on the single lifetime EXP leaderboard.
- Add the Luck stat (D-065, D-066): a level-1 Serf has 1 Luck; leveling and class choice never change it.
- Test cap behavior and post-cap EXP.

Acceptance:

- Levels 1–4 are a classless Serf.
- Class selection occurs at level 5, is permanent, and is required before the next dungeon.
- Level 20 is the cap; no further levels or stat gains occur.
- Lifetime EXP can continue accumulating after cap.
- Death and rewards match the confirmed rules.
- A new Serf has 1 Luck, and Luck stays the same through every level and class choice.

Status: **complete** (2026-10-23; user passed every 8a–8d checklist): every acceptance item is met for the rules confirmed so far: levels 1–4 classless and class at 5 (8b), cap and post-cap EXP with no stat gains past 20 (8a, 8c, 8d tests), permadeath with no completion rewards and the final EXP kept on the leaderboard (7b, 8a), Luck 1 that levels and classes never change (8d). Not in Phase 8 because the things they apply to do not exist yet: equipment loss on death, gold, the Resurrection Necklace, and Luck's chest count (Phase 9). Their death rules (open question 5) must be confirmed before Phase 9 implements item loss.

## Phase 9 — Equipment and rewards

**Goal:** Establish a small equipment loop before expanding the catalogue.

Tasks:

- Confirm equipment slots, weapon/armor categories, and class restrictions.
- Implement a small representative subset of items.
- Centralize tier/stat/drop configuration.
- Implement per-player randomized completion rewards: each completing player rolls one reward chest per point of Luck (D-065, D-068), replacing the Phase 6 single placeholder roll (T-039). Luck counts equipped items only; no cap.
- Shared account stash (moved here from Phase 12, D-085); a serf carries only equipped items.
- Reward flow (D-086–D-088): to the stash, or Equip now with a stat comparison on hover; a replaced item goes to the stash; a full stash forces selling the new item or a stash item for gold; undecided rewards are held server-side and block that serf's next dungeon.
- Account gold and selling to the vendor (50% of reference value, D-087).
- Document the potion flow (D-089: drink now or potion rack, one roll per Luck point); build it with the first potion dungeon.
- Add the Luck item modifier (D-067, D-068): exactly +1, at most one per item, never negative; any item that can roll stats can roll it, Artifacts included.
- Add tests for drop eligibility, random roll bounds, and inventory ownership.

Acceptance:

- Equipment can be obtained and equipped according to rules.
- Rewards reach the stash or the serf exactly once; nothing is lost when the stash is full (the player must sell first), and a pending reward survives a disconnect.
- Selling pays the right gold once; gold and the stash survive the serf's death.
- Each completing player receives individual reward chests, one per Luck point (1 for a fresh Serf, +1 per equipped Luck item); carried but unequipped Luck items add nothing.
- No item can ever have a negative Luck modifier or more than +1 Luck (tested, including generated items).
- A player dying before completion receives no completion rewards.
- Invalid or duplicated item ownership is prevented.

Status: **complete** (2026-10-23; closed by the user after the 9b checklist passed): every acceptance item is met and tested — equip rules (9b), rewards exactly once with nothing lost and a held reward surviving a reconnect (9a; reconnect test added in the review), selling once for the right gold with gold and stash surviving death (9a), one chest per worn Luck point and none for Luck in the stash (test added in the review), Luck only 0 or +1 on 20,000 generated items, no rewards on death, and ownership checks (other accounts, worn items, sell once). Not built, by decision: stat potions (D-089, first potion dungeon), Shiny items and Artifacts (later phases), weapon attack styles (later slice).

## Phase 10 — Classes and class abilities

**Goal:** Implement the confirmed launch class roster and signature abilities.

Tasks:

- Class names and concepts: the 10 classes of D-072 (GDD §4).
- Define class ability items and Artifacts without assuming the older ten-class draft is final.
- Add one class at a time behind tests.
- Keep ability definitions/configuration separate from rendering.
- Test costs, cooldowns, targeting, and invalid activations once specified.

Acceptance:

- All implemented classes match approved documentation.
- The server validates ability use.
- No unapproved mechanics are silently introduced.

Status: **complete** (2026-10-23; closed by the user after the 10d checklist passed): all ten class abilities match D-092–D-102 (GDD §4 table updated in the review); the server checks the worn item, MP, cooldown, and range, refuses malformed targets, and a dead player casts nothing (test added in the review); every number was approved per slice. Not built, by decision: the Artifact twists, moved to the rare loot phase (D-103; Phase 16 since D-124).

## Phase 11 — Dungeon variety and procedural assembly

**Goal:** Expand from a tiny handcrafted test to reusable room-based dungeons.

Status: **complete** (2026-10-23; closed by the user after the 11c checklist passed): 11a (procedural Warrens, seeds), 11b (11-room pool, two setups each), 11c (entry rules, D-107). Generated layouts pass validation (2,000 seeds, plus a wall-leak flood fill); any layout replays from its seed (`DUNGEON_SEED`, same seed same map); fixed dungeons remain (seed 0, the Training Yard); loot rolls from the run’s own dungeon pool (Warrens T0–T2 tested); queue requests for hidden fixtures are refused; free retreat through cleared rooms tested in the review. Loot pools are per dungeon only, with no pools by difficulty (D-016, clarified by the user), so there is no 11d. The server test of a locked listed dungeon waits for Phase 12's first new dungeon.

Tasks:

- Build a library of handcrafted rooms.
- Assemble rooms procedurally where appropriate.
- Preserve fixed and special dungeon formats where designed.
- Validate connectivity, reachability, encounter ordering, and exits.
- Make seeds reproducible for debugging.
- Implement open access for qualifying characters and free retreat through cleared rooms.
- Decide and implement dungeon entry rules (open question 7, D-014, D-018): who may enter which dungeon, and how a party with different levels is handled.
- Give each dungeon its own loot pool (D-016).

Acceptance:

- Generated dungeons pass structural validation.
- A reported bad layout can be reproduced with a seed.
- Fixed/special dungeons remain possible.
- Dungeon-specific loot pools are respected.
- Entry rules are enforced by the server, including a tampered queue request.

## Phase 12 — Dungeon tiers and the endgame loop

**Goal:** Make the real grind exist (GDD §3: levels 1–20 are quick; the long game is stat potions and rare drops from high-tier dungeons).

Status: **complete** (2026-10-24; acceptance review passed, the user closed it). 12a (the Goblin Stronghold, D-108), 12b (leading slingers, falling boulders, ambush holes, D-109–D-111), 12c (obstacles and cover, D-112), 12d (arrow traps and sludge, D-113), rushing with gated rooms (D-114), 12e (skulkers, bombers with burning floor, shamans, D-115), 12f (fewer goblins per room, D-116), 12g (the Goblin Warchief, D-117), 12h (stat potions and the potion rack, D-118), 12i (the Forgotten Crypt with skeletons, archers, and sarcophagi, D-120), 12j (ghosts, necromancers, grave knights, D-122), 12k (cursed runes and spirit braziers, D-123), and 12l (the Lich, D-125) built: the Forgotten Crypt is complete. Next: the Phase 12 acceptance review.

Tasks:

- Add a second and third dungeon above the Goblin Warrens (tiers 4 and 5 and more dungeons are Phase 13, D-124), each with its own level range, enemies, boss, and loot tiers (designs drafted for the user's approval, one dungeon at a time).
- New enemy roles and boss mechanics, readable and tested like the Warlord.
- Room mechanics so rooms cannot all be beaten by running in a circle (D-109): traps, obstacles, floors, and enemies that punish circling.
- Stat potions and the account potion rack (D-089, D-075): potion dungeons roll the potion chance once per Luck point; drink at once or send to the rack; potions raise a stat up to the serf's max (the class max, or the Serf max before a class, D-119).
- EXP from the new dungeons fits the approved curve (less EXP above a dungeon's range, D-071).

Acceptance:

- Each new dungeon can be completed solo and by a party, and its loot and EXP match its approved tables.
- The server refuses a serf that has not completed the Goblin Warrens when it queues for a new dungeon, including a tampered queue request (D-107; the first listed non-Warrens dungeon makes this testable end to end).
- Potions are granted exactly once per roll, never above the serf's max (D-119), and survive death in the rack.
- The party clear is checked with two players in the Stronghold and the Crypt (D-126).
- The server decides every potion, drop, and EXP award.

## Phase 13 — Ten dungeons: tiers 4 and 5 and more

Status: in progress. 13a (the Ember Forge, dungeon 4: levels 15–18, forge imps, ember casters, lava channels, D-130) done; 13b (fire elementals, magma golems, bellows-keepers, D-132) done; 13c (fire jets and slag spills, D-133) done; 13d (the Forgemaster, D-134) built. The user chose (2026-10-24) to have the rest of Phase 13 built and tested together: 13e the Sunken Temple (dungeon 5), 13f–13j the endgame dungeons 6–10, 13k the EXP-pace and entry checks; each committed locally, pushed after the user's test.

**Goal:** At least **10 dungeons** before the alpha (the user, D-124): tiers 4 and 5 for levels 15–20, which finish the first five dungeons' ladder from level 1 to 20, then **five endgame dungeons for level 20 and up** (D-126). Three exist (the Warrens, the Stronghold, the Crypt).

Tasks:

- Draft tier 4 (about levels 15–18) and tier 5 (about levels 18–20), one dungeon at a time, for the user's approval: theme, level range, rooms, enemies, room mechanics, boss, EXP base, loot tiers, and potion chance. The ranges here are placeholders until each draft is approved.
- Draft dungeons 6–10, the first endgame dungeons, all for level 20 and up (D-126): how each one differs (enemies, mechanics, loot, a special format, D-013) is drafted per dungeon.
- Build reusable building blocks along the way (D-126): enemy roles, room mechanics, and boss patterns defined so new dungeons can recombine them, so most of Phase 22's dungeons are new mixes rather than new code.
- Loot continues upward (T5 and above), so the top tiers' items, including the T10 chase of GDD §9, become reachable.
- Check the whole EXP path against D-071: progressing through the five tiers reaches level 20 in about five dungeons' worth of clears.
- Decide with the user whether higher tiers need any entry rule beyond D-107.

Acceptance:

- At least 10 dungeons are listed; each can be completed solo and by a party, and its loot, EXP, and potions match its approved tables.
- A serf progressing through the tiers reaches level 20 at about the pace D-071 describes (measured by simulation from the real formulas).
- The server decides every drop, potion, and EXP award, and enforces the entry rules, including a tampered queue request.

## Phase 14 — Partying up

**Goal:** Friends can play together on purpose, not only through the open queue (the user, D-124).

Tasks:

- Draft for approval: how a party forms (invite by serf name, a party code, or both), who leads it, and how it queues for a dungeon together, with the open queue still available.
- A party's members enter the same run together; the 15-second join window and the 10-player cap (D-012, D-052) still apply.
- Decide whether launch needs a friends list or chat (open question 22); chat would need moderation (Phase 20).
- Mixed-level parties follow the entry rules (D-107).
- Party screens stay minimal here (invite, accept, leave, who is in the party); their final look comes with the home screen in Phase 15 (D-126).

Acceptance:

- Two players who invite each other always land in the same run.
- A tampered invite (to a stranger, a full party, a locked dungeon) is refused by the server.
- A party member who disconnects or leaves is handled as the confirmed rules say.

## Phase 15 — Home screen, HUD, minimap, and leaderboards

**Goal:** The screens a player lives in are final, not placeholders (the user, D-124).

Tasks:

- Finalize the home (main menu) layout: serfs, stash, potion rack, dungeons, leaderboards, party, and settings, drafted for approval; this polishes Phase 14's minimal party screens (D-126).
- A real player HUD in the 240×800 panel (D-131); the debug readout moves behind a toggle.
- A minimap: how much it shows (rooms visited, the whole layout, other players, the portal) and where it sits without covering gameplay, drafted for approval.
- More leaderboards than lifetime EXP, chosen with the user (GDD §12).

Acceptance:

- The home screen matches the approved layout and every tab works from it.
- The minimap and HUD never cover the 960×800 gameplay viewport and match the server's state (rooms, players, portal).
- Every leaderboard is computed on the server from recorded data and cannot be inflated by a client.

## Phase 16 — Rare loot

**Goal:** The collectible chase: Artifacts and Shiny items, in place for the alpha so the economy has rare things to trade (D-124). New item kinds beyond base tiers and Artifacts come during the alpha (Phase 22).

Tasks:

- Reconcile the item Artifacts (GDD §9) and the class ability Artifact twists (GDD §4) with the 10-class roster, then draft each effect for approval.
- Resurrection Necklace: the exact once-preservation rule (GDD §7) confirmed before building.
- Shiny items: confirm the chance (1/2,000 is only a proposal) and what Shiny shows.
- Weapon attack styles (deferred from Phase 9): each weapon type fires its own way, drafted for approval.
- All rates in central configuration, never scattered.

Acceptance:

- Every Artifact effect matches its approved description and is tested, including caps.
- Drop rates match configuration over many simulated rolls.
- A Resurrection Necklace saves a serf exactly once under the confirmed rule.

## Phase 17 — Economy and account systems

**Goal:** The player-driven economy, working before the alpha (the user: "a huge part of this game", D-124). The shared stash, gold, and selling to the vendor arrived in Phase 9 (D-085–D-087); this phase adds the marketplace, buying, and upgrades.

Tasks:

- Confirm the marketplace's launch scope (open question 9), item eligibility, pricing, and fees.
- Account upgrades bought with gold: more serf slots (D-061), a bigger stash (D-090), a bigger potion rack; prices drafted for approval. Decide what happens to them on death (open question 5).
- Implement atomic, server-side transactions.
- Test simultaneous trades and duplicate/negative balance exploits.
- Ensure browser and desktop users use the same economy.

Acceptance:

- A trade cannot duplicate an item or gold.
- Failed transactions leave both sides unchanged.
- Shared storage works across characters on one account.
- An upgrade is paid for exactly once and applies to the whole account.
- Economy behavior is identical across platforms.

## Phase 18 — Onboarding and settings

**Goal:** A new player can learn the game without help, and every player can adjust it to their setup (D-124).

Tasks:

- First-run flow: what a new account sees from registering to its first Warrens clear (a short tutorial room, hints, or both, drafted for approval).
- A settings menu: key binds (WASD, Q/E/Z, T, Space, R today), volume if sound exists, and the fire mode names (D-099 names are PROVISIONAL).
- Decide and build window-size behavior: minimum size, smaller windows, larger windows and fullscreen, and whether a bigger screen may show more of the world (open questions 11–13, 15).
- Accessibility basics: readable text sizes, colour choices that do not rely on red/green alone, and a check of the busiest fights for readability.
- Settings are stored per account or per device (decided with the user).

Acceptance:

- A tester who has never played reaches and completes their first Warrens run using only what the game shows them.
- Every rebound key works in every screen and cannot bind two actions to one key.
- The 1200×800 layout (D-131), the 240-pixel HUD, and camera visibility (at least 300 world pixels each way) hold at every supported window size; the behavior outside that range is documented and tested.

## Phase 19 — Production hosting

**Goal:** The game runs on a real server that strangers can reach safely (D-124).

Tasks:

- Choose hosting for the game server and PostgreSQL, and a domain, with costs explained; nothing paid is set up without the user's approval.
- wss:// (TLS) for every non-local connection (T-042) and HTTPS for the client.
- Automatic checks on every push (`npm run check` in CI) and a repeatable deploy from a clean build.
- Database backups on a schedule, and a tested restore.
- Server logs, uptime and error monitoring without private data (crash reporting or analytics only if open question 23 approves them).
- A protocol and client update policy: what a player with an old client sees after a deploy, and how a deploy treats runs in progress.
- Secrets only in the host's environment; `.env.example` stays placeholders.

Acceptance:

- A clean deploy from the repository brings up a working game that two players on different networks can play together.
- A backup is restored into a fresh database and the game runs on it.
- An old client is refused with a clear message after a protocol change.
- Every check runs automatically on each push, and a failing check is visible.

## Phase 20 — Accounts, sessions, and player safety

**Goal:** Accounts and the community are safe to open to the public (D-124).

Tasks:

- Choose an email provider; add email verification and password reset (D-060).
- Disconnect, reconnect, session ownership, and party rules (GDD §11), confirmed and tested; reward timing for disconnects and late joiners (open question 6).
- An offensive-name filter for serf names (T-044).
- Account deletion and a copy of a player's own data on request; a privacy policy and terms of service (drafted for the user; not legal advice).
- Admin tools: look up an account or serf, ban or suspend, restore a lost item, with every admin action logged.
- A security review of every message handler and database write, and per-account abuse limits.
- Moderation for whatever social features exist by then (Phase 14), such as reporting a player.

Acceptance:

- A forgotten password can be reset by email, and an unverified email is handled as decided.
- A reconnecting player gets what the confirmed rules say, and a disconnect never loses or duplicates a reward.
- A banned account cannot log in, and an admin action shows in the log.
- A deleted account's personal data is gone, while the leaderboard keeps only what the policy allows.

## Phase 21 — Website alpha

**Goal:** Serfdom is playable by the public on its website, labelled "alpha" (the user, D-124). It opens with at least 10 dungeons, the economy, Artifacts, and base loot.

Tasks:

- Closed playtest first: invite a small group, give them a simple way to report bugs and feedback.
- Measure clear times, deaths, and EXP pace in every dungeon against their targets (D-047, D-071, D-108, D-120), and tune party scaling (D-045, PROVISIONAL).
- Load and soak testing: the most players and runs one server must hold, snapshot bandwidth (T-027), and a long run without leaks.
- Fix what the playtest finds, decide with the user what blocks opening, then open the alpha to the public.
- The alpha's ground rules, decided with the user: whether progress may be wiped before Steam, and how that is announced (open question 26).

Acceptance:

- Every dungeon's measured clear time is within its target, or the target was changed by the user.
- The server holds the agreed player count for the agreed time without errors or growing memory.
- Every bug marked as blocking is fixed and has a regression test.
- Anyone can register and play on the public site, and the alpha label and its rules are shown.

## Phase 22 — Alpha content: toward 40 dungeons

**Goal:** Grow the game while the alpha runs, in batches that real players test: from 10 to at least **40 dungeons** before the Steam release, plus more item kinds and other content (the user, D-124).

Tasks:

- Follow the agreed spread (D-126): the first five dungeons cover levels 1–20, and every one after that is an endgame dungeon for level 20 and up, built mostly from Phase 13's reusable building blocks.
- Ship dungeons in batches; each dungeon is drafted for approval like D-108 and D-120 (theme, rooms, enemies, mechanics, boss, EXP, loot, potions).
- New item kinds beyond base tiers and Artifacts, drafted for approval one kind at a time, with their place in the economy.
- Keep drops, rates, and EXP in central configuration, and re-check the EXP pace (D-071) as dungeons are added.

Acceptance:

- At least 40 dungeons are listed, each completable solo and by a party, each with its approved loot, EXP, and potion tables.
- Every new item kind is tested like the existing ones (bounds, ownership, trading).
- Each batch passes its checklist on the live alpha before the next one starts.

## Phase 23 — Presentation: art and sound

**Goal:** Replace placeholder squares with real art once the systems are stable. Placed during the alpha; whether the alpha opens with placeholder art is open question 25.

Tasks:

- Original 16×16 pixel-art sprites for serfs (per class) and ordinary enemies, larger canvases for bosses, tiles, projectiles, and effects, per the confirmed art direction and `docs/ASSET_MANIFEST.md`.
- Verify palette RGB values from a suitable reference before calling anything the Pokémon Emerald palette.
- Sound and music only if the user wants them (open question 19).

Acceptance:

- Every asset passes the manifest checks: canvas size, transparency, crisp edges, palette, frame layout.
- Gameplay readability is no worse than with placeholders (bullets, telegraphs, and ability effects stay clear).
- The HUD never covers the gameplay viewport.

## Phase 24 — Beta polish

**Goal:** Everything a finished game needs ironed out before Steam (the user, D-124).

Tasks:

- A full balance pass across all dungeons, classes, items, and the economy, from alpha data.
- Performance on modest hardware and slow connections.
- Fix the alpha's known issues list down to what the user accepts for release.
- Re-run every feature checklist and the security review against the final build.

Acceptance:

- The known issues list contains only items the user has accepted for release.
- Every feature checklist passes on the release candidate.

## Phase 25 — Desktop wrapper and cross-play proof

**Goal:** Package the same client as a windowed desktop app and verify it plays with browser users.

Tasks:

- Package the web client using Electron or another agreed wrapper.
- Keep core gameplay/network code shared.
- Add platform-specific features only when requested.
- Test desktop and browser clients against the same backend.

Acceptance:

- Desktop app launches in a window.
- Browser and desktop clients can log in and join the same party/dungeon.
- Both observe consistent game state and rewards.
- Both use shared account progression and economy.

## Phase 26 — Steam integration

**Goal:** Steamworks features as their own milestone (split out of the desktop phase).

Tasks:

- Decide with the user which Steamworks features launch needs (open question 20) and the business model (open question 21).
- Integrate the Steamworks SDK in the desktop wrapper only; the browser client is unaffected.
- Keep accounts, progression, and the economy shared with browser players.
- Steam store page assets and the store's technical requirements.

Acceptance:

- The Steam build launches and plays with browser users against the same backend.
- No Steam-only advantage in gameplay or economy.

## Phase 27 — Steam launch

**Goal:** Release on Steam beside the website, with browser and Steam players in the same world (D-124).

Tasks:

- A release checklist covering every phase's acceptance, backups, monitoring, and a rollback plan.
- The public website page and the store page.
- A launch-day plan: who watches what, and what to do if the server falls over (incident steps written down beforehand).
- A post-launch plan: how new content, fixes, and balance changes ship, and how players hear about them.

Acceptance:

- Every item on the release checklist is checked off or knowingly waived by the user.
- A rollback to the previous version has been rehearsed.
- The incident steps have been walked through once before launch day.

## Rule for advancing phases

At the end of each phase, Claude should report:

1. Acceptance criteria and pass/fail status.
2. Automated checks actually run.
3. Exact manual tests for the user.
4. Known issues and remaining risks.
5. The next smallest milestone.

Wait for user feedback when a manual test or important design choice remains outstanding.
