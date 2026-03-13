import { useState, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FlaskConical,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Tag,
  ArrowDown,
  ArrowUp,
  Loader2,
  AlertCircle,
  Settings2,
  Zap,
  Save,
} from "lucide-react";
import { formatISK, formatNumber } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import type { ReactionPricesResponse, ReactionItemPrice } from "@shared/schema";

const REACTION_SETTINGS_KEY = "eve-reaction-settings";
function loadReactionSettings() {
  try {
    const s = localStorage.getItem(REACTION_SETTINGS_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function formatISKFull(value: number): string {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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

function calculateMargins(
  items: ReactionItemPrice[],
  salesTax: number,
  brokerFee: number,
  jobCost: number,
  runs: number
): MarginResult[] {
  const inputs = items.filter((i) => i.role === "input");
  const outputs = items.filter((i) => i.role === "output");

  const inputBuyTotal = inputs.reduce((s, i) => s + i.quantity * i.buyPrice, 0);
  const inputSellTotal = inputs.reduce((s, i) => s + i.quantity * i.sellPrice, 0);
  const outputBuyTotal = outputs.reduce((s, i) => s + i.quantity * i.buyPrice, 0);
  const outputSellTotal = outputs.reduce((s, i) => s + i.quantity * i.sellPrice, 0);

  const totalJobCost = jobCost * runs;

  const taxRate = salesTax / 100;
  const brokerRate = brokerFee / 100;

  const buyOrder = (total: number) => total * (1 + brokerRate);
  const buyInstant = (total: number) => total;
  const sellOrder = (total: number) => total * (1 - taxRate - brokerRate);
  const sellInstant = (total: number) => total * (1 - taxRate);

  const scenarios: MarginResult[] = [
    {
      label: "Buy → Sell",
      description: "Place buy orders (cheap, wait) → Place sell orders (expensive, wait)",
      inputCost: buyOrder(inputBuyTotal) + totalJobCost,
      outputRevenue: sellOrder(outputSellTotal),
      margin: 0,
      marginPercent: 0,
      isPrimary: true,
    },
    {
      label: "Buy → Buy",
      description: "Place buy orders (cheap, wait) → Instant sell into buy orders (fast)",
      inputCost: buyOrder(inputBuyTotal) + totalJobCost,
      outputRevenue: sellInstant(outputBuyTotal),
      margin: 0,
      marginPercent: 0,
      isPrimary: false,
    },
    {
      label: "Sell → Sell",
      description: "Instant buy from sell orders (fast) → Place sell orders (expensive, wait)",
      inputCost: buyInstant(inputSellTotal) + totalJobCost,
      outputRevenue: sellOrder(outputSellTotal),
      margin: 0,
      marginPercent: 0,
      isPrimary: false,
    },
    {
      label: "Sell → Buy",
      description: "Instant buy from sell orders (fast) → Instant sell into buy orders (fast)",
      inputCost: buyInstant(inputSellTotal) + totalJobCost,
      outputRevenue: sellInstant(outputBuyTotal),
      margin: 0,
      marginPercent: 0,
      isPrimary: false,
    },
  ];

  for (const s of scenarios) {
    s.margin = s.outputRevenue - s.inputCost;
    s.marginPercent = s.inputCost > 0 ? (s.margin / s.inputCost) * 100 : 0;
  }

  return scenarios;
}

function ItemRow({ item }: { item: ReactionItemPrice }) {
  const isInput = item.role === "input";
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`row-item-${item.typeId}`}>
      <td className="py-2 px-3">
        <div className="flex items-center gap-2">
          {isInput ? (
            <ArrowDown className="w-3 h-3 text-destructive shrink-0" />
          ) : (
            <ArrowUp className="w-3 h-3 text-chart-2 shrink-0" />
          )}
          <span className="font-mono text-xs">{item.name}</span>
        </div>
      </td>
      <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">
        {formatNumber(item.quantity)}
      </td>
      <td className="py-2 px-3 text-right font-mono text-xs">
        {item.buyPrice > 0 ? formatISKFull(item.buyPrice) : "—"}
      </td>
      <td className="py-2 px-3 text-right font-mono text-xs">
        {item.sellPrice > 0 ? formatISKFull(item.sellPrice) : "—"}
      </td>
      <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">
        {item.buyPrice > 0 ? formatISKFull(item.quantity * item.buyPrice) : "—"}
      </td>
      <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">
        {item.sellPrice > 0 ? formatISKFull(item.quantity * item.sellPrice) : "—"}
      </td>
    </tr>
  );
}

function GroupHeader({ group }: { group: string }) {
  return (
    <tr className="border-b border-border/30">
      <td colSpan={6} className="py-1.5 px-3">
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">{group}</span>
      </td>
    </tr>
  );
}

function MarginCard({ result }: { result: MarginResult }) {
  const isPositive = result.margin >= 0;
  return (
    <Card
      className={`${result.isPrimary ? "border-primary/40 shadow-[0_0_20px_-5px_hsl(190,80%,45%,0.15)]" : ""}`}
      data-testid={`card-margin-${result.label.toLowerCase().replace(/\s/g, "-")}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-['Oxanium'] text-sm font-semibold tracking-wide">{result.label}</span>
            {result.isPrimary && (
              <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 text-primary border-primary/30">
                PRIMARY
              </Badge>
            )}
          </div>
          <div className={`flex items-center gap-1 ${isPositive ? "text-chart-2" : "text-destructive"}`}>
            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span className="font-mono text-sm font-bold">
              {isPositive ? "+" : ""}{result.marginPercent.toFixed(1)}%
            </span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground font-mono">{result.description}</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <ShoppingCart className="w-3 h-3" /> Input cost + job
            </span>
            <span className="font-mono text-destructive">{formatISK(result.inputCost)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Tag className="w-3 h-3" /> Output revenue
            </span>
            <span className="font-mono text-chart-2">{formatISK(result.outputRevenue)}</span>
          </div>
          <div className="border-t border-border pt-1.5 flex justify-between text-xs font-semibold">
            <span>Margin</span>
            <span className={`font-mono ${isPositive ? "text-chart-2" : "text-destructive"}`}>
              {isPositive ? "+" : ""}{formatISK(result.margin)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReactionsPage() {
  const { toast } = useToast();
  const savedSettings = useMemo(() => loadReactionSettings(), []);
  const [salesTax, setSalesTax] = useState<number>(savedSettings?.salesTax ?? 3.6);
  const [brokerFee, setBrokerFee] = useState<number>(savedSettings?.brokerFee ?? 1.5);
  const [jobCost, setJobCost] = useState<number>(savedSettings?.jobCost ?? 138360);
  const [runs, setRuns] = useState(1);

  function handleSaveSettings() {
    localStorage.setItem(REACTION_SETTINGS_KEY, JSON.stringify({ salesTax, brokerFee, jobCost }));
    toast({ title: "Настройки сохранены", description: "Ваши параметры будут применяться при следующем входе." });
  }

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ReactionPricesResponse>({
    queryKey: ["/api/reactions/neuralink/prices", runs],
    queryFn: async () => {
      const res = await fetch(`/api/reactions/neuralink/prices?runs=${runs}`);
      if (!res.ok) throw new Error("Failed to fetch prices");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const margins = useMemo(() => {
    if (!data?.items) return [];
    return calculateMargins(data.items, salesTax, brokerFee, jobCost, runs);
  }, [data, salesTax, brokerFee, jobCost, runs]);

  const groupedItems = useMemo(() => {
    if (!data?.items) return [];
    const groups: { group: string; items: ReactionItemPrice[] }[] = [];
    const groupMap = new Map<string, ReactionItemPrice[]>();

    const groupOrder = ["Fuel", "Gas", "Materials", "Output"];
    for (const item of data.items) {
      if (!groupMap.has(item.group)) groupMap.set(item.group, []);
      groupMap.get(item.group)!.push(item);
    }

    for (const g of groupOrder) {
      if (groupMap.has(g)) {
        groups.push({ group: g, items: groupMap.get(g)! });
      }
    }
    return groups;
  }, [data]);

  const inputsTotal = useMemo(() => {
    if (!data?.items) return { buy: 0, sell: 0 };
    const inputs = data.items.filter((i) => i.role === "input");
    return {
      buy: inputs.reduce((s, i) => s + i.quantity * i.buyPrice, 0),
      sell: inputs.reduce((s, i) => s + i.quantity * i.sellPrice, 0),
    };
  }, [data]);

  const outputsTotal = useMemo(() => {
    if (!data?.items) return { buy: 0, sell: 0 };
    const outputs = data.items.filter((i) => i.role === "output");
    return {
      buy: outputs.reduce((s, i) => s + i.quantity * i.buyPrice, 0),
      sell: outputs.reduce((s, i) => s + i.quantity * i.sellPrice, 0),
    };
  }, [data]);

  const totalOutput = runs * 20;

  return (
    <div className="p-6 space-y-6" data-testid="page-reactions">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <h1 className="font-['Oxanium'] text-2xl font-bold tracking-wider text-foreground flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-chart-4" />
            Axosomatic Neurolink Enhancer
          </h1>
          <p className="text-sm text-muted-foreground font-mono">
            Reaction profitability &middot; {runs} run{runs > 1 ? "s" : ""} &middot; {totalOutput} units output &middot; Jita prices
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-prices"
        >
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Refresh Prices
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5" />
              Reaction Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="runs" className="font-mono text-xs">Runs</Label>
              <Input
                id="runs"
                type="number"
                step="1"
                min="1"
                max="500"
                value={runs}
                onChange={(e) => setRuns(Math.max(1, parseInt(e.target.value) || 1))}
                className="font-mono text-sm"
                data-testid="input-runs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobCost" className="font-mono text-xs">Job Cost (ISK per run)</Label>
              <Input
                id="jobCost"
                type="number"
                step="1000"
                min="0"
                value={jobCost}
                onChange={(e) => setJobCost(parseFloat(e.target.value) || 0)}
                className="font-mono text-sm"
                data-testid="input-job-cost"
              />
              <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Total: {formatISK(jobCost * runs)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5" />
              Tax &amp; Fees
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="salesTax" className="font-mono text-xs">Sales Tax %</Label>
              <Input
                id="salesTax"
                type="number"
                step="0.1"
                min="0"
                max="15"
                value={salesTax}
                onChange={(e) => setSalesTax(parseFloat(e.target.value) || 0)}
                className="font-mono text-sm"
                data-testid="input-sales-tax"
              />
              <p className="text-[10px] text-muted-foreground font-mono">Accounting skill reduces this</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="brokerFee" className="font-mono text-xs">Broker Fee %</Label>
              <Input
                id="brokerFee"
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={brokerFee}
                onChange={(e) => setBrokerFee(parseFloat(e.target.value) || 0)}
                className="font-mono text-sm"
                data-testid="input-broker-fee"
              />
              <p className="text-[10px] text-muted-foreground font-mono">Broker Relations + standings</p>
            </div>
            <Button
              onClick={handleSaveSettings}
              variant="outline"
              size="sm"
              className="w-full font-mono text-xs border-primary/40 text-primary hover:bg-primary/10"
              data-testid="button-save-settings"
            >
              <Save className="w-3 h-3 mr-1.5" />
              Сохранить настройки
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
              Totals (before fees)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-mono">Inputs (buy)</span>
                    <span className="font-mono text-destructive">{formatISK(inputsTotal.buy)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-mono">Inputs (sell)</span>
                    <span className="font-mono text-destructive">{formatISK(inputsTotal.sell)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-mono">Job cost</span>
                    <span className="font-mono text-destructive">{formatISK(jobCost * runs)}</span>
                  </div>
                </div>
                <div className="border-t border-border pt-1.5 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-mono">Output (buy)</span>
                    <span className="font-mono text-chart-2">{formatISK(outputsTotal.buy)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-mono">Output (sell)</span>
                    <span className="font-mono text-chart-2">{formatISK(outputsTotal.sell)}</span>
                  </div>
                </div>
                {data?.updatedAt && (
                  <p className="text-[10px] text-muted-foreground font-mono pt-1">
                    Updated: {new Date(data.updatedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-destructive">Error loading prices</p>
              <p className="text-xs text-muted-foreground font-mono">{(error as Error)?.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : margins.length > 0 && (
        <div>
          <h2 className="font-['Oxanium'] text-lg font-semibold tracking-wide mb-3">
            Margin Scenarios
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="margins-grid">
            {margins.map((m) => (
              <MarginCard key={m.label} result={m} />
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : data?.items && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-['Oxanium'] text-lg tracking-wide">
              Bill of Materials ({runs} run{runs > 1 ? "s" : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-bom">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="py-2 px-3 text-left font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Name</th>
                    <th className="py-2 px-3 text-right font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Qty</th>
                    <th className="py-2 px-3 text-right font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Buy Price</th>
                    <th className="py-2 px-3 text-right font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Sell Price</th>
                    <th className="py-2 px-3 text-right font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Total (Buy)</th>
                    <th className="py-2 px-3 text-right font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Total (Sell)</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedItems.map(({ group, items }) => (
                    <Fragment key={group}>
                      <GroupHeader group={group} />
                      {items.map((item) => <ItemRow key={item.typeId} item={item} />)}
                    </Fragment>
                  ))}
                  <tr className="border-t-2 border-primary/30 bg-muted/20">
                    <td className="py-2 px-3 font-mono text-xs font-semibold" colSpan={2}>
                      INPUTS TOTAL
                    </td>
                    <td className="py-2 px-3" colSpan={2}></td>
                    <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-destructive">
                      {formatISKFull(inputsTotal.buy)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-destructive">
                      {formatISKFull(inputsTotal.sell)}
                    </td>
                  </tr>
                  <tr className="bg-muted/20">
                    <td className="py-2 px-3 font-mono text-xs font-semibold" colSpan={2}>
                      OUTPUT TOTAL
                    </td>
                    <td className="py-2 px-3" colSpan={2}></td>
                    <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-chart-2">
                      {formatISKFull(outputsTotal.buy)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs font-semibold text-chart-2">
                      {formatISKFull(outputsTotal.sell)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
