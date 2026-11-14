// ---------------------------------------------------------------------------
// build-places.mjs — finds the REAL places beside a map's road and writes them
// into its map.json as a first draft of the "buildings" list.
//
//   node tools/build-places.mjs --id shimen-coast            (keeps an existing list)
//   node tools/build-places.mjs --id shimen-coast --force    (throws the old list away)
//   node tools/build-places.mjs --id shimen-coast --houses   (keeps the list and ADDS a few houses)
//
// It asks OpenStreetMap for what stands near the road — restaurants, cafés, a
// police station, temples, public toilets, mapped buildings, bus stops, power
// pylons — and turns each into one entry:
//   { "kind": "seafood", "at": [x, z], "width": 14, "depth": 10, "note": "..." }
//   kind    which generic building the game puts there (src/world/town.js lists them)
//   at      where it really is, in the same metres as the map's "road" points
//   sign    (only for a special trade) the made-up English name on its sign, e.g. "MOON BAR".
//           Otherwise the game invents a name for the kind (src/world/town.js). Never a real shop's name.
//   note    what the real place is called, for whoever edits the list (not shown in the game)
// The draft is meant to be edited by hand: delete what is wrong, add what the
// map does not know. OpenStreetMap knows the named places well but has few
// ordinary houses drawn in the countryside. --houses makes up for that a little: wherever the
// map names a hamlet or village beside the road, it adds a few townhouses along the road there.
// The settlement is real; the individual houses are not.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((part) => {
  const [key, ...rest] = part.trim().split(' ');
  return [key, rest.join(' ')];
}));
if (!args.id) { console.error('Which map?  node tools/build-places.mjs --id <map id>'); process.exit(1); }
const mapFile = path.resolve('public/content/maps', args.id, 'map.json');
const text = fs.readFileSync(mapFile, 'utf8');
const map = JSON.parse(text);
if (map.buildings && !('force' in args) && !('houses' in args)) { console.log(`${args.id} already has ${map.buildings.length} buildings (use --force to replace them).`); process.exit(0); }

const REACH_M = 150;          // how far from the road a place may be
const PYLON_REACH_M = 400;    // power pylons are tall: they are seen from further away
const DEG = Math.PI / 180, EARTH_R = 6371000;
const toLocal = (lat, lon) => [(lon - map.origin.lon) * DEG * EARTH_R * Math.cos(map.origin.lat * DEG), -(lat - map.origin.lat) * DEG * EARTH_R];
const toLatLon = ([x, z]) => [map.origin.lat - z / (DEG * EARTH_R), map.origin.lon + x / (DEG * EARTH_R * Math.cos(map.origin.lat * DEG))];

// ---- 1. Ask OpenStreetMap what is around the road ---------------------------------
const corners = map.road.map(toLatLon), pad = 0.004;
const box = [Math.min(...corners.map((c) => c[0])) - pad, Math.min(...corners.map((c) => c[1])) - pad,
             Math.max(...corners.map((c) => c[0])) + pad, Math.max(...corners.map((c) => c[1])) + pad].join(',');
const wanted = ['way[building]', 'node[amenity]', 'way[amenity]', 'node[shop]', 'node[highway=bus_stop]', 'node[power=tower]', 'node[place~"^(hamlet|village|neighbourhood)$"]'];
const query = `[out:json][timeout:90];(${wanted.map((w) => `${w}(${box});`).join('')});out geom;`;
const cacheFile = path.resolve('tools/.cache', `osm-places-v2-${args.id}.json`);
if (!fs.existsSync(cacheFile)) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'speedx-map-builder/0.1', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}). A 502 or 504 just means: try again in a minute.`);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, Buffer.from(await res.arrayBuffer()));
}
const elements = JSON.parse(fs.readFileSync(cacheFile)).elements;

// ---- 2. How far is a point from the road, and how far along it? ---------------------
const road = map.loop ? [...map.road, map.road[0]] : map.road;
function nearRoad([x, z]) {
  let best = { distance: Infinity };
  let along = 0;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1], b = road[i], dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
    const distance = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (distance < best.distance) best = { distance, along: along + Math.sqrt(len2) * t, dir: [dx / Math.sqrt(len2), dz / Math.sqrt(len2)], on: [a[0] + dx * t, a[1] + dz * t] };
    along += Math.sqrt(len2);
  }
  return best;
}

// ---- 3. Turn each place into a building ---------------------------------------------
// What a named place becomes: [test on its tags or name, kind, sign, width, depth, levels].
const round = (v) => Math.round(v * 10) / 10;
function describe(tags) {
  const name = tags.name || '';
  if (tags.power === 'tower') return { kind: 'power-tower' };
  if (tags.highway === 'bus_stop') return { kind: 'bus-stop' };
  if (tags.amenity === 'police') return { kind: 'police', width: 12, depth: 9, levels: 2 };
  if (tags.amenity === 'place_of_worship' || tags.building === 'temple') return { kind: 'temple', width: 6, depth: 5 };
  if (tags.amenity === 'toilets' || tags.building === 'toilets') return { kind: 'toilet', width: 5, depth: 4 };
  if (tags.amenity === 'community_centre') return { kind: 'hall', width: 14, depth: 10, levels: 2 };
  if (tags.amenity === 'cafe' || tags.shop === 'coffee' || /咖啡|coffee|cafe/i.test(name)) return { kind: 'cafe', width: 8, depth: 7 };
  if (tags.amenity === 'restaurant' || tags.amenity === 'bar' || tags.amenity === 'pub') {
    if (/海產|海鮮/.test(name)) return { kind: 'seafood', width: 14, depth: 10 };
    if (/bar|club/i.test(name)) return { kind: 'cafe', sign: 'MOON BAR', width: 8, depth: 7 };
    if (/羊肉/.test(name)) return { kind: 'eatery', sign: 'LAMB HOT POT', width: 9, depth: 8 };
    if (/pattaya|泰/i.test(name)) return { kind: 'eatery', sign: 'THAI KITCHEN', width: 9, depth: 8 };
    return { kind: 'eatery', width: 9, depth: 8 };
  }
  if (tags.shop === 'convenience') return { kind: 'eatery', sign: 'MINI MART', width: 10, depth: 9 };
  if (tags.building) return { kind: 'house' };
  return null;
}

const found = [];
for (const element of elements) {
  const tags = element.tags || {}, look = describe(tags);
  if (!look) continue;
  const points = element.geometry ? element.geometry.map((p) => toLocal(p.lat, p.lon)) : [toLocal(element.lat, element.lon)];
  const at = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  const where = nearRoad(at);
  if (where.distance > (look.kind === 'power-tower' ? PYLON_REACH_M : REACH_M)) continue;
  if (look.kind === 'bus-stop' && where.distance > 30) continue;
  const building = { ...look, at: at.map(round), ...(tags.name ? { note: tags.name } : {}) };
  if (element.type === 'way' && points.length > 2) {
    // A drawn outline: measure it along the road (width) and away from it (depth).
    const alongs = points.map((p) => p[0] * where.dir[0] + p[1] * where.dir[1]), acrosses = points.map((p) => -p[0] * where.dir[1] + p[1] * where.dir[0]);
    building.width = building.width ?? round(Math.max(4, Math.min(30, Math.max(...alongs) - Math.min(...alongs))));
    building.depth = building.depth ?? round(Math.max(4, Math.min(20, Math.max(...acrosses) - Math.min(...acrosses))));
    if (look.kind === 'house') building.levels = Math.min(5, Number(tags['building:levels']) || (building.width > 12 ? 2 : 3));
  }
  found.push({ building, along: where.along, outline: element.type === 'way' });
}
// A named place usually stands inside a drawn outline: keep the named one, drop the bare outline.
const named = found.filter((f) => !f.outline || f.building.kind !== 'house');
const buildings = found
  .filter((f) => named.includes(f) || !named.some((n) => Math.hypot(n.building.at[0] - f.building.at[0], n.building.at[1] - f.building.at[1]) < 14))
  // ...and two places closer together than a building is wide cannot both be built: keep the first.
  .sort((a, b) => a.along - b.along)
  .filter((f, i, list) => f.building.kind === 'bus-stop' || f.building.kind === 'power-tower'
    || !list.slice(0, i).some((o) => !['bus-stop', 'power-tower'].includes(o.building.kind) && Math.hypot(o.building.at[0] - f.building.at[0], o.building.at[1] - f.building.at[1]) < 9))
  .map((f) => f.building);

// ---- 3b. A few houses where the map names a settlement beside the road (--houses) ------
const HAMLET_REACH_M = 260, HOUSE_SETBACK_M = 19;      // how near the road a settlement must be; how far from the centre line a house stands
const houses = [];
let seed = 7;
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (const element of elements) {
  if (!element.tags?.place || element.type !== 'node') continue;
  const where = nearRoad(toLocal(element.lat, element.lon));
  if (where.distance > HAMLET_REACH_M) continue;
  const count = 2 + Math.floor(random() * 3);          // two to four houses per settlement
  for (let k = 0; k < count; k++) {
    const along = (k - (count - 1) / 2) * (14 + random() * 10), side = random() < 0.5 ? 1 : -1;
    const at = [where.on[0] + where.dir[0] * along - where.dir[1] * side * HOUSE_SETBACK_M, where.on[1] + where.dir[1] * along + where.dir[0] * side * HOUSE_SETBACK_M].map(round);
    const units = 1 + Math.floor(random() * 2.4);      // one house, or a short terrace
    houses.push({ kind: 'house', at, width: round(units * 5.2), depth: 11, levels: 2 + Math.floor(random() * 3), note: `house at ${element.tags.name || 'a hamlet'} (position invented)` });
  }
}

// ---- 4. Write the list into map.json, just before the long "road" line ---------------
const clear = (b, list) => !list.some((o) => !['bus-stop', 'power-tower'].includes(o.kind) && o.at && Math.hypot(o.at[0] - b.at[0], o.at[1] - b.at[1]) < 16);
if ('houses' in args) {
  const kept = (map.buildings || []).filter((b) => !/position invented/.test(b.note || ''));     // (running it twice does not pile them up)
  for (const house of houses) if (clear(house, kept)) kept.push(house);
  buildings.length = 0; buildings.push(...kept);
}
map.buildings = buildings;
const { road: roadPoints, ...rest } = map;
const lines = JSON.stringify(rest, null, 2).replace(/\{\n\s+"kind"[^}]*\}/g, (entry) => entry.replace(/\n\s*/g, ' '));   // one building per line
fs.writeFileSync(mapFile, lines.replace(/\n}$/, ',\n  "road": ' + JSON.stringify(roadPoints) + '\n}') + '\n');
const count = {};
for (const b of buildings) count[b.kind] = (count[b.kind] || 0) + 1;
console.log(`Wrote ${buildings.length} buildings into ${path.relative('.', mapFile)}:`, count);
console.log('Source: © OpenStreetMap contributors (ODbL). Check the list by hand: the map knows named places better than ordinary houses.');
