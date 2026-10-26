import {
  ABILITY_ITEM_TYPES,
  ANY_LISTING,
  ARMOR_TYPES,
  ARTIFACT_IDS,
  ARTIFACTS,
  type ArtifactId,
  type BuyOrder,
  CLASS_IDS,
  CLASSES,
  EXCHANGE,
  exchangeFee,
  type ExchangeQuery,
  fitsOrder,
  isAccessorySlot,
  isArmorSlot,
  isValidPrice,
  type Item,
  type ItemSlot,
  type ItemSpec,
  itemKindName,
  type Listing,
  type MarketKey,
  marketKeyName,
  marketKeyOf,
  type Potion,
  potionName,
  type PriceWindow,
  RARITIES,
  RARITY_NAMES,
  ROLL_WISHES,
  type RollWish,
  type SerfSummary,
  type ServerMessage,
  STAT_KEYS,
  STAT_LABELS,
  type StatKey,
  WEAPON_TYPES,
} from "@serfdom/shared";
import {
  button,
  el,
  itemCard,
  potionCard,
  refreshTip,
  select,
} from "./ui-parts";

/*
 * The Grand Serf Exchange tab (D-155, D-156), in the spirit of RuneScape's
 * Grand Exchange: Browse (filters, roll chips, Buy), Sell (pick a stash
 * item or rack potion, see its price history and buy orders, list or sell
 * now), and My trades (the collection box, buy orders, listings, history).
 * The server decides every trade; this only shows and asks.
 */

export interface ExchangeActions {
  listOnExchange(
    what: { itemId: number } | { potionId: number },
    price: number,
  ): void;
  cancelListing(listingId: number): void;
  buyListing(listingId: number): void;
  browseExchange(query: ExchangeQuery): void;
  /** Price history and the best buy orders for one kind of item (D-156). */
  exchangeMarket(key: MarketKey): void;
  placeOrder(key: MarketKey, rolls: RollWish[], price: number): void;
  cancelOrder(orderId: number): void;
  sellToOrder(
    orderId: number,
    what: { itemId: number } | { potionId: number },
  ): void;
  collectExchange(): void;
}

type Stash = Extract<ServerMessage, { type: "stash" }>;
type Page = Extract<ServerMessage, { type: "exchangePage" }>;
type Mine = Extract<ServerMessage, { type: "exchangeMine" }>;
type Market = { windows: PriceWindow[]; orders: BuyOrder[] };
type Thing = { item: Item | null; potion: Potion | null };

const WINDOW_NAMES: Record<PriceWindow["window"], string> = {
  "24h": "Last 24 hours",
  "7d": "Last week",
  "30d": "Last month",
  all: "All time",
};

const SLOT_OPTIONS: readonly (readonly [ItemSlot, string])[] = [
  ["weapon", "Weapons"],
  ["ability", "Ability items"],
  ["head", "Head"],
  ["chest", "Chest"],
  ["legs", "Legs"],
  ["gloves", "Gloves"],
  ["ring", "Rings"],
  ["necklace", "Necklaces"],
  ["cape", "Capes"],
];

/** An order being written: which kind of item, its rolls, the most to pay. */
interface OrderDraft {
  kind: "tiered" | "artifact" | "potion";
  slot: ItemSlot;
  type: string;
  tier: number;
  artifact: ArtifactId;
  shiny: boolean;
  stat: StatKey;
  rolls: RollWish[];
  price: string;
}

export class ExchangeScreen {
  /** The browse query; a reply for an older one is ignored. */
  query: ExchangeQuery = { ...ANY_LISTING };
  private view: "browse" | "sell" | "trades" = "browse";
  private page: Page | null = null;
  private mine: Mine | null = null;
  /** Price histories and orders by kind, asked for once until a trade changes them. */
  private readonly markets = new Map<MarketKey, Market>();
  private readonly asked = new Set<MarketKey>();
  /** Market panels on screen, refilled in place when their data arrives. */
  private panels: { key: MarketKey; fill: () => void }[] = [];
  /** The Sell view's pick: a stash item by id, or a rack potion by stat. */
  private pick: { itemId: number } | { stat: StatKey } | null = null;
  private sellPrice = "";
  private draft: OrderDraft = {
    kind: "tiered",
    slot: "weapon",
    type: "sword",
    tier: 4,
    artifact: ARTIFACT_IDS[0]!,
    shiny: false,
    stat: "hp",
    rolls: [],
    price: "",
  };

  constructor(
    private readonly actions: ExchangeActions,
    /** Rebuilds the whole tab. */
    private readonly redraw: () => void,
  ) {}

  setPage(page: Page): void {
    if (JSON.stringify(page.query) !== JSON.stringify(this.query)) return;
    this.page = page;
    this.redraw();
  }

  setMine(mine: Mine): void {
    this.mine = mine;
    // Something changed hands: prices and orders may have moved.
    this.markets.clear();
    this.asked.clear();
    this.redraw();
  }

  setMarket(m: Extract<ServerMessage, { type: "exchangeMarket" }>): void {
    this.markets.set(m.key, { windows: m.windows, orders: m.orders });
    for (const p of this.panels) if (p.key === m.key) p.fill();
    refreshTip();
  }

  /** The cached market for a kind of item, asking the server the first time. */
  private market(key: MarketKey): Market | null {
    const m = this.markets.get(key);
    if (m) return m;
    if (!this.asked.has(key)) {
      this.asked.add(key);
      this.actions.exchangeMarket(key);
    }
    return null;
  }

  private browse(change: Partial<ExchangeQuery>): void {
    // Any filter change starts from the first page.
    this.query = { ...this.query, page: 0, ...change };
    this.page = null;
    this.actions.browseExchange(this.query);
    this.redraw();
  }

  build(body: HTMLElement, stash: Stash | null, playing: SerfSummary | null) {
    this.panels = [];
    const waiting = this.mine
      ? this.mine.collection.items.length + this.mine.collection.potions.length
      : 0;
    const views = el("div", "lb-boards");
    for (const [v, label] of [
      ["browse", "Browse"],
      ["sell", "Sell"],
      [
        "trades",
        waiting > 0 ? `My trades (${waiting} to collect)` : "My trades",
      ],
    ] as const) {
      const b = button(label, () => {
        this.view = v;
        this.redraw();
      });
      if (v === this.view) b.classList.add("active");
      views.append(b);
    }
    body.append(
      views,
      el(
        "p",
        "hint",
        `You have ${(stash?.gold ?? 0).toLocaleString("en")} gold.`,
      ),
    );
    if (this.view === "sell") this.buildSell(body, stash);
    else if (this.view === "trades") this.buildTrades(body);
    else this.buildBrowse(body, stash, playing);
  }

  // ---- Browse ----

  private buildBrowse(
    body: HTMLElement,
    stash: Stash | null,
    playing: SerfSummary | null,
  ): void {
    const q = this.query;
    const filters = el("div", "lb-filters exchange-filters");
    const slot = select(
      [["", "Everything"], ...SLOT_OPTIONS, ["potion", "Potions"]],
      q.slot ?? "",
      (v) =>
        this.browse({
          slot: v === "" ? null : (v as ExchangeQuery["slot"]),
          type: null,
        }),
    );
    slot.setAttribute("aria-label", "Item slot");
    const type = select(
      [["", "Any type"], ...(q.slot ? typeOptions(q.slot) : [])],
      q.type ?? "",
      (v) => this.browse({ type: v === "" ? null : v }),
    );
    type.disabled = q.slot === null;
    type.setAttribute("aria-label", "Item type");
    const rarity = select(
      [
        ["", "Any rarity"],
        ...RARITIES.map((r) => [r, rarityLabel(r)] as const),
      ],
      q.rarity ?? "",
      (v) =>
        this.browse({
          rarity: v === "" ? null : (v as ExchangeQuery["rarity"]),
        }),
    );
    rarity.setAttribute("aria-label", "Rarity");
    const classes = select(
      [
        ["", "Any class"],
        ...CLASS_IDS.map((c) => [c, `${CLASSES[c].name} can use`] as const),
      ],
      q.classId ?? "",
      (v) =>
        this.browse({
          classId: v === "" ? null : (v as ExchangeQuery["classId"]),
        }),
    );
    classes.setAttribute("aria-label", "Usable by class");
    const shiny = checkbox("Shiny only", q.shiny, (on) =>
      this.browse({ shiny: on }),
    );
    filters.append(slot, type, rarity, classes, shiny);
    if (playing?.classId && q.classId !== playing.classId) {
      const id = playing.classId;
      filters.append(
        button(`For my ${CLASSES[id].name}`, () =>
          this.browse({ classId: id }),
        ),
      );
    }
    const search = document.createElement("form");
    const text = document.createElement("input");
    text.type = "text";
    text.placeholder = "Search names";
    text.maxLength = EXCHANGE.maxSearch;
    text.value = q.search;
    text.setAttribute("aria-label", "Search names");
    search.append(text);
    search.addEventListener("submit", (e) => {
      e.preventDefault();
      this.browse({ search: text.value });
    });
    filters.append(
      search,
      select(
        [
          ["newest", "Newest"],
          ["cheapest", "Cheapest"],
          ["dearest", "Dearest"],
        ],
        q.sort,
        (v) => this.browse({ sort: v as ExchangeQuery["sort"] }),
      ),
    );
    body.append(
      filters,
      rollChips(
        "Must roll",
        q.rolls,
        (rolls) => this.browse({ rolls }),
        "None picked: any rolls or none.",
      ),
    );
    const page = this.page;
    if (!page) {
      body.append(el("p", "hint", "Loading…"));
      return;
    }
    if (page.listings.length === 0) {
      body.append(el("p", "hint", "Nothing listed matches."));
      return;
    }
    const gold = stash?.gold ?? 0;
    const grid = el("div", "item-grid exchange-grid");
    for (const l of page.listings) {
      const key = keyOf(l);
      const more = () => [
        el("span", "tip-price", `Listed for ${gold$(l.price)}`),
        ...this.marketLines(key),
      ];
      const card = l.item
        ? itemCard(l.item, more)
        : potionCard(l.potion!.stat, 1, more);
      card.append(el("span", "price", gold$(l.price)));
      if (l.mine) {
        card.append(el("span", "hint", "Your listing"));
      } else {
        const buy = button("Buy", () => this.actions.buyListing(l.id));
        buy.disabled = gold < l.price;
        card.append(buy);
      }
      card.append(
        button("Order…", () => {
          this.orderFor(l, q.rolls);
          this.view = "trades";
          this.redraw();
        }),
      );
      grid.append(card);
    }
    body.append(grid);
    const pages = Math.max(1, Math.ceil(page.total / EXCHANGE.pageSize));
    const pager = el("div", "lb-filters");
    const prev = button("Previous", () => this.browse({ page: q.page - 1 }));
    prev.disabled = q.page <= 0;
    const next = button("Next", () => this.browse({ page: q.page + 1 }));
    next.disabled = q.page + 1 >= pages;
    pager.append(
      prev,
      el(
        "span",
        "hint",
        `Page ${q.page + 1} of ${pages} · ${page.total} listed`,
      ),
      next,
    );
    body.append(pager);
  }

  /** A listing's price history and best order, short, for its tooltip. */
  private marketLines(key: MarketKey): HTMLElement[] {
    const m = this.market(key);
    if (!m) return [el("span", "hint", "Loading price history…")];
    const avg = m.windows
      .map(
        (w) =>
          `${w.window} ${w.average === null ? "—" : w.average.toLocaleString("en")}`,
      )
      .join(" · ");
    const best = m.orders[0];
    return [
      el("span", "tip-market", `Average sale: ${avg}`),
      el(
        "span",
        "tip-market",
        best ? `Best buy order: ${gold$(best.price)}` : "No buy orders",
      ),
    ];
  }

  /** Starts an order for the same kind of item as a listing. */
  private orderFor(l: Pick<Listing, "item" | "potion">, rolls: RollWish[]) {
    const d = this.draft;
    if (l.potion) {
      this.draft = { ...d, kind: "potion", stat: l.potion.stat, rolls: [] };
    } else if (l.item?.artifact) {
      this.draft = {
        ...d,
        kind: "artifact",
        artifact: l.item.artifact,
        shiny: l.item.shiny === true,
        rolls: [...rolls],
      };
    } else if (l.item) {
      this.draft = {
        ...d,
        kind: "tiered",
        slot: l.item.slot,
        type: l.item.type ?? "",
        tier: l.item.tier,
        shiny: l.item.shiny === true,
        rolls: [...rolls],
      };
    }
  }

  // ---- Sell ----

  private buildSell(body: HTMLElement, stash: Stash | null): void {
    if (!stash) {
      body.append(el("p", "hint", "Loading…"));
      return;
    }
    const listed = this.mine?.listings.length ?? 0;
    body.append(
      el(
        "p",
        "hint",
        `Pick something from your stash or potion rack. ${listed}/${EXCHANGE.maxListings} listings.`,
      ),
    );
    const picked = this.picked(stash);
    if (!picked) this.pick = null;
    const layout = el("div", "exchange-sell");
    const list = el("div", "exchange-sell-list");
    list.append(el("h3", "dungeon-group", "Stash"));
    if (stash.items.length === 0) list.append(el("p", "hint", "Empty."));
    const items = el("div", "item-grid short");
    for (const item of stash.items) {
      const card = itemCard(item);
      if (this.pick && "itemId" in this.pick && this.pick.itemId === item.id) {
        card.classList.add("selected");
      }
      card.addEventListener("click", () => this.choose({ itemId: item.id }));
      items.append(card);
    }
    list.append(items, el("h3", "dungeon-group", "Potion rack"));
    const byStat = STAT_KEYS.map(
      (stat) => [stat, stash.rack.filter((p) => p.stat === stat)] as const,
    ).filter(([, ps]) => ps.length > 0);
    if (byStat.length === 0) list.append(el("p", "hint", "Empty."));
    const potions = el("div", "item-grid short");
    for (const [stat, ps] of byStat) {
      const card = potionCard(stat, ps.length);
      if (this.pick && "stat" in this.pick && this.pick.stat === stat) {
        card.classList.add("selected");
      }
      card.addEventListener("click", () => this.choose({ stat }));
      potions.append(card);
    }
    list.append(potions);
    layout.append(list, this.sellPanel(picked));
    body.append(layout);
  }

  private choose(pick: { itemId: number } | { stat: StatKey }): void {
    this.pick = pick;
    this.sellPrice = "";
    this.redraw();
  }

  /** The picked stash item or rack potion, if it is still there. */
  private picked(
    stash: Stash,
  ): { thing: Thing; what: { itemId: number } | { potionId: number } } | null {
    const p = this.pick;
    if (!p) return null;
    if ("itemId" in p) {
      const item = stash.items.find((i) => i.id === p.itemId);
      return item
        ? { thing: { item, potion: null }, what: { itemId: item.id } }
        : null;
    }
    const potion = stash.rack.find((x) => x.stat === p.stat);
    return potion
      ? { thing: { item: null, potion }, what: { potionId: potion.id } }
      : null;
  }

  private sellPanel(
    picked: {
      thing: Thing;
      what: { itemId: number } | { potionId: number };
    } | null,
  ): HTMLElement {
    const panel = el("div", "exchange-panel");
    if (!picked) {
      panel.append(
        el("p", "hint", "Pick an item or potion to see what it sells for."),
      );
      return panel;
    }
    const { thing, what } = picked;
    const key = keyOf(thing);
    panel.append(
      thing.item ? itemCard(thing.item) : el("h3", "", marketKeyName(key)),
    );
    panel.append(
      this.marketPanel(key, {
        sellNow: (o) =>
          fitsOrder(thing, o) && !o.mine
            ? () => this.actions.sellToOrder(o.id, what)
            : null,
      }),
    );
    const form = document.createElement("form");
    form.className = "exchange-form";
    const price = priceInput(this.sellPrice, "Your price");
    const note = el("span", "hint", "");
    const update = () => {
      this.sellPrice = price.value;
      const p = Number(price.value);
      const best = this.markets
        .get(key)
        ?.orders.find((o) => !o.mine && fitsOrder(thing, o));
      note.textContent = !isValidPrice(p)
        ? ""
        : best && best.price >= p
          ? `A buy order pays ${gold$(best.price)}: it sells at once for that (you get ${gold$(best.price - exchangeFee(best.price))}).`
          : `You get ${gold$(p - exchangeFee(p))} after the 5% fee.`;
    };
    price.addEventListener("input", update);
    update();
    const go = document.createElement("button");
    go.type = "submit";
    go.textContent = "List";
    form.append(price, go, note);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = Number(price.value);
      if (!isValidPrice(p)) {
        note.textContent = `A whole number from 1 to ${EXCHANGE.maxPrice.toLocaleString("en")}.`;
        return;
      }
      this.sellPrice = "";
      this.actions.listOnExchange(what, p);
    });
    panel.append(form);
    return panel;
  }

  /**
   * A kind of item's price history (24 hours, week, month, all time) and
   * its best buy orders; `sellNow` offers a button on the ones that fit.
   * Refilled in place when the data arrives.
   */
  private marketPanel(
    key: MarketKey,
    opts: { sellNow?: (o: BuyOrder) => (() => void) | null } = {},
  ): HTMLElement {
    const box = el("div", "market-panel");
    const fill = () => {
      const m = this.markets.get(key) ?? null;
      box.replaceChildren(el("h4", "", "Price history"));
      if (!m) {
        box.append(el("p", "hint", "Loading…"));
        return;
      }
      const table = el("div", "market-windows");
      for (const w of m.windows) {
        table.append(
          el("span", "", WINDOW_NAMES[w.window]),
          el(
            "span",
            "",
            w.average === null
              ? "No sales"
              : `${gold$(w.average)} average · ${w.sales} sold`,
          ),
        );
      }
      box.append(table, el("h4", "", "Buy orders"));
      if (m.orders.length === 0) {
        box.append(el("p", "hint", "None."));
        return;
      }
      const list = el("div", "market-orders");
      for (const o of m.orders) {
        const row = el("div", "market-order");
        row.append(
          el("span", "price", gold$(o.price)),
          el(
            "span",
            "hint",
            [
              o.rolls.length > 0
                ? `wants ${o.rolls.map(rollLabel).join(", ")}`
                : "",
              o.mine ? "yours" : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        );
        const sell = opts.sellNow?.(o);
        if (sell) row.append(button(`Sell now for ${gold$(o.price)}`, sell));
        list.append(row);
      }
      box.append(list);
    };
    this.panels.push({ key, fill });
    this.market(key); // asks the server the first time
    fill();
    return box;
  }

  // ---- My trades ----

  private buildTrades(body: HTMLElement): void {
    const mine = this.mine;
    if (!mine) {
      body.append(el("p", "hint", "Loading…"));
      return;
    }
    // The collection box: everything bought waits here (D-156).
    const box = mine.collection;
    const waiting = box.items.length + box.potions.length;
    body.append(el("h3", "dungeon-group", "Collection box"));
    if (waiting === 0) {
      body.append(el("p", "hint", "Empty. What you buy waits here."));
    } else {
      const grid = el("div", "item-grid short");
      for (const item of box.items) grid.append(itemCard(item));
      for (const p of box.potions) grid.append(potionCard(p.stat, 1));
      body.append(
        grid,
        button(`Collect ${waiting}`, () => this.actions.collectExchange()),
        el(
          "p",
          "hint",
          "Collecting moves them to your stash and rack, as far as there is room.",
        ),
      );
    }
    body.append(
      el(
        "h3",
        "dungeon-group",
        `Buy orders (${mine.orders.length}/${EXCHANGE.maxOrders})`,
      ),
    );
    if (mine.orders.length > 0) {
      const list = el("div", "trade-list");
      for (const o of mine.orders) {
        const row = el("div", "trade-row");
        row.append(
          el("span", "trade-name", marketKeyName(o.key)),
          el(
            "span",
            "hint",
            o.rolls.length > 0
              ? `with ${o.rolls.map(rollLabel).join(", ")}`
              : "",
          ),
          el("span", "trade-price", `up to ${gold$(o.price)}`),
          button("Cancel", () => this.actions.cancelOrder(o.id)),
        );
        list.append(row);
      }
      body.append(list);
    }
    body.append(this.orderForm());
    body.append(
      el(
        "h3",
        "dungeon-group",
        `My listings (${mine.listings.length}/${EXCHANGE.maxListings})`,
      ),
    );
    if (mine.listings.length === 0) {
      body.append(el("p", "hint", "None. List things from the Sell view."));
    } else {
      const grid = el("div", "item-grid short");
      for (const l of mine.listings) {
        const card = l.item ? itemCard(l.item) : potionCard(l.potion!.stat, 1);
        card.append(
          el("span", "price", gold$(l.price)),
          button("Take back", () => this.actions.cancelListing(l.id)),
        );
        grid.append(card);
      }
      body.append(grid);
    }
    body.append(el("h3", "dungeon-group", "Latest trades"));
    if (mine.sales.length === 0) {
      body.append(el("p", "hint", "Nothing sold or bought yet."));
      return;
    }
    const list = el("div", "trade-list");
    for (const s of mine.sales) {
      const row = el("div", "trade-row");
      row.append(
        el("span", "trade-name", s.what),
        el(
          "span",
          "lb-exp",
          s.role === "sold"
            ? `Sold for ${gold$(s.price)} (−${s.fee} fee)`
            : `Bought for ${gold$(s.price)}`,
        ),
        el("span", "hint", new Date(s.at).toLocaleString()),
      );
      list.append(row);
    }
    body.append(list);
  }

  /** Place a buy order: which item, which rolls, the most you pay (D-156). */
  private orderForm(): HTMLElement {
    const d = this.draft;
    const set = (change: Partial<OrderDraft>) => {
      this.draft = { ...this.draft, ...change };
      this.redraw();
    };
    const wrap = el("div", "exchange-panel order-form");
    wrap.append(el("h4", "", "Place a buy order"));
    const row = el("div", "lb-filters");
    row.append(
      select(
        [
          ["tiered", "Tiered item"],
          ["artifact", "Artifact"],
          ["potion", "Potion"],
        ],
        d.kind,
        (v) => set({ kind: v as OrderDraft["kind"], rolls: [] }),
      ),
    );
    if (d.kind === "tiered") {
      row.append(
        select(SLOT_OPTIONS, d.slot, (v) => {
          const slot = v as ItemSlot;
          set({ slot, type: typeOptions(slot)[0]![0] });
        }),
        select(typeOptions(d.slot), d.type, (v) => set({ type: v })),
        select(
          Array.from({ length: 11 }, (_, t) => [String(t), `T${t}`] as const),
          String(d.tier),
          (v) => set({ tier: Number(v) }),
        ),
      );
    } else if (d.kind === "artifact") {
      row.append(
        select(
          ARTIFACT_IDS.map((id) => [id, ARTIFACTS[id].name] as const),
          d.artifact,
          (v) => set({ artifact: v as ArtifactId }),
        ),
      );
    } else {
      row.append(
        select(
          STAT_KEYS.map((s) => [s, potionName(s)] as const),
          d.stat,
          (v) => set({ stat: v as StatKey }),
        ),
      );
    }
    if (d.kind !== "potion") {
      row.append(checkbox("Shiny", d.shiny, (on) => set({ shiny: on })));
    }
    wrap.append(row);
    if (d.kind === "potion") {
      // Potions have no rolls.
    } else if (d.kind === "tiered" && d.tier < 4) {
      wrap.append(el("p", "hint", "T0–T3 items have no extra rolls."));
    } else {
      wrap.append(
        rollChips(
          "Must roll",
          d.rolls,
          (rolls) => set({ rolls }),
          "None picked: any rolls will do.",
        ),
      );
    }
    const key = draftKey(d);
    wrap.append(this.marketPanel(key));
    const form = document.createElement("form");
    form.className = "exchange-form";
    const price = priceInput(d.price, "Most you pay");
    price.addEventListener("input", () => {
      this.draft = { ...this.draft, price: price.value };
    });
    const go = document.createElement("button");
    go.type = "submit";
    go.textContent = "Place order";
    const note = el(
      "span",
      "hint",
      "The gold is set aside now (Cancel gives it back). A listing at or under your price is bought at once, at its price.",
    );
    form.append(price, go, note);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = Number(price.value);
      if (!isValidPrice(p)) {
        note.textContent = `A whole number from 1 to ${EXCHANGE.maxPrice.toLocaleString("en")}.`;
        return;
      }
      this.draft = { ...this.draft, price: "" };
      const rolls = d.kind === "tiered" && d.tier < 4 ? [] : d.rolls;
      this.actions.placeOrder(key, d.kind === "potion" ? [] : rolls, p);
    });
    wrap.append(form);
    return wrap;
  }
}

function keyOf(thing: Pick<Listing, "item" | "potion">): MarketKey {
  return thing.item
    ? marketKeyOf({ item: thing.item })
    : marketKeyOf({ potion: thing.potion! });
}

function draftKey(d: OrderDraft): MarketKey {
  if (d.kind === "potion") return marketKeyOf({ potion: { stat: d.stat } });
  if (d.kind === "artifact") {
    const def = ARTIFACTS[d.artifact];
    return marketKeyOf({
      item: {
        slot: def.slot,
        type: def.type,
        tier: 0,
        artifact: d.artifact,
        shiny: d.shiny,
      },
    });
  }
  return marketKeyOf({
    item: {
      slot: d.slot,
      type: d.type as ItemSpec["type"],
      tier: d.tier,
      shiny: d.shiny,
    },
  });
}

/** The types a slot's items come in, for the type filter and the order form. */
function typeOptions(slot: ItemSlot | "potion"): (readonly [string, string])[] {
  const kind = (s: ItemSlot, type: string) =>
    itemKindName({
      slot: s,
      type: type as ItemSpec["type"],
      tier: 0,
      rolls: [],
      luck: 0,
    });
  if (slot === "potion") {
    return STAT_KEYS.map((s) => [s, potionName(s)] as const);
  }
  if (slot === "weapon") {
    return WEAPON_TYPES.map((t) => [t, kind(slot, t)] as const);
  }
  if (slot === "ability") {
    return ABILITY_ITEM_TYPES.map((t) => [t, kind(slot, t)] as const);
  }
  if (isArmorSlot(slot)) {
    return ARMOR_TYPES.map(
      (t) =>
        [
          t,
          `${t.charAt(0).toUpperCase()}${t.slice(1)} ${kind(slot, t)}`,
        ] as const,
    );
  }
  if (isAccessorySlot(slot)) {
    return STAT_KEYS.map((s) => [s, kind(slot, s)] as const);
  }
  return [];
}

function rarityLabel(r: (typeof RARITIES)[number]): string {
  const tiers: Record<(typeof RARITIES)[number], string> = {
    common: " (T0–T3)",
    uncommon: " (T4–T6)",
    rare: " (T7–T9)",
    epic: " (T10)",
    artifact: "",
  };
  return `${RARITY_NAMES[r]}${tiers[r]}`;
}

function rollLabel(w: RollWish): string {
  return w === "luck" ? "LUCK" : STAT_LABELS[w];
}

/** Roll toggles (D-156): each picked one must be on the item, positive. */
function rollChips(
  label: string,
  picked: readonly RollWish[],
  onChange: (rolls: RollWish[]) => void,
  hint: string,
): HTMLElement {
  const row = el("div", "roll-chips");
  row.append(el("span", "hint", `${label}:`));
  for (const w of ROLL_WISHES) {
    const on = picked.includes(w);
    const chip = button(rollLabel(w), () =>
      // Kept in the standard order, so the same filter is the same query.
      onChange(ROLL_WISHES.filter((x) => (x === w ? !on : picked.includes(x)))),
    );
    chip.className = on ? "chip active" : "chip";
    chip.setAttribute("aria-pressed", String(on));
    row.append(chip);
  }
  row.append(el("span", "hint", picked.length === 0 ? hint : ""));
  return row;
}

function checkbox(
  label: string,
  checked: boolean,
  onChange: (on: boolean) => void,
): HTMLElement {
  const l = document.createElement("label");
  l.className = "setting";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  l.append(box, ` ${label}`);
  return l;
}

function priceInput(value: string, placeholder: string): HTMLInputElement {
  const price = document.createElement("input");
  price.type = "number";
  price.min = String(EXCHANGE.minPrice);
  price.max = String(EXCHANGE.maxPrice);
  price.step = "1";
  price.placeholder = placeholder;
  price.value = value;
  price.setAttribute("aria-label", `${placeholder} in gold`);
  return price;
}

function gold$(n: number): string {
  return `${n.toLocaleString("en")} gold`;
}
