import type { Express } from "express";
import { and, eq, gte, inArray, lt, or, sql, isNull } from "drizzle-orm";
import { db } from "./db";
import { requireAccount } from "./auth";
import { esiAuth } from "./character-sync";
import { esiPublic } from "./trade-profile";
import { getMarketHistory, getTypeDetails } from "./esi";
import { inBatches, summarizeHistory } from "./market-cache";
import {
  eveCharacters,
  industryJobs,
  marketPrices,
  marketStructures,
  regionHistory,
  structureMarket,
  typeInfo,
  walletTransactions,
  type ImportResponse,
  type MarketStructureSummary,
} from "@shared/schema";
import { log } from "./index";

// Nullsec import scanner: what to haul from Jita (or build) for a home structure market.
//
// - Structure orders come from /markets/structures/{id} with a character that can use that market.
// - Daily volume and traded prices come from the region's market history: in sovereign null there are no
//   NPC stations, so that history is the structures' trades (Gila in The Spire: ~2 a day at ~282M).
// - Jita prices come from the full The Forge order pass in market-cache.ts.

const SNAPSHOT_EVERY_MS = 30 * 60 * 1000;
const HISTORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const HISTORY_PER_RUN = 800;
const TYPES_PER_RUN = 1500;
const STRUCTURE_SCOPE = "esi-markets.structure_markets.v1";
const RESOLVE_SCOPE = "esi-universe.read_structures.v1";
/** Upwell structure ids start above this; anything lower is an NPC station. */
const STRUCTURE_ID_MIN = 1_000_000_000_000;

// --- structures ---------------------------------------------------------------------------------------------

async function resolveStructure(characterId: number, structureId: number) {
  const { data: st } = await esiAuth<{ name: string; solar_system_id: number }>(
    characterId,
    `/universe/structures/${structureId}/`,
  );
  const system = await esiPublic<{ name: string; constellation_id: number }>(`/universe/systems/${st.solar_system_id}/`);
  const constellation = await esiPublic<{ region_id: number }>(`/universe/constellations/${system.constellation_id}/`);
  const region = await esiPublic<{ name: string }>(`/universe/regions/${constellation.region_id}/`);
  return {
    name: st.name,
    systemId: st.solar_system_id,
    systemName: system.name,
    regionId: constellation.region_id,
    regionName: region.name,
  };
}

/** Adds a structure for the account, resolved with whichever character is allowed to see it. */
export async function addStructure(accountId: string, structureId: number): Promise<string | null> {
  const chars = (await db.select().from(eveCharacters).where(eq(eveCharacters.accountId, accountId))).filter(
    (c) => c.scopes.includes(RESOLVE_SCOPE) && c.scopes.includes(STRUCTURE_SCOPE),
  );
  if (chars.length === 0) return "Войдите персонажем заново: нужен доступ к рынкам структур (новые права ESI).";
  let lastErr = "";
  for (const ch of chars) {
    try {
      const info = await resolveStructure(ch.characterId, structureId);
      await db
        .insert(marketStructures)
        .values({ accountId, structureId, characterId: ch.characterId, ...info })
        .onConflictDoUpdate({
          target: [marketStructures.accountId, marketStructures.structureId],
          set: { characterId: ch.characterId, ...info },
        });
      return null;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return `Ни один персонаж не видит структуру ${structureId}: ${lastErr}`;
}

/** Structures the account's characters traded or ran jobs at, not added yet. */
async function discoverStructures(accountId: string): Promise<void> {
  const chars = await db.select().from(eveCharacters).where(eq(eveCharacters.accountId, accountId));
  if (!chars.length) return;
  const ids = chars.map((c) => c.characterId);
  const [fromTrades, fromJobs, known] = await Promise.all([
    db
      .selectDistinct({ id: walletTransactions.locationId })
      .from(walletTransactions)
      .where(and(inArray(walletTransactions.characterId, ids), gte(walletTransactions.locationId, STRUCTURE_ID_MIN))),
    db
      .selectDistinct({ id: industryJobs.facilityId })
      .from(industryJobs)
      .where(and(inArray(industryJobs.characterId, ids), gte(industryJobs.facilityId, STRUCTURE_ID_MIN))),
    db.select({ id: marketStructures.structureId }).from(marketStructures).where(eq(marketStructures.accountId, accountId)),
  ]);
  const knownIds = new Set(known.map((k) => k.id));
  const candidates = Array.from(new Set([...fromTrades, ...fromJobs].map((r) => r.id))).filter((id) => !knownIds.has(id));
  for (const id of candidates.slice(0, 10)) {
    const err = await addStructure(accountId, id);
    if (err) log(`structure ${id} not added: ${err}`, "nullsec");
  }
}

// --- snapshots ----------------------------------------------------------------------------------------------

interface StructureOrder {
  type_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
}

export async function snapshotStructure(structureId: number, characterId: number): Promise<void> {
  const best = new Map<number, { sellMin: number | null; sellVolume: number; buyMax: number | null; buyVolume: number }>();
  let count = 0;
  try {
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      const res = await esiAuth<StructureOrder[]>(characterId, `/markets/structures/${structureId}/`, {
        page: String(page),
      });
      pages = res.pages;
      for (const o of res.data) {
        count++;
        const b = best.get(o.type_id) ?? { sellMin: null, sellVolume: 0, buyMax: null, buyVolume: 0 };
        if (o.is_buy_order) {
          b.buyMax = b.buyMax == null ? o.price : Math.max(b.buyMax, o.price);
          b.buyVolume += o.volume_remain;
        } else {
          b.sellMin = b.sellMin == null ? o.price : Math.min(b.sellMin, o.price);
          b.sellVolume += o.volume_remain;
        }
        best.set(o.type_id, b);
      }
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = /403/.test(raw) ? "Персонаж не может пользоваться рынком этой структуры (нет доступа)." : raw;
    await db
      .update(marketStructures)
      .set({ lastError: message.slice(0, 500), lastSnapshotAt: new Date() })
      .where(eq(marketStructures.structureId, structureId));
    throw err;
  }

  const now = new Date();
  const rows = Array.from(best.entries()).map(([typeId, b]) => ({ structureId, typeId, ...b, updatedAt: now }));
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(structureMarket)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [structureMarket.structureId, structureMarket.typeId],
        set: {
          sellMin: sql`excluded.sell_min`,
          sellVolume: sql`excluded.sell_volume`,
          buyMax: sql`excluded.buy_max`,
          buyVolume: sql`excluded.buy_volume`,
          updatedAt: now,
        },
      });
  }
  // A type missing from this snapshot sold out (or its orders were pulled): keep the row at zero, because an
  // empty shelf for something that sells every day is exactly the opportunity this page looks for.
  await db
    .update(structureMarket)
    .set({ sellMin: null, sellVolume: 0, buyMax: null, buyVolume: 0, updatedAt: now })
    .where(and(eq(structureMarket.structureId, structureId), lt(structureMarket.updatedAt, now)));
  await db
    .update(marketStructures)
    .set({ lastSnapshotAt: now, lastError: null, orderCount: count })
    .where(eq(marketStructures.structureId, structureId));
  log(`structure ${structureId}: ${count} orders, ${rows.length} types`, "nullsec");
}

/** Region history for types on a structure market that have none yet or older than 12 hours. */
async function refreshRegionHistory(regionId: number, structureIds: number[]): Promise<void> {
  const stale = await db
    .selectDistinct({ typeId: structureMarket.typeId })
    .from(structureMarket)
    .leftJoin(regionHistory, and(eq(regionHistory.typeId, structureMarket.typeId), eq(regionHistory.regionId, regionId)))
    .where(
      and(
        inArray(structureMarket.structureId, structureIds),
        or(isNull(regionHistory.updatedAt), lt(regionHistory.updatedAt, new Date(Date.now() - HISTORY_MAX_AGE_MS))),
      ),
    )
    .limit(HISTORY_PER_RUN);
  if (!stale.length) return;
  const now = new Date();
  const failed = await inBatches(
    stale.map((s) => s.typeId),
    async (typeId) => {
      const summary = summarizeHistory(await getMarketHistory(regionId, typeId));
      await db
        .insert(regionHistory)
        .values({ regionId, typeId, ...summary, updatedAt: now })
        .onConflictDoUpdate({ target: [regionHistory.regionId, regionHistory.typeId], set: { ...summary, updatedAt: now } });
    },
  );
  log(`region ${regionId} history: ${stale.length - failed}/${stale.length} types`, "nullsec");
}

/** Names and packaged volumes of types seen on structure markets (fetched once, kept forever). */
async function fillTypeInfo(): Promise<void> {
  const missing = await db
    .selectDistinct({ typeId: structureMarket.typeId })
    .from(structureMarket)
    .leftJoin(typeInfo, eq(typeInfo.typeId, structureMarket.typeId))
    .where(isNull(typeInfo.typeId))
    .limit(TYPES_PER_RUN);
  if (!missing.length) return;
  const now = new Date();
  await inBatches(
    missing.map((m) => m.typeId),
    async (typeId) => {
      const t = await getTypeDetails(typeId);
      await db
        .insert(typeInfo)
        .values({ typeId, name: t.name, groupId: t.groupId, volume: t.volume, updatedAt: now })
        .onConflictDoNothing();
    },
  );
  log(`type info: ${missing.length} new types`, "nullsec");
}

let cycleRunning = false;

/** Snapshot every tracked structure, then catch up history and type info. */
export async function nullsecCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const rows = await db.select().from(marketStructures);
    const byStructure = new Map<number, (typeof rows)[number]>();
    rows.forEach((r) => {
      if (!byStructure.has(r.structureId)) byStructure.set(r.structureId, r);
    });
    for (const s of Array.from(byStructure.values())) {
      try {
        await snapshotStructure(s.structureId, s.characterId);
      } catch (err) {
        log(`structure ${s.structureId} snapshot failed: ${err instanceof Error ? err.message : err}`, "nullsec");
      }
    }
    const regions = new Map<number, number[]>();
    byStructure.forEach((s) => {
      if (s.regionId) regions.set(s.regionId, [...(regions.get(s.regionId) ?? []), s.structureId]);
    });
    for (const [regionId, structureIds] of Array.from(regions.entries())) {
      await refreshRegionHistory(regionId, structureIds).catch((err) =>
        log(`region ${regionId} history failed: ${err instanceof Error ? err.message : err}`, "nullsec"),
      );
    }
    await fillTypeInfo().catch((err) => log(`type info failed: ${err instanceof Error ? err.message : err}`, "nullsec"));
  } finally {
    cycleRunning = false;
  }
}

export function startNullsecRefresh() {
  setTimeout(() => void nullsecCycle(), 60_000);
  setInterval(() => void nullsecCycle(), SNAPSHOT_EVERY_MS);
}

// --- API ----------------------------------------------------------------------------------------------------

async function summaries(accountId: string): Promise<MarketStructureSummary[]> {
  const rows = await db
    .select({ s: marketStructures, characterName: eveCharacters.name })
    .from(marketStructures)
    .leftJoin(eveCharacters, eq(eveCharacters.characterId, marketStructures.characterId))
    .where(eq(marketStructures.accountId, accountId));
  return rows.map(({ s, characterName }) => ({
    structureId: s.structureId,
    name: s.name,
    systemName: s.systemName,
    regionId: s.regionId,
    regionName: s.regionName,
    characterName,
    lastSnapshotAt: s.lastSnapshotAt?.toISOString() ?? null,
    lastError: s.lastError,
    orderCount: s.orderCount,
  }));
}

const lastManual = new Map<number, number>();

export function registerNullsecRoutes(app: Express) {
  app.get("/api/nullsec/structures", requireAccount, async (req, res, next) => {
    try {
      await discoverStructures(req.session.accountId!).catch((err) => log(`discovery failed: ${err}`, "nullsec"));
      res.json(await summaries(req.session.accountId!));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/nullsec/structures", requireAccount, async (req, res, next) => {
    try {
      const structureId = Number(req.body?.structureId);
      if (!Number.isSafeInteger(structureId) || structureId < STRUCTURE_ID_MIN) {
        return res.status(400).json({ message: "Нужен ID структуры (число больше 1 000 000 000 000)." });
      }
      const err = await addStructure(req.session.accountId!, structureId);
      if (err) return res.status(400).json({ message: err });
      res.json(await summaries(req.session.accountId!));
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/nullsec/structures/:id", requireAccount, async (req, res, next) => {
    try {
      await db
        .delete(marketStructures)
        .where(
          and(eq(marketStructures.accountId, req.session.accountId!), eq(marketStructures.structureId, Number(req.params.id))),
        );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/nullsec/structures/:id/refresh", requireAccount, async (req, res, next) => {
    try {
      const structureId = Number(req.params.id);
      const [s] = await db
        .select()
        .from(marketStructures)
        .where(and(eq(marketStructures.accountId, req.session.accountId!), eq(marketStructures.structureId, structureId)));
      if (!s) return res.status(404).json({ message: "Структура не найдена" });
      // ESI caches structure markets for 5 minutes: more often only spends the request budget.
      if (Date.now() - (lastManual.get(structureId) ?? 0) < 5 * 60 * 1000) return res.json({ started: false });
      lastManual.set(structureId, Date.now());
      await snapshotStructure(structureId, s.characterId);
      if (s.regionId) void refreshRegionHistory(s.regionId, [structureId]).then(fillTypeInfo);
      else void fillTypeInfo();
      res.json({ started: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/nullsec/import", requireAccount, async (req, res, next) => {
    try {
      const structureId = Number(req.query.structureId);
      const all = await summaries(req.session.accountId!);
      const structure = all.find((s) => s.structureId === structureId);
      if (!structure) return res.status(404).json({ message: "Структура не найдена" });

      const rows = await db
        .select({ m: structureMarket, jita: marketPrices, hist: regionHistory, info: typeInfo })
        .from(structureMarket)
        .leftJoin(marketPrices, eq(marketPrices.typeId, structureMarket.typeId))
        .leftJoin(
          regionHistory,
          and(eq(regionHistory.typeId, structureMarket.typeId), eq(regionHistory.regionId, structure.regionId ?? -1)),
        )
        .leftJoin(typeInfo, eq(typeInfo.typeId, structureMarket.typeId))
        .where(eq(structureMarket.structureId, structureId));

      const [jitaAt] = await db.select({ at: sql<Date | null>`max(${marketPrices.updatedAt})` }).from(marketPrices);
      const body: ImportResponse = {
        structure,
        jitaUpdatedAt: jitaAt?.at ? new Date(jitaAt.at).toISOString() : null,
        historyCoverage: { withHistory: rows.filter((r) => r.hist).length, total: rows.length },
        rows: rows.map(({ m, jita, hist, info }) => ({
          typeId: m.typeId,
          name: info?.name ?? `#${m.typeId}`,
          volume: info?.volume ?? null,
          local: { sellMin: m.sellMin, sellVolume: m.sellVolume, buyMax: m.buyMax, buyVolume: m.buyVolume },
          jita: { sell: jita?.sellMin ?? null, buy: jita?.buyMax ?? null },
          region: hist
            ? {
                avgVolume30: hist.avgVolume30,
                highMedian7: hist.highMedian7,
                avgPrice7: hist.avgPrice7,
                tradeDays30: hist.tradeDays30,
              }
            : null,
        })),
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });
}
