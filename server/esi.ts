import { log } from "./index";

export const ESI_BASE = "https://esi.evetech.net/latest";
export const USER_AGENT = "EVEContractAnalyzer/1.0 (replit-app)";

interface EsiMarketPrice {
  type_id: number;
  adjusted_price?: number;
  average_price?: number;
}

interface EsiContract {
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
  for_corporation: boolean;
}

interface EsiContractItem {
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

interface EsiTypeInfo {
  type_id: number;
  name: string;
  description: string;
  group_id: number;
  published: boolean;
}

const typeNameCache = new Map<number, string>();

/** An ESI request that failed, with a reason a player can act on (shown as-is in the UI). */
export class EsiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function esiError(status: number, body: string, path: string): EsiError {
  let reason = body.trim();
  try {
    reason = JSON.parse(body)?.error ?? reason;
  } catch {
    // not JSON: keep the raw text
  }
  reason = reason.slice(0, 200);
  const ccp = reason ? ` CCP: «${reason}»` : "";
  if (status === 503 && /maintenance/i.test(reason)) {
    return new EsiError(status, `ESI на обслуживании у CCP, данные появятся, когда его включат.${ccp}`);
  }
  if (status === 504 || /tranquility/i.test(reason)) {
    return new EsiError(status, `Сервер EVE (Tranquility) не отвечает ESI: даунтайм или сбой у CCP.${ccp}`);
  }
  if (status === 420) {
    return new EsiError(status, `ESI временно ограничил запросы с этого сервера из-за ошибок, подождите минуту.${ccp}`);
  }
  if (status >= 500) {
    return new EsiError(status, `ESI временно недоступен (${status}).${ccp}`);
  }
  return new EsiError(status, `ESI ${status} на ${path}.${ccp}`);
}

async function esiFetch<T>(endpoint: string, params?: Record<string, string>): Promise<{ data: T; pages: number }> {
  const url = new URL(`${ESI_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (!res.ok) throw esiError(res.status, await res.text(), endpoint);

  const pages = parseInt(res.headers.get("x-pages") || "1");
  const data = (await res.json()) as T;
  return { data, pages };
}

export async function getMarketPrices(): Promise<EsiMarketPrice[]> {
  const { data } = await esiFetch<EsiMarketPrice[]>("/markets/prices/");
  return data;
}

export async function getPublicContracts(regionId: number, page = 1): Promise<{ contracts: EsiContract[]; totalPages: number }> {
  const { data, pages } = await esiFetch<EsiContract[]>(`/contracts/public/${regionId}/`, { page: String(page) });
  return { contracts: data, totalPages: pages };
}

export async function getContractItems(contractId: number): Promise<EsiContractItem[]> {
  try {
    const { data } = await esiFetch<EsiContractItem[]>(`/contracts/public/items/${contractId}/`);
    return data;
  } catch (err: any) {
    if (err.message?.includes("404")) return [];
    throw err;
  }
}

export async function getTypeName(typeId: number): Promise<string> {
  if (typeNameCache.has(typeId)) {
    return typeNameCache.get(typeId)!;
  }

  try {
    const { data } = await esiFetch<EsiTypeInfo>(`/universe/types/${typeId}/`);
    typeNameCache.set(typeId, data.name);
    return data.name;
  } catch {
    return `Type #${typeId}`;
  }
}

export async function getTypeNames(typeIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const uncached = typeIds.filter((id) => {
    if (typeNameCache.has(id)) {
      result.set(id, typeNameCache.get(id)!);
      return false;
    }
    return true;
  });

  if (uncached.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < uncached.length; i += batchSize) {
      const batch = uncached.slice(i, i + batchSize);
      const promises = batch.map(async (typeId) => {
        const name = await getTypeName(typeId);
        result.set(typeId, name);
      });
      await Promise.allSettled(promises);
    }
  }

  return result;
}

export async function searchTypes(query: string): Promise<Array<{ typeId: number; typeName: string }>> {
  try {
    const res = await fetch(`${ESI_BASE}/universe/ids/`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify([query]),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const types: Array<{ id: number; name: string }> = data?.inventory_types || [];
    if (types.length === 0) return [];
    return types.slice(0, 20).map((t) => {
      typeNameCache.set(t.id, t.name);
      return { typeId: t.id, typeName: t.name };
    });
  } catch {
    return [];
  }
}

export interface IndustryCostIndices {
  manufacturing: number;
  reaction: number;
  invention: number;
}

export async function getSystemCostIndices(systemId: number): Promise<IndustryCostIndices> {
  const { data } = await esiFetch<Array<{ solar_system_id: number; cost_indices: Array<{ activity: string; cost_index: number }> }>>("/industry/systems/");
  const system = data.find((s) => s.solar_system_id === systemId);
  const result: IndustryCostIndices = { manufacturing: 0, reaction: 0, invention: 0 };
  if (!system) return result;
  for (const ci of system.cost_indices) {
    if (ci.activity === "manufacturing") result.manufacturing = ci.cost_index;
    else if (ci.activity === "reaction") result.reaction = ci.cost_index;
    else if (ci.activity === "invention") result.invention = ci.cost_index;
  }
  return result;
}

const JITA_SYSTEM_ID = 30000142;

// Throws on a failed request: "no orders" is an empty list from ESI, and a failure turned into a price of 0
// would make every margin silently wrong during an outage.
export async function getRegionOrders(regionId: number, typeId: number): Promise<{ sellMin: number; buyMax: number }> {
  let sellMin = Infinity;
  let buyMax = 0;

  const { data: sellOrders } = await esiFetch<any[]>(`/markets/${regionId}/orders/`, {
    type_id: String(typeId),
    order_type: "sell",
  });
  for (const order of sellOrders) {
    if (order.system_id === JITA_SYSTEM_ID && order.price < sellMin) sellMin = order.price;
  }

  const { data: buyOrders } = await esiFetch<any[]>(`/markets/${regionId}/orders/`, {
    type_id: String(typeId),
    order_type: "buy",
  });
  for (const order of buyOrders) {
    if (order.system_id === JITA_SYSTEM_ID && order.price > buyMax) buyMax = order.price;
  }

  return { sellMin: sellMin === Infinity ? 0 : sellMin, buyMax };
}

// Names for many ids in one request each 1000 (POST /universe/names/), filling the same cache as getTypeName.
// Ids ESI does not know make the whole batch fail, so a failed batch falls back to one-by-one lookups.
export async function getTypeNamesBulk(typeIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const missing = Array.from(new Set(typeIds)).filter((id) => {
    const cached = typeNameCache.get(id);
    if (cached) result.set(id, cached);
    return !cached;
  });
  for (let i = 0; i < missing.length; i += 1000) {
    const batch = missing.slice(i, i + 1000);
    try {
      const res = await fetch(`${ESI_BASE}/universe/names/`, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) throw new Error(`ESI ${res.status}`);
      const data = (await res.json()) as Array<{ id: number; name: string }>;
      data.forEach((n) => {
        typeNameCache.set(n.id, n.name);
        result.set(n.id, n.name);
      });
    } catch {
      (await getTypeNames(batch)).forEach((name, id) => result.set(id, name));
    }
  }
  return result;
}
