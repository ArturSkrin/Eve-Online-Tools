import { log } from "./index";

const ESI_BASE = "https://esi.evetech.net/latest";
const USER_AGENT = "EVEContractAnalyzer/1.0 (replit-app)";

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

async function esiFetch<T>(endpoint: string, params?: Record<string, string>): Promise<{ data: T; pages: number }> {
  const url = new URL(`${ESI_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ESI Error ${res.status}: ${text}`);
  }

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

export async function getRegionOrders(regionId: number, typeId: number): Promise<{ sellMin: number; buyMax: number }> {
  try {
    let sellMin = Infinity;
    let buyMax = 0;

    const { data: sellOrders } = await esiFetch<any[]>(`/markets/${regionId}/orders/`, {
      type_id: String(typeId),
      order_type: "sell",
    });

    for (const order of sellOrders) {
      if (order.price < sellMin) sellMin = order.price;
    }

    const { data: buyOrders } = await esiFetch<any[]>(`/markets/${regionId}/orders/`, {
      type_id: String(typeId),
      order_type: "buy",
    });

    for (const order of buyOrders) {
      if (order.price > buyMax) buyMax = order.price;
    }

    return {
      sellMin: sellMin === Infinity ? 0 : sellMin,
      buyMax,
    };
  } catch {
    return { sellMin: 0, buyMax: 0 };
  }
}
