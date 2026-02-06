# EVE Online Contract Analyzer

## Overview
A web application for analyzing EVE Online public contracts to find profitable deals. Uses the public ESI (EVE Swagger Interface) API to fetch contracts, market prices, and item data. No API keys required - all endpoints are public.

## Key Features
- **Contract Scanner**: Scan public item exchange contracts in any major region, compare contract price vs total item market value, find the most profitable deals
- **Manufacturing Calculator**: Calculate production costs with ME/TE, facility bonuses, system cost index, and tax rates
- **Saved Deals**: Bookmark profitable contracts for later reference
- **Scan History**: Track previous scan results

## Architecture
- **Frontend**: React + Vite + TailwindCSS, dark sci-fi EVE Online theme (teal/cyan primary)
- **Backend**: Express.js with ESI API proxy/caching
- **Database**: PostgreSQL via Drizzle ORM
- **Fonts**: Oxanium (headings/branding), Inter (body), JetBrains Mono (monospace/data)

## Project Structure
- `shared/schema.ts` - Data models (cachedPrices, savedContracts, scanHistory), EVE types/interfaces
- `server/esi.ts` - ESI API client (market prices, contracts, items, type search)
- `server/routes.ts` - API routes (scan, save, manufacturing calc)
- `server/storage.ts` - Database CRUD via Drizzle
- `client/src/pages/scanner.tsx` - Main contract scanning page
- `client/src/pages/manufacturing.tsx` - Production cost calculator
- `client/src/pages/saved.tsx` - Saved deals list
- `client/src/pages/history.tsx` - Scan history
- `client/src/components/app-sidebar.tsx` - Navigation sidebar

## ESI API Endpoints Used
- `GET /markets/prices/` - Global adjusted/average prices
- `GET /contracts/public/{region_id}/` - Public contracts by region
- `GET /contracts/public/items/{contract_id}/` - Contract item details
- `GET /universe/types/{type_id}/` - Item type names
- `GET /search/?categories=inventory_type` - Item name search

## User Preferences
- Dark-only theme (EVE Online aesthetic)
- Monospace font for data display
- Russian-speaking user
