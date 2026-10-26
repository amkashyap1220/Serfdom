import {
  ARTIFACTS,
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
  RARITY_NAMES,
  rarityOf,
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
    `item-card rarity-${rarityOf(item)}${item.shiny ? " shiny" : ""}`,
  );
  card.append(el("span", "item-name", itemName(item)));
  attachTip(card, () => [...itemDetails(item), ...(more?.() ?? [])]);
  return card;
}

/** An item's full details, for its tooltip. */
export function itemDetails(item: ItemSpec): HTMLElement[] {
  const out: HTMLElement[] = [
    el("span", `item-name rarity-${rarityOf(item)}`, itemName(item)),
    el(
      "span",
      "item-kind",
      `${RARITY_NAMES[rarityOf(item)]} ${item.artifact ? itemKindName(item) : armorTypeName(item) ? `${armorTypeName(item)} ${itemKindName(item)}` : itemKindName(item)}`,
    ),
  ];
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
    const r = card.getBoundingClientRect();
    let x = r.right + 8;
    if (x + t.offsetWidth > window.innerWidth - 8)
      x = r.left - t.offsetWidth - 8;
    let y = r.top;
    if (y + t.offsetHeight > window.innerHeight - 8) {
      y = window.innerHeight - t.offsetHeight - 8;
    }
    t.style.left = `${Math.max(8, x)}px`;
    t.style.top = `${Math.max(8, y)}px`;
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
