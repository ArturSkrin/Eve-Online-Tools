// Skill advisor: which trade and industry skills to train next, and what each level is worth.
// Shared by the server (which gathers the character's data) and the page (which recomputes values live when
// the player edits the turnover assumptions).

export type SkillGroup = "taxes" | "orders" | "reach" | "reactions" | "manufacturing" | "gas";

export const SKILL_GROUPS: Array<{ id: SkillGroup; title: string; hint: string }> = [
  { id: "taxes", title: "Налоги и комиссии", hint: "Каждая продажа и каждый ордер" },
  { id: "orders", title: "Слоты ордеров", hint: "Сколько ордеров можно держать одновременно" },
  { id: "reactions", title: "Реакции", hint: "Скорость и число одновременных реакций" },
  { id: "manufacturing", title: "Производство", hint: "Скорость и число одновременных работ" },
  { id: "gas", title: "Газ", hint: "Добыча и декомпрессия" },
  { id: "reach", title: "Удалённая торговля", hint: "Торговать, не летая в хаб" },
];

export const SKILL = {
  accounting: 16622,
  brokerRelations: 3446,
  advancedBrokerRelations: 16597,
  trade: 3443,
  retail: 3444,
  wholesale: 16596,
  tycoon: 18580,
  marketing: 16598,
  procurement: 16594,
  daytrading: 16595,
  visibility: 3447,
  reactions: 45746,
  massReactions: 45748,
  advancedMassReactions: 45749,
  remoteReactions: 45750,
  industry: 3380,
  advancedIndustry: 3388,
  massProduction: 3387,
  advancedMassProduction: 24625,
  supplyChainManagement: 24268,
  gasCloudHarvesting: 25544,
  gasDecompressionEfficiency: 62452,
} as const;

// Order of appearance inside each group.
export const TRACKED_SKILLS: Array<{ id: number; group: SkillGroup }> = [
  { id: SKILL.accounting, group: "taxes" },
  { id: SKILL.brokerRelations, group: "taxes" },
  { id: SKILL.advancedBrokerRelations, group: "taxes" },
  { id: SKILL.trade, group: "orders" },
  { id: SKILL.retail, group: "orders" },
  { id: SKILL.wholesale, group: "orders" },
  { id: SKILL.tycoon, group: "orders" },
  { id: SKILL.reactions, group: "reactions" },
  { id: SKILL.massReactions, group: "reactions" },
  { id: SKILL.advancedMassReactions, group: "reactions" },
  { id: SKILL.remoteReactions, group: "reactions" },
  { id: SKILL.industry, group: "manufacturing" },
  { id: SKILL.advancedIndustry, group: "manufacturing" },
  { id: SKILL.massProduction, group: "manufacturing" },
  { id: SKILL.advancedMassProduction, group: "manufacturing" },
  { id: SKILL.supplyChainManagement, group: "manufacturing" },
  { id: SKILL.gasCloudHarvesting, group: "gas" },
  { id: SKILL.gasDecompressionEfficiency, group: "gas" },
  { id: SKILL.marketing, group: "reach" },
  { id: SKILL.procurement, group: "reach" },
  { id: SKILL.daytrading, group: "reach" },
  { id: SKILL.visibility, group: "reach" },
];

/** Skill points a skill of rank 1 needs to reach each level (×rank for others). */
const SP_PER_RANK = [0, 250, 1415, 8000, 45255, 256000];
export const spForLevel = (rank: number, level: number) => SP_PER_RANK[level] * rank;

export const ATTRIBUTE_NAMES: Record<number, string> = {
  164: "Charisma",
  165: "Intelligence",
  166: "Memory",
  167: "Perception",
  168: "Willpower",
};

export const SALES_TAX_BASE = 7.5;
export const BROKER_FEE_BASE = 3;

// --- data the server gathers --------------------------------------------------------------------------------

export interface SkillMeta {
  name: string;
  rank: number;
  primary: number;
  secondary: number;
  prereqs: Array<{ id: number; level: number }>;
}

export interface SkillData {
  characterId: number;
  name: string;
  /** Attribute id → value, without implants (ESI does not include them). */
  attributes: Record<number, number>;
  skills: Record<number, { level: number; sp: number }>;
  /** Tracked skills and everything they require. */
  meta: Record<number, SkillMeta>;
  metrics: {
    /** Sell transactions over the last 30 days, ISK. */
    sales30: number;
    /** Market order value placed over 30 days, estimated from broker fees paid. */
    orderValue30: number | null;
    salesTaxPaid30: number;
    brokerPaid30: number;
    openOrders: number | null;
    activeReactions: number;
    activeManufacturing: number;
    /** Reaction / manufacturing jobs ever seen for this character. */
    reactionJobsSeen: number;
    manufacturingJobsSeen: number;
  };
  warnings: string[];
}

// --- advice ---------------------------------------------------------------------------------------------------

export type Verdict = "now" | "soon" | "later" | "maxed";

export interface SkillAdvice {
  id: number;
  group: SkillGroup;
  name: string;
  level: number;
  nextLevel: number | null;
  /** Training time to the next level, missing prerequisites included, minutes. */
  trainMinutes: number | null;
  missingPrereqs: Array<{ id: number; name: string; level: number }>;
  now: string;
  next: string | null;
  /** ISK per month the next level saves or earns, when it can be counted. */
  iskPerMonth: number | null;
  /** Short value line when it cannot be counted in ISK ("+1 слот, +50% выпуска"). */
  gain: string | null;
  capped: boolean;
  why: string;
  verdict: Verdict;
  score: number;
}

export interface Assumptions {
  salesPerMonth: number;
  orderValuePerMonth: number;
}

const pct = (v: number, digits = 2) => `${v.toFixed(digits).replace(/\.?0+$/, "")}%`;

const REMOTE_RANGE = ["только станция", "вся система", "5 прыжков", "10 прыжков", "20 прыжков", "весь регион"];

/** SP per minute an Omega clone trains a skill with these attributes at. */
export function spPerMinute(meta: SkillMeta, attributes: Record<number, number>): number {
  return (attributes[meta.primary] ?? 17) + (attributes[meta.secondary] ?? 17) / 2;
}

function minutesTo(
  id: number,
  level: number,
  data: SkillData,
  seen = new Set<string>(),
): { minutes: number; missing: Array<{ id: number; level: number }> } {
  const key = `${id}:${level}`;
  if (seen.has(key)) return { minutes: 0, missing: [] };
  seen.add(key);
  const meta = data.meta[id];
  if (!meta) return { minutes: 0, missing: [] };
  const have = data.skills[id] ?? { level: 0, sp: 0 };
  if (have.level >= level) return { minutes: 0, missing: [] };

  let minutes = 0;
  const missing: Array<{ id: number; level: number }> = [];
  // A skill not injected yet needs its own prerequisites first.
  if (!data.skills[id]) {
    for (const p of meta.prereqs) {
      const r = minutesTo(p.id, p.level, data, seen);
      if ((data.skills[p.id]?.level ?? 0) < p.level) missing.push(p, ...r.missing);
      minutes += r.minutes;
    }
  }
  const spNeeded = Math.max(0, spForLevel(meta.rank, level) - have.sp);
  minutes += spNeeded / spPerMinute(meta, data.attributes);
  return { minutes, missing };
}

/** Throughput gain from cutting job time by `step` per level, going from level L to L+1. */
const speedGain = (step: number, level: number) => ((1 - step * level) / (1 - step * (level + 1)) - 1) * 100;

export function orderSlots(skills: SkillData["skills"]): number {
  const l = (id: number) => skills[id]?.level ?? 0;
  return 5 + 4 * l(SKILL.trade) + 8 * l(SKILL.retail) + 16 * l(SKILL.wholesale) + 32 * l(SKILL.tycoon);
}

export function reactionSlots(skills: SkillData["skills"]): number {
  const l = (id: number) => skills[id]?.level ?? 0;
  return 1 + l(SKILL.massReactions) + l(SKILL.advancedMassReactions);
}

export function manufacturingSlots(skills: SkillData["skills"]): number {
  const l = (id: number) => skills[id]?.level ?? 0;
  return 1 + l(SKILL.massProduction) + l(SKILL.advancedMassProduction);
}

export function adviseSkills(data: SkillData, a: Assumptions): SkillAdvice[] {
  const lvl = (id: number) => data.skills[id]?.level ?? 0;
  const m = data.metrics;
  const slots = orderSlots(data.skills);
  const ordersCapped = m.openOrders != null && m.openOrders >= slots;
  const rSlots = reactionSlots(data.skills);
  const mSlots = manufacturingSlots(data.skills);
  const reacts = m.reactionJobsSeen > 0 || m.activeReactions > 0;
  const builds = m.manufacturingJobsSeen > 0 || m.activeManufacturing > 0;
  const reactionsCapped = m.activeReactions >= rSlots && m.activeReactions > 0;
  const manufacturingCapped = m.activeManufacturing >= mSlots && m.activeManufacturing > 0;

  const rows = TRACKED_SKILLS.map(({ id, group }): SkillAdvice => {
    const meta = data.meta[id];
    const level = lvl(id);
    const nextLevel = level < 5 ? level + 1 : null;
    const t = nextLevel ? minutesTo(id, nextLevel, data) : { minutes: 0, missing: [] };
    const row: SkillAdvice = {
      id,
      group,
      name: meta?.name ?? `Skill #${id}`,
      level,
      nextLevel,
      trainMinutes: nextLevel ? t.minutes : null,
      missingPrereqs: t.missing.map((p) => ({ ...p, name: data.meta[p.id]?.name ?? `#${p.id}` })),
      now: "",
      next: null,
      iskPerMonth: null,
      gain: null,
      capped: false,
      why: "",
      verdict: "later",
      score: 0,
    };
    const n = nextLevel ?? level;
    // tier: 3 = blocks you right now, 2 = pays for your activity, 1 = useful, 0 = not for your playstyle
    let tier = 1;

    switch (id) {
      case SKILL.accounting: {
        row.now = `налог ${pct(SALES_TAX_BASE * (1 - 0.11 * level))}`;
        row.next = nextLevel ? `налог ${pct(SALES_TAX_BASE * (1 - 0.11 * n))}` : null;
        row.iskPerMonth = nextLevel ? a.salesPerMonth * (SALES_TAX_BASE / 100) * 0.11 : null;
        row.why = "Минус 11% налога с каждой продажи. Самый выгодный навык для любого, кто что-то продаёт.";
        tier = a.salesPerMonth > 0 ? 2 : 1;
        break;
      }
      case SKILL.brokerRelations: {
        row.now = `брокер ${pct(BROKER_FEE_BASE - 0.3 * level)}`;
        row.next = nextLevel ? `брокер ${pct(BROKER_FEE_BASE - 0.3 * n)}` : null;
        row.iskPerMonth = nextLevel ? a.orderValuePerMonth * 0.003 : null;
        row.why = "−0.3% с каждого выставленного ордера (на продажу и на покупку). Мгновенные продажи в бай-ордер не затрагивает.";
        tier = a.orderValuePerMonth > 0 ? 2 : 1;
        break;
      }
      case SKILL.advancedBrokerRelations: {
        row.now = `скидка на перевыставление ${50 + 6 * level}%`;
        row.next = nextLevel ? `скидка ${50 + 6 * n}%` : null;
        row.gain = nextLevel ? "дешевле двигать цену ордера" : null;
        row.why = "Нужен, если часто перебиваете ордера на 0.01: каждое изменение цены стоит часть брокерской комиссии.";
        tier = m.openOrders && m.openOrders > 5 ? 1 : 0;
        break;
      }
      case SKILL.trade:
      case SKILL.retail:
      case SKILL.wholesale:
      case SKILL.tycoon: {
        const per = { [SKILL.trade]: 4, [SKILL.retail]: 8, [SKILL.wholesale]: 16, [SKILL.tycoon]: 32 }[id]!;
        row.now = `лимит ${slots} ордеров`;
        row.next = nextLevel ? `+${per} → ${slots + per}` : null;
        row.gain = nextLevel ? `+${per} ордеров` : null;
        row.capped = ordersCapped;
        row.why = ordersCapped
          ? `Сейчас занято ${m.openOrders} из ${slots}: новые ордера выставить нельзя, товар лежит без дела.`
          : "Больше одновременных ордеров: больше товаров в продаже и закупке одновременно.";
        tier = ordersCapped ? 3 : (m.openOrders ?? 0) >= slots - 2 ? 2 : 1;
        break;
      }
      case SKILL.reactions: {
        row.now = `−${4 * level}% времени реакций`;
        row.next = nextLevel ? `−${4 * n}%` : null;
        row.gain = nextLevel ? `+${speedGain(0.04, level).toFixed(1)}% выпуска` : null;
        row.why = "Быстрее реакции: больше циклов с тех же слотов.";
        tier = reacts ? 2 : 1;
        break;
      }
      case SKILL.massReactions:
      case SKILL.advancedMassReactions: {
        row.now = `${rSlots} слот${rSlots === 1 ? "" : rSlots < 5 ? "а" : "ов"} реакций`;
        row.next = nextLevel ? `${rSlots + 1}` : null;
        row.gain = nextLevel ? `+1 слот, +${Math.round(100 / rSlots)}% выпуска` : null;
        row.capped = reactionsCapped;
        row.why = reactionsCapped
          ? `Все ${rSlots} слотов реакций заняты: новый слот сразу даёт ещё одну линию выпуска.`
          : "Ещё одна реакция одновременно: прямой рост выпуска.";
        tier = reactionsCapped ? 3 : reacts ? 2 : 1;
        break;
      }
      case SKILL.remoteReactions: {
        row.now = level ? `удалённый запуск, ур. ${level}` : "только в своей системе";
        row.next = nextLevel ? "дальше от системы" : null;
        row.gain = nextLevel ? "меньше полётов" : null;
        row.why = "Запускать реакции, не сидя в системе с рефайнери. Удобство, не деньги.";
        tier = reacts ? 1 : 0;
        break;
      }
      case SKILL.industry:
      case SKILL.advancedIndustry: {
        const step = id === SKILL.industry ? 0.04 : 0.03;
        row.now = `−${Math.round(step * 100 * level)}% времени производства`;
        row.next = nextLevel ? `−${Math.round(step * 100 * n)}%` : null;
        row.gain = nextLevel ? `+${speedGain(step, level).toFixed(1)}% выпуска` : null;
        row.why = "Быстрее производство: больше циклов с тех же слотов.";
        tier = builds ? 2 : 0;
        break;
      }
      case SKILL.massProduction:
      case SKILL.advancedMassProduction: {
        row.now = `${mSlots} слот${mSlots === 1 ? "" : mSlots < 5 ? "а" : "ов"} производства`;
        row.next = nextLevel ? `${mSlots + 1}` : null;
        row.gain = nextLevel ? `+1 слот, +${Math.round(100 / mSlots)}% выпуска` : null;
        row.capped = manufacturingCapped;
        row.why = manufacturingCapped
          ? `Все ${mSlots} слотов производства заняты: новый слот сразу даёт ещё одну линию.`
          : "Ещё одна производственная работа одновременно.";
        tier = manufacturingCapped ? 3 : builds ? 2 : 0;
        break;
      }
      case SKILL.supplyChainManagement: {
        row.now = level ? `удалённый запуск, ур. ${level}` : "только в своей системе";
        row.next = nextLevel ? "дальше от системы" : null;
        row.gain = nextLevel ? "меньше полётов" : null;
        row.why = "Запускать производство удалённо. Удобство, не деньги.";
        tier = builds ? 1 : 0;
        break;
      }
      case SKILL.gasCloudHarvesting: {
        row.now = `газовых скупов: ${level}`;
        row.next = nextLevel ? `${n}` : null;
        row.gain = nextLevel ? `+${level ? Math.round(100 / level) : 100}% добычи газа` : null;
        row.why = "Каждый уровень разрешает ещё один газовый скуп: если на корабле есть слот, это прямой рост добычи.";
        tier = 2;
        break;
      }
      case SKILL.gasDecompressionEfficiency: {
        row.now = `потери при декомпрессии −${level}%`;
        row.next = nextLevel ? `−${n}%` : null;
        row.gain = nextLevel ? "+1% газа с каждой декомпрессии" : null;
        row.why = "Если сжимаете газ для перевозки, каждый уровень возвращает 1% объёма.";
        tier = 1;
        break;
      }
      case SKILL.marketing:
      case SKILL.procurement:
      case SKILL.daytrading:
      case SKILL.visibility: {
        const what = {
          [SKILL.marketing]: "продажа удалённо",
          [SKILL.procurement]: "бай-ордера удалённо",
          [SKILL.daytrading]: "изменение ордеров удалённо",
          [SKILL.visibility]: "дальность бай-ордеров",
        }[id]!;
        row.now = `${what}: ${REMOTE_RANGE[level]}`;
        row.next = nextLevel ? REMOTE_RANGE[n] : null;
        row.gain = nextLevel ? "меньше полётов в Jita" : null;
        row.why =
          id === SKILL.daytrading
            ? "Перебивать свои ордера из любой точки. Главный навык удобства для активной торговли."
            : "Торговать, не летая в хаб. Экономит время, не ISK.";
        tier = id === SKILL.daytrading && (m.openOrders ?? 0) > 5 ? 1 : 0;
        break;
      }
    }

    if (!nextLevel) {
      row.verdict = "maxed";
      return row;
    }
    const days = Math.max(row.trainMinutes! / 1440, 0.02);
    // Within a tier: a counted ISK gain beats an uncounted one ("+3% выпуска" may be worth anything), ISK per
    // training day orders the counted ones, and the shortest training orders the rest.
    const counted = row.iskPerMonth != null && row.iskPerMonth > 0;
    row.score = tier * 1e12 + (counted ? 5e11 + Math.min(row.iskPerMonth! / days, 4e11) : 1e9 / days / 1e3);
    return row;
  });

  // "Now": the best skill of up to three different groups, so the picks fix three different problems (Trade,
  // Retail and Wholesale all only add order slots). The rest of the paying tiers are "soon", unless they take
  // weeks (Tycoon behind Wholesale V is a month-long project, not a next step).
  const ranked = rows.filter((r) => r.verdict !== "maxed").sort((x, y) => y.score - x.score);
  const pickedGroups = new Set<SkillGroup>();
  ranked.forEach((r) => {
    if (pickedGroups.size < 3 && !pickedGroups.has(r.group) && r.score >= 1e12) {
      r.verdict = "now";
      pickedGroups.add(r.group);
    } else if (r.score >= 2e12 && (r.trainMinutes ?? 0) < 14 * 1440) r.verdict = "soon";
    else r.verdict = "later";
  });
  return rows;
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1м";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = Math.round(minutes % 60);
  if (d > 0) return h ? `${d}д ${h}ч` : `${d}д`;
  if (h > 0) return m ? `${h}ч ${m}м` : `${h}ч`;
  return `${m}м`;
}
