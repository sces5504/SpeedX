// ---------------------------------------------------------------------------
// build-test-map.mjs — writes the map "test-town": a small MADE-UP area for trying out
// what an open world needs from its roads. It is not a real place.
//
//     node tools/build-test-map.mjs
//
// What it has (x = metres east, z = metres south; the whole thing is about 1.2 x 0.8 km):
//   the main road   RING     a closed loop round the outside (two lanes)
//   AVENUE   straight across the middle, four lanes with a median wall; both ends join the ring
//   CROSS    top to bottom; crosses the avenue (a crossroads) and joins the ring at both ends
//   FORK     leaves the avenue at a slant, crosses CROSS and merges into the ring at a slant
//   SPUR     a dead end that climbs a hill outside the ring (a road that just stops)
// So: side roads, a fork, a merge, crossroads, and loops inside loops.
//
// Roads join by being drawn to touch: an end placed ON another road's centre line, or two lines
// crossing (src/world/mapData.js: WAYS). Roads listed first are "on top" at a junction.
// Change the numbers below and run it again; then  node tools/check-content.mjs.
// ---------------------------------------------------------------------------
import fs from 'node:fs';

const OUT = 'public/content/maps/test-town/';
const HALF_X = 600, HALF_Z = 400, CORNER = 160;        // the ring: a rectangle this big with rounded corners

// ---- The ring, as points every 20 m or so (clockwise on the map, starting on the west side) ----
function ring() {
  const points = [];
  const line = (x0, z0, x1, z1) => { const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 20); for (let k = 0; k < n; k++) points.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]); };
  const arc = (cx, cz, from) => { for (let k = 0; k < 12; k++) { const a = from + (k / 12) * (Math.PI / 2); points.push([cx + Math.cos(a) * CORNER, cz + Math.sin(a) * CORNER]); } };
  const x = HALF_X - CORNER, z = HALF_Z - CORNER;
  line(-HALF_X, z, -HALF_X, -z); arc(-x, -z, Math.PI);             // west side going north, north-west corner
  line(-x, -HALF_Z, x, -HALF_Z); arc(x, -z, -Math.PI / 2);         // north side going east, north-east corner
  line(HALF_X, -z, HALF_X, z); arc(x, z, 0);                       // east side going south, south-east corner
  line(x, HALF_Z, -x, HALF_Z); arc(-x, z, Math.PI / 2);            // south side going west, south-west corner
  return points.map(([px, pz]) => [Math.round(px * 10) / 10, Math.round(pz * 10) / 10]);
}
// A road through a few hand-placed points, with a point every 20 m between them.
function through(...corners) {
  const points = [];
  for (let i = 1; i < corners.length; i++) {
    const [x0, z0] = corners[i - 1], [x1, z1] = corners[i], n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 20));
    for (let k = 0; k < n; k++) points.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  points.push(corners[corners.length - 1]);
  return points.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}

// ---- The ground: gentle rolling country, one hill to the south for the spur ----------------
const hm = { file: 'height.bin', x0: -1100, z0: -900, cell: 10, cols: 221, rows: 211, step: 0.1 };
const ground = (x, z) => 30 + 9 * Math.sin(x / 420) * Math.cos(z / 380) + 4 * Math.sin((x + 2 * z) / 260)
  + 26 * Math.exp(-((x + 380) ** 2 + (z - 880) ** 2) / 260 ** 2);
const heights = new Float64Array(hm.cols * hm.rows);
for (let r = 0; r < hm.rows; r++) for (let c = 0; c < hm.cols; c++) heights[r * hm.cols + c] = ground(hm.x0 + c * hm.cell, hm.z0 + r * hm.cell);
hm.minHeight = Math.min(...heights);
const raw = new Uint16Array(heights.length);
heights.forEach((h, i) => { raw[i] = Math.round((h - hm.minHeight) / hm.step); });

// ---- map.json ------------------------------------------------------------------------------
const map = {
  id: 'test-town',
  name: 'Test Town (road network)',
  source: 'Made up by tools/build-test-map.mjs: a test area for junctions, not a real place.',
  origin: { lat: 25.03, lon: 121.56 },
  heightmap: hm,
  startPoi: 'ring-fuel',
  pois: [
    { id: 'ring-fuel', type: 'gas', name: 'Ring Fuel', s: 380, length: 90, depth: 34 },
    { id: 'east-turnout', type: 'turnout', name: 'East Turnout', s: 2250, length: 80, depth: 20 },
    { id: 'garage', type: 'garage', name: 'North Garage', s: 930, length: 60, depth: 26 },
    { id: 'dealer', type: 'dealer', name: 'Ring Motors', s: 2800, length: 70, depth: 30 },
  ],
  scenery: [
    { prop: 'bush', perKm: 380, minScale: 0.7, maxScale: 1.7, maxDist: 60 },
    { prop: 'pine', perKm: 90, minScale: 0.8, maxScale: 1.6, maxDist: 100, minDist: 14 },
    { prop: 'grass', perKm: 1200, minScale: 0.6, maxScale: 1.5, maxDist: 9, minDist: 0.4 },
  ],
  traffic: { rules: 'two-lane', count: 5, speedLimit: 16.7 },
  ground: 'chaparral',
  signs: 'tw',
  // Speed cameras: the speeds (km/h) that earn one, two and three stars.
  speedCameras: [
    { id: 'avenue', road: 'avenue', s: 900, name: 'Avenue', stars: [150, 200, 250] },
    { id: 'ring-east', s: 1950, name: 'Ring East', stars: [130, 175, 220] },
    { id: 'cross', road: 'cross', s: 620, name: 'Cross Street', stars: [105, 145, 185] },
  ],
  // Traffic lights at the crossroads in the middle and where the avenue meets the ring.
  signalJunctions: [[0, 0], [-HALF_X, 0], [HALF_X, 0]],
  // The main road: the ring.
  loop: true,
  sections: [{ from: 0, name: 'Ring Road', type: 'two-lane', speedKmh: 60 }],
  road: ring(),
  // Every other road. Earlier in this list = "on top" where two of them meet.
  roads: [
    { id: 'avenue', type: 'divided', road: through([-HALF_X, 0], [HALF_X, 0]), sections: [{ from: 0, name: 'Avenue', type: 'divided', speedKmh: 60 }] },
    { id: 'cross', type: 'country', road: through([0, -HALF_Z], [0, HALF_Z]), sections: [{ from: 0, name: 'Cross Street', type: 'country', speedKmh: 50 }] },
    { id: 'fork', type: 'narrow', road: through([-330, 0], [-260, -60], [-150, -170], [-20, -280], [100, -350], [180, -HALF_Z]), sections: [{ from: 0, name: 'Fork Lane', type: 'narrow', speedKmh: 40 }] },
    { id: 'spur', type: 'narrow', road: through([-250, HALF_Z], [-270, 520], [-340, 640], [-330, 760], [-390, 860]), sections: [{ from: 0, name: 'Hill Spur', type: 'narrow', speedKmh: 40 }] },
  ],
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + hm.file, Buffer.from(raw.buffer));
fs.writeFileSync(OUT + 'map.json', JSON.stringify(map));
const lengthOf = (points, loop) => points.reduce((sum, p, i) => sum + (i ? Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : loop ? Math.hypot(p[0] - points[points.length - 1][0], p[1] - points[points.length - 1][1]) : 0), 0);
console.log(`test-town: ring ${Math.round(lengthOf(map.road, true))} m` + map.roads.map((r) => `, ${r.id} ${Math.round(lengthOf(r.road))} m`).join('') + `, heights ${Math.round(hm.minHeight)}-${Math.round(Math.max(...heights))} m`);
