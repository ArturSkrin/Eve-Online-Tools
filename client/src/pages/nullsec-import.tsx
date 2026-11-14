import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CharacterFees } from "@/components/character-fees";
import { SortHeader, nextSort, type SortDir } from "@/components/sort-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatISKCompact, formatNumber, timeAgo } from "@/lib/format";
import { AlertTriangle, Plus, RefreshCw, Ship, Truck } from "lucide-react";
import type { ImportResponse, MarketStructureSummary, MeResponse } from "@shared/schema";
import {
  DEFAULT_IMPORT_SETTINGS,
  analyzeImport,
  planHaul,
  type ImportResult,
  type ImportSettings,
} from "@shared/imports";

const SETTINGS_KEY = "eve-nullsec-import";

function load(): { settings: ImportSettings; structureId?: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { settings: { ...DEFAULT_IMPORT_SETTINGS, ...saved.settings }, structureId: saved.structureId };
  } catch {
    return { settings: DEFAULT_IMPORT_SETTINGS };
  }
}

const isk = (v: number | null | undefined) =>
  v == null ? "—" : `${v < 0 ? "−" : ""}${formatISKCompact(Math.abs(v))}`;
const signClass = (v: number | null) => (v == null ? "text-muted-foreground" : v >= 0 ? "text-chart-2" : "text-destructive");
const qty = (v: number | null) => (v == null ? "—" : v >= 10 ? formatNumber(v) : v.toFixed(1));

type SortKey = "name" | "iskPerDay" | "profit" | "margin" | "iskPerM3" | "sold" | "stock";
const SORT_VALUE: Record<SortKey, (r: ImportResult) => number | string | null> = {
  name: (r) => r.row.name,
  iskPerDay: (r) => r.iskPerDay,
  profit: (r) => r.profit,
  margin: (r) => r.marginPercent,
  iskPerM3: (r) => r.iskPerM3,
  sold: (r) => r.soldPerDay,
  stock: (r) => r.daysOfStock,
};

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          step={step}
          min={0}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-8 font-mono text-sm"
        />
        {suffix && <span className="font-mono text-xs text-muted-foreground shrink-0">{suffix}</span>}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground leading-snug">{hint}</div>}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex rounded-md border p-0.5 gap-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`flex-1 rounded px-2 py-1 font-mono text-[11px] transition-colors ${
              value === o.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StructurePicker({
  structures,
  value,
  onChange,
}: {
  structures: MarketStructureSummary[];
  value: number | undefined;
  onChange: (id: number) => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [id, setId] = useState("");
  const add = useMutation({
    mutationFn: () => apiRequest("POST", "/api/nullsec/structures", { structureId: Number(id.trim()) }).then((r) => r.json()),
    onSuccess: (list: MarketStructureSummary[]) => {
      queryClient.setQueryData(["/api/nullsec/structures"], list);
      const added = list.find((s) => s.structureId === Number(id.trim()));
      if (added) onChange(added.structureId);
      setAdding(false);
      setId("");
    },
    onError: (err: Error) => toast({ title: "Структура не добавлена", description: err.message, variant: "destructive" }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {structures.length > 0 && (
        <Select value={value ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))}>
          <SelectTrigger className="w-80 h-9 font-mono text-xs" data-testid="select-structure">
            <SelectValue placeholder="Структура" />
          </SelectTrigger>
          <SelectContent>
            {structures.map((s) => (
              <SelectItem key={s.structureId} value={String(s.structureId)} className="font-mono text-xs">
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {adding ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="ID структуры, 1035…"
            className="h-9 w-56 font-mono text-xs"
            onKeyDown={(e) => e.key === "Enter" && add.mutate()}
          />
          <Button size="sm" className="h-9" onClick={() => add.mutate()} disabled={add.isPending || !id.trim()}>
            Добавить
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setAdding(false)}>
            Отмена
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-9 font-mono text-xs" onClick={() => setAdding(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> По ID
        </Button>
      )}
    </div>
  );
}

export default function NullsecImportPage() {
  const initial = useMemo(load, []);
  const [settings, setSettings] = useState<ImportSettings>(initial.settings);
  const [structureId, setStructureId] = useState<number | undefined>(initial.structureId);
  const [search, setSearch] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [hideThin, setHideThin] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "iskPerDay", dir: "desc" });
  const set = <K extends keyof ImportSettings>(k: K, v: ImportSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const { toast } = useToast();

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ settings, structureId }));
    } catch {
      // private mode: settings are just not remembered
    }
  }, [settings, structureId]);

  const me = useQuery<MeResponse>({ queryKey: ["/api/me"] });
  const loggedIn = (me.data?.characters.length ?? 0) > 0;
  const structures = useQuery<MarketStructureSummary[]>({
    queryKey: ["/api/nullsec/structures"],
    queryFn: () => apiRequest("GET", "/api/nullsec/structures").then((r) => r.json()),
    enabled: loggedIn,
  });
  useEffect(() => {
    const list = structures.data ?? [];
    if (list.length && !list.some((s) => s.structureId === structureId)) setStructureId(list[0].structureId);
  }, [structures.data, structureId]);

  const data = useQuery<ImportResponse>({
    queryKey: ["/api/nullsec/import", structureId],
    queryFn: () => apiRequest("GET", `/api/nullsec/import?structureId=${structureId}`).then((r) => r.json()),
    enabled: !!structureId,
    // history and item volumes arrive in the background after a snapshot: poll until they are all in
    refetchInterval: (q) => {
      const c = q.state.data?.historyCoverage;
      return !c || c.withHistory < c.total ? 20_000 : 10 * 60_000;
    },
  });

  const refresh = useMutation({
    mutationFn: () => apiRequest("POST", `/api/nullsec/structures/${structureId}/refresh`).then((r) => r.json()),
    onSuccess: (r: { started: boolean }) => {
      if (!r.started) toast({ title: "Обновляли меньше 5 минут назад", description: "ESI отдаёт рынок структуры раз в 5 минут." });
      queryClient.invalidateQueries({ queryKey: ["/api/nullsec/import"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nullsec/structures"] });
    },
    onError: (err: Error) => toast({ title: "Не обновилось", description: err.message, variant: "destructive" }),
  });

  const results = useMemo(() => (data.data?.rows ?? []).map((r) => analyzeImport(r, settings)), [data.data, settings]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const value = SORT_VALUE[sort.key];
    const sign = sort.dir === "asc" ? 1 : -1;
    return results
      .filter((r) => !q || r.row.name.toLowerCase().includes(q))
      .filter((r) => !onlyEmpty || r.outOfStock)
      .filter((r) => !hideThin || !r.thin)
      .filter((r) => !r.notInJita && !r.noHistory && (r.soldPerDay ?? 0) > 0)
      .sort((a, b) => {
        const x = value(a);
        const y = value(b);
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
        return typeof x === "string" ? sign * x.localeCompare(y as string) : sign * (x - (y as number));
      })
      .slice(0, 300);
  }, [results, search, onlyEmpty, hideThin, sort]);

  const haul = useMemo(() => planHaul(results.filter((r) => !hideThin || !r.thin), settings), [results, settings, hideThin]);
  const st = data.data?.structure ?? structures.data?.find((s) => s.structureId === structureId);
  const cov = data.data?.historyCoverage;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-lg font-semibold tracking-wide text-foreground flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            Импорт в нули
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Что везти из Jita домой: дефицит, наценка и сколько реально покупают в регионе
          </p>
        </div>
        {loggedIn && (
          <StructurePicker structures={structures.data ?? []} value={structureId} onChange={setStructureId} />
        )}
      </div>

      {!loggedIn && !me.isLoading && (
        <Card>
          <CardContent className="p-8 text-center text-sm font-mono text-muted-foreground">
            <Link href="/profit" className="text-primary hover:underline">
              Войдите персонажем
            </Link>{" "}
            с доступом к рынку вашей структуры.
          </CardContent>
        </Card>
      )}

      {loggedIn && structures.data && structures.data.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm font-mono text-muted-foreground space-y-2">
            <p>Пока ни одной структуры. Они находятся сами по вашим сделкам и работам в цитаделях после синхронизации кошелька.</p>
            <p>
              Если не нашлась: добавьте по ID («По ID» справа сверху). Персонаж должен иметь доступ к рынку структуры и
              войти заново после включения новых прав ESI (structure_markets, read_structures).
            </p>
          </CardContent>
        </Card>
      )}

      {st && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-muted-foreground">
          <span className="text-foreground">{st.systemName}</span>
          <span>· {st.regionName}</span>
          {st.lastError ? (
            <span className="text-destructive">· снимок не удался</span>
          ) : st.orderCount != null ? (
            <span>
              · {formatNumber(st.orderCount)} ордеров{st.lastSnapshotAt ? `, стакан ${timeAgo(st.lastSnapshotAt)}` : ""}
            </span>
          ) : (
            <span>· снимка ещё нет</span>
          )}
          {data.data?.jitaUpdatedAt && <span>· Jita {timeAgo(data.data.jitaUpdatedAt)}</span>}
          {cov && cov.withHistory < cov.total && (
            <span className="text-chart-3">
              · история региона {formatNumber(cov.withHistory)}/{formatNumber(cov.total)}, догружается
            </span>
          )}
          {st.characterName && <span>· читает {st.characterName}</span>}
          <Button size="sm" variant="outline" className="h-7 font-mono text-xs ml-1" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={`w-3 h-3 mr-1 ${refresh.isPending ? "animate-spin" : ""}`} /> Обновить стакан
          </Button>
        </div>
      )}
      {st?.lastError && (
        <p className="flex items-start gap-2 text-[11px] font-mono text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {st.lastError}
        </p>
      )}

      {structureId && (
        <Card>
          <CardContent className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <NumberField label="Доставка, ISK/м³" value={settings.freightPerM3} step={50} onChange={(v) => set("freightPerM3", v)} hint="Тариф JF-сервиса Jita → дом" />
              <NumberField label="От залога" value={settings.collateralPct} step={0.1} onChange={(v) => set("collateralPct", v)} suffix="%" />
              <NumberField label="Брокер структуры" value={settings.structureBroker} step={0.1} onChange={(v) => set("structureBroker", v)} suffix="%" hint="Ставит владелец, видно в окне продажи" />
              <NumberField label="Доля рынка" value={settings.marketShare} step={5} onChange={(v) => set("marketShare", Math.min(100, v))} suffix="%" hint="от продаж региона в сутки" />
              <div className="col-span-2">
                <Segmented
                  label="Покупка в Jita"
                  value={settings.jitaBuy}
                  options={[
                    { id: "sell", label: "сразу" },
                    { id: "buy", label: "бай-ордером" },
                  ]}
                  onChange={(v) => set("jitaBuy", v)}
                />
              </div>
              <div className="col-span-2">
                <Segmented
                  label="Продажа дома"
                  value={settings.localSell}
                  options={[
                    { id: "sell", label: "селл-ордером" },
                    { id: "buy", label: "в бай-ордер" },
                  ]}
                  onChange={(v) => set("localSell", v)}
                />
              </div>
              {settings.localSell === "sell" && (
                <div className="col-span-2">
                  <Segmented
                    label="Цена дома"
                    value={settings.localPricing}
                    options={[
                      { id: "traded", label: "по реальным сделкам" },
                      { id: "ask", label: "по текущему селлу" },
                    ]}
                    onChange={(v) => set("localPricing", v)}
                  />
                </div>
              )}
            </div>
            <div className="space-y-3">
              <CharacterFees
                onApply={(f) => {
                  if (f.salesTax != null) set("salesTax", f.salesTax);
                  if (f.brokerFee != null) set("jitaBroker", f.brokerFee);
                }}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Налог с продаж" value={settings.salesTax} step={0.1} onChange={(v) => set("salesTax", v)} suffix="%" />
                <NumberField label="Брокер Jita" value={settings.jitaBroker} step={0.1} onChange={(v) => set("jitaBroker", v)} suffix="%" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Haul plan */}
      {haul.lines.length > 0 && (
        <Card className="border-chart-2/40">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Ship className="w-3.5 h-3.5" /> Рейс: что везти
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <NumberField label="Трюм" value={settings.haulCapacity} step={10000} onChange={(v) => set("haulCapacity", v)} suffix="м³" />
                </div>
                <div className="w-36">
                  <NumberField label="Лимит залога" value={settings.haulCollateral / 1e9} step={1} onChange={(v) => set("haulCollateral", v * 1e9)} suffix="B" />
                </div>
                <div className="w-24">
                  <NumberField label="Дней продаж" value={settings.haulDays} onChange={(v) => set("haulDays", Math.max(1, v))} />
                </div>
              </div>
            </div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 font-mono">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Прибыль рейса</div>
                <div className="text-xl font-semibold text-chart-2">{isk(haul.profit)} ISK</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Вложить</div>
                <div className="text-xl font-semibold text-foreground">{isk(haul.cost)} ISK</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Объём</div>
                <div className="text-xl font-semibold text-foreground">
                  {formatNumber(haul.m3)} <span className="text-sm text-muted-foreground">/ {formatNumber(settings.haulCapacity)} м³</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Залог</div>
                <div className="text-xl font-semibold text-foreground">{isk(haul.collateral)}</div>
              </div>
            </div>
            <div className="max-h-64 overflow-auto rounded border">
              <table className="w-full font-mono text-xs">
                <tbody>
                  {haul.lines.map((l) => (
                    <tr key={l.r.row.typeId} className="border-b last:border-0">
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <img src={`https://images.evetech.net/types/${l.r.row.typeId}/icon?size=32`} alt="" className="w-4 h-4" />
                          <span className="text-foreground">{l.r.row.name}</span>
                          {l.r.outOfStock && <Badge variant="outline" className="h-4 px-1 text-[9px] text-chart-2 border-chart-2/40">дефицит</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right">×{formatNumber(l.quantity)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{formatNumber(l.m3)} м³</td>
                      <td className="px-3 py-1.5 text-right text-chart-2">{isk(l.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {structureId && (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по предмету"
            className="h-9 w-full sm:w-96 font-mono text-xs"
          />
          <label className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
            только дефицит (нет в продаже)
          </label>
          <label className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={hideThin} onChange={(e) => setHideThin(e.target.checked)} />
            скрыть редко торгуемое
          </label>
        </div>
      )}

      {data.isLoading && structureId && <Skeleton className="h-96 w-full" />}
      {data.error && <p className="text-xs font-mono text-destructive">{(data.error as Error).message}</p>}

      {data.data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                  <SortHeader id="name" label="Предмет" align="left" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k, k === "name" ? "asc" : "desc"))} />
                  <SortHeader id="iskPerDay" label="ISK/сутки" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} title="Прибыль со штуки × ваша доля продаж региона в сутки" />
                  <SortHeader id="profit" label="Прибыль/шт" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
                  <SortHeader id="margin" label="Наценка" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} title="Прибыль / (Jita + доставка)" />
                  <th className="text-right font-normal px-3 py-2">Дома / Jita+доставка</th>
                  <SortHeader id="iskPerM3" label="ISK/м³" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} title="Что выгоднее класть во фрейтер" />
                  <SortHeader id="sold" label="Продают/сутки" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} title="Продажи в регионе, среднее за 30 дней" />
                  <SortHeader id="stock" label="Запас, дней" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k, "asc"))} title="Сколько дней хватит того, что уже лежит дома" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.row.typeId} className="border-b hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-[15rem]">
                        <img src={`https://images.evetech.net/types/${r.row.typeId}/icon?size=32`} alt="" className="w-5 h-5" />
                        <span className="text-foreground">{r.row.name}</span>
                        {r.outOfStock && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] text-chart-2 border-chart-2/40" title="Дома не продаётся, а в регионе покупают: цену ставите вы">
                            дефицит
                          </Badge>
                        )}
                        {r.askAboveTrades && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] text-chart-3 border-chart-3/40" title={`Дома выставлено по ${isk(r.row.local.sellMin)}, а покупали по ${isk(r.row.region?.highMedian7)}`}>
                            цена ↓
                          </Badge>
                        )}
                        {r.thin && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground" title={`Сделки были ${r.row.region?.tradeDays30} из 30 дней`}>
                            редко
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${signClass(r.iskPerDay)}`}>{isk(r.iskPerDay)}</td>
                    <td className={`px-3 py-2 text-right ${signClass(r.profit)}`}>{isk(r.profit)}</td>
                    <td className={`px-3 py-2 text-right ${signClass(r.marginPercent)}`}>
                      {r.marginPercent == null ? "—" : `${r.marginPercent.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap" title={`Jita ${isk(r.jitaCost)} + доставка ${isk(r.freight)} (${r.row.volume ?? "?"} м³)`}>
                      <span className="text-foreground">{isk(r.localPrice)}</span> / {isk(r.landed)}
                    </td>
                    <td className={`px-3 py-2 text-right ${signClass(r.iskPerM3)}`}>{isk(r.iskPerM3)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{qty(r.soldPerDay)}</td>
                    <td className={`px-3 py-2 text-right ${r.daysOfStock != null && r.daysOfStock < 3 ? "text-chart-2" : "text-muted-foreground"}`}>
                      {r.outOfStock ? "0" : r.daysOfStock == null ? "—" : r.daysOfStock >= 100 ? "100+" : r.daysOfStock.toFixed(1)}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      {data.data.rows.length === 0 ? "Снимка стакана ещё нет: нажмите «Обновить стакан»." : "Ничего не подходит под фильтры."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        Продажи в сутки: история рынка региона за 30 дней. В суверенных нулях NPC-станций нет, так что это сделки в
        цитаделях региона. Цена дома: меньшее из текущего селла и того, по чему реально покупали за неделю; если дома
        пусто, берётся цена сделок. Jita + доставка: лучший селл в Jita, ISK/м³ доставки по упакованному объёму и
        процент от залога. Показаны 300 лучших строк по выбранной сортировке.
      </p>
    </div>
  );
}
