import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "./db";
import { esiAuth, INTERACTIVE } from "./character-sync";
import { esiPublic } from "./trade-profile";
import { eveCharacters, industryJobs, walletJournal, walletTransactions } from "@shared/schema";
import { BROKER_FEE_BASE, SKILL, TRACKED_SKILLS, type SkillData, type SkillMeta } from "@shared/skills";

// Dogma attribute ids on skill types.
const ATTR = { rank: 275, primary: 180, secondary: 181 };
const PREREQS = [
  [182, 277],
  [183, 278],
  [184, 279],
];

// Reactions are activity 9 in some ESI data and 11 in the SDE; count both.
const REACTION_ACTIVITIES = [9, 11];
const MANUFACTURING_ACTIVITY = 1;

async function skillMeta(id: number): Promise<SkillMeta> {
  const t = await esiPublic<{ name: string; dogma_attributes?: Array<{ attribute_id: number; value: number }> }>(
    `/universe/types/${id}/`,
  );
  const a = new Map((t.dogma_attributes ?? []).map((x) => [x.attribute_id, x.value]));
  return {
    name: t.name,
    rank: a.get(ATTR.rank) ?? 1,
    primary: a.get(ATTR.primary) ?? 165,
    secondary: a.get(ATTR.secondary) ?? 166,
    prereqs: PREREQS.filter(([s]) => a.has(s)).map(([s, l]) => ({ id: a.get(s)!, level: a.get(l) ?? 1 })),
  };
}

/** Tracked skills plus every prerequisite they pull in (type data is cached for the process lifetime). */
async function allMeta(): Promise<Record<number, SkillMeta>> {
  const meta: Record<number, SkillMeta> = {};
  let queue = TRACKED_SKILLS.map((s) => s.id);
  while (queue.length) {
    const fetched = await Promise.all(queue.map(async (id) => [id, await skillMeta(id)] as const));
    const next: number[] = [];
    fetched.forEach(([id, m]) => {
      meta[id] = m;
      m.prereqs.forEach((p) => {
        if (!meta[p.id] && !queue.includes(p.id) && !next.includes(p.id)) next.push(p.id);
      });
    });
    queue = next;
  }
  return meta;
}

const sum = (xs: Array<number | null>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

export async function buildSkillData(accountId: string, characterId: number): Promise<SkillData | null> {
  const [ch] = await db
    .select()
    .from(eveCharacters)
    .where(and(eq(eveCharacters.characterId, characterId), eq(eveCharacters.accountId, accountId)));
  if (!ch) return null;
  if (!ch.scopes.includes("esi-skills.read_skills.v1")) {
    throw Object.assign(new Error("Log in with this character again to grant skill access"), { status: 403 });
  }

  const warnings: string[] = [];
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [meta, skillsRes, attrsRes, ordersRes, txs, journal, jobs] = await Promise.all([
    allMeta(),
    esiAuth<{ skills: Array<{ skill_id: number; active_skill_level: number; skillpoints_in_skill: number }> }>(
      characterId,
      `/characters/${characterId}/skills/`,
      {},
      INTERACTIVE,
    ),
    esiAuth<Record<string, number>>(characterId, `/characters/${characterId}/attributes/`, {}, INTERACTIVE).catch(
      (err) => {
        warnings.push(`Атрибуты не прочитались (${err.message}): время обучения посчитано для 17/17.`);
        return null;
      },
    ),
    ch.scopes.includes("esi-markets.read_character_orders.v1")
      ? esiAuth<unknown[]>(characterId, `/characters/${characterId}/orders/`, {}, INTERACTIVE).catch((err) => {
          warnings.push(`Ордера не прочитались (${err.message}): не видно, упёрлись ли вы в лимит.`);
          return null;
        })
      : Promise.resolve(null),
    db
      .select()
      .from(walletTransactions)
      .where(and(eq(walletTransactions.characterId, characterId), gte(walletTransactions.date, since))),
    db
      .select()
      .from(walletJournal)
      .where(
        and(
          eq(walletJournal.characterId, characterId),
          gte(walletJournal.date, since),
          inArray(walletJournal.refType, ["transaction_tax", "brokers_fee"]),
        ),
      ),
    db.select().from(industryJobs).where(eq(industryJobs.characterId, characterId)),
  ]);

  const skills: SkillData["skills"] = {};
  skillsRes.data.skills.forEach((s) => {
    skills[s.skill_id] = { level: s.active_skill_level, sp: s.skillpoints_in_skill };
  });

  const attributes: Record<number, number> = {};
  if (attrsRes) {
    const a = attrsRes.data;
    Object.assign(attributes, {
      164: a.charisma,
      165: a.intelligence,
      166: a.memory,
      167: a.perception,
      168: a.willpower,
    });
  }

  const brokerPaid30 = -sum(journal.filter((j) => j.refType === "brokers_fee").map((j) => j.amount));
  const brokerLevel = skills[SKILL.brokerRelations]?.level ?? 0;
  // Fees paid ÷ the rate they were charged at = value of the orders placed. Standings are left out, so this
  // slightly understates the order value (and so the skill's worth) for characters that have them.
  const brokerRate = (BROKER_FEE_BASE - 0.3 * brokerLevel) / 100;

  if (txs.length === 0) {
    warnings.push("Нет сделок за 30 дней в синхронизированных данных: введите оборот вручную, чтобы оценить торговые навыки.");
  }

  const active = jobs.filter((j) => j.status === "active");
  return {
    characterId,
    name: ch.name,
    attributes,
    skills,
    meta,
    metrics: {
      sales30: sum(txs.filter((t) => !t.isBuy).map((t) => t.quantity * t.unitPrice)),
      orderValue30: brokerPaid30 > 0 ? brokerPaid30 / brokerRate : null,
      salesTaxPaid30: -sum(journal.filter((j) => j.refType === "transaction_tax").map((j) => j.amount)),
      brokerPaid30,
      openOrders: ordersRes ? ordersRes.data.length : null,
      activeReactions: active.filter((j) => REACTION_ACTIVITIES.includes(j.activityId)).length,
      activeManufacturing: active.filter((j) => j.activityId === MANUFACTURING_ACTIVITY).length,
      reactionJobsSeen: jobs.filter((j) => REACTION_ACTIVITIES.includes(j.activityId)).length,
      manufacturingJobsSeen: jobs.filter((j) => j.activityId === MANUFACTURING_ACTIVITY).length,
    },
    warnings,
  };
}
