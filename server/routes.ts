import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getMarketPrices, getPublicContracts, getContractItems, getTypeNames, searchTypes, getRegionOrders } from "./esi";
import { EVE_REGIONS, type AnalyzedContract, type AnalyzedItem, type ScanProgress } from "@shared/schema";
import { log } from "./index";

let scanProgress: ScanProgress = {
  status: "idle",
  totalContracts: 0,
  analyzedContracts: 0,
  currentPage: 0,
  totalPages: 0,
  message: "Ready to scan",
};

let scanResultsByRegion = new Map<number, AnalyzedContract[]>();
let priceMap = new Map<number, { adjusted: number; average: number }>();
let pricesLastFetched = 0;
const PRICE_CACHE_MS = 30 * 60 * 1000;

async function ensurePrices(): Promise<void> {
  const now = Date.now();
  if (priceMap.size > 0 && now - pricesLastFetched < PRICE_CACHE_MS) {
    return;
  }

  log("Fetching market prices from ESI...", "esi");
  const prices = await getMarketPrices();
  priceMap = new Map();
  for (const p of prices) {
    priceMap.set(p.type_id, {
      adjusted: p.adjusted_price || 0,
      average: p.average_price || 0,
    });
  }
  pricesLastFetched = now;
  log(`Cached ${priceMap.size} market prices`, "esi");
}

function getItemPrice(typeId: number): number {
  const p = priceMap.get(typeId);
  if (!p) return 0;
  return p.average || p.adjusted || 0;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/scan/progress", (_req, res) => {
    res.json(scanProgress);
  });

  app.post("/api/scan/start", async (req, res) => {
    try {
      const { regionId, minMarginPercent = 10 } = req.body;

      if (scanProgress.status === "scanning" || scanProgress.status === "analyzing") {
        return res.status(409).json({ message: "A scan is already in progress" });
      }

      const region = EVE_REGIONS.find((r) => r.id === regionId);
      if (!region) {
        return res.status(400).json({ message: "Invalid region" });
      }

      res.json({ message: "Scan started", regionId });

      runScan(regionId, region.name, minMarginPercent).catch((err) => {
        log(`Scan error: ${err.message}`, "esi");
        scanProgress = {
          status: "error",
          totalContracts: scanProgress.totalContracts,
          analyzedContracts: scanProgress.analyzedContracts,
          currentPage: scanProgress.currentPage,
          totalPages: scanProgress.totalPages,
          message: `Error: ${err.message}`,
        };
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/scan/results/:regionId", (req, res) => {
    const rId = parseInt(req.params.regionId);
    res.json({ contracts: scanResultsByRegion.get(rId) || [] });
  });

  app.get("/api/scan/results", (_req, res) => {
    const allResults: AnalyzedContract[] = [];
    scanResultsByRegion.forEach((contracts) => allResults.push(...contracts));
    allResults.sort((a, b) => b.marginPercent - a.marginPercent);
    res.json({ contracts: allResults });
  });

  app.post("/api/contracts/save", async (req, res) => {
    try {
      const saved = await storage.saveSavedContract(req.body);
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contracts/saved", async (_req, res) => {
    try {
      const saved = await storage.getSavedContracts();
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/contracts/saved/:id", async (req, res) => {
    try {
      await storage.deleteSavedContract(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/scan/history", async (_req, res) => {
    try {
      const history = await storage.getScanHistory();
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/items/search", async (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q || q.length < 2) {
        return res.json([]);
      }
      const results = await searchTypes(q);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/manufacturing/calculate", async (req, res) => {
    try {
      const { typeId, typeName, materialEfficiency, timeEfficiency, facilityBonus, systemCostIndex, taxRate, runs } = req.body;

      await ensurePrices();

      const marketPrice = getItemPrice(typeId) * runs;
      const basePrice = getItemPrice(typeId);

      const meReduction = 1 - (materialEfficiency / 100);
      const facilityReduction = 1 - (facilityBonus / 100);
      const materialCost = basePrice * 0.5 * meReduction * facilityReduction * runs;
      const jobCost = basePrice * (systemCostIndex / 100) * runs;
      const taxCost = jobCost * (taxRate / 100);
      const totalCost = materialCost + jobCost + taxCost;
      const profit = marketPrice - totalCost;
      const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

      res.json({
        typeId,
        typeName,
        materialCost,
        jobCost,
        taxCost,
        totalCost,
        marketPrice,
        profit,
        profitPercent,
        runs,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

async function runScan(regionId: number, regionName: string, minMarginPercent: number) {
  scanProgress = {
    status: "scanning",
    totalContracts: 0,
    analyzedContracts: 0,
    currentPage: 0,
    totalPages: 0,
    message: "Loading market prices...",
  };

  await ensurePrices();

  scanProgress.message = "Fetching contracts from ESI...";
  log(`Starting scan for region ${regionName} (${regionId})`, "esi");

  const { contracts: firstPage, totalPages } = await getPublicContracts(regionId, 1);
  scanProgress.totalPages = totalPages;
  scanProgress.currentPage = 1;

  let allContracts = [...firstPage];

  const pagesToFetch = Math.min(totalPages, 5);
  for (let page = 2; page <= pagesToFetch; page++) {
    scanProgress.currentPage = page;
    scanProgress.message = `Fetching contracts page ${page}/${pagesToFetch}...`;
    try {
      const { contracts } = await getPublicContracts(regionId, page);
      allContracts = allContracts.concat(contracts);
    } catch (err: any) {
      log(`Error fetching page ${page}: ${err.message}`, "esi");
    }
  }

  const itemExchangeContracts = allContracts.filter(
    (c) => c.type === "item_exchange" && c.price > 0
  );

  scanProgress.totalContracts = itemExchangeContracts.length;
  scanProgress.status = "analyzing";
  scanProgress.message = `Analyzing ${itemExchangeContracts.length} item exchange contracts...`;

  log(`Found ${itemExchangeContracts.length} item exchange contracts to analyze`, "esi");

  const analyzedContracts: AnalyzedContract[] = [];
  const batchSize = 10;

  const contractsToAnalyze = itemExchangeContracts.slice(0, 200);

  for (let i = 0; i < contractsToAnalyze.length; i += batchSize) {
    const batch = contractsToAnalyze.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (contract) => {
        try {
          const items = await getContractItems(contract.contract_id);
          if (items.length === 0) return null;

          const includedItems = items.filter((item) => item.is_included);
          if (includedItems.length === 0) return null;

          const typeIds = [...new Set(includedItems.map((item) => item.type_id))];
          const typeNames = await getTypeNames(typeIds);

          let totalValue = 0;
          const analyzedItems: AnalyzedItem[] = [];

          for (const item of includedItems) {
            const unitPrice = getItemPrice(item.type_id);
            const totalPrice = unitPrice * item.quantity;
            totalValue += totalPrice;

            analyzedItems.push({
              typeId: item.type_id,
              typeName: typeNames.get(item.type_id) || `Type #${item.type_id}`,
              quantity: item.quantity,
              unitPrice,
              totalPrice,
              isBlueprint: item.is_blueprint_copy || false,
            });
          }

          const margin = totalValue - contract.price;
          const marginPercent = contract.price > 0 ? (margin / contract.price) * 100 : 0;

          if (marginPercent < minMarginPercent) return null;

          return {
            contractId: contract.contract_id,
            contractPrice: contract.price,
            itemsValue: totalValue,
            margin,
            marginPercent,
            title: contract.title || "",
            type: contract.type,
            dateExpired: contract.date_expired,
            itemCount: includedItems.length,
            items: analyzedItems,
            volume: contract.volume,
          } as AnalyzedContract;
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        analyzedContracts.push(result.value);
      }
    }

    scanProgress.analyzedContracts = Math.min(i + batchSize, contractsToAnalyze.length);
    scanProgress.message = `Analyzed ${scanProgress.analyzedContracts}/${contractsToAnalyze.length} contracts (${analyzedContracts.length} profitable)`;
  }

  analyzedContracts.sort((a, b) => b.marginPercent - a.marginPercent);
  scanResultsByRegion.set(regionId, analyzedContracts);

  const bestMargin = analyzedContracts.length > 0 ? analyzedContracts[0].marginPercent : null;

  await storage.addScanHistory({
    regionId,
    regionName,
    totalContracts: itemExchangeContracts.length,
    analyzedContracts: contractsToAnalyze.length,
    profitableContracts: analyzedContracts.length,
    bestMargin,
  });

  scanProgress = {
    status: "complete",
    totalContracts: contractsToAnalyze.length,
    analyzedContracts: contractsToAnalyze.length,
    currentPage: pagesToFetch,
    totalPages: pagesToFetch,
    message: `Scan complete. Found ${analyzedContracts.length} profitable contracts.`,
  };

  log(`Scan complete: ${analyzedContracts.length} profitable out of ${contractsToAnalyze.length} analyzed`, "esi");
}
