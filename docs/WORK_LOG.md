# Serfdom Work Log

Keep this concise and update it after each meaningful milestone.

## Current status

- [ ] Phase 0 — Repository orientation and environment _(tooling done; awaiting user clean-clone check)_
- [ ] Phase 1 — Playable local client skeleton
- [ ] Phase 2 — Movement, collision, and camera following
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
- Next step: user verifies a clean clone; then Phase 1 — Vite + Phaser + TypeScript client skeleton.
