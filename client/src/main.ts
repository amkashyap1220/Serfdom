import * as Phaser from "phaser";
import { FIRE_MODE_LABELS, rotateVec } from "@serfdom/shared";
import "./style.css";
import { meetsVisibilityTarget, visibleExtentFromCenter } from "./camera-math";
import { DebugList } from "./debug-list";
import { LAYOUT } from "./layout";
import { WorldScene } from "./scenes/WorldScene";

const gameplay = requireElement("gameplay");
const layoutList = new DebugList(requireElement("hud-layout"));
const liveList = new DebugList(requireElement("hud-live"));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameplay,
  // Canvas size equals the gameplay viewport: 1 world pixel = 1 CSS pixel at zoom 1.
  width: LAYOUT.gameplay.width,
  height: LAYOUT.gameplay.height,
  // Shown wherever no world is drawn, i.e. the void beyond the map (D-033).
  backgroundColor: "#000000",
  // Disables texture smoothing/antialiasing and rounds sprite positions (D-030).
  pixelArt: true,
  scale: {
    // Fixed size; no automatic scaling. Smaller-window behavior is PROVISIONAL (T-012).
    mode: Phaser.Scale.NONE,
    // Stop Phaser from resizing the parent element; style.css owns the layout.
    expandParent: false,
  },
  scene: [WorldScene],
});

game.events.once(Phaser.Core.Events.READY, () => {
  // Wait one frame so the canvas is in the DOM and laid out before measuring.
  requestAnimationFrame(() => {
    reportLayout(game, true);
    game.events.on(Phaser.Core.Events.POST_RENDER, () => reportLive(game));
  });
  // Re-measure on resize so the readout reflects what the window does now.
  window.addEventListener("resize", () => reportLayout(game, false));
});

function worldScene(game: Phaser.Game): WorldScene {
  return game.scene.getScene("world") as WorldScene;
}

function reportLayout(game: Phaser.Game, logTable: boolean): void {
  const container = requireElement("game-container").getBoundingClientRect();
  const hud = requireElement("hud").getBoundingClientRect();
  const view = gameplay.getBoundingClientRect();
  const canvas = game.canvas.getBoundingClientRect();
  const camera = worldScene(game).cameras.main;
  const extent = visibleExtentFromCenter(
    camera.width,
    camera.height,
    camera.zoom,
  );

  const rows: [string, string][] = [
    ["Window (CSS px)", `${window.innerWidth}×${window.innerHeight}`],
    ["Container (CSS px)", size(container)],
    ["HUD (CSS px)", size(hud)],
    ["Gameplay (CSS px)", size(view)],
    ["Canvas (CSS px)", size(canvas)],
    ["Canvas backing (px)", `${game.canvas.width}×${game.canvas.height}`],
    ["devicePixelRatio", String(window.devicePixelRatio)],
    ["Camera zoom", String(camera.zoom)],
    ["Visible from center", `±${extent.horizontal} × ±${extent.vertical}`],
    ["≥300 each way?", meetsVisibilityTarget(extent) ? "yes" : "NO"],
    ["HUD/gameplay overlap?", hud.right > view.left ? "YES" : "no"],
  ];
  layoutList.set(rows);
  if (logTable) console.table(Object.fromEntries(rows));

  verifyLayout(container, hud, view, canvas);
}

/** Per-frame readout: where the player is and whether the camera is centered on them. */
function reportLive(game: Phaser.Game): void {
  const scene = worldScene(game);
  const {
    sim,
    renderPosition,
    keys,
    pointer,
    pointerWorld,
    viewRotation,
    fireMode,
    totals,
  } = scene.getDebugState();
  const position = sim.player.position;
  const camera = scene.cameras.main;
  // Where the player is drawn inside the canvas (CSS pixels): the camera
  // rotates and zooms the world around its midpoint, which sits at the
  // canvas center.
  const fromMid = rotateVec(
    {
      x: renderPosition.x - camera.midPoint.x,
      y: renderPosition.y - camera.midPoint.y,
    },
    viewRotation,
  );
  const onScreenX = camera.width / 2 + fromMid.x * camera.zoom;
  const onScreenY = camera.height / 2 + fromMid.y * camera.zoom;
  const { move, rotate } = keys;
  const held =
    [
      move.up ? "W" : "",
      move.left ? "A" : "",
      move.down ? "S" : "",
      move.right ? "D" : "",
      rotate.left ? "Q" : "",
      rotate.right ? "E" : "",
      rotate.reset ? "Z" : "",
      keys.ability ? " Space" : "",
      pointer.leftDown ? " LMB" : "",
    ].join("") || "—";
  const enemies = sim.enemies
    .map((e) =>
      e.hp > 0 ? `${e.hp}/${e.maxHp}` : `respawn ${e.respawnIn.toFixed(1)}s`,
    )
    .join(", ");

  liveList.set([
    ["Player (world)", `${position.x.toFixed(1)}, ${position.y.toFixed(1)}`],
    ["Camera center (world)", `${camera.midPoint.x}, ${camera.midPoint.y}`],
    ["Player on screen", `${round1(onScreenX)}, ${round1(onScreenY)}`],
    ["View rotation", `${round1((viewRotation * 180) / Math.PI)}°`],
    ["Keys held", held],
    [
      "Mouse (world)",
      pointerWorld
        ? `${round1(pointerWorld.x)}, ${round1(pointerWorld.y)}`
        : "—",
    ],
    ["Fire mode (T)", FIRE_MODE_LABELS[fireMode]],
    [
      "Ability (Space)",
      keys.ability ? "pressed — not yet defined" : "not yet defined",
    ],
    [
      "Player HP",
      sim.player.hp > 0
        ? `${sim.player.hp}/${sim.player.maxHp}`
        : `dead (respawn ${sim.player.respawnIn.toFixed(1)}s)`,
    ],
    ["Hits taken / deaths", `${totals.playerHits} / ${totals.deaths}`],
    ["Dummy HP", enemies],
    [
      "In flight (yours/enemy)",
      `${sim.projectiles.filter((p) => p.owner === "player").length}/${sim.projectiles.filter((p) => p.owner === "enemy").length}`,
    ],
    ["Shots/hits/blocked", `${totals.shots}/${totals.hits}/${totals.blocked}`],
    ["Dummy defeats", String(totals.defeats)],
  ]);
}

/** Warns in the console if the measured DOM differs from the approved layout. */
function verifyLayout(
  container: DOMRect,
  hud: DOMRect,
  view: DOMRect,
  canvas: DOMRect,
): void {
  const checks: [string, DOMRect, { width: number; height: number }][] = [
    ["container", container, LAYOUT.container],
    ["hud", hud, LAYOUT.hud],
    ["gameplay", view, LAYOUT.gameplay],
    ["canvas", canvas, LAYOUT.gameplay],
  ];
  for (const [name, rect, expected] of checks) {
    if (rect.width !== expected.width || rect.height !== expected.height) {
      console.warn(
        `[layout] ${name} is ${size(rect)}, expected ${expected.width}×${expected.height}`,
      );
    }
  }
  if (hud.right > view.left) {
    console.warn("[layout] HUD overlaps the gameplay viewport");
  }
}

/** One decimal, and never "-0.0". */
function round1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (r === 0 ? 0 : r).toFixed(1);
}

function size(rect: DOMRect): string {
  return `${rect.width}×${rect.height}`;
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element in index.html`);
  return el;
}
