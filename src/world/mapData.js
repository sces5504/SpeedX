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
//   lanes, laneWidth, median, half, barrier
//             how the road is laid out there (see ROAD_TYPES in config.js): lanes each way,
//             their width, half the painted median, centre line to the edge of the asphalt,
//             and centre line to the guardrail. The road can change kind along the way.
//   limit     the speed limit there, in metres per second (a section's "speedKmh", or the map's own)
// map.signals lists the traffic lights: { s, index, state } — state is 'green', 'yellow' or 'red'
// and is kept up to date by world/signals.js; the AI drivers read it.
// "Right" always means right of someone travelling toward increasing s.
//
// LOOPS. A map with "loop": true in map.json has a road with no ends: the last
// sample joins the first (road.closed is true). Then s runs round and round, so
// "is this car ahead of that one?" cannot be a plain subtraction any more. Code
// that compares positions along the road uses the map's helpers instead:
//   map.wrap(s)          put any s back on the road
//   map.ahead(from, to)  metres from one position forward to another (negative = behind)
//   map.roomAhead(s,dir) metres of road left before an end (endless on a loop)
//   map.indexAt(s)       the road sample nearest to s
// and for "where is the middle of my lane here?":
//   map.laneCentre(s, dir, lane)   d of a lane for someone driving dir (+1/-1); lane 0 is the one
//                                  next to the centre line, lane 1 the next one out (if there is one)
// ---------------------------------------------------------------------------
import { BUILDING_SIZES, GAMEPLAY, ROAD, ROAD_TYPES } from '../config.js';
import { clamp, lerp, smoothstep } from '../core/mathUtils.js';

// Maps are content folders:  public/content/maps/<id>/map.json (+ height.bin),
// listed in public/content/maps/index.json. See .claude/skills/speedx-add-map.
// A map's "pois" are wishes: `s` is slid to the straightest nearby piece of road
// and the flatter side is picked automatically.

export async function listMaps() {
  return (await fetch('content/maps/index.json')).json();     // { maps: [ids], default: id }
}

// Just a map's map.json (name, road points, stops...), without building anything.
// The menu uses it to show every installed map before one is loaded.
export async function loadMapInfo(mapId) {
  return (await fetch(`content/maps/${mapId}/map.json`)).json();
}

export async function loadMap(mapId) {
  const folder = `content/maps/${mapId}/`;
  const info = await loadMapInfo(mapId);
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
  const closed = info.loop === true;
  const road = buildRoadSamples(info.road, closed);
  const n = road.count;
  // Sample number -> a sample that exists: round the join on a loop, stopped at the ends otherwise.
  const sampleIndex = (i) => (closed ? ((i % n) + n) % n : clamp(i, 0, n - 1));

  // Height of the road: read the terrain, then smooth it a lot (real roads are graded).
  road.y = new Float32Array(n);
  for (let i = 0; i < n; i++) road.y[i] = gridHeight(heights, road.x[i], road.z[i]);
  // Elevation data is only accurate to a metre or two, which would feel like a lumpy road.
  // Four wide blur passes leave the hills but remove every bump shorter than ~150 m.
  for (let pass = 0; pass < 4; pass++) boxBlur(road.y, 45, closed);
  const baseHeight = road.y[0];              // make the start of the road y = 0
  for (let i = 0; i < n; i++) road.y[i] -= baseHeight;
  for (let i = 0; i < heights.length; i++) heights[i] -= baseHeight;
  // Where the sea's surface is in the game's heights (null for a map with no sea). The file
  // stores heights above its own lowest point (hm.minHeight, in real metres above sea level).
  const seaLevel = info.sea ? -hm.minHeight - baseHeight : null;

  // Banking: real mountain roads tilt into the bend (up to ~6%).
  road.bank = new Float32Array(n);
  // (Uses an extra-smooth copy of the curvature so the tilt eases in and out of each bend.)
  const gentleCurve = road.curve.slice();
  boxBlur(gentleCurve, 14, closed); boxBlur(gentleCurve, 14, closed);
  for (let i = 0; i < n; i++) road.bank[i] = clamp(gentleCurve[i] * 5.0, -0.05, 0.05);

  // ---- What kind of road is it where? (ROAD_TYPES in config.js) ------------------
  road.lanes = new Uint8Array(n);
  road.laneWidth = new Float32Array(n); road.median = new Float32Array(n); road.half = new Float32Array(n);
  road.limit = new Float32Array(n);
  const mapLimit = info.traffic?.speedLimit ?? GAMEPLAY.speedLimit;        // metres per second
  const layRoad = (from, to, type, limit = mapLimit) => {
    for (let i = from; i < to; i++) {
      road.lanes[i] = type.lanes; road.laneWidth[i] = type.laneWidth; road.median[i] = type.median;
      road.half[i] = type.median + type.lanes * type.laneWidth + type.shoulder;
      road.limit[i] = limit;
    }
  };
  layRoad(0, n, ROAD_TYPES['two-lane']);
  const sections = (info.sections || []).map((section) => ({ ...section, index: sampleNear(road, pointAlong(info.road, section.from)) }));
  sections.forEach((section, k) => {
    // What the real map says decides the kind, unless the section names one itself.
    const guess = section.divided && section.lanes >= 4 ? 'divided' : ['tertiary', 'unclassified', 'residential'].includes(section.kind) ? 'narrow' : 'two-lane';
    const type = ROAD_TYPES[section.type] || ROAD_TYPES[guess];
    // It runs until the next stretch begins; the last one runs to the end of the road
    // (on a loop: round to where the first one begins).
    const start = !closed && k === 0 ? 0 : section.index;
    const end = k + 1 < sections.length ? sections[k + 1].index : closed ? sections[0].index : n;
    const limit = section.speedKmh ? section.speedKmh / 3.6 : mapLimit;      // what the real road's signs say, if the map knows
    if (end > start) layRoad(start, end, type, limit);
    else { layRoad(start, n, type, limit); layRoad(0, end, type, limit); }   // a stretch that runs across the join of a loop
  });
  // Where the kind changes, the widths ease from one to the other over about 60 m instead of jumping.
  for (const widths of [road.laneWidth, road.median, road.half]) { boxBlur(widths, 10, closed); boxBlur(widths, 10, closed); }
  // The guardrail, the wall a car cannot pass and the flat verge keep their usual distance from the asphalt.
  road.barrier = road.half.map((half) => half + ROAD.barrierOffset - ROAD.paveHalfWidth);
  road.limitL = road.half.map((half) => half + ROAD.driveLimit - ROAD.paveHalfWidth);
  road.limitR = road.limitL.slice();
  road.benchL = road.half.map((half) => half + ROAD.bench - ROAD.paveHalfWidth);
  road.benchR = road.benchL.slice();

  // ---- Traffic lights ("signals" in map.json: metres along the road, from the real map) ----
  const signals = (info.signals || []).map((metres) => {
    const index = sampleNear(road, pointAlong(info.road, metres));
    return { index, s: index * ROAD.step, state: 'green' };
  });

  // ---- Sides of the road ----------------------------------------------------
  road.railL = new Uint8Array(n);
  road.railR = new Uint8Array(n);
  const sideHeight = (i, d) => gridHeight(heights, road.x[i] - road.tz[i] * d, road.z[i] + road.tx[i] * d) - road.y[i];
  for (let i = 0; i < n; i++) {
    const out = road.half[i] + 18;                      // look this far from the centre line
    road.railL[i] = sideHeight(i, -out) < -2 ? 1 : 0;   // ground drops away -> guardrail
    road.railR[i] = sideHeight(i, out) < -2 ? 1 : 0;
  }
  majorityFilter(road.railL, 12, closed);
  majorityFilter(road.railR, 12, closed);

  // ---- Places of interest ---------------------------------------------------
  const pois = (info.pois || []).map((wish) => {
    // Find the straightest spot within 350 m of the wished position.
    let best = 0, bestScore = Infinity;
    const centre = Math.round(wish.s / ROAD.step), search = Math.round(350 / ROAD.step);
    const first = closed ? centre - search : Math.max(60, centre - search);          // (an open road keeps its ends clear)
    const last = closed ? centre + search : Math.min(n - 60, centre + search);
    for (let j = first; j < last; j += 5) {
      const i = sampleIndex(j);
      let bend = 0;
      for (let k = -30; k <= 30; k += 3) bend += Math.abs(road.curve[sampleIndex(i + k)]);
      if (bend < bestScore) { bestScore = bend; best = i; }
    }
    const side = Math.abs(sideHeight(best, 30)) <= Math.abs(sideHeight(best, -30)) ? 1 : -1;
    // A stop's measurements (its depth, and where its layout puts things) assume the standard
    // road width. On a wider or narrower road the whole lot is pushed out or in by `shift`.
    const shift = road.barrier[best] - ROAD.barrierOffset;
    return { ...wish, index: best, s: best * ROAD.step, side, shift };
  });
  // Make the flat ground beside the road wider around `index` (a lot, or turnaround space).
  // depth = how far from the centre line a car may drive there; flat = how far the ground is levelled.
  const widen = (index, halfLength, side, depth, flat = depth + 4) => {
    const half = Math.round(halfLength / ROAD.step), ramp = Math.round(24 / ROAD.step);
    for (let j = index - half - ramp; j <= index + half + ramp; j++) {
      if (!closed && (j < 0 || j > n - 1)) continue;
      const i = sampleIndex(j);
      const k = smoothstep(half + ramp, half, Math.abs(j - index));
      const bench = side > 0 ? road.benchR : road.benchL;
      const limit = side > 0 ? road.limitR : road.limitL;
      bench[i] = Math.max(bench[i], lerp(bench[i], flat, k));
      limit[i] = Math.max(limit[i], lerp(limit[i], depth, k));
      (side > 0 ? road.railR : road.railL)[i] = k > 0.02 ? 2 : (side > 0 ? road.railR : road.railL)[i]; // 2 = open lot
    }
  };
  for (const poi of pois) widen(poi.index, poi.length / 2, poi.side, poi.depth + poi.shift);
  // ---- Buildings ("buildings" in map.json; town.js draws them) ------------------------
  // Each has a real position ("at": [x, z]) or a place along the road ("s", "side"). Here we
  // work out where its front wall stands, and level the ground under the ones beside the road
  // so they get a paved forecourt you can drive onto, up to the wall.
  const buildings = (info.buildings || []).map((wish) => {
    const scale = wish.scale ?? 1;                                          // a landmark may be drawn a little larger than life
    const usual = BUILDING_SIZES[wish.kind] || [8, 8];
    const width = (wish.width ?? usual[0]) * scale, depth = (wish.depth ?? usual[1]) * scale;
    const index = wish.at ? sampleNear(road, wish.at) : sampleIndex(Math.round(wish.s / ROAD.step));
    const closest = road.barrier[index] + (wish.gap ?? 2.5);                // the nearest a front wall may come to the road
    let side = wish.side ?? 1, front = closest + 1.5, far = false;
    if (wish.away) {                                                        // "s" + "away": so many metres from the centre line
      front = Math.max(closest, wish.away - depth / 2);
      far = front > road.barrier[index] + 25;
    }
    if (wish.at) {
      const across = -(wish.at[0] - road.x[index]) * road.tz[index] + (wish.at[1] - road.z[index]) * road.tx[index];
      side = across >= 0 ? 1 : -1;
      front = Math.max(closest, Math.abs(across) - depth / 2);
      far = front > road.barrier[index] + 25;                               // well away from the road: it just stands on the hillside
    }
    return { ...wish, width, depth, scale, index, s: index * ROAD.step, side, front, far };
  });
  for (const b of buildings) if (!b.far) widen(b.index, b.width / 2 + 2, b.side, b.front - 0.6, b.front + b.depth + 2);

  // Turnaround space at both ends of the road (a loop has no ends).
  if (!closed) for (const end of [14, n - 15]) { widen(end, 22, 1, 13); widen(end, 22, -1, 13); }

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
      for (let j = hint - 40; j <= hint + 40; j++) if (closed || (j >= 0 && j < n)) test(sampleIndex(j));
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
    out.s = wrap(i * ROAD.step + along);
    out.d = -(x - road.x[i]) * road.tz[i] + (z - road.z[i]) * road.tx[i];
    return out;
  }

  // Read any per-sample array at an exact distance s (blends two samples).
  function at(array, s) {
    if (closed) {
      const f = wrap(s) / ROAD.step, i = Math.floor(f) % n;
      return lerp(array[i], array[(i + 1) % n], f - Math.floor(f));
    }
    const f = clamp(s / ROAD.step, 0, n - 1.001), i = Math.floor(f);
    return lerp(array[i], array[i + 1], f - i);
  }

  // ---- Positions along the road (see LOOPS at the top of this file) -------------
  // Put any s back on the road: round the join on a loop, stopped at the ends otherwise.
  function wrap(s) {
    return closed ? ((s % road.length) + road.length) % road.length : clamp(s, 0, road.length);
  }
  // Metres from `from` forward (toward bigger s) to `to`; negative when `to` is behind.
  // On a loop it is the short way round, so the answer is never more than half a lap.
  function ahead(from, to) {
    const gap = to - from;
    if (!closed) return gap;
    return gap - Math.round(gap / road.length) * road.length;
  }
  // Metres of road left before an end, for someone at s driving `dir` (+1 up the road, -1 down).
  function roomAhead(s, dir) {
    if (closed) return Infinity;
    return dir > 0 ? road.length - s : s;
  }
  const indexAt = (s) => sampleIndex(Math.round(s / ROAD.step));

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
    const half = at(road.half, s);
    return at(road.y, s) + at(road.bank, s) * clamp(d, -half, half);
  }

  // The middle of a lane at s, as a distance right of the centre line, for someone driving
  // dir (+1 up the road, -1 down). lane 0 is next to the centre line; where the road has only
  // one lane each way every lane number means that one lane.
  function laneCentre(s, dir, lane = 0) {
    const i = indexAt(s), k = Math.min(lane, road.lanes[i] - 1);
    return dir * (road.median[i] + road.laneWidth[i] * (k + 0.5));
  }

  return {
    id: mapId, info, road, pois, buildings, signals,
    heightmap: hm, carved, seaLevel,
    terrainHeight: (x, z) => gridHeight(carved, x, z),
    project, pointAt, roadHeight, at,
    wrap, ahead, roomAhead, indexAt, laneCentre,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Turn the rough OSM polyline into evenly spaced, smooth samples.
// closed = the road is a loop: the last point joins the first, and nothing below may
// treat sample 0 or the last sample as special.
function buildRoadSamples(points, closed) {
  // 1. Walk the polyline and drop a point every `step` metres.
  let pts = resample(points.map(([x, z]) => ({ x, z })), ROAD.step, closed);
  // 2. Smooth away the little kinks from hand-drawn map data, then re-space.
  for (let pass = 0; pass < 24; pass++) {
    const count = pts.length, next = pts.map((p) => ({ ...p }));
    const near = (i) => pts[closed ? (i + count) % count : i];
    for (let i = closed ? 0 : 2; i < (closed ? count : count - 2); i++) {
      next[i].x = (near(i - 2).x + 4 * near(i - 1).x + 6 * pts[i].x + 4 * near(i + 1).x + near(i + 2).x) / 16;
      next[i].z = (near(i - 2).z + 4 * near(i - 1).z + 6 * pts[i].z + 4 * near(i + 1).z + near(i + 2).z) / 16;
    }
    pts = next;
  }
  pts = resample(pts, ROAD.step, closed);

  const n = pts.length;
  const neighbour = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  const road = {
    count: n, closed,
    length: (closed ? n : n - 1) * ROAD.step,      // a loop also has the piece from the last sample back to the first
    x: new Float32Array(n), z: new Float32Array(n),
    tx: new Float32Array(n), tz: new Float32Array(n), curve: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const a = neighbour(i - 1), b = neighbour(i + 1);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    road.x[i] = pts[i].x; road.z[i] = pts[i].z;
    road.tx[i] = (b.x - a.x) / len; road.tz[i] = (b.z - a.z) / len;
  }
  // Curvature = how fast the heading changes per metre (+ = turning left).
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const before = (i - 1 + n) % n, after = (i + 1) % n;
    const cross = road.tx[before] * road.tz[after] - road.tz[before] * road.tx[after];
    road.curve[i] = -Math.asin(clamp(cross, -1, 1)) / (2 * ROAD.step);
  }
  boxBlur(road.curve, 6, closed);
  return road;
}

// The [x, z] point `metres` along a list of [x, z] points (map.json measures its sections that way).
function pointAlong(points, metres) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (metres <= seg) return [lerp(a[0], b[0], metres / (seg || 1)), lerp(a[1], b[1], metres / (seg || 1))];
    metres -= seg;
  }
  return points[points.length - 1];
}

// The road sample closest to a point (a slow search: only for the few things worked out while loading).
function sampleNear(road, [x, z]) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < road.count; i++) {
    const d = (road.x[i] - x) ** 2 + (road.z[i] - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Points every `step` metres along a line. For a loop the line also runs from its last
// point back to its first, and the spacing is stretched a hair (well under a millimetre
// per step) so that a whole number of steps fits exactly once round.
function resample(pts, step, closed) {
  const line = closed ? [...pts, pts[0]] : pts;
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z);
  const wanted = closed ? Math.round(total / step) : Infinity;      // how many points a loop gets
  if (closed) step = total / wanted;
  const out = [{ ...line[0] }];
  let carry = 0;
  for (let i = 1; i < line.length && out.length < wanted; i++) {
    const a = line[i - 1], b = line[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    let d = step - carry;
    while (d <= seg && out.length < wanted) {
      out.push({ x: lerp(a.x, b.x, d / seg), z: lerp(a.z, b.z, d / seg) });
      d += step;
    }
    carry = seg - (d - step);
  }
  return out;
}

// Average every value with its neighbours up to `radius` samples away.
// closed = the array describes a loop, so the neighbours of the first values are the last ones.
function boxBlur(array, radius, closed = false) {
  const copy = array.slice(), n = array.length;
  if (closed) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += copy[(k + n * radius) % n];
    for (let i = 0; i < n; i++) {
      array[i] = sum / (2 * radius + 1);
      sum += copy[(i + radius + 1) % n] - copy[(i - radius + n * radius) % n];
    }
    return;
  }
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
function majorityFilter(flags, radius, closed = false) {
  const copy = flags.slice(), n = flags.length;
  for (let i = 0; i < n; i++) {
    let ones = 0, total = 0;
    for (let j = i - radius; j <= i + radius; j++) {
      if (!closed && (j < 0 || j > n - 1)) continue;
      ones += copy[(j + n) % n]; total++;
    }
    flags[i] = ones * 2 > total ? 1 : 0;
  }
}
