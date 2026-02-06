import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookmarkCheck,
  Trash2,
  TrendingUp,
  TrendingDown,
  Package,
  Loader2,
} from "lucide-react";
import { formatISK, formatPercent, formatNumber, timeAgo } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SavedContract } from "@shared/schema";

export default function SavedPage() {
  const { toast } = useToast();

  const savedQuery = useQuery<SavedContract[]>({
    queryKey: ["/api/contracts/saved"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/contracts/saved/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/saved"] });
      toast({ title: "Removed", description: "Contract removed from saved deals." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <div>
        <h2
          className="font-mono text-lg font-semibold tracking-wide text-foreground"
          data-testid="text-saved-title"
        >
          Saved Deals
        </h2>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          Your bookmarked profitable contracts
        </p>
      </div>

      {savedQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-20" />
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

      {savedQuery.data && savedQuery.data.length === 0 && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
            <BookmarkCheck className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground font-mono text-center">
              No saved contracts yet.
              <br />
              Scan for contracts and bookmark the best deals.
            </p>
          </CardContent>
        </Card>
      )}

      {savedQuery.data && savedQuery.data.length > 0 && (
        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-3">
            {savedQuery.data.map((contract) => {
              const isProfit = contract.margin > 0;
              return (
                <Card key={contract.id} data-testid={`card-saved-${contract.id}`}>
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
                            {contract.contractType}
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
                            <span
                              className={`text-xs font-mono font-semibold ${isProfit ? "text-chart-2" : "text-destructive"}`}
                            >
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
                          {contract.savedAt && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {timeAgo(contract.savedAt.toString())}
                            </span>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(contract.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${contract.id}`}
                        >
                          {deleteMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
