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

Phase 0 (repository and environment setup) is in progress. There is no game code yet; the next phase adds the browser client skeleton. See [`docs/WORK_LOG.md`](docs/WORK_LOG.md) for current status.

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

### Checks

Run from the repository root:

| Command                | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `npm run format:check` | Verify every file matches Prettier formatting.   |
| `npm run format`       | Reformat files in place (changes files on disk). |

Type checking, linting, tests, and a dev server will be added in Phase 1.

### Repository layout

```
docs/        design, roadmap, architecture, decisions, testing, work log
CLAUDE.md    instructions for Claude as pair-programmer
```

Planned (added only when their phase begins): `client/` (Phase 1, Phaser + TypeScript + Vite), `shared/` (shared types/rules), `server/` (Phase 4, authoritative WebSocket server). These become npm workspaces.

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
