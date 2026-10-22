# Serfdom Work Log

Keep this concise and update it after each meaningful milestone.

## Current status

- [x] Phase 0 — Repository orientation and environment
- [x] Phase 1 — Playable local client skeleton
- [x] Phase 2 — Movement, collision, and camera following
- [ ] Phase 3 — Combat prototype
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
