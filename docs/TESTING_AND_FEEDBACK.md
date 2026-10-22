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

| Command                | What it checks                                                                       | Since   |
| ---------------------- | ------------------------------------------------------------------------------------ | ------- |
| `npm ci`               | Installs exactly the versions in `package-lock.json`; fails on the wrong Node major. | Phase 0 |
| `npm run format:check` | Every file matches Prettier formatting. Prints offending files and exits non-zero.   | Phase 0 |
| `npm run format`       | Rewrites files to fix formatting (not a check; changes files).                       | Phase 0 |

Type checks, lint, unit tests, and build arrive in Phase 1.

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
