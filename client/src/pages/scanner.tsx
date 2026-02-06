import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  TrendingUp,
  TrendingDown,
  Package,
  Clock,
  Bookmark,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import { EVE_REGIONS, type AnalyzedContract, type AnalyzedItem, type ScanProgress } from "@shared/schema";
import { formatISK, formatPercent, formatNumber, formatVolume, timeUntil } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type SortField = "margin" | "marginPercent" | "contractPrice" | "itemsValue";
type SortDirection = "asc" | "desc";

export default function ScannerPage() {
  const [regionId, setRegionId] = useState<string>("10000002");
  const [minMargin, setMinMargin] = useState<string>("10");
  const [sortField, setSortField] = useState<SortField>("marginPercent");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedContract, setSelectedContract] = useState<AnalyzedContract | null>(null);
  const { toast } = useToast();

  const scanQuery = useQuery<{ contracts: AnalyzedContract[]; progress: ScanProgress }>({
    queryKey: ["/api/scan/results", regionId],
    enabled: false,
  });

  const progressQuery = useQuery<ScanProgress>({
    queryKey: ["/api/scan/progress"],
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "scanning" || data.status === "analyzing")) {
        return 2000;
      }
      return false;
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scan/start", {
        regionId: parseInt(regionId),
        minMarginPercent: parseInt(minMargin),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scan/progress"] });
      toast({ title: "Scan Started", description: "Analyzing contracts in the selected region..." });
    },
    onError: (err: Error) => {
      toast({ title: "Scan Failed", description: err.message, variant: "destructive" });
    },
  });

  const resultsQuery = useQuery<{ contracts: AnalyzedContract[] }>({
    queryKey: ["/api/scan/results", regionId],
    enabled: progressQuery.data?.status === "complete",
  });

  const saveMutation = useMutation({
    mutationFn: async (contract: AnalyzedContract) => {
      const res = await apiRequest("POST", "/api/contracts/save", {
        contractId: contract.contractId,
        regionId: parseInt(regionId),
        contractPrice: contract.contractPrice,
        itemsValue: contract.itemsValue,
        margin: contract.margin,
        marginPercent: contract.marginPercent,
        itemCount: contract.itemCount,
        title: contract.title,
        contractType: contract.type,
        items: contract.items,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/saved"] });
      toast({ title: "Contract Saved", description: "Added to your saved deals." });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  const progress = progressQuery.data;
  const contracts = resultsQuery.data?.contracts || [];
  const isScanning = progress?.status === "scanning" || progress?.status === "analyzing";

  const sortedContracts = [...contracts].sort((a, b) => {
    const multiplier = sortDirection === "desc" ? -1 : 1;
    return multiplier * (a[sortField] - b[sortField]);
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-muted-foreground" />;
    return sortDirection === "desc" ? (
      <ChevronDown className="w-3 h-3 text-primary" />
    ) : (
      <ChevronUp className="w-3 h-3 text-primary" />
    );
  };

  const progressPercent = progress
    ? progress.totalContracts > 0
      ? (progress.analyzedContracts / progress.totalContracts) * 100
      : 0
    : 0;

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <div className="flex flex-col gap-4">
        <div>
          <h2
            className="font-mono text-lg font-semibold tracking-wide text-foreground"
            data-testid="text-page-title"
          >
            Contract Scanner
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Scan public contracts for profitable item exchange deals
          </p>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Region
                </label>
                <Select value={regionId} onValueChange={setRegionId} data-testid="select-region">
                  <SelectTrigger data-testid="select-region-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVE_REGIONS.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)} data-testid={`option-region-${r.id}`}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5 min-w-[140px]">
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Min Margin %
                </label>
                <Select value={minMargin} onValueChange={setMinMargin}>
                  <SelectTrigger data-testid="select-min-margin">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5%</SelectItem>
                    <SelectItem value="10">10%</SelectItem>
                    <SelectItem value="15">15%</SelectItem>
                    <SelectItem value="20">20%</SelectItem>
                    <SelectItem value="30">30%</SelectItem>
                    <SelectItem value="50">50%</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => scanMutation.mutate()}
                disabled={isScanning || scanMutation.isPending}
                data-testid="button-start-scan"
              >
                {isScanning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span className="font-mono text-xs">
                  {isScanning ? "Scanning..." : "Start Scan"}
                </span>
              </Button>

              {contracts.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/scan/results", regionId] });
                  }}
                  data-testid="button-refresh-results"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="font-mono text-xs">Refresh</span>
                </Button>
              )}
            </div>

            {isScanning && progress && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {progress.message}
                  </span>
                  <span className="text-xs font-mono text-primary">
                    {progress.analyzedContracts}/{progress.totalContracts}
                  </span>
                </div>
                <Progress value={progressPercent} className="h-1.5" data-testid="progress-scan" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {progress?.status === "error" && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <p className="text-sm text-destructive font-mono text-center" data-testid="text-scan-error">
              {progress.message}
            </p>
            <Button variant="outline" onClick={() => scanMutation.mutate()} data-testid="button-retry-scan">
              <RefreshCw className="w-4 h-4" />
              <span className="font-mono text-xs">Retry Scan</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {progress?.status === "complete" && contracts.length === 0 && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
            <AlertCircle className="w-10 h-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground font-mono text-center">
              No profitable contracts found with the current filter.
              <br />
              Try lowering the minimum margin threshold.
            </p>
          </CardContent>
        </Card>
      )}

      {!progress && !isScanning && contracts.length === 0 && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
            <Search className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground font-mono text-center">
              Select a region and start scanning to find
              <br />
              profitable item exchange contracts.
            </p>
          </CardContent>
        </Card>
      )}

      {resultsQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-20" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-8 w-24" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {sortedContracts.length > 0 && (
        <div className="flex flex-col gap-2 flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground" data-testid="text-results-count">
              {contracts.length} profitable contracts found
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-muted-foreground mr-1">Sort:</span>
              {(
                [
                  { field: "marginPercent" as SortField, label: "Margin %" },
                  { field: "margin" as SortField, label: "Profit" },
                  { field: "contractPrice" as SortField, label: "Price" },
                ] as const
              ).map(({ field, label }) => (
                <Button
                  key={field}
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort(field)}
                  className={`font-mono text-[10px] ${sortField === field ? "text-primary" : ""}`}
                  data-testid={`button-sort-${field}`}
                >
                  {label}
                  <SortIcon field={field} />
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-3">
              {sortedContracts.map((contract) => (
                <ContractCard
                  key={contract.contractId}
                  contract={contract}
                  onSelect={() => setSelectedContract(contract)}
                  onSave={() => saveMutation.mutate(contract)}
                  isSaving={saveMutation.isPending}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      <Dialog open={!!selectedContract} onOpenChange={() => setSelectedContract(null)}>
        {selectedContract && (
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm tracking-wide">
                Contract #{selectedContract.contractId}
              </DialogTitle>
            </DialogHeader>
            <ContractDetails contract={selectedContract} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function ContractCard({
  contract,
  onSelect,
  onSave,
  isSaving,
}: {
  contract: AnalyzedContract;
  onSelect: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const isProfit = contract.margin > 0;
  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={onSelect}
      data-testid={`card-contract-${contract.contractId}`}
    >
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div
            className={`flex flex-col items-center justify-center w-20 h-14 rounded-md ${
              isProfit ? "bg-chart-2/10" : "bg-destructive/10"
            }`}
          >
            {isProfit ? (
              <TrendingUp className="w-4 h-4 text-chart-2 mb-0.5" />
            ) : (
              <TrendingDown className="w-4 h-4 text-destructive mb-0.5" />
            )}
            <span
              className={`font-mono text-sm font-bold ${isProfit ? "text-chart-2" : "text-destructive"}`}
              data-testid={`text-margin-${contract.contractId}`}
            >
              {formatPercent(contract.marginPercent)}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-medium text-foreground truncate">
                {contract.title || `Contract #${contract.contractId}`}
              </span>
              <Badge variant="outline" className="text-[10px] font-mono">
                {contract.type}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Price:</span>
                <span className="text-xs font-mono text-foreground">{formatISK(contract.contractPrice)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Value:</span>
                <span className="text-xs font-mono text-primary">{formatISK(contract.itemsValue)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Profit:</span>
                <span className={`text-xs font-mono font-semibold ${isProfit ? "text-chart-2" : "text-destructive"}`}>
                  {formatISK(contract.margin)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Package className="w-3 h-3" />
                <span className="text-[10px] font-mono">{contract.itemCount} items</span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span className="text-[10px] font-mono">{timeUntil(contract.dateExpired)}</span>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onSave();
              }}
              disabled={isSaving}
              data-testid={`button-save-${contract.contractId}`}
            >
              <Bookmark className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ContractDetails({ contract }: { contract: AnalyzedContract }) {
  const isProfit = contract.margin > 0;
  return (
    <ScrollArea className="max-h-[60vh]">
      <div className="space-y-4 pr-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="Contract Price" value={formatISK(contract.contractPrice)} />
          <StatBox label="Items Value" value={formatISK(contract.itemsValue)} variant="primary" />
          <StatBox
            label="Profit"
            value={formatISK(contract.margin)}
            variant={isProfit ? "profit" : "loss"}
          />
          <StatBox
            label="Margin"
            value={formatPercent(contract.marginPercent)}
            variant={isProfit ? "profit" : "loss"}
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Package className="w-3.5 h-3.5" />
            <span className="text-xs font-mono">{contract.itemCount} items</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-xs font-mono">Expires: {timeUntil(contract.dateExpired)}</span>
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            Vol: {formatVolume(contract.volume)}
          </span>
        </div>

        <div>
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Items in Contract
          </h4>
          <div className="space-y-1">
            {contract.items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md bg-muted/30"
                data-testid={`item-row-${item.typeId}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-foreground truncate">
                    {item.typeName}
                  </span>
                  {item.isBlueprint && (
                    <Badge variant="outline" className="text-[9px] font-mono">BPC</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    x{formatNumber(item.quantity)}
                  </span>
                  <span className="text-xs font-mono text-primary min-w-[80px] text-right">
                    {formatISK(item.totalPrice)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function StatBox({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: string;
  variant?: "default" | "primary" | "profit" | "loss";
}) {
  const colorMap = {
    default: "text-foreground",
    primary: "text-primary",
    profit: "text-chart-2",
    loss: "text-destructive",
  };
  return (
    <div className="flex flex-col gap-0.5 p-2.5 rounded-md bg-muted/30">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`text-sm font-mono font-semibold ${colorMap[variant]}`}>
        {value}
      </span>
    </div>
  );
}
