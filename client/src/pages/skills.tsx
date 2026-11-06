import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { formatISKCompact } from "@/lib/format";
import { AlertTriangle, ArrowRight, Clock, GraduationCap, Lock, RotateCcw, TrendingUp } from "lucide-react";
import type { MeResponse } from "@shared/schema";
import {
  SKILL_GROUPS,
  adviseSkills,
  formatDuration,
  manufacturingSlots,
  orderSlots,
  reactionSlots,
  type SkillAdvice,
  type SkillData,
  type Verdict,
} from "@shared/skills";

const isk = (v: number) => `${formatISKCompact(Math.max(0, v))} ISK`;

const VERDICT: Record<Verdict, { label: string; className: string }> = {
  now: { label: "Сейчас", className: "bg-chart-2/15 text-chart-2 border-chart-2/40" },
  soon: { label: "Следом", className: "bg-primary/10 text-primary border-primary/30" },
  later: { label: "Потом", className: "text-muted-foreground border-border" },
  maxed: { label: "V", className: "text-muted-foreground border-border" },
};

/** Five squares, filled up to the trained level; the next level is outlined in the accent colour. */
function LevelPips({ level, highlightNext }: { level: number; highlightNext: boolean }) {
  return (
    <div className="flex gap-0.5" aria-label={`Уровень ${level} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-[2px] border ${
            i <= level
              ? "bg-foreground/80 border-foreground/80"
              : i === level + 1 && highlightNext
                ? "border-chart-2 bg-chart-2/20"
                : "border-border"
          }`}
        />
      ))}
    </div>
  );
}

function Meter({ used, total, label }: { used: number | null; total: number; label: string }) {
  const full = used != null && used >= total;
  const share = used == null ? 0 : Math.min(1, used / total);
  return (
    <Card className={full ? "border-destructive/50" : undefined}>
      <CardContent className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="font-mono text-xl font-semibold mt-1 text-foreground">
          {used ?? "—"}
          <span className="text-muted-foreground text-base"> / {total}</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
          <div
            className={`h-full rounded-full ${full ? "bg-destructive" : "bg-chart-2"}`}
            style={{ width: `${share * 100}%` }}
          />
        </div>
        <div className={`text-[11px] mt-1.5 ${full ? "text-destructive" : "text-muted-foreground"}`}>
          {used == null ? "нет данных" : full ? "Упёрлись в лимит" : `свободно ${total - used}`}
        </div>
      </CardContent>
    </Card>
  );
}

function valueLine(r: SkillAdvice): { text: string; strong: boolean } | null {
  if (!r.nextLevel) return null;
  if (r.iskPerMonth != null) {
    return r.iskPerMonth > 0
      ? { text: `+${isk(r.iskPerMonth)}/мес`, strong: true }
      : { text: "нет оборота для оценки", strong: false };
  }
  return r.gain ? { text: r.gain, strong: r.capped } : null;
}

function PickCard({ r, place }: { r: SkillAdvice; place: number }) {
  const v = valueLine(r);
  const days = (r.trainMinutes ?? 0) / 1440;
  return (
    <Card className={`relative overflow-hidden ${place === 1 ? "border-chart-2/50" : ""}`} data-testid={`pick-${r.id}`}>
      <CardContent className="p-4 flex flex-col gap-3 h-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">#{place}</div>
            <div className="font-mono text-sm font-semibold text-foreground mt-0.5">{r.name}</div>
          </div>
          <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground shrink-0">
            {r.level}
            <ArrowRight className="w-3 h-3" />
            <span className="text-chart-2 font-semibold">{r.nextLevel}</span>
          </div>
        </div>

        {v && (
          <div className={`font-mono text-lg font-semibold ${v.strong ? "text-chart-2" : "text-foreground"}`}>{v.text}</div>
        )}
        <div className="text-xs text-muted-foreground leading-snug flex-1">{r.why}</div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-muted-foreground border-t pt-2">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(r.trainMinutes ?? 0)}
          </span>
          {r.iskPerMonth != null && r.iskPerMonth > 0 && days > 0 && (
            <span title="Сколько ISK в месяц приносит каждый день обучения">
              {isk(r.iskPerMonth / Math.max(days, 0.04))}/мес за день обучения
            </span>
          )}
          {r.capped && <span className="text-destructive">лимит исчерпан</span>}
        </div>
        {r.missingPrereqs.length > 0 && (
          <div className="flex items-start gap-1 text-[11px] text-chart-3">
            <Lock className="w-3 h-3 shrink-0 mt-0.5" />
            Сначала: {r.missingPrereqs.map((p) => `${p.name} ${p.level}`).join(", ")} (время уже учтено)
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SkillRow({ r }: { r: SkillAdvice }) {
  const v = valueLine(r);
  const verdict = VERDICT[r.verdict];
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[14rem_4.5rem_minmax(0,1fr)_6rem_9rem_4.5rem] items-center gap-x-4 gap-y-1 px-3 py-2.5 border-t first:border-t-0 ${
        r.verdict === "maxed" ? "opacity-50" : ""
      }`}
      data-testid={`skill-${r.id}`}
    >
      <div className="font-mono text-xs text-foreground truncate" title={r.why}>
        {r.name}
      </div>
      <div className="xl:order-none order-first col-start-2 row-start-1 xl:col-start-auto xl:row-start-auto justify-self-end xl:justify-self-start">
        <LevelPips level={r.level} highlightNext={r.verdict === "now" || r.verdict === "soon"} />
      </div>
      <div className="text-xs text-muted-foreground col-span-2 xl:col-span-1 min-w-0">
        <span>{r.now}</span>
        {r.next && (
          <>
            <ArrowRight className="inline w-3 h-3 mx-1 -mt-0.5" />
            <span className="text-foreground">{r.next}</span>
          </>
        )}
        {r.missingPrereqs.length > 0 && (
          <span className="ml-2 text-chart-3" title={r.missingPrereqs.map((p) => `${p.name} ${p.level}`).join(", ")}>
            <Lock className="inline w-3 h-3 -mt-0.5" /> нужны пререквизиты
          </span>
        )}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground xl:text-right">
        {r.trainMinutes != null ? formatDuration(r.trainMinutes) : ""}
      </div>
      <div className={`font-mono text-[11px] xl:text-right ${v?.strong ? "text-chart-2" : "text-muted-foreground"}`}>
        {v?.text ?? ""}
      </div>
      <div className="xl:text-right">
        <Badge variant="outline" className={`font-mono text-[10px] ${verdict.className}`}>
          {verdict.label}
        </Badge>
      </div>
    </div>
  );
}

function IskInput({
  label,
  value,
  onChange,
  source,
  onReset,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  source: string;
  onReset: (() => void) | null;
}) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  return (
    <div className="space-y-1 min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <Input
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text.replace(/[\s,]/g, ""));
            if (Number.isFinite(n) && n >= 0) onChange(n);
            else setText(String(Math.round(value)));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-8 font-mono text-sm"
        />
        <span className="font-mono text-xs text-muted-foreground shrink-0">ISK/мес</span>
        {onReset && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onReset} title="Вернуть из данных кошелька">
            <RotateCcw className="w-3 h-3" />
          </Button>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground">{source}</div>
    </div>
  );
}

export default function SkillsPage() {
  const me = useQuery<MeResponse>({ queryKey: ["/api/me"] });
  const chars = me.data?.characters ?? [];
  const [characterId, setCharacterId] = useState<number | undefined>();
  useEffect(() => {
    if (chars.length && !chars.some((c) => c.characterId === characterId)) setCharacterId(chars[0].characterId);
  }, [chars, characterId]);

  const data = useQuery<SkillData>({
    queryKey: ["/api/me/skills", characterId],
    queryFn: () => apiRequest("GET", `/api/me/skills?characterId=${characterId}`).then((r) => r.json()),
    enabled: !!characterId,
    staleTime: 10 * 60 * 1000,
  });

  // What-if turnover: starts from the wallet data, the player can type their own.
  const measuredSales = data.data?.metrics.sales30 ?? 0;
  const measuredOrders = data.data?.metrics.orderValue30 ?? measuredSales;
  const [sales, setSales] = useState<number | null>(null);
  const [orders, setOrders] = useState<number | null>(null);
  useEffect(() => {
    setSales(null);
    setOrders(null);
  }, [characterId]);

  const rows = useMemo(
    () =>
      data.data
        ? adviseSkills(data.data, {
            salesPerMonth: sales ?? measuredSales,
            orderValuePerMonth: orders ?? measuredOrders,
          })
        : [],
    [data.data, sales, orders, measuredSales, measuredOrders],
  );
  const picks = rows.filter((r) => r.verdict === "now").sort((a, b) => b.score - a.score);

  if (me.isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const d = data.data;
  const m = d?.metrics;

  return (
    <div className="flex flex-col gap-5 p-4 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-lg font-semibold tracking-wide text-foreground flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            Навыки
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Что вкачать следующим, чтобы зарабатывать больше, и сколько это даст
          </p>
        </div>
        {chars.length > 0 && (
          <Select value={characterId ? String(characterId) : undefined} onValueChange={(v) => setCharacterId(Number(v))}>
            <SelectTrigger className="w-56 h-9 font-mono text-xs" data-testid="select-skills-character">
              <SelectValue placeholder="Персонаж" />
            </SelectTrigger>
            <SelectContent>
              {chars.map((c) => (
                <SelectItem key={c.characterId} value={String(c.characterId)} className="font-mono text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {chars.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm font-mono text-muted-foreground">
            <Link href="/profit" className="text-primary hover:underline">
              Войдите персонажем
            </Link>
            , чтобы увидеть, какие навыки качать.
          </CardContent>
        </Card>
      )}

      {data.isLoading && characterId && <Skeleton className="h-64 w-full" />}
      {data.error && (
        <p className="flex items-center gap-2 text-xs font-mono text-destructive">
          <AlertTriangle className="w-4 h-4" />
          {(data.error as Error).message}
        </p>
      )}

      {d && m && (
        <>
          {d.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 text-[11px] font-mono text-chart-3 -mt-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              {w}
            </p>
          ))}

          {/* Where the character stands */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Отдали CCP за 30 дней</div>
                <div className="font-mono text-xl font-semibold mt-1 text-foreground">
                  {isk(m.salesTaxPaid30 + m.brokerPaid30)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  налог {isk(m.salesTaxPaid30)} · брокер {isk(m.brokerPaid30)}
                </div>
              </CardContent>
            </Card>
            <Meter label="Ордера" used={m.openOrders} total={orderSlots(d.skills)} />
            <Meter label="Слоты реакций" used={m.activeReactions} total={reactionSlots(d.skills)} />
            <Meter label="Слоты производства" used={m.activeManufacturing} total={manufacturingSlots(d.skills)} />
          </div>

          {/* What-if turnover */}
          <Card>
            <CardContent className="p-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] items-end">
              <IskInput
                label="Продажи в месяц"
                value={sales ?? measuredSales}
                onChange={setSales}
                source={sales == null ? "по вашим сделкам за 30 дней" : "ваша оценка"}
                onReset={sales == null ? null : () => setSales(null)}
              />
              <IskInput
                label="Выставлено ордеров в месяц"
                value={orders ?? measuredOrders}
                onChange={setOrders}
                source={
                  orders != null
                    ? "ваша оценка"
                    : m.orderValue30 != null
                      ? "по брокерским комиссиям за 30 дней"
                      : "нет комиссий в данных: взято равным продажам"
                }
                onReset={orders == null ? null : () => setOrders(null)}
              />
              <p className="text-[11px] text-muted-foreground max-w-xs leading-snug">
                От этих сумм считается, сколько ISK в месяц экономит следующий уровень Accounting и Broker Relations.
              </p>
            </CardContent>
          </Card>

          {/* Top picks */}
          {picks.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" /> Качать сейчас
              </h3>
              <div className="grid gap-3 md:grid-cols-3">
                {picks.map((r, i) => (
                  <PickCard key={r.id} r={r} place={i + 1} />
                ))}
              </div>
            </section>
          )}

          {/* Everything, by what it does */}
          <section className="space-y-4">
            {SKILL_GROUPS.map((g) => {
              const groupRows = rows.filter((r) => r.group === g.id);
              return (
                <div key={g.id} className="space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-mono text-xs uppercase tracking-widest text-foreground">{g.title}</h3>
                    <span className="text-[11px] text-muted-foreground">{g.hint}</span>
                  </div>
                  <Card>
                    <CardContent className="p-0">
                      {groupRows.map((r) => (
                        <SkillRow key={r.id} r={r} />
                      ))}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </section>

          <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
            Время обучения для Омега-клона по вашим атрибутам без имплантов (ESI их не отдаёт): с имплантами будет
            быстрее. Налог с продаж 7.5% × (1 − 11% × Accounting), брокер 3% − 0.3% × Broker Relations без стендингов.
          </p>
        </>
      )}
    </div>
  );
}
