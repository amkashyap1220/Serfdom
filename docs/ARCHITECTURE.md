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
- Testing: choose tools that fit the selected package manager and framework; document commands in the root README.
- Formatting/type checks: select and pin reproducible tooling during Phase 0.

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
