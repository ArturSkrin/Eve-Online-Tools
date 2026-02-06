import { type InsertSavedContract, type SavedContract, type InsertScanHistory, type ScanHistory, type CachedPrice, type InsertCachedPrice, cachedPrices, savedContracts, scanHistory } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getCachedPrices(): Promise<CachedPrice[]>;
  getCachedPrice(typeId: number): Promise<CachedPrice | undefined>;
  upsertCachedPrice(price: InsertCachedPrice): Promise<CachedPrice>;
  upsertCachedPrices(prices: InsertCachedPrice[]): Promise<void>;

  getSavedContracts(): Promise<SavedContract[]>;
  saveSavedContract(contract: InsertSavedContract): Promise<SavedContract>;
  deleteSavedContract(id: string): Promise<void>;

  getScanHistory(): Promise<ScanHistory[]>;
  addScanHistory(entry: InsertScanHistory): Promise<ScanHistory>;
}

export class DatabaseStorage implements IStorage {
  async getCachedPrices(): Promise<CachedPrice[]> {
    return db.select().from(cachedPrices);
  }

  async getCachedPrice(typeId: number): Promise<CachedPrice | undefined> {
    const [price] = await db.select().from(cachedPrices).where(eq(cachedPrices.typeId, typeId));
    return price;
  }

  async upsertCachedPrice(price: InsertCachedPrice): Promise<CachedPrice> {
    const [result] = await db
      .insert(cachedPrices)
      .values(price)
      .onConflictDoUpdate({
        target: cachedPrices.typeId,
        set: {
          typeName: price.typeName,
          adjustedPrice: price.adjustedPrice,
          averagePrice: price.averagePrice,
          jitaSellMin: price.jitaSellMin,
          jitaBuyMax: price.jitaBuyMax,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async upsertCachedPrices(prices: InsertCachedPrice[]): Promise<void> {
    if (prices.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < prices.length; i += batchSize) {
      const batch = prices.slice(i, i + batchSize);
      await db
        .insert(cachedPrices)
        .values(batch)
        .onConflictDoUpdate({
          target: cachedPrices.typeId,
          set: {
            typeName: batch[0]?.typeName,
            adjustedPrice: batch[0]?.adjustedPrice,
            averagePrice: batch[0]?.averagePrice,
            updatedAt: new Date(),
          },
        });
    }
  }

  async getSavedContracts(): Promise<SavedContract[]> {
    return db.select().from(savedContracts).orderBy(desc(savedContracts.savedAt));
  }

  async saveSavedContract(contract: InsertSavedContract): Promise<SavedContract> {
    const [result] = await db.insert(savedContracts).values(contract).returning();
    return result;
  }

  async deleteSavedContract(id: string): Promise<void> {
    await db.delete(savedContracts).where(eq(savedContracts.id, id));
  }

  async getScanHistory(): Promise<ScanHistory[]> {
    return db.select().from(scanHistory).orderBy(desc(scanHistory.scannedAt)).limit(50);
  }

  async addScanHistory(entry: InsertScanHistory): Promise<ScanHistory> {
    const [result] = await db.insert(scanHistory).values(entry).returning();
    return result;
  }
}

export const storage = new DatabaseStorage();
