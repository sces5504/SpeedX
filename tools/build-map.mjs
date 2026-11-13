// ---------------------------------------------------------------------------
// build-map.mjs — makes a map folder from REAL data.
//
//   node tools/build-map.mjs                      rebuild Angeles Crest (the defaults below)
//   node tools/build-map.mjs --id mulholland --name "Mulholland Highway" \
//        --road "Mulholland Highway" --start 34.0935,-118.8155 --length 8000
//
//   --id      folder name under public/content/maps/ (lower-case, dashes)
//   --name    title shown in the game
//   --road    the road's name in OpenStreetMap (or use --ref "CA 2" for a route number)
//   --start   latitude,longitude where the drive begins (pick it on openstreetmap.org)
//   --length  metres of road to keep
//
// It downloads 1. the road centre line from OpenStreetMap (Overpass API) and
// 2. satellite-derived elevation from the public "Terrarium" terrain tiles, then
// writes public/content/maps/<id>/map.json + height.bin and lists the id in
// public/content/maps/index.json. Roadside stops ("pois"), plants ("scenery")
// and poles are plain lists inside map.json — edit them by hand afterwards;
// re-running this script keeps your edits.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

// ---- Settings (command-line flags override these) ---------------------------
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((part) => {
  const [key, ...rest] = part.trim().split(' ');
  return [key, rest.join(' ').replace(/^"|"$/g, '')];
}));
const MAP_ID = args.id || 'angeles-crest';
const MAP_NAME = args.name || 'Angeles Crest Highway (CA-2)';
const [startLat, startLon] = (args.start || '34.2230,-118.1906').split(',').map(Number);
const ROUTE_START = { lat: startLat, lon: startLon };       // where the drive begins
const ROUTE_LENGTH_M = Number(args.length || 9700);          // about 6 miles
const ROAD_FILTER = args.road ? `["name"="${args.road}"]` : `["ref"~"${args.ref || 'CA 2'}"]`;
const BOX_KM = ROUTE_LENGTH_M / 1000 + 2;                    // search this far around the start
const SEARCH_BOX = [startLat - BOX_KM / 111, startLon - BOX_KM / 90, startLat + BOX_KM / 111, startLon + BOX_KM / 90];   // south, west, north, east
const TILE_ZOOM = 14;                                 // ~8 m per pixel here
const GRID_CELL_M = 10;                               // heightmap resolution we save
const MARGIN_M = 1600;                                // terrain kept around the road
const OUT_DIR = path.resolve('public/content/maps', MAP_ID);
const CACHE_DIR = path.resolve('tools/.cache');

const EARTH_R = 6371000;
const DEG = Math.PI / 180;

// ---- Small helpers --------------------------------------------------------
// Convert latitude/longitude to flat metres around the route start.
// +x = east, +z = south (so "north" is -z, which matches Three.js nicely).
function toLocal(lat, lon) {
  return {
    x: (lon - ROUTE_START.lon) * DEG * EARTH_R * Math.cos(ROUTE_START.lat * DEG),
    z: -(lat - ROUTE_START.lat) * DEG * EARTH_R,
  };
}
function toLatLon(x, z) {
  return {
    lat: ROUTE_START.lat - z / (DEG * EARTH_R),
    lon: ROUTE_START.lon + x / (DEG * EARTH_R * Math.cos(ROUTE_START.lat * DEG)),
  };
}
async function fetchCached(name, url, options) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, name);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

// ---- 1. Road centerline from OpenStreetMap --------------------------------
async function loadRoad() {
  const query = `[out:json][timeout:50];way["highway"]${ROAD_FILTER}(${SEARCH_BOX.join(',')});out geom;`;
  const buf = await fetchCached(MAP_ID === 'angeles-crest' ? 'osm-road.json' : `osm-road-${MAP_ID}.json`, 'https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'speedx-map-builder/0.1', Accept: 'application/json',
               'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  const ways = JSON.parse(buf.toString()).elements
    .filter((w) => w.tags.oneway !== 'yes')      // skip the divided town streets
    .map((w) => w.geometry);

  // OSM stores the road as many short pieces. Join them end-to-end,
  // starting from the piece that begins closest to ROUTE_START.
  const key = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const dist2 = (p) => (p.lat - ROUTE_START.lat) ** 2 + (p.lon - ROUTE_START.lon) ** 2;
  let best = null;
  for (const g of ways) {
    for (const end of [0, g.length - 1]) {
      if (!best || dist2(g[end]) < dist2(best.g[best.end])) best = { g, end };
    }
  }
  let chain = best.end === 0 ? [...best.g] : [...best.g].reverse();
  const used = new Set([best.g]);
  for (;;) {
    const tail = key(chain[chain.length - 1]);
    const next = ways.find((g) => !used.has(g) && (key(g[0]) === tail || key(g[g.length - 1]) === tail));
    if (!next) break;
    used.add(next);
    const pts = key(next[0]) === tail ? next : [...next].reverse();
    chain.push(...pts.slice(1));
  }

  // Convert to metres and cut to the wanted length.
  const road = [];
  let length = 0;
  for (const p of chain) {
    const q = toLocal(p.lat, p.lon);
    if (road.length) {
      const prev = road[road.length - 1];
      length += Math.hypot(q.x - prev.x, q.z - prev.z);
    }
    road.push(q);
    if (length >= ROUTE_LENGTH_M) break;
  }
  console.log(`Road: ${road.length} points, ${(length / 1609.34).toFixed(2)} miles`);
  return road;
}

// ---- 2. Elevation from terrain tiles --------------------------------------
// Each pixel stores a height:  metres = R*256 + G + B/256 - 32768
const tiles = new Map();
async function getTile(tx, ty) {
  const id = `${TILE_ZOOM}-${tx}-${ty}`;
  if (!tiles.has(id)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TILE_ZOOM}/${tx}/${ty}.png`;
    const png = PNG.sync.read(await fetchCached(`tile-${id}.png`, url));
    tiles.set(id, png);
  }
  return tiles.get(id);
}
function mercatorPixel(lat, lon) {
  const scale = 256 * 2 ** TILE_ZOOM;
  const s = Math.sin(lat * DEG);
  return {
    px: ((lon + 180) / 360) * scale,
    py: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}
async function pixelHeight(px, py) {
  const tile = await getTile(Math.floor(px / 256), Math.floor(py / 256));
  const i = ((Math.floor(py) & 255) * 256 + (Math.floor(px) & 255)) * 4;
  return tile.data[i] * 256 + tile.data[i + 1] + tile.data[i + 2] / 256 - 32768;
}
async function heightAt(lat, lon) {
  // Bilinear blend of the four nearest pixels for a smooth surface.
  const { px, py } = mercatorPixel(lat, lon);
  const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5);
  const fx = px - 0.5 - x0, fy = py - 0.5 - y0;
  const h00 = await pixelHeight(x0, y0), h10 = await pixelHeight(x0 + 1, y0);
  const h01 = await pixelHeight(x0, y0 + 1), h11 = await pixelHeight(x0 + 1, y0 + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

// ---- Main -------------------------------------------------------------------
const road = await loadRoad();

let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const p of road) {
  minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
  minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
}
const x0 = Math.floor((minX - MARGIN_M) / GRID_CELL_M) * GRID_CELL_M;
const z0 = Math.floor((minZ - MARGIN_M) / GRID_CELL_M) * GRID_CELL_M;
const cols = Math.ceil((maxX + MARGIN_M - x0) / GRID_CELL_M) + 1;
const rows = Math.ceil((maxZ + MARGIN_M - z0) / GRID_CELL_M) + 1;
console.log(`Heightmap: ${cols} x ${rows} cells of ${GRID_CELL_M} m`);

const heights = new Float32Array(cols * rows);
let minH = Infinity, maxH = -Infinity;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const { lat, lon } = toLatLon(x0 + c * GRID_CELL_M, z0 + r * GRID_CELL_M);
    const h = await heightAt(lat, lon);
    heights[r * cols + c] = h;
    minH = Math.min(minH, h); maxH = Math.max(maxH, h);
  }
}
console.log(`Elevation range: ${minH.toFixed(0)} m .. ${maxH.toFixed(0)} m  (${tiles.size} tiles)`);

// Store heights as 16-bit integers (0.1 m steps above the lowest point).
const packed = new Uint16Array(cols * rows);
for (let i = 0; i < packed.length; i++) packed[i] = Math.round((heights[i] - minH) * 10);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'height.bin'), Buffer.from(packed.buffer));

// Keep hand-edited lists from an existing map.json; otherwise start with sensible defaults.
const mapFile = path.join(OUT_DIR, 'map.json');
const old = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile)) : {};
const total = (road.length - 1) && ROUTE_LENGTH_M;
const map = {
  id: MAP_ID,
  name: MAP_NAME,
  source: 'Road: © OpenStreetMap contributors (ODbL). Elevation: Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM).',
  origin: ROUTE_START,
  heightmap: { file: 'height.bin', x0, z0, cell: GRID_CELL_M, cols, rows, minHeight: minH, step: 0.1 },
  pois: old.pois || [
    { id: 'gas-start', type: 'gas', name: 'Roadside Fuel', s: 420, length: 90, depth: 34 },
    { id: 'turnout-mid', type: 'turnout', name: 'Vista Turnout', s: Math.round(total * 0.5), length: 80, depth: 20 },
    { id: 'mart-end', type: 'mart', name: 'Summit Mart', s: Math.round(total * 0.85), length: 100, depth: 36 },
  ],
  scenery: old.scenery || [
    { prop: 'bush', perKm: 520, minScale: 0.7, maxScale: 1.9, maxDist: 70 },
    { prop: 'pine', perKm: 170, minScale: 0.8, maxScale: 1.7, maxDist: 110 },
    { prop: 'rock', perKm: 90, minScale: 0.5, maxScale: 2.2, maxDist: 40 },
  ],
  ...(old.poles ? { poles: old.poles } : {}),
  startPoi: old.startPoi || (old.pois ? old.pois[0].id : 'gas-start'),
};
// The long list of road points goes last, on one line, so the top of the file stays readable.
const text = JSON.stringify(map, null, 2).replace(/\n}$/, ',\n  "road": ' + JSON.stringify(road.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10])) + '\n}');
fs.writeFileSync(mapFile, text + '\n');

const indexFile = path.resolve('public/content/maps/index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile)) : { maps: [], default: MAP_ID };
if (!index.maps.includes(MAP_ID)) index.maps.push(MAP_ID);
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote ${path.relative('.', OUT_DIR)}/map.json + height.bin  (listed in maps/index.json)`);
