# Serfdom Asset Manifest

**Status:** Living asset inventory and visual requirements.

Add inventory entries only when assets are actually needed and generated/integrated. Use placeholders during early gameplay work.

## Confirmed visual direction

- Chunky, readable, crisp retro pixel art with original Serfdom designs.
- Pokémon Emerald is a palette _reference_, not permission to copy sprites, characters, tiles, or logos. Exact RGB entries must be verified before being described as exact.
- Player character: **32×32 source pixels** (D-127; was 16×16).
- Player-sized ordinary enemies: **32×32 source pixels** (D-127).
- Larger enemies and bosses may use larger sprite canvases.
- Disable smoothing; keep pixel edges sharp.
- Generate original AI-assisted assets only as the current milestone needs them.

## Asset inventory

| Asset path                                                                | Purpose                                  | Canvas/frame size | Frames                        | Palette                                                                               | Source/prompt notes                                                         | Verified in game?                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------- | ----------------- | ----------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `player-placeholder` (runtime texture, `client/src/scenes/WorldScene.ts`) | Phase 1 player placeholder               | 32×32 (D-127)     | 1                             | Placeholder colors only (yellow fill, 2×2 dark center mark); not the verified palette | Generated in code; no image file. Not final art.                            | Rendered in headless Chrome screenshot; awaiting user visual check                            |
| `client/src/assets/sprites/lich/idle/<direction>.png`                     | The Lich, idle (D-128)                   | 32×32             | 1 per direction, 8 directions | The user's own (violet robe, gold crown, teal glow); not the verified palette         | Supplied by the user (an 8-direction "high top-down" export, prompt "lich") | Loaded and drawn in headless Chrome beside a 32 px square; awaiting user check in the Sanctum |
| `client/src/assets/sprites/lich/attacking/<direction>.png`                | The Lich's spinning staff attack (D-128) | 32×32             | 1 per direction, 8 directions | As above                                                                              | Supplied by the user                                                        | As above                                                                                      |

Record the size of individual frames, not just the overall spritesheet.

## Adding a sprite

1. Export one 8-direction set per state, each frame its own PNG with a transparent background.
2. Put the files at `client/src/assets/sprites/<character>/<state>/<direction>.png`, all lower case. Directions: `south`, `south-east`, `east`, `north-east`, `north`, `north-west`, `west`, `south-west` (the names the export already uses).
3. That is enough to load it, as the texture `sprite-<character>-<state>-<direction>`; a file in the wrong place stops the game with an error naming it. Drawing it still needs code (see `CombatView.drawLich`).
4. Add it to the inventory above.

## Source dimensions by category

| Category                          | Source dimensions    | Status    |
| --------------------------------- | -------------------- | --------- |
| Player character                  | 32×32 pixels         | CONFIRMED |
| Player-sized ordinary enemy       | 32×32 pixels         | CONFIRMED |
| Larger enemy / boss               | By design            | OPEN      |
| The Lich                          | 32×32 pixels (D-128) | CONFIRMED |
| Projectiles / effects             | By readability needs | OPEN      |
| Environment tiles                 | To be determined     | OPEN      |
| Inventory / equipment / HUD icons | To be determined     | OPEN      |

Source sprite pixels, world pixels, CSS pixels, and device pixels are distinct. Source dimensions do not automatically define collision dimensions.

## Rendering and viewport context

- Initial game container: **960×640 CSS pixels**.
- Fixed left HUD: **240×640 CSS pixels**.
- Gameplay viewport: **720×640 CSS pixels**.
- Camera target: at least **300 world pixels visible from player center in each cardinal direction** during normal gameplay.
- At the 0.5 camera zoom (D-127), the gameplay viewport shows 720 world pixels horizontally and 640 vertically from center (360 and 320 at the old 1:1 scale), and a 32×32 sprite draws at 16 CSS pixels.
- Evaluate sprites and projectiles at actual in-game display size, not only zoomed-in previews.
- Keep projectiles and enemy silhouettes distinguishable in dense combat.
- Preserve sharp pixels while the camera scrolls.

## AI-assisted asset workflow

1. Identify the asset required for the current milestone.
2. Use placeholders until actual art is needed.
3. Specify purpose, frame dimensions, transparency, and animation frames.
4. Generate original artwork using a genuinely available tool; otherwise disclose the limitation.
5. Inspect dimensions, transparency, readability, frame alignment, and palette.
6. Integrate and test at gameplay scale.
7. Record the path and verification status in the inventory.

## Asset acceptance checklist

- [ ] Original Serfdom design, not copied from another game.
- [ ] Source frame dimensions match the approved category.
- [ ] Player and ordinary player-sized enemy frames are 32×32 (D-127).
- [ ] Transparent background where appropriate.
- [ ] Crisp pixel edges without unintended smoothing.
- [ ] Colors consistent with the chosen/verified palette reference.
- [ ] Animation frames aligned and documented where applicable.
- [ ] Readable in the actual gameplay viewport.
- [ ] Verified in the actual game scene.
- [ ] Inventory entry includes filename, purpose, size, frames, and source notes.

## Open asset decisions

- Exact verified palette values.
- Tile, icon, projectile, and boss sprite dimensions.
- Animation directions and frame counts.
- HUD art and typography behavior in compact layouts.

Update this manifest when assets are integrated or superseded; log changes to approved dimensions in `docs/DECISIONS_AND_OPEN_QUESTIONS.md`.
