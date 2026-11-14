// ---------------------------------------------------------------------------
// carShell.js — the bodywork of a generated car (a car without a model.glb).
//
// The body is a smooth skin stretched over many "rings", like the ribs of a
// boat. car.json only lists a handful of stations (the side profile); here we
// put a ring every few centimetres along the car, then shape every ring:
//
//        14 ── 13 ─── 12 ─ 11        roof          (points are numbered from the
//                            \                      middle of the floor, out and
//                            10   top of the glass   up to the middle of the roof;
//                             9   bottom of it       the left side is a mirror copy)
//                 shoulder  8 7
//                            6
//                            5    door (widest point)
//                            4
//        0 ──── 1 ──── 2 ── 3     floor and sill
//
// Where there is no cabin (bonnet, boot) points 9–14 flatten into the deck.
// Around each wheel the lower points are lifted into a round wheel arch.
// Which part is paint, glass or black trim is decided per patch of skin.
//
// makeShell() returns the skin twice: as a mesh shape, and as a `surface` you
// can ask "where is the skin here?" — that is how lamps, door lines and mirrors
// are put exactly ON it (carLamps.js, carDetails.js).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/mathUtils.js';

export const ACROSS = 15;             // points on half a ring (see the drawing)
const PER_RING = ACROSS * 2 - 2;      // both halves; the two middle points are shared
export const MATERIALS = { paint: 0, glass: 1, trim: 2, lower: 3 };   // order of the materials on the shell mesh
// Places round a ring, for surface.at(t, u): the `u` of the drawing above, by name.
export const U = { sill: 3.35, waist: 5, shoulder: 8, glassLow: 9, glassHigh: 10, roofEdge: 11, deckEdge: 10.3, centre: 14 };

/**
 * @param spec  the car (car.json)
 * @param dims  { a, b, frontZ, rearZ, halfW } worked out by carBuilder.js
 * @returns {{ geometry, surface }}
 *   geometry  THREE.BufferGeometry with four material groups (MATERIALS) and vertex colours
 *             (darker underneath and inside the wheel arches, so the car sits in its own shade)
 *   surface   see makeSurface() below
 */
export function makeShell(spec, dims) {
  const rings = makeRings(spec, dims);
  for (const ring of rings) ring.half = ringPoints(ring, spec);
  return { geometry: shellGeometry(rings), surface: makeSurface(rings, spec, dims) };
}

function shellGeometry(rings) {
  const positions = [], colors = [];
  for (const ring of rings) {
    const shade = (j) => (ring.arch > 0 && j <= 3 ? 0.12 : j <= 2 ? 0.3 : j === 3 ? 0.6 : 1);
    ring.half.forEach(([x, y], j) => { positions.push(x, y, ring.z); colors.push(shade(j), shade(j), shade(j)); });
    for (let j = 1; j < ACROSS - 1; j++) { positions.push(-ring.half[j][0], ring.half[j][1], ring.z); colors.push(shade(j), shade(j), shade(j)); }
  }
  // Vertex number of point j on ring i; side +1 = right half, -1 = left half.
  const vertex = (i, j, side) => i * PER_RING + (side > 0 || j === 0 || j === ACROSS - 1 ? j : ACROSS - 1 + j);

  const lists = [[], [], [], []];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < ACROSS - 1; j++) {
      const list = lists[patchMaterial(rings[i], rings[i + 1], j)];
      for (const side of [1, -1]) {
        const A = vertex(i, j, side), B = vertex(i, j + 1, side), C = vertex(i + 1, j, side), D = vertex(i + 1, j + 1, side);
        if (side > 0) list.push(A, B, C, B, D, C); else list.push(A, C, B, B, C, D);
      }
    }
  }
  // Close the nose and the tail: join each point to its mirror image.
  for (const [i, facesBack] of [[0, false], [rings.length - 1, true]]) {
    for (let j = 0; j < ACROSS - 1; j++) {
      const A = vertex(i, j, 1), B = vertex(i, j + 1, 1), C = vertex(i, j, -1), D = vertex(i, j + 1, -1);
      const list = lists[j < 3 ? MATERIALS.trim : j <= 4 ? MATERIALS.lower : MATERIALS.paint];
      if (facesBack) list.push(A, B, C, B, D, C); else list.push(A, C, B, B, C, D);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const all = [];
  lists.forEach((list, material) => { geometry.addGroup(all.length, list.length, material); all.push(...list); });
  geometry.setIndex(all);
  geometry.computeVertexNormals();
  smoothNormals(rings, geometry, vertex);
  return geometry;
}

// Which way the skin faces at every point, for shading. The usual recipe (computeVertexNormals)
// leaves faint stripes in the paint where rings crowd together, as they do round the wheel
// arches. So here each point looks at its four neighbours - the next ring each way, the next
// point round the ring each way - and allows for how far away each one is.
function smoothNormals(rings, geometry, vertex) {
  const normal = geometry.attributes.normal;
  const at = (i, j) => new THREE.Vector3(rings[i].half[j][0], rings[i].half[j][1], rings[i].z);
  // The direction of a line through `here`, given the points before and after it on that line.
  const direction = (before, here, after) => {
    const a = here.clone().sub(before), b = after.clone().sub(here), la = a.length(), lb = b.length();
    if (la < 1e-6) return b.normalize();
    if (lb < 1e-6) return a.normalize();
    return a.multiplyScalar(lb / la).add(b.multiplyScalar(la / lb)).normalize();     // the nearer neighbour counts for more
  };
  const mirrored = (point) => { point.x = -point.x; return point; };
  for (let i = 1; i < rings.length - 1; i++) {                 // (the two end rings keep theirs: they also carry the flat ends)
    const byArch = rings[i - 1].arch > 0 || rings[i].arch > 0 || rings[i + 1].arch > 0;
    for (let j = byArch ? 5 : 0; j < ACROSS; j++) {            // (the sharp lip of a wheel arch keeps the usual recipe too)
      const here = at(i, j);
      const along = direction(at(i - 1, j), here, at(i + 1, j));
      const round = direction(j > 0 ? at(i, j - 1) : mirrored(at(i, 1)), here, j < ACROSS - 1 ? at(i, j + 1) : mirrored(at(i, ACROSS - 2)));
      const n = round.cross(along);
      if (n.length() < 1e-6) continue;
      n.normalize();
      normal.setXYZ(vertex(i, j, 1), n.x, n.y, n.z);
      normal.setXYZ(vertex(i, j, -1), -n.x, n.y, n.z);
    }
  }
}

/**
 * The skin as something you can measure. Two ways to say where:
 *
 *   surface.at(t, u, side, lift)       anywhere on the body
 *       t = 0 at the nose ... 1 at the tail        u = round the ring (see U at the top)
 *       side = +1 right, -1 left                   lift = metres above the skin
 *
 *   surface.onEnd(tail, s, y)          on the nose (tail = false) or the tail (tail = true),
 *       measured the way you would with a tape on the real car:
 *       s = metres from the centre line, following the body round the corner and along the side
 *       y = metres above the road
 *       (right-hand side of the car; flip x for the left)
 *
 * Also: cabin { from, middle, to }, windows (the side windows, each [{ t, lo, hi }, ...]), tOf(z).
 */
function makeSurface(rings, spec, dims) {
  // A point on the right half of the skin, as a Vector3.
  const raw = (t, u) => {
    let i = 0;
    while (i < rings.length - 2 && t >= rings[i + 1].t) i++;
    const A = rings[i], B = rings[i + 1], f = clamp((t - A.t) / (B.t - A.t), 0, 1);
    const j = Math.min(ACROSS - 2, Math.max(0, Math.floor(u))), g = clamp(u - j, 0, 1);
    const across = (ring) => [lerp(ring.half[j][0], ring.half[j + 1][0], g), lerp(ring.half[j][1], ring.half[j + 1][1], g)];
    const a = across(A), b = across(B);
    return new THREE.Vector3(lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(A.z, B.z, f));
  };
  const outlines = new Map();                                 // outlineAt() answers, kept: parts ask for the same heights again and again
  return {
    cabin: cabinSpan(spec),
    windows: sideWindows(spec),
    tOf: (z) => (z - dims.frontZ) / spec.length,
    at(t, u, side = 1, lift = 0) {
      const point = raw(t, u);
      if (lift) {                                             // push it out along the skin's normal
        const round = raw(t, Math.min(ACROSS - 1, u + 0.1)).sub(raw(t, Math.max(0, u - 0.1)));
        const along = raw(Math.min(1, t + 0.004), u).sub(raw(Math.max(0, t - 0.004), u));
        point.addScaledVector(round.cross(along).normalize(), lift);
      }
      point.x *= side;
      return point;
    },
    onEnd(tail, s, y) {
      const key = (tail ? 'T' : 'N') + Math.round(y * 1e4);
      if (!outlines.has(key)) outlines.set(key, outlineAt(rings, tail, y));
      const line = outlines.get(key);
      if (!line.length) return new THREE.Vector3(0, y, tail ? dims.rearZ : dims.frontZ);
      let k = 1;
      while (k < line.length - 1 && line[k].s < s) k++;
      const A = line[k - 1] || line[0], B = line[k] || line[0], f = B.s > A.s ? clamp((s - A.s) / (B.s - A.s), 0, 1) : 0;
      return new THREE.Vector3(lerp(A.x, B.x, f), y, lerp(A.z, B.z, f));
    },
  };
}

// The body cut level at height y and seen from above: a line that starts on the centre line
// at the nose (or tail), runs out to the corner and back along the side as far as the wheel
// arch. Each point is { x, z, s } with s = metres travelled along the line so far.
//
// It is traced over the skin's own mesh, one square at a time (rings one way, the numbered
// points the other): the line comes into a square through one edge and leaves through another,
// which is the edge whose two ends are on different sides of height y.
function outlineAt(rings, tail, y) {
  // The rings of this end, from the end inward: as far as the middle, or a wheel arch this tall.
  const own = [];
  for (let n = 0; n < rings.length; n++) {
    const ring = rings[tail ? rings.length - 1 - n : n];
    if ((tail ? 1 - ring.t : ring.t) > 0.5 || ring.arch > y) break;
    own.push(ring);
  }
  if (own.length < 2) return [];
  const above = (n, j) => own[n].half[j][1] >= y;
  // Where the edge from point (n, j) to point (m, k) passes through height y.
  const cut = (n, j, m, k) => {
    const a = own[n].half[j], b = own[m].half[k], f = (y - a[1]) / (b[1] - a[1]);
    return { x: lerp(a[0], b[0], f), z: lerp(own[n].z, own[m].z, f) };
  };
  // An edge is named by its two ends [n, j, m, k]. The four edges of the square (n, j):
  const edgesOf = (n, j) => [[n, j, n, j + 1], [n + 1, j, n + 1, j + 1], [n, j, n + 1, j], [n, j + 1, n + 1, j + 1]];
  const crossed = ([n, j, m, k]) => above(n, j) !== above(m, k);
  const same = (e, f) => e.every((value, i) => value === f[i]);

  // Start on the centre line: on the flat end of the body if that reaches this height,
  // otherwise where the middle of the bonnet (or boot) climbs through it.
  const top = ACROSS - 1, line = [];
  let edge, square;                                           // the edge just crossed, and the square [n, j] entered through it
  if (above(0, top)) {
    const j = [...Array(top).keys()].find((k) => k >= 3 && crossed([0, k, 0, k + 1]));
    if (j === undefined) return [];
    line.push({ x: 0, z: own[0].z });
    edge = [0, j, 0, j + 1]; square = [0, j];
  } else {
    const n = own.findIndex((ring, k) => k < own.length - 1 && crossed([k, top, k + 1, top]));
    if (n < 0) return [];
    edge = [n, top, n + 1, top]; square = [n, top - 1];
  }
  line.push(cut(...edge));
  for (let steps = 0; steps < 2000; steps++) {
    const [n, j] = square;
    if (n < 0 || n > own.length - 2 || j < 3 || j > top - 1) break;     // off the end of this part of the body
    const out = edgesOf(n, j).find((e) => !same(e, edge) && crossed(e));
    if (!out) break;
    line.push(cut(...out));
    // The square on the other side of that edge.
    square = out[1] === out[3] ? [n, out[1] === j ? j - 1 : j + 1] : [out[0] === n ? n - 1 : n + 1, j];
    edge = out;
  }
  line.forEach((point, k) => { point.s = k ? line[k - 1].s + Math.hypot(point.x - line[k - 1].x, point.z - line[k - 1].z) : 0; });
  return line;
}

// ---- 1. Where the rings are and how big each one is ---------------------------------
function makeRings(spec, dims) {
  const st = spec.stations, length = spec.length;
  const archRadius = spec.wheelRadius + (spec.archGap ?? 0.06);
  const zToT = (z) => (z - dims.frontZ) / length;
  const windows = sideWindows(spec);

  // Ring positions as fractions of the length (0 = nose, 1 = tail). One at every station; then
  // every 3 cm where the body curves most - near both ends and round the wheels, where glossy
  // paint would otherwise show each ring as a stripe in its reflections - and every 8 cm elsewhere.
  const stops = st.map((s) => s[0]);
  const curvy = (z) => Math.min(z - dims.frontZ, dims.rearZ - z) < 0.36 || Math.abs(z + dims.a) < archRadius + 0.3 || Math.abs(z - dims.b) < archRadius + 0.3;
  for (let z = dims.frontZ; z < dims.rearZ; z += curvy(z) ? 0.03 : 0.08) stops.push(zToT(z));
  for (const axle of [-dims.a, dims.b]) {
    // The two ends of each wheel arch are steep: a few extra rings there keep the opening round.
    for (const k of [0, 1, 2, 3]) { const reach = archRadius * Math.cos((k / 14) * Math.PI); stops.push(zToT(axle - reach), zToT(axle + reach)); }
    stops.push(zToT(axle - archRadius - 0.012), zToT(axle + archRadius + 0.012));
  }
  // The corners of the side windows need a ring exactly there. They are kept, and any
  // ordinary ring that sits almost on top of one is dropped.
  const edges = windows.flat().map((row) => row.t);
  const tooClose = 0.0035;
  const all = [...stops.filter((t) => t >= 0 && t <= 1 && edges.every((edge) => Math.abs(t - edge) > tooClose)), ...edges].sort((p, q) => p - q);
  const ts = [];
  for (const t of all) {
    const gap = ts.length ? t - ts[ts.length - 1] : 1;
    if (gap > tooClose || (gap > 0.0005 && edges.includes(t))) ts.push(t);
    else if (t === 1) ts[ts.length - 1] = 1;                   // the last ring is always the very tail
  }

  const roofHeight = Math.max(...st.map((s) => s[2]));
  const [flareFront, flareRear] = spec.flares ?? [0.012, 0.012];
  const [liftFront, liftRear] = spec.endLift ?? [0.07, 0.07];
  const rings = ts.map((t) => {
    let i = 0;
    while (i < st.length - 2 && t >= st[i + 1][0]) i++;
    const fromEnd = Math.min(t, 1 - t) * length;
    // Real cars have no kinks: every measure is the station profile rounded off over a few
    // centimetres (less and less toward the very ends, so the nose and tail stay as drawn).
    const soft = (value, reach) => softProfile(st, value, t, Math.min(reach, fromEnd) / length);
    const ring = {
      t, z: dims.frontZ + t * length,
      span: st[i][4] || '',                                      // 'ws' windscreen, 'cab' side windows, 'rw' rear window
      belt: soft((s) => s[1], 0.07),                             // height of the shoulder line
      top: soft((s) => Math.max(s[1], s[2]), 0.05),              // height of the roof (= belt where there is no cabin)
      w: dims.halfW * soft((s) => s[3], 0.08),                   // half width
    };
    ring.top = Math.max(ring.top, ring.belt);
    ring.cabin = smoothstep(0, 0.14, ring.top - ring.belt);      // 0 = flat deck, 1 = full cabin
    ring.roofHeight = roofHeight;                                // the tallest the roof gets anywhere on this car
    // Corners of the car seen from above are round, and the underside sweeps up at both ends.
    ring.w *= 1 - 0.07 * (1 - Math.sqrt(clamp(1 - (1 - fromEnd / 0.22) ** 2, 0, 1))) * (fromEnd < 0.22 ? 1 : 0);
    ring.edgeRoll = lerp((spec.edgeRoll ?? [0.3, 0.3])[t < 0.5 ? 0 : 1], 1, smoothstep(0.04, 0.45, fromEnd));   // ("edgeRoll": [nose, tail], 1 = a soft round shoulder right to the end)
    ring.bottom = spec.clearance + (t < 0.5 ? liftFront : liftRear) * smoothstep(0.3, 0, fromEnd);
    // Wheel arch: its height above this ring (0 = no arch here), and how far the wing swells out round it.
    // Where a low bonnet leaves no room for the wheel, the wing rises over it in a hump (as on
    // real sports cars); under a cabin the arch is kept below the shoulder instead.
    ring.arch = 0; ring.flare = 0; ring.hump = 0;
    for (const [axle, flare] of [[-dims.a, flareFront], [dims.b, flareRear]]) {
      const dz = Math.abs(ring.z - axle);
      if (dz <= archRadius) {
        const round = spec.wheelRadius + Math.sqrt(archRadius * archRadius - dz * dz);
        ring.arch = lerp(round, -softMax(-round, 0.08 - ring.belt), ring.cabin);
        ring.hump = softMax(0, ring.arch + 0.08 - ring.belt);
      }
      ring.flare = Math.max(ring.flare, flare * smoothstep(archRadius + 0.24, archRadius * 0.7, dz));
    }
    // Side window here? Only where the cabin is tall enough to hold one.
    ring.window = ring.top - ring.belt > 0.07 ? windows.findIndex((rows) => t >= rows[0].t - 1e-6 && t <= rows[rows.length - 1].t + 1e-6) : -1;
    ring.glass = ring.window >= 0 ? windowAt(windows[ring.window], t) : besideWindows(windows, t);
    return ring;
  });
  return rings;
}

// The larger of two heights, with the corner where one takes over from the other rounded off
// (a sharp corner there would show as a crease in the bodywork).
const softMax = (a, b) => (a + b + Math.sqrt((a - b) ** 2 + 0.03 ** 2)) / 2;

// A station measure at position t (straight lines between the stations)...
function profile(st, value, t) {
  let i = 0;
  while (i < st.length - 2 && t >= st[i + 1][0]) i++;
  return lerp(value(st[i]), value(st[i + 1]), clamp((t - st[i][0]) / (st[i + 1][0] - st[i][0]), 0, 1));
}
// ...and the same with its corners rounded: the average over `reach` either side of t.
function softProfile(st, value, t, reach) {
  let sum = 0;
  for (const [step, weight] of [[-1, 1], [-0.5, 2], [0, 3], [0.5, 2], [1, 1]]) sum += weight * profile(st, value, clamp(t + step * reach, 0, 1));
  return sum / 9;
}

// Which part of the length has side windows: { from, to, middle } as fractions, or null.
function cabinSpan(spec) {
  const st = spec.stations;
  const first = st.findIndex((s) => s[4] === 'cab');
  if (first < 0) return null;
  let last = first;
  while (last < st.length - 1 && st[last][4] === 'cab') last++;
  return { from: st[first][0], to: st[last][0], middle: lerp(st[first][0], st[last][0], 0.46) };
}

// The side windows. car.json may list them ("windows": each window is rows of [t, lo, hi],
// lo and hi = 0 at the shoulder ... 1 at the edge of the roof; leave them out for 0 and 1).
// Without that list: one window per door, split by a B-pillar, plus a pillar behind the rear
// door of four-door cars. Beside the sloping windscreen and rear window the roof comes down
// to the shoulder, which gives the pointed front and rear corners of real side windows.
function sideWindows(spec) {
  if (spec.windows) return spec.windows.map((rows) => rows.map(([t, lo = 0, hi = 1]) => ({ t, lo, hi })));
  const cab = cabinSpan(spec), st = spec.stations;
  if (!cab) return [];
  const pillar = 0.03 / spec.length;
  const front = st.find((s) => s[4] === 'ws')[0], rearWindow = st.findIndex((s) => s[4] === 'rw');
  const back = rearWindow >= 0 ? st[rearWindow + 1][0] : cab.to;
  const cuts = [front, cab.middle - pillar, cab.middle + pillar];
  if (spec.doors === 4 && back > cab.to) cuts.push(cab.to - 2 * pillar, cab.to);
  cuts.push(back);
  const windows = [];
  for (let k = 0; k < cuts.length; k += 2) windows.push([{ t: cuts[k], lo: 0, hi: 1 }, { t: cuts[k + 1], lo: 0, hi: 1 }]);
  return windows;
}
// Where the glass would be at a ring that has none: carried on from the end of the window
// before it to the start of the one after it, so the points of the skin do not jump there.
function besideWindows(windows, t) {
  const before = windows.map((rows) => rows[rows.length - 1]).filter((row) => row.t <= t).pop();
  const after = windows.map((rows) => rows[0]).find((row) => row.t >= t);
  if (!before || !after) return before || after || { lo: 0, hi: 1 };
  const f = clamp((t - before.t) / (after.t - before.t || 1), 0, 1);
  return { lo: lerp(before.lo, after.lo, f), hi: lerp(before.hi, after.hi, f) };
}
function windowAt(rows, t) {
  let k = 0;
  while (k < rows.length - 2 && t >= rows[k + 1].t) k++;
  const f = clamp((t - rows[k].t) / (rows[k + 1].t - rows[k].t), 0, 1);
  return { lo: lerp(rows[k].lo, rows[k + 1].lo, f), hi: lerp(rows[k].hi, rows[k + 1].hi, f) };
}

// ---- 2. The shape of one ring (right half) ------------------------------------------
function ringPoints(ring, spec) {
  const { w, bottom, belt, top, cabin, arch, flare } = ring;
  // Top of a flat deck (bonnet / boot): gently crowned.
  // (its edge rolls over into the side; less and less toward the nose and tail, where it is the crisp top edge of the lamps' panel)
  const roll = ring.edgeRoll;
  // Its points sit where the cabin's points are (same distance out, the outer ones at shoulder
  // height), so that the skin does not shift or ripple where the cabin grows out of the deck.
  const deck = [[0.992, belt - 0.10 * roll], [0.975, belt - 0.045 * roll], [0.95, belt - 0.022 * roll], [0.94, belt - 0.018 * roll], [0.93, belt - 0.015 * roll],
    [0.915, top - 0.011], [0.85, top - 0.005], [0.46, top + 0.010], [0, top + 0.016]];
  // Top of the cabin: shoulder, the side glass leaning in, rounded roof edge, roof.
  const rise = top - belt;                                       // how tall the cabin is here (small beside the base of the windscreen)
  // The side glass is one flat sheet from the shoulder up to the edge of the roof, leaning in
  // ("tumble"). Where the roof is lower - beside the windscreen and the rear window - its edge
  // stays on that same sheet, so a side window never twists toward the sky at its pointed ends.
  const edgeY = top - 0.06 * Math.tanh(rise * 7), fullEdgeY = ring.roofHeight - 0.06;
  const lean = lerp(0.945, spec.tumble, fullEdgeY > belt ? clamp((edgeY - belt) / (fullEdgeY - belt), 0, 1) : 0);
  const shoulder = [0.945, belt], roofEdge = [lean, edgeY];
  const run = Math.hypot((roofEdge[0] - shoulder[0]) * w, roofEdge[1] - shoulder[1]);     // metres from shoulder to roof edge
  const onGlass = (share) => {                                   // a point that far up it, leaving room for the rubbers
    if (run < 1e-4) return shoulder;
    const below = Math.min(0.012, run * 0.2), above = Math.min(0.022, run * 0.3), f = (below + share * (run - below - above)) / run;
    return [lerp(shoulder[0], roofEdge[0], f), lerp(shoulder[1], roofEdge[1], f)];
  };
  const cabinTop = [[0.992, belt - 0.10], [0.975, belt - 0.035], shoulder, onGlass(ring.glass.lo), onGlass(ring.glass.hi),
    roofEdge, [lean * 0.93, top - 0.02 * Math.tanh(rise * 7)], [lean * 0.5, top - 0.004], [0, top]];
  const upper = deck.map((p, k) => [lerp(p[0], cabinTop[k][0], cabin) * w, lerp(p[1], cabinTop[k][1], cabin)]);
  if (ring.hump) [1, 1, 1, 0.95, 0.85, 0.5, 0.12].forEach((share, k) => { upper[k][1] += ring.hump * share; });   // the wing humps up over the wheel

  const tuck = spec.tuck ?? 0.03;                                // how far the sill sits inside the widest point
  const lower = [[0, bottom + 0.04], [0.5 * w, bottom + 0.03], [0.86 * w, bottom + 0.01], [(1 - tuck) * w, bottom + 0.05],
    [(1 - tuck * 0.3) * w, bottom + 0.16], [w, clamp(spec.waist ?? lerp(bottom, belt, 0.55), bottom + 0.2, belt - 0.12)]];   // ("waist": height of the widest point; two-tone cars change colour there)
  if (flare) { lower[3][0] += flare * 0.7; lower[4][0] += flare; lower[5][0] += flare * 0.9; upper[0][0] += flare * 0.45; upper[1][0] += flare * 0.15; }
  if (arch > 0) {
    // Wheel arch: the sill is lifted over the wheel, and the side above it is squeezed into the
    // room that is left under the shoulder (evenly, so the wing keeps one smooth shape).
    const edge = lower[4][0];
    lower[1] = [0.45 * w, arch]; lower[2] = [0.86 * w, arch]; lower[3] = [edge - 0.04, arch]; lower[4] = [edge, arch];
    // (the tighter the squeeze, the more the wing becomes one straight sweep from the arch to the shoulder)
    const [shoulderX, shoulderY] = upper[2], was = lower[5][1], now = softMax(was, arch + 0.025), squeeze = (shoulderY - now) / (shoulderY - was);
    for (const point of [lower[5], upper[0], upper[1]]) {
      point[1] = shoulderY - (shoulderY - point[1]) * squeeze;
      point[0] = lerp(lerp(edge, shoulderX, (point[1] - arch) / (shoulderY - arch)), point[0], squeeze);
    }
  }
  return [...lower, ...upper];
}

// ---- 3. What each patch of skin is made of ------------------------------------------
// j = the patch between point j and point j + 1, from this ring to the next one.
function patchMaterial(ring, next, j) {
  if (j <= 2 || (ring.arch > 0 && j <= 3)) return MATERIALS.trim;           // underside, inside of the wheel arch
  if (j <= 4) return MATERIALS.lower;                                       // sill and lower door (two-tone cars)
  if (j === 9) return ring.window >= 0 && ring.window === next.window ? MATERIALS.glass : MATERIALS.paint;   // side windows
  // Windscreen and rear window. The strip of paint left along the edge of the roof is the
  // A-pillar (front) and C-pillar (rear).
  if (j >= 12) return (ring.span === 'ws' || ring.span === 'rw') && ring.top - ring.belt > 0.055 ? MATERIALS.glass : MATERIALS.paint;
  return MATERIALS.paint;
}
