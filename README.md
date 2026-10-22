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

This is a context and planning starter pack, not a finished game implementation. The codebase, framework versions, deployment provider, server framework, and exact database schema should be selected or verified during the early phases.

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
- Start with Phase 0; the pack contains documentation, not a completed game.
