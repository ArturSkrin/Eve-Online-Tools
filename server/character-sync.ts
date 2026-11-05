import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { ESI_BASE, USER_AGENT } from "./esi";
import { decryptToken, encryptToken, requestToken, SsoGrantError } from "./auth";
import { eveCharacters, industryJobs, walletJournal, walletTransactions } from "@shared/schema";
import { log } from "./index";

// ESI keeps only the last 30 days of wallet journal and transactions. Syncing every hour and keeping every
// row here is what turns that into a full history, so the ledger gets better the longer this runs.
const SYNC_EVERY_MS = 60 * 60 * 1000;
const MANUAL_SYNC_MIN_MS = 5 * 60 * 1000;

// --- access tokens -----------------------------------------------------------------------------------------

const accessTokens = new Map<number, { token: string; expiresAt: number }>();

export class ReloginRequired extends Error {}

async function accessToken(characterId: number): Promise<string> {
  const cached = accessTokens.get(characterId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const [ch] = await db.select().from(eveCharacters).where(eq(eveCharacters.characterId, characterId));
  if (!ch) throw new Error(`Character ${characterId} is not registered`);

  let refreshToken: string;
  try {
    refreshToken = decryptToken(ch.refreshTokenEnc);
  } catch {
    throw new ReloginRequired("Stored token cannot be read (server secret changed). Log in with this character again.");
  }

  let token;
  try {
    token = await requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  } catch (err) {
    if (err instanceof SsoGrantError) {
      throw new ReloginRequired("Access was revoked in EVE. Log in with this character again.");
    }
    throw err;
  }

  accessTokens.set(characterId, { token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 });
  // CCP may rotate the refresh token; the old one stops working once a new one is issued.
  if (token.refresh_token && token.refresh_token !== refreshToken) {
    await db
      .update(eveCharacters)
      .set({ refreshTokenEnc: encryptToken(token.refresh_token) })
      .where(eq(eveCharacters.characterId, characterId));
  }
  return token.access_token;
}

// --- authenticated ESI -------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function esiAuth<T>(characterId: number, path: string, params: Record<string, string> = {}): Promise<{ data: T; pages: number }> {
  const url = new URL(`${ESI_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  let lastFailure = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${await accessToken(characterId)}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    // ESI blocks the IP for a while once too many requests fail; back off before getting there.
    const remain = Number(res.headers.get("x-esi-error-limit-remain") ?? 100);
    const reset = Number(res.headers.get("x-esi-error-limit-reset") ?? 0);
    if (remain < 20) await sleep(Math.min(reset, 60) * 1000);

    if (res.ok) {
      return { data: (await res.json()) as T, pages: Number(res.headers.get("x-pages") || 1) };
    }
    if (res.status === 401 || res.status === 403) accessTokens.delete(characterId);
    if (res.status >= 500 || res.status === 420 || res.status === 401) {
      lastFailure = `${res.status} ${(await res.text()).slice(0, 200)}`;
      await sleep(2000 * (attempt + 1));
      continue;
    }
    throw new Error(`ESI ${res.status} on ${path}: ${await res.text()}`);
  }
  // 5xx/504 here usually means ESI itself is down or degraded, not this app: check https://esi.evetech.net/status
  throw new Error(`ESI kept failing on ${path}: ${lastFailure}`);
}

// --- ESI payloads ------------------------------------------------------------------------------------------

interface EsiTransaction {
  transaction_id: number;
  date: string;
  type_id: number;
  quantity: number;
  unit_price: number;
  is_buy: boolean;
  is_personal: boolean;
  location_id: number;
  client_id: number;
  journal_ref_id: number;
}

interface EsiJournal {
  id: number;
  date: string;
  ref_type: string;
  amount?: number;
  balance?: number;
  description?: string;
  context_id?: number;
  context_id_type?: string;
  first_party_id?: number;
  second_party_id?: number;
  tax?: number;
}

interface EsiIndustryJob {
  job_id: number;
  activity_id: number;
  blueprint_type_id: number;
  product_type_id?: number;
  runs: number;
  cost?: number;
  status: string;
  facility_id: number;
  start_date: string;
  end_date: string;
}

// --- sync steps --------------------------------------------------------------------------------------------

async function syncTransactions(characterId: number): Promise<number> {
  let added = 0;
  let fromId: number | undefined;
  // The endpoint returns up to 2500 rows, newest first; from_id walks back. Stop once a page brings nothing new.
  for (let page = 0; page < 20; page++) {
    const { data } = await esiAuth<EsiTransaction[]>(
      characterId,
      `/characters/${characterId}/wallet/transactions/`,
      fromId ? { from_id: String(fromId) } : {},
    );
    if (data.length === 0) break;

    const inserted = await db
      .insert(walletTransactions)
      .values(
        data.map((t) => ({
          transactionId: t.transaction_id,
          characterId,
          date: new Date(t.date),
          typeId: t.type_id,
          quantity: t.quantity,
          unitPrice: t.unit_price,
          isBuy: t.is_buy,
          isPersonal: t.is_personal,
          locationId: t.location_id,
          clientId: t.client_id,
          journalRefId: t.journal_ref_id,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: walletTransactions.transactionId });
    added += inserted.length;

    const minId = Math.min(...data.map((t) => t.transaction_id));
    if (inserted.length === 0 || data.length < 2500 || minId === fromId) break;
    fromId = minId;
  }
  return added;
}

async function syncJournal(characterId: number): Promise<number> {
  let added = 0;
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const res = await esiAuth<EsiJournal[]>(characterId, `/characters/${characterId}/wallet/journal/`, {
      page: String(page),
    });
    pages = res.pages;
    if (res.data.length === 0) break;

    const inserted = await db
      .insert(walletJournal)
      .values(
        res.data.map((j) => ({
          id: j.id,
          characterId,
          date: new Date(j.date),
          refType: j.ref_type,
          amount: j.amount ?? null,
          balance: j.balance ?? null,
          description: j.description ?? null,
          contextId: j.context_id ?? null,
          contextIdType: j.context_id_type ?? null,
          firstPartyId: j.first_party_id ?? null,
          secondPartyId: j.second_party_id ?? null,
          tax: j.tax ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: walletJournal.id });
    added += inserted.length;
    // Pages are newest first: a page with nothing new means everything older is stored already.
    if (inserted.length === 0) break;
  }
  return added;
}

async function syncIndustryJobs(characterId: number): Promise<number> {
  const { data } = await esiAuth<EsiIndustryJob[]>(characterId, `/characters/${characterId}/industry/jobs/`, {
    include_completed: "true",
  });
  if (data.length === 0) return 0;
  await db
    .insert(industryJobs)
    .values(
      data.map((j) => ({
        jobId: j.job_id,
        characterId,
        activityId: j.activity_id,
        blueprintTypeId: j.blueprint_type_id,
        productTypeId: j.product_type_id ?? null,
        runs: j.runs,
        cost: j.cost ?? null,
        status: j.status,
        facilityId: j.facility_id,
        startDate: new Date(j.start_date),
        endDate: new Date(j.end_date),
      })),
    )
    .onConflictDoUpdate({
      target: industryJobs.jobId,
      set: { status: sql`excluded.status`, endDate: sql`excluded.end_date`, cost: sql`excluded.cost` },
    });
  return data.length;
}

// --- orchestration -----------------------------------------------------------------------------------------

const running = new Set<number>();

export function isSyncing(characterId: number): boolean {
  return running.has(characterId);
}

export interface SyncResult {
  characterId: number;
  skipped?: string;
  transactions?: number;
  journal?: number;
  jobs?: number;
  error?: string;
}

export async function syncCharacter(characterId: number, opts: { manual?: boolean } = {}): Promise<SyncResult> {
  if (running.has(characterId)) return { characterId, skipped: "Sync already running" };

  const [ch] = await db.select().from(eveCharacters).where(eq(eveCharacters.characterId, characterId));
  if (!ch) return { characterId, skipped: "Unknown character" };
  if (opts.manual && ch.lastSyncAt && Date.now() - ch.lastSyncAt.getTime() < MANUAL_SYNC_MIN_MS) {
    return { characterId, skipped: "Synced less than 5 minutes ago (ESI caches wallet data for an hour)" };
  }

  running.add(characterId);
  try {
    const { data: balance } = await esiAuth<number>(characterId, `/characters/${characterId}/wallet/`);
    const transactions = await syncTransactions(characterId);
    const journal = await syncJournal(characterId);
    const jobs = ch.scopes.includes("esi-industry.read_character_jobs.v1") ? await syncIndustryJobs(characterId) : 0;

    await db
      .update(eveCharacters)
      .set({ walletBalance: balance, lastSyncAt: new Date(), lastSyncError: null })
      .where(eq(eveCharacters.characterId, characterId));
    log(`synced ${ch.name}: +${transactions} transactions, +${journal} journal, ${jobs} jobs`, "sync");
    return { characterId, transactions, journal, jobs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(eveCharacters)
      .set({ lastSyncAt: new Date(), lastSyncError: message.slice(0, 500) })
      .where(eq(eveCharacters.characterId, characterId));
    log(`sync failed for ${ch.name}: ${message}`, "sync");
    return { characterId, error: message };
  } finally {
    running.delete(characterId);
  }
}

export async function syncAccount(accountId: string): Promise<SyncResult[]> {
  const chars = await db.select().from(eveCharacters).where(eq(eveCharacters.accountId, accountId));
  const results: SyncResult[] = [];
  for (const ch of chars) results.push(await syncCharacter(ch.characterId, { manual: true }));
  return results;
}

export async function deleteCharacterData(characterIds: number[]): Promise<void> {
  if (characterIds.length === 0) return;
  await db.delete(walletTransactions).where(inArray(walletTransactions.characterId, characterIds));
  await db.delete(walletJournal).where(inArray(walletJournal.characterId, characterIds));
  await db.delete(industryJobs).where(inArray(industryJobs.characterId, characterIds));
  await db.delete(eveCharacters).where(inArray(eveCharacters.characterId, characterIds));
  characterIds.forEach((id) => accessTokens.delete(id));
}

export function startBackgroundSync() {
  const run = async () => {
    try {
      const chars = await db.select({ id: eveCharacters.characterId }).from(eveCharacters);
      // One at a time: plenty for a handful of characters and gentle on the ESI error limit.
      for (const ch of chars) await syncCharacter(ch.id);
    } catch (err) {
      log(`background sync failed: ${err instanceof Error ? err.message : err}`, "sync");
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, SYNC_EVERY_MS);
}
