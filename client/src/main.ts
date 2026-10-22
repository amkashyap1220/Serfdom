import * as Phaser from "phaser";
import "./style.css";
import { meetsVisibilityTarget, visibleExtentFromCenter } from "./camera-math";
import { LAYOUT } from "./layout";
import { WorldScene } from "./scenes/WorldScene";

const gameplay = requireElement("gameplay");

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameplay,
  // Canvas size equals the gameplay viewport: 1 world pixel = 1 CSS pixel at zoom 1.
  width: LAYOUT.gameplay.width,
  height: LAYOUT.gameplay.height,
  backgroundColor: "#1d2129",
  // Disables texture smoothing/antialiasing and rounds sprite positions (D-030).
  pixelArt: true,
  scale: {
    // Fixed size; no automatic scaling. Smaller-window behavior is an open decision.
    mode: Phaser.Scale.NONE,
    // Stop Phaser from resizing the parent element; style.css owns the layout.
    expandParent: false,
  },
  scene: [WorldScene],
});

game.events.once(Phaser.Core.Events.READY, () => {
  // Wait one frame so the canvas is in the DOM and laid out before measuring.
  requestAnimationFrame(() => reportLayout(game));
});

function reportLayout(game: Phaser.Game): void {
  const container = requireElement("game-container").getBoundingClientRect();
  const hud = requireElement("hud").getBoundingClientRect();
  const view = gameplay.getBoundingClientRect();
  const canvas = game.canvas.getBoundingClientRect();
  const camera = game.scene.getScene("world").cameras.main;
  const extent = visibleExtentFromCenter(
    camera.width,
    camera.height,
    camera.zoom,
  );

  const rows: [string, string][] = [
    ["Container (CSS px)", size(container)],
    ["HUD (CSS px)", size(hud)],
    ["Gameplay (CSS px)", size(view)],
    ["Canvas (CSS px)", size(canvas)],
    ["Canvas backing (px)", `${game.canvas.width}×${game.canvas.height}`],
    ["devicePixelRatio", String(window.devicePixelRatio)],
    ["Camera zoom", String(camera.zoom)],
    ["Camera center (world)", `${camera.midPoint.x}, ${camera.midPoint.y}`],
    ["Visible from center", `±${extent.horizontal} × ±${extent.vertical}`],
    ["≥300 each way?", meetsVisibilityTarget(extent) ? "yes" : "NO"],
    ["HUD/gameplay overlap?", hud.right > view.left ? "YES" : "no"],
  ];

  const list = requireElement("hud-debug");
  list.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  console.table(Object.fromEntries(rows));

  verifyLayout(container, hud, view, canvas);
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

function size(rect: DOMRect): string {
  return `${rect.width}×${rect.height}`;
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element in index.html`);
  return el;
}
