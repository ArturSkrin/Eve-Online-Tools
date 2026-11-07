// Reaction scanner math, shared by the server (which tracks prices for these types) and the page (which
// recomputes everything live as settings change).
import data from "./data/reactions.json";
import type { ReactionMarketResponse } from "./schema";

export interface ReactionFormula {
  blueprintId: number;
  name: string;
  /** Seconds per run, before skills and structure. */
  time: number;
  materials: Array<{ typeId: number; quantity: number }>;
  products: Array<{ typeId: number; quantity: number }>;
}

export interface ReactionType {
  name: string;
  nameRu: string;
  groupId: number;
  group: string;
  volume: number;
}

export const REACTION_DATA = data as unknown as {
  sdeBuild: number;
  sdeReleaseDate: string;
  formulas: ReactionFormula[];
  types: Record<string, ReactionType>;
};

export const typeOf = (id: number): ReactionType | undefined => REACTION_DATA.types[id];

const GAS_GROUP = "Harvestable Cloud";
const FUEL_GROUP = "Fuel Block";

/**
 * Formulas that run on gas: they eat Harvestable Cloud, or eat the product of a formula that does (the
 * neurolink stabilizers and Meta-Operant enhancers sit a step above the gas).
 */
export const GAS_FORMULAS: Set<number> = (() => {
  const gas = new Set<number>();
  const gasProducts = new Set<number>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of REACTION_DATA.formulas) {
      if (gas.has(f.blueprintId)) continue;
      const usesGas = f.materials.some((m) => typeOf(m.typeId)?.group === GAS_GROUP || gasProducts.has(m.typeId));
      if (usesGas) {
        gas.add(f.blueprintId);
        f.products.forEach((p) => gasProducts.add(p.typeId));
        grew = true;
      }
    }
  }
  return gas;
})();

/** Product type id → the formula that makes it, to show "you can react this input yourself". */
export const MADE_BY: Map<number, number> = new Map(
  REACTION_DATA.formulas.flatMap((f) => f.products.map((p) => [p.typeId, f.blueprintId] as [number, number])),
);

export type Category = "gas" | "composite" | "intermediate" | "polymer" | "molecular" | "other";

export const CATEGORIES: Array<{ id: Category | "all"; label: string }> = [
  { id: "gas", label: "Газ" },
  { id: "intermediate", label: "Промежуточные" },
  { id: "composite", label: "Композиты" },
  { id: "polymer", label: "Полимеры" },
  { id: "molecular", label: "Молекулярные" },
  { id: "all", label: "Все" },
];

export function categoryOf(f: ReactionFormula): Category {
  if (GAS_FORMULAS.has(f.blueprintId)) return "gas";
  const group = typeOf(f.products[0].typeId)?.group ?? "";
  if (group === "Composite") return "composite";
  if (group === "Intermediate Materials") return "intermediate";
  if (group === "Hybrid Polymers") return "polymer";
  if (group === "Molecular-Forged Materials") return "molecular";
  return "other";
}

// --- settings and result -------------------------------------------------------------------------------------

export type BuyMode = "sell" | "buy";
export type SellMode = "sell" | "buy";

export interface ScannerSettings {
  /** Material saving of structure + rigs, percent (Tatara with a T1 rig ≈ 2.4). */
  meBonus: number;
  /** Time saving of structure + rigs, percent (Tatara ≈ 24 with rigs). */
  teBonus: number;
  /** Reactions skill level: −4% time per level. */
  reactionsSkill: number;
  /** System cost index for reactions, as a fraction (0.0352 = 3.52%). */
  costIndex: number;
  /** Structure owner's facility tax, percent. */
  facilityTax: number;
  /** SCC surcharge on every job, percent. */
  sccSurcharge: number;
  salesTax: number;
  brokerFee: number;
  /** Buy inputs from sell orders right away, or place buy orders (cheaper, slower, pays broker). */
  buyInputs: BuyMode;
  /** Sell output with a sell order (pays broker) or straight into buy orders. */
  sellOutput: SellMode;
  /** Share of the product's daily market volume you can realistically sell, percent. */
  marketShare: number;
  /**
   * What a sell order is assumed to fetch. "traded": the lower of the current lowest ask and what sell orders
   * actually filled at over the last week, because on a thin market one overpriced order sets the ask and
   * never sells. "ask": the current lowest ask as is.
   */
  salePricing: SalePricing;
}

export type SalePricing = "traded" | "ask";

/** A sale price with where it came from, so the page can say "the ask is above recent trades". */
export interface SaleQuote {
  /** Price used in the maths. */
  price: number | null;
  ask: number | null;
  /** Median of the daily highest trade over the last 7 trading days. */
  traded: number | null;
  /** Recent trades are more than 10% below the ask: the ask is not what this sells for. */
  cappedToTrades: boolean;
  /** Fewer than 15 of the last 30 days had any trade. */
  thin: boolean;
  tradeDays30: number | null;
}

/** Below this share of days with trades, a product's price and volume are shaky. */
const THIN_DAYS = 15;

export function saleQuote(typeId: number, m: ReactionMarketResponse, s: ScannerSettings, mode: SellMode): SaleQuote {
  const p = m.prices[typeId];
  const v = m.volumes[typeId];
  const traded = v?.highMedian7 ?? null;
  const tradeDays30 = v?.tradeDays30 ?? null;
  const thin = tradeDays30 != null && tradeDays30 < THIN_DAYS;
  if (mode === "buy") {
    // Selling into a buy order: the best bid is a real, fillable price.
    return { price: p?.buy ?? null, ask: p?.sell ?? null, traded, cappedToTrades: false, thin, tradeDays30 };
  }
  const ask = p?.sell ?? null;
  if (s.salePricing === "ask" || ask == null || traded == null) {
    return { price: ask, ask, traded, cappedToTrades: false, thin, tradeDays30 };
  }
  // Always price at the lower of the two; only flag it when the gap is big enough to matter (10%), not the
  // usual few percent between the ask and last week's fills on a healthy market.
  return { price: Math.min(ask, traded), ask, traded, cappedToTrades: traded < ask * 0.9, thin, tradeDays30 };
}

export const DEFAULT_SCANNER_SETTINGS: ScannerSettings = {
  meBonus: 2.4,
  teBonus: 24,
  reactionsSkill: 4,
  costIndex: 0.03,
  facilityTax: 1.5,
  sccSurcharge: 4,
  salesTax: 7.5,
  brokerFee: 3,
  buyInputs: "sell",
  sellOutput: "sell",
  marketShare: 20,
  salePricing: "traded",
};

export interface LineItem {
  typeId: number;
  name: string;
  quantity: number;
  unitPrice: number | null;
  total: number | null;
  madeBy: number | null;
  isGas: boolean;
  isFuel: boolean;
}

export interface ReactionResult {
  formula: ReactionFormula;
  category: Category;
  product: { typeId: number; name: string; quantity: number; quote: SaleQuote };
  inputs: LineItem[];
  /** ISK per run. Null when a price is missing. */
  inputCost: number | null;
  jobCost: number;
  outputValue: number | null;
  profit: number | null;
  marginPercent: number | null;
  /** Output value minus job cost minus what the inputs would fetch if sold instead (your own gas). */
  vsSellingInputs: number | null;
  runSeconds: number;
  runsPerDay: number;
  /** Units made per day by one slot. */
  unitsPerDay: number;
  /** Units the market takes per day in The Forge (30-day average). */
  marketPerDay: number | null;
  /** ISK per day per slot if every unit sold. */
  iskPerDayUncapped: number | null;
  /** ISK per day per slot, limited to your share of what the market actually takes. */
  iskPerDay: number | null;
  /** True when one slot makes more than your share of the market can absorb. */
  volumeLimited: boolean;
  missingPrices: string[];
}

const netSale = (price: number | null, s: ScannerSettings, mode: SellMode) =>
  price == null ? null : mode === "sell" ? price * (1 - (s.salesTax + s.brokerFee) / 100) : price * (1 - s.salesTax / 100);

export function analyzeReaction(
  f: ReactionFormula,
  m: ReactionMarketResponse,
  s: ScannerSettings,
): ReactionResult {
  const missing: string[] = [];
  const inputPrice = (typeId: number) => {
    const p = m.prices[typeId];
    // Buying from sell orders costs the lowest ask; a buy order costs the best bid plus broker fee.
    const v = s.buyInputs === "sell" ? p?.sell : p?.buy != null ? p.buy * (1 + s.brokerFee / 100) : null;
    return v ?? null;
  };
  const salePrice = (typeId: number) => saleQuote(typeId, m, s, s.sellOutput).price;

  // The material bonus never takes an input below one unit per run (the game uses max(runs, ⌈qty×runs×ME⌉)),
  // so a 1-per-run input such as a Molecular Condenser gets no saving; for the rest rounding is negligible.
  const meFactor = 1 - s.meBonus / 100;
  const inputs: LineItem[] = f.materials.map((mat) => {
    const t = typeOf(mat.typeId);
    const quantity = Math.max(1, mat.quantity * meFactor);
    const unitPrice = inputPrice(mat.typeId);
    if (unitPrice == null) missing.push(t?.name ?? `#${mat.typeId}`);
    return {
      typeId: mat.typeId,
      name: t?.name ?? `#${mat.typeId}`,
      quantity,
      unitPrice,
      total: unitPrice == null ? null : unitPrice * quantity,
      madeBy: MADE_BY.get(mat.typeId) ?? null,
      isGas: t?.group === GAS_GROUP,
      isFuel: t?.group === FUEL_GROUP,
    };
  });
  const inputCost = missing.length ? null : inputs.reduce((sum, i) => sum + i.total!, 0);

  // Job cost = EIV (adjusted prices × base quantities) × (system index + facility tax + SCC surcharge).
  const eiv = f.materials.reduce((sum, mat) => sum + (m.adjusted[mat.typeId] ?? 0) * mat.quantity, 0);
  const jobCost = eiv * (s.costIndex + (s.facilityTax + s.sccSurcharge) / 100);

  const product = f.products[0];
  const productName = typeOf(product.typeId)?.name ?? `#${product.typeId}`;
  const quote = saleQuote(product.typeId, m, s, s.sellOutput);
  const net = netSale(quote.price, s, s.sellOutput);
  if (net == null) missing.push(productName);
  const outputValue = net == null ? null : net * product.quantity;

  const profit = inputCost != null && outputValue != null ? outputValue - inputCost - jobCost : null;
  const marginPercent = profit != null && inputCost! + jobCost > 0 ? (profit / (inputCost! + jobCost)) * 100 : null;

  // What the same inputs would fetch if sold as they are (the honest test for your own gas).
  const inputsSale = inputs.every((i) => netSale(salePrice(i.typeId), s, s.sellOutput) != null)
    ? inputs.reduce((sum, i) => sum + netSale(salePrice(i.typeId), s, s.sellOutput)! * i.quantity, 0)
    : null;
  const vsSellingInputs = outputValue != null && inputsSale != null ? outputValue - jobCost - inputsSale : null;

  const runSeconds = f.time * (1 - s.teBonus / 100) * (1 - 0.04 * s.reactionsSkill);
  const runsPerDay = 86_400 / runSeconds;
  const unitsPerDay = runsPerDay * product.quantity;
  const marketPerDay = m.volumes[product.typeId]?.avgVolume30 ?? null;
  const iskPerDayUncapped = profit == null ? null : profit * runsPerDay;
  const sellable = marketPerDay == null ? unitsPerDay : Math.min(unitsPerDay, (marketPerDay * s.marketShare) / 100);
  const iskPerDay = profit == null ? null : (profit / product.quantity) * sellable;

  return {
    formula: f,
    category: categoryOf(f),
    product: { typeId: product.typeId, name: productName, quantity: product.quantity, quote },
    inputs,
    inputCost,
    jobCost,
    outputValue,
    profit,
    marginPercent,
    vsSellingInputs,
    runSeconds,
    runsPerDay,
    unitsPerDay,
    marketPerDay,
    iskPerDayUncapped,
    iskPerDay,
    volumeLimited: marketPerDay != null && unitsPerDay > (marketPerDay * s.marketShare) / 100,
    missingPrices: missing,
  };
}
