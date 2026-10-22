# Testing and Feedback Guide

Claude must teach the user how to verify each change. This document defines the minimum expected workflow.

## 1. The three levels of verification

### A. Automated checks

Commands the developer runs repeatedly, such as:

- Unit tests.
- Type checking.
- Linting/formatting checks.
- Build checks.

Claude must use the actual scripts in `package.json` or the repository's tooling. Never invent a command and claim it works without checking.

Current commands (run from the repository root):

| Command                                     | What it checks                                                                         | Since   |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | ------- |
| `npm ci`                                    | Installs exactly the versions in `package-lock.json`; fails on the wrong Node major.   | Phase 0 |
| `npm run format:check`                      | Every file matches Prettier formatting. Prints offending files and exits non-zero.     | Phase 0 |
| `npm run format`                            | Rewrites files to fix formatting (not a check; changes files).                         | Phase 0 |
| `npm run lint`                              | ESLint over the whole repo.                                                            | Phase 1 |
| `npm run typecheck`                         | `tsc --noEmit` in every workspace that defines it.                                     | Phase 1 |
| `npm test`                                  | Vitest unit tests in every workspace that defines them.                                | Phase 1 |
| `npm run build`                             | Vite production build of the client into `client/dist/`.                               | Phase 1 |
| `npm run check`                             | All of the above checks in order; stops at the first failure.                          | Phase 1 |
| `npm run dev`                               | Starts game server (ws://localhost:8080) and client (http://localhost:5173/) together. | Phase 4 |
| `npm run dev:server` / `npm run dev:client` | Start just one of them.                                                                | Phase 4 |

Exit codes: 0 means pass. When piping output (e.g. `| tail`), `$?` reports the last command in the pipe, not npm; use `${PIPESTATUS[0]}` in bash or run without a pipe.

### Phase 1 layout check: the HUD debug readout

The left HUD currently shows a measured readout (also printed via `console.table`):

| Row                                          | Expected at 100% browser zoom         |
| -------------------------------------------- | ------------------------------------- |
| Container / HUD / Gameplay / Canvas (CSS px) | 960×640 / 240×640 / 720×640 / 720×640 |
| Canvas backing (px)                          | 720×640                               |
| devicePixelRatio                             | Your display's value (1 = no scaling) |
| Camera zoom                                  | 1                                     |
| Visible from center                          | ±360 × ±320                           |
| ≥300 each way?                               | yes                                   |
| HUD/gameplay overlap?                        | no                                    |

Mismatched sizes also log a `[layout] … expected …` warning in the console. Note: "≥300 each way?" describes what the camera renders. If the browser window is smaller than the container, part of the view is scrolled off-screen; that is the PROVISIONAL small-window behavior (T-012).

The HUD "Live" section (Phase 2) updates every frame. "Player on screen" must read **360, 320** (center of the 720×640 canvas) at all times; "Camera center (world)" equals the player position rounded to whole pixels.

### Phase 2 movement/collision map

Debug map (`client/src/test-world.ts`), player starts at (1000, 1000), speed 150 px/s:

| Feature                | Where (world px)                           | Expected                                              |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Square block           | x 1100–1164, y 900–964 (up-right of start) | Blocks on every face; slide along it diagonally       |
| L-shaped inside corner | wall x 868–900 / floor y 1150–1182         | Pushing S+A into it stops cleanly, no jitter          |
| Wide gap (24 px)       | between x 1200 and 1224 at y 1250          | Player (16 px) fits through                           |
| Narrow gap (12 px)     | between x 1200 and 1212 at y 1400          | Player cannot pass                                    |
| Border walls           | 32 px thick at the world edge              | Player stops at x/y = 40 or 1960; void (black) beyond |

Rotation (Phase 3a): hold Q/E to turn the view at 120°/s; Z snaps back to 0°. HUD "View rotation" shows the angle. At any angle: W moves up the screen, "Player on screen" stays 360, 320, the player sprite stays upright and crisp, and the green box and blue ticks stay square to the screen. Expected cosmetic artifact: floor, walls, and grid labels look jagged while rotated.

Shooting (Phase 3b): target dummy at (1300, 1100), 500 HP, just outside auto-aim range from the start. HUD rows: Fire mode (T), Dummy HP, Shots in flight, Shots/hits/blocked, Dummy defeats, Mouse (world). Expected: Auto aim fires only with the dummy within 300 px; 4 shots/s; 20 hits defeat it; it respawns after 3 s; Auto fire shoots toward the mouse without clicking; Manual fires only while left click is held; standing at about (1090, 890) (top-left of the square block) every auto-aim shot is blocked. Shots already in flight still land after you switch modes.

Enemy attacks and death (Phase 3c): within 300 px the dummy fires 8 orange bullets in a ring (first one east) every 2 s; each hit does 20 (player flashes red); 10 hits = death at 200 HP. HUD rows: Player HP, Hits taken / deaths, In flight (yours/enemy). Standing directly west of the dummy at (1075, 1100) every ring hits you; standing between ring lines at about (1162, 1045) none do. While dead: no movement or shooting, centered message "You died — prototype respawn in …s"; after 2 s you are back at (1000, 1000) with 200 HP, bullets cleared, dummy at full HP.

Multiplayer presence (Phase 4a): with `npm run dev` running, each tab's HUD shows `Server: connected as #N` and `Online (guest ids)`. Opening a second tab adds an id in both tabs; closing it removes it. Stopping the server shows `offline (retrying)`; restarting it reconnects automatically within ~2 s. The server terminal prints `guest #N joined/left (K online)` and never IP addresses. Server integration tests (`server/src/game-server.test.ts`) cover handshake, presence, disconnect cleanup, protocol mismatch, malformed/unknown/binary/oversized messages, the invalid-message limit, hello timeout, and port-in-use.

Automated browser check used by Claude (not committed): headless Chrome driven via the DevTools protocol, holding keys and reading the HUD.

### B. Manual feature tests

The user launches the app and performs a short sequence of actions. Instructions must include:

- Where to run the command.
- Which URL/window to open.
- Exactly what to click or press.
- What should happen.
- What should not happen.
- How to collect logs if it fails.

### C. Integration and multiplayer tests

As the architecture grows, test boundaries between systems:

- Two browser clients see synchronized state.
- Server restart and persistence.
- Invalid client requests are rejected.
- Browser and desktop clients share a party.
- Rewards and inventory remain consistent.

## 2. Required test instructions for each milestone

For every delivered milestone, Claude should provide:

1. **Prerequisites:** Any required runtime, database, or services.
2. **Start commands:** Exact commands and the directory to run them from.
3. **Open:** Exact URL or application to open.
4. **Test steps:** Numbered, concrete actions.
5. **Expected result:** What a correct result looks like.
6. **Failure signs:** Specific symptoms to watch for.
7. **Logs:** Where to find browser console, terminal, server, or database errors.
8. **Report back:** What exact information to paste into chat.

## 3. How to report a bug to Claude

When something fails, send:

- The milestone/feature being tested.
- Steps to reproduce, in order.
- Expected behavior.
- Actual behavior.
- Exact error text (copy/paste, do not paraphrase if possible).
- Browser console errors and relevant terminal/server logs.
- Whether it happens every time.
- What changed immediately before the issue appeared.

Screenshots or short recordings are useful for visual problems. Remove secrets, access tokens, passwords, private data, and personally identifying data from logs before sharing.

## 4. Claude's bug-fix loop

Claude should:

1. Restate the observed failure and reproduction steps.
2. Identify the likely layer: UI/rendering, input, game rule, networking, server, persistence, or environment.
3. Reproduce the issue with a test or local run where possible.
4. Make the smallest targeted fix.
5. Add a regression test when practical.
6. Run the relevant checks and report real results.
7. Give the user the same manual steps to verify the fix.
8. Avoid unrelated refactors while fixing a bug.

## 5. Testing principles for Serfdom

- Test pure game rules without opening the game when possible.
- Test both successful and invalid actions.
- For multiplayer, use at least two clients as soon as that is practical.
- Test party size, disconnects, death, and completion boundaries.
- Verify the server owns consequential state.
- Test randomized systems with controlled seeds or injected random sources when practical.
- Do not rely only on “it looks right.”
- Do not call an untested feature complete.
- For cross-platform tests, use browser and desktop clients connected to the same backend.

## 6. Early-stage manual checklist

When a browser prototype exists:

- [ ] App loads without a blank screen.
- [ ] Browser console has no unexpected errors.
- [ ] Player is visible.
- [ ] Input responds.
- [ ] Player behaves correctly at boundaries.
- [ ] Refresh/restart behavior is understood.
- [ ] No unrelated behavior regressed.
- [ ] Automated checks pass.

When multiplayer exists:

- [ ] Two clients can connect.
- [ ] Each client sees the other.
- [ ] Actions appear consistently on both clients.
- [ ] Disconnecting one client does not crash the server.
- [ ] Invalid messages do not crash or corrupt the game.
- [ ] A client cannot award itself arbitrary damage, XP, gold, or items.

When persistence exists:

- [ ] Data survives server restart.
- [ ] Users cannot access another account's characters.
- [ ] Duplicate requests do not duplicate rewards.
- [ ] Invalid transactions fail without partial updates.

## 7. Work log format

At the end of a meaningful session, update `docs/WORK_LOG.md` with:

- Date.
- Phase/milestone.
- What changed.
- Commands/checks run and results.
- Manual test status.
- Known bugs.
- Next smallest step.

## 8. Initial layout, sprite, and camera verification

For Phase 1 and Phase 2, Claude must give executable manual instructions and expected outcomes for:

- Inspecting the game container: 960×640 CSS pixels at target desktop size.
- Inspecting fixed HUD: 240×640 CSS pixels, on the left, with no gameplay overlap.
- Inspecting gameplay viewport: 720×640 CSS pixels, to the right.
- Confirming the player uses a 16×16 source-pixel sprite and stays crisp.
- Checking camera centering relative to gameplay viewport, not total window.
- Using a world-coordinate grid/debug overlay to verify at least 300 world pixels visible in each cardinal direction during normal play.
- Moving the player to verify camera following and fixed HUD.
- Checking camera behavior near map boundaries.
- Resizing the browser to observe clipping, visibility, and HUD placement.
- Recording actual results and screenshots/logs where helpful; do not claim checks passed unless performed.

CSS pixels, world pixels, sprite pixels, and device pixels must not be conflated in tests. If camera smoothing or clamping changes centering at edges, explain the expected exception.
