// Where each harvestable gas spawns. CCP does not publish this (the SDE has no signature spawn tables), so it is
// taken from EVE University's "Gas cloud harvesting" page (revision of 17 Nov 2026, oldid 232885), which says
// its Mykoserocin list is "not exhaustive": treat a region missing here as "not known", not "never".

export type GasFamily = "mykoserocin" | "cytoserocin";

export interface BoosterGas {
  typeId: number;
  family: GasFamily;
  /** Colour word in the type name: Amber, Azure, … */
  flavor: Flavor;
}

export type Flavor = "Amber" | "Azure" | "Celadon" | "Golden" | "Lime" | "Malachite" | "Vermillion" | "Viridian";

export const FLAVORS: Record<Flavor, { color: string; booster: string }> = {
  Amber: { color: "#f59e0b", booster: "Blue Pill" },
  Azure: { color: "#3b82f6", booster: "Sooth Sayer" },
  Celadon: { color: "#a3e4c1", booster: "Exile" },
  Golden: { color: "#facc15", booster: "Crash" },
  Lime: { color: "#a3e635", booster: "Frentix" },
  Malachite: { color: "#22c55e", booster: "Mindflood" },
  Vermillion: { color: "#ef4444", booster: "X-Instinct" },
  Viridian: { color: "#14b8a6", booster: "Drop" },
};

export const BOOSTER_GASES: BoosterGas[] = [
  { typeId: 28694, family: "mykoserocin", flavor: "Amber" },
  { typeId: 28695, family: "mykoserocin", flavor: "Azure" },
  { typeId: 28696, family: "mykoserocin", flavor: "Celadon" },
  { typeId: 28697, family: "mykoserocin", flavor: "Golden" },
  { typeId: 28698, family: "mykoserocin", flavor: "Lime" },
  { typeId: 28699, family: "mykoserocin", flavor: "Malachite" },
  { typeId: 28700, family: "mykoserocin", flavor: "Vermillion" },
  { typeId: 28701, family: "mykoserocin", flavor: "Viridian" },
  { typeId: 25268, family: "cytoserocin", flavor: "Amber" },
  { typeId: 25279, family: "cytoserocin", flavor: "Azure" },
  { typeId: 25275, family: "cytoserocin", flavor: "Celadon" },
  { typeId: 25273, family: "cytoserocin", flavor: "Golden" },
  { typeId: 25277, family: "cytoserocin", flavor: "Lime" },
  { typeId: 25276, family: "cytoserocin", flavor: "Malachite" },
  { typeId: 25278, family: "cytoserocin", flavor: "Vermillion" },
  { typeId: 25274, family: "cytoserocin", flavor: "Viridian" },
];

export interface GasSite {
  typeId: number;
  name: string;
  /** Units in the whole site. */
  units: number;
  regions: string[];
  /** "low": only the region's low-sec systems (0.1–0.4). Absent: any system of the region. */
  security?: "low";
  /** The constellation the big sites concentrate in. */
  constellation?: string;
  /** Sleeper/rat guards show up. */
  npcs?: boolean;
  /** The cloud damages the harvesting ship every cycle. */
  damage?: string;
}

const myko = (flavor: Flavor) => BOOSTER_GASES.find((g) => g.family === "mykoserocin" && g.flavor === flavor)!.typeId;
const cyto = (flavor: Flavor) => BOOSTER_GASES.find((g) => g.family === "cytoserocin" && g.flavor === flavor)!.typeId;

// Mykoserocin: wide spawn, open space, no rats, high/low/null alike. Small site 2000 units, big site 6000.
const MYKO: Array<[Flavor, string, number, string[]]> = [
  ["Lime", "Sister Nebula", 2000, ["Aridia", "Curse", "Derelik", "Kador", "Khanid", "Kor-Azor", "Omist", "Solitude", "Wicked Creek"]],
  ["Lime", "Helix Nebula", 6000, ["Aridia", "Curse", "Derelik", "Khanid", "Kor-Azor", "Solitude"]],
  ["Malachite", "Wild Nebula", 2000, ["Aridia", "Insmother", "Kor-Azor", "Curse", "Omist", "Solitude", "Tash-Murkon"]],
  ["Malachite", "Blackeye Nebula", 6000, ["Aridia", "Curse", "Khanid", "Kor-Azor", "Omist", "Solitude"]],
  ["Amber", "Sunspark Nebula", 2000, ["Black Rise", "Lonetrek", "Outer Passage", "Sinq Laison", "The Citadel", "The Forge", "The Spire"]],
  ["Amber", "Diablo Nebula", 6000, ["Black Rise", "Everyshore", "Lonetrek", "Outer Passage", "Sinq Laison", "The Citadel", "The Forge", "Vale of the Silent"]],
  ["Golden", "Smoking Nebula", 2000, ["Black Rise", "Etherium Reach", "Everyshore", "Lonetrek", "Outer Passage", "Perrigen Falls", "Sinq Laison", "The Citadel", "The Spire"]],
  ["Golden", "Ring Nebula", 6000, ["Black Rise", "Etherium Reach", "Everyshore", "Lonetrek", "Malpais", "Outer Passage", "Perrigen Falls", "Sinq Laison", "The Citadel"]],
  ["Celadon", "Calabash Nebula", 2000, ["Domain", "Genesis", "Placid", "Solitude", "Fountain"]],
  ["Celadon", "Glass Nebula", 6000, ["Domain", "Essence", "Solitude", "Pure Blind", "Placid", "Genesis"]],
  ["Viridian", "Bright Nebula", 2000, ["Essence", "Fountain", "Placid", "Tenal", "Venal"]],
  ["Viridian", "Sparking Nebula", 6000, ["Domain", "Essence", "Fountain", "Genesis", "Placid", "Pure Blind", "Tenal"]],
  ["Azure", "Ghost Nebula", 2000, ["Curse", "Derelik", "Devoid", "The Bleak Lands", "Heimatar", "Molden Heath"]],
  ["Azure", "Eagle Nebula", 6000, ["Curse", "Derelik", "The Bleak Lands", "Devoid", "Heimatar", "Insmother", "Metropolis", "Molden Heath", "Tenerifis"]],
  ["Vermillion", "Flame Nebula", 2000, ["Curse", "Derelik", "Devoid", "The Bleak Lands", "Great Wildlands", "Detorid", "Heimatar", "Insmother", "Metropolis", "Omist", "Tenerifis"]],
  ["Vermillion", "Pipe Nebula", 6000, ["Curse", "Derelik", "Devoid", "The Bleak Lands", "Heimatar", "Immensea", "Metropolis", "Tenerifis"]],
];

// Cytoserocin: one small low-sec site per flavor, the rest concentrated in one null-sec region and constellation.
// The wiki table leaves the region blank on rows below the first one of a region: those carry it over.
type CytoRow = [string, number, { npcs?: boolean; damage?: string; constellation?: string }?];
const CYTO: Array<{ flavor: Flavor; low: [string, string, number]; nullRegion: string; constellation: string; sites: CytoRow[] }> = [
  {
    flavor: "Lime",
    low: ["Derelik", "Emerald Nebula", 500],
    nullRegion: "Catch",
    constellation: "9HXQ-G",
    sites: [
      ["Cheetah Nebula", 1000, { damage: "1000 thermal" }],
      ["Duo Nebula", 6000, { damage: "1000 EM + 1000 thermal" }],
      ["Leopard Nebula", 18000, { damage: "1400 explosive", npcs: true }],
      ["Rimy Nebula", 3000, { damage: "1000 EM + 1000 thermal", npcs: true }],
    ],
  },
  {
    flavor: "Malachite",
    low: ["Aridia", "Crimson Nebula", 1000],
    nullRegion: "Delve",
    constellation: "OK-FEM",
    sites: [
      ["Cobra Nebula", 500, { damage: "800 EM + 800 thermal" }],
      ["Crab Spider Nebula", 2000, { npcs: true }],
      ["Hazy Nebula", 18000, { damage: "800 EM + 700 thermal", npcs: true }],
      ["Hidden Nebula", 6000, { damage: "1000 EM + 1000 thermal" }],
      ["Whirling Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
    ],
  },
  {
    flavor: "Amber",
    low: ["The Forge", "Bandit Nebula", 1000],
    nullRegion: "Vale of the Silent",
    constellation: "E-8CSQ",
    sites: [
      ["Fluttering Nebula", 500, { damage: "1000 thermal" }],
      ["Rocky Nebula", 832, { damage: "2500 thermal" }],
      ["Dewy Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
      ["Foggy Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
      ["Shimmering Nebula", 18000, { damage: "1400 thermal", npcs: true }],
      ["Spacious Nebula", 6000, { damage: "1000 EM + 1000 thermal" }],
    ],
  },
  {
    flavor: "Golden",
    low: ["Lonetrek", "Profiteer Nebula", 1000],
    nullRegion: "Tenal",
    constellation: "09-4XW",
    sites: [
      ["Moth Nebula", 2000, { npcs: true }],
      ["Swarm Nebula", 2000, { damage: "1000 thermal" }],
      ["Lion Nebula", 6000, { damage: "1000 EM + 1000 thermal" }],
      ["Shiny Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
      ["Gaseous Nebula", 18000, { damage: "700 EM + 700 thermal", npcs: true }],
    ],
  },
  {
    flavor: "Celadon",
    low: ["Solitude", "Phoenix Nebula", 1000],
    nullRegion: "Fountain",
    constellation: "Pegasus",
    sites: [
      ["Flowing Nebula", 2000, { damage: "1000 thermal" }],
      ["Thick Nebula", 1000, { npcs: true }],
      ["Diamond Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
      ["Massive Nebula", 14224, { damage: "800 thermal", npcs: true }],
      ["Peacock Nebula", 6000, { damage: "1000 EM + 1000 thermal" }],
    ],
  },
  {
    flavor: "Viridian",
    low: ["Placid", "Forgotten Nebula", 1000],
    nullRegion: "Cloud Ring",
    constellation: "Assilot",
    sites: [
      ["Frosty Nebula", 2000, { npcs: true }],
      ["Goose Nebula", 2000, { damage: "1000 thermal" }],
      ["Icy Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
      ["Pale Nebula", 3000, { damage: "1000 thermal" }],
      ["Polar Bear Nebula", 18000, { damage: "800 thermal", npcs: true }],
    ],
  },
  {
    flavor: "Azure",
    low: ["Molden Heath", "Rapture Nebula", 1400],
    nullRegion: "Wicked Creek",
    constellation: "760-9C",
    sites: [
      ["Crystal Nebula", 2000, { damage: "400 thermal" }],
      ["Snowy Owl Nebula", 2000, { npcs: true }],
      ["Arctic Fox Nebula", 9000, { damage: "700 EM + 700 thermal", npcs: true }],
      ["Glistening Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
      ["Murky Nebula", 3000, { damage: "1000 EM + 1000 thermal" }],
    ],
  },
  {
    flavor: "Vermillion",
    low: ["Heimatar", "Saintly Nebula", 500],
    nullRegion: "Feythabolis",
    constellation: "I-3ODK",
    sites: [
      ["Boisterous Nebula", 2000, { damage: "1000 thermal" }],
      ["Cardinal Nebula", 6000, { damage: "1000 EM + 1000 thermal", npcs: true }],
      ["Red Dragonfly Nebula", 18000, { damage: "700 EM + 700 thermal", npcs: true }],
      ["Wispy Nebula", 6000, { damage: "1000 EM + 1000 thermal" }],
    ],
  },
];

export const GAS_SITES: GasSite[] = [
  ...MYKO.map(([flavor, name, units, regions]) => ({ typeId: myko(flavor), name, units, regions })),
  ...CYTO.flatMap((c) => [
    { typeId: cyto(c.flavor), name: c.low[1], units: c.low[2], regions: [c.low[0]], security: "low" as const },
    ...c.sites.map(([name, units, extra]) => ({
      typeId: cyto(c.flavor),
      name,
      units,
      regions: [c.nullRegion],
      constellation: c.constellation,
      ...extra,
    })),
  ]),
];

// Fullerites: wormhole space only. Each reservoir holds a lot of one fullerite and some of another.
export interface FulleriteSite {
  name: string;
  tier: "Perimeter" | "Frontier" | "Core";
  classes: string;
  primary: string;
  secondary: string;
}

export const FULLERITE_SITES: FulleriteSite[] = [
  { name: "Barren Perimeter Reservoir", tier: "Perimeter", classes: "C1–C4", primary: "Fullerite-C50", secondary: "Fullerite-C60" },
  { name: "Token Perimeter Reservoir", tier: "Perimeter", classes: "C1–C4", primary: "Fullerite-C60", secondary: "Fullerite-C70" },
  { name: "Minor Perimeter Reservoir", tier: "Perimeter", classes: "C1–C4", primary: "Fullerite-C70", secondary: "Fullerite-C72" },
  { name: "Ordinary Perimeter Reservoir", tier: "Perimeter", classes: "C1–C4", primary: "Fullerite-C72", secondary: "Fullerite-C84" },
  { name: "Sizable Perimeter Reservoir", tier: "Perimeter", classes: "C1–C4", primary: "Fullerite-C84", secondary: "Fullerite-C50" },
  { name: "Bountiful Frontier Reservoir", tier: "Frontier", classes: "C3–C6", primary: "Fullerite-C28", secondary: "Fullerite-C32" },
  { name: "Vast Frontier Reservoir", tier: "Frontier", classes: "C3–C6", primary: "Fullerite-C32", secondary: "Fullerite-C28" },
  { name: "Instrumental Core Reservoir", tier: "Core", classes: "C5, C6, shattered", primary: "Fullerite-C320", secondary: "Fullerite-C540" },
  { name: "Vital Core Reservoir", tier: "Core", classes: "C5, C6, shattered", primary: "Fullerite-C540", secondary: "Fullerite-C320" },
];
