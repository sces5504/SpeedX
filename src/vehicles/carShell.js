// ---------------------------------------------------------------------------
// carShell.js — the bodywork of a generated car (a car without a model.glb).
//
// The body is a smooth skin stretched over many "rings", like the ribs of a
// boat. car.json only lists a handful of stations (the side profile); here we
// fill in a ring every few centimetres between them, then shape every ring:
//
//        13 ── 12 ─── 11 ─ 10        roof          (points are numbered from the
//                            \                      middle of the floor, out and
//                             9   side glass        up to the middle of the roof;
//                             8                     the left side is a mirror copy)
//                 shoulder  7 6
//                            5    door
//                            4
//        0 ──── 1 ──── 2 ── 3     floor and sill
//
// Where there is no cabin (bonnet, boot) points 8–13 flatten into the deck.
// Around each wheel the lower points are lifted into a round wheel arch.
// Which part is paint, glass or black trim is decided per patch of skin.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/mathUtils.js';

const ACROSS = 14;                    // points on half a ring (see the drawing)
const PER_RING = ACROSS * 2 - 2;      // both halves; the two middle points are shared
export const MATERIALS = { paint: 0, glass: 1, trim: 2, lower: 3 };   // order of the materials on the shell mesh

/**
 * @param spec  the car (car.json)
 * @param dims  { a, b, frontZ, rearZ, halfW } worked out by carBuilder.js
 * @returns THREE.BufferGeometry with four material groups (MATERIALS) and vertex colours
 *          (darker underneath and inside the wheel arches, so the car sits in its own shade)
 */
export function shellGeometry(spec, dims) {
  const rings = makeRings(spec, dims);
  const positions = [], colors = [];
  for (const ring of rings) {
    const half = ringPoints(ring, spec);
    const shade = (j) => (ring.arch > 0 && j <= 4 ? 0.12 : j <= 2 ? 0.3 : j === 3 ? 0.6 : 1);
    half.forEach(([x, y], j) => { positions.push(x, y, ring.z); colors.push(shade(j), shade(j), shade(j)); });
    for (let j = 1; j < ACROSS - 1; j++) { positions.push(-half[j][0], half[j][1], ring.z); colors.push(shade(j), shade(j), shade(j)); }
  }
  // Vertex number of point j on ring i; side +1 = right half, -1 = left half.
  const vertex = (i, j, side) => i * PER_RING + (side > 0 || j === 0 || j === ACROSS - 1 ? j : ACROSS - 1 + j);

  const lists = [[], [], [], []];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < ACROSS - 1; j++) {
      const list = lists[patchMaterial(rings[i], j)];
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
      const list = lists[j < 3 ? MATERIALS.trim : MATERIALS.paint];
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
  return geometry;
}

/**
 * The same skin as a function, so details (door lines, handles, mirrors — carDetails.js) can be
 * put exactly ON it.
 * @returns {{ at(t, u, side?, lift?): THREE.Vector3, cabin, glassSpan, tOf(z): number }}
 *   t = 0 at the nose ... 1 at the tail
 *   u = 0..13 round the ring, as in the drawing (3.5 = sill, 5 = door, 7 = shoulder, 9 = top of the side glass)
 *   side = +1 right, -1 left      lift = metres above the skin
 */
export function shellSurface(spec, dims) {
  const rings = makeRings(spec, dims);
  for (const ring of rings) ring.half = ringPoints(ring, spec);
  // A point on the right half of the skin, as [x, y, z].
  const raw = (t, u) => {
    let i = 0;
    while (i < rings.length - 2 && t >= rings[i + 1].t) i++;
    const A = rings[i], B = rings[i + 1], f = clamp((t - A.t) / (B.t - A.t), 0, 1);
    const j = Math.min(ACROSS - 2, Math.max(0, Math.floor(u))), g = clamp(u - j, 0, 1);
    const across = (ring) => [lerp(ring.half[j][0], ring.half[j + 1][0], g), lerp(ring.half[j][1], ring.half[j + 1][1], g)];
    const a = across(A), b = across(B);
    return new THREE.Vector3(lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(A.z, B.z, f));
  };
  return {
    cabin: cabinSpan(spec),                                   // { from, middle, to }: the part under the roof, or null
    glassSpan: (() => { const glazed = rings.filter(sideGlass); return glazed.length ? [glazed[0].t, glazed[glazed.length - 1].t] : null; })(),   // first and last t with side glass
    tOf: (z) => (z - dims.frontZ) / spec.length,
    at(t, u, side = 1, lift = 0) {
      const point = raw(t, u);
      if (lift) {                                             // push it out along the skin's normal
        const round = raw(t, Math.min(13, u + 0.1)).sub(raw(t, Math.max(0, u - 0.1)));
        const along = raw(Math.min(1, t + 0.004), u).sub(raw(Math.max(0, t - 0.004), u));
        point.addScaledVector(round.cross(along).normalize(), lift);
      }
      point.x *= side;
      return point;
    },
  };
}

// ---- 1. Where the rings are and how big each one is ---------------------------------
function makeRings(spec, dims) {
  const st = spec.stations, length = spec.length;
  const archRadius = spec.wheelRadius + 0.06;
  const zToT = (z) => (z - dims.frontZ) / length;

  // Ring positions as fractions of the length (0 = nose, 1 = tail).
  const stops = [];
  for (let i = 0; i < st.length - 1; i++) {
    const pieces = Math.max(2, Math.ceil(((st[i + 1][0] - st[i][0]) * length) / 0.08));
    for (let k = 0; k <= pieces; k++) stops.push(lerp(st[i][0], st[i + 1][0], k / pieces));
  }
  for (const axle of [-dims.a, dims.b]) {                      // a fan of rings so each wheel arch is round
    for (let k = 0; k <= 14; k++) stops.push(zToT(axle - archRadius * Math.cos((k / 14) * Math.PI)));
    stops.push(zToT(axle - archRadius - 0.012), zToT(axle + archRadius + 0.012));
  }
  // Pillars between the side windows need a ring on each of their edges: the B-pillar behind
  // the front door and, on four-door cars, one more behind the rear door.
  const cab = cabinSpan(spec);
  const pillars = cab ? [[cab.middle - 0.03 / length, cab.middle + 0.03 / length]] : [];
  if (cab && spec.doors === 4) pillars.push([cab.to - 0.07 / length, cab.to]);
  // (a pillar is narrower than the gap between two ordinary rings, so its edges are kept and
  // any ordinary ring that sits almost on top of one is dropped)
  const edges = pillars.flat();
  const all = [...stops.filter((t) => edges.every((edge) => Math.abs(t - edge) > 0.0035)), ...edges].sort((p, q) => p - q);
  const ts = all.filter((t, i) => t >= 0 && t <= 1 && (i === 0 || t - all[i - 1] > 0.0035));

  const roofHeight = Math.max(...st.map((s) => s[2]));
  const rings = ts.map((t) => {
    let i = 0;
    while (i < st.length - 2 && t >= st[i + 1][0]) i++;
    const A = st[i], B = st[i + 1], f = clamp((t - A[0]) / (B[0] - A[0] || 1), 0, 1);
    return {
      t, z: dims.frontZ + t * length,
      span: A[4] || '',                                          // 'ws' windscreen, 'cab' side windows, 'rw' rear window
      belt: lerp(A[1], B[1], f),                                 // height of the shoulder line
      top: lerp(Math.max(A[1], A[2]), Math.max(B[1], B[2]), f),  // height of the roof (= belt where there is no cabin)
      w: dims.halfW * lerp(A[3], B[3], f),                       // half width
      pillar: pillars.some(([from, to]) => t >= from - 1e-4 && t < to - 1e-4),
    };
  });
  // Real cars have no kinks: round the profile off a little.
  for (const key of ['belt', 'belt', 'w', 'w', 'top']) {
    const copy = rings.map((ring) => ring[key]);
    for (let i = 1; i < rings.length - 1; i++) rings[i][key] = (copy[i - 1] + 2 * copy[i] + copy[i + 1]) / 4;
  }
  for (const ring of rings) {
    ring.top = Math.max(ring.top, ring.belt);
    ring.cabin = clamp((ring.top - ring.belt) / 0.22, 0, 1);     // 0 = flat deck, 1 = full cabin
    ring.roofShare = roofHeight > 0 ? clamp((ring.top - ring.belt) / (roofHeight - ring.belt), 0, 1) : 0;
    // Corners of the car seen from above are round, and the underside sweeps up at both ends.
    const fromEnd = Math.min(ring.t, 1 - ring.t) * length;
    ring.w *= 1 - 0.07 * (1 - Math.sqrt(clamp(1 - (1 - fromEnd / 0.22) ** 2, 0, 1))) * (fromEnd < 0.22 ? 1 : 0);
    ring.bottom = spec.clearance + 0.07 * smoothstep(0.3, 0, fromEnd);
    // Height of the wheel arch above this ring (0 = no arch here).
    ring.arch = 0;
    for (const axle of [-dims.a, dims.b]) {
      const dz = ring.z - axle;
      if (Math.abs(dz) <= archRadius) ring.arch = Math.min(ring.belt - 0.13, spec.wheelRadius + Math.sqrt(archRadius * archRadius - dz * dz));
    }
  }
  return rings;
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

// ---- 2. The shape of one ring (right half) ------------------------------------------
function ringPoints(ring, spec) {
  const { w, bottom, belt, top, cabin, arch } = ring;
  const lean = lerp(0.84, spec.tumble, ring.roofShare);          // how far the roof edge sits inside the body side
  // Top of a flat deck (bonnet / boot): gently crowned.
  const deck = [[0.992, top - 0.10], [0.975, top - 0.045], [0.95, top - 0.022], [0.91, top - 0.010], [0.84, top - 0.004], [0.66, top + 0.004], [0.36, top + 0.012], [0, top + 0.016]];
  // Top of the cabin: shoulder, glass leaning in, rounded roof edge, roof.
  const cabinTop = [[0.992, belt - 0.10], [0.975, belt - 0.035], [0.945, belt], [lerp(0.945, lean, 0.5), lerp(belt, top, 0.5)],
    [lean, top - 0.06], [lean * 0.93, top - 0.02], [lean * 0.5, top - 0.004], [0, top]];
  const upper = deck.map((p, k) => [lerp(p[0], cabinTop[k][0], cabin) * w, lerp(p[1], cabinTop[k][1], cabin)]);

  const lower = [[0, bottom + 0.04], [0.5 * w, bottom + 0.03], [0.86 * w, bottom + 0.01], [0.97 * w, bottom + 0.05], [w, bottom + 0.16], [w, lerp(bottom, belt, 0.55)]];
  if (arch > 0) {
    // Wheel arch: the sill is lifted over the wheel, and the wing bulges out a touch.
    lower[1] = [0.45 * w, arch]; lower[2] = [0.86 * w, arch]; lower[3] = [0.97 * w, arch]; lower[4] = [1.015 * w, arch];
    lower[5] = [1.012 * w, Math.max(lower[5][1], arch + 0.035)];
    upper[0][1] = Math.max(upper[0][1], lower[5][1] + 0.02);
  }
  return [...lower, ...upper];
}

// Is there side glass at this ring? Beside the roof, yes (except at a pillar). Beside the
// sloping windscreen and rear window the glass carries on as long as the cabin is tall
// enough, which makes the pointed front and rear corners of real side windows; the strip of
// paint left along the edge of the roof is the A-pillar (front) and C-pillar (rear).
function sideGlass(ring) {
  if (ring.pillar) return false;
  if (ring.span === 'cab') return true;
  return (ring.span === 'ws' && ring.cabin > 0.3) || (ring.span === 'rw' && ring.cabin > 0.55);
}

// ---- 3. What each patch of skin is made of ------------------------------------------
// j = the patch between point j and point j + 1 of the ring.
function patchMaterial(ring, j) {
  if (j <= 2 || (ring.arch > 0 && j <= 3)) return MATERIALS.trim;           // underside, inside of the wheel arch
  if (j <= 4) return MATERIALS.lower;                                       // sill and lower door (two-tone cars)
  if (j === 8 || j === 9) return sideGlass(ring) ? MATERIALS.glass : MATERIALS.paint;                    // side windows
  if (j >= 11) return (ring.span === 'ws' || ring.span === 'rw') && ring.cabin > 0.25 ? MATERIALS.glass : MATERIALS.paint;   // windscreen, rear window
  return MATERIALS.paint;
}
