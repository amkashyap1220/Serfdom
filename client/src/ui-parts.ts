import {
  ARTIFACTS,
  coinCounts,
  coinsOf,
  COINS,
  moneyFrom,
  armorTypeName,
  canEquip,
  CLASS_IDS,
  CLASSES,
  itemBonus,
  itemKindName,
  itemName,
  type ItemSpec,
  potionAmount,
  potionName,
  tierLabel,
  STAT_KEYS,
  STAT_LABELS,
  type StatKey,
  type Stats,
  weaponDamage,
} from "@serfdom/shared";

/*
 * Small DOM pieces the menu screens share: elements, buttons, selects, and
 * the compact item and potion cards with their one floating tooltip (D-156).
 */

export function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

export function select(
  options: readonly (readonly [string, string])[],
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const s = document.createElement("select");
  for (const [v, label] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    s.append(o);
  }
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

/**
 * An item, compact (D-156): its name in its rarity's colour (Shiny
 * shimmers, D-152). Everything else shows on hover or keyboard focus, with
 * anything `more` adds (an equip comparison, a price history).
 */
export function itemCard(
  item: ItemSpec,
  more?: () => HTMLElement[],
): HTMLElement {
  const card = el(
    "div",
    `item-card ${tierClass(item)}${item.shiny ? " shiny" : ""}`,
  );
  card.append(el("span", "item-name", itemName(item)));
  attachTip(card, () => [...itemDetails(item), ...(more?.() ?? [])]);
  return card;
}

/** The CSS class that colours an item by its tier (T0 grey, the worst). */
export function tierClass(item: Pick<ItemSpec, "tier" | "artifact">): string {
  return item.artifact ? "tier-artifact" : `tier-${item.tier}`;
}

/** An item's full details, for its tooltip. */
export function itemDetails(item: ItemSpec): HTMLElement[] {
  const out: HTMLElement[] = [
    el("span", `item-name tier-color ${tierClass(item)}`, itemName(item)),
    // The tier sits under the name (the user, 2026-10-26), in its colour.
    el("span", `item-tier tier-color ${tierClass(item)}`, tierLabel(item)),
  ];
  // What kind it is, when the name does not already say: "Leather Tunic", an Artifact's "Axe".
  const material = armorTypeName(item);
  const kind = material
    ? `${material} ${itemKindName(item)}`
    : itemKindName(item);
  if (kind !== itemName({ ...item, shiny: false })) {
    out.push(el("span", "item-kind", kind));
  }
  const base =
    item.slot === "weapon"
      ? `${weaponDamage(item.tier)} damage`
      : bonusText(itemBonus({ ...item, rolls: [] }));
  if (base) out.push(el("span", "item-base", base));
  if (item.rolls.length > 0) {
    const rolls = el("span", "item-rolls");
    for (const r of item.rolls) {
      rolls.append(
        el(
          "span",
          r.amount < 0 ? "roll-bad" : "roll-good",
          `${r.amount < 0 ? "−" : "+"}${Math.abs(r.amount)} ${STAT_LABELS[r.stat]}`,
        ),
      );
    }
    out.push(rolls);
  }
  if (item.luck > 0) out.push(el("span", "item-luck", "+1 LUCK"));
  if (item.artifact) {
    out.push(el("span", "item-effect", ARTIFACTS[item.artifact].effect));
  }
  const users = CLASS_IDS.filter((c) => canEquip(item, c));
  out.push(
    el(
      "span",
      "hint",
      users.length === CLASS_IDS.length
        ? "Any class"
        : users.length === 0
          ? "No class"
          : users.map((c) => CLASSES[c].name).join(", "),
    ),
  );
  return out;
}

/**
 * A card grid inside its own scroll box. The grid itself never has a
 * height limit, so its rows can all be as tall as the tallest card (a grid
 * with a max height shares that height out instead, and cards differ).
 * The grid's size classes ("short", "pending-grid") go on the box.
 */
export function gridBox(grid: HTMLElement): HTMLElement {
  const sizes = [...grid.classList].filter((c) => c !== "item-grid");
  const box = el("div", ["grid-scroll", ...sizes].join(" "));
  box.append(grid);
  return box;
}

/** The one floating tooltip (D-156), on screen so no scrolling list clips it. */
let tip: HTMLElement | null = null;
/** Shows the tooltip again for the card it shows (when its data arrives). */
let showing: (() => void) | null = null;

function tipElement(): HTMLElement {
  if (!tip) {
    tip = el("div", "item-tip");
    tip.hidden = true;
    document.body.append(tip);
  }
  return tip;
}

/** Where the tooltip may go: the game box, cut to the visible window. */
function tipBounds(): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const game = document.getElementById("game-container");
  const r = game?.getBoundingClientRect();
  return {
    left: Math.max(0, r?.left ?? 0),
    top: Math.max(0, r?.top ?? 0),
    right: Math.min(window.innerWidth, r?.right ?? window.innerWidth),
    bottom: Math.min(window.innerHeight, r?.bottom ?? window.innerHeight),
  };
}

/** Hides the tooltip (a screen rebuild removes its card without a mouseleave). */
export function hideTip(): void {
  if (tip) tip.hidden = true;
  showing = null;
}

/** Rebuilds the open tooltip, e.g. once a price history it asked for arrives. */
export function refreshTip(): void {
  showing?.();
}

/** Shows `build()` beside `card` while it is hovered or focused. */
export function attachTip(card: HTMLElement, build: () => HTMLElement[]): void {
  card.tabIndex = 0;
  const show = () => {
    if (!card.isConnected) {
      hideTip();
      return;
    }
    showing = show;
    const t = tipElement();
    t.replaceChildren(...build());
    t.hidden = false;
    // Kept inside the 1200×800 game box (and the visible window), not just
    // the window: a tall browser window would let it hang below the game.
    const box = tipBounds();
    const r = card.getBoundingClientRect();
    let x = r.right + 8;
    if (x + t.offsetWidth > box.right - 8) x = r.left - t.offsetWidth - 8;
    let y = r.top;
    if (y + t.offsetHeight > box.bottom - 8) {
      y = box.bottom - t.offsetHeight - 8;
    }
    t.style.left = `${Math.max(box.left + 8, x)}px`;
    t.style.top = `${Math.max(box.top + 8, y)}px`;
  };
  card.addEventListener("mouseenter", show);
  card.addEventListener("focus", show);
  card.addEventListener("mouseleave", hideTip);
  card.addEventListener("blur", hideTip);
}

/** A stat potion (D-118), compact like an item (D-156): what it adds on hover. */
export function potionCard(
  stat: StatKey,
  count: number,
  more?: () => HTMLElement[],
): HTMLElement {
  const card = el("div", "item-card potion-card");
  card.append(
    el(
      "span",
      "item-name",
      count > 1 ? `${potionName(stat)} ×${count}` : potionName(stat),
    ),
  );
  attachTip(card, () => [
    el("span", "item-name", potionName(stat)),
    el(
      "span",
      "item-base",
      `+${potionAmount(stat)} ${STAT_LABELS[stat]}, up to the max`,
    ),
    ...(more?.() ?? []),
  ]);
  return card;
}

export function bonusText(stats: Stats): string {
  return STAT_KEYS.filter((k) => stats[k] !== 0)
    .map((k) => `+${stats[k]} ${STAT_LABELS[k]}`)
    .join(" ");
}

/** Money as coins (D-157), each in its own colour: "2 Silver 535 Bronze". */
export function moneyEl(money: number, className = ""): HTMLElement {
  const out = el("span", `money ${className}`.trim());
  for (const p of coinsOf(money)) {
    out.append(
      el(
        "span",
        `coin coin-${p.coin}`,
        `${p.count.toLocaleString("en")} ${p.name}`,
      ),
    );
  }
  return out;
}

/**
 * A price typed as coins (D-157): four boxes, Platinum down to Bronze.
 * `value()` is the total in Bronze, or null if a box is not a whole
 * number of 0 or more (empty boxes count as 0).
 */
export function moneyInput(
  initial: number | null,
  label: string,
): {
  el: HTMLElement;
  value: () => number | null;
  onInput: (f: () => void) => void;
} {
  const wrap = el("span", "money-input");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", label);
  const counts = initial === null ? null : coinCounts(initial);
  const boxes = COINS.map((c) => {
    const box = document.createElement("input");
    box.type = "number";
    box.min = "0";
    box.step = "1";
    box.placeholder = "0";
    box.value = counts && counts[c.id] > 0 ? String(counts[c.id]) : "";
    box.setAttribute("aria-label", `${label}: ${c.name}`);
    const part = el("label", `coin-box coin-${c.id}`);
    part.append(box, el("span", "", c.name));
    wrap.append(part);
    return [c.id, box] as const;
  });
  return {
    el: wrap,
    value: () => {
      const parts: Record<string, number> = {};
      for (const [id, box] of boxes) {
        const n = box.value.trim() === "" ? 0 : Number(box.value);
        if (!Number.isSafeInteger(n) || n < 0) return null;
        parts[id] = n;
      }
      return moneyFrom(parts);
    },
    onInput: (f) => {
      for (const [, box] of boxes) box.addEventListener("input", f);
    },
  };
}
