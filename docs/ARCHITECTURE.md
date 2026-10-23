# Serfdom — Technical Architecture

**Status:** Proposed direction; verify against the actual repository before implementation.

## 1. Product architecture

Serfdom is one online game with two planned clients:

- Browser client, delivered by the website.
- Steam desktop client, packaged from the same web client using Electron or a comparable wrapper.

Both clients connect to the same authoritative multiplayer service and persistent data store. Do not build a separate game backend or progression database for Steam.

## 2. Proposed stack

- Client: Phaser + TypeScript.
- Desktop wrapper: Electron, later.
- Real-time transport: WebSockets.
- Server: TypeScript/JavaScript runtime with a small authoritative game-server process.
- Database: PostgreSQL, when persistent account/game data is introduced.
- Build/dev server: Vite (Phase 1).
- Testing: Vitest (Phase 1); document commands in the root README.
- Formatting: Prettier, pinned exact version (Phase 0). Linting: ESLint (Phase 1). Type checks: `tsc` (Phase 1).

### Current repository tooling

- Runtime: Node.js 24 LTS (`.nvmrc`; `package.json` `engines`; `.npmrc` `engine-strict=true` makes npm refuse other versions).
- Package manager: npm. `.npmrc` `save-exact=true` records exact versions; `package-lock.json` is committed.
- Monorepo: npm workspaces. Current workspaces: `shared` (`@serfdom/shared`) and `client` (`@serfdom/client`). `server` is added in Phase 4.
- `@serfdom/shared` is consumed as TypeScript source (its `exports` points at `src/index.ts`); Vite compiles it for the client. It has no DOM types (`lib: ["ES2022"]`), so browser-only code there is a type error. Internal imports use explicit `.ts` paths so Node can later run it directly; the client tsconfig sets `allowImportingTsExtensions` because it type-checks that source.
- Line endings: LF everywhere (`.gitattributes` `eol=lf`, `.editorconfig`, Prettier `endOfLine`).
- Pinned versions (Phase 1): Phaser 4.2.1, Vite 8.3.5, Vitest 5.0.5, TypeScript 6.0.3, ESLint 10.13.0 with typescript-eslint 8.72.0, Prettier 3.9.10.
  - TypeScript is held at 6.0.x because typescript-eslint 8.72 supports only `typescript <6.1.0`. Revisit TypeScript 7 when typescript-eslint supports it.
- Tool locations: shared tooling (TypeScript, ESLint, Prettier) is installed at the root; Vite/Vitest/Phaser belong to `client`. ESLint uses one flat config at the root (`eslint.config.mjs`).

### Current server structure (Phase 4a)

- `server/` workspace: Node 24 runs `src/main.ts` directly (type stripping; `erasableSyntaxOnly` keeps the code strippable; `--watch` restarts on change in dev). No build step.
- `GameServer` (`server/src/game-server.ts`) wraps a `ws` `WebSocketServer`. Per connection it keeps a session: guest id (null until a valid hello), invalid-message count, hello timer.
- Handshake: client sends `hello {protocol}`; the server refuses a different `PROTOCOL_VERSION` (error + close 1008), otherwise assigns the next guest id (never reused), replies `welcome {playerId, players}`, and broadcasts `playerJoined`. On close it broadcasts `playerLeft`. The server's session map is the canonical list of who is online.
- Trust boundary: `ws` `maxPayload` (1 KB) closes oversized frames (1009) before decoding; binary frames and anything `parseClientMessage` rejects get an `error` reply; 5 invalid messages or no hello within 5 s closes the connection (1008).
- Protocol: `shared/src/protocol.ts` holds message types, strict parsers (exact keys, typed fields), and `PROTOCOL_VERSION`. The client validates server messages with the same module.
- Movement authority (Phase 4b, T-023): clients send `input {seq, move}` once per 60 Hz tick (a direction, never a position). The server queues up to 30 per player and applies **at most one per tick** with the shared `stepMovement` and `TEST_WALLS` (`server/src/player-movement.ts`), so sending more messages cannot make anyone faster; with no queued input the player stands still. Seq numbers must strictly increase; directions over length 1 are rejected by the parser and anything a hair over is normalized. More than 180 messages in a second closes the connection. The server loop runs ticks from measured real time (fixed-step accumulator, like the client) and broadcasts `snapshot {tick, players:[{id,x,y,ack}]}` (every tick since 4c). `ack` is the last input seq applied for that player.
- Latency tuning (Phase 4c, T-026, target D-042): snapshots are sent **every tick** (60 Hz). Per player the server earns one move credit per tick (saved up to 4) and spends one per applied input, so a late input followed by two at once is caught up without ever exceeding PLAYER_SPEED over time; after applying, any waiting inputs beyond 1 are dropped (counted as processed in `ack`). Without that limit the queue only ever grows, because client and server tick at the same rate. Remote players are interpolated **50 ms** behind.
- Client sync (`client/src/net-sync.ts`): the local player uses **prediction + reconciliation** (`prediction.ts`): each tick it moves immediately with the same shared rule and stores the input; on each snapshot it snaps to the server position and replays inputs newer than `ack`. Other players use **interpolation** (`interpolation.ts`): drawn 50 ms in the past (100 ms before 4c), blended between the two surrounding snapshots, never extrapolated. Until the first snapshot arrives (or while offline) movement is local as before. Online, the local combat sim is fed the predicted position and no movement of its own; the prototype respawn restores HP in place because only the server may move the player (PROVISIONAL).
- The debug map (`shared/src/test-world.ts`) moved to `shared/` so the server collides against the same walls. Everyone spawns at (1000, 1000); players do not collide with each other (PROVISIONAL).
- Client: `client/src/net.ts` `Connection` keeps one socket, mirrors presence from the server, and retries every 2 s when disconnected. The game keeps running locally while offline.
- Config: root `.env` (optional, git-ignored; see `.env.example`) is read by Vite (`envDir: ".."`, `VITE_SERVER_URL`) and by Node (`--env-file-if-exists`, `PORT`).

### Current client structure (Phases 1–2)

- `client/index.html`: `#game-container` (960×640) is a flex row of `#hud` (240×640, plain DOM) and `#gameplay` (720×640, holds the Phaser canvas). Both use `flex: 0 0 <width>` so neither can grow or shrink into the other.
- The HUD is DOM, outside Phaser entirely, so it is outside the world camera's coordinate space by construction (PROVISIONAL, T-011).
- Phaser canvas = 720×640 with `Scale.NONE` and camera zoom 1: one world pixel is one CSS pixel. At `devicePixelRatio` 1 that is also one device pixel. Higher DPR or browser zoom makes the browser upscale the canvas; CSS `image-rendering: pixelated` keeps that blocky, but non-integer ratios (e.g. 1.25, 1.5) can make pixel widths uneven. Not yet addressed.
- `pixelArt: true` disables texture smoothing/antialiasing and rounds texture positions to whole pixels.
- Pure rules live in Phaser-free modules with Vitest unit tests: client `layout.ts`, `camera-math.ts`; shared `movement.ts`, `fixed-step.ts`, `movement-config.ts`. `WorldScene.ts` wires input → simulation → rendering and holds no rules of its own.
- Simulation loop (Phase 2): each rendered frame, `consumeFixedSteps` converts elapsed time into whole 1/60 s ticks (remainder carried, stalls capped at 0.25 s). Input is sampled once per frame; each tick calls `stepMovement`. The sprite and camera then use the same rounded position, so the player is always exactly centered (D-028, D-033) and texture-aligned.
- Collision (`shared/src/movement.ts`): body = axis-aligned box around the player center. X then Y are resolved separately against wall rectangles (sliding). Each axis is swept, so no tunneling at any step size. Touching edges do not count as overlap.
- Combat simulation (Phase 3b, `shared/src/sim.ts`): `stepSim(state, {move, fire}, walls, dt)` is one pure tick: move the player, maybe fire (cooldown in `weapon.ts`), advance every projectile (`projectile.ts`, swept hits via `collision.ts`), apply damage and respawn timers (`enemy.ts`). It returns the new state plus events (shot/hit/blocked/defeated/respawned) that the client uses only for presentation (hit flash, HUD counters). Fire intent per tick comes from `resolveFireIntent(mode, pointer, playerPos, targets, range)`. All tuning is in `shared/src/combat-config.ts`. This is the code the Phase 5 server is meant to run.
- Phase 3c additions: projectiles carry an `owner` (player shots hit enemies; enemy bullets hit only the player's 15×15 hurtbox, separate from the 16×16 wall body). Tick order: player moves/fires (only while alive) → enemies within aggro range of a living player fire rings (cooldown reuses `stepFireCooldown` at 1 ring / 2 s) → projectiles resolve → enemy respawn timers → prototype player respawn. HP rules for players and enemies share `shared/src/health.ts`. The prototype respawn resets the whole encounter (player at spawn with full HP, projectiles cleared, enemies full HP with fresh attack timers); it is deliberately isolated in `stepPlayerRespawn` so the real death rules can replace it.
- Client combat drawing lives in `client/src/scenes/CombatView.ts` (no rules). The mouse is converted to world coordinates with `screenToWorld` (client `camera-math.ts`), the exact inverse of the camera transform, rather than Phaser `getWorldPoint`, which uses the previous frame's camera matrix.
- Keyboard: `client/src/input.ts` binds W/A/S/D (D-031) and Q/E/Z for view rotation (D-040). Phaser resets held keys on window blur.
- View rotation (Phase 3a): `stepViewRotation` (client `camera-math.ts`) advances the angle at 120°/s while Q/E is held (Q = positive = world turns clockwise on screen), and Z resets it to 0. It is presentation only and follows frame time, not simulation ticks. `worldDirectionFromInput` (shared) rotates the screen-space WASD direction by −angle, so W is always "up the screen"; `stepMovement` receives only that unit vector and rejects any longer one.
- Rendering under rotation: world objects live in one Phaser `Layer` drawn by the rotating main camera. A second, never-rotating "overlay" camera draws the screen-fixed debug marks (a single camera would rotate them too). The player sprite is counter-rotated so it stays upright and pixel-aligned (PROVISIONAL, T-017); floor, walls, and labels rotate and look jagged at non-right angles.
- `main.ts` measures the real DOM after the first frame and on every window resize, printing it in the HUD "Layout" readout (and `console.table` once); mismatches against `layout.ts` produce `[layout]` console warnings. The HUD "Live" readout updates every frame: player position, camera center, player on-screen position, keys held.

These are proposals, not permission to install every dependency immediately. Inspect the repository and choose the minimum needed for the current phase.

## 3. Trust boundaries

The client is untrusted. It may send intentions such as “move,” “attempt attack,” “activate ability,” or “use item.” It must not be allowed to dictate consequential results.

The server owns and validates:

- Player session and party membership.
- Legal movement and collisions, to the degree needed by the game model.
- Attack eligibility, damage, enemy HP, and enemy defeat.
- Ability costs and cooldowns.
- HP/MP and death.
- Resurrection.
- Inventory/equipment ownership.
- Dungeon state and completion eligibility.
- Loot rolls, XP, gold, and persistent progression.
- Market transactions and shared storage.

Client prediction may be used for responsiveness, but authoritative state comes from the server.

## 4. Suggested separation of concerns

Do not force this folder structure if the chosen framework suggests a better one, but preserve these boundaries:

- `client/`: Phaser scene, rendering, input, UI, sound, visual effects.
- `server/`: sessions, authoritative simulation, message handlers, party/dungeon state.
- `shared/`: message types, validated schemas, pure game rules/config shared where safe.
- `tests/`: unit and integration tests, or tests beside the code if that fits the tooling.
- `docs/`: design, architecture, roadmap, decisions, testing, work log.

Keep pure deterministic rules (such as tier lookup or XP calculations) separate from Phaser rendering and network I/O so they can be tested quickly.

## 5. Network protocol principles

- Define typed messages with explicit schemas.
- Validate every incoming message and enforce reasonable limits.
- Version the protocol or otherwise establish a compatibility policy before release.
- Avoid trusting client timestamps or client-provided outcome values.
- Make disconnect and reconnect behavior explicit.
- Keep message handlers small and route requests to authoritative game services.
- Do not expose database internals or secrets to clients.

Do not finalize the protocol before the first multiplayer milestone. Start small and evolve it deliberately.

## 6. Persistence principles

When persistence is introduced:

- Use migrations.
- Keep credentials and secrets in environment variables.
- Commit `.env.example` only with placeholders.
- Use database transactions for operations that must be atomic.
- Add authorization checks for every account-owned resource.
- Test concurrent or duplicate requests for inventory and economy operations.
- Plan for backups before real players' data matters.

## 7. Cross-platform principles

- Share the core client code and server protocol.
- Platform-specific Steam integrations belong behind a narrow adapter/module.
- Steam account linking should connect to the canonical Serfdom account, not create an independent character system by default.
- Ensure browser and desktop builds remain protocol-compatible.
- Test mixed-platform play against the same backend before release.

## 8. Avoid premature complexity

Do not begin with microservices, Kubernetes, elaborate matchmaking, a large content pipeline, or production-scale infrastructure. Build the smallest architecture that proves the next game loop and can evolve safely.

## 9. Approved browser layout and camera constraints

- Initial desktop game container is 960×640 CSS pixels: 240×640 fixed HUD on the left and 720×640 gameplay viewport on the right.
- Keep HUD layout outside the Phaser world-camera coordinate space. The camera centers the player within the gameplay viewport.
- Camera must show at least 300 world pixels from the player center in each cardinal direction during normal play.
- At 1 CSS pixel per world pixel, 720×640 viewport yields 360 horizontal and 320 vertical world pixels from center.
- Source sprite size is 16×16 pixels for players and player-sized ordinary enemies. Larger enemies/bosses may vary.
- Explicitly distinguish world coordinates, render resolution, CSS layout, device pixel ratio, and Phaser zoom/scale; disable texture smoothing.
- Prefer a simple DOM layout (HUD sibling of the game canvas) or an equivalent clear separation. Verify actual canvas bounds before choosing implementation details.
- Minimum window size, camera edge clamping, and multiplayer visibility fairness remain unresolved. Do not finalize these silently.
