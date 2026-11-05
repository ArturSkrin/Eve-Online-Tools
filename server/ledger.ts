import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { getTypeNamesBulk } from "./esi";
import {
  costOverrides,
  eveCharacters,
  walletJournal,
  walletTransactions,
  type LedgerDailyRow,
  type LedgerItemRow,
  type LedgerRefTypeRow,
  type LedgerResponse,
} from "@shared/schema";

// Journal ref types counted as the cost of running industry jobs (install fees, SCC surcharge, ...).
const INDUSTRY_REF_TYPES = new Set([
  "industry_job_tax",
  "manufacturing",
  "reprocessing_tax",
  "researching_time_productivity",
  "researching_material_productivity",
  "copying",
  "reverse_engineering",
]);

interface Lot {
  qty: number;
  unitCost: number;
}

const DAY_MS = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * FIFO profit for every character of an account, pooled: items bought on one alt and sold on another still
 * match. Every transaction ever stored feeds the lot queues, so sales inside the period are matched against
 * buys made before it; only sales (and fees) dated inside the period are reported.
 *
 * Sales with no buy lot left (mined, reacted, built, looted, bought by contract) have no cost basis. They use
 * the account's cost override for that type when one is set, and are reported as unmatched revenue otherwise,
 * never as pure profit.
 */
export async function buildLedger(accountId: string, periodDays: number | null): Promise<LedgerResponse> {
  const chars = await db.select().from(eveCharacters).where(eq(eveCharacters.accountId, accountId));
  const charIds = chars.map((c) => c.characterId);
  const from = periodDays ? new Date(Date.now() - periodDays * DAY_MS) : null;
  const inPeriod = (d: Date) => !from || d >= from;

  const [txs, journal, overrides] = charIds.length
    ? await Promise.all([
        db.select().from(walletTransactions).where(inArray(walletTransactions.characterId, charIds)),
        db.select().from(walletJournal).where(inArray(walletJournal.characterId, charIds)),
        db.select().from(costOverrides).where(eq(costOverrides.accountId, accountId)),
      ])
    : [[], [], []];

  const overrideByType = new Map(overrides.map((o) => [o.typeId, o.unitCost]));

  // Sales tax is booked per transaction (context = market transaction id), so it can be charged to the item.
  const salesTaxByTx = new Map<number, number>();
  journal.forEach((j) => {
    if (j.refType === "transaction_tax" && j.contextIdType === "market_transaction_id" && j.contextId != null) {
      salesTaxByTx.set(j.contextId, (salesTaxByTx.get(j.contextId) ?? 0) - (j.amount ?? 0));
    }
  });

  txs.sort((a, b) => a.date.getTime() - b.date.getTime() || a.transactionId - b.transactionId);

  const lots = new Map<number, Lot[]>();
  const items = new Map<number, LedgerItemRow>();
  const daily = new Map<string, LedgerDailyRow>();
  const row = (typeId: number): LedgerItemRow => {
    let r = items.get(typeId);
    if (!r) {
      r = {
        typeId,
        typeName: "",
        soldQty: 0,
        revenue: 0,
        cogs: 0,
        salesTax: 0,
        profit: 0,
        marginPercent: null,
        unmatchedQty: 0,
        unmatchedRevenue: 0,
        boughtQty: 0,
        spent: 0,
        openQty: 0,
        openCost: 0,
        costOverride: overrideByType.get(typeId) ?? null,
      };
      items.set(typeId, r);
    }
    return r;
  };

  let oldest: Date | null = null;
  let transactionCount = 0;

  for (const tx of txs) {
    if (!oldest || tx.date < oldest) oldest = tx.date;
    const queue = lots.get(tx.typeId) ?? [];
    lots.set(tx.typeId, queue);
    const counted = inPeriod(tx.date);
    if (counted) transactionCount++;

    if (tx.isBuy) {
      queue.push({ qty: tx.quantity, unitCost: tx.unitPrice });
      if (counted) {
        const r = row(tx.typeId);
        r.boughtQty += tx.quantity;
        r.spent += tx.quantity * tx.unitPrice;
      }
      continue;
    }

    let left = tx.quantity;
    let cost = 0;
    while (left > 0 && queue.length > 0) {
      const lot = queue[0];
      const take = Math.min(left, lot.qty);
      cost += take * lot.unitCost;
      lot.qty -= take;
      left -= take;
      if (lot.qty === 0) queue.shift();
    }
    const override = overrideByType.get(tx.typeId);
    let unmatched = 0;
    if (left > 0) {
      if (override != null) cost += left * override;
      else unmatched = left;
    }
    if (!counted) continue;

    const r = row(tx.typeId);
    const matchedQty = tx.quantity - unmatched;
    const revenue = matchedQty * tx.unitPrice;
    const tax = salesTaxByTx.get(tx.transactionId) ?? 0;
    r.soldQty += tx.quantity;
    r.revenue += revenue;
    r.cogs += cost;
    r.salesTax += tax;
    r.unmatchedQty += unmatched;
    r.unmatchedRevenue += unmatched * tx.unitPrice;

    const key = dayKey(tx.date);
    const d = daily.get(key) ?? { date: key, profit: 0, revenue: 0 };
    d.profit += revenue - cost - tax;
    d.revenue += revenue;
    daily.set(key, d);
  }

  let inventoryAtCost = 0;
  lots.forEach((queue, typeId) => {
    const qty = queue.reduce((s, l) => s + l.qty, 0);
    if (qty === 0) return;
    const r = row(typeId);
    r.openQty = qty;
    r.openCost = queue.reduce((s, l) => s + l.qty * l.unitCost, 0);
    inventoryAtCost += r.openCost;
  });

  // Journal: fees, industry costs and every other wallet movement in the period, grouped by ref type.
  const refTypes = new Map<string, LedgerRefTypeRow>();
  let brokerFees = 0;
  let salesTax = 0;
  let industryCost = 0;
  let cashFlow = 0;
  journal.forEach((j) => {
    if (!oldest || j.date < oldest) oldest = j.date;
    if (!inPeriod(j.date)) return;
    const amount = j.amount ?? 0;
    cashFlow += amount;
    const r = refTypes.get(j.refType) ?? { refType: j.refType, income: 0, expense: 0, count: 0 };
    if (amount >= 0) r.income += amount;
    else r.expense -= amount;
    r.count++;
    refTypes.set(j.refType, r);
    if (j.refType === "brokers_fee") brokerFees -= amount;
    else if (j.refType === "transaction_tax") salesTax -= amount;
    else if (INDUSTRY_REF_TYPES.has(j.refType)) industryCost -= amount;
  });

  const names = await getTypeNamesBulk(Array.from(items.keys()));
  const itemRows = Array.from(items.values()).map((r) => {
    r.typeName = names.get(r.typeId) ?? `Type #${r.typeId}`;
    r.profit = r.revenue - r.cogs - r.salesTax;
    r.marginPercent = r.cogs > 0 ? (r.profit / r.cogs) * 100 : null;
    return r;
  });
  itemRows.sort((a, b) => b.profit - a.profit || b.openCost - a.openCost);

  const revenue = itemRows.reduce((s, r) => s + r.revenue, 0);
  const cogs = itemRows.reduce((s, r) => s + r.cogs, 0);
  const grossProfit = revenue - cogs;

  // A continuous run of days for the chart, so quiet days show as zero instead of disappearing.
  const dailyRows: LedgerDailyRow[] = [];
  const firstDay = from ?? (oldest as Date | null);
  if (firstDay) {
    for (let t = Date.parse(dayKey(firstDay)); t <= Date.now(); t += DAY_MS) {
      const key = dayKey(new Date(t));
      dailyRows.push(daily.get(key) ?? { date: key, profit: 0, revenue: 0 });
    }
  }

  return {
    periodDays,
    from: from?.toISOString() ?? null,
    summary: {
      revenue,
      cogs,
      grossProfit,
      salesTax,
      brokerFees,
      industryCost,
      netTradingProfit: grossProfit - salesTax - brokerFees,
      unmatchedRevenue: itemRows.reduce((s, r) => s + r.unmatchedRevenue, 0),
      inventoryAtCost,
      walletBalance: chars.reduce((s, c) => s + (c.walletBalance ?? 0), 0),
      cashFlow,
      transactionCount,
    },
    items: itemRows,
    refTypes: Array.from(refTypes.values()).sort((a, b) => b.income + b.expense - (a.income + a.expense)),
    daily: dailyRows,
    oldestDataAt: (oldest as Date | null)?.toISOString() ?? null,
  };
}

export async function setCostOverride(accountId: string, typeId: number, unitCost: number | null) {
  if (unitCost == null) {
    await db.delete(costOverrides).where(and(eq(costOverrides.accountId, accountId), eq(costOverrides.typeId, typeId)));
    return;
  }
  await db
    .insert(costOverrides)
    .values({ accountId, typeId, unitCost })
    .onConflictDoUpdate({ target: [costOverrides.accountId, costOverrides.typeId], set: { unitCost } });
}
