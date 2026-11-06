import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, RotateCcw, UserCheck } from "lucide-react";
import {
  MARKET_HUBS,
  type MeResponse,
  type TradeProfile,
} from "@shared/schema";

const STORAGE_KEY = "eve-fee-character";

/** The calculators' built-in rates: NPC station with Accounting V and Broker Relations V, no standings. */
export const DEFAULT_FEES = { salesTax: 3.6, brokerFee: 1.5 };

function DefaultsButton({
  onApply,
}: {
  onApply: (fees: { salesTax?: number; brokerFee?: number }) => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 font-mono text-xs shrink-0"
      title="Accounting V, Broker Relations V, no standings"
      onClick={() => onApply(DEFAULT_FEES)}
      data-testid="button-default-fees"
    >
      <RotateCcw className="w-3 h-3 mr-1.5" />
      Defaults
    </Button>
  );
}

function loadChoice(): { characterId?: number; stationId?: number } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveChoice(choice: { characterId: number; stationId: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // private mode: the choice just is not remembered
  }
}

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
const standing = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

/**
 * Fills a calculator's sales tax and broker fee from a logged-in character: Accounting, Broker Relations and
 * NPC standings toward the station owner, or the tax actually charged on its recent sales when there are any.
 */
export function CharacterFees({
  onApply,
}: {
  onApply: (fees: { salesTax?: number; brokerFee?: number }) => void;
}) {
  const me = useQuery<MeResponse>({ queryKey: ["/api/me"] });
  const saved = loadChoice();
  const [characterId, setCharacterId] = useState<number | undefined>(
    saved.characterId,
  );
  const [stationId, setStationId] = useState<number>(
    saved.stationId ?? MARKET_HUBS[0].stationId,
  );

  const chars = me.data?.characters ?? [];
  useEffect(() => {
    if (chars.length && !chars.some((c) => c.characterId === characterId))
      setCharacterId(chars[0].characterId);
  }, [chars, characterId]);

  const profile = useQuery<TradeProfile>({
    queryKey: ["/api/me/trade-profile", characterId, stationId],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/me/trade-profile?characterId=${characterId}&stationId=${stationId}`,
      ).then((r) => r.json()),
    enabled: !!characterId,
    staleTime: 10 * 60 * 1000,
  });

  if (me.isLoading) return null;
  if (chars.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono text-muted-foreground">
          <Link
            href="/profit"
            className="text-primary underline-offset-2 hover:underline"
          >
            Log in with a character
          </Link>{" "}
          to fill these from your skills and standings.
        </p>
        <DefaultsButton onApply={onApply} />
      </div>
    );
  }

  const p = profile.data;
  // Apply whatever is known: e.g. the tax seen on past sales even while skills cannot be read.
  const canApply = p?.salesTax.value != null || p?.brokerFee.value != null;

  return (
    <div
      className="space-y-2 rounded-md border border-border p-2.5"
      data-testid="character-fees"
    >
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={characterId ? String(characterId) : undefined}
          onValueChange={(v) => setCharacterId(Number(v))}
        >
          <SelectTrigger
            className="h-8 font-mono text-xs"
            data-testid="select-fee-character"
          >
            <SelectValue placeholder="Character" />
          </SelectTrigger>
          <SelectContent>
            {chars.map((c) => (
              <SelectItem
                key={c.characterId}
                value={String(c.characterId)}
                className="font-mono text-xs"
              >
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(stationId)}
          onValueChange={(v) => setStationId(Number(v))}
        >
          <SelectTrigger
            className="h-8 font-mono text-xs"
            data-testid="select-fee-station"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKET_HUBS.map((h) => (
              <SelectItem
                key={h.stationId}
                value={String(h.stationId)}
                className="font-mono text-xs"
              >
                {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {profile.isLoading && (
        <p className="text-[10px] font-mono text-muted-foreground">
          Reading skills and standings…
        </p>
      )}
      {profile.error && (
        <p className="flex items-start gap-1 text-[10px] font-mono text-destructive">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
          {(profile.error as Error).message}
        </p>
      )}

      {p && (
        <div className="space-y-1 font-mono text-[10px] text-muted-foreground">
          {p.skills && (
            <div>
              Accounting {p.skills.accounting} · Broker Relations{" "}
              {p.skills.brokerRelations}
            </div>
          )}
          {p.standings && (
            <div
              title={`${p.station.ownerCorpName}${p.station.factionName ? ` / ${p.station.factionName}` : ""}`}
            >
              Standing: {p.station.ownerCorpName} {standing(p.standings.corp)}
              {p.station.factionName &&
                ` · ${p.station.factionName} ${standing(p.standings.faction)}`}
            </div>
          )}
          {[p.skillsError, p.standingsError].filter(Boolean).map((e) => (
            <div key={e} className="flex items-start gap-1 text-chart-3">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
              {e}
            </div>
          ))}
          <div className="flex justify-between text-foreground pt-1">
            <span>Sales tax</span>
            <span>{pct(p.salesTax.value)}</span>
          </div>
          <div className="text-[9px]">
            {p.salesTax.observed != null
              ? `charged on your last ${p.salesTax.observedSamples} sales (formula: ${pct(p.salesTax.formula)})`
              : `${p.base.salesTax}% × (1 − 11% × Accounting)`}
          </div>
          <div className="flex justify-between text-foreground">
            <span>Broker fee</span>
            <span>{pct(p.brokerFee.value)}</span>
          </div>
          <div className="text-[9px]">
            {p.base.brokerFee}% − 0.3 × BR − 0.03 × faction − 0.02 × corp
            {!p.standings && " (standings taken as 0)"}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 font-mono text-xs"
          disabled={!canApply}
          onClick={() => {
            if (!p || !canApply || !characterId) return;
            saveChoice({ characterId, stationId });
            onApply({
              salesTax: p.salesTax.value ?? undefined,
              brokerFee: p.brokerFee.value ?? undefined,
            });
          }}
          data-testid="button-apply-character-fees"
        >
          <UserCheck className="w-3 h-3 mr-1.5" />
          Use these rates
        </Button>
        <DefaultsButton onApply={onApply} />
      </div>
    </div>
  );
}
