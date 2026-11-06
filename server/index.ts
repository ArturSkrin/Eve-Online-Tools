import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { vitalsMiddleware, registerVitals } from "./vitals";
import { ensureSchema } from "./ensure-schema";
import { isSsoConfigured, registerAuthRoutes, setupSession } from "./auth";
import { registerAccountRoutes } from "./account-routes";
import { startBackgroundSync, syncCharacter } from "./character-sync";
import { marketSnapshot, refreshMarket, startMarketRefresh } from "./market-cache";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Request counters and GET /internal/vitals for the Daedalus health tracker. Registered before the routes so
// every /api request is counted, and before the static catch-all so the endpoint is reachable.
app.use(vitalsMiddleware);
registerVitals(app);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const body = JSON.stringify(capturedJsonResponse);
        // ledger responses run to hundreds of KB; the head is enough for a log line
        logLine += ` :: ${body.length > 500 ? `${body.slice(0, 500)}…` : body}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Postgres may still be starting (pods come up together on the cluster): keep trying for a minute before
  // serving, since every route needs the tables.
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureSchema();
      break;
    } catch (err) {
      if (attempt >= 30) {
        console.error("Could not create tables, serving anyway:", err);
        break;
      }
      log(`database not ready (${err instanceof Error ? err.message : err}), retrying`, "db");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  setupSession(app);
  registerAuthRoutes(app, (characterId) => void syncCharacter(characterId));
  registerAccountRoutes(app);
  if (isSsoConfigured()) startBackgroundSync();
  startMarketRefresh();

  // Reaction scanner market data: cached Jita prices and daily volumes (see server/market-cache.ts).
  app.get("/api/reactions/market", async (_req, res, next) => {
    try {
      res.json(await marketSnapshot());
    } catch (err) {
      next(err);
    }
  });
  let lastForcedRefresh = 0;
  app.post("/api/reactions/market/refresh", (_req, res) => {
    // ESI caches orders for 5 minutes: refreshing more often only burns the error budget.
    if (Date.now() - lastForcedRefresh < 5 * 60 * 1000) return res.json({ started: false });
    lastForcedRefresh = Date.now();
    void refreshMarket({ force: true });
    res.json({ started: true });
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
