// Nullsec import math: what a unit costs landed in the home structure and what it fetches there.
import type { ImportRow } from "./schema";

export type JitaBuyMode = "sell" | "buy";
export type LocalSellMode = "sell" | "buy";
export type LocalPricing = "traded" | "ask";

export interface ImportSettings {
  /** Freight price per m³ Jita → home (JF service or your own hauling cost). */
  freightPerM3: number;
  /** Freight services also charge a share of the collateral, percent. */
  collateralPct: number;
  /** Broker fee on the home structure's market (set by its owner), percent. */
  structureBroker: number;
  /** Sales tax (same SCC rate in structures as in NPC stations), percent. */
  salesTax: number;
  /** Broker fee in Jita, for buying by buy order, percent. */
  jitaBroker: number;
  /** Buy in Jita from sell orders right away, or by buy order. */
  jitaBuy: JitaBuyMode;
  /** Sell at home with a sell order, or into a local buy order. */
  localSell: LocalSellMode;
  /** "traded": lower of the local ask and what sold in the region last week; "ask": the local ask as is. */
  localPricing: LocalPricing;
  /** Share of the region's daily sales you can expect to take, percent. */
  marketShare: number;
  /** Haul plan: cargo capacity, m³ (a jump freighter carries ~350 000 when packed with cargo expanders). */
  haulCapacity: number;
  /** Haul plan: the freight service's collateral cap, ISK. */
  haulCollateral: number;
  /** Haul plan: how many days of sales one haul should cover. */
  haulDays: number;
}

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  freightPerM3: 1000,
  collateralPct: 1,
  structureBroker: 1,
  salesTax: 7.5,
  jitaBroker: 3,
  jitaBuy: "sell",
  localSell: "sell",
  localPricing: "traded",
  marketShare: 30,
  haulCapacity: 300_000,
  haulCollateral: 10_000_000_000,
  haulDays: 7,
};

export interface ImportResult {
  row: ImportRow;
  /** ISK to buy one unit in Jita. */
  jitaCost: number | null;
  /** Freight for one unit: m³ × rate plus collateral share. */
  freight: number | null;
  landed: number | null;
  /** Price one unit sells at home, before tax and fees. */
  localPrice: number | null;
  /** Where localPrice came from. */
  priceSource: "ask" | "traded" | "buy" | null;
  net: number | null;
  profit: number | null;
  marginPercent: number | null;
  /** Units the region buys per day (30-day average). */
  soldPerDay: number | null;
  /** Units you can expect to sell per day: soldPerDay × your share. */
  yourPerDay: number | null;
  iskPerDay: number | null;
  /** Profit per m³ carried: what decides what goes into a full freighter. */
  iskPerM3: number | null;
  /** Days the current local stock lasts at the regional sales rate. */
  daysOfStock: number | null;
  /** Nothing for sale at home, yet it sells in the region: the Gila case. */
  outOfStock: boolean;
  /** The local ask is >10% above last week's trades: it is not what this sells for. */
  askAboveTrades: boolean;
  /** Fewer than 15 of the last 30 days had a trade. */
  thin: boolean;
  /** No Jita sell order: cannot be bought there. */
  notInJita: boolean;
  noHistory: boolean;
}

export function analyzeImport(row: ImportRow, s: ImportSettings): ImportResult {
  const jitaCost =
    s.jitaBuy === "sell" ? row.jita.sell : row.jita.buy != null ? row.jita.buy * (1 + s.jitaBroker / 100) : null;
  const freight =
    jitaCost != null && row.volume != null ? row.volume * s.freightPerM3 + (jitaCost * s.collateralPct) / 100 : null;
  const landed = jitaCost != null && freight != null ? jitaCost + freight : null;

  const traded = row.region?.highMedian7 ?? null;
  const ask = row.local.sellMin;
  let localPrice: number | null = null;
  let priceSource: ImportResult["priceSource"] = null;
  if (s.localSell === "buy") {
    localPrice = row.local.buyMax;
    priceSource = localPrice != null ? "buy" : null;
  } else if (ask == null) {
    // Shelf empty: you set the price, and last week's trades say what buyers pay.
    localPrice = traded;
    priceSource = traded != null ? "traded" : null;
  } else if (s.localPricing === "traded" && traded != null && traded < ask) {
    localPrice = traded;
    priceSource = "traded";
  } else {
    localPrice = ask;
    priceSource = "ask";
  }
  const fees = s.localSell === "sell" ? (s.salesTax + s.structureBroker) / 100 : s.salesTax / 100;
  const net = localPrice != null ? localPrice * (1 - fees) : null;
  const profit = net != null && landed != null ? net - landed : null;
  const marginPercent = profit != null && landed ? (profit / landed) * 100 : null;

  const soldPerDay = row.region ? row.region.avgVolume30 : null;
  const yourPerDay = soldPerDay != null ? (soldPerDay * s.marketShare) / 100 : null;
  const iskPerDay = profit != null && yourPerDay != null ? profit * yourPerDay : null;
  const iskPerM3 = profit != null && row.volume ? profit / row.volume : null;

  return {
    row,
    jitaCost,
    freight,
    landed,
    localPrice,
    priceSource,
    net,
    profit,
    marginPercent,
    soldPerDay,
    yourPerDay,
    iskPerDay,
    iskPerM3,
    daysOfStock: soldPerDay ? row.local.sellVolume / soldPerDay : null,
    outOfStock: row.local.sellVolume === 0 && (soldPerDay ?? 0) > 0,
    askAboveTrades: ask != null && traded != null && traded < ask * 0.9,
    thin: row.region?.tradeDays30 != null && row.region.tradeDays30 < 15,
    notInJita: row.jita.sell == null,
    noHistory: row.region == null,
  };
}

export interface HaulLine {
  r: ImportResult;
  quantity: number;
  m3: number;
  cost: number;
  profit: number;
}

/**
 * One freighter load: for each profitable item, enough units for `haulDays` of your share of sales minus what
 * is already on the shelf, filled by profit per m³ until cargo or collateral runs out.
 */
export function planHaul(results: ImportResult[], s: ImportSettings) {
  const lines: HaulLine[] = [];
  let m3 = 0;
  let collateral = 0;
  const candidates = results
    .filter((r) => r.profit != null && r.profit > 0 && r.row.volume && r.yourPerDay && r.landed && !r.notInJita)
    .sort((a, b) => b.iskPerM3! - a.iskPerM3!);
  for (const r of candidates) {
    const want = Math.ceil(r.yourPerDay! * s.haulDays - r.row.local.sellVolume * (s.marketShare / 100));
    if (want <= 0) continue;
    const byCargo = Math.floor((s.haulCapacity - m3) / r.row.volume!);
    const byCollateral = Math.floor((s.haulCollateral - collateral) / r.jitaCost!);
    const quantity = Math.min(want, byCargo, byCollateral);
    if (quantity <= 0) continue;
    m3 += quantity * r.row.volume!;
    collateral += quantity * r.jitaCost!;
    lines.push({ r, quantity, m3: quantity * r.row.volume!, cost: quantity * r.landed!, profit: quantity * r.profit! });
  }
  return {
    lines,
    m3,
    collateral,
    cost: lines.reduce((t, l) => t + l.cost, 0),
    profit: lines.reduce((t, l) => t + l.profit, 0),
  };
}
