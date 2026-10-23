import * as Phaser from "phaser";
import type { SerfSummary, ServerMessage } from "@serfdom/shared";
import {
  ABILITY_NAMES,
  ABILITIES,
  className,
  FIRE_MODE_LABELS,
  itemName,
  loadoutOf,
  luckOf,
  rotateVec,
  STAT_KEYS,
  STAT_LABELS,
} from "@serfdom/shared";
import "./style.css";
import "./screens.css";
import {
  INITIAL_SCREEN,
  nextScreen,
  type Screen,
  type ScreenEvent,
} from "./app-state";
import {
  clearToken,
  loadLastSerf,
  loadToken,
  saveLastSerf,
  saveToken,
} from "./auth-store";
import { meetsVisibilityTarget, visibleExtentFromCenter } from "./camera-math";
import { DebugList } from "./debug-list";
import { LAYOUT } from "./layout";
import type { ConnectionStatus } from "./net";
import { WorldScene } from "./scenes/WorldScene";
import { ScreenView, statText } from "./screens";

const gameplay = requireElement("gameplay");
const layoutList = new DebugList(requireElement("hud-layout"));
const liveList = new DebugList(requireElement("hud-live"));
const serfList = new DebugList(requireElement("hud-serf"));
/** The serf being played, as the server last sent it (for the HUD). */
let playedSerf: SerfSummary | null = null;

/** What Space does for this serf (D-092, D-096). */
function abilityText(serf: SerfSummary | null): string {
  if (!serf) return "—";
  const ability = loadoutOf(serf).ability;
  if (ability) {
    return `${ABILITY_NAMES[ability.kind]} (T${ability.tier}) · ${ABILITIES[ability.kind].mpCost} MP`;
  }
  const item = serf.items.find((i) => i.equipped === "ability");
  if (item) return `${itemName(item)}: its ability arrives in 10b–10d`;
  return serf.classId
    ? "none (wear your class ability item)"
    : "none before a class";
}
const hpFill = requireElement("hp-fill");
const mpFill = requireElement("mp-fill");

/** The HUD's HP and MP bars (D-096): empty outside a run. */
function setBars(hp: number, maxHp: number, mp: number, maxMp: number): void {
  hpFill.style.width = `${maxHp > 0 ? (100 * hp) / maxHp : 0}%`;
  mpFill.style.width = `${maxMp > 0 ? (100 * mp) / maxMp : 0}%`;
}

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

/** Which screen is showing (menu, queue, run, results); see app-state.ts. */
let screen: Screen = INITIAL_SCREEN;

game.events.once(Phaser.Core.Events.READY, () => {
  const net = worldScene(game).net;
  const dispatch = (event: ScreenEvent) => {
    screen = nextScreen(screen, event);
  };
  const view = new ScreenView(requireElement("screen"), {
    queue: (dungeon) => {
      net.connection.sendQueue(dungeon);
      dispatch({ type: "queueRequested", dungeon });
    },
    leaveQueue: () => {
      net.connection.sendLeaveQueue();
      dispatch({ type: "leaveQueue" });
    },
    dismissResults: () => dispatch({ type: "dismissResults" }),
    openTab: (tab) => {
      if (tab === "leaderboard") net.connection.sendGetLeaderboard();
      if (tab === "stash") net.connection.sendGetStash();
      dispatch({ type: "openTab", tab });
    },
    submitLogin: (mode, email, password) => {
      if (mode === "register") net.connection.sendRegister(email, password);
      else net.connection.sendLogin(email, password);
      dispatch({ type: "loginSubmitted" });
    },
    switchLoginMode: () => dispatch({ type: "switchLoginMode" }),
    logout: () => net.connection.sendLogout(),
    createSerf: (name) => net.connection.sendCreateSerf(name),
    sellItem: (itemId) => net.connection.sendSellItem(itemId),
    equip: (itemId, serfId, slot) =>
      net.connection.sendEquip(itemId, serfId, slot),
    unequip: (serfId, slot) => net.connection.sendUnequip(serfId, slot),
    chooseClass: (serfId, classId) =>
      net.connection.sendChooseClass(serfId, classId),
    selectSerf: (serfId) => {
      saveLastSerf(serfId);
      net.connection.sendSelectSerf(serfId);
    },
  });
  // On every (re)connect: log back in with the saved token if there is one.
  const onConnected = () => {
    const token = loadToken();
    if (token) net.connection.sendResume(token);
    dispatch({ type: "connected", hasToken: token !== null });
  };
  net.onConnected = onConnected;
  net.onDisconnect = (reason) => dispatch({ type: "disconnected", reason });
  net.onLobby = (message, nowMs) => {
    if (message.type === "authOk") {
      saveToken(message.token);
      view.setAccount(message.email);
    } else if (message.type === "loggedOut") {
      // Also when logged in elsewhere: forget the token here, so the two
      // browsers do not keep logging each other out.
      clearToken();
      view.setAccount(null);
    } else if (message.type === "authError" && screen.kind === "resuming") {
      clearToken();
    } else if (message.type === "serfList") {
      view.setSerfs(message);
      onSerfList(message);
      playedSerf =
        message.serfs.find((s) => s.id === message.selectedId) ?? null;
      showSerf(playedSerf);
    } else if (message.type === "stash") {
      view.setStash(message);
      // Rewards waiting for room come first, also right after login (D-088, D-090).
      if (message.pending.length > 0 && screen.kind === "menu") {
        dispatch({ type: "openTab", tab: "stash" });
      }
    } else if (message.type === "stashError") {
      view.setStashError(message.reason);
    } else if (message.type === "leaderboard") {
      view.setLeaderboard(message.entries);
    } else if (message.type === "serfError") {
      view.setSerfError(message.reason);
    }
    dispatch({ type: "server", message, nowMs });
  };
  /**
   * Convenience after login: play the serf played last time on this
   * browser (or the only living one). With none, show the Serfs tab; once
   * one is chosen, go back to the dungeons.
   */
  let selected: number | null = null;
  const onSerfList = (list: Extract<ServerMessage, { type: "serfList" }>) => {
    const living = list.serfs.filter((s) => s.alive);
    if (list.selectedId === null) {
      const last = loadLastSerf();
      const pick =
        living.find((s) => s.id === last) ??
        (living.length === 1 ? living[0] : undefined);
      if (pick) {
        net.connection.sendSelectSerf(pick.id);
      } else if (screen.kind === "menu") {
        dispatch({ type: "openTab", tab: "serfs" });
      }
    } else if (list.selectedId !== selected && screen.kind === "menu") {
      saveLastSerf(list.selectedId);
      dispatch({ type: "openTab", tab: "dungeons" });
    }
    selected = list.selectedId;
  };

  /** The played serf's stats in the HUD (D-074: rolled by the server). */
  const showSerf = (serf: SerfSummary | null) => {
    serfList.set([
      [
        "Serf",
        serf
          ? `${serf.name} · ${className(serf.classId)} · Lv ${serf.level}`
          : "—",
      ],
      ...STAT_KEYS.map(
        (key) => [STAT_LABELS[key], serf ? statText(serf, key) : "—"] as const,
      ),
      // Reward chests per clear: 1 + each worn Luck item (D-068).
      [
        "LUCK",
        serf
          ? String(luckOf(serf.items.filter((i) => i.equipped !== null)))
          : "—",
      ],
    ]);
  };

  // The welcome may have arrived before these handlers were attached.
  if (net.connection.snapshot.status.kind === "connected") onConnected();

  // Wait one frame so the canvas is in the DOM and laid out before measuring.
  requestAnimationFrame(() => {
    reportLayout(game, true);
    game.events.on(Phaser.Core.Events.POST_RENDER, () => {
      worldScene(game).setGameKeysActive(screen.kind === "inRun");
      view.render(screen, performance.now());
      reportLive(game);
    });
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
    online,
    view,
    local,
    renderPosition,
    keys,
    pointer,
    pointerWorld,
    viewRotation,
    fireMode,
    totals,
    net,
    remotesVisible,
  } = scene.getDebugState();
  const position = local.position;
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
  const alive = view.enemies.filter((e) => e.hp > 0);
  const byKind = new Map<string, number>();
  for (const e of alive) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const enemies =
    [...byKind].map(([kind, n]) => `${n} ${kind}`).join(", ") || "none";

  const conn = net.connection.snapshot;
  setBars(local.hp, local.maxHp, local.mp, local.maxMp);
  liveList.set([
    ["Server", describeStatus(conn.status)],
    [
      "Online (guest ids)",
      conn.players.length > 0
        ? conn.players.map((id) => `#${id}`).join(" ")
        : "—",
    ],
    ["Screen", screen.kind],
    ["Movement + combat", online ? "server-authoritative" : "not in a run"],
    [
      "Pending / correction",
      online
        ? `${net.pendingCount} / ${net.lastCorrection.toFixed(2)} px`
        : "—",
    ],
    [
      "Snapshot size / rate",
      online
        ? `${net.lastSnapshotBytes} B / ${(net.bytesPerSecond / 1024).toFixed(1)} KB/s`
        : "—",
    ],
    ["Other players drawn", String(remotesVisible)],
    [
      "Others (world)",
      [...net.remotePositions(performance.now())]
        .map(([id, p]) => `#${id} ${Math.round(p.x)},${Math.round(p.y)}`)
        .join(" ") || "—",
    ],
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
    ["Ability (Space)", abilityText(playedSerf)],
    ["Player HP", local.hp > 0 ? `${local.hp.toFixed(1)}/${local.maxHp}` : "—"],
    [
      "Player MP",
      local.maxMp > 0 ? `${local.mp.toFixed(1)}/${local.maxMp}` : "—",
    ],
    ["Hits taken", String(totals.playerHits)],
    ["Enemies alive", enemies],
    ["Doors closed", online ? String(net.closedDoors.length) : "—"],
    ["Exit portal", online ? (view.portalOpen ? "OPEN" : "closed") : "—"],
    // Report this with any odd layout: it rebuilds the same map (D-104).
    ["Dungeon seed", net.seed === null ? "—" : String(net.seed)],
    [
      "In flight (yours/enemy)",
      `${view.projectiles.filter((p) => p.owner === "player").length}/${view.projectiles.filter((p) => p.owner === "enemy").length}`,
    ],
    ["Shots fired", String(totals.shots)],
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

function describeStatus(status: ConnectionStatus): string {
  switch (status.kind) {
    case "connecting":
      return "connecting…";
    case "connected":
      return `connected as #${status.playerId}`;
    case "disconnected":
      return "offline (retrying)";
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
