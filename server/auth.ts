import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { eveAccounts, eveCharacters } from "@shared/schema";
import { log } from "./index";

// EVE SSO v2 (OAuth 2.0 authorization code flow, server-side app with a client secret).
// Register the application at https://developers.eveonline.com with the callback URL and the scopes below.
const SSO_AUTHORIZE = "https://login.eveonline.com/v2/oauth/authorize";
const SSO_TOKEN = "https://login.eveonline.com/v2/oauth/token";

export const SSO_SCOPES = [
  "esi-wallet.read_character_wallet.v1",
  "esi-industry.read_character_jobs.v1",
  // Not used by the ledger yet; requested now so the trading and industry modules do not need a re-login.
  "esi-markets.read_character_orders.v1",
  "esi-skills.read_skills.v1",
];

declare module "express-session" {
  interface SessionData {
    accountId?: string;
    oauthState?: string;
    addingCharacter?: boolean;
  }
}

function ssoConfig() {
  const clientId = process.env.EVE_CLIENT_ID;
  const clientSecret = process.env.EVE_CLIENT_SECRET;
  const callbackUrl = process.env.EVE_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) return null;
  return { clientId, clientSecret, callbackUrl };
}

export function isSsoConfigured(): boolean {
  return ssoConfig() !== null && !!process.env.SESSION_SECRET;
}

// --- refresh token encryption ------------------------------------------------------------------------------
// A refresh token gives read access to the character's wallet until it is revoked, so it is never stored in
// plain text. Changing SESSION_SECRET (or EVE_TOKEN_KEY) makes stored tokens unreadable: characters then
// show "log in again" instead of failing silently.

function tokenKey(): Buffer {
  const secret = process.env.EVE_TOKEN_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(`eve-refresh-token:${secret}`).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

// --- token endpoint ----------------------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

export class SsoGrantError extends Error {}

export async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const cfg = ssoConfig();
  if (!cfg) throw new Error("EVE SSO is not configured");
  const res = await fetch(SSO_TOKEN, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    // invalid_grant: the refresh token was revoked (password change, app removed) or the code was reused
    if (res.status === 400 && text.includes("invalid_grant")) throw new SsoGrantError(text);
    throw new Error(`SSO token error ${res.status}: ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

interface AccessTokenClaims {
  sub: string;
  name: string;
  scp?: string | string[];
  iss: string;
  aud?: string | string[];
  exp: number;
}

// The token comes straight from CCP's token endpoint over TLS, so its claims are trusted without checking the
// JWT signature (RFC 6749 §10.4 / OIDC core §3.1.3.7). Issuer, audience and expiry are still checked.
function readClaims(accessToken: string): AccessTokenClaims {
  const payload = accessToken.split(".")[1];
  if (!payload) throw new Error("SSO returned a malformed access token");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessTokenClaims;
  if (!["login.eveonline.com", "https://login.eveonline.com"].includes(claims.iss)) {
    throw new Error(`Unexpected token issuer ${claims.iss}`);
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes("EVE Online")) throw new Error("Unexpected token audience");
  if (claims.exp * 1000 < Date.now()) throw new Error("SSO returned an expired token");
  return claims;
}

// --- session -----------------------------------------------------------------------------------------------

export function setupSession(app: Express) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    log("SESSION_SECRET is not set: character login is disabled", "auth");
    return;
  }
  const PgStore = connectPgSimple(session);
  app.set("trust proxy", 1);
  app.use(
    session({
      name: "eve.sid",
      secret,
      resave: false,
      saveUninitialized: false,
      // The table is created by ensureSchema; connect-pg-simple's own createTableIfMissing reads a SQL file
      // from its package folder, which is not there once the server is bundled.
      store: new PgStore({
        pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
        tableName: "session",
      }),
      cookie: {
        httpOnly: true,
        // lax, not strict: the SSO callback is a top-level redirect from login.eveonline.com and has to carry it
        sameSite: "lax",
        secure: "auto",
        maxAge: 30 * 24 * 3600 * 1000,
      },
    }),
  );
}

export function requireAccount(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.accountId) return res.status(401).json({ message: "Not logged in" });
  next();
}

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

export function registerAuthRoutes(app: Express, onCharacterAdded: (characterId: number) => void) {
  app.get("/auth/eve/login", async (req, res, next) => {
    try {
      const cfg = ssoConfig();
      if (!cfg || !req.session) return res.status(503).send("EVE SSO is not configured on this server");
      const state = randomBytes(24).toString("hex");
      req.session.oauthState = state;
      await save(req);
      const url = new URL(SSO_AUTHORIZE);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", cfg.callbackUrl);
      url.searchParams.set("client_id", cfg.clientId);
      url.searchParams.set("scope", SSO_SCOPES.join(" "));
      url.searchParams.set("state", state);
      res.redirect(url.toString());
    } catch (err) {
      next(err);
    }
  });

  app.get("/auth/eve/callback", async (req, res, next) => {
    try {
      if (!req.session) return res.status(503).send("EVE SSO is not configured on this server");
      const { code, state } = req.query as { code?: string; state?: string };
      const expected = req.session.oauthState;
      delete req.session.oauthState;
      if (!code || !state || !expected || state !== expected) {
        return res.status(400).send("Login expired or was not started here. Go back and try again.");
      }

      const token = await requestToken({ grant_type: "authorization_code", code });
      const claims = readClaims(token.access_token);
      const characterId = Number(claims.sub.split(":").pop());
      if (!Number.isSafeInteger(characterId)) throw new Error(`Unexpected subject ${claims.sub}`);
      const scopes = Array.isArray(claims.scp) ? claims.scp.join(" ") : claims.scp || "";

      const [existing] = await db.select().from(eveCharacters).where(eq(eveCharacters.characterId, characterId));

      // Logged in already: the character joins this account (SSO just proved the owner has it, so it may move
      // from another account). Otherwise log in to the character's account, or start a new one.
      let accountId = req.session.accountId ?? existing?.accountId;
      if (!accountId) {
        const [account] = await db.insert(eveAccounts).values({}).returning();
        accountId = account.id;
      }

      const values = {
        accountId,
        name: claims.name,
        scopes,
        refreshTokenEnc: encryptToken(token.refresh_token),
        lastSyncError: null,
      };
      await db
        .insert(eveCharacters)
        .values({ characterId, ...values })
        .onConflictDoUpdate({ target: eveCharacters.characterId, set: values });

      // New session id on every login so a session id planted before login cannot be used after it.
      await regenerate(req);
      req.session.accountId = accountId;
      await save(req);

      log(`character ${claims.name} (${characterId}) logged in`, "auth");
      onCharacterAdded(characterId);
      res.redirect("/profit");
    } catch (err) {
      next(err);
    }
  });

  app.post("/auth/logout", (req, res) => {
    if (!req.session) return res.json({ ok: true });
    req.session.destroy(() => {
      res.clearCookie("eve.sid");
      res.json({ ok: true });
    });
  });
}
