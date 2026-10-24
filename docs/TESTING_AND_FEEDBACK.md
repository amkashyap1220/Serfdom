# Testing and Feedback Guide

Claude must teach the user how to verify each change. This document defines the minimum expected workflow (§1–§8); the manual checklist for every built feature is in the Appendix.

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
- Confirming the player uses a 32×32 source-pixel sprite (D-127) and stays crisp.
- Checking camera centering relative to gameplay viewport, not total window.
- Using a world-coordinate grid/debug overlay to verify at least 300 world pixels visible in each cardinal direction during normal play.
- Moving the player to verify camera following and fixed HUD.
- Checking camera behavior near map boundaries.
- Resizing the browser to observe clipping, visibility, and HUD placement.
- Recording actual results and screenshots/logs where helpful; do not claim checks passed unless performed.

CSS pixels, world pixels, sprite pixels, and device pixels must not be conflated in tests. If camera smoothing or clamping changes centering at edges, explain the expected exception.

## Appendix — Feature checklists

One checklist per built feature, newest first, after the two Phase 1–2 references. Run the newest one for the milestone being delivered. Before closing a phase, rerun the checklists of that phase. Two-client checks live in the Phase 5 and Phase 6 lists.

#### Phase 1 layout check: the HUD debug readout

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

#### Phase 2 movement/collision map

Debug map (`shared/src/test-world.ts`), player starts at (1000, 1000), speed 150 px/s:

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

Shared movement (Phase 4b): with two **separate windows** side by side (browsers pause background tabs, so a hidden tab stops updating), each HUD shows `Movement: server-authoritative`. Other players are blue squares labelled `#id`; the HUD row `Others (world)` lists their positions. Moving in one window moves its blue square in the other within ~0.1 s. `Pending / correction` should stay at a few pending inputs and ~0.00 px correction; a growing correction means client and server disagree. Stopping the server switches back to `local (offline)` movement.

Network delay (Phase 4c, D-042 target < 100 ms excluding network travel): Claude measures with two visible Chrome windows driven over the DevTools protocol (script kept outside the repo): (1) **steady lag** — while A walks at 150 px/s, distance between A's own position and where B draws A, divided by speed; (2) **first movement** — key press in A until B's drawing of A changes; (3) **path wobble** — dense samples of B's drawing of A over 1 s fitted to a straight line; (4) A's `Pending / correction` while moving. Latest results (localhost): steady lag 53–60 ms median, worst 70 ms; wobble ≈ 0.3 px; 0 corrections. By eye: the other window's square should trail only slightly and move evenly.

Death flow (Phase 5a, D-046 prototype): at 0 HP the player disappears and a centered message reads "You died / Main menu (placeholder) / Press Enter to play again"; there is no automatic respawn. Enter returns with 200/200 HP (offline: at the start; online in 5a: where the server has you). The dummy is not reset. Party HP scaling (D-045) is covered by shared tests; it only becomes visible once combat is on the server (5b).

Shared combat (Phase 5b): with two windows, HUD `Movement + combat: server-authoritative`. Both windows show the **same** dummy HP at all times; its max HP follows D-045 for the number of living players (1→500, 2→750, 3→1000, 4→1250 since 6d). Your shots appear instantly; the dummy's HP drops ~20 ms after a shot visibly lands (measured 17–22 ms median). The other window sees your shots and the dummy's rings. Dying shows the placeholder menu; the other window stops drawing you; Enter puts you back at (1000, 1000) with 200 HP. HUD `Snapshot size / rate` shows bandwidth (~0.4 KB idle, ~2 KB / ~130 KB/s mid-fight).

#### 32×32 and the zoomed-out view checklist (D-127)

Restart `npm run dev` (no protocol change) and reload.

1. **View:** the camera shows about twice as much world as before; whole rooms fit on screen. The player stays centred. The debug box (green) is 300 CSS px across and the player sits in its middle.
2. **Sizes:** the player and ordinary enemies (grunts, slingers, skeletons, archers, ghosts, …) are the same size; brutes and knights are a bit bigger; the Warchief and the Lich are large.
3. **Readability:** HP numbers over enemies, room names, and other players' #ids read as before (not tiny); wall outlines and rings are as thick as before. Buff rings (Battle Cry, Guard, Inspiration) show just outside your square.
4. **Walls and doors:** you and every enemy fit through every doorway; brutes and knights follow you between rooms when you rush.
5. **Hazards:** a boulder, bomb, rune, sweep, or slam hits you if its circle touches any part of your square.
6. **Aiming:** manual aim with the mouse still fires exactly where you click.

Report: pass/fail per step, and whether anything now looks too small (bullets are drawn at half their old screen size).

#### The Lich checklist (Phase 12l, D-125)

Restart `npm run dev` (protocol v31) and reload. Play the Forgotten Crypt to its last room, the Sanctum.

1. **Sanctum:** an open room, 4 dark sarcophagi in the walls, a large violet Lich in the middle. The bar reads "The Lich" with two notches (60% and 30%).
2. **Phase 1:** a two-armed spiral of bullets turns out of it (8 each); every 12 s two skeletons climb out of the sarcophagi (never more than 4).
3. **Below 60%:** the bar says WARDED, the Lich turns see-through, and violet lines join it to 3 light-blue soul crystals. Your shots pass through it; it fires rings of 16. Break all 3 crystals: the bar says STUNNED for 4 s and it takes hits without attacking.
4. **Below 30%:** the same again; after that stun the bar says ENRAGED, the spiral is faster, and red circles fill in under you and around it every 1.5 s (12 if you stay in one).
5. When it dies the portal opens where it floated. Deaths name it ("Slain by the Lich").
6. Time a full clear and tell me your level (expected about 7–8 min at level 12).

Report: pass/fail per step, clear time and level, and whether each phase is readable and fair.

#### Runes and braziers checklist (Phase 12k, D-123)

Restart `npm run dev` (protocol v30) and reload. Forgotten Crypt.

1. **Cursed runes** (Chapel, Embalming room, Charnel pit): faint red circles cover the floor. Once the room wakes, one column at a time fills in red for 1 s and then flashes: standing on one costs 12 before Defense. The glowing column moves across the room and back about every 1.2 s.
2. **Spirit braziers** (Catacomb on its far wall, Burial vault on the north wall, Tomb of kings on the south wall): round marks on the wall; every 3 s half of them glow, then send slow blue-white fireballs straight across (10 before Defense). The other half fires next time, so the gaps switch. Tombs, slabs, and pillars stop them.
3. Deaths name them ("Slain by a cursed rune", "a spirit brazier").
4. Those six rooms should feel a little less crowded than before (20% fewer skeletons and archers).
5. Time a full clear and tell me your level (expected close to 7 min at level 12).

Report: pass/fail per step, clear time and level, and whether the runes and braziers are readable and fair.

#### New undead checklist (Phase 12j, D-122)

Restart `npm run dev` (protocol v29) and reload. Forgotten Crypt.

1. **Ghosts** (pale blue; Catacomb, Chapel, Hall of the dead) float straight through walls and pillars toward you. Every few seconds one turns see-through for 1.5 s: your shots pass through it, auto-aim ignores it, and it cannot hurt you. Visible, its touch hits for 10 before Defense.
2. **Necromancers** (purple; Ossuary, Burial vault, Charnel pit, Tomb of kings) keep their distance and throw 3 slow skulls you can dodge (9 each). When a skeleton lies as a bone pile near one, a purple ring flashes and the skeleton stands up whole; shattering piles first stops this. A raised skeleton does not leave a second pile.
3. **Grave knights** (dark steel, bigger; Embalming room, Charnel pit, Hall of the dead, Tomb of kings) show a white shield arc on the side facing you. Shots into the shield make a small spark and do nothing; circle round (it turns slowly) and shoot its back or side. Up close it flashes yellow, a red circle fills in front of it, and after 0.9 s it slams that circle for 18.
4. Deaths name them ("Slain by a Ghost", "a Necromancer", "a Grave Knight").
5. Time a full clear and tell me your level (expected about 7.5–8 min at level 12).

Report: pass/fail per step, clear time and level, and whether each new enemy is readable and fair.

#### Forgotten Crypt checklist (Phase 12i, D-120)

Restart `npm run dev` (protocol v28) and reload. Any serf that has completed the Warrens can enter (it is aimed at levels 12–15).

1. The Dungeons tab lists **Forgotten Crypt**, "Levels 12–15 · 6–8 min · opens after the Warrens". A serf that has not completed the Warrens sees it locked.
2. The crypt looks different: cold grey-blue floor, bone-white walls, darker stone slabs and pillars. The first room is the Crypt gate; the HUD shows the seed.
3. **Skeletons** (pale bone) walk at you and hit for 8 before Defense (D-121). Kill one: it drops into a small dim square labelled "bones". Leave it, and after 4 s it stands up with half its HP. Shoot the pile instead and it is gone for good. A room is not cleared while a pile lies there.
4. **Skeleton archers** (tan) keep their distance and fire 2 arrows at a time (7 each before Defense), aimed where you are running.
5. **Defense (D-121)**: with a high-Defense serf (e.g. a Fighter in plate), hits should now clearly hurt; two or three skeletons on you should out-damage your regeneration. A fresh Serf in the Warrens should feel unchanged.
6. **Sarcophagi**: in the Ossuary (its doors shut until cleared) and the Burial vault, once the first wave is dead, skeletons climb out of dark gaps in the walls, 2 at a time.
7. The last room is the Sanctum, with the Goblin Warchief standing in as the boss; its death opens the portal. Rewards: T3–T5 items, and sometimes a stat potion.
8. Time a full clear and tell me your level: the target is about 7 minutes at level 12 (it is a little easier until the Lich replaces the Warchief).

Report: pass/fail per step, clear time and level, and whether the bone piles feel fair and readable.

#### Stat potions checklist (Phase 12h, D-118)

Restart `npm run dev` (protocol v27, migration 010 runs on start) and reload. You need a serf that has completed the Warrens (a class is not needed, D-119).

1. Clear the **Goblin Stronghold** a few times. About 1 clear in 5 (per Luck point) shows "1 stat potion" under the chest: a gold card such as "Potion of Attack, +1 ATK, up to the class max", "→ Potion rack".
2. Click **Drink on <serf> (ATK x/y)**: the card says "Drunk by <serf>", and the Serfs tab shows that stat up by 1 (HP or MP by 5).
3. **Potion rack** tab: undrunk potions grouped by stat ("×2"), each with a drink button per living serf showing current/max, and "Pour out one".
4. A stat already at its max shows the button greyed out with the reason. A Serf without a class drinks up to the Serf max (HP 32, MP 18, the rest 14; the button shows e.g. ATK 10/14); a Defense potion says a Serf needs a class first. After choosing a class, the same stats show the class max and can go higher.
5. Clearing the Warrens never gives potions.
6. While queued, drinking is refused; pouring out still works.
7. (Optional, slow) Fill the rack to 20: the next potion says "Rack full", the Dungeons tab blocks that serf until you drink or pour one out, then the waiting potion moves into the rack.

Report: pass/fail per step, how many Stronghold clears gave how many potions, and whether the rack screen is easy to use.

#### Goblin Warchief checklist (Phase 12g, D-117)

Restart `npm run dev` (protocol v26) and reload. Play the Goblin Stronghold to the War hall (the last room).

1. **War hall:** 4 stone pillars, 4 dark holes in the top and bottom walls, a deep crimson boss in the middle. The bar at the top reads "Goblin Warchief" with two white notches (66% and 33%).
2. **Axe sweep:** get close. It flashes yellow and a red circle fills in just in front of it; after 0.8 s comes a white flash and 8 damage if you were inside. Step out of the circle during the warning and it misses.
3. **Throwing axes:** every 3 s, a fan of 3 bullets at you (6 each).
4. **Below 66%** (the label adds "WAR CRY"): it flashes yellow for 1 s, then charges in a straight line (10 damage). Dodge sideways so it hits a pillar or wall: it stops and stays still for 2.5 s with no attacks. Every 10 s, 2 skulkers come out of the holes; never more than 4 at once.
5. **Below 33%** (label "ENRAGED"): attacks come faster, and every few seconds a ring of 20 slow bullets spreads out from it (5 each).
6. When it dies, the portal opens where it stood. Death names it ("Slain by the Goblin Warchief").
7. A shaman's gold chant ring (12e) now shows too (it was silently dropped before).

Report: pass/fail per step, your level and class, how long the fight took, and whether each attack was readable and dodgeable.

#### Fewer goblins checklist (Phase 12f, D-116)

Restart `npm run dev` and reload.

1. Rooms with a mechanic (boulders, rubble, pillars, sludge, holes, arrows) have noticeably fewer grunts and slingers than before; brutes and the Stronghold's new goblins are all still there.
2. Time a Warrens run solo (target 3–5 min) and a Stronghold run at about level 9 (target about 6 min). Tell me the times and your level.
3. Rooms should still feel dangerous because of the mechanics, not because of the crowd. Tell me any room that now feels empty or still too crowded.

Report: clear times, levels, and room-by-room impressions.

#### New goblins checklist (Phase 12e, D-115)

Restart `npm run dev` (protocol v25) and reload. Stronghold only.

1. **Skulkers** (dark teal; Gatehouse, Goblin kitchen, Armory): run in a line and they come at you from the front, not from behind.
2. **Bombers** (rust brown; Goblin kitchen, War camp): they hang back and lob a small sparking bomb at where you are going; a shadow shows where it lands. It hits (4) and leaves a flickering patch of fire for 3 s that hurts while you stand in it.
3. **Shamans** (pale gold; War camp, Barracks, Brute pit): they never attack and keep their distance. A gold ring pulses from them; goblins near them glow red and hit harder. Kill the shaman and the glow fades within 5 s.
4. Deaths name the goblin ("Slain by a Goblin Bomber", which includes its fire).

Report: pass/fail per step, seeds, and whether each new goblin is readable.

#### Rushing and gated rooms checklist (D-114)

Restart `npm run dev` and reload.

1. Every door is open from the start (HUD **Doors closed** 0). Run straight through rooms: each one wakes as you enter and its goblins follow you out through the doorways (none should stay pressed into a corner), so you gather a train.
2. **Ambush hall** (and the Stronghold's Barracks): once you are inside and clear of the doorway, both its doors shut (Doors closed 2) until every goblin in it (including the ones from the holes) is dead.
3. The boss room's door stays open. Kill the Warlord: the portal opens even if you rushed past earlier rooms. Step in to complete (EXP and chest as before).
4. Retreat still works through any open door.

Report: pass/fail per step, seeds, and how rushing feels.

#### Arrow traps and sludge checklist (Phase 12d, D-113)

Restart `npm run dev` (protocol v24) and reload.

1. **Sludge** (Fungus grotto, both dungeons): two murky green pools. Walk into one: you slow to about 60% (grunts keep their pace). No stutter or snap-back while wading (watch **Pending / correction** stay near 0.00 px).
2. **Arrow traps** (Stronghold Gatehouse): small dark slits along one wall. While the room fights they glow orange, except three side by side; then arrows fly across the room. Stand in front of the dark slits (the gap) and the volley misses you. A new gap each volley, every 3.5 s.
3. Arrows hurt (6, less with Defense), stop at the barricades (shelter behind one), and stop when the room is cleared.
4. Death by arrows (optional): "Slain by an arrow trap".

Report: pass/fail per step, seeds, and how the Gatehouse felt.

#### Obstacles checklist (Phase 12c, D-112)

Restart `npm run dev` (protocol v23) and reload.

1. **Collapsed passage** (Warrens): three pale stone rubble piles down the middle. You cannot walk or shoot through them; neither can goblins' rocks.
2. **Guard room**: four pillars. Hide behind one: rocks hit the pillar. Slingers then step sideways to get a clear throw; grunts and brutes walk round the pillars to reach you (they do not stick to the far side).
3. **Brute daze**: stand behind a pillar while a brute charges (it flashes yellow first). If it slams into the pillar it blinks pale blue for about 1.5 s, then stands a moment more before walking again.
4. **Stronghold**: the Gatehouse has two barricades with a gap between; the Barracks has rows of bunks at the back, and its reinforcements still come out of the holes behind them.
5. Doors are never blocked; every part of a room can be reached.

Report: pass/fail per step, seeds, and anywhere a goblin gets stuck on an obstacle.

#### Room mechanics checklist (Phase 12b, D-109)

Pace (D-111): goblins move 20% slower and attack 1.5× less often, but each hit does 1.5× the damage (a grunt touch 3, a rock 3, a brute charge 6, Warlord bullets 3). The screen should feel calmer; each hit should matter more.

Restart `npm run dev` (protocol v22) and reload. Play a few Warrens runs (note the seed) and, with a serf that has completed the Warrens, a Stronghold run.

1. **Falling boulders**: in the Tunnel and the Guard room (and the Stronghold's Armory), once the room fights, boulders start falling: a dark shadow and red circle grow on the floor while a grey boulder drops onto it, then it lands. Being inside the circle costs HP (5 in the Warrens, 9 in the Stronghold, less with Defense). Most land anywhere, about 1 in 4 near you, so standing still or circling gets you hit. They stop when the room is cleared. The Warlord's rockfall now looks the same.
2. **Leading slingers**: some slingers (lighter purple) throw where you are going: keep running in a straight line or circle and their rocks meet you. Plain slingers throw at where you are. All Stronghold slingers lead.
3. **Ambush holes**: dark gaps in the Ambush hall's walls (and the Stronghold's Barracks). After the first wave dies, goblins come out of the holes two at a time, about every 4 s; the door opens only after the last one dies.
4. **Death by a boulder** (optional, a low-HP serf): the death screen says "Slain by a falling boulder".
5. Circling the room should no longer be a safe answer everywhere. Tell me where it still is.

Report: pass/fail per step, seeds, screenshots of anything odd, and how the rooms felt.

#### Goblin Stronghold checklist (Phase 12a, D-108)

Restart `npm run dev`, reload.

1. The Dungeons tab lists the **Goblin Stronghold** under the Warrens ("Levels 9–12 · 5–7 min · opens after the Warrens").
2. With a serf that has never completed the Warrens (a new one): the Stronghold shows **Locked: Complete the Goblin Warrens first.** and no queue button.
3. With a serf that has completed the Warrens at least once: the Stronghold has **Enter queue**. Queue it.
4. In the run: you start in the **Stronghold gate**; the path passes 6 combat rooms (busier than the Warrens: about twice the goblins) and ends in the **War hall** with the Goblin Warlord (a stand-in until its own boss). Doors, walls, retreat, and the portal work as in the Warrens.
5. Completing it: about 160 EXP at levels 9–12 (less above 12); the chest drops T2–T4 items, and a T4 can show extra rolls and +1 LUCK.
6. A serf below level 9 may enter too (any level, D-107); expect it to be hard.

Report: pass/fail per step, the seed of anything odd, your clear time, and how hard it felt for your serf's level.

#### Dungeon entry checklist (Phase 11c, D-107)

Only the Goblin Warrens is listed today, so there is no locked dungeon to see yet.

1. Restart `npm run dev`, reload. A brand-new serf (no completions) can queue the Warrens as before.
2. The dungeon menu looks unchanged (the Warrens has no lock).
3. Nothing else changes for normal play. The new server checks (a hidden test map refused; a later dungeon locked until the Warrens is completed) are covered by automated tests.

Report: pass/fail per step.

#### Accessory base stats checklist (D-106)

Restart `npm run dev` (the server applies migration 009 at start; check its log says `database migrated: 009_accessory_bases.sql`) and reload.

1. Open the Stash: every ring, necklace, and cape is named after its base stat ("T0 Ring of Speed", "T1 Cape of HP") and shows its base under the name (+1 SPD, +6 HP …).
2. Clear the Warrens a few times: new rings, necklaces, and capes show a base; T0 gives +1 (HP/MP +3), T1 +2 (+6), T2 +3 (+9). No item from the Warrens has extra rolls or +1 LUCK any more (those start at T4).
3. Equip a ring: hover first; the comparison shows its base stat going up. After equipping, the HUD stat (for example DEF) rises by the base.
4. Any class (and a classless Serf) can equip any ring, necklace, or cape.

Report: pass/fail per step, and the item name and numbers if anything looks wrong.

#### Warrens room pool checklist (Phase 11b)

Restart `npm run dev` and reload (no protocol change). Play several Warrens runs (note each seed).

1. New rooms turn up: Collapsed passage (long and narrow), Fungus grotto (square), Goblin kitchen, Slinger gallery (a wall of slingers at the far end), Brute pit (two waves with brutes), War camp (large). The room name shows on the floor.
2. Familiar rooms sometimes have a different enemy mix (for example, the Tunnel with slingers at its far end, or the den with six grunts).
3. Runs still feel like 3–5 minutes solo; the hardest combat room is always the last before the throne.
4. No enemy appears inside a wall or outside its room; no path is blocked.
5. Report anything odd with its seed (replay with `DUNGEON_SEED`, see 11a step 6) and a screenshot.

#### Procedural Warrens checklist (Phase 11a)

Restart `npm run dev` (protocol v21) and reload.

1. Queue the Goblin Warrens. HUD **Dungeon seed** shows a number. Note it.
2. Play through: the map is no longer the old straight line. It starts in the Entrance cave and ends in the Warlord's throne; on the way you pass 4 combat rooms that get harder (Tunnel, then two of Goblin camp / Goblin den / Guard room, then the Ambush hall). The path may turn north or south but never back west.
3. Doors open as before: each one when the room before it is cleared. 0–2 side rooms may hang off the path; they are optional (the portal opens without them).
4. Walk into walls and through doorways: no stutter or snapping back (that would mean the browser's map differs from the server's). Watch **Pending / correction**: it should stay near 0.00 px.
5. Run it again (requeue): a different seed and a different map.
6. **Replay a seed:** add `DUNGEON_SEED=<the number>` to `.env`, restart `npm run dev`, queue: the same map as step 1. `DUNGEON_SEED=0` gives the old handcrafted Warrens. Remove the line afterwards.
7. Two clients in one run (or a late joiner within 15 s): both see the same map and seed.

Report: pass/fail per step, the seed of anything that looks wrong (blocked path, room inside a wall, enemy stuck in a wall, a gap to the outside), and a screenshot.

#### Abilities checklist (Phase 10d: Fighter, Rogue, Cleric)

Restart `npm run dev` (protocol v20) and reload. Classes needed: Fighter, Rogue, Cleric (choose at level 5; each comes with its ability item).

1. **Fighter** Guard (Space): a steel-blue ring around you for 2.5 s; hits take clearly less HP (about half at T0, on top of Defense). MP −12; 6 s cooldown.
2. **Cleric** Healing: a green ring widens from you, with a green flash on you and every ally within 160 px; HP goes up (10 + 10% of max HP at T0), never above max. Two clients: stand together and check both heal; stand far apart and only the caster heals. MP −20; 8 s.
3. **Rogue** Vanish: your square turns see-through for 2 s at T0 (the other client sees it faded too). Enemies stop aiming at and chasing you; bullets already in the air still hit, for half damage. MP −15; 8 s.
4. **Vanish in every mode (D-101):** in Full auto, Auto aim + Space, and Auto fire + Space your automatic shots stop while you are faded and start again when it ends. Left-click while faded (any mode): a shot goes toward the mouse and Vanish ends at once (square solid again).
5. In Full auto, Guard and Healing go off by themselves when an enemy is within shot range; Vanish never does (a movement ability, D-102), but Space casts it.
6. Older abilities still work.

Report: pass/fail per step and any exact error text.

#### Abilities and fire modes checklist (Phase 10c)

Restart `npm run dev` (protocol v19) and reload. Classes needed: Barbarian, Bard, Warlock (choose at level 5; each comes with its ability item).

1. **T cycles four modes**: Full auto → Auto aim + Space → Auto fire + Space → Manual (HUD "Fire mode (T)"). You start in Auto aim + Space.
2. **Full auto**: walk near enemies without pressing anything: you shoot the closest one and your ability goes off by itself whenever an enemy is in its reach (buffs too, when an enemy is within shot range). Away from enemies it does not fire; press Space and it casts anyway (aimed abilities at the cursor).
3. **Auto aim + Space**, **Auto fire + Space**, **Manual**: the ability only goes off with Space; shooting works as before (auto at the closest enemy / always toward the mouse / left click).
4. **Barbarian** Battle Cry (Space): a red ring around you for 5 s; your shots hit harder (enemy HP numbers drop faster). MP −15; 10 s cooldown.
5. **Bard** Inspiration: a gold ring widens from you; you and allies within 160 px get a gold ring for 6 s, hit harder, and heal faster (two clients: stand together, watch the other's HP climb). MP −20; 12 s.
6. **Warlock** Curse: a violet flash on the target; enemies inside get a violet outline for 5 s and take more damage from everyone (watch a party member's shots too). MP −15; 6 s.
7. Older abilities (Arcane Blast, Volley, Chain Lightning, Nature's Reach) still work in every mode.

Report: pass/fail per step and any exact error text.

#### Abilities checklist (Phase 10b: Ranger, Sorcerer, Druid)

Restart `npm run dev` (protocol v18) and reload. You need a level-5+ serf of each class (choose the class at level 5; each comes with its T0 ability item worn).

1. **Ranger** (Quiver): hold Space near enemies: 5 **gold** arrows fan out (30°) toward the nearest enemy (Auto aim) or the cursor; up close several arrows hit one target. MP −12; again after 1.2 s.
2. **Sorcerer** (Scepter): a cyan zigzag strikes the nearest enemy and jumps to up to 3 more enemies within 120 px of each other, each hit weaker. With no enemy within 250 px (or none near the cursor in Auto fire/Manual), nothing happens and no MP is spent. MP −15; 1.5 s.
3. **Druid** (Totem): a green patch (60 px) appears on the target for 3 s; enemies inside lose HP every half second and walk at half speed (a charging Brute too, without stopping as if it hit a wall). MP −20; 4 s.
4. HUD **Ability (Space)** shows each class's ability, tier, and MP cost; other classes (Fighter, Barbarian, Rogue, Cleric, Bard, Warlock) still say their ability arrives later.
5. A Wizard's Arcane Blast still works as in 10a.

Report: pass/fail per step and any exact error text.

#### Abilities checklist (Phase 10a: Wizard Arcane Blast)

Restart `npm run dev` (protocol v17); the server prints `database migrated: 008_ability_grant.sql` once. Reload (Ctrl+Shift+R).

1. HUD: under the title, a red HP bar and a blue MP bar (empty outside a run). The Live list has **Player MP** and **Ability (Space)**.
2. Get a serf to level 5 (psql: `update serfs set exp = 490 where name = '<name>' and died_at is null;`, reload) and choose **Wizard**: the Stash tab's gear panel shows a **T0 Spellbook** in the Ability item slot, and the HUD says **Ability (Space): Arcane Blast (T0) · 15 MP**.
3. A serf that already had a class before this change gets its class's T0 ability item the first time you play as it (once only: unequip and sell it, then reselect: no second one).
4. In the Goblin Warrens, Auto aim mode: hold Space near enemies: a purple circle flashes on the nearest one (up to 250 px away) and every enemy inside it loses HP. The MP bar drops by 15; Space does nothing again until 1.5 s pass and MP is back above 15.
5. Press T for Auto fire or Manual: the blast lands at the mouse cursor (at most 250 px from you).
6. MP refills over time (WIS ÷ 10 per second: about 1.5 MP/s at WIS 15).
7. Another class (e.g. Barbarian): the HUD says its ability item's ability "arrives in 10b–10d"; Space does nothing.
8. A ring, necklace, or cape can't go in the Ability item slot; another class's ability item says your class cannot use it.
9. Two clients in one run: each sees the other's blasts.

Report: pass/fail per step and any exact error text (browser console and server terminal).

#### Equipping checklist (Phase 9b)

Restart `npm run dev` (protocol v16) and reload (Ctrl+Shift+R).

1. Clear the Goblin Warrens until a reward your serf can wear drops (before level 5: any ring, necklace, or cape, or a T0 weapon or armor piece). Its card shows **Equip on <name>**.
2. Hover the card: a box beside it says **vs empty slot** (or **vs <what you wear>**) with green gains and red losses (weapons also show damage).
3. Click Equip now: the card says **Equipped on <name>**; the confetti does not restart. The HUD stat shows the gear part, e.g. **DEF 1 (+1)**.
4. A reward your serf cannot use (e.g. a T1 weapon before level 5) says why instead of offering Equip.
5. Stash tab: **<name>'s gear** with 10 slots; the worn item has **Unequip**. Unequip it: it moves to the stash and the HUD stat drops back.
6. Equip a stash item onto a slot that is already filled: the old item goes to the stash. With two rings worn, a third ring offers **Ring 1** and **Ring 2**, each with its own comparison.
7. Wear a weapon, start a run: shots hit harder (e.g. a T2 weapon at ATK 10 does 35 instead of 25). Wear a +SPD item: you move faster, and HUD "Pending / correction" stays near 0.00 px.
8. Wear a +1 LUCK item and clear: **2 chests (Luck 2)**.
9. While queued, try Unequip from another tab or refresh: refused ("not while queued or in a run").
10. Let a geared serf die: its worn items are gone; the stash and gold are unchanged.

Report: pass/fail per step and any exact error text.

#### Stash, gold, and rewards checklist (Phase 9a)

Restart `npm run dev` (protocol v15); the server prints `database migrated: 007_stash_gold.sql` once (items you got while testing 9a-1 move into your stash). Reload (Ctrl+Shift+R) and log in. The account bar shows **Gold N**.

1. Clear the Goblin Warrens: one chest card flips open (e.g. "T1 Necklace · +1 VIT") and says **→ Stash**. A T0 ring, necklace, or cape always has one roll (D-084).
2. **Stash** tab: "Stash N/20 · Gold G" and the item, with **Sell · +N gold** (T0 2, T1 10, T2 22; more with +1 Luck).
3. Sell one: gold goes up by exactly that amount and the item is gone. The Serfs tab no longer lists a bag (a serf carries only what it wears, D-085).
4. Fill the stash to 20 (keep clearing; or psql, see below) and clear once more: the chest card is dashed, says **Stash full: sell this or something in the stash**, has a Sell button, and the main button is **Settle rewards (Enter)**.
5. Enter: the Stash tab shows **Waiting for room (1)** above the stash. The Dungeons tab says the serf is blocked and has no queue button.
6. Close the tab, reopen, log in: you land on the Stash tab with the reward still waiting (D-088).
7. Sell a stash item: the waiting reward moves into the stash; the Dungeons tab lets you queue again. (Or sell the waiting reward itself.)
8. Let a serf die: the stash and gold are unchanged.

To fill the stash quickly (dev database, then reload): `& $psql -U serfdom -d serfdom -c "insert into items (account_id, location, slot, type, tier, rolls, luck) select id, 'stash', 'cape', null, 0, jsonb_build_array(jsonb_build_object('stat', 'hp', 'amount', 1)), 0 from accounts, generate_series(1, 19);"` (adds 19 T0 capes to every account on your dev database; `$psql` as in the README).

Report: pass/fail per step, the gold amounts you saw, and any exact error text.

#### Luck checklist (Phase 8d)

No restart needed beyond the usual reload (Ctrl+Shift+R); the protocol is unchanged (v13).

1. HUD Serf section: a **LUCK 1** row under WIS.
2. Serfs tab: each serf's stat line ends with "LUCK 1".
3. A serf at level 5+ with a class, or at level 20: still LUCK 1 (levels and classes never change it, D-066).

Report: pass/fail per step.

#### Stats in combat checklist (Phase 8c-2)

Restart `npm run dev` (protocol v13) and reload (Ctrl+Shift+R). Compare a fresh serf with a leveled one (psql: `update serfs set exp = 4465 where name = '<name>' and died_at is null;`, reload, choose a class if asked: level 20).

1. A fresh level-1 serf plays exactly as before: HUD "Player HP" 20/20, same speed, fire rate, and damage as in Phase 8b.
2. Leveled serf: in the dungeon, HUD "Player HP" equals the serf's HP stat (e.g. 108/108), not 20.
3. It moves visibly faster when its SPD is above 10 (SPD 18 ≈ 180 px/s vs 150), and the HUD "Pending / correction" stays near 0.00 px while moving (no rubber-banding).
4. It kills enemies faster (higher ATK) and fires faster (higher DEX).
5. Enemy hits hurt less with DEF above 0 (e.g. a 2-damage rock takes about 1.2 HP at DEF 7), and HP comes back faster with higher VIT.
6. Two clients (two browsers, two accounts) in one run with different serfs: each moves at its own speed; neither rubber-bands.

Report: pass/fail per step and any exact error text. Note how the Warrens feels at level 20: it should be easy (D-071: it is meant for levels 1–9).

#### Stat rolls checklist (Phase 8c-1)

Restart `npm run dev` (protocol v12); the server prints `database migrated: 005_serf_stats.sql` once. Reload (Ctrl+Shift+R) and log in. To skip ahead, set EXP with psql (`update serfs set exp = 400 where name = '<name>' and died_at is null;`, then reload): 400 = level 4, one clear from 5.

1. HUD (left panel), new **Serf** section: name, class, level, and eight stats. A new serf: HP 20, MP 10, ATK 10, DEX 10, SPD 10, DEF 0, VIT 10, WIS 10.
2. Clear to level 2: under **LEVEL UP! Level 2** a green line of rolls appears, e.g. "+2 HP +1 MP +1 ATK …" (HP always +1 to +3; DEF never grows before a class).
3. Serfs tab: the serf's row has a stat line matching the HUD (base + the rolls).
4. Clear again without leveling: no roll line; stats unchanged.
5. Reach level 5 and choose a class: the Serfs tab shows each stat as value/max (e.g. Barbarian "HP 38/200"), and the class's High stats jumped (+10 HP/MP, +3 others). The HUD matches.
6. A serf that already had EXP before this change: the first time you play as it, its stats catch up to its level (to 5 at most until it has a class). Selecting it again does not change them.
7. Restart the server and reload: stats unchanged.
8. Stats do **not** change combat yet (that is 8c-2): damage, fire rate, speed, and HP in the dungeon are as before.

Report: pass/fail per step, the roll line you saw, and any exact error text.

#### Class choice checklist (Phase 8b)

Restart `npm run dev` (protocol v11); the server prints `database migrated: 004_serf_class.sql` once. Reload (Ctrl+Shift+R) and log in. Level 5 takes 5 Goblin Warrens clears from a new serf (490 EXP); a serf you already have at level 5+ asks for its class straight away.

1. Below level 5: Dungeons tab says "Playing as <name> · Serf · Level N"; you can queue as before.
2. The clear that reaches level 5: the completion screen shows **LEVEL UP! Level 5** and **Level 5: choose your class!**, and the first button is **Choose your class (Enter)** instead of Requeue.
3. Press Enter (or click it): the Dungeons tab shows 10 class cards (Fighter … Sorcerer, each with its item and ability) instead of the dungeon list. Pressing Enter here does nothing.
4. Click a class: it is outlined in gold and a **Confirm: <name> becomes a <Class> (permanent)** button appears. Click another class: the outline and the button follow it. Nothing is saved yet.
5. Click Confirm: the Dungeons tab is back with the dungeon list and "Playing as <name> · <Class> · Level 5". Server terminal: `serf #N became a <class>`.
6. Queue and clear again: works as before; the serf stays that class.
7. Serfs tab: "<Class> · Lv N · …". Leaderboard: a class column ("Serf" for serfs without one).
8. With two serfs: switch to the other serf; it shows its own class (or "Serf").
9. Restart the server and reload: the class is still there.

Report: pass/fail per step and any exact error text (browser console F12 → Console, and the server terminal).

#### EXP and leaderboard checklist (Phase 8a)

Restart `npm run dev` (protocol v10); the server prints `database migrated: 003_serf_exp.sql` once. Reload (Ctrl+Shift+R) and log in.

1. Dungeons tab: "Playing as <name> · Level 1 · 0 EXP" for a new serf (existing serfs start at 0 EXP too).
2. Clear the Goblin Warrens: the completion screen shows **+100 EXP**, an EXP bar, and **LEVEL UP! Level 2** (first clear).
3. Clear again: +100 EXP, **no level-up**; the bar shows 100/115 to level 3 (the third clear reaches level 3).
   3b. Optional (long, ~13 clears): past level 9 the EXP per clear drops (90 at level 10, 81 at 11 …) and the completion screen says "Reduced EXP: this dungeon is aimed at levels up to 9."
4. Press R in a run, or die: no EXP. A dead serf's death screen shows its final level and lifetime EXP.
5. Serfs tab: "Lv N · EXP · clears/runs" per serf.
6. **Leaderboard** tab: serfs ranked by lifetime EXP, yours included; dead serfs marked † keep their score. No emails appear.
7. Restart the server and reload: levels, EXP, and the leaderboard are unchanged.

Report: pass/fail per step and any exact error text.

#### Serfs checklist (Phase 7b)

Restart `npm run dev` (protocol v9); the server terminal prints `database migrated: 002_serfs.sql` once. Reload http://localhost:5173/ (Ctrl+Shift+R) and log in.

1. With no living serf you land on the **Serfs** tab: "Your serfs (0/2)", a name box, **Suggest**, **Create serf**.
2. Type a name with letters like W, A, S, D, R, T in it (e.g. "Wade Dask"): every letter appears. Try "x!" → an error explains the rule.
3. **Create serf**: you return to Dungeons with "Playing as <name> · Level 1". Enter queues as before.
4. Play and press R (or clear the dungeon): back in the Serfs tab, the serf shows 1 run (and 1 clear if you finished).
5. Die in a run: "<NAME> HAS DIED", "Slain by a Goblin … in the Goblin Warrens", and the serf's lifetime numbers. **Choose a serf (Enter)** goes to the Serfs tab, where the dead serf is under **In memoriam**.
6. The dead serf cannot be played; its name can be used for a new serf.
7. Create two living serfs: the create form disappears ("2/2"). **Play as** switches between them.
8. Reload the page: the serf you last played is selected again automatically.
9. Try a name another living serf already has (any capitalization, any account): "A living serf already has that name."
10. Restart `npm run dev` and reload: your serfs, their stats, and the fallen are all still there.
11. Server terminal: `created serf #N`, `chose serf #N`, `serf #N died for good` lines use numbers only.

Report: pass/fail per step, exact messages for failures, and any console or terminal errors.

#### Accounts checklist (Phase 7a)

Database setup: see README "Database setup". `npm run check` needs PostgreSQL running and `TEST_DATABASE_URL` in `.env`; the server tests wipe and rebuild `serfdom_test`. Restart `npm run dev` (protocol v8; the server now needs `DATABASE_URL`); its terminal should print `database migrated: 001_accounts.sql` once, then `database up to date` on later starts.

1. Open http://localhost:5173/ (Ctrl+Shift+R). You see **Log in** with Email and Password fields.
2. Click **Create an account**. Try a 5-character password: "Use at least 8 characters." appears and nothing is sent. Type a different password in **Confirm password**: "The passwords don't match." appears and nothing is sent.
3. Register with a real-looking email and an 8+ character password: you land on the menu with "Logged in as …" top right.
4. Reload the page: you are back in the menu without typing anything ("Logging you back in…" flashes).
5. **Log out**: back to Log in with "Logged out."; reloading stays on Log in.
6. Log in with a wrong password: "Email or password is incorrect." (the email you typed stays). Five wrong tries: "Too many failed attempts. Try again in 10 minutes."
7. Try registering the same email again: "An account with that email already exists." (Different capitalization counts as the same email.)
8. Log in with the right password, queue, play: everything from Phase 6 still works.
9. Two browsers (e.g. Chrome and Edge, or a private window): log in to the same account in both. The first shows "This account logged in somewhere else." and stays on Log in.
10. Restart `npm run dev` (Ctrl+C, then again) and reload: you are still logged in (the login survived the restart).
11. Server terminal: login lines show `account #N`, never your email or password.

Report: pass/fail per step, the exact message for any failure, and any console or terminal errors.

#### Phase 6 acceptance checklist (two clients)

Run `npm run dev` (restart it if it was running before 6d: protocol v7). Open **two separate windows** at http://localhost:5173/, Ctrl+Shift+R both.

1. **Enter:** press Enter in both within 5 s: both land in the same Goblin Warrens run and see each other.
2. **Shared encounters:** the same enemies, HP, and doors appear in both windows; a room wakes for both when either player walks in.
3. **Fight and complete:** clear the rooms and the Warlord together. When the portal opens, walk window A into it: A gets DUNGEON CLEARED while B keeps playing; then walk B in.
4. **Individual rewards:** after the chest lands, each window's reels stop on its **own** placeholder roll (they will almost always differ). The server terminal logs `guest #N completed run #M after … s (placeholder roll R)` for each, and the numbers match the screens.
5. **Death = no completion rewards:** in another run, die (or press R) before the portal: the death screen (or menu notice) shows no roll, and the terminal line has no "placeholder roll".
6. **Leave:** Requeue (Enter) or Menu (Esc) from the completion screen both work.

Report: pass/fail per step, both rolls and the matching terminal lines, your clear times, and any console errors.

#### Goblin Warlord checklist (Phase 6c)

Run `npm run dev` (restart it if it was running before 6c: protocol v6), open http://localhost:5173/, Ctrl+Shift+R. Play the Warrens as in the 6b checklist, plus:

1. **Brutes** (orange squares, 450 HP): in the camp, the ambush hall's second wave, and the guard room. One walks toward you, stops and **blinks yellow**, then charges in a straight line. Stepping sideways during the blink dodges it; getting hit costs 4 HP. Walking next to a brute that is not charging does not hurt.
2. **Throne room**: entering it spawns the **Goblin Warlord** (large dark-red square). A health bar appears across the top of the screen.
3. Phase 1: aimed 5-shot fans and rings of orange bullets.
4. Below half HP the bar turns bright red and says **ENRAGED**: wider 7-shot fans, denser rings, pairs of grunts, and **red warning circles** under you that fill in and hit for 3 if you are still inside after 1.2 s.
5. When the Warlord dies its grunts vanish, the bar disappears, and a **pulsing violet portal** appears where it stood. HUD `Exit portal: OPEN`. Nothing completes until you walk into it.
6. Walk into the portal: gold flash, **DUNGEON CLEARED** shakes and shimmers, the stats count up, three waves of confetti, the chest drops in over spinning light rays, and (since 6d) the reward reels spin and stop on your placeholder roll.
7. With two windows: when one player enters the portal, only that player completes; the other keeps playing until they enter it (or die).

Report: whether you beat the Warlord, your clear time, HP at the end, which attacks felt unfair or too easy, and any console errors.

#### Goblin Warrens checklist (Phase 6b)

Run `npm run dev` (restart it if it was running before 6b: protocol v5), open http://localhost:5173/, Ctrl+Shift+R.

You are a fresh level-1 Serf: **20 HP**, regenerating **0.5 HP/s** all the time (HUD `Player HP`, one decimal). About 10 hits kill you.

1. Queue (Enter). After ≤ 5 s you are in the **Entrance cave**: room names in each room's top-left corner, brown walls, HUD `Doors closed: 5` (the entrance door opened at once).
2. Walk east (D) through the gap into the **Tunnel**: 5 green squares (grunts, 170 HP) appear and run at you. Touching one costs 2 HP at most every 0.8 s per grunt (several at once add up fast).
3. A red-brown block (a closed door) closes the tunnel's east end; you cannot walk or shoot through it. Kill the grunts: the door disappears and `Doors closed` drops to 4.
4. **Goblin camp**: grunts plus 3 purple squares (slingers, 125 HP) that keep their distance and throw orange rocks (2 damage). Clearing it opens **two** doors: north (optional side den) and east (`Doors closed: 2`).
5. Optional: the **Side den** (4 grunts, 2 slingers). Clearing it opens nothing.
6. **Ambush hall**: a first wave; when it dies a second, larger wave spawns, partly behind you near the entry.
7. **Guard room**: 6 grunts and a line of 6 slingers. Clearing it opens the last door.
8. Step into the **Warlord's throne**: since 6c the Goblin Warlord waits there (see the 6c checklist).
9. Dying anywhere shows the death screen. Pressing R anywhere returns to the menu.
10. With two windows (queue within 5 s of each other): both see the same enemies and doors; a room wakes for both when either enters it.

Report: how far you got, your HP when you died or finished, the clear time, whether it felt too hard or too easy (and where), and any console errors.

#### Menu, queue, and run checklist (Phase 6a)

Run `npm run dev` (restart it if it was running before 6a: protocol v4), open **two separate windows** at http://localhost:5173/, reload both with Ctrl+Shift+R.

1. Both windows show the **SERFDOM** menu with tabs Dungeons / Serfs / Stash / Leaderboard. Serfs, Stash, and Leaderboard say "Coming in Phase …".
2. In A press **Enter** (or click Enter queue): "Finding a party for Goblin Warrens · 1 / 10 players waiting · Starting in 5 s", counting down.
3. Within 5 s press Enter in B: both show **2 / 10**. When the countdown ends both enter the same run (the overlay disappears); each sees the other; dummy shows 750/750.
4. In B press **R**: B is back at the menu with "You fled the Goblin Warrens. No rewards."; A keeps playing and the dummy rescales to 500 max.
5. In B queue again within 15 s of the run starting: B joins **A's run** at the spawn (HUD shows the other player; dummy max goes back to 750). Press R in B, wait until the run is over 15 s old, queue again: B gets a **separate** solo run after 5 s and the two windows do not see each other. Press R in B.
6. In A kill the dummy: **DUNGEON CLEARED** with confetti, your stats (clear time, enemies slain, damage dealt, accuracy, damage taken) and a wiggling chest placeholder.
7. Press **Enter** on that screen: requeue; a solo run starts within 5 s at (1000, 1000) with 200 HP and a full-HP dummy.
8. Die (T twice for Manual, stand left of the dummy at about (1075, 1100)): the screen cuts to red then black: **YOUR SERF HAS DIED** with your life stats; Return appears after ~1.5 s; Enter before that does nothing.
9. Return → menu. Esc while queued leaves the queue (nothing starts).
10. Consoles: no red errors. Server terminal: `queued for goblin-warrens`, `run #N started …`, `guest #N left/completed/died run #N after … s` lines, guest ids only.

Report: pass/fail per step, the screen text or HUD values for any failure, and exact console or terminal text.

#### Two-client combat checklist (Phase 5)

_Historical: steps 7–8 (placeholder menu, Enter to play again) were replaced by the Phase 6a death screen; in 6a a dummy kill completes the run instead of respawning._

Run `npm run dev`, open **two separate windows** side by side at http://localhost:5173/ (not tabs: browsers pause background tabs), reload both with Ctrl+Shift+R.

1. Both HUDs: `Movement + combat: server-authoritative`; each sees the other as a blue square.
2. Dummy max HP matches the number of living players (1→500, 2→750, 3→1000, 4→1250 since 6d, D-045).
3. Fight from window A only: both windows show the same dummy HP at every moment; B sees A's cyan shots.
4. Fight from both windows at once: damage adds up; when the dummy dies both windows show `respawn …s`; it returns at full (scaled) HP after 3 s.
5. Your own shots appear instantly; the dummy's HP drops ~20 ms after a shot visibly lands; `Pending / correction` stays ~0–1 / 0.00 px.
6. Stand in a ring's path in one window: it flashes red and loses 20 HP per hit; the other window is unaffected.
7. Die in A (T twice for Manual, stand left of the dummy): placeholder menu in A; B stops drawing A; dummy max HP rescales down keeping its HP fraction; B keeps fighting normally.
8. Enter in A: A returns at (1000, 1000) with 200 HP and B sees A again.
9. Close A: B's `Online` list drops A and the dummy rescales.
10. Consoles: no red errors in either window; server terminal shows join / died / plays again / left lines with guest ids only.

Report: pass/fail per step, HUD values for any failure, and the exact console or terminal text.

Automated browser check used by Claude (not committed): headless Chrome driven via the DevTools protocol, holding keys and reading the HUD.
