import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  History,
  Search,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { formatPercent, formatNumber, timeAgo } from "@/lib/format";
import type { ScanHistory } from "@shared/schema";

export default function HistoryPage() {
  const historyQuery = useQuery<ScanHistory[]>({
    queryKey: ["/api/scan/history"],
  });

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <div>
        <h2
          className="font-mono text-lg font-semibold tracking-wide text-foreground"
          data-testid="text-history-title"
        >
          Scan History
        </h2>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          Previous contract scan results
        </p>
      </div>

      {historyQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {historyQuery.data && historyQuery.data.length === 0 && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
            <History className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground font-mono text-center">
              No scan history yet.
              <br />
              Start scanning contracts to build your history.
            </p>
          </CardContent>
        </Card>
      )}

      {historyQuery.data && historyQuery.data.length > 0 && (
        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-3">
            {historyQuery.data.map((entry) => (
              <Card key={entry.id} data-testid={`card-history-${entry.id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10">
                      <Search className="w-5 h-5 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium text-foreground">
                          {entry.regionName}
                        </span>
                        {entry.scannedAt && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {timeAgo(entry.scannedAt.toString())}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <BarChart3 className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs font-mono text-muted-foreground">
                            {formatNumber(entry.totalContracts)} total
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Search className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs font-mono text-muted-foreground">
                            {formatNumber(entry.analyzedContracts)} analyzed
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3 text-chart-2" />
                          <span className="text-xs font-mono text-chart-2">
                            {entry.profitableContracts} profitable
                          </span>
                        </div>
                      </div>
                    </div>

                    {entry.bestMargin !== null && entry.bestMargin !== undefined && (
                      <Badge variant="outline" className="font-mono text-xs text-chart-2 border-chart-2/30">
                        Best: {formatPercent(entry.bestMargin)}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
