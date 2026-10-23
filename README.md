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

Phases 0–5 are complete (setup, client skeleton, movement/camera, combat prototype, authoritative multiplayer, shared server-run combat). Phase 6 (dungeon vertical slice) is in progress: 6a adds the main menu, an open dungeon queue, separate dungeon runs, and death/completion screens; 6b adds the Goblin Warrens map (rooms, doors, waves) with grunts and slingers; 6c adds brutes, the Goblin Warlord boss, the exit portal, and the full completion celebration. Phase 7 (accounts and persistent data) is complete: email + password accounts and serfs (2 slots, names, lifetime stats, permadeath) stored in PostgreSQL. Phase 8 (progression) is complete: 8a adds EXP from completions, levels 1–20 (less EXP above a dungeon's level range), and the lifetime EXP leaderboard; 8b adds the permanent class choice at level 5 (10 classes, no abilities yet); 8c-1 rolls and saves stats at each level-up and shows them; 8c-2 makes HP, Attack, Dexterity, Speed, Defense, and Vitality change combat; 8d adds Luck (1 for every serf until items exist). Phase 9 (equipment) is in progress: 9a gives real item chests (one per Luck point) into a shared 20-slot account stash, with gold from selling: browsers connect to a Node game server (guest ids, presence, 4a) that owns every player's position (4b): you see other players as blue squares. Combat is still local to each browser until Phase 5. See [`docs/WORK_LOG.md`](docs/WORK_LOG.md).

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

- **PostgreSQL 17** (since Phase 7, D-059): the game server stores accounts in it.

#### Database setup (once per machine)

1. Install (Windows; pick your own admin password and keep it safe):

   ```powershell
   winget install -e --id PostgreSQL.PostgreSQL.17 --override "--mode unattended --superpassword CHOOSE_A_PASSWORD --serverport 5432"
   ```

   `Get-Service postgresql*` should then show `postgresql-x64-17` **Running**.

2. Create the game's database user and two databases (each command asks for the admin password; pick a second password for the game):

   ```powershell
   $psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
   & $psql -U postgres -c "CREATE ROLE serfdom LOGIN PASSWORD 'DEV_PASSWORD';"
   & $psql -U postgres -c "CREATE DATABASE serfdom OWNER serfdom;"
   & $psql -U postgres -c "CREATE DATABASE serfdom_test OWNER serfdom;"
   ```

3. Copy `.env.example` to `.env` (git-ignored) and put `DEV_PASSWORD` into `DATABASE_URL` and `TEST_DATABASE_URL`.

The server applies database migrations (`server/migrations/*.sql`) by itself on start. The tests **wipe and rebuild** `serfdom_test` (they refuse to touch a database whose name does not end in `_test`).

#### Changing the database schema

Add a new file `server/migrations/NNN_short_name.sql` (next number, lowercase, underscores) with the SQL. Never edit a migration that has been committed: databases that already ran it would not see the change. The next server start applies it inside a transaction and records it in `schema_migrations`.

#### Resetting your development database

This deletes every account and serf in `serfdom` (not `serfdom_test`). Stop `npm run dev` first, then:

```powershell
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
& $psql -U postgres -c "DROP DATABASE serfdom;"
& $psql -U postgres -c "CREATE DATABASE serfdom OWNER serfdom;"
```

The next `npm run dev` recreates the tables.

To look at the data: `& $psql -U serfdom -d serfdom -c "select id, email, created_at from accounts;"` (password hashes and session tokens are not readable by design).

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
shared/   pure game rules and protocol, used by client AND server (@serfdom/shared)
  src/movement.ts, fixed-step.ts, movement-config.ts   movement, collision, 60 Hz timestep
  src/combat-config.ts, weapon.ts, projectile.ts, collision.ts, enemy.ts, health.ts
  src/sim.ts             one combat tick (player, shots, enemy rings, prototype death)
  src/protocol.ts        every network message + strict validators
  src/test-world.ts      PROVISIONAL debug map (size, start, walls, dummy)
server/   authoritative game server (@serfdom/server): Node 24 + ws, no build step
  src/main.ts            entry point (PORT env, default 8080)
  src/game-server.ts     connections, guest ids, presence, 60 Hz tick, snapshots
  migrations/            numbered SQL files, applied in order on start
  src/db/migrate.ts      migration runner
  src/auth/              accounts: password hashing, sessions, login throttle
  src/serfs/             serfs: storage (per-account), names, slots, permadeath
  src/input-queue.ts     per-player input queue (move-credit rule)
  src/matchmaking.ts     open dungeon queue (who starts a run together)
  src/dungeon-instance.ts one dungeon run: its own simulation, members, stats
  src/rate-limit.ts      per-connection message rate limit
  src/log.ts             logger (never logs IPs or private data)
client/   browser client (@serfdom/client): Phaser 4 + TypeScript + Vite
  index.html             #game-container = #hud (DOM) + #gameplay (Phaser canvas)
  src/main.ts            creates the game; HUD debug readout; wires screens
  src/app-state.ts, screens.ts   menu / queue / death / completion screens
  src/net.ts, net-sync.ts, prediction.ts, interpolation.ts   networking
  src/input.ts, camera-math.ts, layout.ts, render-config.ts, debug-list.ts
  src/scenes/WorldScene.ts       input → simulation → drawing; cameras
  src/scenes/CombatView.ts       dummy, HP label, projectiles
  src/scenes/RemotePlayersView.ts  other players
docs/     design, roadmap, architecture, decisions, testing, work log
CLAUDE.md instructions for Claude as pair-programmer
```

Tests sit next to the code they test (`*.test.ts`).

Configuration: optional root `.env` (git-ignored); copy `.env.example`, which documents `VITE_SERVER_URL` and `PORT` with placeholder defaults. Never commit real secrets.

If `npm run dev` shows a blank game with `504 (Outdated Optimize Dep)` in the console after dependencies change, stop it (`Ctrl+C`) and start it again.

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
