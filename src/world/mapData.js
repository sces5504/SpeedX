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
//   tiltTo    how far from the centre line the banking carries on (the asphalt; more at a junction mouth)
//   railL/R   1 if that side has a guardrail (drop-off), 0 if it is a hillside,
//             2 = an open paved lot (a stop, a forecourt), 3 = the mouth of a road that joins here
//   under     1 where this road runs across the ground of another one at a junction (see joinWays)
//   lanes, laneWidth, median, half, barrier
//             how the road is laid out there (see ROAD_TYPES in config.js): lanes each way,
//             their width, half the painted median, centre line to the edge of the asphalt,
//             and centre line to the guardrail. The road can change kind along the way.
//   wall      1 where a concrete wall stands on the median, 2 where that wall has an opening to cross by, 0 = no wall
//   centreLine  1 where a centre line is painted
//   limit     the speed limit there, in metres per second (a section's "speedKmh", or the map's own)
// way.signals lists a road's traffic lights: { s, index, state } — state is 'green', 'yellow' or 'red'
// and is kept up to date by world/signals.js; the AI drivers read it. (map.signals = the main road's.)
// A light that stands at a junction has more to say: see lightJunction() below.
// "Right" always means right of someone travelling toward increasing s.
//
// LOOPS. A map with "loop": true in map.json has a road with no ends: the last
// sample joins the first (road.closed is true). Then s runs round and round, so
// "is this car ahead of that one?" cannot be a plain subtraction any more. Code
// that compares positions along the road uses the map's helpers instead:
//   map.wrap(s)          put any s back on the road
//   map.ahead(from, to)  metres from one position forward to another (negative = behind)
//   map.roomAhead(s,dir) metres of road left before an end (endless on a loop)
//   map.nearEnd(s, m)    is s within m metres of an end? (never, on a loop)
//   map.indexAt(s)       the road sample nearest to s
// WAYS. A map may have more than one road. Each road is a WAY: an object that holds one road's
// samples (way.road) and answers every question above about that road (way.pointAt, way.wrap,
// way.laneCentre...). map.ways lists them, the main road first; map.json gives the main road as
// before ("road") and any others in "roads": [{ id, road: [[x, z]...], type, loop, sections }].
// The map itself still answers for its main road (map.pointAt === map.ways[0].pointAt), so a
// one-road map works exactly as it always did.
//   map.locate(x, z)    the way a point is on, and where: { way, index, s, d }
//   map.spotsAt(x, z)   the same for EVERY way near the point (walls: a car is only stopped where
//                       no road lets it through)
//   map.junctions       where ways meet: { x, z, arms: [{ way, s, dir }] } (see joinWays below)
// Ways meet by simply being drawn to touch: an end of one lying on another (a side road, a fork,
// a merge), or two crossing. The way listed FIRST is the one "on top": it keeps its paint and its
// height, the other is brought up to it. So list main roads before the roads that join them.
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

  // ---- The roads ("ways": see WAYS at the top of this file) ---------------------------
  // The main road is written in map.json as before ("road", "loop", "sections", "signals");
  // "roads" lists any others, each with the same four things and an id.
  const mapLimit = info.traffic?.speedLimit ?? GAMEPLAY.speedLimit;        // metres per second
  const ways = [{ id: 'main', road: info.road, loop: info.loop, sections: info.sections, signals: info.signals }, ...(info.roads || [])]
    .map((wayInfo, number) => startWay(wayInfo, number));
  // Heights are counted from the start of the main road: that point is y = 0.
  const baseHeight = ways[0].road.y[0];
  for (const way of ways) for (let i = 0; i < way.road.count; i++) way.road.y[i] -= baseHeight;
  for (let i = 0; i < heights.length; i++) heights[i] -= baseHeight;
  // Where the sea's surface is in the game's heights (null for a map with no sea). The file
  // stores heights above its own lowest point (hm.minHeight, in real metres above sea level).
  const seaLevel = info.sea ? -hm.minHeight - baseHeight : null;
  for (const way of ways) finishWay(way);
  const junctions = joinWays(ways);
  // Traffic lights at junctions ("signalJunctions" in map.json: a point at each junction that has them).
  for (const [x, z] of info.signalJunctions || []) {
    const junction = junctions.reduce((best, j) => (Math.hypot(j.x - x, j.z - z) < Math.hypot(best.x - x, best.z - z) ? j : best), junctions[0]);
    if (junction && Math.hypot(junction.x - x, junction.z - z) < 60) lightJunction(junction);
  }

  // A way's centre line and its height, smoothed. (Everything else about it comes in finishWay,
  // once the heights have been counted from the start of the main road.)
  function startWay(wayInfo, number) {
    const closed = wayInfo.loop === true;
    const road = buildRoadSamples(wayInfo.road, closed);
    // Height of the road: read the terrain, then smooth it a lot (real roads are graded).
    road.y = new Float32Array(road.count);
    for (let i = 0; i < road.count; i++) road.y[i] = gridHeight(heights, road.x[i], road.z[i]);
    // Elevation data is only accurate to a metre or two, which would feel like a lumpy road.
    // Four wide blur passes leave the hills but remove every bump shorter than ~150 m.
    for (let pass = 0; pass < 4; pass++) boxBlur(road.y, 45, closed);
    return { id: wayInfo.id, number, info, wayInfo, road, junctions: [] };
  }

  // Everything else about one way: banking, what kind of road it is where, its traffic lights,
  // its guardrails, and the questions it can answer (pointAt, project, laneCentre...).
  function finishWay(way) {
    const { road, wayInfo } = way, n = road.count, closed = road.closed;
    // Sample number -> a sample that exists: round the join on a loop, stopped at the ends otherwise.
    const sampleIndex = (i) => (closed ? ((i % n) + n) % n : clamp(i, 0, n - 1));

    // Banking: real mountain roads tilt into the bend (up to ~6%).
    road.bank = new Float32Array(n);
    // (Uses an extra-smooth copy of the curvature so the tilt eases in and out of each bend.)
    const gentleCurve = road.curve.slice();
    boxBlur(gentleCurve, 14, closed); boxBlur(gentleCurve, 14, closed);
    for (let i = 0; i < n; i++) road.bank[i] = clamp(gentleCurve[i] * 5.0, -0.05, 0.05);

    // ---- What kind of road is it where? (ROAD_TYPES in config.js) ------------------
    road.lanes = new Uint8Array(n); road.wall = new Uint8Array(n); road.centreLine = new Uint8Array(n);
    road.laneWidth = new Float32Array(n); road.median = new Float32Array(n); road.half = new Float32Array(n);
    road.limit = new Float32Array(n);
    road.under = new Uint8Array(n);            // 1 where this way runs across another way's ground (see joinWays)
    const layRoad = (from, to, type, limit = mapLimit) => {
      for (let i = from; i < to; i++) {
        road.lanes[i] = type.lanes; road.laneWidth[i] = type.laneWidth; road.median[i] = type.median;
        road.half[i] = type.median + type.lanes * type.laneWidth + type.shoulder;
        road.limit[i] = limit;
        const opening = type.openEvery && (i * ROAD.step) % type.openEvery < type.openLength;      // a gap left in the wall
        road.wall[i] = !type.wall ? 0 : opening ? 2 : 1; road.centreLine[i] = type.centreLine === false ? 0 : 1;
      }
    };
    layRoad(0, n, ROAD_TYPES[wayInfo.type] || ROAD_TYPES['two-lane']);
    const sections = (wayInfo.sections || []).map((section) => ({ ...section, index: sampleNear(road, pointAlong(wayInfo.road, section.from)) }));
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
    road.tiltTo = road.half.slice();           // how far from the centre line the road's banking carries on (see roadHeight)

    // ---- The road's name on each stretch (painted on the asphalt, as in Taiwan) ---------------
    // A section's name starts with its route number: "2 淡金公路" is Provincial Highway 2 -> "台2線".
    way.routeNames = sections.map((section) => {
      const ref = (section.name || '').split(' ')[0];
      return { index: section.index, label: /^\d+$/.test(ref) ? `台${ref}線` : ref };
    }).filter((entry) => entry.label);

    // ---- Traffic lights ("signals" in map.json: metres along the road, from the real map) ----
    way.signals = (wayInfo.signals || []).map((metres) => {
      const index = sampleNear(road, pointAlong(wayInfo.road, metres));
      return { index, s: index * ROAD.step, state: 'green' };
    });
    // A junction is always an opening in the median wall.
    for (const signal of way.signals) for (let j = -8; j <= 8; j++) { const i = sampleIndex(signal.index + j); if (road.wall[i]) road.wall[i] = 2; }

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
    // The sample of this way within about 40 m of a point, or -1 when the way is not that near.
    // (Cheap: it only looks around the point. project() below always answers, however far away.)
    function sampleNearby(x, z) {
      let best = -1, bestD = HASH * HASH;
      const cx = Math.floor(x / HASH), cz = Math.floor(z / HASH);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          for (const i of buckets.get(ix + ',' + iz) || []) {
            const d = (road.x[i] - x) ** 2 + (road.z[i] - z) ** 2;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      return best;
    }

    // Where is world point (x, z) relative to the road?
    //   s = distance along the road, d = metres right of the centre line.
    function project(x, z, hint = -1, out = {}) {
      const i = nearestIndex(x, z, hint);
      const along = (x - road.x[i]) * road.tx[i] + (z - road.z[i]) * road.tz[i];
      out.index = i;
      out.s = wrap(i * ROAD.step + along);
      out.d = -(x - road.x[i]) * road.tz[i] + (z - road.z[i]) * road.tx[i];
      // (how many metres the point lies beyond an end of the road: 0 = beside the road itself)
      out.past = closed ? 0 : Math.max(0, -(i * ROAD.step + along), i * ROAD.step + along - road.length);
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
    // Is s within `margin` metres of an end of the road? (Never, on a loop.)
    const nearEnd = (s, margin) => Math.min(roomAhead(s, 1), roomAhead(s, -1)) < margin;
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

    // Height of the drivable surface (asphalt, shoulder or parking lot). The asphalt is banked;
    // beyond its edge the ground is level (road.tiltTo: wider at the mouth of a junction).
    function roadHeight(s, d) {
      const reach = at(road.tiltTo, s);
      return at(road.y, s) + at(road.bank, s) * clamp(d, -reach, reach);
    }

    // The middle of a lane at s, as a distance right of the centre line, for someone driving
    // dir (+1 up the road, -1 down). lane 0 is next to the centre line; where the road has only
    // one lane each way every lane number means that one lane.
    function laneCentre(s, dir, lane = 0) {
      const i = indexAt(s), k = Math.min(lane, road.lanes[i] - 1);
      return dir * (road.median[i] + road.laneWidth[i] * (k + 0.5));
    }

    Object.assign(way, { project, pointAt, roadHeight, at, wrap, ahead, roomAhead, nearEnd, indexAt, laneCentre,
      sampleIndex, sampleNearby, sideHeight, terrainHeight: (x, z) => gridHeight(carved, x, z) });
  }

  // Make the flat ground beside a way wider around `index` (a lot, or turnaround space).
  // depth = how far from the centre line a car may drive there; flat = how far the ground is levelled.
  const widen = (way, index, halfLength, side, depth, flat = depth + 4) => {
    const { road } = way, n = road.count;
    const half = Math.round(halfLength / ROAD.step), ramp = Math.round(24 / ROAD.step);
    for (let j = index - half - ramp; j <= index + half + ramp; j++) {
      if (!road.closed && (j < 0 || j > n - 1)) continue;
      const i = way.sampleIndex(j);
      const k = smoothstep(half + ramp, half, Math.abs(j - index));
      const bench = side > 0 ? road.benchR : road.benchL;
      const limit = side > 0 ? road.limitR : road.limitL;
      bench[i] = Math.max(bench[i], lerp(bench[i], flat, k));
      limit[i] = Math.max(limit[i], lerp(limit[i], depth, k));
      (side > 0 ? road.railR : road.railL)[i] = k > 0.02 ? 2 : (side > 0 ? road.railR : road.railL)[i]; // 2 = open lot
    }
  };

  // ---- Places of interest and buildings (all along the main road, for now) --------------
  const main = ways[0], road = main.road, n = road.count, closed = road.closed;
  const pois = (info.pois || []).map((wish) => {
    // Find the straightest spot within 350 m of the wished position.
    let best = 0, bestScore = Infinity;
    const centre = Math.round(wish.s / ROAD.step), search = Math.round(350 / ROAD.step);
    const first = closed ? centre - search : Math.max(60, centre - search);          // (an open road keeps its ends clear)
    const last = closed ? centre + search : Math.min(n - 60, centre + search);
    for (let j = first; j < last; j += 5) {
      const i = main.sampleIndex(j);
      if (main.junctions.some((at) => Math.abs(main.ahead(at.s, i * ROAD.step)) < wish.length / 2 + 50)) continue;     // not across a junction
      let bend = Math.abs(j - centre) * 1e-9;                  // (between two equally straight spots, the one nearer the wish)
      for (let k = -30; k <= 30; k += 3) bend += Math.abs(road.curve[main.sampleIndex(i + k)]);
      if (bend < bestScore) { bestScore = bend; best = i; }
    }
    const side = Math.abs(main.sideHeight(best, 30)) <= Math.abs(main.sideHeight(best, -30)) ? 1 : -1;
    // A stop's measurements (its depth, and where its layout puts things) assume the standard
    // road width. On a wider or narrower road the whole lot is pushed out or in by `shift`.
    const shift = road.barrier[best] - ROAD.barrierOffset;
    return { ...wish, index: best, s: best * ROAD.step, side, shift };
  });
  for (const poi of pois) widen(main, poi.index, poi.length / 2, poi.side, poi.depth + poi.shift);
  // ---- Buildings ("buildings" in map.json; town.js draws them) ------------------------
  // Each has a real position ("at": [x, z]) or a place along the road ("s", "side"). Here we
  // work out where its front wall stands, and level the ground under the ones beside the road
  // so they get a paved forecourt you can drive onto, up to the wall.
  const buildings = (info.buildings || []).map((wish) => {
    const scale = wish.scale ?? 1;                                          // a landmark may be drawn a little larger than life
    const usual = BUILDING_SIZES[wish.kind] || [8, 8];
    const width = (wish.width ?? usual[0]) * scale, depth = (wish.depth ?? usual[1]) * scale;
    const index = wish.at ? sampleNear(road, wish.at) : main.sampleIndex(Math.round(wish.s / ROAD.step));
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
  for (const b of buildings) if (!b.far) widen(main, b.index, b.width / 2 + 2, b.side, b.front - 0.6, b.front + b.depth + 2);

  // Turnaround space at every end of a road that just stops (a loop has no ends; an end that
  // joins another road needs none).
  for (const way of ways) {
    if (way.road.closed) continue;
    if (!way.road.joinedStart) { widen(way, 14, 22, 1, 13); widen(way, 14, 22, -1, 13); }
    if (!way.road.joinedEnd) { widen(way, way.road.count - 15, 22, 1, 13); widen(way, way.road.count - 15, 22, -1, 13); }
  }

  // ---- Carve the roads into the terrain ---------------------------------------
  // Near a road the mountain is replaced by a flat bench a little below the asphalt.
  const carved = heights.slice();
  const nearest = new Float32Array(heights.length).fill(1e9);
  for (const { road } of ways) {
    for (let i = 0; i < road.count; i++) {
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
  }

  // ---- Woodland ("woods" in map.json: the outlines of the real forests, from the map) --------
  // scenery.js asks this to plant trees where there really are trees ("where": "woods" / "open").
  const woods = (info.woods || []).map((outline) => ({
    outline,
    minX: Math.min(...outline.map((p) => p[0])), maxX: Math.max(...outline.map((p) => p[0])),
    minZ: Math.min(...outline.map((p) => p[1])), maxZ: Math.max(...outline.map((p) => p[1])),
  }));
  function inWoods(x, z) {
    for (const wood of woods) {
      if (x < wood.minX || x > wood.maxX || z < wood.minZ || z > wood.maxZ) continue;
      let inside = false;                       // count how many edges a line from the point crosses: odd = inside
      const o = wood.outline;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        if ((o[i][1] > z) !== (o[j][1] > z) && x < ((o[j][0] - o[i][0]) * (z - o[i][1])) / (o[j][1] - o[i][1]) + o[i][0]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  // ---- "Which road is this point on?" (see WAYS at the top of this file) ---------------
  // Every way that passes near (x, z), with where the point is on each: [{ way, index, s, d }].
  // A map with one road always answers with that road. `hintWay` and `hintIndex` say where the
  // asker was a moment ago (a car remembers both): they make the search quick, and are the answer
  // when no road is anywhere near.
  function spotsAt(x, z, hintWay = main, hintIndex = -1) {
    if (ways.length === 1) return [Object.assign(main.project(x, z, hintIndex), { way: main })];
    const spots = [];
    for (const way of ways) {
      const near = way.sampleNearby(x, z);
      if (near >= 0) spots.push(Object.assign(way.project(x, z, near), { way }));
    }
    if (!spots.length) spots.push(Object.assign(hintWay.project(x, z, hintIndex), { way: hintWay }));
    return spots;
  }
  // The ONE way a point is on, with where: { way, index, s, d }. Where two roads share the ground
  // (a junction) it is the one listed first in map.json; off every road, the one whose asphalt is nearest.
  function locate(x, z, hintWay = main, hintIndex = -1) {
    let best = null, bestOver = Infinity;
    const spots = spotsAt(x, z, hintWay, hintIndex);
    for (const spot of spots) {
      if (spot.past > 0 && spots.length > 1) continue;                                           // beyond the end of that road: it is some other road's ground
      const over = Math.max(0, Math.abs(spot.d) - spot.way.at(spot.way.road.half, spot.s));     // metres outside that way's asphalt
      if (over < bestOver) { best = spot; bestOver = over; }                                     // (ways are tried in map.json order: the first one on the asphalt wins)
    }
    return best || spots[0];
  }

  // The map answers every question about its MAIN road itself (map.pointAt, map.road...),
  // so code written for a one-road map needs no change. The other roads are in map.ways.
  return {
    ...main, id: mapId, info, ways, junctions, pois, buildings,
    heightmap: hm, carved, seaLevel,
    terrainHeight: (x, z) => gridHeight(carved, x, z),
    inWoods, spotsAt, locate,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Finds where the ways meet and makes each meeting drivable. Two kinds are recognised from the
// lines alone (nothing is written by hand in map.json):
//   an END of one way lies on another way            -> a side road, a fork or a merge
//   two ways CROSS somewhere in the middle of both   -> a crossroads
// At each one the lower way (the one that ends there, or the one listed later) is brought to the
// height of the upper way; the upper way's guardrail, berm and median wall are opened; and the
// lower way is marked `under` where it runs across the upper way's ground, so that road.js draws
// no paint or kerbs of its own there. Returns the junctions: { x, z, arms: [{ way, s, dir }] }.
// An arm is a road you can leave the junction on: along `way`, from `s`, driving `dir` (+1 / -1).
const EASE = 40;                  // samples (80 m) over which a joining road's height is eased to the junction's
const FLARE = 8;                  // samples (16 m) over which a joining road's mouth widens toward the junction
const CORNER = 7;                 // metres each corner of a junction is cut back
function joinWays(ways) {
  const junctions = [];
  // Run `visit(index, k)` for the samples of a way from `from`, going `dir`, k = 0, 1, 2... steps away.
  const walk = (way, from, dir, steps, visit) => {
    for (let k = 0; k <= steps; k++) {
      const j = from + dir * k;
      if (!way.road.closed && (j < 0 || j > way.road.count - 1)) continue;       // off the end of a road that stops
      visit(way.sampleIndex(j), k);
    }
  };
  // The lower way meets the upper way: sample iL of one lies on sample iU of the other.
  // dirs = the directions in which the lower way carries on from there ([1], [-1] or both).
  function meet(upper, iU, lower, iL, dirs) {
    const up = upper.road, low = lower.road;
    // 1. A junction is flat across the upper way (no banking for 30 m either side).
    walk(upper, iU - 25, 1, 50, (i, k) => { up.bank[i] *= smoothstep(8, 25, Math.abs(k - 25)); });
    // The upper way still slopes along its length. Seen from the lower way that is a sideways tilt:
    const slope = (up.y[upper.sampleIndex(iU + 2)] - up.y[upper.sampleIndex(iU - 2)]) / (4 * ROAD.step);
    const tilt = slope * (up.tx[iU] * -low.tz[iL] + up.tz[iU] * low.tx[iL]);
    const sides = new Set();                    // the sides of the upper way the lower way leaves on (+1 right, -1 left)
    const done = new Set();                     // (where both directions start, the same sample comes up twice)
    for (const dir of dirs) {
      // 2. How far does the lower way run across the upper way's ground? `mouth` = that many samples.
      let mouth = 0, across = true;
      walk(lower, iL, dir, 60, (i, k) => {
        const spot = upper.project(low.x[i], low.z[i], iU);
        across = across && Math.abs(spot.d) < up.barrier[spot.index] + 0.5;
        if (across) mouth = k;
        if (k === 12) sides.add(spot.d >= 0 ? 1 : -1);
      });
      // 3. Across that ground the lower way lies exactly ON the upper way's surface and is "under"
      //    it; from there it eases back to its own height over 80 m.
      let lift = 0;
      walk(lower, iL, dir, mouth + EASE, (i, k) => {
        if (k <= mouth) {
          const spot = upper.project(low.x[i], low.z[i], iU);
          lift = upper.roadHeight(spot.s, spot.d) - low.y[i];
          low.y[i] += lift; low.under[i] = 1;
        } else low.y[i] += lift * smoothstep(EASE, 0, k - mouth);
        low.bank[i] = lerp(low.bank[i], tilt, smoothstep(mouth + 15, mouth + 3, k));
      });
      // 4. The mouth: no guardrail or berm, and the paving flares out toward the upper way, so the
      //    corners are cut off and a car can turn in and out without clipping them.
      walk(lower, iL, dir, mouth + FLARE, (i, k) => {
        if (done.has(i)) return;
        done.add(i);
        low.railL[i] = low.railR[i] = 2;
        const extra = CORNER * smoothstep(mouth + FLARE, mouth, k);
        low.benchL[i] += extra; low.benchR[i] += extra; low.limitL[i] += extra; low.limitR[i] += extra; low.tiltTo[i] += extra;
      });
    }
    // 5. Open the upper way's side (and its median wall) for as long as the mouth is wide.
    const square = Math.max(0.45, Math.abs(up.tx[iU] * low.tz[iL] - up.tz[iU] * low.tx[iL]));    // 1 = they meet square, less = at a slant
    const opening = Math.ceil((low.barrier[iL] + 3 + CORNER) / square / ROAD.step);
    walk(upper, iU - opening, 1, opening * 2, (i) => {
      if (sides.has(1)) up.railR[i] = 3;          // 3 = the mouth of a joining road: its ground, not ours
      if (sides.has(-1)) up.railL[i] = 3;
      if (up.wall[i]) up.wall[i] = 2;
    });
    // 6. Remember it.
    const junction = { x: up.x[iU], z: up.z[iU], arms: [{ way: upper, s: iU * ROAD.step, dir: 1 }, { way: upper, s: iU * ROAD.step, dir: -1 },
      ...dirs.map((dir) => ({ way: lower, s: iL * ROAD.step, dir }))] };
    junctions.push(junction);
    upper.junctions.push({ s: iU * ROAD.step, junction });
    lower.junctions.push({ s: iL * ROAD.step, junction });
  }

  // An end of one way lying on another way.
  for (const way of ways) {
    if (way.road.closed) continue;
    for (const end of [0, way.road.count - 1]) {
      let best = null;
      for (const other of ways) {
        const index = other === way ? -1 : other.sampleNearby(way.road.x[end], way.road.z[end]);
        if (index < 0) continue;
        const away = Math.hypot(way.road.x[end] - other.road.x[index], way.road.z[end] - other.road.z[index]);
        if (away < other.road.half[index] + 4 && (!best || away < best.away)) best = { other, index, away };
      }
      if (!best) continue;
      meet(best.other, best.index, way, end, [end === 0 ? 1 : -1]);
      if (end === 0) way.road.joinedStart = true; else way.road.joinedEnd = true;
    }
  }
  // Two ways crossing: walking along the later one, the earlier one's centre line changes sides.
  ways.forEach((lower, number) => ways.slice(0, number).forEach((upper) => {
    const low = lower.road, up = upper.road, margin = low.closed ? 0 : 4;
    let before = null;                           // which side of the upper way the previous sample was on
    for (let i = margin; i < low.count - margin; i++) {
      const j = upper.sampleNearby(low.x[i], low.z[i]);
      const nearItsEnd = !up.closed && (j < 4 || j > up.count - 5);
      const side = j < 0 || nearItsEnd ? null : Math.sign(-(low.x[i] - up.x[j]) * up.tz[j] + (low.z[i] - up.z[j]) * up.tx[j]);
      const alreadyJoined = lower.junctions.some((at) => Math.abs(at.s - i * ROAD.step) < 60);
      if (side !== null && before !== null && side !== before && !alreadyJoined) meet(upper, j, lower, i, [1, -1]);
      before = side;
    }
  }));
  return junctions;
}

// Give a junction traffic lights: one signal on each road through it (joined to that road's own
// list, way.signals, where the AI drivers and world/signals.js find it). Besides the usual fields
// a junction's signal has:
//   junction, group   0 = on the junction's main road, 1 = on a road that joins or crosses it:
//                     the two groups get green in turn
//   line              metres before the middle of the junction where its stop line is
//   dirs              the directions of travel it faces (a road that ends here is only driven up to it one way)
function lightJunction(junction) {
  junction.lights = true;
  const main = junction.arms[0].way;
  for (const way of new Set(junction.arms.map((arm) => arm.way))) {
    const mine = junction.arms.filter((arm) => arm.way === way), others = junction.arms.filter((arm) => arm.way !== way);
    const line = Math.max(...others.map((arm) => arm.way.at(arm.way.road.barrier, arm.s))) + 6;        // clear of the widest road it crosses
    way.signals.push({ index: way.indexAt(mine[0].s), s: mine[0].s, state: 'red', junction, group: way === main ? 0 : 1, line, dirs: mine.map((arm) => -arm.dir) });
  }
}

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
