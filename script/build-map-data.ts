// Extracts the known-space map (systems on CCP's flat 2D layout, constellations, regions, stargate links) from
// the SDE (JSONL edition) into shared/data/map.json, which the gas map page draws. Run it again on a new SDE:
//
//   curl -L -o sde.zip https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip
//   unzip sde.zip 'map*.jsonl' _sde.jsonl -d sde
//   npx tsx script/build-map-data.ts sde
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: build-map-data.ts <folder with the SDE jsonl files>");
const read = (file: string) =>
  readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const sde = read("_sde.jsonl")[0];
// Known space only: wormhole (11…), abyssal (12…) and void regions have no gates; Jove systems without gates go too.
const systems = read("mapSolarSystems.jsonl").filter((s) => s.regionID < 11_000_000 && s.stargateIDs?.length);
const keep = new Set(systems.map((s) => s._key));
const regionIds = new Set(systems.map((s) => s.regionID));
const constIds = new Set(systems.map((s) => s.constellationID));

// Light-year-sized coordinates: scale to roughly ±1000 and keep one decimal.
const xs = systems.map((s) => s.position2D.x);
const ys = systems.map((s) => s.position2D.y);
const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
const scale = 2000 / span;
const r1 = (v: number) => Math.round(v * 10) / 10;

const gates = new Set<string>();
for (const g of read("mapStargates.jsonl")) {
  const a = g.solarSystemID;
  const b = g.destination.solarSystemID;
  if (!keep.has(a) || !keep.has(b)) continue;
  gates.add(a < b ? `${a},${b}` : `${b},${a}`);
}

const out = {
  sdeBuild: sde.buildNumber,
  regions: read("mapRegions.jsonl")
    .filter((r) => regionIds.has(r._key))
    .map((r) => ({ id: r._key, name: r.name.en })),
  constellations: read("mapConstellations.jsonl")
    .filter((c) => constIds.has(c._key))
    .map((c) => ({ id: c._key, name: c.name.en, regionId: c.regionID })),
  // [id, name, constellationId, regionId, x, y, security]: arrays keep the file small
  systems: systems.map((s) => [
    s._key,
    s.name.en,
    s.constellationID,
    s.regionID,
    r1((s.position2D.x - cx) * scale),
    // flip so north is up, as on the in-game map
    r1(-(s.position2D.y - cy) * scale),
    Math.round(s.securityStatus * 100) / 100,
  ]),
  gates: Array.from(gates).map((g) => g.split(",").map(Number)),
};
writeFileSync("shared/data/map.json", JSON.stringify(out) + "\n");
console.log(
  `SDE ${out.sdeBuild}: ${out.regions.length} regions, ${out.constellations.length} constellations, ${out.systems.length} systems, ${out.gates.length} gates`,
);
