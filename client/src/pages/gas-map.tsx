import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatISKCompact, formatNumber } from "@/lib/format";
import { Home, Locate, Map as MapIcon, Maximize2, Search, Shield, Skull, Zap } from "lucide-react";
import type { ReactionMarketResponse } from "@shared/schema";
import { REACTION_DATA, typeOf } from "@shared/reactions";
import {
  BOOSTER_GASES,
  FLAVORS,
  FULLERITE_SITES,
  GAS_SITES,
  type BoosterGas,
  type GasFamily,
  type GasSite,
} from "@shared/gas-sites";

// --- map data ------------------------------------------------------------------------------------------------

interface MapFile {
  sdeBuild: number;
  regions: Array<{ id: number; name: string }>;
  constellations: Array<{ id: number; name: string; regionId: number }>;
  systems: Array<[number, string, number, number, number, number, number]>;
  gates: Array<[number, number]>;
}

interface Sys {
  i: number;
  id: number;
  name: string;
  constellationId: number;
  regionId: number;
  x: number;
  y: number;
  sec: number;
}

interface Universe {
  sdeBuild: number;
  systems: Sys[];
  byName: Map<string, Sys>;
  regionName: Map<number, string>;
  regionByName: Map<string, number>;
  constName: Map<number, string>;
  constByName: Map<string, number>;
  regionCenter: Map<number, { x: number; y: number }>;
  gates: Array<[number, number]>;
  adj: number[][];
}

function buildUniverse(f: MapFile): Universe {
  const index = new Map<number, number>();
  const systems = f.systems.map(([id, name, constellationId, regionId, x, y, sec], i) => {
    index.set(id, i);
    return { i, id, name, constellationId, regionId, x, y, sec };
  });
  const adj: number[][] = systems.map(() => []);
  const gates: Array<[number, number]> = [];
  for (const [a, b] of f.gates) {
    const ia = index.get(a)!;
    const ib = index.get(b)!;
    adj[ia].push(ib);
    adj[ib].push(ia);
    gates.push([ia, ib]);
  }
  const regionCenter = new Map<number, { x: number; y: number }>();
  const sums = new Map<number, { x: number; y: number; n: number }>();
  for (const s of systems) {
    const t = sums.get(s.regionId) ?? { x: 0, y: 0, n: 0 };
    t.x += s.x;
    t.y += s.y;
    t.n++;
    sums.set(s.regionId, t);
  }
  sums.forEach((t, id) => regionCenter.set(id, { x: t.x / t.n, y: t.y / t.n }));
  return {
    sdeBuild: f.sdeBuild,
    systems,
    byName: new Map(systems.map((s) => [s.name.toLowerCase(), s])),
    regionName: new Map(f.regions.map((r) => [r.id, r.name])),
    regionByName: new Map(f.regions.map((r) => [r.name, r.id])),
    constName: new Map(f.constellations.map((c) => [c.id, c.name])),
    constByName: new Map(f.constellations.map((c) => [c.name, c.id])),
    regionCenter,
    gates,
    adj,
  };
}

/** Jumps from one system to every other (gates only). */
function jumpsFrom(u: Universe, from: number): Int32Array {
  const dist = new Int32Array(u.systems.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    for (const n of u.adj[cur]) {
      if (dist[n] === -1) {
        dist[n] = dist[cur] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/** Systems within `n` jumps: the neighbourhood to zoom to. */
function around(u: Universe, from: number, n: number): number[] {
  const d = jumpsFrom(u, from);
  return u.systems.filter((s) => d[s.i] >= 0 && d[s.i] <= n).map((s) => s.i);
}

const isLowSec = (sec: number) => sec >= 0.05 && sec < 0.45;
const secLabel = (sec: number) => (sec > 0 && sec < 0.05 ? 0.1 : Math.round(sec * 10) / 10).toFixed(1);
function secColor(sec: number) {
  const s = Math.round(sec * 10) / 10;
  if (s >= 0.9) return "#4fc3f7";
  if (s >= 0.7) return "#66bb6a";
  if (s >= 0.5) return "#d4e157";
  if (s >= 0.1 || sec >= 0.05) return "#ffa726";
  return "#ef5350";
}

// Which systems each site can spawn in: "core" = the constellation big Cytoserocin sites concentrate in.
type Presence = Map<number, "core" | "site">;

interface SiteSpot {
  site: GasSite;
  systems: number[];
}

function gasPresence(u: Universe) {
  const byGas = new Map<number, Presence>();
  const spots = new Map<GasSite, SiteSpot>();
  for (const site of GAS_SITES) {
    const presence = byGas.get(site.typeId) ?? new Map();
    byGas.set(site.typeId, presence);
    const regionIds = new Set(site.regions.map((r) => u.regionByName.get(r)).filter((r): r is number => r != null));
    const coreId = site.constellation ? u.constByName.get(site.constellation) : undefined;
    const list: number[] = [];
    for (const s of u.systems) {
      if (!regionIds.has(s.regionId)) continue;
      if (site.security === "low" && !isLowSec(s.sec)) continue;
      list.push(s.i);
      const core = coreId != null && s.constellationId === coreId;
      if (core) presence.set(s.i, "core");
      else if (!presence.has(s.i)) presence.set(s.i, "site");
    }
    spots.set(site, { site, systems: list });
  }
  return { byGas, spots };
}

// --- helpers ----------------------------------------------------------------------------------------------------

const HOME_KEY = "eve-gas-map-home";
const DEFAULT_HOME = "B6-XE8";
const gasName = (g: BoosterGas) => typeOf(g.typeId)?.name ?? `${g.flavor} ${g.family}`;
const familyLabel: Record<GasFamily, string> = { mykoserocin: "Mykoserocin", cytoserocin: "Cytoserocin" };
const isk = (v: number | null | undefined) => (v == null ? "—" : formatISKCompact(v));
const jumpsLabel = (j: number | null | undefined) => (j == null || j < 0 ? "нет пути" : j === 0 ? "здесь" : `${j} прыж.`);

/** Formulas that eat this gas, by name. */
function usedIn(typeId: number) {
  return REACTION_DATA.formulas.filter((f) => f.materials.some((m) => m.typeId === typeId)).map((f) => f.name.replace(/ Reaction Formula$/, ""));
}

// --- canvas map -------------------------------------------------------------------------------------------------

interface View {
  k: number;
  tx: number;
  ty: number;
}

function GalaxyMap({
  u,
  presence,
  allGas,
  color,
  home,
  selected,
  onSelect,
  focus,
}: {
  u: Universe;
  presence: Presence | null;
  allGas: Map<number, string[]>;
  color: string | null;
  home: Sys | null;
  selected: Sys | null;
  onSelect: (s: Sys | null) => void;
  focus: { systems: number[]; nonce: number } | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const size = useRef({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ s: Sys; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const frame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  // Until the user pans or zooms, every resize re-fits the whole map (the first size is often not final yet).
  const touched = useRef(false);

  const fit = (idx: number[]) => {
    if (!idx.length || !size.current.w) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of idx) {
      const s = u.systems[i];
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
      y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }
    const pad = 40;
    const k = Math.min(
      (size.current.w - pad * 2) / Math.max(x1 - x0, 20),
      (size.current.h - pad * 2) / Math.max(y1 - y0, 20),
      40,
    );
    view.current = { k, tx: size.current.w / 2 - ((x0 + x1) / 2) * k, ty: size.current.h / 2 - ((y0 + y1) / 2) * k };
    drawRef.current();
  };

  const all = useMemo(() => u.systems.map((s) => s.i), [u]);

  drawRef.current = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size.current;
    const { k, tx, ty } = view.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sx = (x: number) => x * k + tx;
    const sy = (y: number) => y * k + ty;
    const fg = getComputedStyle(c).color;

    // gates
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148,163,184,0.14)";
    ctx.beginPath();
    for (const [a, b] of u.gates) {
      const A = u.systems[a];
      const B = u.systems[b];
      ctx.moveTo(sx(A.x), sy(A.y));
      ctx.lineTo(sx(B.x), sy(B.y));
    }
    ctx.stroke();

    const r = Math.max(1.2, Math.min(5, 0.9 * Math.sqrt(k)));
    const visible = (s: Sys) => {
      const x = sx(s.x), y = sy(s.y);
      return x > -20 && y > -20 && x < w + 20 && y < h + 20;
    };

    // background systems
    for (const s of u.systems) {
      if (!visible(s)) continue;
      const gas = presence ? presence.get(s.i) : allGas.get(s.i);
      if (gas) continue;
      ctx.fillStyle = presence ? "rgba(100,116,139,0.3)" : secColor(s.sec) + "55";
      ctx.fillRect(sx(s.x) - r / 2, sy(s.y) - r / 2, r, r);
    }
    // gas systems on top
    for (const s of u.systems) {
      if (!visible(s)) continue;
      if (presence) {
        const p = presence.get(s.i);
        if (!p) continue;
        ctx.fillStyle = color!;
        ctx.globalAlpha = p === "core" ? 1 : 0.85;
        ctx.beginPath();
        ctx.arc(sx(s.x), sy(s.y), p === "core" ? r * 2 : r * 1.4, 0, Math.PI * 2);
        ctx.fill();
        if (p === "core") {
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(sx(s.x), sy(s.y), r * 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        const colors = allGas.get(s.i);
        if (!colors) continue;
        const n = colors.length;
        colors.forEach((col, j) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(sx(s.x), sy(s.y));
          ctx.arc(sx(s.x), sy(s.y), r * 1.2, (j / n) * Math.PI * 2, ((j + 1) / n) * Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // labels: regions when zoomed out, systems when zoomed in
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (k < 6) {
      ctx.font = `600 ${Math.max(10, Math.min(14, 9 + k))}px ui-monospace, monospace`;
      u.regionCenter.forEach((p, id) => {
        const x = sx(p.x), y = sy(p.y);
        if (x < 0 || y < 0 || x > w || y > h) return;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(u.regionName.get(id)!, x + 1, y + 1);
        ctx.fillStyle = fg;
        ctx.globalAlpha = 0.8;
        ctx.fillText(u.regionName.get(id)!, x, y);
        ctx.globalAlpha = 1;
      });
    }
    if (k >= 4) {
      ctx.font = `${Math.min(12, 7 + k / 4)}px ui-monospace, monospace`;
      for (const s of u.systems) {
        if (!visible(s)) continue;
        const lit = presence ? presence.has(s.i) : allGas.has(s.i);
        if (k < 10 && !lit) continue;
        ctx.fillStyle = fg;
        ctx.globalAlpha = lit ? 0.9 : 0.45;
        ctx.fillText(s.name, sx(s.x), sy(s.y) - r - 7);
      }
      ctx.globalAlpha = 1;
    }

    const ring = (s: Sys, col: string, label?: string) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(s.x), sy(s.y), r + 6, 0, Math.PI * 2);
      ctx.stroke();
      if (label) {
        ctx.font = "600 11px ui-monospace, monospace";
        ctx.fillStyle = col;
        ctx.fillText(label, sx(s.x), sy(s.y) + r + 16);
      }
    };
    if (home) ring(home, "#e2e8f0", `⌂ ${home.name}`);
    if (selected && selected !== home) ring(selected, "#f472b6", selected.name);
  };

  const redraw = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => drawRef.current());
  };

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      size.current = { w: width, h: height };
      const dpr = window.devicePixelRatio || 1;
      canvas.current!.width = Math.round(width * dpr);
      canvas.current!.height = Math.round(height * dpr);
      if (!touched.current) fit(all);
      else drawRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  useEffect(redraw, [presence, allGas, color, home, selected]);
  useEffect(() => {
    if (!focus) return;
    touched.current = true;
    fit(focus.systems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // wheel zoom around the cursor; native listener so preventDefault works (React's is passive)
  useEffect(() => {
    const c = canvas.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = view.current;
      const f = Math.exp(-e.deltaY * 0.0015);
      const k = Math.min(80, Math.max(0.2, v.k * f));
      touched.current = true;
      view.current = { k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k };
      redraw();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nearest = (mx: number, my: number): Sys | null => {
    const { k, tx, ty } = view.current;
    let best: Sys | null = null;
    let bestD = 14 * 14;
    for (const s of u.systems) {
      const dx = s.x * k + tx - mx;
      const dy = s.y * k + ty - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  };

  const local = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div ref={wrap} className="relative w-full h-full min-h-[420px] overflow-hidden rounded-md bg-[#05070c] border border-border">
      <canvas
        ref={canvas}
        className="absolute inset-0 w-full h-full text-foreground touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const p = local(e);
          drag.current = { x: p.x, y: p.y, moved: false };
        }}
        onPointerMove={(e) => {
          const p = local(e);
          const d = drag.current;
          if (d) {
            const dx = p.x - d.x;
            const dy = p.y - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            if (d.moved) {
              touched.current = true;
              view.current = { ...view.current, tx: view.current.tx + dx, ty: view.current.ty + dy };
              d.x = p.x;
              d.y = p.y;
              setHover(null);
              redraw();
              return;
            }
          }
          const s = nearest(p.x, p.y);
          setHover(s ? { s, x: p.x, y: p.y } : null);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const p = local(e);
            onSelect(nearest(p.x, p.y));
          }
        }}
        onPointerLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-border bg-popover/95 px-2 py-1 text-[11px] font-mono shadow"
          style={{ left: Math.min(hover.x + 12, size.current.w - 180), top: hover.y + 12 }}
        >
          <div className="font-semibold text-foreground">
            {hover.s.name} <span style={{ color: secColor(hover.s.sec) }}>{secLabel(hover.s.sec)}</span>
          </div>
          <div className="text-muted-foreground">
            {u.constName.get(hover.s.constellationId)} · {u.regionName.get(hover.s.regionId)}
          </div>
        </div>
      )}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <Button size="icon" variant="secondary" className="h-7 w-7" title="Вся карта" onClick={() => fit(all)}>
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
        {home && (
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7"
            title="К дому"
            onClick={() => {
              touched.current = true;
              fit(around(u, home.i, 5));
            }}
          >
            <Home className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <div className="absolute left-2 bottom-2 text-[10px] font-mono text-muted-foreground/80 pointer-events-none">
        колесо — зум · тянуть — двигать · клик — система
      </div>
    </div>
  );
}

// --- page -------------------------------------------------------------------------------------------------------

export default function GasMapPage() {
  const mapFile = useQuery<MapFile>({
    queryKey: ["map-data"],
    queryFn: async () => (await import("@shared/data/map.json")).default as unknown as MapFile,
    staleTime: Infinity,
  });
  const market = useQuery<ReactionMarketResponse>({ queryKey: ["/api/reactions/market"] });
  const u = useMemo(() => (mapFile.data ? buildUniverse(mapFile.data) : null), [mapFile.data]);
  const gas = useMemo(() => (u ? gasPresence(u) : null), [u]);

  const [gasId, setGasId] = useState<number | null>(() => BOOSTER_GASES.find((g) => g.family === "mykoserocin" && g.flavor === "Amber")!.typeId);
  const [homeName, setHomeName] = useState(() => {
    try {
      return localStorage.getItem(HOME_KEY) || DEFAULT_HOME;
    } catch {
      return DEFAULT_HOME;
    }
  });
  const [selected, setSelected] = useState<Sys | null>(null);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<{ systems: number[]; nonce: number } | null>(null);
  const focusOn = (systems: number[]) => setFocus({ systems, nonce: Date.now() });

  const home = u?.byName.get(homeName.toLowerCase()) ?? null;
  const dist = useMemo(() => (u && home ? jumpsFrom(u, home.i) : null), [u, home]);
  const current = BOOSTER_GASES.find((g) => g.typeId === gasId) ?? null;

  // "all gases" mode: every system's flavours as pie slices
  const allGas = useMemo(() => {
    const m = new Map<number, string[]>();
    if (!gas) return m;
    for (const g of BOOSTER_GASES) {
      gas.byGas.get(g.typeId)?.forEach((_p, i) => {
        const list = m.get(i) ?? [];
        const col = FLAVORS[g.flavor].color;
        if (!list.includes(col)) list.push(col);
        m.set(i, list);
      });
    }
    return m;
  }, [gas]);

  const price = (typeId: number) => market.data?.prices[typeId] ?? null;

  const setHome = (s: Sys) => {
    setHomeName(s.name);
    try {
      localStorage.setItem(HOME_KEY, s.name);
    } catch {
      /* private mode: home just isn't remembered */
    }
  };

  const doSearch = () => {
    if (!u) return;
    const q = search.trim().toLowerCase();
    if (!q) return;
    const s = u.byName.get(q) ?? u.systems.find((x) => x.name.toLowerCase().startsWith(q));
    if (s) {
      setSelected(s);
      focusOn(around(u, s.i, 5));
      return;
    }
    const regionId = Array.from(u.regionName.entries()).find(([, n]) => n.toLowerCase().startsWith(q))?.[0];
    if (regionId != null) focusOn(u.systems.filter((x) => x.regionId === regionId).map((x) => x.i));
  };

  // nearest system for each gas, from home
  const nearestByGas = useMemo(() => {
    const m = new Map<number, { s: Sys; jumps: number } | null>();
    if (!u || !gas || !dist) return m;
    for (const g of BOOSTER_GASES) {
      let best: { s: Sys; jumps: number } | null = null;
      gas.byGas.get(g.typeId)?.forEach((_p, i) => {
        const d = dist[i];
        if (d >= 0 && (!best || d < best.jumps)) best = { s: u.systems[i], jumps: d };
      });
      m.set(g.typeId, best);
    }
    return m;
  }, [u, gas, dist]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-lg font-semibold tracking-wide text-foreground flex items-center gap-2">
            <MapIcon className="w-5 h-5 text-chart-4" />
            Карта газа
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Где спавнятся бустерные газы, сколько их в сайте и сколько прыжков от дома
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            doSearch();
          }}
        >
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Система или регион"
              className="h-8 w-56 pl-7 font-mono text-xs"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-8 font-mono text-xs">
            Найти
          </Button>
        </form>
      </div>

      {/* gas picker */}
      <Card>
        <CardContent className="p-3 flex flex-col gap-2">
          {(["mykoserocin", "cytoserocin"] as GasFamily[]).map((family) => (
            <div key={family} className="flex flex-wrap items-center gap-1.5">
              <span className="w-28 shrink-0 text-[11px] font-mono text-muted-foreground">
                {familyLabel[family]}
                <span className="block text-[10px] opacity-70">{family === "mykoserocin" ? "хай/лоу/нули, без НПС" : "лоу + нули, урон"}</span>
              </span>
              {BOOSTER_GASES.filter((g) => g.family === family).map((g) => {
                const on = g.typeId === gasId;
                const near = nearestByGas.get(g.typeId);
                return (
                  <button
                    key={g.typeId}
                    onClick={() => setGasId(on ? null : g.typeId)}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-mono transition-colors ${
                      on ? "border-foreground/60 bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                    title={`${gasName(g)} → ${FLAVORS[g.flavor].booster}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: FLAVORS[g.flavor].color }} />
                    {g.flavor}
                    {near && <span className="opacity-60">{near.jumps}j</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <span>«Nj» — прыжков от {home?.name ?? "дома"} до ближайшей системы, где может быть этот газ.</span>
            {gasId != null && (
              <button className="underline hover:text-foreground" onClick={() => setGasId(null)}>
                показать все газы сразу
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="h-[70vh]">
          {u && gas ? (
            <GalaxyMap
              u={u}
              presence={gasId != null ? gas.byGas.get(gasId) ?? new Map() : null}
              allGas={allGas}
              color={current ? FLAVORS[current.flavor].color : null}
              home={home}
              selected={selected}
              onSelect={setSelected}
              focus={focus}
            />
          ) : mapFile.error ? (
            <p className="text-xs font-mono text-destructive">Не удалось загрузить карту: {(mapFile.error as Error).message}</p>
          ) : (
            <Skeleton className="w-full h-full" />
          )}
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          {selected && u && gas && (
            <SystemCard
              u={u}
              s={selected}
              jumps={dist ? dist[selected.i] : null}
              isHome={selected === home}
              onHome={() => setHome(selected)}
              gasAt={BOOSTER_GASES.filter((g) => gas.byGas.get(g.typeId)?.has(selected.i)).map((g) => ({
                g,
                core: gas.byGas.get(g.typeId)!.get(selected.i) === "core",
              }))}
              onPickGas={setGasId}
            />
          )}
          {current && u && gas ? (
            <GasCard
              g={current}
              u={u}
              spots={GAS_SITES.filter((s) => s.typeId === current.typeId).map((s) => gas.spots.get(s)!)}
              dist={dist}
              home={home}
              price={price(current.typeId)}
              onFocus={focusOn}
            />
          ) : (
            <Card>
              <CardContent className="p-4 text-xs font-mono text-muted-foreground flex flex-col gap-2">
                <p>Выбери газ сверху. Без выбора карта показывает все бустерные газы, каждая система раскрашена в цвета газов, что могут там появиться.</p>
                <ul className="grid grid-cols-2 gap-1">
                  {Object.entries(FLAVORS).map(([f, v]) => (
                    <li key={f} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />
                      {f} <span className="opacity-60">→ {v.booster}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <FulleriteCard price={price} />

      <p className="text-[10px] font-mono text-muted-foreground">
        Карта и гейты — из SDE {u ? `build ${u.sdeBuild}` : ""}. Где какой газ — CCP не публикует; данные со страницы EVE University «Gas
        cloud harvesting» (ред. 17.11.2026), список Mykoserocin там помечен как неполный. Сайты спавнятся случайно по системам
        региона: подсвечено, где они <i>могут</i> быть, а не где висят сейчас.
      </p>
    </div>
  );
}

function SystemCard({
  u,
  s,
  jumps,
  isHome,
  onHome,
  gasAt,
  onPickGas,
}: {
  u: Universe;
  s: Sys;
  jumps: number | null;
  isHome: boolean;
  onHome: () => void;
  gasAt: Array<{ g: BoosterGas; core: boolean }>;
  onPickGas: (typeId: number) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-2 text-xs font-mono">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {s.name} <span style={{ color: secColor(s.sec) }}>{secLabel(s.sec)}</span>
            </div>
            <div className="text-muted-foreground">
              {u.constName.get(s.constellationId)} · {u.regionName.get(s.regionId)}
            </div>
          </div>
          {isHome ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              <Home className="w-3 h-3 mr-1" />
              дом
            </Badge>
          ) : (
            <Button size="sm" variant="outline" className="h-7 font-mono text-[11px]" onClick={onHome}>
              <Locate className="w-3 h-3 mr-1" />
              Сделать домом
            </Button>
          )}
        </div>
        {!isHome && <div className="text-muted-foreground">От дома: {jumpsLabel(jumps)}</div>}
        {gasAt.length ? (
          <div className="flex flex-wrap gap-1.5">
            {gasAt.map(({ g, core }) => (
              <button
                key={g.typeId}
                onClick={() => onPickGas(g.typeId)}
                className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: FLAVORS[g.flavor].color }} />
                {gasName(g)}
                {core && <span className="text-chart-3">ядро</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">Бустерных газов здесь не спавнится (по известным данным).</div>
        )}
      </CardContent>
    </Card>
  );
}

function GasCard({
  g,
  u,
  spots,
  dist,
  home,
  price,
  onFocus,
}: {
  g: BoosterGas;
  u: Universe;
  spots: SiteSpot[];
  dist: Int32Array | null;
  home: Sys | null;
  price: { sell: number | null; buy: number | null } | null;
  onFocus: (systems: number[]) => void;
}) {
  const volume = typeOf(g.typeId)?.volume ?? 10;
  const unit = price?.sell ?? null;
  const reactions = useMemo(() => usedIn(g.typeId), [g.typeId]);

  // per region: which sites, nearest system from home
  const regions = useMemo(() => {
    const m = new Map<number, { id: number; systems: number[]; sites: GasSite[]; jumps: number; nearest: Sys | null; core: string | null }>();
    for (const sp of spots) {
      for (const i of sp.systems) {
        const s = u.systems[i];
        const r = m.get(s.regionId) ?? { id: s.regionId, systems: [], sites: [], jumps: Infinity, nearest: null, core: null };
        if (!r.systems.includes(i)) r.systems.push(i);
        if (!r.sites.includes(sp.site)) r.sites.push(sp.site);
        if (sp.site.constellation) r.core = sp.site.constellation;
        const d = dist ? dist[i] : -1;
        if (d >= 0 && d < r.jumps) {
          r.jumps = d;
          r.nearest = s;
        }
        m.set(s.regionId, r);
      }
    }
    return Array.from(m.values()).sort((a, b) => a.jumps - b.jumps);
  }, [spots, u, dist]);

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-3 text-xs font-mono">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: FLAVORS[g.flavor].color }} />
              {gasName(g)}
            </div>
            <div className="text-muted-foreground">
              бустер {FLAVORS[g.flavor].booster} · {volume} м³/ед.
            </div>
          </div>
          <div className="text-right">
            <div className="text-foreground">{isk(unit)}</div>
            <div className="text-muted-foreground">{unit ? `${isk(unit / volume)}/м³` : "Jita sell"}</div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Сайты</div>
          <table className="w-full">
            <tbody>
              {spots.map(({ site }) => (
                <tr key={site.name} className="border-t border-border/50">
                  <td className="py-1 pr-2">
                    <div className="text-foreground">{site.name}</div>
                    <div className="flex flex-wrap gap-1 mt-0.5 text-[10px] text-muted-foreground">
                      {site.security === "low" && (
                        <span className="flex items-center gap-0.5 text-[#ffa726]">
                          <Shield className="w-3 h-3" />
                          только лоу
                        </span>
                      )}
                      {site.npcs && (
                        <span className="flex items-center gap-0.5 text-destructive">
                          <Skull className="w-3 h-3" />
                          НПС
                        </span>
                      )}
                      {site.damage && (
                        <span className="flex items-center gap-0.5 text-chart-3">
                          <Zap className="w-3 h-3" />
                          {site.damage}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">{formatNumber(site.units)} ед.</td>
                  <td className="py-1 text-right whitespace-nowrap text-chart-2">{unit ? isk(site.units * unit) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Регионы {home ? `· по прыжкам от ${home.name}` : ""}
          </div>
          <div className="flex flex-col">
            {regions.map((r) => (
              <button
                key={r.id}
                onClick={() => onFocus(r.systems)}
                className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                title="Показать на карте"
              >
                <span className="min-w-0">
                  <span className="text-foreground">{u.regionName.get(r.id)}</span>
                  {r.core && <span className="text-chart-3"> · ядро {r.core}</span>}
                  <span className="block text-[10px] text-muted-foreground truncate">
                    {r.sites.map((s) => s.name.replace(" Nebula", "")).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-foreground">{jumpsLabel(Number.isFinite(r.jumps) ? r.jumps : null)}</span>
                  {r.nearest && r.jumps > 0 && <span className="block text-[10px] text-muted-foreground">{r.nearest.name}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        {reactions.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Идёт в реакции</div>
            <div className="flex flex-wrap gap-1">
              {reactions.map((n) => (
                <Badge key={n} variant="outline" className="font-mono text-[10px]">
                  {n}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FulleriteCard({ price }: { price: (typeId: number) => { sell: number | null; buy: number | null } | null }) {
  const idByName = useMemo(
    () => new Map(Object.entries(REACTION_DATA.types).map(([id, t]) => [t.name, Number(id)])),
    [],
  );
  const cell = (name: string) => {
    const id = idByName.get(name);
    const p = id != null ? price(id)?.sell ?? null : null;
    const vol = id != null ? typeOf(id)?.volume ?? null : null;
    return (
      <span className="whitespace-nowrap">
        <span className="text-foreground">{name.replace("Fullerite-", "")}</span>{" "}
        <span className="text-muted-foreground">
          {isk(p)}
          {p && vol ? ` · ${isk(p / vol)}/м³` : ""}
        </span>
      </span>
    );
  };
  return (
    <Card>
      <CardContent className="p-4 text-xs font-mono flex flex-col gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">Fullerite — только вормхолы</div>
          <div className="text-muted-foreground">
            Сайты висят в любой системе своего класса, через ~15–20 минут после входа прилетают слиперы.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground text-left">
                <th className="py-1 pr-2 font-normal">Сайт</th>
                <th className="py-1 pr-2 font-normal">Классы</th>
                <th className="py-1 pr-2 font-normal">Основной газ (Jita)</th>
                <th className="py-1 font-normal">Второй газ</th>
              </tr>
            </thead>
            <tbody>
              {FULLERITE_SITES.map((s) => (
                <tr key={s.name} className="border-t border-border/50">
                  <td className="py-1 pr-2 text-foreground">{s.name}</td>
                  <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{s.classes}</td>
                  <td className="py-1 pr-2">{cell(s.primary)}</td>
                  <td className="py-1">{cell(s.secondary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
