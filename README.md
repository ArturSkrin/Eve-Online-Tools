# Eve-Online-Tools

## Profit & Loss (EVE SSO)

`/profit` logs in with EVE characters and matches every market sale against what was paid for the item
(FIFO, pooled across all characters of the account), minus sales tax and broker fees. Wallet journal,
market transactions and industry jobs are synced every hour and kept in Postgres: ESI only returns the
last 30 days, so history grows from the day a character is added.

Items that were never bought on the market (mined gas, reaction output, loot) have no cost basis. Their
sales are shown separately until a unit cost is entered for them on the "No cost basis" tab.

### Setup

1. Create an application at https://developers.eveonline.com:
   - Connection type: *Authentication & API Access*
   - Callback URL: `https://<your host>/auth/eve/callback`
   - Scopes: `esi-wallet.read_character_wallet.v1`, `esi-industry.read_character_jobs.v1`,
     `esi-markets.read_character_orders.v1`, `esi-skills.read_skills.v1`,
     `esi-characters.read_standings.v1`
2. Set these environment variables (`.env` for docker compose, the `eve-secrets` secret for k8s):

   | Variable | Value |
   |---|---|
   | `EVE_CLIENT_ID` | Client ID of the application |
   | `EVE_CLIENT_SECRET` | Secret key of the application |
   | `EVE_CALLBACK_URL` | Exactly the callback URL registered above |
   | `SESSION_SECRET` | Long random string (`openssl rand -hex 32`). Signs session cookies and encrypts stored refresh tokens: changing it means every character has to log in again |

The tables are created on start (`server/ensure-schema.ts`), so an existing database needs no migration.
Without these variables the rest of the app works as before and the page says login is not configured.

## Character-based market fees

The Tax & Fees cards on the reaction and Rapture Alpha calculators can take sales tax and broker fee from a
logged-in character: Accounting, Broker Relations and its standings toward the hub station's owner corporation
and faction (`server/trade-profile.ts`). When the character has sales on record, the tax actually charged on
them is used instead of the formula. Characters that logged in before `esi-characters.read_standings.v1` was
requested have to log in again for standings.
