import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getMarketPrices, getPublicContracts, getContractItems, getTypeNames, searchTypes, getRegionOrders, getSystemCostIndices } from "./esi";
import { EVE_REGIONS, NEURALINK_REACTION, RAPTURE_ALPHA_BLUEPRINT, calcMeQty, type AnalyzedContract, type AnalyzedItem, type ScanProgress, type ReactionItemPrice, type ImplantItemPrice, type ImplantContractListing } from "@shared/schema";
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

  app.get("/api/reactions/neuralink/prices", async (req, res) => {
    try {
      const runs = Math.max(1, parseInt(req.query.runs as string) || 1);
      const facilityMeBonus = Math.min(50, Math.max(0, parseFloat(req.query.facilityMeBonus as string) || 0));
      const JITA_REGION = 10000002;
      log(`Fetching reaction prices from Jita (runs=${runs}, facilityMeBonus=${facilityMeBonus})...`, "esi");

      await ensurePrices();

      const pricePromises = NEURALINK_REACTION.items.map(async (item) => {
        const orders = await getRegionOrders(JITA_REGION, item.typeId);
        const adjEntry = priceMap.get(item.typeId);
        const adjustedPrice = adjEntry?.adjusted || 0;

        const qty = item.role === "output"
          ? item.quantity * runs
          : calcMeQty(item.quantity, runs, 0, facilityMeBonus);

        return {
          ...item,
          quantity: qty,
          buyPrice: orders.buyMax,
          sellPrice: orders.sellMin,
          adjustedPrice,
          totalBuy: orders.buyMax * qty,
          totalSell: orders.sellMin * qty,
        } as ReactionItemPrice;
      });

      const items = await Promise.all(pricePromises);
      log(`Fetched prices for ${items.length} reaction items`, "esi");

      const sci = await getIkoskioSci();
      const inputAdjustedValue = items
        .filter((i) => i.role === "input")
        .reduce((s, i) => s + i.adjustedPrice * i.quantity, 0);
      const estimatedJobCost = inputAdjustedValue * sci.reaction;

      res.json({
        items,
        runs,
        outputPerRun: NEURALINK_REACTION.outputPerRun,
        facilityMeBonus,
        estimatedJobCost,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      log(`Error fetching reaction prices: ${err.message}`, "esi");
      res.status(500).json({ message: err.message });
    }
  });

  const IKOSKIO_SYSTEM_ID = 30045337;
  let sciCache: { indices: { manufacturing: number; reaction: number; invention: number }; fetchedAt: number } | null = null;
  const SCI_CACHE_MS = 60 * 60 * 1000;

  async function getIkoskioSci() {
    const now = Date.now();
    if (sciCache && now - sciCache.fetchedAt < SCI_CACHE_MS) return sciCache.indices;
    const indices = await getSystemCostIndices(IKOSKIO_SYSTEM_ID);
    sciCache = { indices, fetchedAt: now };
    return indices;
  }

  app.get("/api/industry/cost-index/ikoskio", async (_req, res) => {
    try {
      const indices = await getIkoskioSci();
      res.json({ systemId: IKOSKIO_SYSTEM_ID, systemName: "Ikoskio", ...indices });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/implants/rapture-alpha/prices", async (req, res) => {
    try {
      const runs = Math.max(1, parseInt(req.query.runs as string) || 1);
      const me = Math.min(10, Math.max(0, parseInt(req.query.me as string) || 0));
      const facilityBonus = Math.min(50, Math.max(0, parseFloat(req.query.facilityBonus as string) || 0));
      const JITA_REGION = 10000002;

      log(`Fetching implant prices from Jita (runs=${runs}, me=${me}, facilityBonus=${facilityBonus})...`, "esi");

      await ensurePrices();

      const pricePromises = RAPTURE_ALPHA_BLUEPRINT.items.map(async (item) => {
        const orders = await getRegionOrders(JITA_REGION, item.typeId);
        const adjEntry = priceMap.get(item.typeId);
        const adjustedPrice = adjEntry?.adjusted || 0;

        let qty: number;
        if (item.role === "output") {
          qty = item.baseQty * runs;
        } else {
          qty = calcMeQty(item.baseQty, runs, me, facilityBonus);
        }

        return {
          ...item,
          quantity: qty,
          buyPrice: orders.buyMax,
          sellPrice: orders.sellMin,
          adjustedPrice,
          totalBuy: orders.buyMax * qty,
          totalSell: orders.sellMin * qty,
        } as ImplantItemPrice;
      });

      const items = await Promise.all(pricePromises);

      const sci = await getIkoskioSci();
      const inputAdjustedValue = items
        .filter((i) => i.role === "input")
        .reduce((s, i) => s + i.adjustedPrice * i.quantity, 0);
      const estimatedJobCost = inputAdjustedValue * sci.manufacturing;

      log(`Fetched prices for ${items.length} implant items`, "esi");

      res.json({
        items,
        runs,
        me,
        facilityBonus,
        estimatedJobCost,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      log(`Error fetching implant prices: ${err.message}`, "esi");
      res.status(500).json({ message: err.message });
    }
  });

  const RAPTURE_ALPHA_TYPE_ID = 57123;
  const FORGE_REGION_ID = 10000002;
  let implantContractCache: { contracts: ImplantContractListing[]; checkedCount: number; fetchedAt: number } | null = null;
  const IMPLANT_CONTRACT_CACHE_MS = 15 * 60 * 1000;

  app.get("/api/implants/rapture-alpha/contracts", async (_req, res) => {
    try {
      const now = Date.now();
      if (implantContractCache && now - implantContractCache.fetchedAt < IMPLANT_CONTRACT_CACHE_MS) {
        return res.json({ contracts: implantContractCache.contracts, checkedCount: implantContractCache.checkedCount, cached: true, updatedAt: new Date(implantContractCache.fetchedAt).toISOString() });
      }

      log("Fetching implant contracts from The Forge...", "esi");

      const firstPage = await getPublicContracts(FORGE_REGION_ID, 1);
      const totalPages = Math.min(firstPage.totalPages, 4);
      let allContracts = [...firstPage.contracts];

      if (totalPages > 1) {
        const extraPages = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) => getPublicContracts(FORGE_REGION_ID, i + 2))
        );
        for (const p of extraPages) allContracts = allContracts.concat(p.contracts);
      }

      const candidates = allContracts
        .filter((c) => c.type === "item_exchange" && c.price > 0)
        .sort((a, b) => a.price - b.price)
        .slice(0, 300);

      log(`Checking items for ${candidates.length} candidate contracts...`, "esi");

      const found: ImplantContractListing[] = [];
      const BATCH = 20;

      for (let i = 0; i < candidates.length && found.length < 5; i += BATCH) {
        const batch = candidates.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (c) => {
            const items = await getContractItems(c.contract_id);
            const target = items.find((it) => it.type_id === RAPTURE_ALPHA_TYPE_ID && it.is_included);
            if (!target) return null;
            const qty = target.quantity;
            return {
              contractId: c.contract_id,
              price: c.price,
              quantity: qty,
              pricePerUnit: c.price / qty,
              dateExpired: c.date_expired,
              locationId: c.start_location_id,
            } as ImplantContractListing;
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) found.push(r.value);
        }
      }

      found.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
      const top5 = found.slice(0, 5);

      implantContractCache = { contracts: top5, checkedCount: candidates.length, fetchedAt: now };

      log(`Found ${top5.length} contracts with High-grade Rapture Alpha`, "esi");
      res.json({ contracts: top5, checkedCount: candidates.length, cached: false, updatedAt: new Date().toISOString() });
    } catch (err: any) {
      log(`Error fetching implant contracts: ${err.message}`, "esi");
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
