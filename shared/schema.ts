import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
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
  totalBuy: number;
  totalSell: number;
}

export interface ReactionPricesResponse {
  items: ReactionItemPrice[];
  runs: number;
  outputPerRun: number;
  updatedAt: string;
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
