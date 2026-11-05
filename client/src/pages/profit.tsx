import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatISKCompact, formatNumber, timeAgo } from "@/lib/format";
import { AlertTriangle, LogIn, LogOut, RefreshCw, Trash2, UserPlus, Wallet } from "lucide-react";
import type { LedgerItemRow, LedgerResponse, MeResponse } from "@shared/schema";

const PERIODS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "365", label: "1y" },
  { value: "all", label: "All" },
];

type ItemView = "sold" | "inventory" | "nobasis";

// Signed compact ISK: formatISKCompact only handles positive numbers.
function isk(value: number): string {
  return `${value < 0 ? "-" : ""}${formatISKCompact(Math.abs(value))}`;
}

function profitClass(value: number): string {
  if (value > 0) return "text-chart-2";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
}

function Kpi({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className={`font-mono text-xl font-semibold mt-1 ${className ?? "text-foreground"}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function CostOverrideInput({ item }: { item: LedgerItemRow }) {
  const { toast } = useToast();
  const [value, setValue] = useState(item.costOverride != null ? String(item.costOverride) : "");
  const save = useMutation({
    mutationFn: async (raw: string) => {
      const unitCost = raw.trim() === "" ? null : Number(raw.replace(/[\s,]/g, ""));
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) throw new Error("Enter a number");
      await apiRequest("PUT", `/api/ledger/cost-override/${item.typeId}`, { unitCost });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ledger"] }),
    onError: (err: Error) => toast({ title: "Cost not saved", description: err.message, variant: "destructive" }),
  });
  const commit = () => {
    const current = item.costOverride != null ? String(item.costOverride) : "";
    if (value.trim() !== current) save.mutate(value);
  };
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      placeholder="ISK / unit"
      className="h-7 w-28 font-mono text-xs"
      data-testid={`input-cost-${item.typeId}`}
    />
  );
}

function DailyChart({ data }: { data: LedgerResponse["daily"] }) {
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-sm">Daily trading profit</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={{ profit: { label: "Profit" } }} className="h-56 w-full aspect-auto">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tickFormatter={(d: string) => d.slice(5)}
              className="font-mono text-[10px]"
            />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => isk(v)} className="font-mono text-[10px]" />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.4} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as LedgerResponse["daily"][number];
                return (
                  <div className="rounded-md border bg-background px-3 py-2 font-mono text-xs shadow-md">
                    <div className="text-muted-foreground">{p.date}</div>
                    <div className="text-foreground">Profit {isk(p.profit)} ISK</div>
                    <div className="text-muted-foreground">Sales {isk(p.revenue)} ISK</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="profit" radius={[4, 4, 0, 0]} maxBarSize={18}>
              {data.map((d) => (
                <Cell key={d.date} fill={d.profit >= 0 ? "hsl(var(--chart-2))" : "hsl(var(--destructive))"} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function LoginCard({ ssoConfigured }: { ssoConfigured: boolean }) {
  return (
    <Card>
      <CardContent className="p-8 flex flex-col items-center gap-4 text-center">
        <Wallet className="w-10 h-10 text-muted-foreground/60" />
        <div className="font-mono text-sm text-foreground">Log in with a character to see what you actually earn</div>
        <p className="text-xs text-muted-foreground max-w-md">
          Reads the wallet journal, market transactions and industry jobs (read-only) and matches every sale against
          what you paid for it, first in first out. ESI only keeps 30 days, so history builds up from the day you log in.
        </p>
        {ssoConfigured ? (
          <Button asChild data-testid="button-login">
            <a href="/auth/eve/login">
              <LogIn className="w-4 h-4 mr-2" />
              Log in with EVE Online
            </a>
          </Button>
        ) : (
          <p className="text-xs font-mono text-destructive">
            EVE SSO is not configured on this server: set EVE_CLIENT_ID, EVE_CLIENT_SECRET, EVE_CALLBACK_URL and SESSION_SECRET.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProfitPage() {
  const { toast } = useToast();
  const [period, setPeriod] = useState("30");
  const [view, setView] = useState<ItemView>("sold");

  // The first sync runs in the background right after login; poll until every character has finished it.
  const me = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    refetchInterval: (q) =>
      q.state.data?.characters.some((c) => c.syncing || !c.lastSyncAt) ? 3000 : false,
  });
  const syncStamp = me.data?.characters.map((c) => c.lastSyncAt).join("|");
  useEffect(() => {
    // A sync finished (here or in the hourly background run): the ledger has new rows.
    if (syncStamp) queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
  }, [syncStamp]);
  const loggedIn = (me.data?.characters.length ?? 0) > 0;
  const ledgerUrl = `/api/ledger?days=${period}`;
  const ledger = useQuery<LedgerResponse>({ queryKey: ["/api/ledger", period], queryFn: () => apiRequest("GET", ledgerUrl).then((r) => r.json()), enabled: loggedIn });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/me"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
  };

  const sync = useMutation({
    mutationFn: () => apiRequest("POST", "/api/me/sync").then((r) => r.json()),
    onSuccess: (results: Array<{ skipped?: string; error?: string; transactions?: number; journal?: number }>) => {
      const added = results.reduce((s, r) => s + (r.transactions ?? 0) + (r.journal ?? 0), 0);
      const notes = results.map((r) => r.error || r.skipped).filter(Boolean);
      toast({ title: `Sync done: ${added} new rows`, description: notes.join("; ") || undefined });
      refresh();
    },
    onError: (err: Error) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const logout = useMutation({
    mutationFn: () => apiRequest("POST", "/auth/logout"),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/ledger"] });
      refresh();
    },
  });

  const removeChar = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/me/characters/${id}`),
    onSuccess: refresh,
  });

  if (me.isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const s = ledger.data?.summary;
  const items = (ledger.data?.items ?? []).filter((i) =>
    view === "sold" ? i.soldQty > 0 : view === "inventory" ? i.openQty > 0 : i.unmatchedQty > 0,
  );
  if (view === "inventory") items.sort((a, b) => b.openCost - a.openCost);
  if (view === "nobasis") items.sort((a, b) => b.unmatchedRevenue - a.unmatchedRevenue);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-lg font-semibold tracking-wide text-foreground" data-testid="text-profit-title">
            Profit &amp; Loss
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            FIFO-matched market trading across all your characters
          </p>
        </div>
        {loggedIn && (
          <Tabs value={period} onValueChange={setPeriod}>
            <TabsList>
              {PERIODS.map((p) => (
                <TabsTrigger key={p.value} value={p.value} className="font-mono text-xs" data-testid={`tab-period-${p.value}`}>
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {!loggedIn && <LoginCard ssoConfigured={me.data?.ssoConfigured ?? false} />}

      {loggedIn && (
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-3">
            {me.data!.characters.map((c) => (
              <div key={c.characterId} className="flex items-center gap-2 rounded-md border px-2 py-1.5" data-testid={`char-${c.characterId}`}>
                <img
                  src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=64`}
                  alt=""
                  className="w-8 h-8 rounded"
                />
                <div className="min-w-0">
                  <div className="font-mono text-xs text-foreground">{c.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {c.walletBalance != null ? `${isk(c.walletBalance)} ISK · ` : ""}
                    {c.syncing || !c.lastSyncAt ? "syncing…" : `synced ${timeAgo(c.lastSyncAt)}`}
                  </div>
                  {c.lastSyncError && (
                    <div className="flex items-center gap-1 text-[10px] text-destructive max-w-[16rem]" title={c.lastSyncError}>
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span className="truncate">{c.lastSyncError}</span>
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Unlink and delete this character's data"
                  onClick={() => {
                    if (confirm(`Unlink ${c.name} and delete its stored wallet history?`)) removeChar.mutate(c.characterId);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" asChild>
                <a href="/auth/eve/login" data-testid="button-add-character">
                  <UserPlus className="w-4 h-4 mr-1" /> Add character
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending} data-testid="button-sync">
                <RefreshCw className={`w-4 h-4 mr-1 ${sync.isPending ? "animate-spin" : ""}`} /> Sync now
              </Button>
              <Button variant="ghost" size="sm" onClick={() => logout.mutate()} data-testid="button-logout">
                <LogOut className="w-4 h-4 mr-1" /> Log out
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loggedIn && ledger.isLoading && <Skeleton className="h-64 w-full" />}
      {loggedIn && ledger.error && (
        <p className="text-xs font-mono text-destructive">Could not load the ledger: {(ledger.error as Error).message}</p>
      )}

      {s && ledger.data && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Net trading profit"
              value={`${isk(s.netTradingProfit)} ISK`}
              className={profitClass(s.netTradingProfit)}
              hint="Sales − FIFO cost − sales tax − broker fees"
            />
            <Kpi label="Sales (matched)" value={`${isk(s.revenue)} ISK`} hint={`Cost of goods ${isk(s.cogs)} ISK`} />
            <Kpi
              label="Fees"
              value={`${isk(s.salesTax + s.brokerFees)} ISK`}
              hint={`Sales tax ${isk(s.salesTax)} · broker ${isk(s.brokerFees)}`}
            />
            <Kpi label="Industry costs" value={`${isk(s.industryCost)} ISK`} hint="Job install fees from the journal; not in trading profit" />
            <Kpi
              label="Sales without cost basis"
              value={`${isk(s.unmatchedRevenue)} ISK`}
              className={s.unmatchedRevenue > 0 ? "text-chart-3" : undefined}
              hint="Mined, reacted, built or looted items. Set a unit cost to count them as profit."
            />
            <Kpi label="Bought, not yet sold" value={`${isk(s.inventoryAtCost)} ISK`} hint="At cost. Includes materials that went into jobs." />
            <Kpi label="Wallet balance" value={`${isk(s.walletBalance)} ISK`} hint="All characters, as of the last sync" />
            <Kpi
              label="Wallet cash flow"
              value={`${isk(s.cashFlow)} ISK`}
              className={profitClass(s.cashFlow)}
              hint="Every journal entry in the period, buying stock included"
            />
          </div>

          {ledger.data.oldestDataAt && (
            <p className="text-[11px] font-mono text-muted-foreground">
              Data since {ledger.data.oldestDataAt.slice(0, 10)} · {formatNumber(s.transactionCount)} transactions in period
            </p>
          )}

          <DailyChart data={ledger.data.daily} />

          <Card>
            <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="font-mono text-sm">By item</CardTitle>
              <Tabs value={view} onValueChange={(v) => setView(v as ItemView)}>
                <TabsList>
                  <TabsTrigger value="sold" className="font-mono text-xs">Sold</TabsTrigger>
                  <TabsTrigger value="inventory" className="font-mono text-xs">Inventory</TabsTrigger>
                  <TabsTrigger value="nobasis" className="font-mono text-xs">
                    No cost basis
                    {ledger.data.items.some((i) => i.unmatchedQty > 0) && (
                      <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px]">
                        {ledger.data.items.filter((i) => i.unmatchedQty > 0).length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {items.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground py-6 text-center">Nothing here for this period yet.</p>
              ) : (
                <Table className="font-mono text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      {view === "sold" && (
                        <>
                          <TableHead className="text-right">Sold</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Tax</TableHead>
                          <TableHead className="text-right">Profit</TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                          <TableHead className="text-right">No basis</TableHead>
                        </>
                      )}
                      {view === "inventory" && (
                        <>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">At cost</TableHead>
                          <TableHead className="text-right">Avg cost</TableHead>
                        </>
                      )}
                      {view === "nobasis" && (
                        <>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead>Unit cost</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => (
                      <TableRow key={i.typeId} data-testid={`row-item-${i.typeId}`}>
                        <TableCell className="flex items-center gap-2 min-w-[14rem]">
                          <img src={`https://images.evetech.net/types/${i.typeId}/icon?size=32`} alt="" className="w-5 h-5" />
                          <span className="text-foreground">{i.typeName}</span>
                          {i.costOverride != null && view !== "nobasis" && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]" title={`Unit cost set to ${i.costOverride} ISK`}>
                              manual cost
                            </Badge>
                          )}
                        </TableCell>
                        {view === "sold" && (
                          <>
                            <TableCell className="text-right">{formatNumber(i.soldQty)}</TableCell>
                            <TableCell className="text-right">{isk(i.revenue)}</TableCell>
                            <TableCell className="text-right">{isk(i.cogs)}</TableCell>
                            <TableCell className="text-right">{isk(i.salesTax)}</TableCell>
                            <TableCell className={`text-right ${profitClass(i.profit)}`}>{isk(i.profit)}</TableCell>
                            <TableCell className="text-right">{i.marginPercent != null ? `${i.marginPercent.toFixed(1)}%` : "—"}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {i.unmatchedQty > 0 ? formatNumber(i.unmatchedQty) : ""}
                            </TableCell>
                          </>
                        )}
                        {view === "inventory" && (
                          <>
                            <TableCell className="text-right">{formatNumber(i.openQty)}</TableCell>
                            <TableCell className="text-right">{isk(i.openCost)}</TableCell>
                            <TableCell className="text-right">{isk(i.openCost / i.openQty)}</TableCell>
                          </>
                        )}
                        {view === "nobasis" && (
                          <>
                            <TableCell className="text-right">{formatNumber(i.unmatchedQty)}</TableCell>
                            <TableCell className="text-right">{isk(i.unmatchedRevenue)}</TableCell>
                            <TableCell>
                              <CostOverrideInput item={i} />
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm">Wallet journal by type</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table className="font-mono text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.data.refTypes.map((r) => (
                    <TableRow key={r.refType}>
                      <TableCell className="text-foreground">{r.refType.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-right">{r.income ? isk(r.income) : ""}</TableCell>
                      <TableCell className="text-right">{r.expense ? isk(r.expense) : ""}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatNumber(r.count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
