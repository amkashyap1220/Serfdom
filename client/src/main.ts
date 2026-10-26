import * as Phaser from "phaser";
import type { SerfSummary, ServerMessage } from "@serfdom/shared";
import {
  ABILITY_NAMES,
  ABILITIES,
  className,
  FIRE_MODE_LABELS,
  itemFullName,
  loadoutOf,
  rotateVec,
  STAT_KEYS,
  STAT_LABELS,
  DEFAULT_SETTINGS,
  keyName,
  type Settings,
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
  loadDebugHud,
  loadLastSerf,
  loadToken,
  saveDebugHud,
  saveLastSerf,
  saveToken,
} from "./auth-store";
import { Hud, type HudInput } from "./hud";
import { minimapShapes, MinimapView } from "./minimap";
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
    return `${ABILITY_NAMES[ability.kind]} (Tier ${ability.tier}) · ${ABILITIES[ability.kind].mpCost} MP`;
  }
  const item = serf.items.find((i) => i.equipped === "ability");
  if (item) return `${itemFullName(item)}: its ability arrives in 10b–10d`;
  return serf.classId
    ? "none (wear your class ability item)"
    : "none before a class";
}
const hud = new Hud({
  name: requireElement("hud-name"),
  hpFill: requireElement("hp-fill"),
  hpText: requireElement("hp-text"),
  mpFill: requireElement("mp-fill"),
  mpText: requireElement("mp-text"),
  expFill: requireElement("exp-fill"),
  expText: requireElement("exp-text"),
  ability: requireElement("hud-ability"),
  fire: requireElement("hud-fire"),
  run: requireElement("hud-run"),
  party: requireElement("hud-party"),
});
/** Your party as the server last sent it, for the HUD (D-146). */
let currentParty: HudInput["party"] = null;
const minimap = new MinimapView(
  requireElement("hud-minimap") as HTMLCanvasElement,
);
const debugPanel = requireElement("hud-debug");
/** The debug readout (D-146): hidden unless switched on (` or Settings). */
let debugHud = loadDebugHud();
/** The account's settings (D-159); the defaults while logged out. */
let settings: Settings = DEFAULT_SETTINGS;
debugPanel.hidden = !debugHud;

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
      if (tab === "leaderboard") {
        net.connection.sendGetLeaderboard(view.leaderboardQuery);
      }
      if (tab === "stash" || tab === "rack") net.connection.sendGetStash();
      if (tab === "exchange") {
        net.connection.sendGetStash();
        net.connection.sendExchangeMine();
        net.connection.sendExchangeBrowse(view.exchange.query);
      }
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
    drinkPotion: (potionId, serfId) =>
      net.connection.sendDrinkPotion(potionId, serfId),
    pourPotion: (potionId) => net.connection.sendPourPotion(potionId),
    chooseClass: (serfId, classId) =>
      net.connection.sendChooseClass(serfId, classId),
    answerClassSet: (serfId, accept) =>
      net.connection.sendAnswerClassSet(serfId, accept),
    takeFreeItem: (slot, type) => net.connection.sendTakeFreeItem(slot, type),
    selectSerf: (serfId) => {
      saveLastSerf(serfId);
      net.connection.sendSelectSerf(serfId);
    },
    invite: (name) => net.connection.sendPartyInvite(name),
    answerInvite: (inviteId, accept) =>
      net.connection.sendPartyAnswer(inviteId, accept),
    leaveParty: () => net.connection.sendPartyLeave(),
    removeMember: (playerId) => net.connection.sendPartyKick(playerId),
    setDebugHud: (on) => setDebug(on),
    saveSettings: (next) => {
      applySettings(next);
      net.connection.sendSaveSettings(next);
    },
    getLeaderboard: (query) => net.connection.sendGetLeaderboard(query),
    buyUpgrade: (kind) => net.connection.sendBuyUpgrade(kind),
    listOnExchange: (what, price) =>
      net.connection.sendExchangeList(what, price),
    cancelListing: (id) => net.connection.sendExchangeCancel(id),
    buyListing: (id) => net.connection.sendExchangeBuy(id),
    browseExchange: (query) => net.connection.sendExchangeBrowse(query),
    exchangeMarket: (key) => net.connection.sendExchangeMarket(key),
    placeOrder: (key, rolls, price) =>
      net.connection.sendExchangeOrder(key, rolls, price),
    cancelOrder: (id) => net.connection.sendExchangeCancelOrder(id),
    sellToOrder: (id, what) => net.connection.sendExchangeSellToOrder(id, what),
    collectExchange: () => net.connection.sendExchangeCollect(),
  });
  const setDebug = (on: boolean) => {
    debugHud = on;
    debugPanel.hidden = !on;
    saveDebugHud(on);
    view.setDebugHud(on);
  };
  view.setDebugHud(debugHud);
  /** New settings: the keys and fire mode for the game, and the Settings tab. */
  const applySettings = (next: Settings) => {
    settings = next;
    worldScene(game).applySettings(next.binds, next.fireMode);
    view.setSettings(next);
  };
  // The fire mode key changed the mode in a run: keep it for the account.
  worldScene(game).onFireModeChange = (fireMode) => {
    const next = { ...settings, fireMode };
    settings = next;
    view.setSettings(next);
    net.connection.sendSaveSettings(next);
  };
  // The debug key (` by default) shows or hides the readout anywhere but while typing.
  window.addEventListener("keydown", (e) => {
    if (e.code !== settings.binds.debug || e.repeat) return;
    if (e.target instanceof HTMLInputElement) return;
    setDebug(!debugHud);
  });
  // On every (re)connect: log back in with the saved token if there is one.
  const onConnected = () => {
    const token = loadToken();
    if (token) net.connection.sendResume(token);
    dispatch({ type: "connected", hasToken: token !== null });
  };
  net.onConnected = onConnected;
  net.onDisconnect = (reason) => {
    currentParty = null;
    // The server drops a disconnected player from their party (D-143).
    view.clearParty();
    dispatch({ type: "disconnected", reason });
  };
  net.onLobby = (message, nowMs) => {
    if (message.type === "authOk") {
      saveToken(message.token);
      view.setAccount(message.email);
    } else if (message.type === "settings") {
      applySettings(message.settings);
    } else if (message.type === "loggedOut") {
      // Also when logged in elsewhere: forget the token here, so the two
      // browsers do not keep logging each other out.
      clearToken();
      view.setAccount(null);
      applySettings(DEFAULT_SETTINGS);
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
      } else if (message.pendingPotions.length > 0 && screen.kind === "menu") {
        dispatch({ type: "openTab", tab: "rack" });
      }
    } else if (message.type === "stashError") {
      view.setStashError(message.reason);
    } else if (message.type === "leaderboard") {
      view.setLeaderboard(message);
    } else if (message.type === "serfError") {
      view.setSerfError(message.reason);
    } else if (message.type === "exchangePage") {
      view.exchange.setPage(message);
    } else if (message.type === "exchangeMarket") {
      view.exchange.setMarket(message);
    } else if (message.type === "exchangeMine") {
      view.exchange.setMine(message);
      // Something changed hands: the page being browsed is stale.
      net.connection.sendExchangeBrowse(view.exchange.query);
    } else if (message.type === "exchangeNotice") {
      view.setPartyNotice(message.text, false);
    } else if (message.type === "exchangeError") {
      view.setStashError(message.reason);
    } else if (message.type === "party") {
      currentParty = message.party;
      const status = net.connection.snapshot.status;
      view.setParty(
        message,
        status.kind === "connected" ? status.playerId : null,
      );
    } else if (message.type === "partyInvited") {
      view.addInvite(message, nowMs);
    } else if (message.type === "partyInviteGone") {
      view.removeInvite(message.inviteId);
    } else if (message.type === "partyNotice") {
      view.setPartyNotice(message.text, false);
    } else if (message.type === "partyError") {
      view.setPartyNotice(message.reason, true);
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
      ["LUCK", serf ? statText(serf, "luck") : "—"],
    ]);
  };

  // The welcome may have arrived before these handlers were attached.
  if (net.connection.snapshot.status.kind === "connected") onConnected();

  // Wait one frame so the canvas is in the DOM and laid out before measuring.
  requestAnimationFrame(() => {
    // Measured once the world scene exists, so its camera has its zoom.
    const first = worldScene(game);
    if (first.ready) reportLayout(game, true);
    else
      first.events.once(Phaser.Scenes.Events.CREATE, () =>
        reportLayout(game, true),
      );
    game.events.on(Phaser.Core.Events.POST_RENDER, () => {
      view.render(screen, performance.now());
      // Until the world scene exists (its sprites load first), there is no
      // game to read or key to capture.
      const scene = worldScene(game);
      if (!scene.ready) return;
      scene.setGameKeysActive(screen.kind === "inRun");
      scene.setDebugVisible(debugHud);
      renderHud(scene);
      // The debug readout costs work every frame; only while shown.
      if (debugHud) reportLive(game);
    });
  });
  // Re-measure on resize so the readout reflects what the window does now.
  window.addEventListener("resize", () => reportLayout(game, false));
});

/** The player HUD (D-146), every frame. */
function renderHud(scene: WorldScene): void {
  const { local, net, fireMode, view, renderPosition, viewRotation } =
    scene.getDebugState();
  const layout = net.layout;
  minimap.draw(
    net.online && layout
      ? minimapShapes({
          layout,
          seen: net.seenRooms,
          cleared: net.clearedRooms,
          closedDoors: net.closedDoors,
          portalOpen: view.portalOpen,
          me: renderPosition,
          others: [...net.remotePositions(performance.now()).values()],
          rotation: viewRotation,
        })
      : null,
  );
  const status = net.connection.snapshot.status;
  hud.render({
    serf: playedSerf,
    hp: local.hp,
    maxHp: local.maxHp,
    mp: local.mp,
    maxMp: local.maxMp,
    ability: net.online ? net.myAbility : null,
    abilityCooldown: net.selfState?.abilityCooldown ?? 0,
    fireMode,
    binds: settings.binds,
    dungeon: net.dungeon,
    clock: net.clock,
    party: currentParty,
    myId: status.kind === "connected" ? status.playerId : null,
    players: net.players,
  });
}

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
  const b = settings.binds;
  const held =
    [
      move.up ? keyName(b.up) : "",
      move.left ? keyName(b.left) : "",
      move.down ? keyName(b.down) : "",
      move.right ? keyName(b.right) : "",
      rotate.left ? keyName(b.turnLeft) : "",
      rotate.right ? keyName(b.turnRight) : "",
      rotate.reset ? keyName(b.resetView) : "",
      keys.ability ? keyName(b.ability) : "",
      pointer.leftDown ? "LMB" : "",
    ]
      .filter(Boolean)
      .join(" ") || "—";
  const alive = view.enemies.filter((e) => e.hp > 0);
  const byKind = new Map<string, number>();
  for (const e of alive) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const enemies =
    [...byKind].map(([kind, n]) => `${n} ${kind}`).join(", ") || "none";

  const conn = net.connection.snapshot;
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
    [
      `Fire mode (${keyName(settings.binds.fireMode)})`,
      FIRE_MODE_LABELS[fireMode],
    ],
    [`Ability (${keyName(settings.binds.ability)})`, abilityText(playedSerf)],
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
