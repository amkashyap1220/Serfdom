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

### Current client structure (Phases 1–2)

- `client/index.html`: `#game-container` (960×640) is a flex row of `#hud` (240×640, plain DOM) and `#gameplay` (720×640, holds the Phaser canvas). Both use `flex: 0 0 <width>` so neither can grow or shrink into the other.
- The HUD is DOM, outside Phaser entirely, so it is outside the world camera's coordinate space by construction (PROVISIONAL, T-011).
- Phaser canvas = 720×640 with `Scale.NONE` and camera zoom 1: one world pixel is one CSS pixel. At `devicePixelRatio` 1 that is also one device pixel. Higher DPR or browser zoom makes the browser upscale the canvas; CSS `image-rendering: pixelated` keeps that blocky, but non-integer ratios (e.g. 1.25, 1.5) can make pixel widths uneven. Not yet addressed.
- `pixelArt: true` disables texture smoothing/antialiasing and rounds texture positions to whole pixels.
- Pure rules live in Phaser-free modules with Vitest unit tests: client `layout.ts`, `camera-math.ts`; shared `movement.ts`, `fixed-step.ts`, `movement-config.ts`. `WorldScene.ts` wires input → simulation → rendering and holds no rules of its own.
- Simulation loop (Phase 2): each rendered frame, `consumeFixedSteps` converts elapsed time into whole 1/60 s ticks (remainder carried, stalls capped at 0.25 s). Input is sampled once per frame; each tick calls `stepMovement`. The sprite and camera then use the same rounded position, so the player is always exactly centered (D-028, D-033) and texture-aligned.
- Collision (`shared/src/movement.ts`): body = axis-aligned box around the player center. X then Y are resolved separately against wall rectangles (sliding). Each axis is swept, so no tunneling at any step size. Touching edges do not count as overlap.
- Keyboard: `client/src/input.ts` binds W/A/S/D only (D-031). Phaser resets held keys on window blur.
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
