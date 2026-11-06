// Extracts every published reaction formula from CCP's static data export (SDE, JSONL edition) into
// shared/data/reactions.json, which the reaction scanner reads. Run it again when CCP ships a new SDE:
//
//   curl -L -o sde.zip https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip
//   unzip sde.zip blueprints.jsonl types.jsonl groups.jsonl _sde.jsonl -d sde
//   npx tsx script/build-reactions-data.ts sde
import { createReadStream, readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import path from "path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: build-reactions-data.ts <folder with the SDE jsonl files>");

async function* lines(file: string) {
  const rl = createInterface({ input: createReadStream(path.join(dir, file)), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

type Name = { en?: string; ru?: string };

async function main() {
  const sde = JSON.parse(readFileSync(path.join(dir, "_sde.jsonl"), "utf8").split("\n")[0]);

  const formulas: Array<{
    blueprintId: number;
    time: number;
    materials: Array<{ typeId: number; quantity: number }>;
    products: Array<{ typeId: number; quantity: number }>;
  }> = [];
  for await (const bp of lines("blueprints.jsonl")) {
    const r = bp.activities?.reaction;
    if (!r?.products?.length) continue;
    formulas.push({
      blueprintId: bp._key,
      time: r.time,
      materials: (r.materials ?? []).map((m: any) => ({ typeId: m.typeID, quantity: m.quantity })),
      products: r.products.map((p: any) => ({ typeId: p.typeID, quantity: p.quantity })),
    });
  }

  const needed = new Set<number>();
  formulas.forEach((f) => {
    needed.add(f.blueprintId);
    f.materials.forEach((m) => needed.add(m.typeId));
    f.products.forEach((p) => needed.add(p.typeId));
  });

  const types: Record<number, { name: string; nameRu: string; groupId: number; volume: number; published: boolean }> = {};
  for await (const t of lines("types.jsonl")) {
    if (!needed.has(t._key)) continue;
    const name = t.name as Name;
    types[t._key] = {
      name: name.en ?? `#${t._key}`,
      nameRu: name.ru ?? name.en ?? `#${t._key}`,
      groupId: t.groupID,
      volume: t.volume ?? 0,
      published: !!t.published,
    };
  }

  const groupIds = new Set(Object.values(types).map((t) => t.groupId));
  const groups: Record<number, string> = {};
  for await (const g of lines("groups.jsonl")) {
    if (groupIds.has(g._key)) groups[g._key] = (g.name as Name).en ?? `#${g._key}`;
  }

  // Formulas CCP still sells and whose product can be traded.
  const live = formulas.filter((f) => types[f.blueprintId]?.published && f.products.every((p) => types[p.typeId]?.published));

  const out = {
    sdeBuild: sde.buildNumber,
    sdeReleaseDate: sde.releaseDate,
    formulas: live.map((f) => ({ ...f, name: types[f.blueprintId].name })),
    types: Object.fromEntries(
      Object.entries(types).map(([id, t]) => [id, { name: t.name, nameRu: t.nameRu, groupId: t.groupId, group: groups[t.groupId] ?? "", volume: t.volume }]),
    ),
  };
  writeFileSync("shared/data/reactions.json", JSON.stringify(out, null, 0) + "\n");
  console.log(`SDE ${out.sdeBuild}: ${live.length} reaction formulas (${formulas.length - live.length} unpublished skipped), ${Object.keys(out.types).length} types`);
}

main();
