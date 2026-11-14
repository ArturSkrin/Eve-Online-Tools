import { inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { forEachRegionOrderPage, getMarketHistory, getMarketPrices, getSystemCostIndices, type EsiHistoryDay } from "./esi";
import { marketPrices, marketVolumes, type ReactionMarketResponse } from "@shared/schema";
import { REACTION_DATA } from "@shared/reactions";
import { log } from "./index";

// Jita prices and The Forge daily volumes for every item that goes into or comes out of a reaction, kept in
// Postgres so the scanner page loads instantly and survives ESI outages with the last known numbers.
export const THE_FORGE = 10000002;
const JITA_SYSTEM = 30000142;
const IKOSKIO = { systemId: 30045337, systemName: "Ikoskio" };
const PRICES_EVERY_MS = 30 * 60 * 1000;
const HISTORY_EVERY_MS = 12 * 60 * 60 * 1000;
const CONCURRENCY = 6;

/** Every tradeable type the formulas touch (formulas themselves are not traded here). */
export function trackedTypes(): number[] {
  const ids = new Set<number>();
  REACTION_DATA.formulas.forEach((f) => {
    f.materials.forEach((m) => ids.add(m.typeId));
    f.products.forEach((p) => ids.add(p.typeId));
  });
  return Array.from(ids).sort((a, b) => a - b);
}

export async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<number> {
  let failed = 0;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(items.slice(i, i + CONCURRENCY).map(fn));
    failed += results.filter((r) => r.status === "rejected").length;
  }
  return failed;
}

let refreshing = false;
let lastError: string | null = null;

/**
 * Jita best sell and buy for every type traded there, from one pass over all The Forge orders. Serves the
 * reaction scanner and the nullsec import scanner alike.
 */
export async function refreshPrices(): Promise<void> {
  const best = new Map<number, { sell: number | null; buy: number | null }>();
  const pages = await forEachRegionOrderPage(THE_FORGE, (orders) => {
    for (const o of orders) {
      if (o.system_id !== JITA_SYSTEM) continue;
      const b = best.get(o.type_id) ?? { sell: null, buy: null };
      if (o.is_buy_order) b.buy = b.buy == null ? o.price : Math.max(b.buy, o.price);
      else b.sell = b.sell == null ? o.price : Math.min(b.sell, o.price);
      best.set(o.type_id, b);
    }
  });
  const now = new Date();
  const rows = Array.from(best.entries()).map(([typeId, b]) => ({ typeId, sellMin: b.sell, buyMax: b.buy, updatedAt: now }));
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(marketPrices)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: marketPrices.typeId,
        set: { sellMin: sql`excluded.sell_min`, buyMax: sql`excluded.buy_max`, updatedAt: now },
      });
  }
  // Types with no Jita order left keep their last row; mark them gone so nothing is priced off stale orders.
  await db
    .update(marketPrices)
    .set({ sellMin: null, buyMax: null, updatedAt: now })
    .where(sql`${marketPrices.updatedAt} < ${now}`);
  lastError = null;
  log(`jita prices: ${rows.length} types from ${pages} pages`, "market");
}

/** Daily volume and traded prices from one type's market history. */
export function summarizeHistory(days: EsiHistoryDay[]) {
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const last30 = days.filter((d) => d.date >= since30);
  const last7 = days.filter((d) => d.date >= since7);
  const avgVolume30 = last30.reduce((s, d) => s + d.volume, 0) / 30;
  const vol7 = last7.reduce((s, d) => s + d.volume, 0);
  const avgPrice7 = vol7 > 0 ? last7.reduce((s, d) => s + d.average * d.volume, 0) / vol7 : null;
  // The day's highest trade is about where sell orders got filled (the daily average also mixes in sales
  // into buy orders). The median of the last 7 trading days ignores a single panic buy.
  const highs = last30
    .slice(-7)
    .map((d) => d.highest)
    .sort((a, b) => a - b);
  const highMedian7 = highs.length ? highs[Math.floor(highs.length / 2)] : null;
  const tradeDays30 = last30.filter((d) => d.volume > 0).length;
  return { avgVolume30, avgPrice7, highMedian7, tradeDays30 };
}

export async function refreshHistory(): Promise<void> {
  const types = trackedTypes();
  const now = new Date();
  const failed = await inBatches(types, async (typeId) => {
    const { avgVolume30, avgPrice7, highMedian7, tradeDays30 } = summarizeHistory(
      await getMarketHistory(THE_FORGE, typeId),
    );
    await db
      .insert(marketVolumes)
      .values({ typeId, avgVolume30, avgPrice7, highMedian7, tradeDays30, updatedAt: now })
      .onConflictDoUpdate({
        target: marketVolumes.typeId,
        set: { avgVolume30, avgPrice7, highMedian7, tradeDays30, updatedAt: now },
      });
  });
  log(`reaction volumes: ${types.length - failed}/${types.length} updated`, "market");
}

/** Refresh prices, and history too when it is older than 12 hours. One run at a time. */
export async function refreshMarket(opts: { force?: boolean } = {}): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const [p] = await db.select({ at: sql<Date | null>`max(${marketPrices.updatedAt})` }).from(marketPrices);
    const [v] = await db.select({ at: sql<Date | null>`max(${marketVolumes.updatedAt})` }).from(marketVolumes);
    const age = (at: Date | string | null) => (at ? Date.now() - new Date(at).getTime() : Infinity);
    if (opts.force || age(p?.at ?? null) > PRICES_EVERY_MS - 60_000) await refreshPrices();
    // Rows from before a column existed have it empty: refill them now instead of waiting 12 hours.
    const [stale] = await db
      .select({ n: sql<number>`count(*)` })
      .from(marketVolumes)
      .where(sql`${marketVolumes.tradeDays30} is null`);
    if (age(v?.at ?? null) > HISTORY_EVERY_MS || Number(stale?.n) > 0) await refreshHistory();
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    log(`market refresh failed: ${lastError}`, "market");
  } finally {
    refreshing = false;
  }
}

export function startMarketRefresh() {
  setTimeout(() => void refreshMarket(), 30_000);
  setInterval(() => void refreshMarket(), PRICES_EVERY_MS);
}

// Adjusted prices (EIV base) and the system cost index change slowly: an hour of caching is plenty.
let adjustedCache: { at: number; data: Record<number, number> } | null = null;
let indexCache: { at: number; data: ReactionMarketResponse["costIndex"] } | null = null;

async function adjustedPrices(): Promise<Record<number, number>> {
  if (adjustedCache && Date.now() - adjustedCache.at < 3600_000) return adjustedCache.data;
  const wanted = new Set(trackedTypes());
  const data: Record<number, number> = {};
  (await getMarketPrices()).forEach((p) => {
    if (wanted.has(p.type_id) && p.adjusted_price) data[p.type_id] = p.adjusted_price;
  });
  adjustedCache = { at: Date.now(), data };
  return data;
}

async function costIndex(): Promise<ReactionMarketResponse["costIndex"]> {
  if (indexCache && Date.now() - indexCache.at < 3600_000) return indexCache.data;
  const ci = await getSystemCostIndices(IKOSKIO.systemId);
  indexCache = { at: Date.now(), data: { ...IKOSKIO, reaction: ci.reaction } };
  return indexCache.data;
}

export async function marketSnapshot(): Promise<ReactionMarketResponse> {
  const [prices, volumes, adjusted, index] = await Promise.all([
    db.select().from(marketPrices).where(inArray(marketPrices.typeId, trackedTypes())),
    db.select().from(marketVolumes),
    // ESI being down must not blank the page: fall back to the last values (or nothing) for these two.
    adjustedPrices().catch(() => adjustedCache?.data ?? {}),
    costIndex().catch(() => indexCache?.data ?? null),
  ]);
  const latest = (rows: Array<{ updatedAt: Date }>) =>
    rows.length ? new Date(Math.max(...rows.map((r) => r.updatedAt.getTime()))).toISOString() : null;
  return {
    prices: Object.fromEntries(prices.map((p) => [p.typeId, { sell: p.sellMin, buy: p.buyMax }])),
    volumes: Object.fromEntries(
      volumes.map((v) => [
        v.typeId,
        { avgVolume30: v.avgVolume30, avgPrice7: v.avgPrice7, highMedian7: v.highMedian7, tradeDays30: v.tradeDays30 },
      ]),
    ),
    adjusted,
    costIndex: index,
    pricesUpdatedAt: latest(prices),
    volumesUpdatedAt: latest(volumes),
    refreshing,
    lastError,
  };
}
