import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, jsonb, bigint, doublePrecision, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const cachedPrices = pgTable("cached_prices", {
  typeId: integer("type_id").primaryKey(),
  typeName: text("type_name"),
  adjustedPrice: real("adjusted_price"),
  averagePrice: real("average_price"),
  jitaSellMin: real("jita_sell_min"),
  jitaBuyMax: real("jita_buy_max"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const savedContracts = pgTable("saved_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: integer("contract_id").notNull(),
  regionId: integer("region_id").notNull(),
  contractPrice: real("contract_price").notNull(),
  itemsValue: real("items_value").notNull(),
  margin: real("margin").notNull(),
  marginPercent: real("margin_percent").notNull(),
  itemCount: integer("item_count").notNull(),
  title: text("title"),
  contractType: text("contract_type"),
  items: jsonb("items"),
  savedAt: timestamp("saved_at").defaultNow(),
});

export const scanHistory = pgTable("scan_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  regionId: integer("region_id").notNull(),
  regionName: text("region_name").notNull(),
  totalContracts: integer("total_contracts").notNull(),
  analyzedContracts: integer("analyzed_contracts").notNull(),
  profitableContracts: integer("profitable_contracts").notNull(),
  bestMargin: real("best_margin"),
  scannedAt: timestamp("scanned_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertCachedPriceSchema = createInsertSchema(cachedPrices).omit({
  updatedAt: true,
});

export const insertSavedContractSchema = createInsertSchema(savedContracts).omit({
  id: true,
  savedAt: true,
});

export const insertScanHistorySchema = createInsertSchema(scanHistory).omit({
  id: true,
  scannedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type CachedPrice = typeof cachedPrices.$inferSelect;
export type InsertCachedPrice = z.infer<typeof insertCachedPriceSchema>;
export type SavedContract = typeof savedContracts.$inferSelect;
export type InsertSavedContract = z.infer<typeof insertSavedContractSchema>;
export type ScanHistory = typeof scanHistory.$inferSelect;
export type InsertScanHistory = z.infer<typeof insertScanHistorySchema>;

export const EVE_REGIONS = [
  { id: 10000002, name: "The Forge (Jita)" },
  { id: 10000043, name: "Domain (Amarr)" },
  { id: 10000032, name: "Sinq Laison (Dodixie)" },
  { id: 10000030, name: "Heimatar (Rens)" },
  { id: 10000042, name: "Metropolis (Hek)" },
] as const;

export interface EsiContract {
  contract_id: number;
  type: string;
  issuer_id: number;
  issuer_corporation_id: number;
  date_issued: string;
  date_expired: string;
  price: number;
  reward: number;
  collateral: number;
  buyout: number | null;
  volume: number;
  start_location_id: number;
  title: string;
  days_to_complete: number;
  for_corporation: boolean;
}

export interface EsiContractItem {
  type_id: number;
  quantity: number;
  record_id: number;
  is_included: boolean;
  is_blueprint_copy: boolean;
  item_id: number;
  material_efficiency?: number;
  time_efficiency?: number;
  runs?: number;
}

export interface AnalyzedContract {
  contractId: number;
  contractPrice: number;
  itemsValue: number;
  margin: number;
  marginPercent: number;
  title: string;
  type: string;
  dateExpired: string;
  itemCount: number;
  items: AnalyzedItem[];
  volume: number;
}

export interface AnalyzedItem {
  typeId: number;
  typeName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isBlueprint: boolean;
}

export interface ManufacturingInput {
  typeId: number;
  typeName: string;
  materialEfficiency: number;
  timeEfficiency: number;
  facilityBonus: number;
  systemCostIndex: number;
  taxRate: number;
  runs: number;
}

export interface ManufacturingResult {
  typeId: number;
  typeName: string;
  materialCost: number;
  jobCost: number;
  taxCost: number;
  totalCost: number;
  marketPrice: number;
  profit: number;
  profitPercent: number;
  runs: number;
}

export interface ScanProgress {
  status: "idle" | "scanning" | "analyzing" | "complete" | "error";
  totalContracts: number;
  analyzedContracts: number;
  currentPage: number;
  totalPages: number;
  message: string;
}

export interface ReactionItem {
  typeId: number;
  name: string;
  quantity: number;
  role: "input" | "output";
  group: string;
}

export interface ReactionItemPrice extends ReactionItem {
  buyPrice: number;
  sellPrice: number;
  adjustedPrice: number;
  totalBuy: number;
  totalSell: number;
}

export interface ReactionPricesResponse {
  items: ReactionItemPrice[];
  runs: number;
  outputPerRun: number;
  facilityMeBonus: number;
  estimatedJobCost: number;
  updatedAt: string;
}

export interface StationPreset {
  id: string;
  label: string;
  system: string | null;
  facilityMeBonus: number;
  facilityTeBonus: number;
  factoryTax: number;
  structureFee: number;
  autoJobCost: boolean;
}

export const STATION_PRESETS_MANUFACTURING: StationPreset[] = [
  { id: "default",       label: "Default (NPC станция)",               system: null,      facilityMeBonus: 0, facilityTeBonus: 0,  factoryTax: 0,   structureFee: 0,   autoJobCost: false },
  { id: "ikoskio-azbel", label: "Ikoskio / Azbel — Svarog Manufacture", system: "ikoskio", facilityMeBonus: 0, facilityTeBonus: 0,  factoryTax: 0,   structureFee: 0,   autoJobCost: true  },
];

export const STATION_PRESETS_REACTION: StationPreset[] = [
  { id: "default",        label: "Default (NPC станция)",                 system: null,      facilityMeBonus: 0,   facilityTeBonus: 0,    factoryTax: 0,   structureFee: 0,   autoJobCost: false },
  { id: "ikoskio-tatara", label: "Ikoskio / Tatara — Svarog Manufacture", system: "ikoskio", facilityMeBonus: 2.4, facilityTeBonus: 24.0, factoryTax: 1.5, structureFee: 4.0, autoJobCost: true  },
];

export interface ImplantContractListing {
  contractId: number;
  price: number;
  quantity: number;
  bpcRuns: number;
  pricePerRun: number;
  dateExpired: string;
  locationId: number;
}

export interface ImplantContractsResponse {
  contracts: ImplantContractListing[];
  checkedCount: number;
  updatedAt: string;
}

export interface ImplantBlueprintItem {
  typeId: number;
  name: string;
  baseQty: number;
  role: "input" | "output";
  group: string;
}

export interface ImplantItemPrice extends ImplantBlueprintItem {
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  adjustedPrice: number;
  totalBuy: number;
  totalSell: number;
}

export interface ImplantPricesResponse {
  items: ImplantItemPrice[];
  runs: number;
  me: number;
  facilityBonus: number;
  estimatedJobCost: number;
  updatedAt: string;
}

export const RAPTURE_ALPHA_BLUEPRINT = {
  name: "High-grade Rapture Alpha",
  outputTypeId: 57123,
  outputPerRun: 1,
  productionTime: 9000,
  items: [
    { typeId: 2869,  name: "Nano-Factory",              baseQty: 1,   role: "input"  as const, group: "Components" },
    { typeId: 11399, name: "Morphite",                  baseQty: 79,  role: "input"  as const, group: "Minerals" },
    { typeId: 47975, name: "Crystalline Isogen-10",     baseQty: 360, role: "input"  as const, group: "Advanced" },
    { typeId: 2346,  name: "Synthetic Synapses",        baseQty: 542, role: "input"  as const, group: "Components" },
    { typeId: 2367,  name: "Cryoprotectant Solution",   baseQty: 594, role: "input"  as const, group: "Components" },
    { typeId: 57123, name: "High-grade Rapture Alpha",  baseQty: 1,   role: "output" as const, group: "Output" },
  ] as ImplantBlueprintItem[],
};

export function calcMeQty(baseQty: number, runs: number, me: number, facilityBonus: number): number {
  const factor = (1 - me / 100) * (1 - facilityBonus / 100);
  return Math.max(runs, Math.ceil(baseQty * runs * factor));
}

export const NEURALINK_REACTION = {
  name: "Axosomatic Neurolink Enhancer",
  outputTypeId: 57460,
  outputPerRun: 20,
  reactionTime: 10800,
  items: [
    { typeId: 4051, name: "Nitrogen Fuel Block", quantity: 5, role: "input" as const, group: "Fuel" },
    { typeId: 28694, name: "Amber Mykoserocin", quantity: 40, role: "input" as const, group: "Gas" },
    { typeId: 28697, name: "Golden Mykoserocin", quantity: 40, role: "input" as const, group: "Gas" },
    { typeId: 57446, name: "AG-Composite Molecular Condenser", quantity: 1, role: "input" as const, group: "Materials" },
    { typeId: 57460, name: "Axosomatic Neurolink Enhancer", quantity: 20, role: "output" as const, group: "Output" },
  ] as ReactionItem[],
};

// ---------------------------------------------------------------------------
// Character data (EVE SSO) and the profit ledger
// ---------------------------------------------------------------------------
// ISK amounts use double precision: real (float4) keeps ~7 significant digits, which is off by
// hundreds of ISK on billion-ISK numbers. ESI ids such as transaction and journal ids exceed int32.

export const eveAccounts = pgTable("eve_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  /** The character whose skills and standings feed the calculators by default. */
  defaultCharacterId: bigint("default_character_id", { mode: "number" }),
});

export const eveCharacters = pgTable("eve_characters", {
  characterId: bigint("character_id", { mode: "number" }).primaryKey(),
  accountId: varchar("account_id").notNull(),
  name: text("name").notNull(),
  scopes: text("scopes").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  walletBalance: doublePrecision("wallet_balance"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const walletTransactions = pgTable("wallet_transactions", {
  transactionId: bigint("transaction_id", { mode: "number" }).primaryKey(),
  characterId: bigint("character_id", { mode: "number" }).notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  typeId: integer("type_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: doublePrecision("unit_price").notNull(),
  isBuy: boolean("is_buy").notNull(),
  isPersonal: boolean("is_personal").notNull(),
  locationId: bigint("location_id", { mode: "number" }).notNull(),
  clientId: bigint("client_id", { mode: "number" }).notNull(),
  journalRefId: bigint("journal_ref_id", { mode: "number" }).notNull(),
});

export const walletJournal = pgTable("wallet_journal", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  characterId: bigint("character_id", { mode: "number" }).notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  refType: text("ref_type").notNull(),
  amount: doublePrecision("amount"),
  balance: doublePrecision("balance"),
  description: text("description"),
  contextId: bigint("context_id", { mode: "number" }),
  contextIdType: text("context_id_type"),
  firstPartyId: bigint("first_party_id", { mode: "number" }),
  secondPartyId: bigint("second_party_id", { mode: "number" }),
  tax: doublePrecision("tax"),
});

export const industryJobs = pgTable("industry_jobs", {
  jobId: bigint("job_id", { mode: "number" }).primaryKey(),
  characterId: bigint("character_id", { mode: "number" }).notNull(),
  activityId: integer("activity_id").notNull(),
  blueprintTypeId: integer("blueprint_type_id").notNull(),
  productTypeId: integer("product_type_id"),
  runs: integer("runs").notNull(),
  cost: doublePrecision("cost"),
  status: text("status").notNull(),
  facilityId: bigint("facility_id", { mode: "number" }).notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
});

// Per-unit cost for items that were not bought on the market (mined, reacted, built, looted),
// so their sales can be counted as profit instead of revenue without a cost basis.
export const costOverrides = pgTable("cost_overrides", {
  accountId: varchar("account_id").notNull(),
  typeId: integer("type_id").notNull(),
  unitCost: doublePrecision("unit_cost").notNull(),
}, (t) => [primaryKey({ columns: [t.accountId, t.typeId] })]);

export type EveCharacter = typeof eveCharacters.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type WalletJournalEntry = typeof walletJournal.$inferSelect;
export type IndustryJob = typeof industryJobs.$inferSelect;

export interface CharacterSummary {
  characterId: number;
  name: string;
  walletBalance: number | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncing: boolean;
}

export interface MeResponse {
  ssoConfigured: boolean;
  /** Default character first, then by name. */
  characters: CharacterSummary[];
  defaultCharacterId: number | null;
}

export interface LedgerItemRow {
  typeId: number;
  typeName: string;
  soldQty: number;
  revenue: number;
  cogs: number;
  salesTax: number;
  profit: number;
  marginPercent: number | null;
  unmatchedQty: number;
  unmatchedRevenue: number;
  boughtQty: number;
  spent: number;
  openQty: number;
  openCost: number;
  costOverride: number | null;
}

export interface LedgerRefTypeRow {
  refType: string;
  income: number;
  expense: number;
  count: number;
}

export interface LedgerDailyRow {
  date: string;
  profit: number;
  revenue: number;
}

export interface LedgerResponse {
  periodDays: number | null;
  from: string | null;
  summary: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    salesTax: number;
    brokerFees: number;
    industryCost: number;
    netTradingProfit: number;
    unmatchedRevenue: number;
    inventoryAtCost: number;
    walletBalance: number;
    cashFlow: number;
    transactionCount: number;
  };
  items: LedgerItemRow[];
  refTypes: LedgerRefTypeRow[];
  daily: LedgerDailyRow[];
  oldestDataAt: string | null;
}

// ---------------------------------------------------------------------------
// Market fees from a character's skills and standings
// ---------------------------------------------------------------------------

export const MARKET_HUBS = [
  { stationId: 60003760, name: "Jita IV-4" },
  { stationId: 60008494, name: "Amarr VIII" },
  { stationId: 60011866, name: "Dodixie IX-20" },
  { stationId: 60004588, name: "Rens VI-8" },
  { stationId: 60005686, name: "Hek VIII-12" },
] as const;

export interface TradeProfile {
  characterId: number;
  name: string;
  station: { id: number; name: string; ownerCorpId: number; ownerCorpName: string; factionId: number | null; factionName: string | null };
  skills: { accounting: number; brokerRelations: number; advancedBrokerRelations: number } | null;
  skillsError: string | null;
  standings: { corp: number; faction: number } | null;
  standingsError: string | null;
  base: { salesTax: number; brokerFee: number };
  salesTax: { formula: number | null; observed: number | null; observedSamples: number; value: number | null };
  brokerFee: { formula: number | null; value: number | null };
}

// ---------------------------------------------------------------------------
// Market cache for the reaction scanner (Jita best prices, The Forge daily volume)
// ---------------------------------------------------------------------------

export const marketPrices = pgTable("market_prices", {
  typeId: integer("type_id").primaryKey(),
  sellMin: doublePrecision("sell_min"),
  buyMax: doublePrecision("buy_max"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const marketVolumes = pgTable("market_volumes", {
  typeId: integer("type_id").primaryKey(),
  /** Units traded per day in The Forge, averaged over 30 days (days without trades count as 0). */
  avgVolume30: doublePrecision("avg_volume_30").notNull(),
  avgPrice7: doublePrecision("avg_price_7"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export interface ReactionMarketResponse {
  prices: Record<number, { sell: number | null; buy: number | null }>;
  volumes: Record<number, { avgVolume30: number; avgPrice7: number | null }>;
  /** CCP adjusted prices: the base of the job cost (EIV). */
  adjusted: Record<number, number>;
  costIndex: { systemId: number; systemName: string; reaction: number } | null;
  pricesUpdatedAt: string | null;
  volumesUpdatedAt: string | null;
  refreshing: boolean;
  lastError: string | null;
}
