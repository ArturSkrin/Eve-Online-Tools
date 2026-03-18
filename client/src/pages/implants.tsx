import { useState, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Factory,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ArrowDown,
  ArrowUp,
  AlertCircle,
  Settings2,
  Cpu,
  Save,
  Info,
  Building2,
  Zap,
  Clock,
  Search,
  FileText,
  CheckCircle,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { STATION_PRESETS_MANUFACTURING, RAPTURE_ALPHA_BLUEPRINT } from "@shared/schema";
import type { ImplantPricesResponse, ImplantItemPrice, ImplantContractsResponse } from "@shared/schema";

const SETTINGS_KEY = "eve-implant-settings";

function fmtISK(v: number) {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
function fmtShort(v: number) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "b";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "m";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return v.toFixed(0);
}

function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

interface MarginResult {
  label: string;
  description: string;
  inputCost: number;
  outputRevenue: number;
  margin: number;
  marginPercent: number;
  isPrimary: boolean;
}

function calcMargins(
  items: ImplantItemPrice[],
  salesTax: number,
  brokerFee: number,
  jobCostOverride: number,
  useOverride: boolean,
  estimatedJobCost: number,
  runs: number,
  contractExtraCost = 0,
): MarginResult[] {
  const inputs = items.filter((i) => i.role === "input");
  const outputs = items.filter((i) => i.role === "output");

  const inputBuyTotal = inputs.reduce((s, i) => s + i.totalBuy, 0);
  const inputSellTotal = inputs.reduce((s, i) => s + i.totalSell, 0);
  const outputBuyTotal = outputs.reduce((s, i) => s + i.totalBuy, 0);
  const outputSellTotal = outputs.reduce((s, i) => s + i.totalSell, 0);

  const jc = (useOverride ? jobCostOverride * runs : estimatedJobCost) + contractExtraCost;

  const taxRate = salesTax / 100;
  const brokerRate = brokerFee / 100;

  const buyOrder = (t: number) => t * (1 + brokerRate);
  const buyInstant = (t: number) => t;
  const sellOrder = (t: number) => t * (1 - taxRate - brokerRate);
  const sellInstant = (t: number) => t * (1 - taxRate);

  const scenarios: MarginResult[] = [
    {
      label: "Buy → Sell",
      description: "Покупать по бай-ордерам → Продавать через сел-ордера",
      inputCost: buyOrder(inputBuyTotal) + jc,
      outputRevenue: sellOrder(outputSellTotal),
      margin: 0, marginPercent: 0, isPrimary: true,
    },
    {
      label: "Buy → Buy",
      description: "Покупать по бай-ордерам → Продавать сразу в бай-ордера",
      inputCost: buyOrder(inputBuyTotal) + jc,
      outputRevenue: sellInstant(outputBuyTotal),
      margin: 0, marginPercent: 0, isPrimary: false,
    },
    {
      label: "Sell → Sell",
      description: "Купить сразу по сел-ордерам → Продавать через сел-ордера",
      inputCost: buyInstant(inputSellTotal) + jc,
      outputRevenue: sellOrder(outputSellTotal),
      margin: 0, marginPercent: 0, isPrimary: false,
    },
    {
      label: "Sell → Buy",
      description: "Купить сразу по сел-ордерам → Продавать сразу в бай-ордера",
      inputCost: buyInstant(inputSellTotal) + jc,
      outputRevenue: sellInstant(outputBuyTotal),
      margin: 0, marginPercent: 0, isPrimary: false,
    },
  ];

  for (const s of scenarios) {
    s.margin = s.outputRevenue - s.inputCost;
    s.marginPercent = s.inputCost > 0 ? (s.margin / s.inputCost) * 100 : 0;
  }
  return scenarios;
}

function ItemRow({ item }: { item: ImplantItemPrice }) {
  const isInput = item.role === "input";
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`row-item-${item.typeId}`}>
      <td className="py-2 px-3">
        <div className="flex items-center gap-2">
          {isInput
            ? <ArrowDown className="w-3 h-3 text-destructive shrink-0" />
            : <ArrowUp className="w-3 h-3 text-chart-2 shrink-0" />}
          <span className="font-mono text-xs text-foreground">{item.name}</span>
        </div>
      </td>
      <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">{item.quantity.toLocaleString()}</td>
      <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">{fmtISK(item.buyPrice)}</td>
      <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">{fmtISK(item.sellPrice)}</td>
      <td className={`py-2 px-3 text-right font-mono text-xs ${isInput ? "text-destructive" : "text-chart-2"}`}>{fmtISK(item.totalBuy)}</td>
      <td className={`py-2 px-3 text-right font-mono text-xs ${isInput ? "text-destructive" : "text-chart-2"}`}>{fmtISK(item.totalSell)}</td>
    </tr>
  );
}

function GroupHeader({ group }: { group: string }) {
  return (
    <tr className="bg-muted/10">
      <td colSpan={6} className="py-1 px-3 font-mono text-[9px] tracking-widest uppercase text-muted-foreground border-b border-border/30">
        {group}
      </td>
    </tr>
  );
}

function MarginCard({ scenario }: { scenario: MarginResult }) {
  const profitable = scenario.margin >= 0;
  return (
    <Card className={`border ${scenario.isPrimary ? "border-primary/40 bg-primary/5" : "border-border"}`} data-testid={`card-margin-${scenario.label.replace(/\s|→/g, "-")}`}>
      <CardHeader className="pb-1 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">{scenario.label}</CardTitle>
          <div className="flex gap-1">
            {scenario.isPrimary && <Badge variant="outline" className="text-[9px] font-mono border-primary text-primary px-1.5 py-0">PRIMARY</Badge>}
            <Badge variant="outline" className={`text-[9px] font-mono px-1.5 py-0 ${profitable ? "border-chart-2 text-chart-2" : "border-destructive text-destructive"}`}>
              {profitable ? "+" : ""}{scenario.marginPercent.toFixed(1)}%
            </Badge>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground font-mono">{scenario.description}</p>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="grid grid-cols-3 gap-3 mt-1">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono mb-0.5">Затраты</p>
            <p className="font-mono text-xs text-destructive">{fmtShort(scenario.inputCost)} ISK</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono mb-0.5">Выручка</p>
            <p className="font-mono text-xs text-chart-2">{fmtShort(scenario.outputRevenue)} ISK</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono mb-0.5">Маржа</p>
            <div className="flex items-center gap-1">
              {profitable
                ? <TrendingUp className="w-3 h-3 text-chart-2" />
                : <TrendingDown className="w-3 h-3 text-destructive" />}
              <p className={`font-mono text-xs font-semibold ${profitable ? "text-chart-2" : "text-destructive"}`}>
                {profitable ? "+" : ""}{fmtShort(scenario.margin)} ISK
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ImplantsPage() {
  const { toast } = useToast();

  const saved = useMemo(() => loadSettings(), []);

  const [runs, setRuns] = useState(1);
  const [stationId, setStationId] = useState<string>(saved?.stationId ?? "default");
  const [me, setMe] = useState<number>(saved?.me ?? 0);
  const [facilityBonus, setFacilityBonus] = useState<number>(saved?.facilityBonus ?? 0);
  const [facilityTeBonus, setFacilityTeBonus] = useState<number>(saved?.facilityTeBonus ?? 0);
  const [factoryTax, setFactoryTax] = useState<number>(saved?.factoryTax ?? 0);
  const [structureFee, setStructureFee] = useState<number>(saved?.structureFee ?? 0);
  const [salesTax, setSalesTax] = useState<number>(saved?.salesTax ?? 3.6);
  const [brokerFee, setBrokerFee] = useState<number>(saved?.brokerFee ?? 1.5);
  const [useJobOverride, setUseJobOverride] = useState<boolean>(saved?.useJobOverride ?? false);
  const [jobCostOverride, setJobCostOverride] = useState<number>(saved?.jobCostOverride ?? 0);

  const station = useMemo(() => STATION_PRESETS_MANUFACTURING.find((p) => p.id === stationId) ?? STATION_PRESETS_MANUFACTURING[0], [stationId]);

  const productionTimeSec = useMemo(() => {
    const base = RAPTURE_ALPHA_BLUEPRINT.productionTime;
    return Math.round(base * (1 - facilityTeBonus / 100));
  }, [facilityTeBonus]);

  function fmtTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}ч ${m}м`;
    if (m > 0) return `${m}м ${s}с`;
    return `${s}с`;
  }

  function handleStationChange(newId: string) {
    setStationId(newId);
    const preset = STATION_PRESETS_MANUFACTURING.find((p) => p.id === newId);
    if (preset) {
      setFacilityBonus(preset.facilityMeBonus);
      setFacilityTeBonus(preset.facilityTeBonus);
      setFactoryTax(preset.factoryTax);
      setStructureFee(preset.structureFee);
      if (preset.autoJobCost) setUseJobOverride(false);
    }
  }

  const { data, isLoading, error, refetch, isFetching } = useQuery<ImplantPricesResponse>({
    queryKey: ["/api/implants/rapture-alpha/prices", runs, me, facilityBonus],
    queryFn: async () => {
      const r = await fetch(`/api/implants/rapture-alpha/prices?runs=${runs}&me=${me}&facilityBonus=${facilityBonus}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: sciData } = useQuery<{ manufacturing: number; reaction: number }>({
    queryKey: ["/api/industry/cost-index/ikoskio"],
    queryFn: async () => {
      const r = await fetch("/api/industry/cost-index/ikoskio");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  const groupedItems = useMemo(() => {
    if (!data?.items) return [];
    const groups: Record<string, ImplantItemPrice[]> = {};
    for (const item of data.items) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    }
    return Object.entries(groups).map(([group, items]) => ({ group, items }));
  }, [data?.items]);

  const [contractsEnabled, setContractsEnabled] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);

  const { data: contractsData, isLoading: contractsLoading, error: contractsError } = useQuery<ImplantContractsResponse>({
    queryKey: ["/api/implants/rapture-alpha/contracts"],
    queryFn: async () => {
      const r = await fetch("/api/implants/rapture-alpha/contracts");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: contractsEnabled,
    staleTime: 15 * 60 * 1000,
  });

  const selectedContract = useMemo(
    () => contractsData?.contracts.find((c) => c.contractId === selectedContractId) ?? null,
    [selectedContractId, contractsData]
  );

  const contractExtraCost = useMemo(
    () => (selectedContract ? selectedContract.pricePerRun * runs : 0),
    [selectedContract, runs]
  );

  const margins = useMemo(() => {
    if (!data?.items) return [];
    return calcMargins(data.items, salesTax, brokerFee, jobCostOverride, useJobOverride, data.estimatedJobCost, runs, contractExtraCost);
  }, [data, salesTax, brokerFee, jobCostOverride, useJobOverride, runs, contractExtraCost]);

  const inputsTotal = useMemo(() => {
    const inputs = data?.items?.filter((i) => i.role === "input") ?? [];
    return {
      buy: inputs.reduce((s, i) => s + i.totalBuy, 0),
      sell: inputs.reduce((s, i) => s + i.totalSell, 0),
    };
  }, [data?.items]);

  const outputsTotal = useMemo(() => {
    const outputs = data?.items?.filter((i) => i.role === "output") ?? [];
    return {
      buy: outputs.reduce((s, i) => s + i.totalBuy, 0),
      sell: outputs.reduce((s, i) => s + i.totalSell, 0),
    };
  }, [data?.items]);

  const inputAdjustedTotal = useMemo(() => {
    if (!data?.items) return 0;
    return data.items.filter((i) => i.role === "input").reduce((s, i) => s + i.adjustedPrice * i.quantity, 0);
  }, [data?.items]);

  const effectiveJobCost = useMemo(() => {
    if (useJobOverride) return jobCostOverride * runs;
    const sciCost = data?.estimatedJobCost ?? 0;
    const extraTaxes = inputAdjustedTotal * (factoryTax + structureFee) / 100;
    return sciCost + extraTaxes;
  }, [useJobOverride, jobCostOverride, runs, data?.estimatedJobCost, inputAdjustedTotal, factoryTax, structureFee]);

  function handleSaveSettings() {
    const settings = { stationId, me, facilityBonus, facilityTeBonus, factoryTax, structureFee, salesTax, brokerFee, useJobOverride, jobCostOverride };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    toast({ title: "Настройки сохранены", description: "Ваши параметры будут применяться при следующем входе." });
  }

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto" data-testid="page-implants">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-5 h-5 text-primary" />
            <h1 className="font-mono text-lg font-bold tracking-wide">High-grade Rapture Alpha</h1>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            {runs} {runs === 1 ? "прогон" : runs < 5 ? "прогона" : "прогонов"} · {runs} шт. · ME{me} · Jita цены
          </p>
          {sciData && (
            <div className="flex items-center gap-1.5 mt-1">
              <Info className="w-3 h-3 text-primary/60" />
              <span className="text-[10px] font-mono text-muted-foreground">
                Ikoskio Manufacturing SCI: <span className="text-primary">{(sciData.manufacturing * 100).toFixed(2)}%</span>
                {" · Azbel (Svarog Manufacture)"}
              </span>
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="font-mono text-xs shrink-0" data-testid="button-refresh">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center gap-2">
              <Factory className="w-4 h-4 text-primary" />
              <CardTitle className="font-mono text-sm">Параметры производства</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Building2 className="w-3 h-3" /> Сооружение
              </Label>
              <Select value={stationId} onValueChange={handleStationChange} data-testid="select-station">
                <SelectTrigger className="font-mono text-xs h-9" data-testid="trigger-station">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATION_PRESETS_MANUFACTURING.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="font-mono text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {station.id !== "default" && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-1.5 p-2 rounded bg-primary/5 border border-primary/20">
                    <Zap className="w-3 h-3 text-primary shrink-0" />
                    <span className="font-mono text-[10px] text-primary">
                      SCI авто · Настройте ME/TE по рыгам вашего Azbel
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">ME риг %</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" min={0} max={10} step={0.1} value={facilityBonus}
                          onChange={(e) => setFacilityBonus(Math.min(10, Math.max(0, parseFloat(e.target.value) || 0)))}
                          className="font-mono text-xs h-7"
                          data-testid="input-facility-bonus"
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">%</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">TE риг %</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" min={0} max={20} step={0.1} value={facilityTeBonus}
                          onChange={(e) => setFacilityTeBonus(Math.min(20, Math.max(0, parseFloat(e.target.value) || 0)))}
                          className="font-mono text-xs h-7"
                          data-testid="input-facility-te"
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">%</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Заводской налог %</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" min={0} max={20} step={0.1} value={factoryTax}
                          onChange={(e) => setFactoryTax(Math.min(20, Math.max(0, parseFloat(e.target.value) || 0)))}
                          className="font-mono text-xs h-7"
                          data-testid="input-factory-tax"
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">%</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Пошлина КлБТ %</Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" min={0} max={20} step={0.1} value={structureFee}
                          onChange={(e) => setStructureFee(Math.min(20, Math.max(0, parseFloat(e.target.value) || 0)))}
                          className="font-mono text-xs h-7"
                          data-testid="input-structure-fee"
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 p-1.5 rounded bg-muted/30">
                    <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Время / прогон:{" "}
                      <span className="text-foreground">
                        {fmtTime(productionTimeSec)}
                        {facilityTeBonus > 0 && (
                          <span className="text-chart-2"> (−{facilityTeBonus}% TE)</span>
                        )}
                      </span>
                    </span>
                  </div>
                  {(factoryTax > 0 || structureFee > 0) && inputAdjustedTotal > 0 && !useJobOverride && (
                    <div className="space-y-0.5 p-2 rounded bg-muted/20 border border-border/40">
                      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                        <span>SCI</span>
                        <span>{(data?.estimatedJobCost ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ISK</span>
                      </div>
                      {factoryTax > 0 && (
                        <div className="flex justify-between font-mono text-[10px] text-destructive">
                          <span>Заводской налог ({factoryTax}%)</span>
                          <span>+{(inputAdjustedTotal * factoryTax / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ISK</span>
                        </div>
                      )}
                      {structureFee > 0 && (
                        <div className="flex justify-between font-mono text-[10px] text-destructive">
                          <span>Пошлина КлБТ ({structureFee}%)</span>
                          <span>+{(inputAdjustedTotal * structureFee / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ISK</span>
                        </div>
                      )}
                      <div className="flex justify-between font-mono text-[10px] text-foreground border-t border-border/40 pt-0.5 mt-0.5">
                        <span>Итого job cost</span>
                        <span className="text-primary">{effectiveJobCost.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ISK</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Прогоны</Label>
              <Input
                type="number" min={1} max={1000} value={runs}
                onChange={(e) => setRuns(Math.max(1, parseInt(e.target.value) || 1))}
                className="font-mono text-sm h-8"
                data-testid="input-runs"
              />
            </div>
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Material Efficiency (ME 0–10)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={10} value={me}
                  onChange={(e) => setMe(Math.min(10, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="font-mono text-sm h-8"
                  data-testid="input-me"
                />
                <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary whitespace-nowrap">ME {me}</Badge>
              </div>
            </div>
            {station.id === "default" && (
              <div className="space-y-1">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Бонус сооружения ME%</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={0} max={10} step={0.1} value={facilityBonus}
                    onChange={(e) => setFacilityBonus(Math.min(10, Math.max(0, parseFloat(e.target.value) || 0)))}
                    className="font-mono text-sm h-8"
                    data-testid="input-facility-bonus"
                  />
                  <span className="font-mono text-xs text-muted-foreground">%</span>
                </div>
                <p className="text-[9px] font-mono text-muted-foreground">Azbel basic rig = 2%, advanced = 4%</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-primary" />
              <CardTitle className="font-mono text-sm">Налоги и комиссии</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Налог с продаж %</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={20} step={0.1} value={salesTax}
                  onChange={(e) => setSalesTax(parseFloat(e.target.value) || 0)}
                  className="font-mono text-sm h-8"
                  data-testid="input-sales-tax"
                />
                <span className="font-mono text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Брокерская комиссия %</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={10} step={0.1} value={brokerFee}
                  onChange={(e) => setBrokerFee(parseFloat(e.target.value) || 0)}
                  className="font-mono text-sm h-8"
                  data-testid="input-broker-fee"
                />
                <span className="font-mono text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div className="pt-1">
              <Button onClick={handleSaveSettings} variant="outline" size="sm" className="w-full font-mono text-xs border-primary/40 text-primary hover:bg-primary/10" data-testid="button-save-settings">
                <Save className="w-3 h-3 mr-1.5" />
                Сохранить настройки
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="font-mono text-sm">Стоимость запуска</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-1">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Расчётная стоимость (Ikoskio SCI)
              </Label>
              {isLoading
                ? <Skeleton className="h-6 w-full" />
                : <p className="font-mono text-sm text-primary">{fmtISK(data?.estimatedJobCost ?? 0)} ISK</p>}
              <p className="text-[9px] font-mono text-muted-foreground">= EIV × {sciData ? (sciData.manufacturing * 100).toFixed(2) : "..."}% SCI</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="use-override"
                checked={useJobOverride}
                onChange={(e) => setUseJobOverride(e.target.checked)}
                className="rounded"
                data-testid="checkbox-job-override"
              />
              <Label htmlFor="use-override" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer">
                Ручной ввод (за прогон)
              </Label>
            </div>
            {useJobOverride && (
              <div className="space-y-1">
                <Input
                  type="number" min={0} value={jobCostOverride}
                  onChange={(e) => setJobCostOverride(parseFloat(e.target.value) || 0)}
                  className="font-mono text-sm h-8"
                  placeholder="ISK за прогон"
                  data-testid="input-job-cost-override"
                />
              </div>
            )}
            <div className="pt-1 border-t border-border/50 space-y-1.5">
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">Входы (бай-ордера)</span>
                {isLoading ? <Skeleton className="h-3 w-20" /> : <span className="font-mono text-xs text-destructive">{fmtShort(inputsTotal.buy)} ISK</span>}
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">Входы (сел-ордера)</span>
                {isLoading ? <Skeleton className="h-3 w-20" /> : <span className="font-mono text-xs text-destructive">{fmtShort(inputsTotal.sell)} ISK</span>}
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">Стоимость запуска</span>
                {isLoading ? <Skeleton className="h-3 w-20" /> : <span className="font-mono text-xs text-yellow-400">{fmtShort(effectiveJobCost)} ISK</span>}
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">Выход (бай-ордер)</span>
                {isLoading ? <Skeleton className="h-3 w-20" /> : <span className="font-mono text-xs text-chart-2">{fmtShort(outputsTotal.buy)} ISK</span>}
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">Выход (сел-ордер)</span>
                {isLoading ? <Skeleton className="h-3 w-20" /> : <span className="font-mono text-xs text-chart-2">{fmtShort(outputsTotal.sell)} ISK</span>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-contracts">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <CardTitle className="font-mono text-sm">Контракты на High-grade Rapture Alpha</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {selectedContract && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 px-2 font-mono text-[10px] text-muted-foreground hover:text-destructive"
                  onClick={() => setSelectedContractId(null)}
                  data-testid="button-clear-contract"
                >
                  <X className="w-3 h-3 mr-1" /> Убрать
                </Button>
              )}
              <Button
                variant="outline" size="sm"
                className="h-7 px-3 font-mono text-xs border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => setContractsEnabled(true)}
                disabled={contractsLoading}
                data-testid="button-search-contracts"
              >
                {contractsLoading ? (
                  <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                ) : (
                  <Search className="w-3 h-3 mr-1.5" />
                )}
                {contractsLoading ? "Поиск..." : contractsData ? "Обновить" : "Найти"}
              </Button>
            </div>
          </div>
          {selectedContract && (
            <div className="flex items-center gap-2 mt-2 p-2 rounded bg-primary/10 border border-primary/30">
              <CheckCircle className="w-3 h-3 text-primary shrink-0" />
              <span className="font-mono text-[10px] text-primary">
                Выбран: {fmtISK(selectedContract.pricePerRun)} ISK/прогон × {runs} прогонов = +{fmtISK(contractExtraCost)} ISK к затратам
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-3">
          {!contractsEnabled && (
            <p className="font-mono text-[10px] text-muted-foreground">
              Нажмите «Найти» для поиска контрактов в The Forge (до 30 сек).
            </p>
          )}
          {contractsLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded" />
              ))}
              <p className="font-mono text-[9px] text-muted-foreground">Проверяем контракты в The Forge...</p>
            </div>
          )}
          {contractsError && (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-3 h-3" />
              <span className="font-mono text-xs">Ошибка загрузки контрактов</span>
            </div>
          )}
          {contractsData && !contractsLoading && (
            contractsData.contracts.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">Контрактов с этим имплантом не найдено (проверено {contractsData.checkedCount} контрактов).</p>
            ) : (
              <div className="space-y-1">
                <p className="font-mono text-[9px] text-muted-foreground mb-2">
                  Найдено {contractsData.contracts.length} контракт(ов) · проверено {contractsData.checkedCount} · обновлено {new Date(contractsData.updatedAt).toLocaleTimeString("ru-RU")}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["", "Цена/прогон", "Прогонов BPC", "Итого", "Истекает"].map((h, i) => (
                          <th key={i} className={`py-1.5 px-3 font-mono text-[9px] tracking-widest uppercase text-muted-foreground ${i === 0 ? "w-8" : "text-right first:text-left"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contractsData.contracts.map((c, idx) => {
                        const isSelected = c.contractId === selectedContractId;
                        const expires = new Date(c.dateExpired);
                        const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86400000);
                        return (
                          <tr
                            key={c.contractId}
                            className={`border-b border-border/50 cursor-pointer transition-colors ${isSelected ? "bg-primary/10" : "hover:bg-muted/30"}`}
                            onClick={() => setSelectedContractId(isSelected ? null : c.contractId)}
                            data-testid={`row-contract-${idx}`}
                          >
                            <td className="py-2 px-3">
                              <input
                                type="radio"
                                readOnly
                                checked={isSelected}
                                className="accent-primary"
                                data-testid={`radio-contract-${idx}`}
                              />
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-xs text-chart-2">{fmtISK(c.pricePerRun)}</td>
                            <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">{c.bpcRuns.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right font-mono text-xs text-foreground">{fmtShort(c.price)} ISK</td>
                            <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">{daysLeft}д</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-2 p-4">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <span className="font-mono text-xs text-destructive">Ошибка загрузки цен. Проверьте соединение с ESI API.</span>
          </CardContent>
        </Card>
      )}

      {!error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" data-testid="margins-grid">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)
            : margins.map((s) => <MarginCard key={s.label} scenario={s} />)}
        </div>
      )}

      {!error && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="font-mono text-sm">Ведомость материалов (Jita)</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto" data-testid="table-bom">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Название", "Кол-во", "Цена (Buy)", "Цена (Sell)", "Итого (Buy)", "Итого (Sell)"].map((h) => (
                    <th key={h} className="py-2 px-3 text-left font-mono text-[10px] tracking-widest uppercase text-muted-foreground first:text-left [&:not(:first-child)]:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td colSpan={6} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                    </tr>
                  ))
                  : groupedItems.map(({ group, items }) => (
                    <Fragment key={group}>
                      <GroupHeader group={group} />
                      {items.map((item) => <ItemRow key={item.typeId} item={item} />)}
                    </Fragment>
                  ))
                }
                {!isLoading && data && (
                  <>
                    <tr className="border-t-2 border-primary/30 bg-muted/20">
                      <td className="py-2 px-3 font-mono text-xs font-semibold" colSpan={2}>ИТОГО ВХОДЫ</td>
                      <td className="py-2 px-3" colSpan={2}></td>
                      <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-destructive">{fmtISK(inputsTotal.buy)}</td>
                      <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-destructive">{fmtISK(inputsTotal.sell)}</td>
                    </tr>
                    <tr className="bg-muted/20">
                      <td className="py-2 px-3 font-mono text-xs font-semibold" colSpan={2}>ИТОГО ВЫХОД</td>
                      <td className="py-2 px-3" colSpan={2}></td>
                      <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-chart-2">{fmtISK(outputsTotal.buy)}</td>
                      <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-chart-2">{fmtISK(outputsTotal.sell)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
