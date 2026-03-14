import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Factory,
  Search,
  TrendingUp,
  TrendingDown,
  Loader2,
  Calculator,
  Wrench,
  Percent,
  Layers,
} from "lucide-react";
import { formatISK, formatPercent, formatNumber } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ManufacturingResult } from "@shared/schema";

interface SearchResult {
  typeId: number;
  typeName: string;
}

export default function ManufacturingPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const [materialEfficiency, setMaterialEfficiency] = useState(10);
  const [timeEfficiency, setTimeEfficiency] = useState(20);
  const [facilityBonus, setFacilityBonus] = useState(1);
  const [systemCostIndex, setSystemCostIndex] = useState(5);
  const [taxRate, setTaxRate] = useState(10);
  const [runs, setRuns] = useState(1);
  const [result, setResult] = useState<ManufacturingResult | null>(null);
  const { toast } = useToast();

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("GET", `/api/items/search?q=${encodeURIComponent(query)}`);
      return res.json() as Promise<SearchResult[]>;
    },
  });

  const calcMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("No item selected");
      const res = await apiRequest("POST", "/api/manufacturing/calculate", {
        typeId: selectedItem.typeId,
        typeName: selectedItem.typeName,
        materialEfficiency,
        timeEfficiency,
        facilityBonus,
        systemCostIndex,
        taxRate,
        runs,
      });
      return res.json() as Promise<ManufacturingResult>;
    },
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (err: Error) => {
      toast({ title: "Calculation Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    if (searchTerm.trim().length >= 2) {
      searchMutation.mutate(searchTerm.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <div>
        <h2
          className="font-mono text-lg font-semibold tracking-wide text-foreground"
          data-testid="text-mfg-title"
        >
          Manufacturing Calculator
        </h2>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          Calculate production costs, margins, and profitability
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
                <Search className="w-3.5 h-3.5" />
                Item Search
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Search item name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="font-mono text-xs"
                  data-testid="input-item-search"
                />
                <Button
                  onClick={handleSearch}
                  disabled={searchMutation.isPending || searchTerm.trim().length < 2}
                  data-testid="button-search-item"
                >
                  {searchMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {searchMutation.data && searchMutation.data.length > 0 && (
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-1">
                    {searchMutation.data.map((item) => (
                      <div
                        key={item.typeId}
                        className={`flex items-center justify-between gap-2 p-2 rounded-md cursor-pointer hover-elevate ${
                          selectedItem?.typeId === item.typeId ? "bg-primary/10 border border-primary/30" : "bg-muted/30"
                        }`}
                        onClick={() => setSelectedItem(item)}
                        data-testid={`item-result-${item.typeId}`}
                      >
                        <span className="text-xs font-mono text-foreground truncate">
                          {item.typeName}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          #{item.typeId}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {searchMutation.data && searchMutation.data.length === 0 && (
                <p className="text-xs font-mono text-muted-foreground text-center py-3">
                  No items found matching your search
                </p>
              )}

              {selectedItem && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
                  <Factory className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-xs font-mono text-foreground truncate">
                    {selectedItem.typeName}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                    #{selectedItem.typeId}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5" />
                Production Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SliderParam
                icon={<Layers className="w-3.5 h-3.5" />}
                label="Material Efficiency (ME)"
                value={materialEfficiency}
                onChange={setMaterialEfficiency}
                min={0}
                max={10}
                step={1}
                suffix="%"
                testId="slider-me"
              />
              <SliderParam
                icon={<Calculator className="w-3.5 h-3.5" />}
                label="Time Efficiency (TE)"
                value={timeEfficiency}
                onChange={setTimeEfficiency}
                min={0}
                max={20}
                step={2}
                suffix="%"
                testId="slider-te"
              />
              <SliderParam
                icon={<Factory className="w-3.5 h-3.5" />}
                label="Facility Material Bonus"
                value={facilityBonus}
                onChange={setFacilityBonus}
                min={0}
                max={5}
                step={0.5}
                suffix="%"
                testId="slider-facility"
              />
              <SliderParam
                icon={<Percent className="w-3.5 h-3.5" />}
                label="System Cost Index"
                value={systemCostIndex}
                onChange={setSystemCostIndex}
                min={0}
                max={30}
                step={0.5}
                suffix="%"
                testId="slider-cost-index"
              />
              <SliderParam
                icon={<Percent className="w-3.5 h-3.5" />}
                label="Tax Rate"
                value={taxRate}
                onChange={setTaxRate}
                min={0}
                max={25}
                step={0.5}
                suffix="%"
                testId="slider-tax"
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Number of Runs
                </label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={runs}
                  onChange={(e) => setRuns(Math.max(1, parseInt(e.target.value) || 1))}
                  className="font-mono text-xs"
                  data-testid="input-runs"
                />
              </div>

              <Button
                className="w-full font-mono text-xs"
                onClick={() => calcMutation.mutate()}
                disabled={!selectedItem || calcMutation.isPending}
                data-testid="button-calculate"
              >
                {calcMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Calculator className="w-4 h-4" />
                )}
                Calculate Production Cost
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {result ? (
            <ManufacturingResultCard result={result} />
          ) : (
            <Card>
              <CardContent className="p-8 flex flex-col items-center justify-center gap-3 h-full">
                <Factory className="w-10 h-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground font-mono text-center">
                  Search for an item and configure
                  <br />
                  production parameters to see results
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function SliderParam({
  icon,
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          <span className="text-[10px] font-mono uppercase tracking-wider">{label}</span>
        </div>
        <span className="text-xs font-mono font-semibold text-primary" data-testid={`text-${testId}-value`}>
          {value}{suffix}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        data-testid={testId}
      />
    </div>
  );
}

function ManufacturingResultCard({ result }: { result: ManufacturingResult }) {
  const isProfit = result.profit > 0;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
          <Calculator className="w-3.5 h-3.5" />
          Production Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 p-3 rounded-md bg-muted/30">
          <Factory className="w-5 h-5 text-primary shrink-0" />
          <div>
            <span className="text-sm font-mono font-medium text-foreground">
              {result.typeName}
            </span>
            <span className="text-xs font-mono text-muted-foreground ml-2">
              x{result.runs} runs
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ResultStat label="Material Cost" value={formatISK(result.materialCost)} />
          <ResultStat label="Job Install Cost" value={formatISK(result.jobCost)} />
          <ResultStat label="Tax" value={formatISK(result.taxCost)} />
          <ResultStat label="Total Production Cost" value={formatISK(result.totalCost)} variant="highlight" />
        </div>

        <div className="border-t border-border pt-3 space-y-3">
          <ResultStat label="Market Sell Price" value={formatISK(result.marketPrice)} variant="primary" />

          <div
            className={`flex items-center justify-between gap-2 p-3 rounded-md ${
              isProfit ? "bg-chart-2/10" : "bg-destructive/10"
            }`}
            data-testid="result-profit"
          >
            <div className="flex items-center gap-2">
              {isProfit ? (
                <TrendingUp className="w-5 h-5 text-chart-2" />
              ) : (
                <TrendingDown className="w-5 h-5 text-destructive" />
              )}
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {isProfit ? "Profit" : "Loss"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-lg font-mono font-bold ${isProfit ? "text-chart-2" : "text-destructive"}`}>
                {formatISK(Math.abs(result.profit))}
              </span>
              <Badge
                variant="outline"
                className={`font-mono text-xs ${isProfit ? "text-chart-2 border-chart-2/30" : "text-destructive border-destructive/30"}`}
              >
                {formatPercent(result.profitPercent)}
              </Badge>
            </div>
          </div>

          <div className="text-[10px] font-mono text-muted-foreground text-center mt-2">
            Per unit profit: {formatISK(result.profit / result.runs)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultStat({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: string;
  variant?: "default" | "primary" | "highlight";
}) {
  const colorMap = {
    default: "text-foreground",
    primary: "text-primary",
    highlight: "text-foreground font-bold",
  };
  return (
    <div className="flex flex-col gap-0.5 p-2.5 rounded-md bg-muted/30">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`text-sm font-mono ${colorMap[variant]}`}>{value}</span>
    </div>
  );
}
