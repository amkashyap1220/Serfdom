# Serfdom Work Log

Keep this concise and update it after each meaningful milestone.

## Current status

- [x] Phase 0 — Repository orientation and environment
- [x] Phase 1 — Playable local client skeleton
- [x] Phase 2 — Movement, collision, and camera following
- [x] Phase 3 — Combat prototype
- [ ] Phase 4 — Authoritative multiplayer foundation
- [ ] Phase 5 — Shared combat and enemies
- [ ] Phase 6 — Dungeon vertical slice
- [ ] Phase 7 — Account and persistent data
- [ ] Phase 8 — Progression and permadeath
- [ ] Phase 9 — Equipment and rewards
- [ ] Phase 10 — Classes and class abilities
- [ ] Phase 11 — Dungeon variety and procedural assembly
- [ ] Phase 12 — Economy and account systems
- [ ] Phase 13 — Desktop wrapper and cross-play proof
- [ ] Phase 14 — Release hardening

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
