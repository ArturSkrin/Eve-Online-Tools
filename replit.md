# EVE Online Analyzer

## Overview
A web application for EVE Online market intelligence. Two main sections: Contract analysis (find profitable deals) and Reactions (calculate reaction profitability). Uses the public ESI (EVE Swagger Interface) API — no API keys required.

## Key Features
### Contracts Section (`/contracts/*`)
- **Contract Scanner**: Scan public item exchange contracts in any major region, compare contract price vs total item market value, find the most profitable deals
- **Manufacturing Calculator**: Calculate production costs with ME/TE, facility bonuses, system cost index, and tax rates
- **Saved Deals**: Bookmark profitable contracts for later reference
- **Scan History**: Track previous scan results

### Reactions Section (`/reactions`)
- **Axosomatic Neurolink Enhancer**: Full reaction profitability calculator with live Jita prices
  - Recipe: Nitrogen Fuel Block ×5, Amber Mykoserocin ×40, Golden Mykoserocin ×40, AG-Composite Molecular Condenser ×1 → Axosomatic Neurolink Enhancer ×20
  - Recipe source: Fuzzwork SDE API (blueprint 57497)
  - 4 margin scenarios (buy→sell, buy→buy, sell→sell, sell→buy)
  - Configurable: runs, job cost per run, sales tax %, broker fee %
  - Save settings to localStorage (persists between sessions)

### Contracts Search for Implants
- **Contract search** (`GET /api/implants/rapture-alpha/contracts`) fetches up to 4 pages of The Forge item_exchange contracts, checks up to 300 candidates in batches of 20, returns top 5 cheapest by price per unit; 15-min cache
- **Frontend**: "Найти" button triggers search (lazy); radio-select a contract to add its price to all 4 margin scenarios; "Убрать" clears selection; status bar shows contracts found, candidates checked, update time

### Implants Section (`/implants`)
- **High-grade Rapture Alpha**: Manufacturing profitability calculator with live Jita prices
  - Recipe: Nano-Factory×1, Morphite×79, Crystalline Isogen-10×360, Synthetic Synapses×542, Cryoprotectant Solution×594 → High-grade Rapture Alpha×1
  - ME (Material Efficiency 0–10) input with EVE-correct formula: max(runs, ceil(baseQty × runs × (1-ME/100) × (1-facilityBonus/100)))
  - Facility ME bonus % (Azbel basic rig = 2%)
  - Live Ikoskio system Manufacturing SCI from ESI (cached 1h), displayed on page
  - Auto-calculated job cost: sum(adjustedPrice × qty) × SCI, with manual override option
  - 4 margin scenarios, save settings to localStorage

## Architecture
- **Frontend**: React + Vite + TailwindCSS, dark sci-fi EVE Online theme (teal/cyan primary)
- **Backend**: Express.js with ESI API proxy/caching
- **Database**: PostgreSQL via Drizzle ORM
- **Fonts**: Oxanium (headings/branding), Inter (body), JetBrains Mono (monospace/data)

## Project Structure
- `client/src/App.tsx` - Main app with routing (homepage, contracts/*, reactions)
- `client/src/pages/home.tsx` - Homepage with section cards
- `client/src/pages/scanner.tsx` - Contract scanning page
- `client/src/pages/manufacturing.tsx` - Production cost calculator
- `client/src/pages/saved.tsx` - Saved deals list
- `client/src/pages/history.tsx` - Scan history
- `client/src/pages/reactions.tsx` - Reactions section
- `client/src/components/app-sidebar.tsx` - Navigation sidebar (grouped by section)
- `shared/schema.ts` - Data models (cachedPrices, savedContracts, scanHistory), EVE types/interfaces
- `server/esi.ts` - ESI API client (market prices, contracts, items, type search via /universe/ids/)
- `server/routes.ts` - API routes (scan, save, manufacturing calc)
- `server/storage.ts` - Database CRUD via Drizzle

## Route Structure
- `/` - Homepage (no sidebar, section selection)
- `/contracts` - Contract Scanner
- `/contracts/manufacturing` - Manufacturing Calculator
- `/contracts/saved` - Saved Deals
- `/contracts/history` - Scan History
- `/reactions` - Reactions (Neuralink Enhancer)
- `/implants` - Implants (High-grade Rapture Alpha)

## ESI API Endpoints Used
- `GET /markets/prices/` - Global adjusted/average prices (also used for adjustedPrice → job cost calc)
- `GET /industry/systems/` - System cost indices (Ikoskio manufacturing & reaction SCI, cached 1h)
- `GET /contracts/public/{region_id}/` - Public contracts by region
- `GET /contracts/public/items/{contract_id}/` - Contract item details
- `GET /universe/types/{type_id}/` - Item type names
- `POST /universe/ids/` - Item name search (exact match)

## User Preferences
- Dark-only theme (EVE Online aesthetic)
- Monospace font for data display
- Russian-speaking user
