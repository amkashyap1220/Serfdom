# Serfdom Implementation Roadmap

The roadmap is deliberately incremental. Each phase should leave the repository runnable and testable. Do not jump ahead simply because generating more code is possible.

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

## Phase 11 — Dungeon variety and procedural assembly

**Goal:** Expand from a tiny handcrafted test to reusable room-based dungeons.

Tasks:

- Build a library of handcrafted rooms.
- Assemble rooms procedurally where appropriate.
- Preserve fixed and special dungeon formats where designed.
- Validate connectivity, reachability, encounter ordering, and exits.
- Make seeds reproducible for debugging.
- Implement open access for qualifying characters and free retreat through cleared rooms.
- Configure difficulty-specific reward pools.

Acceptance:

- Generated dungeons pass structural validation.
- A reported bad layout can be reproduced with a seed.
- Fixed/special dungeons remain possible.
- Dungeon-specific loot pools are respected.

## Phase 12 — Economy and account systems

**Goal:** Add the marketplace, buying, and upgrades (the shared stash, gold, and selling to the vendor arrive in Phase 9, D-085–D-087).

Tasks:

- Confirm item loss, stash eligibility, pricing, and fees.
- Implement atomic, server-side transactions.
- Test simultaneous trades and duplicate/negative balance exploits.
- Ensure browser and desktop users use the same economy.

Acceptance:

- A trade cannot duplicate an item or gold.
- Failed transactions leave both sides unchanged.
- Shared storage works across characters on one account.
- Economy behavior is identical across platforms.

## Phase 13 — Desktop wrapper and cross-play proof

**Goal:** Package the same client as a windowed desktop app and verify it plays with browser users.

Tasks:

- Package the web client using Electron or another agreed wrapper.
- Keep core gameplay/network code shared.
- Add platform-specific features only when requested.
- Test desktop and browser clients against the same backend.
- Later, add Steamworks integration as a separate milestone.

Acceptance:

- Desktop app launches in a window.
- Browser and desktop clients can log in and join the same party/dungeon.
- Both observe consistent game state and rewards.
- Both use shared account progression and economy.

## Phase 14 — Release hardening

Only after the game loop is fun and core systems are stable:

- Security review and input validation.
- Load and soak testing.
- Database backups/migration strategy.
- Error handling and useful diagnostics.
- Accessibility and window-size testing, including the 960×640 container, 240-pixel HUD, 720×640 viewport, camera visibility, and resizing.
- Deployment, monitoring, and incident recovery.
- Store page, onboarding, and release checklist.

## Rule for advancing phases

At the end of each phase, Claude should report:

1. Acceptance criteria and pass/fail status.
2. Automated checks actually run.
3. Exact manual tests for the user.
4. Known issues and remaining risks.
5. The next smallest milestone.

Wait for user feedback when a manual test or important design choice remains outstanding.
