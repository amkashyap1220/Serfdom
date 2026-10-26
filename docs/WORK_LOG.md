# Serfdom Work Log

Keep this concise and update it after each meaningful milestone.

## Current status

**Next step:** the user runs the Phase 13 combined checklist (TESTING_AND_FEEDBACK.md); then push `phase-13-rest` and start Phase 14 (partying up).

Phase numbering follows the 27-phase roadmap (D-124; entries before 2026-10-24 use the older 18-phase numbers). `docs/ROADMAP.md` holds each phase's acceptance criteria. Session entries below are oldest first.

- [x] Phase 0 — Repository orientation and environment
- [x] Phase 1 — Playable local client skeleton
- [x] Phase 2 — Movement, collision, and camera following
- [x] Phase 3 — Combat prototype
- [x] Phase 4 — Authoritative multiplayer foundation
- [x] Phase 5 — Shared combat and enemies
- [x] Phase 6 — Dungeon vertical slice
- [x] Phase 7 — Account and persistent data
- [x] Phase 8 — Progression and permadeath
- [x] Phase 9 — Equipment and rewards
- [x] Phase 10 — Classes and class abilities
- [x] Phase 11 — Dungeon variety and procedural assembly
- [x] Phase 12 — Dungeon tiers and the endgame loop
- [ ] Phase 13 — Ten dungeons: tiers 4 and 5 and more
- [ ] Phase 14 — Partying up
- [ ] Phase 15 — Home screen, HUD, minimap, and leaderboards
- [ ] Phase 16 — Rare loot
- [ ] Phase 17 — Economy and account systems
- [ ] Phase 18 — Onboarding and settings
- [ ] Phase 19 — Production hosting
- [ ] Phase 20 — Accounts, sessions, and player safety
- [ ] Phase 21 — Website alpha
- [ ] Phase 22 — Alpha content: toward 40 dungeons
- [ ] Phase 23 — Presentation: art and sound
- [ ] Phase 24 — Beta polish
- [ ] Phase 25 — Desktop wrapper and cross-play proof
- [ ] Phase 26 — Steam integration
- [ ] Phase 27 — Steam launch

## Session entries

### Initial context pack — 2026-10-22

- Created starter project instructions and design/technical context.
- No game code is implemented by this context pack.
- Next step: open the repository in Claude, ask it to inspect the repo, and begin Phase 0.
- Important open design blocker before full class implementation: reconcile the 13-class roster with the older ten-class concept draft.

### Context pack v3 — 2026-10-22

- Updated documentation for approved 960×640 game layout, fixed 240-pixel left HUD, and 720×640 gameplay viewport.
- Clarified 16×16 player and ordinary-enemy source sprites.
- Added player-centered camera target of at least 300 world pixels of visibility per cardinal direction.
- Updated Phase 1/2 acceptance criteria and camera/layout testing guidance.
- No game code or gameplay assets were implemented by this context pack.

### Phase 0 — Repository and environment — 2026-10-22

- Environment found: VS Code; Node/npm and Git were not on PATH. User installed Node.js 24.22.1 (npm 11.19.1) and Git 2.55.0 via winget.
- Committed and pushed the context docs as a baseline (`91abd0c`).
- Added `.gitignore`, `.editorconfig`, `.nvmrc`, `.npmrc`, root `package.json`, Prettier 3.9.10 (`.prettierrc.json`, `.prettierignore`); `.gitattributes` now forces LF.
- Ran Prettier over docs (whitespace/table-padding only). Fixed a split table in the decision register that hid D-022–D-030 from table rendering.
- Recorded T-007–T-010 in the decision register; T-001 direction confirmed.
- Checks: `npm run format:check` and a fresh-clone `npm ci` + `npm run format:check`; results in the delivery notes.
- Known: npm offers an upgrade to npm 12; deliberately not taken (major-version change, no need yet).
- User verified a fresh GitHub clone: `npm ci` and `npm run format:check` passed. Phase 0 complete.
- Next step: Phase 1 — Vite + Phaser + TypeScript client skeleton.

### Phase 1 — First slice: layout, placeholder player, camera — 2026-10-22

- Added `client/` npm workspace: Phaser 4.2.1, Vite 8.3.5, Vitest 5.0.5; root TypeScript 6.0.3 and ESLint 10.13.0 + typescript-eslint 8.72.0. Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `check`.
- DOM layout: 960×640 container, 240×640 DOM HUD, 720×640 Phaser canvas. Debug world 2000×2000 with grid, offset labels, 600×600 visibility-target box, 16×16 placeholder player at (1000, 1000), screen-fixed center ticks. HUD shows a measured layout readout.
- Unit tests for camera visibility math (7 tests).
- Decisions recorded: T-001 versions, T-011 (DOM HUD), T-012 (small window scrolls), T-013 (no camera bounds yet). All PROVISIONAL.
- Checks run by Claude: `npm run check` passed; headless Chrome at 1000×700 measured container 960×640, HUD 240×640, gameplay/canvas 720×640, camera center (1000, 1000), ±360×±320 visible, no overlap, no console errors or `[layout]` warnings. At 800×500 the layout keeps its size and the page scrolls.
- Lessons: flags passed through nested `npm run` reach npm, not Vite (port is now set in `vite.config.ts`). Stopping the dev server from a tool can orphan the Vite child process on Windows; `Ctrl+C` in a terminal does not.
- User reported a console 404: browser auto-request for `/favicon.ico`. Fixed with an empty inline icon in `client/index.html`; re-check showed all 11 page requests succeed.
- Not separately reported: devicePixelRatio of the user's display, browser zoom, window resizing while running.
- User ran the Phase 1 manual checks in their browser and reported them passed (layout readout, centering, visibility box, crispness, console). Phase 1 complete.
- Next step: Phase 2 — movement, collision, camera following.

### Phase 2 — Movement, collision, camera following — 2026-10-22

- User decisions: D-031 (WASD only, 8-way, normalized diagonals), D-032 (instant start/stop), D-033 (camera always centers player; void beyond map), T-014 (own movement code in `shared/`), speed 150 px/s.
- Added `shared/` workspace (`@serfdom/shared`): `movement.ts` (direction, swept axis-separated box collision), `fixed-step.ts` (60 Hz accumulator), `movement-config.ts`. 28 unit tests.
- Client: WASD reader, debug map with border walls, block, L-corner, 24 px and 12 px gaps; camera re-centered each frame on the rounded position; HUD live readout; layout re-measured on resize. `test-world.test.ts` guards the map (3 tests).
- Checks run by Claude: `npm run check` passed (38 tests). Headless Chrome driven via DevTools protocol: D for 1 s = +150.0 px; open-space S+D for 1 s = dx 107.8, dy 107.8 (~151 px/s incl. timing slack); A+D = no movement; release = immediate stop; push into block stops at x = 1092.0; D+S slides along block face; left border stops at x = 40.0 with void visible; "Player on screen" 360, 320 throughout; no console errors.
- Found: after adding a workspace dependency, an already-running dev server serves `504 (Outdated Optimize Dep)` for Phaser and the game stays blank; reload does not fix it, restarting the server does. Documented in README.
- Not verified: real keyboard feel, crispness while moving on a real monitor, high-refresh displays (possible slight judder: no interpolation yet, T-016), resizing while moving.
- User manual test passed (all 7 steps) on a 120 Hz display; no judder reported; speed 150 px/s confirmed as fine for now. Phase 2 complete.
- Next step: Phase 3 — combat prototype; first needs the hybrid auto-combat/aim model (open question 2).

### Phase 3a — Q/E view rotation — 2026-10-22

- User decisions recorded: D-034 (three fire modes, toggle key), D-035 (Space = ability, effect undefined), D-036 (R = exit dungeon, Phase 6), D-037 (dodge by movement only), D-038 (15×15 hurtbox; walls 16×16), D-039 (200 HP prototype), D-040 (smooth Q/E rotation, screen-relative WASD), D-041 (projectile basic attack).
- Shared: `rotateVec`, `worldDirectionFromInput`; `stepMovement` now takes a direction vector and rejects length > 1 (future anti-speed-hack check). 35 shared tests.
- Client: Q/E/Z keys, `stepViewRotation` (+ tests), world `Layer` on a rotating main camera, non-rotating overlay camera, upright player sprite, HUD "View rotation". 17 client tests. T-017 recorded.
- Checks: `npm run check` passed. Headless and then a visible Chrome run on the user's 5173 server: Q 0.75 s → 91.3°, W at 91.3° moved world-west (up the screen) until the L-wall, E back to ~45°, Z → 0°, player on screen 360, 320 throughout, player sprite upright and crisp in an 8× zoom capture, no console errors.
- Found: chained `sed -i` edits left the running dev server serving a stale `shared/src/index.ts` ("does not provide an export named 'rotateVec'"); re-saving the file fixed it. Canvas was at a half-pixel x (244.5) in a 985 px-wide window because the container is centered; no softening was visible in captures, left as is and noted.
- User manual test passed (all 5 steps: Q/E/Z, screen-relative WASD at odd angles, collision while rotated, look/direction/speed accepted as is, alt-tab). Slice 3a complete.
- Next step: slice 3b (player attack, fire modes, target enemy).

### Phase 3b — Shooting a target dummy, three fire modes — 2026-10-22

- Shared (pure, tested): `collision.ts` (swept box-vs-rect hit time), `projectile.ts`, `weapon.ts` (fire modes, closest target in range, aim, cooldown), `enemy.ts` (damage, defeat, respawn), `sim.ts` (one combat tick + events), `combat-config.ts`. 80 shared tests.
- Client: T / Space / mouse input, `screenToWorld`, `CombatView` (dummy, upright HP label, hit flash, projectiles), dummy at (1300, 1100), HUD combat rows. 23 client tests. T-018 recorded.
- Bug caught before testing: cooldown gave the 2nd shot one tick early after idle; fixed and covered by a test ([0, 15, 30, 45] at 60 Hz).
- Checks: `npm run check` passed. Live visible-Chrome run on the user's 5173 server: no fire on load; auto aim in range defeated the dummy in exactly 20 hits; respawn after 3 s; auto fire 4 shots/s toward mouse at the correct world point; manual 0 shots without click, 4 shots/s while held; behind the block 8 shots / 8 blocked / 0 hits; no console errors.
- Cosmetic: long HUD values wrap in the 240 px HUD.
- User manual test passed (all 7 steps; prototype values felt good). Slice 3b complete.
- Next step: slice 3c (enemy attacks, player HP 200, 15×15 hurtbox, prototype death/respawn).

### Phase 3c — Enemy ring attack, player HP, prototype death — 2026-10-22

- User decisions: ring burst pattern, values as proposed, auto respawn after 2 s (T-019).
- Shared: `health.ts` (`applyDamage`), projectile `owner`, enemy `attackCooldown` + `ringDirections`, player HP/hurtbox/respawn in `sim.ts`. 93 shared tests, including a hurtbox test (bullet path 10.4 px from center hits, 10.6 px misses; a 16×16 box would still be hit).
- Client: orange enemy bullets, red player hit flash, centered prototype death message, HUD rows for player HP, hits taken / deaths, projectiles in flight by owner. 23 client tests.
- Test fixes (my test assumptions, not game bugs): respawn test now starts from the exact death tick; a test variable needed an explicit `SimState` type (caught by `tsc`, not Vitest).
- Checks: `npm run check` passed. Live visible-Chrome run on the user's 5173 server: no attacks outside 300 px; on the 180° ring line, 3 hits in ~6 s while auto aim defeated the dummy; in Manual, died after exactly 10 hits; W while dead did nothing; respawned at (1000, 1000) with 200/200, dummy 500/500, 0 bullets; between ring lines 0 hits in 6 s; no console errors.
- User manual test passed (all 5 steps; pattern readable and avoidable, values feel reasonable). Slice 3c complete.
- Phase 3 acceptance: engage with approved inputs ✅; readable/avoidable attacks ✅ (user-confirmed); damage/defeat match documented rules ✅; tests cover normal hits and edge cases ✅. Phase 3 complete.
- Next step: Phase 4 — authoritative multiplayer foundation (needs server/transport decisions first).

### Phase 4a — Game server, guest ids, presence — 2026-10-22

- User accepted Claude's recommendations for all Phase 4 choices: T-020 (Node + ws, no framework, type stripping), T-021 (hand-written validators), T-022 (guest ids), T-023 (server-authoritative movement plan), T-024 (combat local until Phase 5), T-025 (dev workflow, no private data in logs).
- Added `server/` workspace (ws 8.22.0, @types/node 24.19.2, @types/ws 8.18.2) and `concurrently` 10.0.6; `npm run dev` now starts both. Added `.env.example` (placeholders only).
- Shared: `protocol.ts` + 18 tests. Server: `GameServer` + 11 integration tests with real sockets. Client: `net.ts` `Connection`, HUD Server / Online rows.
- Findings: a test race (client saw close before server cleanup) fixed by waiting for server state; `tsc` caught `wss.address()` possibly null.
- Checks: `npm run check` passed (111 shared, 11 server, 23 client tests; server tests passed 3 runs in a row). Live: two visible tabs plus the user's own open tab connected as #1–#3, joins/leaves propagated, no console errors, server log has guest ids only. Headless: offline on server stop, reconnected on restart.
- User manual test passed (all steps: combined dev command, two tabs, join/leave, offline and reconnect). Slice 4a complete.
- Next step: slice 4b (server-authoritative movement, other players visible).

### Phase 4b — Server-authoritative movement, other players visible — 2026-10-22

- Protocol v2: `input {seq, move}` and `snapshot {tick, players}`, strict validators + 12 new tests. Debug map moved to `shared/`.
- Server: `player-movement.ts` (queue, one input per tick, seq checks, clamp), `rate-limit.ts`, 60 Hz real-time loop, 20 Hz snapshots, manual `tick()` for deterministic tests. 28 server tests (flood, speed-hack direction, position-instead-of-intent, replayed seq, disconnect removal, real-time loop).
- Client: `prediction.ts`, `interpolation.ts` (11 tests), `net-sync.ts`, `RemotePlayersView`, HUD rows Movement / Pending-correction / Other players / Others (world).
- Caught before testing: parser slack (1e-6) vs `stepMovement` limit (1e-9) could have let a crafted direction throw inside the server tick; server now normalizes, with a test.
- Checks: `npm run check` passed (128 shared, 28 server, 29 client). Probed the user's running server with a v2 client (welcome + snapshot). Live: two visible Chrome windows on the user's 5173 + 8080: A moved to 1152.5 and B saw it at 1153; B moved to y 1075 and A saw it at 1075; prediction correction 0.00 px; no console errors.
- Known/PROVISIONAL: combat still local per browser (each sees its own dummy); prototype respawn does not teleport online; everyone spawns on the same spot (labels overlap); no player-player collision; latency only tested on localhost.
- User manual test passed (all steps). Feedback: other players look **slightly delayed but smooth**; the user does not want lag to become an issue. Recorded as open question 16.
- Next step: 4c — measure and reduce remote-player delay, review Phase 4 acceptance.

### Phase 4c — Delay measurement and tuning; Phase 4 acceptance — 2026-10-22

- User agreed the delay target D-042 (< 100 ms behind, excluding network travel).
- Measured first (two visible windows): steady lag **110 ms** (103–117), first movement 86 ms, own square ~9 ms.
- Tuning (T-026): 60 Hz snapshots, 50 ms interpolation, move-credit catch-up + backlog limit. First try with a backlog limit of 2 measured 50 → 70 → 80 ms across runs: the queue ratcheted up because nothing drains it when both sides tick at 60 Hz. Limit 1: **53 / 60 / 60 ms** medians, worst 70 ms, wobble ≈ 0.3 px, 0 own-player corrections.
- Tests: player-movement tests rewritten for the credit/backlog rule, including "5 inputs every tick for 10 s never exceeds PLAYER_SPEED" and the idle credit cap. `npm run check` passed (128 shared, 31 server, 29 client).
- Phase 4 acceptance: two clients connect ✅; each sees the other ✅; invalid messages rejected safely ✅ (server tests: malformed, unknown, binary, oversized, over-length direction, position-as-input, replayed seq, flood, protocol mismatch, hello timeout); disconnect cleans up ✅; server owns presence and positions ✅. Not yet tested: separate devices / a real network.
- User manual test: delay acceptable; **very slight stuttering** of other players noticed and accepted for now ("it won't be perfectly smooth"). Known issue to revisit if it becomes noticeable in combat: likely snapshot-arrival jitter against the 50 ms buffer and whole-pixel rounding. Phase 4 complete.
- Next step: Phase 5 — shared combat and enemies (needs decisions on how combat moves to the server).

### Phase 5a — Multiplayer combat rules in shared/ — 2026-10-22

- Decisions: D-043 (server decides hits; own shots predicted; fire rides in inputs), D-044 (enemy bullets vs server position; clients draw bullets at their current position), D-045 (HP × (1 + 0.75 × (players − 1)), fraction kept; PROVISIONAL), D-046 (death → placeholder menu, survivors continue). T-019 auto-respawn superseded.
- Shared: `sim.ts` rewritten for N players with per-input player timeline (`applyPlayerInput`) and per-tick world (`stepWorld`); `party-scaling.ts`; enemies carry `baseMaxHp`/`scaledFor`; projectiles carry `ownerId`; hits/defeats credited to the shooter. 138 shared tests.
- Client: uses the multiplayer state for its own player (id 1); auto-respawn replaced by the placeholder menu (Enter = play again).
- Test-only fixes: two new tests had wrong geometry (a grazing shot; a survivor standing on a ring line), and one compared absolute HP where the rule keeps the HP _fraction_.
- Checks: `npm run check` passed (138 shared, 31 server, 29 client). Live (visible Chrome on the user's servers): combat works, died after exactly 10 hits, stayed at the menu (no auto-respawn), Enter restored 200/200; no console errors.
- User manual test passed. Slice 5a complete.
- Next step: 5b (server runs combat, snapshots carry enemies/projectiles/HP, client predicts own shots).

### Phase 5b — Server runs combat for everyone — 2026-10-22

- Protocol v3 (fire intent in inputs, playAgain, full combat snapshots) with 30 new protocol tests, incl. a rejected "claimed hit".
- Server: `input-queue.ts` (renamed from player-movement; same credit/backlog rule, now picks inputs for the shared sim), `GameServer` owns a `SimState`. 38 server tests: shared dummy HP across clients, D-045 scaling, fire-rate cheat at 2× rate capped, death + ignored inputs + playAgain, playAgain rejected while alive, disconnect removal, snapshot contents/size.
- Client: `PlayerPredictor` (movement + shot prediction via the shared rule; parity test proves identical results to the server over 40 inputs), `LocalShots`, `NetSync` view model (extrapolated server projectiles), `CombatView` on a view model with HP-drop flashes, HUD combat/bandwidth rows. 33 client tests.
- Caught during work: predictor would have kept a stale guest id after reconnect (fixed); a fire-rate test first tripped the flood limit instead (a different safeguard; test adjusted); shell-quoting mangled one inline edit (fixed by editing directly).
- Checks: `npm run check` passed (144 shared, 38 server, 33 client). Live, two visible windows + the user's two open tabs on the user's servers: 4 players → dummy 1625 (3.25×); both windows identical dummy HP in every sample; own-shot correction 0.00 px; death → menu, other window stopped drawing the dead player, dummy rescaled to 1250 keeping the fraction; Enter → (1000, 1000) 200/200; no console errors. Hit confirmation delay 17–22 ms median (n = 38). Snapshots 430 B idle → ~2.2 KB / ~130 KB/s mid-fight (T-027).
- User manual test passed (all 5 steps; shots feel instant, hits prompt, dodging fair). Slice 5b complete.
- Next step: 5c (review Phase 5 acceptance: simultaneous attacks, tampering, two-client manual test doc).

### Phase 5c — Simultaneous attacks, two-client checklist, Phase 5 acceptance — 2026-10-22

- Added `shared/src/simultaneous.test.ts` (5 tests): same-tick hits both count; shared killing blow credited to exactly one player (lower projectile id); identical results for identical inputs; tie credit follows input order; 4-player burst never drops HP below 0 or double-counts a defeat. Recorded T-028.
- First run failed 3 tests because my setup set HP before party scaling rescaled it (rule working as designed); fixed the setup to set HP already scaled.
- Added the two-client combat checklist to TESTING_AND_FEEDBACK.md.
- Phase 5 acceptance: both clients see consistent enemy health and defeat ✅ (live + server tests); client tampering cannot award damage or rewards ✅ (intent-only protocol, claimed hits rejected, fire/move rate capped, server-side range/cooldown/eligibility); combat tests pass ✅ (`npm run check`: 149 shared, 38 server, 33 client); manual two-client steps documented ✅.
- Next step: user runs the checklist (optional, 5b already user-tested); then Phase 6 — dungeon vertical slice (needs design decisions first).

### Phase 6 — Orientation — 2026-10-22

- Committed and pushed Phase 5c (`c6da739`); Phase 5 closed.
- Recorded the user's Phase 6 answers as D-047 (full simple level + boss, 5 min solo / 3 min full party, design delegated to Claude), D-048 (main menu with stash/serfs/leaderboard/dungeon select; quick requeue), D-049 (dopamine completion, slot-machine chest), D-050 (tragic death with a serf-life stats screen).
- Next step: user decides how a party gets into the same dungeon instance; then slice 6a.

### Phase 6a — Main menu, open queue, dungeon runs, death and completion screens — 2026-10-22

- User decisions: D-051 open queue, D-052 no late join. Claude PROVISIONAL: T-029 (Goblin Warrens v0 design for 6b–6c), T-030 (queue: 4 players or 5 s), T-031 (stand-in: debug map + dummy, clear = complete), T-032 (DOM screens, offline mode removed), T-033 (R = leave, serf survives, no rewards).
- Protocol v4 (queue / leaveQueue / exitDungeon; queueStatus / runStarted / runEnded with server-counted stats; playAgain removed). Shared: `dungeons.ts`, `run-stats.ts`, enemies with `respawnSeconds: null`, `playerHit` names the enemy.
- Server: `Matchmaker` (7 tests), `DungeonInstance`, `GameServer` routes menu ↔ queue ↔ run. Integration tests rewritten around runs and extended: queue flow, 5 s wait, queue counts, 4-player cap (5th gets own run), leave queue, bad queue requests, separate worlds / no late join, death ends run with stats while survivors continue, clear completes for all, stats credited correctly, R + requeue with seq restart, no-ops at the menu.
- Client: `app-state.ts` reducer (9 tests), `screens.ts`/`screens.css`, NetSync run lifecycle, R key, HUD `Screen` row; offline sim and placeholder death text removed.
- Checks: `npm run check` passed (156 shared, 55 server, 42 client, build). Live on the user's dev servers, two visible Chrome windows: both menus; A queued (1/4, 5 s) then B (2/4); one run started 4.0 s after B queued with both visible and dummy 875; B pressed R → menu notice, A continued, dummy 500; A cleared in 0:06 → DUNGEON CLEARED with stats (accuracy 91%); Enter requeued → solo run 4.7 s later at (1000, 1000), 200 HP; A died after 0:20 → death screen (damage taken 200), Enter at 0.6 s ignored, Enter after 1.5 s → menu. No console errors.
- Next step: user tests 6a (checklist in TESTING_AND_FEEDBACK.md) and confirms T-033 (what R costs); then 6b (real Goblin Warrens map, rooms and doors, grunts and slingers).
- Change requested by the user: runs accept joiners for their first 15 s (D-052 revised). `DungeonInstance.canJoin/join` (join window, room, never-rejoin), `GameServer.joinOpenRuns` (fullest open run first), option `joinWindowSeconds`. Tests: join at 14 s (rescales to 875), locked after 15 s, no rejoin after R, full run refuses a 5th. `npm run check`: 156 / 58 / 42 passed.
- Open question raised: party size 4 → 10? (GDD §11 says 4.)
- User: 6a checklist all pass. Party size 4 → 10 (D-012; `MAX_PARTY_SIZE`, tests use the constant). R costs nothing beyond the run's potential rewards (D-053, replaces T-033).

### Phase 6b — Goblin Warrens map, rooms and doors, grunts and slingers — 2026-10-22

- Committed 6a as `e0e5e10` on the user's approval.
- Protocol v5 (enemy `kind`, `closedDoors`). Shared: map format + wall generation + layout validation, the Goblin Warrens map (7 rooms, 6 doors, optional den), room progress rules, grunt and slinger AI, `spawnEnemies`, removal of defeated dungeon enemies. The old stand-in map is now the unlisted `training` test dungeon (T-036).
- Server: `DungeonInstance` runs rooms and doors; completion = all required rooms cleared (T-031). Client: `MapView`, per-kind enemy looks, prediction against closed doors, HUD `Enemies alive` / `Doors closed`.
- Tests: enemy AI (11), layouts and room progress incl. a party walking the whole map (13), instance in the Warrens (4: first door, closed door blocks, grunts spawn and hit, full walk-through completes, den stays dormant), protocol v5. `npm run check`: 181 shared, 63 server, 42 client, build.
- Live on the user's dev servers (visible Chrome): rooms woke on entry, doors opened in order (5 → 4 → 2), enemy counts and kinds matched the map, death screen after 1:58 (crude bot, no dodging; died in the ambush hall's second wave, 22 kills, 80% accuracy). Fixed: open door gaps were drawn as black void; now floor.
- Raised open question 17 (healing during a run). Next step: user plays the Warrens (checklist) and reports difficulty; then 6c (brute, Goblin Warlord, exit portal, bigger completion celebration).
- User correction: difficulty targets a fresh level-1 Serf; 20 HP (200 was a placeholder); Vitality = regen per GDD §6 (I had asked without checking §6; saved a feedback memory). User chose 0.5 HP/s always on (D-054–D-056). Implemented `PLAYER_REGEN` (step 0 of `stepWorld`, living players only, capped), `PLAYER_HEALTH.maxHp` 20, enemy damage scaled to 2 (grunt, rock, ring). Tests now use the config constants; fixed a server test that compared against 200 and would have passed whatever happened. 3 new regen tests. `npm run check`: 184 shared, 63 server, 42 client. Bot rerun: died at 3:05 in the ambush hall's wave 2 to 5 stacked grunts (was 1:58).

### Phase 6c — Brute, Goblin Warlord, rockfall, exit portal, celebration — 2026-10-22

- Committed 6b as `4b60967` on the user's approval.
- User decision: completion = stepping into the exit portal (D-057). Claude design: T-037 (brute, Warlord numbers and patterns), T-038 (celebration and feedback visuals); T-031 updated.
- Protocol v6. Shared: `EnemyState.ai`/`summonerId`, brute and Warlord behavior, hazards in the sim, summons dying with their summoner, `exitPortal` in layouts (validated). Server: per-player portal completion, snapshot alert/hazards/portalOpen. Client: brute/Warlord looks, telegraph blink, hazard circles, portal, boss bar, celebration (gold flash, shake/shimmer, count-up stats, 3 confetti waves, chest drop with rays).
- Tests: 13 new shared (brute windup/charge/lock/once-per-charge/walls, Warlord phases/cap/ring offset/aggro, rockfall landing, summons die with boss, hazards from phase 2) and 4 new server (Warlord waits, portal opens only on its death, per-player portal completion, death before the portal = died, snapshot contents); protocol v6 tests. `npm run check`: 198 shared, 67 server, 42 client, build.
- Live (visible Chrome, throwaway harness on :8081/:5174 that skipped to the throne and set the Warlord's HP; the user's servers untouched): phase 1 patterns and boss bar; phase 2 "ENRAGED", summoned grunt, a rockfall circle under the player; Warlord dead → portal OPEN with the run still going; walking in → DUNGEON CLEARED with count-up stats, confetti, chest. Fixed: chest rays overlapped the stats; title glow switched to a filter (text-shadow muddied gradient text). No console errors.
- Not yet verified: a full legitimate clear by a human (difficulty), two players at the portal live.
- Next step: user plays the full Warrens (6c checklist) and reports; then 6d (placeholder per-player reward roll, tuning to the 5 min solo / 3 min full-party targets, two-client acceptance).

### Phase 6d — Per-player reward rolls, Phase 6 acceptance — 2026-10-22

- Committed 6c as `ceba6db` after the user's checklist passed.
- Protocol v7; placeholder reward roll per completing player (T-039): server-only randomness, null on death/exit, parser rejects a reward without completion. Slot-machine reel reveal on the chest.
- Tests: protocol v7 (valid/invalid rewards), instance (three players: one leaves → no reward; two enter the portal → rolls 101 and 102 from an injected sequence), app-state carries the reward. `npm run check`: 198 shared, 68 server, 42 client, build.
- Live (throwaway harness on :8081/:5174 skipping to the Warlord; the user's servers untouched): reels spun then stopped on 504, matching the server log; two windows in one run each completed independently with their own rolls (633 and 210, matching `completed … (placeholder roll …)` log lines); B kept playing after A left.
- Phase 6 acceptance: enter, fight, complete, leave ✅; death before completion grants no completion rewards ✅ (no roll, tested); multiplayer players share encounter state ✅ (same enemies/doors/rooms across clients, tested since 6b); individual rewards rolled per qualifying completing player ✅ (placeholder roll, tested). Open: tuning to the D-047 clear times needs real human clear times (bot data is not representative).
- Next step: user runs the Phase 6 acceptance checklist and reports solo (and if possible party) clear times; Claude tunes enemy numbers / party scaling; then close Phase 6 and preview Phase 7 (accounts and persistent data).
- Committed 6d as `82831e2`. Tuning from the user's report (2 players, 4:00): party factor 0.75 → 0.5 and enemy HP +~12% (T-040, D-045 updated); predicted ~5.0 min solo, ~3.9 min for 2, ~3.0 min for 10. Tests updated to the new scaling (750 for 2 players). `npm run check`: 198 / 68 / 42 passed.
- **Phase 6 complete** (all roadmap acceptance criteria met; clear-time tuning PROVISIONAL, refine with more clear times). Next step: Phase 7 — accounts and persistent data (needs decisions first).

### Phase 7a — Email + password accounts in PostgreSQL — 2026-10-22

- Committed the Phase 6 tuning as `2e869c9`. User decisions: D-058 (email + password from the start), D-059 (local PostgreSQL via winget), D-060 (no emails yet), D-061 (2 serf slots), D-062 (permadeath saved from Phase 7). The user installed PostgreSQL 17.11 and created `serfdom` / `serfdom_test`; both connections verified without printing secrets.
- Added `pg` 8.23.1 (+ `@types/pg`). Migration runner + `001_accounts.sql`. Account service: scrypt hashes, hashed 30-day session tokens, uniform login errors with a dummy hash, per-email throttle (T-041). Protocol v8; server requires login to queue; one connection per account (T-042). Client login/register screen, token kept in localStorage, auto-resume on load/reconnect, Log out.
- Tests: password/throttle/service unit tests; real-PostgreSQL integration tests (migrations idempotent, repo contract for both stores, accounts survive a new pool, no plaintext, cascade); 7 server login tests; existing server tests now log in; client screen-flow tests. `npm run check`: 198 shared, 96 server, 46 client, build. Lint caught a missing error `cause` in the migration runner (fixed).
- Live on the user's dev servers and dev database: login screen; short password refused locally; registered `claude-test@example.com` (one row in the dev database); token stored (43 chars); reload → back in the menu; Log out → token cleared; wrong password → "Email or password is incorrect."; right password → menu → queue → run. Fixed: a failed login cleared the typed email.
- Next step: user runs the accounts checklist; then 7b (serfs: create, list, choose, 2 slots, permadeath recorded).
- Bug found by the user: letters W A S D Q E Z T R and Space could not be typed into the login form. Cause: Phaser captures the keys it binds (calls preventDefault on them page-wide). My live test had filled the inputs by setting `.value`, which bypasses keyboard events, so it missed this. Reproduced with real key events (email came out "..@xmpl.com"), fixed by turning Phaser's key capture and game keys off outside runs (`WorldScene.setGameKeysActive`), re-verified with real typing (exact text) and in a run (D moved 90 px in 0.6 s, R exited). Lesson recorded: UI tests must type real key presses.
- User feedback: the login and menu screens should be the same size as the game + HUD window. Measured: the overlay already was exactly 960×640 at the container's position, but its background matched the page, so it looked full-window. Gave screens a lighter panel background (#171a21) with a 1 px inset frame; re-measured (same rect as #game-container) and checked a screenshot in a 1600×1000 window.

### Phase 7b — Serfs: slots, names, lifetime stats, permadeath — 2026-10-22

- Committed 7a as `274c6e9` after the user's checklist passed. User decisions: D-063 (players type names), D-064 (unique among living). Claude defaults: T-044.
- Protocol v9. Migration `002_serfs.sql`. Server: serf storage (PostgreSQL + in-memory twin, account-scoped queries, slot limit under an account-row lock, death written once), serf service, game-server integration (queue needs a living serf; run owner fixed at start; runs recorded on every end; death permanent), `killedBy` from the killing blow. Client: Serfs tab (create with Suggest, Play as, In memoriam), death screen with the serf's life, last-played serf remembered.
- Tests: serf rules (12), storage contract on both stores plus PostgreSQL-only (4 creates racing for 2 slots → exactly 2; a death survives a new pool), 6 server serf tests (no queue without a serf, bad names, slot limit, duplicate living names, someone else's serf = "No such serf.", no switching mid-run, permanent death with killer, life stats for left/completed). `npm run check`: 212 shared, 110 server, 46 client, build.
- Live on the user's servers and dev database (real key presses): Serfs tab after login with no serf; typed "Wade Dask" intact; created → Dungeons "Playing as Wade Dask"; died standing in the tunnel → "WADE DASK HAS DIED / Slain by a Goblin Grunt…", life record; In memoriam entry; two more serfs → 2/2, form hidden. Test data in the dev database: account claude-test@example.com with serfs Wade Dask (dead), Eddas Wart, Dirk Waszt.
- Next step: user runs the serfs checklist; then 7c (Phase 7 acceptance review: restart survival, authorization, invalid updates, docs).
- User: serfs checklist all pass. Requested a password confirmation on registration: added a Confirm password box (Create account only); a mismatch shows "The passwords don't match." and sends nothing. Verified live with real key presses (Log in shows 2 boxes, Create account 3; mismatch refused; match created claude-test2@example.com in the dev database).

### Phase 7c — Phase 7 acceptance review — 2026-10-22

- Committed 7b as `56d8bde` after the user's checklist passed (plus the password confirmation).
- Added an end-to-end acceptance test on the real test database: server 1 registers an account, creates "Phoenix Rye", plays a run, and shuts down with its pool; server 2 (new pool) resumes with the saved token and lists the serf with its run; a second account sees no serfs, gets "No such serf." selecting it, and a made-up `recordRun` message is rejected as unknown.
- Docs: README "Changing the database schema" and "Resetting your development database"; ARCHITECTURE "Current database (Phase 7)".
- Phase 7 acceptance: data survives a server restart ✅ (end-to-end test with two server instances, plus storage-level tests); one account cannot access another account's characters ✅ (account-scoped queries; storage contract tests on both stores; server and end-to-end tests); invalid inventory/economy updates are rejected — **not applicable yet**: inventory, gold, and the economy do not exist, and the roadmap says to persist them only once their rules are confirmed (Phases 9 and 12); what is persisted now (accounts, serfs, run records) only changes through validated server requests, and clients have no message that sets stats, levels, or results ✅; migrations and local database setup documented ✅ (README, ARCHITECTURE, TESTING).
- **Phase 7 complete.** Open for later: email verification and password reset (D-060, before release), wss:// (T-042, Phase 14), backups (Phase 14), offensive-name filter (T-044).
- Next step: Phase 8 — progression and permadeath (needs decisions first: 13-class roster, EXP curve, stat growth, death rules).
- User added a design rule before Phase 8: a **Luck** stat; Luck = number of end-of-dungeon item rolls; items can roll +1 Luck, never -1. Clarified with the user: a level-1 Serf has 1 Luck; Luck comes only from items (no level/class growth); at most +1 per item. Recorded D-065–D-067, updated GDD §6/§9/§10/§11, ROADMAP Phases 8–9 (tasks and acceptance), open question 6 (partly answered), new open question 18 (equipped-only?, what one roll yields, cap). No code changed.
- User answered the Luck details: equipped items only; one reward chest per Luck point; no cap; any item that can roll stats can roll Luck, Artifacts included (D-068; open question 18 answered). GDD and ROADMAP Phase 9 updated.

### Phase 8a — EXP, levels, leaderboard — 2026-10-22

- Committed 7c + Luck docs as `6753744`; Phase 7 closed. Phase 8 orientation: checked the docs first (GDD §3, §6, §7, §12); asked only what they leave open. User decisions: D-069 (EXP only from completion), D-070 (fast pace). Claude: T-045 (curve), T-046 (display/storage).
- Protocol v10; `progression.ts`; migration 003 (exp added, stored level dropped); EXP recorded with the run; leaderboard (top 20, names only, login required); client EXP gain + level-up, Serfs tab EXP, Leaderboard tab.
- Caught by tests: my new parser check read `result` before it was defined (ReferenceError); moved after it.
- Tests: progression (5, incl. every level boundary), protocol v10 (EXP only with completion, no account data in the leaderboard), storage (EXP and level on record, dead keep EXP, leaderboard ranking on both stores), server (100 EXP per clear and level 2, nothing on R/death, leaderboard needs login and has no emails). `npm run check`: 218 shared, 116 server, 46 client, build.
- Live (throwaway harness on :8081/:5174 backed by the **test** database; the user's servers and dev data untouched): registered with confirmation, created "Ada Barley" by typing, cleared the Warrens → "+100 EXP", "LEVEL UP! Level 2"; Leaderboard "#1 Ada Barley Lv 2 100 EXP"; Serfs tab "Lv 2 · 100 EXP · 1/1 clears".
- Next step: user runs the 8a checklist; then 8b (class choice at level 2: needs the 13-class roster).
- Same day, before the 8a commit: the user added **D-071** (level-scaled EXP: Warrens-only ~20 clears to level 20, the natural path ~5; levels 1–20 are fast, the real grind is stat potions and rare drops). I asked one question (which "20 clears" meant); the user chose Warrens-only ≈ 20. T-045 revised: cost 50 + 2(L−1) (1,292 to level 20), Warrens 100 EXP through level 9, ×0.9 per level above. `clearExp` in shared; `SerfService.recordRun` now computes the EXP from the serf's stored level (the server no longer passes an amount); the completion screen explains reduced EXP. Tests: falloff values and the 1/5/20-clear pace (shared), new `serf-service.test.ts` (level 1 full, level 12 gets 73, level 20 gets 31, nothing on leave/death, other accounts' serfs). `npm run check`: 220 shared, 121 server, 46 client, build.
- Revised again on the user's feedback ("the second clear should not give 4 levels, let alone 1"; 20 clears too low): the user chose ~75 Warrens-only clears. T-045 now 100 + 15(L−1) (4,465 to level 20): level 2 after 1 clear, 3 after 3, 9 after 13, 20 after 73. Falloff unchanged (×0.9 per level above 9).
- User ran the 8a checklist on their own servers with the ~75-clear curve: all pass (2026-10-22). Committed and pushed 8a. Next: 8b, class choice at level 2 (needs the 13-class roster).

### Phase 8b orientation — class roster and choice level — 2026-10-22

- User: the roster is the **10** draft classes (D-072; D-005's 13 superseded); ability items and skill ideas are in GDD §4. Checked the docs: the class → weapon/armor proficiency mapping is **not** present (logged under open question 3, needed by Phase 9); class stat growth is still open (8c).
- User: class choice is at **level 5**, not 2, permanent, and every new serf picks at 5 (D-073). Corrected GDD §3/§4, D-006, D-070, ROADMAP Phase 8; added shared `CLASS_CHOICE_LEVEL = 5` (the completion-screen hint now appears on reaching level 5).

### Phase 8b — class choice at level 5 — 2026-10-22

- Protocol v11; shared `classes.ts` (the 10 classes with GDD §4 items/abilities) and `CLASS_CHOICE_LEVEL`; migration 004 (`serfs.class_id`); guarded one-time `chooseClass` in both repos; service reasons; server queue check via `session.serfNeedsClass`; client picker with Confirm, level-5 completion button, class in Serfs tab / leaderboard / death screen. T-047 records the UI choices (PROVISIONAL).
- Caught on the way: ESLint flagged an unused destructured variable in a new protocol test; tsc flagged a type-only cast in a server test (replaced with raw JSON, which the test needs anyway to send an unknown class).
- Tests: classes (roster, ids, "Serf", needsClass), protocol v11 (every class accepted, unknown/case-changed/null refused, extra fields refused, v10-shaped serfs refused), storage on both stores (once only, needs EXP, not for the dead or other accounts, leaderboard class), service (level-5 gate and reasons), server (queue refused until chosen, permanent, parser refuses "paladin", other accounts' serfs). `npm run check`: 226 shared, 127 server, 46 client, build.
- Live (throwaway harness on :8081/:5174 backed by the **test** database, with an `exp` command to start one clear short of level 5): created "Ada Barley" by typing, one clear → "LEVEL UP! Level 5", "Choose your class (Enter)"; Enter → 10-class picker; Enter again did not queue; Wizard → Confirm → "Playing as Ada Barley · Wizard · Level 5" with the dungeon list back; Serfs tab "Wizard · Lv 5"; Leaderboard "#1 Ada Barley Wizard Lv 5 500 EXP". Screenshots checked: fits the 960×640 frame.
- Next step: user runs the 8b checklist; then 8c (stat growth per level: needs the user's growth rules).
- User ran the 8b checklist: all pass (2026-10-23). Committed and pushed 8b. Next: 8c (stat growth per level).

### Phase 8c-1 — rolled stats — 2026-10-23

- Committed 8b as `80615dd`. 8c orientation: checked GDD §3/§6, D-054–D-056, D-065–D-068, D-071 first; asked only what they leave open (four questions together). User: random growth (D-074), potions reach the class max (D-075), Claude drafts the numbers (D-076), combat stats active in 8c (D-077). Draft approved as is (D-078).
- Protocol v12; shared `stats.ts`; migration 005; guarded `saveStats` and a stats-carrying `chooseClass` on both stores; `SerfService.settle` (catch-up rolls, never twice) with an injectable random source; `runEnded.statGains`. Client: roll line under LEVEL UP, Serfs tab stat line with maxes, death screen final stats, HUD Serf section.
- Tests: stats (base, inclusive ranges, Serf vs class ranges, nothing past 5 while classless, max clamp, bonus, every class has tiers, level-20 averages match the draft), protocol v12 (stats and gains shape, completion-only gains, no Luck/extra keys), storage on both stores (round trip, guarded save, not for the dead or other accounts, class bonus with the class), service (deterministic top rolls, no double roll, catch-up stops at 5, class bonus then class levels, no gains on death), server (level-2 runEnded carries gains matching the saved HP). `npm run check`: 234 shared, 135 server, 46 client, build.
- Live (throwaway harness, **test** database): level 2 showed "+1 HP +1 MP +1 ATK +1 DEX +1 SPD +1 VIT +1 WIS"; Serfs tab and HUD matched; levels 3–5 rolled together "+7 HP +4 MP …"; Barbarian bonus visible (HP 28 → 38, ATK 12 → 15, VIT 13 → 16; MP unchanged), maxes shown (HP /200, MP /120, …). A second run rolled different values. Fixed the Serfs row layout ("Playing" had wrapped under the stats).
- Next step: user runs the 8c-1 checklist; then 8c-2 (stats take effect in combat, client prediction uses Speed).
- User ran the 8c-1 checklist: all pass (2026-10-23). Committed and pushed 8c-1. Next: 8c-2.

### Phase 8c-2 — stats in combat — 2026-10-23

- Committed 8c-1 as `c750aec`. `combatFor(stats)` (D-078 formulas, bases from the existing config so each base value lives once); `PlayerState.combat` used by movement, fire rate, shot damage, regen, and Defense; stats passed into runs (start and late join) from a session cache; protocol v13 `runStarted.stats` for exact client prediction.
- Caught by tests: my approved draft table listed Speed 60 → 300 px/s; the formula gives 337.5 (unreachable: Speed max is 45). Recorded under D-078; formula unchanged.
- Tests: combatFor (fresh Serf equals the old constants; table values), sim (HP, Speed, Dexterity, Attack, Defense incl. the playerHit amount, Vitality), protocol v13 (stats required and validated), server (runStarted carries the serf's rolled stats; the simulated player has its max HP and combat), client (a Speed-30 predictor moves 225 px/s and reconciles with 0 correction). `npm run check`: 242 shared, 136 server, 47 client, build.
- Live (throwaway harness, **test** database): a level-20 Barbarian (HP 108, ATK 37, SPD 18, DEF 7) started the Warrens at 108/108 HP, moved 183 px in a ~1.01 s key hold (expected 180 px/s), and prediction correction stayed 0.00 px. Not checked live: two clients with different speeds, how hits and kills feel.
- Next step: user runs the 8c-2 checklist; then the Phase 8 death rules review and Phase 8 acceptance.
- User ran the 8c-2 checklist: all pass (2026-10-23). Committed and pushed 8c-2. Next: Phase 8 acceptance review.

### Phase 8d — Luck, and the Phase 8 acceptance review — 2026-10-23

- Committed 8c-2 as `b8615a4`. Reviewed the Phase 8 roadmap against the code: two gaps. (1) Luck (D-065–D-068) was confirmed but not in the code. (2) No test showed that stats stop at level 20.
- 8d: shared `BASE_LUCK` and `luckOf`; Luck shown in the HUD and the Serfs tab; tests (base 1, +1 per Luck item, no cap, not a rolled stat so levels/classes never change it; a level-20 classed serf's clear adds EXP but zero stats). `npm run check`: 244 shared, 137 server, 47 client, build. Live (harness, **test** DB): HUD "LUCK 1", Serfs tab "… WIS 10 · LUCK 1".
- Acceptance: met for every confirmed rule (see ROADMAP Phase 8 status). Deferred to Phase 9, where the things exist: equipment loss on death, gold, Resurrection Necklace, and one reward chest per Luck point; open question 5 (death inventory rules) needs the user's answer before item loss is built.
- Next step: user runs the 8d checklist; then close Phase 8 and orient Phase 9 (equipment and rewards).
- User ran the 8d checklist: all pass (2026-10-23). Phase 8 closed. Committed and pushed 8d. Next: orient Phase 9.

### Phase 9a-1 — items and chests — 2026-10-23

- Phase 9 orientation: checked ROADMAP Phase 9, GDD §7–§10, D-016, D-020, D-065–D-068 first; asked four questions together. User: death loses everything on the serf (D-079), one chest = one item (D-080), classes restrict weapons and armor (D-081), the draft's 10 slots (D-082). Draft item numbers approved as is (D-083).
- Shared `items.ts`; migration 006 (`items`); guarded `addLoot`; death deletes items in the same transaction; serf reads include items; one item per Luck point on completion; protocol v14 (`loot` replaces the placeholder roll, `SerfSummary.items`); crypto randomness for stat and item rolls in production. Client: chest cards on the completion screen, bag line in the Serfs tab.
- Tests: generation (20,000 seeded items all valid; tier and slot weights; ~20% negative rolls; ~5% Luck only on rolled items), validation refuses 12 kinds of impossible items, bonuses and names, class restrictions; protocol v14 (loot only on completion, impossible items refused, owned items need an id and a real slot); storage on both stores (bag limit, ids, other accounts, death deletes items) plus a PostgreSQL row check; service (one chest at Luck 1 into the bag, none on leave/death, full bag loses the item); server (runEnded loot matches the bag). `npm run check`: 266 shared, 143 server, 47 client, build.
- Live (harness, **test** DB): first clear "T0 Cape", second "T1 Bow · 31 damage · +2 VIT", Serfs tab "Bag 2/16: T0 Cape, T1 Bow". Screenshot checked.
- Noticed (raised with the user, not changed): under D-083 a T0 accessory has no base and no rolls, so it gives nothing; about 1 in 5 Warrens chests is such an empty item.
- Next step: user runs the 9a-1 checklist and decides on empty T0 accessories; then 9a-2 (equip/unequip/discard, gear changes stats and Luck).
- User chose option 2 for empty T0 accessories: one roll at T0 (D-084). `rollsFor(slot, tier)` in shared items.ts drives both generation and validation; tests: T0 ring/necklace/cape have 1 roll, T0 weapon/armor 0, no generated accessory is empty, a T0 accessory with no roll is refused.
- User redesigned the reward flow before 9a-1 was committed: no serf bag; rewards go to a shared stash or onto the serf with Equip now (stat comparison on hover); a full stash forces selling for gold; undecided rewards are held and block the serf's next dungeon; potions follow the same flow (drink now or potion rack). Checked the docs first (GDD §7, §12 drafts: gold persists, shared stash, 50% vendor, upgradeable stash/rack); asked four questions. Recorded D-085–D-089; updated GDD §7/§10/§12, ROADMAP Phases 9 and 12, and marked the 9a-1 bag checklist superseded. The uncommitted 9a-1 bag code will be reworked into the stash.

### Phase 9a — stash, gold, reward flow — 2026-10-23

- Draft numbers approved (D-090). Your dev database had already run 006, so migration 007 reworks `items` (account-owned, location stash/equipped/pending) and adds `accounts.gold`; 9a-1 bag items become stash items.
- Repo: `addLoot` (stash, else pending), `sell` (vendor price, pending moves into the room made), `stash`, `hasPending`, all under an account-row lock; death deletes equipped items only. Service and server: stash/sell handlers, `serfBlocked` queue check, stash pushed after login, runs, and sales. Protocol v15. Client: Stash tab, gold, completion cards with Sell, Settle rewards, blocked Dungeons tab, Stash tab on login when rewards wait.
- Caught on the way: two of my new server tests were wrong (the first stash item was the random first-clear drop, not a cape; filling 20 on top of 1 left a cape pending, and selling correctly moved the oldest pending item in). Fixed the tests, not the code. Live testing found a clipped "Waiting for room" grid and "1 reward wait"; both fixed.
- Tests: values (sell table), protocol v15 (stash and loot shapes, worn items refused in the stash, exact client shapes), storage on both stores (stash then pending, ids, sell once at the right price, pending moves in, others cannot sell, a pending item can be sold, death keeps the stash) plus PostgreSQL row checks, service (stash after a clear, none on leave/death, full stash: pending, blocked, settled by selling), server end to end (full stash holds the reward, queue refused, sell pays and unblocks; stash needs login; unknown items refused). `npm run check`: 271 shared, 149 server, 47 client, build.
- Live (harness, **test** DB, with a `fill` command): T1 Necklace → Stash; 19 capes added; next clear's item waited with Sell and "Settle rewards"; Stash tab showed it first; Dungeons blocked; selling a T2 Cloth Chest paid 22 gold, the waiting T2 Ring moved in, and queueing worked again. Screenshots checked after the layout fix.
- Next step: user runs the 9a checklist; then 9b (Equip now with the hover comparison, equipping from the stash, gear changes stats, damage, and Luck).
- User asked why an item was called "Cloth Chest" (chest = the torso slot; it read like a reward chest). Chose per-material armor names (D-091): e.g. T2 Robe, T1 Breastplate, T0 Cap; cards show the material. `itemName` and new `armorTypeName` in shared items.ts; tests for all 12 armor names.
- User asked to commit 9a and move on (2026-10-23; the 9a checklist result was not reported). Committed and pushed 9a. Next: 9b.

### Phase 9b — equipping — 2026-10-23

- Committed 9a as `26543e2`. Defaults for the small open details recorded as T-048 (ring slot choice, stats never below 0 / HP 1, unequip needs room, no gear changes in a run).
- Shared `loadoutOf`, `slotsFor`, `compareItems`; weapon damage into `combatFor` and the sim; repo `equip`/`unequip` under the account lock; service rules (slot, class, T0 before a class); server loadout cache, gear lock during runs, protocol v16; client gear panel, Equip buttons with hover comparison, Equip now on rewards (cards update in place), gear-included stats and Luck in the HUD.
- Caught on the way: a test waited for a serf list `joined()` had already read (fixed the test); live: a full gear panel could overflow the frame, so the stash grid is shorter whenever the gear panel shows.
- Tests: loadout (gear adds, stash does not, clamping, weapon tier), weapon damage, ring slots, comparison; protocol v16; both stores (equip from stash and pending, swap, worn items cannot be sold or re-equipped, unequip ok/full, replaced item to pending when full, others refused, death removes worn gear only); service (Serf T0 rule, class weapons, slot check, a +1 Luck ring gives 2 chests, unequip needs room); server end to end (equip over the network, runStarted carries the gear-included stats, the sim moves at the new speed, unequip refused while queued). `npm run check`: 277 shared, 156 server, 47 client, build.
- Live (harness, **test** DB): a T0 Ring dropped with "Equip on Ada Barley"; hover showed "vs empty slot +1 DEF"; Equip now marked it equipped without replaying the celebration; HUD "DEF 1 (+1)"; the Stash tab showed it in Ring 1; Unequip moved it to the stash and DEF went back to 0. Screenshots checked. Not checked live: two-ring choice, weapon damage in a run, Luck 2 chests (covered by tests).
- Next step: user runs the 9b checklist; then Phase 9 acceptance review (potions wait for the first potion dungeon, D-089).
- User ran the 9b checklist: all pass (2026-10-23). Committed and pushed 9b. Next: Phase 9 acceptance review.

### Phase 9 acceptance review — 2026-10-23

- Committed 9b as `35fd604`. Reviewed every Phase 9 acceptance item against code and tests; two had no direct test: unequipped Luck adds no chest, and a held reward survives a disconnect. Added both (service; server end to end with a real reconnect and resume). `npm run check`: 277 shared, 158 server, 47 client, build.
- Deferred by decision: stat potions (D-089), Shiny items and Artifacts, weapon attack styles.
- Next step: user confirms closing Phase 9; then orient Phase 10 (classes and abilities).
- User closed Phase 9 (2026-10-23). Committed and pushed. Next: Phase 10 orientation.

### Phase 10a — ability framework and Wizard Arcane Blast — 2026-10-23

- Phase 10 orientation: checked GDD §4–§6, D-034/D-035, D-082 first; asked four questions together. User: ability from the worn ability item with a T0 one on class choice (D-092), MP + short cooldown (D-093), aim by fire mode (D-094), tiers strengthen the ability (D-095). Draft numbers approved (D-096).
- Built in two parts. 10a-1: ability items (type per class, 10% of drops, class-only), migration 008 and a once-per-serf grant (on class choice and on select for older serfs), MP in combat (WIS/10 regen), HUD HP/MP bars. 10a-2: `abilities.ts`, casting in the sim (item, MP, cooldown, range clamp), blasts resolved in the world step with the same hit/kill events as shots, protocol v17, client targeting by fire mode and blast drawing.
- Caught on the way: the server dropped the ability target twice when copying inputs (the input handler and the input queue each rebuilt the input from move and fire only). Found by the end-to-end test (no MP spent); both fixed, with a queue test. Also fixed: my test sent chooseClass while selectSerf was still in flight (correctly refused as busy); old exact-match expectations needed the new fields.
- Tests: ability items (class-only, names, rolls, 10% of drops, all 10 kinds drop), the grant (once, only living classed serfs, older serfs on select, not again after selling), MP (start full, regen, cap), Arcane Blast (area, damage by tier and ATK, events, 15 MP, 1.5 s cooldown, no MP no cast, 250 px clamp, nothing without the item), protocol v17 (ability target bounds, required field, blasts), queue keeps the target, end to end over the network (MP spent, dummy damaged, blast in a snapshot). `npm run check`: 285 shared, 164 server, 47 client, build.
- Live (harness, **test** DB): level-5 Wizard got a T0 Spellbook; HUD "Arcane Blast (T0) · 15 MP"; at the Warlord, Space took MP 26 → 12.9, a second cast → 3.7; the Warlord lost HP; the screenshot shows the purple blast circle on it. Not checked live: Auto fire/Manual cursor aiming, two clients seeing each other's blasts.
- Next step: user runs the 10a checklist; then 10b (Ranger, Sorcerer, Druid), numbers drafted for approval.
- User ran the 10a checklist (with Aldric Bramble raised to level 9 and 7 test items added to the dev stash on request): all pass (2026-10-23). Committed and pushed 10a. Next: draft 10b numbers.

### Phase 10b — Ranger, Sorcerer, Druid — 2026-10-23

- Committed 10a as `fe261f0`. Draft numbers approved (D-097). Built one class at a time: abilities made table-driven, then Volley (fan of projectiles), Chain Lightning (instant, jumps with falloff), Nature's Reach (lingering zone, pulses, half-speed enemies via one movement hook). Protocol v18 (ability in runStarted, chains and zones in snapshots); client drawing.
- Caught by tests (all my expectations, not the code): at 60 px three Volley arrows hit, not one; the training dummy spawns on the first tick, so a cast before it finds no target (correctly no cast).
- Tests: Volley (5-arrow fan angles, speed/range/size, damage by tier and ATK, three hit up close, 1.2 s cooldown, no aim no cast), Chain Lightning (first target rule, 80% falloff, 4/5/6 hits at T0/T5/T10, stops beyond 120 px, no target → nothing spent), Nature's Reach (6 pulses over 3 s, only inside, vanishes, a grunt inside moves at half speed), protocol v18 (ability kind/tier, chain 2–7 points, zones), dungeon instance (chains sent once with the path, zones in snapshots). `npm run check`: 295 shared, 166 server, 47 client, build.
- Live (harness, **test** DB, test-only ability swap): MP 26 → 14.2 (Volley 12), → 11.2 (Chain 15), → 6.9 (Reach 20); screenshots show the lightning through a grunt, the Warlord, and a second grunt, and the green patch. I misread the Volley screenshot: the cyan dots were basic shots; the arrows were not drawn at all (see the bug below).
- Next step: user runs the 10b checklist (needs serfs of each class; I can set them up on the dev database); then 10c (Barbarian, Bard, Warlock).
- **Bug reported by the user:** Volley spent MP but showed nothing. Cause: the client skips the server's copies of its own player projectiles (its basic shots are drawn from prediction), and Volley arrows exist only on the server, so the caster never saw them. Fix: projectiles carry `fromAbility`; snapshots flag `ability`; the caster draws its own ability projectiles, in gold. The filter is now a pure, tested function (`serverProjectilesToDraw`). Regression tests: own shots skipped, own arrows kept, other players' shots and enemy bullets kept; the protocol flag is required and boolean. Live: five gold arrows visible fanning toward the Warlord. `npm run check`: 295 shared, 166 server, 49 client, build.
- User ran the 10b checklist (Hamon Marsh Ranger, Edwin Furrow Sorcerer, Rowena Thatch Druid set up on the dev database on request): all pass after the Volley visibility fix (2026-10-23). Committed and pushed 10b. Next: draft 10c.

### Phase 10c — Barbarian, Bard, Warlock; four fire modes — 2026-10-23

- Committed 10b as `d6a42b5`. Draft approved (D-098): damage/regen/damage-taken buffs only, so client prediction stays exact. Mid-slice the user added four fire modes (D-099) and the Full auto rule (auto-cast when an enemy is in range, any type but movement; Space always works); details T-049.
- Sim: player buffs with a damage multiplier (shots and abilities), Inspiration regen, enemy curses applied inside `damageEnemy` (hit events report damage actually dealt), exhaustive cast switch (an unhandled kind is now a type error; before, unknown kinds would have fallen through to Volley). Shared `abilityIntent` for the modes. Protocol v19 (buffs, cursed, blast kinds); the instance collects flashes from both timelines. Client glows, outlines, rings; shorter mode labels after they wrapped in the HUD.
- Caught by tests (my expectations): `damageEnemy` now reports damage; a second player in a test rescaled enemy HP for the party (D-045), so the curse test uses the caster's own shot.
- Tests: Battle Cry (bonus by tier, on shots, expires, refresh), Inspiration (only within 160 px, +1 HP/s), additive buffs, Curse (only inside 50 px, any source, tier bonus, expires, hit event reports cursed damage), cast flashes, damageEnemy with a curse, the four-mode cycle, `abilityIntent` in every mode (auto-cast in reach, buffs at shot range, no movement auto-cast, Space with nobody near), Full auto shooting, instance sends a curse flash from the player timeline. `npm run check`: 309 shared, 167 server, 49 client, build.
- Live (harness, **test** DB, test-only ability swap): Battle Cry and Curse −15 MP, Inspiration −20; screenshots show the red ring, the violet flash and outline on the Warlord, the widening gold ring and both glows; three T presses reached Full auto and an Arcane Blast went off with no Space (MP 26 → 11.8).
- Next step: user runs the 10c checklist (needs a Barbarian, Bard, and Warlock; I can set them up); then 10d (Fighter, Rogue, Cleric).
- User ran the 10c checklist (Edwin Furrow re-classed as Barbarian, Maud Fenwick Bard and Osric Muck Warlock added on request): all pass (2026-10-23). Committed and pushed 10c. Next: draft 10d.

### Phase 10d — Fighter, Rogue, Cleric — 2026-10-23

- Draft approved (D-100): Guard (damage reduction, multiplies with Defense), Vanish (untargetable; flying bullets 50%; ends on shooting or casting), Healing (160 px, up to max HP). Full auto casts Healing like any ability; the offered "below 75% HP" exception was not taken. No speed or fire-rate changes, so client prediction stays exact.
- Sim: `guard`/`vanish` buffs (blocked share in `bonus`), `PLAYER_BUFF_KEYS`, `isVanished` filters enemy targets, cast `heals`. Protocol v20 (heal/healed blasts, guard/vanish buffs). Client: blue Guard glow, green heal ring and flashes, vanished sprites at 30% alpha.
- Tests: Guard reduction by tier and cap, DEF 10 plus T0 Guard takes 25%; Vanish (no enemy attacks while vanished, flying bullets 50%, shooting ends it, duration by tier); Healing (amount, cap at max, only within 160 px). `npm run check`: 313 shared, 167 server, 49 client, build.
- Live (harness, **test** DB, test-only ability swap): Guard −12 MP, Vanish −15, Healing −20; screenshots show the blue ring, the green heal ring, and the faded sprite (Manual mode); Full auto cast with no Space.
- **Found live:** in Auto aim (and the other auto-firing modes) the next automatic shot ended Vanish right away, as the approved rule said. The user chose to hold automatic fire while vanished (D-101): optional `fire.auto` on the input, enforced in the sim, mirrored by the client. Tests: auto shots hold for 1 s while vanished and Vanish stays, a click ends it, auto fire resumes after; every mode is click-only while vanished; parser accepts only a boolean `auto`; the input queue keeps it. `npm run check`: 316 shared, 168 server, 49 client, build. Live: in Auto aim the sprite stays faded 1.6 s after the cast with no shots and the Warlord's HP unchanged.
- Dev DB (on request, through the service code, temp script deleted): Edwin Furrow → Fighter, Hamon Marsh → Rogue (serfdom@test.com), Maud Fenwick → Cleric (serfdom1@test.com); old ability items to the stash, T0 Shield/Cloak/Tome worn. Their stats keep their old class growth.
- User: Vanish is a movement ability, so Full auto must not cast it (D-102). `ABILITIES.vanish.movement = true`; the movement test now uses Vanish instead of a temporary stand-in.
- User ran the 10d checklist (Edwin Fighter, Hamon Rogue, Maud Cleric): all pass (2026-10-23). Committed and pushed 10d. Next: Phase 10 acceptance review.
- Harness note: the test-only ability swap changes only the server, so the client still aims the old ability; in Manual it needs the mouse over the game to send a cast.

### Phase 10 acceptance review — 2026-10-23

- Committed 10d as `1077c41`. Reviewed the three Phase 10 acceptance items:
  - **Classes match approved docs:** all ten abilities follow D-092–D-102. The GDD §4 table was stale (it said numbers were open and Guard "implementation unresolved"); updated with a built-abilities table that has the real costs and cooldowns from the code.
  - **Server validates ability use:** the input carries only a target, never which ability, so the worn item decides; casts need the item, MP, and a finished cooldown; targets are clamped to range in the sim and malformed ones refused by the parser; repeated inputs cannot cast faster (input credits). One gap had no test, a dead player casting; added (nothing spent, nobody healed).
  - **No unapproved mechanics:** every number was drafted and approved per slice; Claude's own details are marked PROVISIONAL (T-049, fire-mode names).
- Not built: the Artifact twists in GDD §4 (Phase 9 also deferred Artifacts to later phases; no phase owns them yet).
- Next step: user decides whether to close Phase 10 with the Artifact twists deferred.
- User closed Phase 10 (2026-10-23) and approved extending the roadmap to 18 phases (D-103): dungeon tiers and the endgame loop, rare loot, presentation, and Steam integration became their own phases; Artifact twists moved to Phase 13. Open questions 19 (sound) and 20 (Steam features) added. Forward references to old phase numbers updated (D-061, D-087, D-090, T-042, GDD §12).
- Next step: orient Phase 11 (dungeon variety and procedural assembly).

### Phase 11a — Procedural Goblin Warrens — 2026-10-23

- User chose to make the Warrens itself procedural (option A) and approved the rules (D-104). While building, the approved bands could not meet the approved HP band with the existing rooms (only camp + camp reached it); Claude moved the Guard room to medium (PROVISIONAL, flagged), which keeps today's map valid as one of the outcomes.
- Seeded generator (mulberry32), `RoomAssembly` (pieces rotate to face their entrance; unjoined rooms keep walls apart), `buildWarrens(seed)` with the rules, seed 0 = the handcrafted map. Seed per run from the server in `runStarted` (protocol v21); both sides build the layout; HUD shows the seed; `DUNGEON_SEED` replays one (T-050).
- Tests: seeded random repeatable; seed 0 is the handcrafted map; same seed same map; 2,000 seeds validate without the fallback and follow every rule (order and bands, HP band, never west, only the main path required, throne holds the Warlord, portal in the throne, spawn in the entrance); side rooms 0, 1 and 2 all occur, never required, never off the entrance or throne; turns east/north/south and every piece occur; a flood fill with all doors open never leaves rooms and doorways (100 seeds; checked it fails when one wall is removed); parser accepts only 0–4294967295 seeds; the instance builds the seed's layout; starters and late joiners get the run's seed. `npm run check`: 324 shared, 170 server, 49 client, build.
- Seen: full-map renders of seeds 0–5 (rotated tunnels, side rooms, turns). Live (harness, **test** DB, seed 1): HUD "Dungeon seed 1", walked through the generated south door into a north–south tunnel, 5 grunts woke, prediction correction stayed 0.00 px including against the tunnel wall.
- User ran the 11a checklist: all pass (2026-10-23). Committed and pushed 11a. Next: draft 11b (more pieces and encounter variants).

### Phase 11b — Warrens room pool — 2026-10-23

- Committed 11a as `7ce8b39`. Draft approved (D-105): 11 combat rooms (7 new), the den moved to light, the Guard room confirmed medium, a second setup per room within ±10% HP. With this pool every main path fits the HP band (12,505–14,255), so the generator never rejects a combination.
- Not built: the Collapsed passage's "rubble" from the draft table; rooms have no interior obstacles, and adding them would change how rocks and chasing work. Flagged to the user.
- Tests: bands and HP match the table; two setups per room, the second within ±10% and a different mix; every spawn inside its room; all 2,304 main-path combinations (pieces × setups) inside the band; 400 seeds use both setups of every room; the 11a structural, rule, and leak tests run over the new pool. `npm run check`: 329 shared, 170 server, 49 client, build.
- Seen: full-map renders of seeds 11–16. Live (harness, **test** DB, seed 11): walked north into a vertical Collapsed passage, its second setup (2 grunts, 3 slingers) woke, prediction correction 0.00 px against its wall.
- User ran the 11b checklist, with the wall and door fix: all pass (2026-10-23). Committed and pushed separately from D-106.
- User testing 11b found two drawing bugs (2026-10-23): (1) wall seams: every wall piece was outlined on its own, so lines ran through solid wall where pieces overlap at corners and shared walls; (2) locked doors (and the exit portal) were invisible on generated maps: each new layout adds its floor and walls on top of the map layer, burying the door and portal graphics; the handcrafted map was built once and never showed it. Fixes: `client/src/wall-outline.ts` outlines only where wall meets floor or void (unit tests: a lone wall, an overlapping corner, two pieces end to end, no line through solid wall on six generated maps); `MapView.show` lifts doors and portal back to the top. Live (harness, seed 11): the closed door at the passage's far end is drawn; wall junctions are solid with no seams.

### Accessory base stats (D-106) — 2026-10-23

- Before 11b's checklist was confirmed, the user asked to revisit rings and necklaces. Asked about the +3 cap's scope (all items), HP/MP (×3), capes (same as jewelry), then about the tier+1 base vs a T0 roll and about Luck: the user set extra rolls to start at T4 on every item and ruled out Luck as a base stat.
- `items.ts`: accessory base stat in `type`, `accessoryBase`, no rolls before T4, roll cap 3 (9 HP/MP), accessories never roll their base, names "T5 Ring of Defense". Migration 009 converts stored items. The dev database had 17 items, none with rolls or Luck, so nothing is lost there.
- Tests: roll counts per tier for every slot; base tier + 1 (×3 HP/MP) and more every tier; rolls capped and below the base; generated accessories cover all three slots and all 8 base stats, never Luck, never rolling their base, all valid (T0–T2 and T4–T10 pools); a T5 Ring of Defense's bonus and name; validation refuses no base, a Luck base, rolls below T4, over the cap, or on the base stat; the migration converts old-shape rows (inserted directly) into valid items with capped rolls and Luck kept from T4. Server fixtures updated (T4 ring sells for 93). `npm run check`: 337 shared, 171 server, 53 client, build.
- Consequence flagged to the user: Luck items now only come from T4+ drops, which no current dungeon gives.
- User ran the D-106 checklist: all pass (2026-10-23). Committed and pushed after 11b. Next: 11c (dungeon entry rules, open question 7).

### Phase 11c — Dungeon entry — 2026-10-23

- Asked open question 7. The user first answered "any dungeon at any level" and one queue for all levels, then refined it mid-slice: once a serf completes the Warrens, every other dungeon opens (D-107).
- Found while checking the queue: the server accepted any dungeon id, including the unlisted Training Yard (one dummy, 100 EXP and a chest per clear), so a modified client could farm it. Now refused unless the server is started for tests (`allowTestDungeons`).
- Shared `entryProblem` (the first completion can only be the Warrens, so lifetime clears > 0 is the check); `session.serfClears`; queue check with the shared reason; menu lock (nothing locked until a second listed dungeon exists).
- Tests: the Warrens open at any level and clears; a non-Warrens dungeon locked with 0 clears and open with 1; a normal server refuses the Training Yard and queues a fresh serf for the Warrens; test servers opt in. `npm run check`: 339 shared, 172 server, 53 client, build. Not testable end to end yet: the lock on a listed dungeon (none exists; added to Phase 12 acceptance).
- User ran the 11c checklist: all pass (2026-10-23). Committed and pushed 11c. Next: Phase 11 acceptance review.

### Phase 11 acceptance review — 2026-10-23

- Committed 11c as `bd3a5f4`. Reviewed every Phase 11 task and acceptance item against code and tests. One task had no direct test, free retreat through cleared rooms; added (walk into the camp while it fights, then back to the entrance: both doors behind stay open).
- The user passed the retreat test and clarified that loot pools are per dungeon only (no pools by difficulty, D-016), so 11d is dropped; GDD, roadmap, and D-016 wording corrected. Phase 11 closed (2026-10-23). Committed and pushed.
- Next step: orient Phase 12 (dungeon tiers and the endgame loop).

### Phase 12a — Goblin Stronghold — 2026-10-23

- Asked what D-071's "about 5 dungeons" counts (the user: 5 dungeon tiers) and dungeon 2's theme (Goblin stronghold). Draft approved with one change: no general ×2 buff; shamans will strengthen goblins near them (12b). Without the buff, the HP band needed twice the goblins, so each Warrens room returns with both setups at once (spawns nudged apart), plus Gatehouse, Barracks, Armory (D-108).
- Generator rules moved into `DungeonRecipe` / `buildFromRecipe`; the Warrens' maps are unchanged (300 seeds compared before and after). Stronghold recipe, dungeon id, EXP, loot pool; the menu lock from 11c now shows on a real dungeon. Structural test checks shared in `layout-test-helpers.ts`.
- Tests: listing, lock, EXP (160 to level 12, 144 at 13), loot tiers, reinforced rooms equal both setups' HP, new rooms' HP, no overlapping or outside spawns, all 300 main-path combinations inside 30,000–36,000, 1,000 seeds follow every rule, seeds repeat, seed 0 is seed 1's map, no wall gaps (60 seeds); server end to end: a hand-made queue for the Stronghold from a serf with no completion is refused, and accepted after one. `npm run check`: 350 shared, 173 server, 53 client, build.
- Seen: full-map renders of seeds 1–3. Live (harness, **test** DB): a fresh serf sees "Locked: Complete the Goblin Warrens first."; after one Warrens clear the Stronghold has "Enter queue"; the run starts in the Stronghold gate.
- Not checked: a full Stronghold clear and its difficulty for a real level-9 serf (needs the user's play test).
- User reviewed 12a (2026-10-23): good, but every room before the boss can be beaten by running in a circle, and difficulty leans on enemy numbers. The user chose all eight proposed counters: spike traps, obstacles and cover, sweeping traps, slow or burning floor; slingers that lead shots, flankers, bombers that leave fire, ambush holes. 12a committed as the base; room mechanics come next, before shamans, then room enemy counts are rebalanced down.

### Phase 12b — Leading slingers, spike traps, ambush holes — 2026-10-23

- Committed 12a as `bf24259`. The user chose all eight anti-circling mechanics and approved the order and 12b numbers (D-109).
- Shared: spike and hole data in the layout, rotated with pieces; per-dungeon settings applied after a map is built from a separate random stream (all 300 compared seeds kept their exact shape in both dungeons); room clocks and hole release in `stepRooms`; `spikeStrikes`; player velocity and `throwPoint` for leading slingers; `hazardHits` through the normal damage path. Server: spikes once per strike per player, killer "spikes". Protocol v22. Client drawing for spikes, holes, leading slingers.
- Caught on the way: the hole release first ran for every wave (an existing room-progress test failed: normal rooms spilled extra goblins); hole bursts were first timed from the room's wake, not the wave's start (every burst would have come at once); summed ticks fell just short of 4 s (one tick late). All fixed; the Ambush hall piece's own waves also briefly held an empty second wave (caught by the table test).
- Tests: spike timing, strikes only in fighting rooms, damage with Defense, death; hole release timing and placement; lead aim math and a strafing player in the sim; lead share (1 in 3 Warrens, all Stronghold), spike damage per dungeon, which rooms get traps, seed 0 without traps; instance: one hit per strike over two cycles, a spike death names "spikes", snapshots carry room clocks and lead flags; protocol: killedBy "spikes" accepted, unknown hazards refused. `npm run check`: 360 shared, 176 server, 53 client, build.
- Live (harness, **test** DB, seed 9): a striking red column and an arming orange one in the Tunnel; the Ambush hall's holes drawn in its walls, 2 brutes out at once, 2 more 4 s later. Not seen live: the lighter colour of a leading slinger.
- User on the first 12b build (2026-10-23): no fixed spike tiles (same spots every time); boulders should fall at random in rooms once you enter. Chosen: some rooms per dungeon; mostly random, 1 in 4 near a player (D-110). Spike traps removed entirely; rockfall rooms reuse the Warlord's hazard path with a room tag, from the run's own seeded stream; one boulder drawing for both kinds. The room-clock snapshot field went with the spikes.
- Tests (replacing the spike tests): one boulder per 0.7 s from the first moment, only while fighting and only in rockfall rooms, always inside the floor, about 1 in 4 near a player over 4,000 drops, landing after 1.2 s as a hazard hit (Defense counts, can kill); which rooms have rockfall and its damage per dungeon; instance: boulders appear in snapshots once the room fights, the same seed drops the same boulders, a boulder death names "rockfall". `npm run check`: 361 shared, 176 server, 53 client, build.
- Live (harness, **test** DB, seed 9): in the Tunnel a grey boulder drops toward its shadow and red circle beside the player.
- User (2026-10-23): too much on screen at once in the intro dungeons; asked for slower attacks and movement and more damage per hit. Draft approved (D-111): attacks 1.5× less often, movement 20% slower, damage 1.5× (grunt, slinger, brute, Warlord, room boulders); ambush holes unchanged.
- Tests that had the old timings written in (grunt hits, slinger throws, a rock reaching the player, boulder counts) now derive their expectations from the constants, so later tuning will not break them. `npm run check`: 361 shared, 176 server, 53 client, build. Not play-tested live after the retune (numbers only; the drawing did not change).
- User ran the 12b checklist with the new pace: pass (2026-10-23). Committed and pushed 12b. Next: draft 12c (obstacles and cover).

### Phase 12c — Obstacles and cover — 2026-10-23

- Committed 12b as `57485a8`. Draft approved (D-112).
- Obstacles live in rooms and in the layout's walls (prediction and every shot handle them like walls). Goblins steer round the first thing in their way via its near corner (a lighter method than the grid search in the draft; same behaviour for separated rectangles); slingers check their line and strafe; brutes that charge into a wall are dazed 1.5 s, then rest as usual. Protocol v23 (`dazed`). Client: obstacles as lighter stone, dazed brutes blink.
- Caught: the Barracks never appeared in Stronghold maps once its bunks existed: validation rejected it because the hole wave's listed spots overlapped the bunks, though those goblins come out beside the holes. Validation now skips a hole wave's spots and checks that hole exits are clear instead. Two old AI tests (a grunt stopped flat by a wall, a brute straight to recover) described the old behaviour and were rewritten for the new.
- Tests: which rooms get obstacles in each dungeon; obstacles solid, 64 px from walls, no floor sealed off and no leaks over 200 seeds of both dungeons (the sealed-floor check reports a room cut in two); steering goes straight when clear and round the near corner otherwise; a grunt walks round a wall and never overlaps it, but stays boxed in when there is no way round; a slinger does not throw into cover and throws once it has stepped clear; a brute charging into a pillar is dazed, and dazed exactly 1.5 s before recovering; a full charge is not dazed. `npm run check`: 368 shared, 176 server, 53 client, build.
- Seen: full-map renders (rubble in a vertical passage, pillars in a rotated Guard room). Live (harness, **test** DB, seed 2): grunts came round the pillars and a rubble pile toward the player. Not seen live: the dazed blink.
- User ran the 12c checklist: pass (2026-10-23). Committed and pushed 12c. Next: draft 12d.

### Phase 12d — Arrow traps and sludge — 2026-10-23

- Committed 12c as `9d5513d`. Draft approved (D-113), with burning floor moved to 12e's bombers so it is never fixed spots.
- Sludge in the shared simulation (and the client predictor); arrow traps as room-owned projectiles with a hazard tag, volley timing and gaps from the run's stream, glow sent in snapshots. Protocol v24.
- Tests: sludge 60% for players, full speed outside and for goblins, only in the Fungus grotto; predictor and server agree through a pool with no correction; volleys at 0.8, 4.3, 7.8 s, every slit but a gap of 3; the glow shows the coming gap and its slits are the ones skipped; nothing while the room is cleared; an arrow is a hazard hit, Defense counts, an obstacle stops it; arrows only in Gatehouses (main path or side room) with 6 damage, always across the way in; instance: a Gatehouse glows, then sends the trap arrows in snapshots. `npm run check`: 376 shared, 177 server, 54 client, build.
- Live (harness, **test** DB; Warrens first at seed 0 for the unlock, then the Stronghold at seed 4): sludge 93 px/s against 155 outside with 0.00 px correction; Gatehouse slits glowing with 3 dark, then a volley crossing the rotated room with the gap empty. The 12b leading slingers' lighter colour also showed.
- User (2026-10-23): not every room should lock you in; rushing should be possible at the cost of aggro. Draft approved (D-114): doors open from the start; gated rooms (Ambush hall; Stronghold also Barracks) shut every door while fighting, never on a player in a doorway; the portal opens when the boss room is cleared. Built on top of the uncommitted 12d.
- Tests rewritten from "every door opens in order" to the new rule (doors start open; a gated room shuts both its doors while fighting, not on a player in the doorway, and reopens when cleared; a party walking straight through is only held by the ambush hall; the server stops a player walking back through the shut door); new: the portal opens with only the boss room cleared and not with all but it; which rooms are gated in each dungeon; every generated map starts with its doors open. `npm run check`: 378 shared, 177 server, 54 client, build.
- Live (harness, **test** DB, seed 9): doors closed 0 at start; three rooms rushed with a growing train of goblins; inside the Ambush hall its 2 doors shut.
- User (2026-10-23): goblins rushed past get stuck in room corners. Cause: corner steering picks the near corner of the one wall piece in the way, which for a room's own walls is often behind another wall piece or outside the room, so a goblin chasing you out of a room pressed into its corner. Fix: grid path finding (`Navigator`, the method the 12c draft had named), corner steering only as a fallback. Regression test: grunts in the corner of every room along the path reach a player waiting in the boss room on six maps; the same test with corner steering alone leaves some stuck (reproduces the bug). `npm run check`: 381 shared, 177 server, 54 client, build. Live (seed 9): after rushing three rooms and waiting in the third, goblins from the earlier rooms came in after the player.
- User ran the 12d and D-114 checklists: all pass (2026-10-23). Committed and pushed. Next: draft 12e (flankers, bombers and burning floor, shamans).

### Phase 12e — Skulkers, bombers, shamans — 2026-10-23

- Committed 12d, rushing, and path finding as `e8a4821`. Draft approved (D-115).
- Three new kinds and their AI; chants (damage ×1.5 for 5 s, a red glow), bombs that leave burning floor (`SimState.fires`), a gold chant ring; Stronghold rooms swap wave-0 grunts for the new goblins by role. Protocol v25.
- Tests: a skulker gets ahead of a moving player where a grunt trails; it lunges and hits 3 once per 1.2 s; a bomb lands after 0.9 s for 4, then burns 2 every 0.5 s six times and goes out, credited to the bomber; a bomber backs off when you come close; a shaman never attacks, chants (only goblins within 120 px, not shamans, for 5 s), and keeps away from players; a chanted grunt hits 4.5; swaps land where planned (skulkers at the front) and nowhere in the Warrens; room HP equals both setups plus the swaps; the HP band and all layout rules still hold. `npm run check`: 389 shared, 177 server, 54 client, build.
- Live (harness, **test** DB, Stronghold seed 2 after a seed-0 Warrens clear): War camp bombers glowing red beside their shaman, burning floor under the player; a Goblin kitchen bomber's fire.
- User ran the 12e checklist: all pass (2026-10-23). Committed and pushed 12e (`f12981c`). Next: draft 12f.

### Phase 12f — Fewer goblins per room — 2026-10-23

- Draft approved (D-116), computed from the real rooms before proposing.
- `thinPiece` and full-strength base pools, so the Stronghold (built on the Warrens' rooms) is not thinned twice. HP bands lowered.
- Tests: Warrens mechanic rooms lose exactly 25% of grunts and slingers per wave and everything else stays; plain rooms unchanged; Stronghold 30% / 20% with brutes and new goblins kept; the 11b table and the Stronghold composition tests now check the full-strength pools; every Stronghold path combination inside 25,000–31,000; the 2,000-seed rule check holds the Warrens' generated maps to 11,500–14,500. `npm run check`: 391 shared, 177 server, 54 client, build.
- Measured over 1,000 seeds: Warrens main paths 12,060–13,640 HP (was 12,590–14,180), about 42 enemies (was 45); Stronghold 25,855–28,930 (was 30,750–33,455), about 112 enemies (was 140). Not play-tested: real clear times.
- User ran the 12f checklist: pass (2026-10-23). Committed and pushed 12f (`07a5e03`). Next: draft the Goblin Warchief.

### Phase 12g — The Goblin Warchief — 2026-10-23

- Draft approved (D-117). New kind, three-phase AI, War hall (pillars, holes), Stronghold band 28,000–34,000, protocol v26, boss bar for either boss.
- Refinement: the sweep's direction is fixed when the axe goes up, so the warning circle is exactly where it lands (snapshots carry no facing).
- **Bug found live and fixed:** goblin blasts (12e's chant, and the new sweep) were sent with `by: -1`, which the snapshot parser rejects, so the client threw away every snapshot carrying one (the chant ring never drew). Now `by: 0`, which the parser accepts; a server test parses real snapshots through a sweep.
- Tests: phase thresholds; phase 1 walks and throws 3 fans in 10 s and never charges, cries, or slams; the sweep warns, then hits 8 in exactly the warned circle, and misses if you step out; phase 2 charges after 1 s at 300 px/s and hits for 10 once; a pillar dazes it, it throws nothing while dazed, then recovers; the war cry spawns at the holes and stops at 4; no war cry in phase 1; phase 3 slams 20 × 5 and resets intervals ×0.75; world-step blasts; the War hall in 200 generated Strongholds (Warchief alone, 4 pillars, 4 holes, portal clear); every Stronghold path inside the new band; boss bar labels. `npm run check`: 402 shared, 179 server, 57 client, build.
- Live (harness, **test** DB, Stronghold seed 2 after a seed-0 Warrens clear): the sweep's red circle with the yellow flash; axe fans; the "WAR CRY" bar with two notches and skulkers from the holes; a charge that hit the player; "ENRAGED" with the slam ring spreading out. No console errors. Not play-tested: a real fight's length and difficulty.
- Known limits: axes and shockwaves look like ordinary enemy bullets (placeholder art).
- User ran the 12g checklist: pass (2026-10-23). Committed and pushed 12g (`70efdca`). Next: draft stat potions and the potion rack.

### Phase 12h — Stat potions and the potion rack — 2026-10-24

- Asked which dungeon gives potions first (D-089 left it open): the user chose the Goblin Stronghold, now. Draft approved (D-118); the user confirmed again that Luck has no potions and no level growth (already D-066 and the code).
- Shared rules (`potions.ts`), migration 010 (`potions` table), repo and service (roll after the chests, drink, pour out, rack refill, potions block like items), protocol v27, game server routing (no drinking while queued or in a run), client Potion rack tab and results-screen potion cards.
- Tests: names (8, no Luck), amounts, the Stronghold's 20% per Luck point with deterministic rolls, even stat choice, the Warrens uses no random numbers; `potionProblem` and the max cap; storage contract on memory **and PostgreSQL** (rack fills then pending, other accounts see and touch nothing, pouring refills, drinking caps at the max, refuses classless / at max / dead, a potion drinks once, the rack outlives the serf); service (roll on a Stronghold clear, none from the Warrens, a losing roll, or a death; a full rack blocks until poured out; drink reasons); network (classless refused, drink raises the stat, no drinking while queued, pouring allowed); protocol shapes (no Luck potions, potions only on completion, exact fields). `npm run check`: 409 shared, 188 server, 57 client, build.
- Live (harness, **test** DB, potion rolls biased for the test only): a Stronghold clear by a level-9 Fighter won a Potion of Wisdom, shown after the chest; Drink now made it "Drunk by Ada Barley" and WIS 10 → 11 (shown later in the rack as 11/40); a 20/20 rack grouped by stat with current/max per serf; Pour out made it 19/20. No console errors. Not seen live: the "Rack full" waiting flow and the greyed-out buttons (covered by tests).
- Known limits: placeholder gold card colours; drinking before level 20 uses up room that level-ups would otherwise fill (D-075: level growth never passes the max).
- User (2026-10-24): potions should work like Realm of the Mad God: a permanent flat raise, any level, class or not; leveling adds on top up to the same max, so drinking early wastes free level gains. My draft had required a class (my own rule). Asked only the open part, the Serf's max: the user chose the best level-5 Serf (D-119). `SERF_MAX` / `serfStatMax`; Serf level-ups now stop at it; potions allowed for Serfs; the drink button always shows current/max. Tests: the Serf max values, below every class max, best rolls reach it exactly, a potion-maxed level-1 Serf gains nothing on levelling, class max takes over after a class; storage, service, and network tests now drink as a Serf and refuse Defense. `npm run check`: 410 shared, 188 server, 57 client, build.
- User ran the 12h checklist: all pass (2026-10-24). Committed and pushed 12h (`10d9c91`). Next: draft the third dungeon.

### Phase 12i — The Forgotten Crypt — 2026-10-24

- Asked the open part first (dungeon 3's theme): the user chose an undead crypt. Drafted from the real formulas (840 EXP from 12 to 15; a level-12 serf with T3 deals about 1.33× a level-9 serf with T2) and approved as is (D-120), with four build slices.
- 12i: `forgotten-crypt.ts` (11 rooms, sarcophagi as holes, the Sanctum with the Warchief standing in), registered with EXP, loot, and potions; skeletons with bone piles (in `damageEnemy`, so every damage source agrees) and skeleton archers (grunt and slinger behaviour now take a spec); protocol v28 `pile`; crypt palette, names, colours, the bone-pile square.
- Tests: listed with its entry rule; EXP 200 to level 15 then less; loot only T3–T5; potions 30%; only skeletons and archers in its rooms; every one of the 48 main-path combinations inside 37,000–45,000 now and 40,000–48,000 once the Lich replaces the Warchief; 1,000 seeds follow the recipe rules; same seed same map; no wall gaps; the first death leaves a 1 HP pile (no kill), a hit shatters it (the kill), a pile lies still beside a player for 4 s then stands up at half HP, the second death is final; a standing skeleton hits 4 per 1.2 s; in the world a shot shatters a pile and counts one kill; archers fire 2 × 4 damage 8° apart every 2.6 s, lead a runner even when not flagged, and back off; a crypt run's snapshot sends the pile and parses. `npm run check`: 424 shared, 189 server, 57 client, build.
- Measured over 500 seeds: main paths 38,720–39,420 HP with the Warchief, about 131 enemies.
- Live (harness, **test** DB, crypt seed 2 after a seed-0 Warrens clear): the menu card, the crypt palette, skeletons and archers in the Catacomb with two-arrow volleys, a "bones" pile under the melee, the Burial vault's sarcophagi releasing skeletons. No console errors. Not play-tested: clear time, and whether piles read well in a crowd (they sit under standing enemies).
- On the user's request, gave the dev account serfdom1@test.com a level-12 Fighter (Hugh Ironside) with T5 gear rolled by the real loot rules, through the service code with a temporary script (deleted); to free the slot, retired Osric Muck (the user's choice) through the normal death path.
- User (2026-10-24): enemies do very little damage. Measured on that Fighter: DEF 45 took 18% of each hit; a skeleton did 0.6/s against 1.4 HP/s regen. User chose 40/(40 + DEF) and harder-hitting crypt undead (D-121): skeleton 8, arrows 7. Four older tests that pinned the old curve with literal numbers now compute from `DEFENSE_SCALE`. Same Fighter now: 47% of each hit; one skeleton nets −1.7 HP/s, three empty him in about 11 s. `npm run check`: 424 shared, 189 server, 57 client, build.
- User ran the 12i checklist (with D-121): pass (2026-10-24). Committed and pushed 12i (`11436fb`). Next: 12j (ghosts, necromancers, grave knights: draft for approval).

### Phase 12j — Ghosts, necromancers, grave knights — 2026-10-24

- Draft (D-120's undead redrawn on D-121's damage scale, placement, HP effect computed from the real rooms) approved as is (D-122).
- Three new kinds and their AI; `isHittable` for every player attack and auto-aim (faded ghosts); knight shields in the world step; necromancer raises applied in the world step; slams drawn like the sweep; the crypt's rooms swap in the new undead; protocol v29.
- Tests: ghosts pass through a wall at full speed, fade for 1.5 s every 3 s and only touch (10) while visible, and while faded take no hit from a shot flying through and are not auto-aim targets; necromancers raise only the pile within 250 px, as a full skeleton whose next death is final, with a raise ring, then wait 6 s; they throw 3 × 9 at 150 px/s every 3 s; knights turn 60° in 0.5 s and finish a half turn in 1.5 s, the shield stops front shots (~58° off-centre still blocked, ~62° not) with a spark and no damage while a shot from behind lands, and the slam warns, hits 18 in exactly the warned circle after 0.9 s, then waits 3 s; placements per room match the table and knights stand at the front; every main path inside the band now and with the Lich; a crypt run's snapshot sends `faded` and `facing` and parses. `npm run check`: 432 shared, 190 server, 57 client, build.
- Measured over 500 seeds: main paths 42,060–44,940 HP, no rule problems.
- Live (harness, **test** DB, crypt seed 2 after a seed-0 Warrens clear): Tomb of kings knights with shield arcs facing the player and a necromancer's skull spread; in the Hall of the dead, ghosts drawn faded, and a knight between the player and the room still at full 1200 HP because its shield took every shot. No console errors. Not play-tested: clear time, and readability in a full fight.
- User ran the 12j checklist: all pass (2026-10-24). Committed and pushed 12j (`c245029`). Next: 12k (cursed runes and spirit braziers: draft for approval).

### Phase 12k — Cursed runes and spirit braziers — 2026-10-24

- Draft (D-120's mechanics on D-121's scale, rooms, 20% thinning computed against both HP bands) approved as is (D-123). Found while drafting that the existing thinning only removes grunts and slingers; it now takes the kinds to thin.
- Runes on the room clock (a new `runeSteps`), braziers as fire-flagged arrow traps with alternating halves, rune bursts as zero-delay room hazards, protocol v30, client drawing.
- Slip on my side: an import inserted inside a multi-line import broke `dungeon-recipe.ts` for a moment; fixed before any check ran.
- Tests: the sweep order 0,1,2,1,0,1,2; a column glows 1 s then bursts 12 within 32 px of each of its runes, the next 1.2 s later, nothing between steps, nothing while dormant; a burst hits only the player on the rune, as a `runes` hazard hit, flashes, and leaves no hazard; braziers glow 0.8 s, fire evens then odds every 3 s, flagged fire, 10 damage; fireballs fly at 140, size 10, and hit as `braziers`; the six rooms carry exactly the planned runes and braziers; runes clear of the entrance side and every obstacle, in columns from the west; the Charnel pit loses exactly 4 of its 21 skeletons and archers, skeletons first, keeping its knight and necromancers; the Hall of the dead is unthinned; generated crypts carry them turned with their rooms; a run's snapshots send the glowing rune column and fireballs, and rune bursts are not drawn as boulders. `npm run check`: 442 shared, 192 server, 57 client, build.
- Measured over 500 seeds: no rule problems; main paths 37,980–41,300 HP.
- Live (harness, **test** DB, crypt seed 2): the Chapel's rune grid with a column filling red; the Catacomb's fireballs crossing the corridor (and its braziers visible through the wall from the Chapel). No console errors. Not play-tested: clear time and readability in a full fight.
- User ran the 12k checklist: pass (2026-10-24). Committed and pushed 12k (`eaba87a`). Next: 12l (the Lich: draft for approval).

### Planning docs reconciled — 2026-10-24

- Compared every planning doc with the code and git history and fixed stale facts: party size 10 (not 4), resolved GDD sections (controls, stats, slots, death rules), superseded T-entries marked, README status in order.
- Restructured: a status table at the top of the roadmap; the architecture doc opens with a current code map, with the phase-by-phase notes moved to an appendix; the testing guide keeps the workflow up front and the feature checklists in an appendix. Nothing was deleted.
- User shaped a 27-phase roadmap (D-124): a website alpha (Phase 21) before Steam; at least 10 dungeons, partying up, the home screen, a minimap, more leaderboards, rare loot, and the player-driven economy before the alpha; growth to 40 dungeons and new item kinds during it; then beta polish and Steam. New open questions 21–26.
- No code changed. Next: 12l, the Lich.

### Phase 12l — The Lich — 2026-10-24

- Draft (D-120's Lich on D-121's scale, with the details D-120 left open) approved (D-125; numbered after the reconciled roadmap's D-124, which landed on GitHub while 12l was being built).
- `lichAct` with spiral / warded / stunned and two ward lines; crystals as summons; warded counts as faded for every attack; the stun reuses dazed; final-phase runes as rune-look hazards; the Sanctum; the crypt band back to 40,000–48,000; protocol v31; boss bar labels.
- Tests: the spiral fires two arms every 0.15 s and turns 270° in 3 s; skeletons from the holes, at most 4; below 60% three crystals at their spots belonging to the Lich, the Lich not hittable or auto-aimed, rings of 16 at 0 s and 2.5 s, a 500-damage shot through it does nothing; breaking the crystals stuns it 4 s (hittable, silent), then the spiral returns with no new crystals; below 30% crystals again, then 5 runes (12, radius 32) at 160, 160, 260, 260 px and under the player, and a volley every 0.1 s; the Sanctum's layout and portal; every main path inside 40,000–48,000; boss bar labels; a run's snapshot sends rune hazards and a warded Lich with its crystals. `npm run check`: 448 shared, 193 server, 58 client, build.
- Live (harness, **test** DB, crypt seed 2, phases staged with test-only commands): the spiral; WARDED with the tethers, crystals, a ring going out, and a crystal shot down while the Lich took nothing; ENRAGED with the faster spiral and five filling runes. No console errors. Not play-tested: the fight's length and difficulty.
- User ran the 12l checklist: pass (2026-10-24), and asked for the roadmap updates on GitHub (PR #1, the 27-phase roadmap) to be reviewed. 12l's docs were rewritten into the reconciled structure.
- Next step: the Phase 12 acceptance review against the roadmap.

### Roadmap review — 2026-10-24

- Reviewed PR #1's 27-phase roadmap against the code. User's answers (D-126): potion wording corrected to the serf's max (D-119); Phase 12 acceptance includes a two-player clear; Phase 14 builds minimal party screens, polished in Phase 15; the first 5 dungeons cover levels 1–20 and every later one is for level 20 and up (answers open question 24); Phase 13 builds reusable building blocks for Phase 22's dungeons.
- Next step: the Phase 12 acceptance review, with a two-player clear of the Stronghold and the Crypt.

### Phase 12 acceptance review — 2026-10-24

- **Completed solo and by a party, loot and EXP as approved:** pass (automated). New server tests run two real clients through the Stronghold and the Crypt together: same run, the boss scaled for two, both complete through the portal, each gets the dungeon's EXP for their own level (`clearExp`), one chest each from the dungeon's own tiers (T2–T4, T3–T5), and at most one potion each. Solo clears: the user's 12a–12l checklists. Loot and EXP tables: unit tests per dungeon.
- **Entry refused without a Warrens completion, tampered queue included:** pass. The Stronghold test is joined by the same test for the Crypt (a hand-made queue message is refused; one completion opens it).
- **Potions granted once per roll, never above the serf's max, survive death:** pass (storage contract on memory and PostgreSQL, service, and network tests: rolls, caps, single drink, the rack outliving a dead serf).
- **The server decides every potion, drop, and EXP award:** pass by construction: clients have no message that can name a reward; rewards come only from `SerfService.recordRun` on the server, and every drink is re-checked in the account-locked write.
- `npm run check`: 448 shared, 196 server, 58 client, build.
- Not done by hand: a two-person clear in two browser windows (the automated test uses two real clients against the real server).
- Next step: the user decides whether to close Phase 12 (optionally after a two-window clear), then Phase 13 (tier 4: draft for approval).

### 32×32 serfs and enemies, zoomed-out view — 2026-10-24

- The user moved the player to 32×32 (PR #3, merged as `5fb2f98`: sprite, body, 31×31 hurtbox, debug-world gaps, a 76-map reachability test). Asked what else follows (D-127): ordinary enemies 32, bigger ones doubled; camera zoom 0.5; floor hazards hit on hurtbox overlap.
- Found and fixed along the way: every dungeon failed to build (the Stronghold's doubled rooms had no free spot for 32 px spawns at 1.5× spacing: now non-overlapping, searched to 240 px); the Barracks dropped out of Stronghold maps (two slingers inside the bunks: moved to the aisles); 32 px goblins stuck on walls following an 8 px-clearance path grid (16 px now), and brutes and knights stuck between rooms (a second 22 px grid, `SizedNavigator`); buff rings hidden under the 32 px sprite; the debug visibility box drawn as if at zoom 1; a Volley test whose dummy grew; a server test with the dummy's old size typed in.
- Tests: sizes per kind; `circleHitsPlayer` at the box edge and corner; a boulder hitting through the hurtbox edge; 44 px knights reach the boss room in all three dungeons; the zoomed view's extent (720 × 640, past 300) and `px`. `npm run check`: 457 shared, 196 server, 59 client, build.
- Live (harness, **test** DB): the fixed Warrens' Tunnel with 32 px grunts, the Catacomb, and the Sanctum's 88 px Lich at the new zoom, labels readable, the corrected 300 px debug box. No console errors. Not play-tested: how fights feel with bigger hitboxes, and readability of the now half-size bullets.
- User ran the D-127 checklist: pass (2026-10-24). Committed and pushed as `f42ecbc`.

### Phase 12 closed — 2026-10-24

- The user closed Phase 12 after the acceptance review (all four criteria passed; the two-window party clear stays covered by the automated two-client tests).
- Next step: Phase 13, starting with the tier-4 dungeon (about levels 15–18): theme first, then a draft for approval.

### The Lich's sprites (D-128) — 2026-10-24

- The user supplied the Lich's art (8 directions × idle and a spinning attack, 32×32) and made the Lich human-sized: 32×32 (D-128, was 88).
- First image pipeline: files under `client/src/assets/sprites/<character>/<state>/<direction>.png` load by themselves (`sprite-files.ts`, `WorldScene.preload`). Hit flash and stun blink are tints.
- The user: he spins only during his attack, otherwise stands idle (D-129), keeping the nonstop spiral. The server marks the Lich `firing` while its spiral fires and for a 0.5 s turn with each ring, and sends `spinning` plus `facing`: the spiral angle while it spins, else toward the nearest player (protocol v32). Asked how idle facing works in a party, the user chose the server picking the player, so every screen shows the same.
- Tests: file paths to keys (and bad paths refused), angles to the 8 directions, the Lich's pose, the Lich's size, idle before its first volley then spinning, a quick turn with each ring then idle, idle while stunned, `facing` in the snapshot. `npm run check`: 459 shared, 197 server, 64 client, build.
- Live (headless Chrome, a throwaway page, not committed): all 16 frames loaded at zoom 0.5 beside a 32 px square, crisp, no console errors. Not checked live: the Lich in the Sanctum (spin, warded, stun), how the smaller Lich fights.
- Extra Lich art made by Claude from the user's frames (warded outline, fade, death, spawn, bolts, soul crystal) is in the project files for review, not in the game.

### Phase 13a — The Ember Forge — 2026-10-24

- Asked the theme first (D-126 left it open): the user chose a burning forge. Drafted from the real formulas (975 EXP from 15 to 18; a level-15 serf with T4 deals about 1.29× a level-12 serf with T3) and approved as is (D-130), with four build slices and the first reusable building blocks.
- 13a: `ember-forge.ts` (11 rooms with spawns placed by `fill`, the Lich standing in), registered with EXP, loot, potions; imps and casters reuse the skulker and bomber behaviours through specs; lava channels (room geometry like sludge, a burn on the world step, wall for enemies, path grid built round it, validation); protocol v33 (merged with the Lich sprites' v32); the forge palette and lava drawing.
- Slip on my side: one edit script stopped at an anchor Prettier had re-wrapped; I checked which files it had already written and reran only the rest.
- Tests: listed with the entry rule; EXP 240 to 18 then less; loot only T4–T6; potions 40%; 11 rooms of imps and casters at their band HPs; every main path 54,060 (inside 49,000–59,000, and 57,060 with the Forgemaster, inside 52,000–62,000); 1,000 seeds follow the rules (no spawn in lava or an obstacle); no wall gaps; seeds rebuild; an imp hits 10 per 1.2 s and gets ahead of a runner where a grunt trails; a caster's lob (10, then 3 every 0.5 s for 3 s); lava burns a player whose hurtbox reaches its edge twice in a second and nobody clear of it; an imp chasing across a strip never enters it; a forge run loads its lava and a player standing in it burns. Measured: imps from both corners of every room on six seeds all reach the boss room, none ever in lava. `npm run check`: 466 shared, 197 server, 59 client, build.
- Live (harness, **test** DB, forge seed 2 after a Warrens clear): the Ember Forge card; the Foundry's two lava strips with imps and casters; the Slag pit's imps flowing round its lava cross and a caster's fire under the player. No console errors. Not play-tested: clear time; imps' red-orange is close to the lava's orange.
- Next step: user runs the 13a checklist; then 13b.

### Merging the Lich's sprites — 2026-10-24

- The user asked for the sprite branch (`claude/project-thread-vl3mba`: the Lich's 16 frames, a 32 px Lich, D-128 and D-129) merged locally to test. Committed the untested 13a locally first, then merged. Conflicts: both sides took protocol v32 (now v33); the forge's decision renumbered D-128 → D-130; both test blocks and doc entries kept.
- Bug found live and fixed: the branch's new sprite loading (`preload`) means the world scene is created a few frames after the page starts asking it for the HUD readout every frame, so `getDebugState` threw on every frame and the page stayed on "Connecting…". The scene now says when it is `ready`; the per-frame readout, key capture, and the first layout report wait for it.
- Live (harness, **test** DB): the Lich drawn with its sprite in the Sanctum, spiralling and warded. Small on screen (a 32 px sprite at the 0.5 zoom is 16 CSS px).
- Not pushed: 13a and the merge wait for the user's test.

### Bigger window, closer camera — 2026-10-24

- User: the 32×32 Lich looked tiny. Measured: at D-127's 0.5 zoom every 32 px sprite drew at 16 CSS px. Offered window sizes and zooms with their trade-offs (zoom 0.75 would scale 32 px art to 24 unevenly); the user chose 1200×800 with the HUD kept 240 wide, and zoom 1 (D-131).
- `layout.ts`, `style.css`, `CAMERA_ZOOM` = 1; the confetti falls past the taller box; tests for the new layout and view.
- `npm run check`: 468 shared, 198 server, 65 client, build.
- Live (harness, **test** DB, a 1280×920 Chrome window): the container measured 1200×800, HUD 240×800, gameplay 960×800; the menu with all four dungeon cards fits; the Lich at full 32 px in the Sanctum, crisp. No console errors.
- User ran the D-131, Lich sprite, and 13a checks: all pass (2026-10-24). Pushed 13a, the sprite merge, its fix, and D-131 together.
- Next step: 13b (fire elementals, magma golems, bellows-keepers).

### Phase 13b — Fire elementals, magma golems, bellows-keepers — 2026-10-24

- Drafted the placement and the rules from D-130's numbers (which room gets which, and how the HP band moves): the user approved it as D-132.
- Three new building blocks: the exploder (`elementalAct`, a fuse state), the armour cycle (`golemAct` plus a multiplier in `damageEnemy`, so every attack respects it), and the healer (`shamanAct` generalised with a `SupportSpec`; heals applied by the world step). The forge's `withNewcomers` swaps them into the rooms. Protocol v34.
- Found by the tests: the golem's vent cycle was 7.5 s (its timer paused while venting); now a fixed 6 s.
- Found live: the elemental's first placeholder colour (yellow) hid the yellow warning blink; it is red now.
- An elemental that explodes does not count in "Enemies slain" on the results screen (the only thing a kill affects: EXP and loot come from clearing the dungeon). I first wrongly described this as EXP and loot.
- `npm run check`: 479 shared, 199 server, 65 client, build.
- Live (harness, **test** DB, 1280×920 Chrome): an elemental rushed, blinked yellow, exploded (an orange disc; the player took 14) and was gone; a venting golem glowed orange; a bellows-keeper's orange ring healed a hurt grunt about 5 HP a second (3% of 170). Not checked live: walking through real forge rooms (the room contents are unit-tested over 1,000 seeds), two players.
- User ran the 13b checklist: all pass (2026-10-24).
- Next step: draft 13c (fire jets, slag spills).

### Phase 13c — Fire jets and slag spills — 2026-10-24

- Drafted the rooms, timings, beam width, and thinning from D-130's mechanics; the user approved it as D-133.
- Built on the existing traps: fire jets are a third kind of arrow trap whose volley makes beams (a new `Beam` in the simulation, ray-cast to the first wall or obstacle), and slag spills are rockfall with burning floor attached. Room fires now remember they are the room's, and one helper, `hazardDamage`, turns any room hit into a hazard hit. Protocol v35.
- `npm run check`: 489 shared, 199 server, 65 client, build.
- Live (harness, **test** DB, seed 2, 1280×920 Chrome): the Chain gallery's beams crossed the whole room while the pillar-aligned nozzles were blocked; the Great furnace (turned) fired west and its beam stopped at the furnace block; the Ore store's molten boulders fell and left slag fires (the probe showed `slag` hazards and fires). Not checked live: a death by either, two players.
- User ran the 13c checklist: pass (2026-10-24).
- Next step: draft 13d (the Forgemaster).

### Phase 13d — The Forgemaster — 2026-10-24

- Drafted from D-130; the user approved it, then asked for the rest of Phase 13 to be built and tested at once. Approved themes for dungeons 5–10 (Sunken Temple, Frost Hollow, Clockwork Vault, Abyssal Gauntlet, Stormspire, Dragon's Roost); level-20 entry for the endgame ones. Work is committed locally on `phase-13-rest`, pushed after the user's test.
- The user asked (mid-milestone) that test browsers no longer pop up: drivers now run headless.
- Found by the tests: slams were 5.8 s apart (the timer restarted when the hammer came down); now hammer-up to hammer-up. A slow pathing test (200 s of play on nine maps) brushed the 5 s default timeout under load; it has an explicit 30 s now.
- Found live: the shockwave was drawn past the arena's walls; it is now drawn in short arcs, only over the arena floor.
- `npm run check`: 500 shared, 199 server, 65 client, build.
- Live (harness, **test** DB, seed 2, headless): the boss walked and slammed, the ring grew with its gap, golems came out below 60%, the plates glowed round the dark lane below 30%, the boss bar said ENRAGED.

### Phase 13e — The Sunken Temple — 2026-10-24

- Dungeon 5 (levels 18–20), designed under the user's delegation (D-135, PROVISIONAL): acolytes, tide callers, spearmen, eel-priests; tide pools; the Tide Priest (surges with gaps, water bolts, whirlpools).
- Pulls and whirlpools move players, so they are announced ahead and keyed to a run clock that snapshots carry; prediction steps each input at its clock. A client test confirms a zero correction through deep water and a pull.
- The forge's spawn placement became the shared `fillRoom` (the forge's spawns are byte-identical).
- Found while building: the eel-priest's movement and the spearman's charge now reuse the slinger and the brute through specs, rather than copies.
- `npm run check`: 517 shared, 199 server, 66 client, build.
- Live (harness, **test** DB, seed 2, headless): tide pools turned deep, eel-priests tethered and pulled, surges swept the sanctum both ways, two whirlpools below 50%.
- Known issue: a full heavy room's snapshots are about 9.6 KB (640 KB/s); recorded for Phase 19.

### Phase 13f — Frost Hollow, the first endgame dungeon — 2026-10-24

- Level-20 entry for the endgame dungeons: `minLevel`, checked by the server and shown on the menu.
- Frost Hollow (D-136, PROVISIONAL): ice imps, ice wraiths (frost trails), yetis, frost archers; icicle rooms; the Frost Wyrm (breath cones, tail sweep, wraiths).
- Frost slows players, so it rides the run clock like the temple's water; a client test confirms a zero correction on frost.
- The temple's room builder became the shared `mixedRoom` (the temple's rooms are byte-identical).
- Found live: the Wyrm's breath could reach past its lair's wall; it now only hits players inside its arena (tested).
- `npm run check`: 530 shared, 199 server, 67 client, build.
- Live (harness, **test** DB, seed 2, headless): the card unlocked at level 20; icicles left frost; the breath cone filled in and frosted the floor; two wraiths came out below 50%.

### Phase 13g — The Clockwork Vault, a fixed map — 2026-10-24

- The second endgame dungeon (D-137, PROVISIONAL): the same map every run. Shielded sentries (the knight's code, now reading its numbers by kind), cog drones, floor turrets; blade arms turning in five rooms while they fight; the Automaton (plating that lets through a quarter except while it overheats, rifle bursts, a turning laser arm, drones).
- Found by a test: my own expectation of a blade's reach forgot the hurtbox's width; the rule was right.
- `npm run check`: 541 shared, 199 server, 67 client, build.
- Live (harness, **test** DB, headless): two arms turning in the Escapement with sentries' shields drawn; the Automaton's laser and overheat cycle in the Core.

### Phase 13h — The Abyssal Gauntlet, a wave arena — 2026-10-24

- The third endgame dungeon (D-138, PROVISIONAL): one arena, eight timed waves from every earlier dungeon, traps that switch on at waves 2, 4, and 6, and the Warden (spiral, charge, shockwaves).
- Found while building: a trap switched on late would have fired its whole backlog at once (its schedule runs on the room clock); waiting traps now keep their count at "now". And the waiting rockfall used the boulder's pace for slag rooms; fixed before testing.
- Found by a test: my daze test never put a wall in the charge's way; the rule was right.
- `npm run check`: 549 shared, 199 server, 67 client, build.
- Live (harness, **test** DB, headless): all eight waves came in order; braziers, runes, and slag were all running by the Warden, who spiralled, then (enraged) sent shockwave rings clipped to the arena.

### Phase 13i — Stormspire, a climb — 2026-10-24

- The fourth endgame dungeon (D-139, PROVISIONAL): a tower whose path climbs north; storm hawks, adepts, gargoyles; lightning where you stand; gusting wind; the Storm Caller (lightning on everyone, pylons that ward it and arc between them, a stun when they break).
- Wind pushes players, so it keys to the clock and the map; a client test confirms a zero correction through a gust (my first version of that test skipped the first-contact reset a real run does, and reported a 43 px correction that a run would never see).
- Found by tests: two of my own setups were wrong (a pylon test that left no pylons alive; a wind push I over-estimated); the rules were right.
- `npm run check`: 561 shared, 199 server, 68 client, build.
- Live (harness, **test** DB, headless): lightning under the player; the Storm Caller warded with its pylons, arcs warning and burning between them every 2 s, stunned once they broke. Not seen live: a gust moving a player (the harness put the player beside the channel, not in it; the movement is unit-tested and prediction-tested).

### Phase 13j — Dragon's Roost, the tenth dungeon — 2026-10-24

- The last endgame dungeon of Phase 13 (D-140, PROVISIONAL): the hardest room mix, fire drakes, and the Elder Dragon (fire breath with burning floor, tail, a wing gust that blows players back, a 14 s flight with meteors, an enraged finish). The only T10 loot.
- Found while building: a rerun of a half-applied edit script inserted the dragon twice; I restored the files and reran once, and the edit scripts now write nothing unless every change applies. Breath fire was first added before the world step's fire list existed; it is gathered separately now.
- Found by the tests: two old protocol tests used "dragon" as an example of an invalid name (now "kraken"); my push-distance guess forgot the gust ends at its edge.
- `npm run check`: 569 shared, 199 server, 69 client, build.
- Live (harness, **test** DB, headless): breath cones left fire; the gust blew the player back; at 45% it flew, faded, while meteors fell; it landed and breathed again.

### Phase 13k — Acceptance checks — 2026-10-24

- Server tests: every endgame dungeon refuses a serf below level 20, even by a hand-made queue message (a fresh player per dungeon: five refusals on one connection close it, by design); two level-20 players clear each of the seven new dungeons together, each with their own EXP and a chest from that dungeon's tiers.
- EXP pace, simulated from the real formulas: level 1 to 20 in 29 clears (Warrens 13, Stronghold 4, Crypt 5, Forge 4, Temple 3). Worth the user's eye: the Warrens take 13 of the 29, from its own approved numbers.
- `npm run check`: 571 shared, 207 server, 69 client, build.
- Phase 13 is built and committed locally on `phase-13-rest` (13d–13k), awaiting the user's combined test; nothing pushed.

### Menu fix and level-20 test serfs — 2026-10-24

- User report: the dungeon select covered parts of the menu and the list did not fit. Cause: ten 360 px cards in one column (about 1,100 px) inside the 800 px game box, which hides overflow, so the title, tabs, and the last cards were cut off. Fix: two labelled rows of five smaller cards (the ladder, levels 1–20; the endgame, level 20) in a list that scrolls if it ever grows. Measured headless: title, tabs, and all ten cards inside the box, no scrolling needed.
- For the user's Phase 13 test (dev DB, through the game's service code, temporary script deleted): a level-20 Fighter (Bran Holloway) on serfdom@test.com and a level-20 Wizard (Wynne Ashby) on serfdom1@test.com, each in T7 gear with random rolls; the user chose the classes.
- User report: the leaderboard had the same overlap. Its top 20 rows (about 24 px each) plus heading and note overflowed the space under the title and tabs. Fixed for every tab, not just this one: each tab's content is capped at 540 px and scrolls if taller; the leaderboard's rows scroll in their own 420 px box, so its heading and note stay in view; screens centre "safely" (a too-tall screen keeps its title and tabs in view instead of cutting both ends); scrollbars are dark and thin. Measured headless on all five tabs, with the board padded to 20 rows: the title, tabs, and contents all inside the 800 px box.

### Weapon attack patterns — 2026-10-24

- User request: every base weapon its own pattern, the wand the only long-range single shot. Drafted seven patterns balanced to about the wand's damage on one target; approved (D-141).
- The pattern lives in the player's combat numbers and the shared shooting rule, so prediction fires the same projectiles (tested for the bow, mace, dagger, staff). The staff's orb is the first piercing projectile. Protocol v43.
- Found by the tests: my damage check compared the mace's whole ring with the one-target limit (the ring can only put one shockwave on one enemy). A slow obstacle test brushed the 5 s timeout under a full run (now 30 s), like the pathing test before.
- `npm run check`: 577 shared, 207 server, 73 client, build.
- Live (harness, **test** DB, headless): the axe's chop, the dagger's twin stabs, the mace's ring, the bow's fan, and the staff's orb, with a 0 px correction while firing.

### Weapon attacks, redesigned — 2026-10-24

- User feedback on the first version: "melee should be slashing, maybe arrows could pierce; I don't like that most of the uniqueness just comes from more projectiles." Redrafted as different kinds of attack: the wand's bolt, the bow's piercing arrow, the staff's bursting orb, and four melee swings (a slash, a cleave, stabs, a smash); approved as is (D-141 rewritten).
- Swings are instant arc hits on the server, drawn at once on your own screen; the server sends others' swings in snapshots. One swing (or arrow, or burst) that hits several counts as one accurate shot.
- Found live: auto-aim swung only when an enemy's centre was within the reach, so a grunt pressed against a sword-wielder never got hit; auto-aim now reaches the reach plus half a body (24 px), and a test pins it. Abilities' auto-cast keeps its 300 px reach (a melee weapon must not shrink it).
- `npm run check`: 582 shared, 207 server, 76 client, build.
- Live (harness, **test** DB, headless): each weapon in turn against three grunts: the sword's wedge, the axe's half-circle, the dagger's thrust, the mace's ring, the bow, the staff, the wand; 0 px corrections.

### Melee slowed — 2026-10-24

- User feedback: "the melee stuff is too fast, they should hit harder but slower"; for reference, a level-1 Fighter with a T0 sword should swing once a second. Classes start at level 5, so the anchor is a new character's Dexterity (10): the sword swings 1/s there (a fresh level-5 Fighter, Dex 13–17, about 1.1/s). The axe (0.6/s), dagger (1.6/s), and mace (0.5/s) keep their pace relative to the sword; every melee weapon keeps its damage per second, so each blow hits 4× as hard (D-141 updated).
- User ran the combined Phase 13 test (13d–13k, the menu fixes, and the D-141 weapon attacks with slower melee): pass (2026-10-25). Phase 13 complete; `phase-13-rest` merged into `main` and pushed.
- Next step: Phase 14 (partying up): orient and draft the first slice.

### Phase 14a: forming a party — 2026-10-25

- The user chose invites by serf name (D-142) and approved Claude's party rules as drafted (D-143).
- Built: server `parties.ts` (pure rules) wired into `GameServer` (invites by name in any case, the refusals, 60 s expiry, leaving, removing, leader hand-over, dropping on disconnect or logout); protocol v44; a Party tab, an invite strip with Accept and Decline on every menu tab, and party news.
- `npm run check`: 583 shared, 227 server (13 party rules, 7 server party tests), 76 client, build.
- Live (harness, **test** DB, three headless browsers in separate contexts): A invited B by a lowercase name; B saw the strip and accepted; both showed Party (2) with A leading; an unknown name was refused with the message; B (not the leader) invited C, who joined A's party; A removed B, who was told; no console errors. The tabs still fit the box.
- Next step: the user's 14a test, then 14b (queueing as a party).
- User ran the 14a party checklist: pass (2026-10-25). Pushed.
