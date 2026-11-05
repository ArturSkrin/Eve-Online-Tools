import type { Express, Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { eveCharacters, type MeResponse } from "@shared/schema";
import { isSsoConfigured, requireAccount } from "./auth";
import { deleteCharacterData, isSyncing, syncAccount } from "./character-sync";
import { buildLedger, setCostOverride } from "./ledger";
import { buildTradeProfile } from "./trade-profile";

const PERIODS = new Set([7, 30, 90, 365]);

export function registerAccountRoutes(app: Express) {
  app.get("/api/me", async (req, res, next) => {
    try {
      const accountId = req.session?.accountId;
      const chars = accountId
        ? await db.select().from(eveCharacters).where(eq(eveCharacters.accountId, accountId))
        : [];
      const body: MeResponse = {
        ssoConfigured: isSsoConfigured(),
        characters: chars.map((c) => ({
          characterId: c.characterId,
          name: c.name,
          walletBalance: c.walletBalance,
          lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
          lastSyncError: c.lastSyncError,
          syncing: isSyncing(c.characterId),
        })),
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/me/sync", requireAccount, async (req, res, next) => {
    try {
      res.json(await syncAccount(req.session.accountId!));
    } catch (err) {
      next(err);
    }
  });

  // Unlinks the character and deletes everything stored for it, refresh token included.
  app.delete("/api/me/characters/:id", requireAccount, async (req: Request, res, next) => {
    try {
      const characterId = Number(req.params.id);
      const [ch] = await db
        .select()
        .from(eveCharacters)
        .where(and(eq(eveCharacters.characterId, characterId), eq(eveCharacters.accountId, req.session.accountId!)));
      if (!ch) return res.status(404).json({ message: "Character not found" });
      await deleteCharacterData([characterId]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Sales tax and broker fee for one character at one station, from its skills, standings and past sales.
  app.get("/api/me/trade-profile", requireAccount, async (req, res, next) => {
    try {
      const characterId = Number(req.query.characterId);
      const stationId = Number(req.query.stationId) || 60003760;
      const profile = await buildTradeProfile(req.session.accountId!, characterId, stationId);
      if (!profile) return res.status(404).json({ message: "Character not found" });
      res.json(profile);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/ledger", requireAccount, async (req, res, next) => {
    try {
      const days = Number(req.query.days);
      res.json(await buildLedger(req.session.accountId!, PERIODS.has(days) ? days : null));
    } catch (err) {
      next(err);
    }
  });

  app.put("/api/ledger/cost-override/:typeId", requireAccount, async (req, res, next) => {
    try {
      const typeId = Number(req.params.typeId);
      const raw = req.body?.unitCost;
      const unitCost = raw === null || raw === "" || raw === undefined ? null : Number(raw);
      if (!Number.isInteger(typeId) || (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0))) {
        return res.status(400).json({ message: "unitCost must be a non-negative number or null" });
      }
      await setCostOverride(req.session.accountId!, typeId, unitCost);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}
