import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { ESI_BASE, USER_AGENT, esiError } from "./esi";
import { esiAuth, INTERACTIVE } from "./character-sync";
import { eveCharacters, walletJournal, walletTransactions, type TradeProfile } from "@shared/schema";

// NPC station market fees, in percent. Sales tax = base × (1 − 11% × Accounting).
// Broker fee = base − 0.3 × Broker Relations − 0.03 × faction standing − 0.02 × owner corp standing.
// Bases checked in game on 2026-11-06 (Jita 4-4: Accounting 0 → 7.5%, Broker Relations 2 and no standings
// → 2.4%); sales tax went from 4% to 7.5% in March 2025. CCP changes these from time to time, so when the
// character has recent sales on record, the tax actually charged (journal transaction_tax / sale value) wins.
export const SALES_TAX_BASE = 7.5;
export const BROKER_FEE_BASE = 3;

const SKILL = { accounting: 16622, brokerRelations: 3446, advancedBrokerRelations: 16597 };

const round = (v: number) => Math.round(v * 1000) / 1000;

// Public, unauthenticated lookups (station owner, names) change almost never: cache for the process lifetime.
const publicCache = new Map<string, unknown>();
async function esiPublic<T>(path: string): Promise<T> {
  if (publicCache.has(path)) return publicCache.get(path) as T;
  const res = await fetch(`${ESI_BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw esiError(res.status, await res.text(), path);
  const data = (await res.json()) as T;
  publicCache.set(path, data);
  return data;
}

async function stationInfo(stationId: number) {
  const st = await esiPublic<{ name: string; owner: number; race_id?: number }>(`/universe/stations/${stationId}/`);
  const corp = await esiPublic<{ name: string; faction_id?: number }>(`/corporations/${st.owner}/`);
  // ESI leaves faction_id off NPC corporations. An empire station's race gives the faction instead:
  // /universe/races maps each race to its empire faction (alliance_id), e.g. Caldari → Caldari State.
  let factionId = corp.faction_id ?? null;
  if (factionId == null && st.race_id != null) {
    const races = await esiPublic<Array<{ race_id: number; alliance_id: number }>>(`/universe/races/`);
    factionId = races.find((r) => r.race_id === st.race_id)?.alliance_id ?? null;
  }
  let factionName: string | null = null;
  if (factionId != null) {
    const factions = await esiPublic<Array<{ faction_id: number; name: string }>>(`/universe/factions/`);
    factionName = factions.find((f) => f.faction_id === factionId)?.name ?? null;
  }
  return {
    id: stationId,
    name: st.name,
    ownerCorpId: st.owner,
    ownerCorpName: corp.name,
    factionId,
    factionName,
  };
}

// Skills and standings move slowly; an hour of caching keeps page loads off ESI.
const charCache = new Map<string, { at: number; data: unknown }>();
async function cachedAuth<T>(characterId: number, path: string): Promise<T> {
  const key = `${characterId}:${path}`;
  const hit = charCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.data as T;
  const { data } = await esiAuth<T>(characterId, path, {}, INTERACTIVE);
  charCache.set(key, { at: Date.now(), data });
  return data;
}

/** Median sales tax rate (percent) over the character's last 30 sales that have a tax entry. */
async function observedSalesTax(characterId: number): Promise<{ rate: number | null; samples: number }> {
  const sells = await db
    .select()
    .from(walletTransactions)
    .where(and(eq(walletTransactions.characterId, characterId), eq(walletTransactions.isBuy, false)))
    .orderBy(desc(walletTransactions.date))
    .limit(30);
  if (sells.length === 0) return { rate: null, samples: 0 };
  const taxes = await db
    .select()
    .from(walletJournal)
    .where(
      and(
        eq(walletJournal.refType, "transaction_tax"),
        inArray(walletJournal.contextId, sells.map((t) => t.transactionId)),
      ),
    );
  const taxByTx = new Map(taxes.map((j) => [j.contextId, -(j.amount ?? 0)]));
  const rates = sells
    .filter((t) => taxByTx.has(t.transactionId) && t.quantity * t.unitPrice > 0)
    .map((t) => (taxByTx.get(t.transactionId)! / (t.quantity * t.unitPrice)) * 100)
    .sort((a, b) => a - b);
  if (rates.length === 0) return { rate: null, samples: 0 };
  return { rate: round(rates[Math.floor(rates.length / 2)]), samples: rates.length };
}

export async function buildTradeProfile(accountId: string, characterId: number, stationId: number): Promise<TradeProfile | null> {
  const [ch] = await db
    .select()
    .from(eveCharacters)
    .where(and(eq(eveCharacters.characterId, characterId), eq(eveCharacters.accountId, accountId)));
  if (!ch) return null;

  const station = await stationInfo(stationId);

  // Skills and standings are independent: fetch both at once so a slow ESI costs one timeout, not two.
  const [skillsResult, standingsResult] = await Promise.all([
    (async (): Promise<{ skills: TradeProfile["skills"]; error: string | null }> => {
      if (!ch.scopes.includes("esi-skills.read_skills.v1")) {
        return { skills: null, error: "Log in with this character again to grant skill access" };
      }
      try {
        const data = await cachedAuth<{ skills: Array<{ skill_id: number; active_skill_level: number }> }>(
          characterId,
          `/characters/${characterId}/skills/`,
        );
        const level = (id: number) => data.skills.find((s) => s.skill_id === id)?.active_skill_level ?? 0;
        return {
          skills: {
            accounting: level(SKILL.accounting),
            brokerRelations: level(SKILL.brokerRelations),
            advancedBrokerRelations: level(SKILL.advancedBrokerRelations),
          },
          error: null,
        };
      } catch (err) {
        return { skills: null, error: err instanceof Error ? err.message : String(err) };
      }
    })(),
    (async (): Promise<{ standings: TradeProfile["standings"]; error: string | null }> => {
      if (!ch.scopes.includes("esi-characters.read_standings.v1")) {
        return { standings: null, error: "Log in with this character again to grant standings access" };
      }
      try {
        const data = await cachedAuth<Array<{ from_id: number; from_type: string; standing: number }>>(
          characterId,
          `/characters/${characterId}/standings/`,
        );
        const of = (id: number | null) => (id == null ? 0 : data.find((s) => s.from_id === id)?.standing ?? 0);
        return { standings: { corp: of(station.ownerCorpId), faction: of(station.factionId) }, error: null };
      } catch (err) {
        return { standings: null, error: err instanceof Error ? err.message : String(err) };
      }
    })(),
  ]);
  const { skills, error: skillsError } = skillsResult;
  const { standings, error: standingsError } = standingsResult;

  const formulaTax = skills ? round(SALES_TAX_BASE * (1 - 0.11 * skills.accounting)) : null;
  const observed = await observedSalesTax(characterId);
  // Without standings the fee is computed as if they were 0, which can only overstate it: a safe default.
  const formulaBroker = skills
    ? round(
        BROKER_FEE_BASE -
          0.3 * skills.brokerRelations -
          0.03 * (standings?.faction ?? 0) -
          0.02 * (standings?.corp ?? 0),
      )
    : null;

  return {
    characterId,
    name: ch.name,
    station,
    skills,
    skillsError,
    standings,
    standingsError,
    base: { salesTax: SALES_TAX_BASE, brokerFee: BROKER_FEE_BASE },
    salesTax: {
      formula: formulaTax,
      observed: observed.rate,
      observedSamples: observed.samples,
      value: observed.rate ?? formulaTax,
    },
    brokerFee: { formula: formulaBroker, value: formulaBroker },
  };
}
