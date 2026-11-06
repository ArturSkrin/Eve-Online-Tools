import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CharacterFees } from "@/components/character-fees";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatISKCompact, formatNumber, timeAgo } from "@/lib/format";
import { AlertTriangle, ChevronDown, ChevronRight, Cloud, FlaskConical, Fuel, RefreshCw, Repeat } from "lucide-react";
import type { ReactionMarketResponse } from "@shared/schema";
import {
  CATEGORIES,
  DEFAULT_SCANNER_SETTINGS,
  REACTION_DATA,
  analyzeReaction,
  type Category,
  type ReactionResult,
  type ScannerSettings,
} from "@shared/reactions";
import { formatDuration } from "@shared/skills";

const SETTINGS_KEY = "eve-reaction-scanner";

function loadSettings(): { settings: ScannerSettings; slots: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { settings: { ...DEFAULT_SCANNER_SETTINGS, ...saved.settings }, slots: saved.slots ?? 3 };
  } catch {
    return { settings: DEFAULT_SCANNER_SETTINGS, slots: 3 };
  }
}

const isk = (v: number | null) => (v == null ? "—" : `${v < 0 ? "−" : ""}${formatISKCompact(Math.abs(v))}`);
const signClass = (v: number | null) => (v == null ? "text-muted-foreground" : v >= 0 ? "text-chart-2" : "text-destructive");

type SortKey = "iskPerDay" | "margin" | "vsInputs";
const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "iskPerDay", label: "ISK в день" },
  { id: "margin", label: "Маржа" },
  { id: "vsInputs", label: "Против продажи сырья" },
];

/**
 * Give each slot to the formula that adds the most ISK per day, knowing that a second slot on the same
 * product only pays while your share of its market is not full yet.
 */
function planSlots(results: ReactionResult[], slots: number, share: number) {
  const usable = results.filter((r) => r.profit != null && r.profit > 0);
  const assigned = new Map<number, number>();
  const gain = (r: ReactionResult, k: number) => {
    const cap = r.marketPerDay == null ? Infinity : (r.marketPerDay * share) / 100;
    const sold = (n: number) => Math.min(r.unitsPerDay * n, cap);
    return (r.profit! / r.product.quantity) * (sold(k + 1) - sold(k));
  };
  for (let i = 0; i < slots; i++) {
    let best: ReactionResult | null = null;
    let bestGain = 0;
    for (const r of usable) {
      const g = gain(r, assigned.get(r.formula.blueprintId) ?? 0);
      if (g > bestGain) {
        bestGain = g;
        best = r;
      }
    }
    if (!best) break;
    assigned.set(best.formula.blueprintId, (assigned.get(best.formula.blueprintId) ?? 0) + 1);
  }
  const rows = usable
    .filter((r) => assigned.has(r.formula.blueprintId))
    .map((r) => {
      const n = assigned.get(r.formula.blueprintId)!;
      let total = 0;
      for (let k = 0; k < n; k++) total += gain(r, k);
      return { r, slots: n, iskPerDay: total };
    })
    .sort((a, b) => b.iskPerDay - a.iskPerDay);
  return { rows, total: rows.reduce((s, x) => s + x.iskPerDay, 0), used: rows.reduce((s, x) => s + x.slots, 0) };
}

function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
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

function Details({ r }: { r: ReactionResult }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] p-4 bg-muted/30">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
            <th className="text-left font-normal pb-1.5">Сырьё за запуск</th>
            <th className="text-right font-normal pb-1.5">Кол-во</th>
            <th className="text-right font-normal pb-1.5">Цена</th>
            <th className="text-right font-normal pb-1.5">Итого</th>
          </tr>
        </thead>
        <tbody>
          {r.inputs.map((i) => (
            <tr key={i.typeId} className="border-t border-border/50">
              <td className="py-1.5 pr-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <img src={`https://images.evetech.net/types/${i.typeId}/icon?size=32`} alt="" className="w-4 h-4" />
                  <span className="truncate text-foreground">{i.name}</span>
                  {i.isGas && <Cloud className="w-3 h-3 text-primary shrink-0" aria-label="газ" />}
                  {i.isFuel && <Fuel className="w-3 h-3 text-muted-foreground shrink-0" aria-label="топливо" />}
                  {i.madeBy && (
                    <span className="text-[10px] text-chart-4 shrink-0" title="Это сырьё тоже можно сварить: найдите его в списке">
                      <Repeat className="inline w-3 h-3 -mt-0.5" /> варится
                    </span>
                  )}
                </div>
              </td>
              <td className="text-right">{formatNumber(i.quantity)}</td>
              <td className="text-right">{isk(i.unitPrice)}</td>
              <td className="text-right">{isk(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1.5 font-mono text-xs">
        <Row label="Сырьё" value={isk(r.inputCost)} />
        <Row label="Запуск (EIV × индекс + налоги)" value={isk(r.jobCost)} />
        <Row label={`Выход: ${formatNumber(r.product.quantity)} шт. после налогов`} value={isk(r.outputValue)} />
        <div className="border-t pt-1.5">
          <Row label="Прибыль за запуск" value={isk(r.profit)} className={signClass(r.profit)} />
        </div>
        <Row label="Против продажи сырья" value={isk(r.vsSellingInputs)} className={signClass(r.vsSellingInputs)} />
        <div className="border-t pt-1.5 text-[11px] text-muted-foreground space-y-0.5">
          <div>
            Цикл {formatDuration(r.runSeconds / 60)} · {r.runsPerDay.toFixed(1)} запусков в сутки
          </div>
          <div>
            Слот делает {formatNumber(r.unitsPerDay)} шт./сутки, рынок берёт{" "}
            {r.marketPerDay == null ? "—" : formatNumber(r.marketPerDay)} шт./сутки
          </div>
          {r.iskPerDayUncapped != null && r.volumeLimited && (
            <div className="text-chart-3">Без ограничения рынком было бы {isk(r.iskPerDayUncapped)}/сутки</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={className ?? "text-foreground"}>{value}</span>
    </div>
  );
}

export default function ReactionScannerPage() {
  const initial = useMemo(loadSettings, []);
  const [settings, setSettings] = useState<ScannerSettings>(initial.settings);
  const [slots, setSlots] = useState(initial.slots);
  const [category, setCategory] = useState<Category | "all">("gas");
  const [sort, setSort] = useState<SortKey>("iskPerDay");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const set = <K extends keyof ScannerSettings>(k: K, v: ScannerSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ settings, slots }));
    } catch {
      // private mode: settings just are not remembered
    }
  }, [settings, slots]);

  const market = useQuery<ReactionMarketResponse>({
    queryKey: ["/api/reactions/market"],
    refetchInterval: (q) => (q.state.data?.refreshing || !q.state.data?.pricesUpdatedAt ? 10_000 : 5 * 60_000),
    staleTime: 0,
  });

  // The system cost index comes from ESI: use it until the player types their own.
  const [indexTouched, setIndexTouched] = useState(false);
  useEffect(() => {
    if (!indexTouched && market.data?.costIndex) set("costIndex", market.data.costIndex.reaction);
  }, [market.data?.costIndex, indexTouched]);

  const refresh = useMutation({
    mutationFn: () => apiRequest("POST", "/api/reactions/market/refresh").then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/reactions/market"] }),
  });

  const results = useMemo(
    () => (market.data ? REACTION_DATA.formulas.map((f) => analyzeReaction(f, market.data!, settings)) : []),
    [market.data, settings],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const key = (r: ReactionResult) =>
      sort === "iskPerDay" ? r.iskPerDay : sort === "margin" ? r.marginPercent : r.vsSellingInputs;
    return results
      .filter((r) => category === "all" || r.category === category)
      .filter((r) => !q || r.product.name.toLowerCase().includes(q) || r.inputs.some((i) => i.name.toLowerCase().includes(q)))
      .sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));
  }, [results, category, sort, search]);

  const plan = useMemo(
    () => planSlots(results.filter((r) => category === "all" || r.category === category), slots, settings.marketShare),
    [results, category, slots, settings.marketShare],
  );

  const m = market.data;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-lg font-semibold tracking-wide text-foreground flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-chart-4" />
            Сканер реакций
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Что варить, чтобы заработать больше ISK в день, с учётом того, сколько рынок реально берёт
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          {m?.pricesUpdatedAt ? <span>цены {timeAgo(m.pricesUpdatedAt)}</span> : <span>цены ещё не загружены</span>}
          <span>·</span>
          {m?.volumesUpdatedAt ? <span>объёмы {timeAgo(m.volumesUpdatedAt)}</span> : <span>объёмов нет</span>}
          <span>·</span>
          <span title={`SDE build ${REACTION_DATA.sdeBuild}`}>{REACTION_DATA.formulas.length} формул</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 font-mono text-xs ml-1"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || m?.refreshing}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${m?.refreshing ? "animate-spin" : ""}`} />
            {m?.refreshing ? "Обновляю…" : "Обновить"}
          </Button>
        </div>
      </div>

      {m?.lastError && (
        <p className="flex items-start gap-2 text-[11px] font-mono text-chart-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {m.lastError}. Показаны последние сохранённые цены.
        </p>
      )}
      {market.error && <p className="text-xs font-mono text-destructive">{(market.error as Error).message}</p>}

      {/* Settings */}
      <Card>
        <CardContent className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <NumberField label="ME структуры" value={settings.meBonus} onChange={(v) => set("meBonus", v)} suffix="%" hint="Tatara + T1 риг ≈ 2.4" />
            <NumberField label="TE структуры" value={settings.teBonus} onChange={(v) => set("teBonus", v)} suffix="%" hint="Tatara + риг ≈ 24" />
            <NumberField label="Навык Reactions" value={settings.reactionsSkill} step={1} onChange={(v) => set("reactionsSkill", Math.min(5, Math.round(v)))} hint="−4% времени за уровень" />
            <NumberField label="Слотов реакций" value={slots} step={1} onChange={(v) => setSlots(Math.max(1, Math.round(v)))} hint="1 + Mass Reactions + Adv." />
            <NumberField
              label="Индекс системы"
              value={Math.round(settings.costIndex * 10000) / 100}
              onChange={(v) => {
                setIndexTouched(true);
                set("costIndex", v / 100);
              }}
              suffix="%"
              hint={m?.costIndex ? `${m.costIndex.systemName}: ${(m.costIndex.reaction * 100).toFixed(2)}%` : undefined}
            />
            <NumberField label="Налог структуры" value={settings.facilityTax} onChange={(v) => set("facilityTax", v)} suffix="%" />
            <NumberField label="SCC" value={settings.sccSurcharge} onChange={(v) => set("sccSurcharge", v)} suffix="%" hint="надбавка CCP на работы" />
            <NumberField label="Ваша доля рынка" value={settings.marketShare} step={5} onChange={(v) => set("marketShare", Math.min(100, v))} suffix="%" hint="от суточного объёма продукта" />
            <div className="col-span-2">
              <Segmented
                label="Сырьё"
                value={settings.buyInputs}
                options={[
                  { id: "sell", label: "покупаю сразу" },
                  { id: "buy", label: "бай-ордером" },
                ]}
                onChange={(v) => set("buyInputs", v)}
              />
            </div>
            <div className="col-span-2">
              <Segmented
                label="Продукт"
                value={settings.sellOutput}
                options={[
                  { id: "sell", label: "селл-ордером" },
                  { id: "buy", label: "в бай-ордер" },
                ]}
                onChange={(v) => set("sellOutput", v)}
              />
            </div>
          </div>
          <div className="space-y-3">
            <CharacterFees
              onApply={(f) => {
                if (f.salesTax != null) set("salesTax", f.salesTax);
                if (f.brokerFee != null) set("brokerFee", f.brokerFee);
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Налог с продаж" value={settings.salesTax} onChange={(v) => set("salesTax", v)} suffix="%" />
              <NumberField label="Брокер" value={settings.brokerFee} onChange={(v) => set("brokerFee", v)} suffix="%" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Slot plan */}
      {plan.rows.length > 0 && (
        <Card className="border-chart-2/40">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                План на {slots} слот{slots === 1 ? "" : slots < 5 ? "а" : "ов"}
              </div>
              <div className="font-mono text-lg font-semibold text-chart-2">≈ {isk(plan.total)} ISK/сутки</div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.rows.map(({ r, slots: n, iskPerDay }) => (
                <button
                  key={r.formula.blueprintId}
                  onClick={() => setOpen(r.formula.blueprintId)}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left hover:border-primary/50"
                >
                  <img src={`https://images.evetech.net/types/${r.product.typeId}/icon?size=32`} alt="" className="w-5 h-5" />
                  <span className="font-mono text-xs text-foreground">{r.product.name}</span>
                  {n > 1 && <Badge variant="outline" className="h-4 px-1 text-[9px]">×{n}</Badge>}
                  <span className="font-mono text-[11px] text-chart-2">{isk(iskPerDay)}</span>
                </button>
              ))}
            </div>
            {plan.used < slots && (
              <p className="text-[11px] text-chart-3 mt-2">
                Прибыльных вариантов хватает только на {plan.used} слот(а) в этой категории: рынок больше не возьмёт.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={category} onValueChange={(v) => setCategory(v as Category | "all")}>
          <TabsList>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c.id} value={c.id} className="font-mono text-xs">
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по продукту или сырью"
          className="h-9 w-56 font-mono text-xs"
        />
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mr-1">Сортировка</span>
          {SORTS.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={sort === s.id ? "secondary" : "ghost"}
              className="h-7 font-mono text-[11px]"
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Results */}
      {market.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left font-normal px-3 py-2">Продукт</th>
                  <th className="text-right font-normal px-3 py-2" title="Прибыль в сутки с одного слота, не больше вашей доли рынка">
                    ISK/сутки на слот
                  </th>
                  <th className="text-right font-normal px-3 py-2">Прибыль/запуск</th>
                  <th className="text-right font-normal px-3 py-2">Маржа</th>
                  <th className="text-right font-normal px-3 py-2" title="Выход − запуск − сколько дало бы сырьё, если его просто продать">
                    vs продажи сырья
                  </th>
                  <th className="text-right font-normal px-3 py-2">Вы / рынок в сутки</th>
                  <th className="text-right font-normal px-3 py-2">Цикл</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const isOpen = open === r.formula.blueprintId;
                  return (
                    <Fragment key={r.formula.blueprintId}>
                      <tr
                        className={`border-b cursor-pointer hover:bg-muted/40 ${isOpen ? "bg-muted/40" : ""}`}
                        onClick={() => setOpen(isOpen ? null : r.formula.blueprintId)}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-[15rem]">
                            {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                            <img src={`https://images.evetech.net/types/${r.product.typeId}/icon?size=32`} alt="" className="w-5 h-5" />
                            <span className="text-foreground">{r.product.name}</span>
                            {r.missingPrices.length > 0 && (
                              <span title={`Нет цены: ${r.missingPrices.join(", ")}`}>
                                <AlertTriangle className="w-3 h-3 text-chart-3" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${signClass(r.iskPerDay)}`}>
                          {isk(r.iskPerDay)}
                          {r.volumeLimited && r.iskPerDay != null && r.iskPerDay > 0 && (
                            <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] text-chart-3 border-chart-3/40" title="Слот делает больше, чем рынок возьмёт">
                              рынок
                            </Badge>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right ${signClass(r.profit)}`}>{isk(r.profit)}</td>
                        <td className={`px-3 py-2 text-right ${signClass(r.marginPercent)}`}>
                          {r.marginPercent == null ? "—" : `${r.marginPercent.toFixed(1)}%`}
                        </td>
                        <td className={`px-3 py-2 text-right ${signClass(r.vsSellingInputs)}`}>
                          {isk(r.vsSellingInputs)}
                          {r.vsSellingInputs != null && r.vsSellingInputs < 0 && r.profit != null && (
                            <div className="text-[9px] text-destructive">сырьё дороже</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                          {formatNumber(r.unitsPerDay)} / {r.marketPerDay == null ? "—" : formatNumber(r.marketPerDay)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                          {formatDuration(r.runSeconds / 60)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b">
                          <td colSpan={7} className="p-0">
                            <Details r={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      Ничего не найдено.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        Цены: лучшие ордера в Jita, обновляются раз в 30 минут. Объём: среднее число проданных штук в сутки в The
        Forge за 30 дней. «vs продажи сырья» отвечает на вопрос «варить своё сырьё или продать его как есть»: если
        число отрицательное, сырьё выгоднее продать. Запуск: EIV × (индекс системы + налог структуры + SCC).
        Формулы из SDE от {REACTION_DATA.sdeReleaseDate.slice(0, 10)}.
      </p>
    </div>
  );
}
