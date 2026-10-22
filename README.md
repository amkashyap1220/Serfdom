# Serfdom — Development Repository

Serfdom is a browser-first, multiplayer top-down bullet-hell action RPG intended to ship later as a Steam desktop application. Browser and Steam players must be able to play together.

This repository is intended to be developed with Claude as a teaching pair-programmer. Work in small, testable phases. Do not attempt to build the whole game in one pass.

## Start here

1. Read [`CLAUDE.md`](CLAUDE.md) before making changes.
2. Read [`docs/GDD.md`](docs/GDD.md) for current game-design context.
3. Read [`docs/ROADMAP.md`](docs/ROADMAP.md) for implementation phases.
4. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for technical principles.
5. Read [`docs/TESTING_AND_FEEDBACK.md`](docs/TESTING_AND_FEEDBACK.md) for how testing should be taught.
6. Read [`docs/DECISIONS_AND_OPEN_QUESTIONS.md`](docs/DECISIONS_AND_OPEN_QUESTIONS.md) before implementing an unresolved design choice.

## Project status

Phases 0–3 are complete (setup, client skeleton, movement/camera, single-player combat prototype). Phase 4 (authoritative multiplayer) is in progress: slice 4a connects browsers to a Node game server that assigns guest ids and tracks who is online. Movement is not shared yet (4b); combat is still local to each browser (Phase 5). See [`docs/WORK_LOG.md`](docs/WORK_LOG.md).

## Development setup

### Prerequisites

- **Node.js 24 LTS** (includes npm). The exact major version is enforced: npm refuses to install with another major version.
- **Git**.

On Windows, both can be installed from PowerShell with:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Restart your terminal/editor afterwards, then confirm:

```sh
node --version   # v24.x.x
npm --version
git --version
```

### Set up a clean clone

```sh
git clone https://github.com/amkashyap1220/Serfdom.git
cd Serfdom
npm ci
```

`npm ci` installs exactly the dependency versions recorded in `package-lock.json`.

### Run the game locally

```sh
npm run dev
```

This starts **both** the game server (`[server]`, ws://localhost:8080) and the browser client (`[client]`, http://localhost:5173/) in one terminal. Open <http://localhost:5173/>; open a second tab to see a second player join. Stop both with `Ctrl+C`. To run them separately: `npm run dev:server` and `npm run dev:client`. If either port is in use, the command fails with a clear message. Optional overrides go in a root `.env` (copy `.env.example`). The port is fixed: if 5173 is already in use, the server exits with "Port 5173 is already in use" rather than silently picking another port.

### Checks

Run from the repository root:

| Command                | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `npm run check`        | Run all checks below in order; stops at the first failure. |
| `npm run format:check` | Verify every file matches Prettier formatting.             |
| `npm run lint`         | ESLint: likely bugs and bad patterns.                      |
| `npm run typecheck`    | TypeScript type checking (no output files).                |
| `npm test`             | Vitest unit tests (pure logic; no browser).                |
| `npm run build`        | Production build into `client/dist/`.                      |
| `npm run format`       | Reformat files in place (changes files; not a check).      |

### Repository layout

```
shared/      pure game rules shared by client and (later) server (npm workspace @serfdom/shared)
  src/movement.ts (+ .test.ts)    WASD direction, movement step, wall collision
  src/fixed-step.ts (+ .test.ts)  fixed 60 Hz simulation timestep
  src/movement-config.ts          PROVISIONAL speed / body / tick values
client/      browser client (npm workspace @serfdom/client): Phaser 4 + TypeScript + Vite
  index.html     page: #game-container = #hud (DOM) + #gameplay (Phaser canvas)
  src/main.ts    creates the Phaser game; measures the layout into the HUD debug readout
  src/layout.ts  approved CSS-pixel layout constants
  src/camera-math.ts (+ .test.ts)  pure camera visibility rules
  src/test-world.ts (+ .test.ts)  PROVISIONAL debug map: size, start, walls
  src/input.ts       WASD key reader
  src/debug-list.ts  HUD debug readout rows
  src/scenes/WorldScene.ts  debug map, movement loop, placeholder player, camera
docs/        design, roadmap, architecture, decisions, testing, work log
CLAUDE.md    instructions for Claude as pair-programmer
```

server/ authoritative game server (npm workspace @serfdom/server): Node 24 + ws, TypeScript run directly via Node type stripping
src/main.ts entry point (PORT env, default 8080)
src/game-server.ts (+ .test.ts) connections, guest ids, presence, input validation
src/log.ts logger (never logs IPs or private data)

Shared protocol: `shared/src/protocol.ts` (+ tests) defines and validates every network message.

If `npm run dev` shows a blank game with `504 (Outdated Optimize Dep)` in the console after dependencies change, stop the server (`Ctrl+C`) and start it again.

No environment variables or secrets are needed yet. When they are, a placeholder-only `.env.example` will be committed; real `.env` files are git-ignored.

## Source-of-truth order

If project files conflict, use this order:

1. The user's latest explicit instruction.
2. The latest accepted entry in `docs/DECISIONS_AND_OPEN_QUESTIONS.md`.
3. `docs/GDD.md` for game behavior.
4. `docs/ARCHITECTURE.md` for technical direction.
5. Existing implementation and tests, unless they conflict with an approved requirement.
6. Claude's assumptions, which must never silently override any of the above.

When a design decision changes, update the relevant docs and decision log in the same work unit as the code change.

## Approved initial visual/layout baseline (v3)

- 960×640 CSS-pixel game container.
- Fixed 240×640 HUD on the left, 720×640 gameplay viewport on the right.
- 16×16 source-pixel player and player-sized ordinary enemy sprites.
- Player-centered camera showing at least 300 world pixels in each cardinal direction in normal play.
- Crisp pixel-art rendering without smoothing.
