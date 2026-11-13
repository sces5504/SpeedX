// ---------------------------------------------------------------------------
// mapData.js — turns the downloaded map files into things the game can ask:
//   "how high is the ground here?", "where is the road?", "how sharp is the bend?"
//
// The road is stored as sample points every ROAD.step metres. Sample i is at
// distance  s = i * ROAD.step  from the start. For every sample we keep:
//   x, z, y   position           tx, tz   direction of travel (unit vector)
//   curve     curvature (1/radius, + = left turn)
//   bank      sideways tilt (metres of rise per metre toward the right)
//   limitL/R  how far a car may go left/right of centre before hitting a wall
//   benchL/R  how wide the flat ground is on each side (wider at gas stations)
//   railL/R   1 if that side has a guardrail (drop-off), 0 if it is a hillside
// "Right" always means right of someone travelling toward increasing s.
// ---------------------------------------------------------------------------
import { ROAD } from '../config.js';
import { clamp, lerp, smoothstep } from '../core/mathUtils.js';

// Maps are content folders:  public/content/maps/<id>/map.json (+ height.bin),
// listed in public/content/maps/index.json. See .claude/skills/speedx-add-map.
// A map's "pois" are wishes: `s` is slid to the straightest nearby piece of road
// and the flatter side is picked automatically.

export async function listMaps() {
  return (await fetch('content/maps/index.json')).json();     // { maps: [ids], default: id }
}

export async function loadMap(mapId) {
  const folder = `content/maps/${mapId}/`;
  const info = await (await fetch(folder + 'map.json')).json();
  const raw = new Uint16Array(await (await fetch(folder + info.heightmap.file)).arrayBuffer());
  const hm = info.heightmap;

  // ---- Heightmap -----------------------------------------------------------
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = raw[i] * hm.step;   // metres above lowest point

  function gridHeight(grid, x, z) {
    const gx = clamp((x - hm.x0) / hm.cell, 0, hm.cols - 1.001);
    const gz = clamp((z - hm.z0) / hm.cell, 0, hm.rows - 1.001);
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r;
    const i = r * hm.cols + c;
    return lerp(lerp(grid[i], grid[i + 1], fx), lerp(grid[i + hm.cols], grid[i + hm.cols + 1], fx), fz);
  }

  // ---- Road centre line ----------------------------------------------------
  const road = buildRoadSamples(info.road);
  const n = road.count;

  // Height of the road: read the terrain, then smooth it a lot (real roads are graded).
  road.y = new Float32Array(n);
  for (let i = 0; i < n; i++) road.y[i] = gridHeight(heights, road.x[i], road.z[i]);
  // Elevation data is only accurate to a metre or two, which would feel like a lumpy road.
  // Four wide blur passes leave the hills but remove every bump shorter than ~150 m.
  for (let pass = 0; pass < 4; pass++) boxBlur(road.y, 45);
  const baseHeight = road.y[0];              // make the start of the road y = 0
  for (let i = 0; i < n; i++) road.y[i] -= baseHeight;
  for (let i = 0; i < heights.length; i++) heights[i] -= baseHeight;

  // Banking: real mountain roads tilt into the bend (up to ~6%).
  road.bank = new Float32Array(n);
  // (Uses an extra-smooth copy of the curvature so the tilt eases in and out of each bend.)
  const gentleCurve = road.curve.slice();
  boxBlur(gentleCurve, 14); boxBlur(gentleCurve, 14);
  for (let i = 0; i < n; i++) road.bank[i] = clamp(gentleCurve[i] * 5.0, -0.05, 0.05);

  // ---- Sides of the road ----------------------------------------------------
  road.benchL = new Float32Array(n).fill(ROAD.bench);
  road.benchR = new Float32Array(n).fill(ROAD.bench);
  road.limitL = new Float32Array(n).fill(ROAD.driveLimit);
  road.limitR = new Float32Array(n).fill(ROAD.driveLimit);
  road.railL = new Uint8Array(n);
  road.railR = new Uint8Array(n);
  const sideHeight = (i, d) => gridHeight(heights, road.x[i] - road.tz[i] * d, road.z[i] + road.tx[i] * d) - road.y[i];
  for (let i = 0; i < n; i++) {
    road.railL[i] = sideHeight(i, -24) < -2 ? 1 : 0;   // ground drops away -> guardrail
    road.railR[i] = sideHeight(i, 24) < -2 ? 1 : 0;
  }
  majorityFilter(road.railL, 12);
  majorityFilter(road.railR, 12);

  // ---- Places of interest ---------------------------------------------------
  const pois = (info.pois || []).map((wish) => {
    // Find the straightest spot within 350 m of the wished position.
    let best = 0, bestScore = Infinity;
    const centre = Math.round(wish.s / ROAD.step), search = Math.round(350 / ROAD.step);
    for (let i = Math.max(60, centre - search); i < Math.min(n - 60, centre + search); i += 5) {
      let bend = 0;
      for (let k = -30; k <= 30; k += 3) bend += Math.abs(road.curve[i + k]);
      if (bend < bestScore) { bestScore = bend; best = i; }
    }
    const side = Math.abs(sideHeight(best, 30)) <= Math.abs(sideHeight(best, -30)) ? 1 : -1;
    return { ...wish, index: best, s: best * ROAD.step, side };
  });
  // Turnaround space at both ends of the road.
  const widen = (index, halfLength, side, depth) => {
    const half = Math.round(halfLength / ROAD.step), ramp = Math.round(24 / ROAD.step);
    for (let i = Math.max(0, index - half - ramp); i <= Math.min(n - 1, index + half + ramp); i++) {
      const k = smoothstep(half + ramp, half, Math.abs(i - index));
      const bench = side > 0 ? road.benchR : road.benchL;
      const limit = side > 0 ? road.limitR : road.limitL;
      bench[i] = Math.max(bench[i], lerp(ROAD.bench, depth + 4, k));
      limit[i] = Math.max(limit[i], lerp(ROAD.driveLimit, depth, k));
      (side > 0 ? road.railR : road.railL)[i] = k > 0.02 ? 2 : (side > 0 ? road.railR : road.railL)[i]; // 2 = open lot
    }
  };
  for (const poi of pois) widen(poi.index, poi.length / 2, poi.side, poi.depth);
  for (const end of [14, n - 15]) { widen(end, 22, 1, 13); widen(end, 22, -1, 13); }

  // ---- Carve the road into the terrain ---------------------------------------
  // Near the road the mountain is replaced by a flat bench a little below the asphalt.
  const carved = heights.slice();
  const nearest = new Float32Array(heights.length).fill(1e9);
  for (let i = 0; i < n; i++) {
    const reach = Math.max(road.benchL[i], road.benchR[i]) + ROAD.blend;
    const c0 = Math.max(0, Math.floor((road.x[i] - reach - hm.x0) / hm.cell));
    const c1 = Math.min(hm.cols - 1, Math.ceil((road.x[i] + reach - hm.x0) / hm.cell));
    const r0 = Math.max(0, Math.floor((road.z[i] - reach - hm.z0) / hm.cell));
    const r1 = Math.min(hm.rows - 1, Math.ceil((road.z[i] + reach - hm.z0) / hm.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = hm.x0 + c * hm.cell - road.x[i], dz = hm.z0 + r * hm.cell - road.z[i];
        const dist = Math.hypot(dx, dz), g = r * hm.cols + c;
        if (dist >= nearest[g]) continue;
        nearest[g] = dist;
        const side = -dx * road.tz[i] + dz * road.tx[i];           // + = right of the road
        const bench = side > 0 ? road.benchR[i] : road.benchL[i];
        const t = smoothstep(bench, bench + ROAD.blend, dist);
        carved[g] = lerp(road.y[i] - 1.0, heights[g], t);
      }
    }
  }

  // ---- Fast "which road sample is near this point?" lookup --------------------
  const HASH = 40;
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(road.x[i] / HASH) + ',' + Math.floor(road.z[i] / HASH);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  function nearestIndex(x, z, hint = -1) {
    let best = -1, bestD = Infinity;
    const test = (i) => {
      const d = (road.x[i] - x) ** 2 + (road.z[i] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    };
    if (hint >= 0) {
      for (let i = Math.max(0, hint - 40); i <= Math.min(n - 1, hint + 40); i++) test(i);
      if (bestD < 60 * 60) return best;
    }
    const cx = Math.floor(x / HASH), cz = Math.floor(z / HASH);
    for (let ring = 1; ring <= 12 && best < 0; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iz = cz - ring; iz <= cz + ring; iz++) (buckets.get(ix + ',' + iz) || []).forEach(test);
      }
    }
    return Math.max(best, 0);
  }

  // Where is world point (x, z) relative to the road?
  //   s = distance along the road, d = metres right of the centre line.
  function project(x, z, hint = -1, out = {}) {
    const i = nearestIndex(x, z, hint);
    const along = (x - road.x[i]) * road.tx[i] + (z - road.z[i]) * road.tz[i];
    out.index = i;
    out.s = clamp(i * ROAD.step + along, 0, road.length);
    out.d = -(x - road.x[i]) * road.tz[i] + (z - road.z[i]) * road.tx[i];
    return out;
  }

  // Read any per-sample array at an exact distance s (blends two samples).
  function at(array, s) {
    const f = clamp(s / ROAD.step, 0, n - 1.001), i = Math.floor(f);
    return lerp(array[i], array[i + 1], f - i);
  }

  // World position for "s metres along, d metres right of centre".
  function pointAt(s, d, out = {}) {
    const tx = at(road.tx, s), tz = at(road.tz, s), len = Math.hypot(tx, tz) || 1;
    out.x = at(road.x, s) - (tz / len) * d;
    out.z = at(road.z, s) + (tx / len) * d;
    out.y = roadHeight(s, d);
    out.tx = tx / len; out.tz = tz / len;
    out.yaw = Math.atan2(-out.tx, -out.tz);
    return out;
  }

  // Height of the drivable surface (asphalt, shoulder or parking lot).
  function roadHeight(s, d) {
    return at(road.y, s) + at(road.bank, s) * clamp(d, -ROAD.paveHalfWidth, ROAD.paveHalfWidth);
  }

  return {
    id: mapId, info, road, pois,
    heightmap: hm, carved,
    terrainHeight: (x, z) => gridHeight(carved, x, z),
    project, pointAt, roadHeight, at,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Turn the rough OSM polyline into evenly spaced, smooth samples.
function buildRoadSamples(points) {
  // 1. Walk the polyline and drop a point every `step` metres.
  let pts = resample(points.map(([x, z]) => ({ x, z })), ROAD.step);
  // 2. Smooth away the little kinks from hand-drawn map data, then re-space.
  for (let pass = 0; pass < 24; pass++) {
    const next = pts.map((p) => ({ ...p }));
    for (let i = 2; i < pts.length - 2; i++) {
      next[i].x = (pts[i - 2].x + 4 * pts[i - 1].x + 6 * pts[i].x + 4 * pts[i + 1].x + pts[i + 2].x) / 16;
      next[i].z = (pts[i - 2].z + 4 * pts[i - 1].z + 6 * pts[i].z + 4 * pts[i + 1].z + pts[i + 2].z) / 16;
    }
    pts = next;
  }
  pts = resample(pts, ROAD.step);

  const n = pts.length;
  const road = {
    count: n, length: (n - 1) * ROAD.step,
    x: new Float32Array(n), z: new Float32Array(n),
    tx: new Float32Array(n), tz: new Float32Array(n), curve: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    road.x[i] = pts[i].x; road.z[i] = pts[i].z;
    road.tx[i] = (b.x - a.x) / len; road.tz[i] = (b.z - a.z) / len;
  }
  // Curvature = how fast the heading changes per metre (+ = turning left).
  for (let i = 1; i < n - 1; i++) {
    const cross = road.tx[i - 1] * road.tz[i + 1] - road.tz[i - 1] * road.tx[i + 1];
    road.curve[i] = -Math.asin(clamp(cross, -1, 1)) / (2 * ROAD.step);
  }
  boxBlur(road.curve, 6);
  return road;
}

function resample(pts, step) {
  const out = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    let d = step - carry;
    while (d <= seg) {
      out.push({ x: lerp(a.x, b.x, d / seg), z: lerp(a.z, b.z, d / seg) });
      d += step;
    }
    carry = seg - (d - step);
  }
  return out;
}

function boxBlur(array, radius) {
  const copy = array.slice(), n = array.length;
  let sum = 0, count = 0;
  for (let i = 0; i < Math.min(n, radius + 1); i++) { sum += copy[i]; count++; }
  for (let i = 0; i < n; i++) {
    array[i] = sum / count;
    const add = i + radius + 1, remove = i - radius;
    if (add < n) { sum += copy[add]; count++; }
    if (remove >= 0) { sum -= copy[remove]; count--; }
  }
}

// Removes tiny on/off flickers in the guardrail flags.
function majorityFilter(flags, radius) {
  const copy = flags.slice();
  for (let i = 0; i < flags.length; i++) {
    let ones = 0, total = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(flags.length - 1, i + radius); k++) { ones += copy[k]; total++; }
    flags[i] = ones * 2 > total ? 1 : 0;
  }
}
