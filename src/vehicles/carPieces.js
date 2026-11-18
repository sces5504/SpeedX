// ---------------------------------------------------------------------------
// carPieces.js — real 3D pieces fixed onto a generated car's body, for the
// features that make a car special and look cheap painted on: a raised grille
// surround, a lamp unit with round projectors under a clear cover, a side scoop
// with a lip round it.
//
// They are listed in car.json beside the flat parts, in "nose", "tail" or "side",
// with "piece" saying which kind. So a body kit (kit.json, carLook.js) can swap
// them through their "slot" exactly like any other part.
//
//   { "piece": "frame", "is": "mesh", "rows": [...], "rim": "chrome", "r": 0.016, "out": 0.03 }
//       A rim (a round bar of finish "rim", radius "r") all round the outline, standing
//       "out" metres proud of the body, with the inside filled with finish "is". On the nose
//       or tail the fill comes out to meet the rim (a grille standing out of the nose); on
//       the side it stays on the skin, so it looks set in behind the lip (an air scoop).
//       "inset": metres the filling stays inside the rim, so its edge hides behind the bar.
//   { "piece": "lamp", "is": "head", "rows": [...], "units": [[s, y, r], ...], "cover": 0.012 }
//       A lamp unit: a dark housing the shape of the outline, round lamps in it ("units",
//       each [s, y, radius] or [s, y, radius, "signal"] for another switch, and a 5th number =
//       metres further out, for a small lamp set in the middle of a bigger one), and a clear
//       glass cover raised "cover" metres over it. Optional "rim" + "r" as above.
//
// The outline is written the same way as the flat parts: on the nose / tail "rows" of
// [s, bottom, top] (or "box" / "circle"), on the side "rows" of [t, low, high].
// Everything of one finish is merged into one mesh, and the bars are kept low in
// segments, so a car with pieces costs only a few more draw calls.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp } from '../core/mathUtils.js';
import { carReflection } from '../render/reflections.js';
import { FINISHES, LAMP_COLOURS, flat, patch, rowsOf, sidePatch } from './carEnds.js';
import { lensMaterial } from './carDetails.js';
import { U, smoothProfile } from './carShell.js';

export const isPiece = (part) => Boolean(part?.piece);

// The flat parts' finishes are drawn without depth (they lie on the skin); a piece with
// real thickness needs the solid version of the same finish.
const solids = new Map();
const solid = (material) => {
  if (!solids.has(material)) solids.set(material, Object.assign(material.clone(), { polygonOffset: false, depthWrite: true }));
  return solids.get(material);
};
// A lamp's reflector bowls are seen from inside, so they are drawn on both faces.
const bowlChrome = Object.assign(FINISHES.chrome.clone(), { polygonOffset: false, depthWrite: true, side: THREE.DoubleSide });
// (kept faint: a strong reflection on the cover's small facets shows as bright streaks)
const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, roughness: 0.2, metalness: 0, envMap: carReflection, envMapIntensity: 0.25, depthWrite: false });
const HOUSING = 0.004;      // metres a lamp's housing stands off the skin, so the curved skin never shows through it

/**
 * @param surface  the skin (carShell.js)    @param lists { nose, tail, side }: the pieces only
 * @param extra    finishes of this car's own: { paint, paint2 }
 * @returns {{ meshes: THREE.Mesh[], lamps: { head, tail, brake, reverse, signalL, signalR } }}
 */
export function buildPieces(surface, lists, extra = {}) {
  const piles = new Map();                                     // finish or lamp switch -> { material, shapes }
  const pile = (name, material, geometry) => {
    if (!piles.has(name)) piles.set(name, { material, shapes: [] });
    piles.get(name).shapes.push(geometry);
  };
  const finish = (name) => FINISHES[name] || extra[name];
  for (const on of ['nose', 'tail', 'side']) {
    for (const part of lists[on] || []) {
      // Shaped body panels (side list only): a scoop on the centre line, a blade on each side.
      if (on === 'side' && part.piece === 'scoop') {
        const [hood, mouth] = scoopShape(surface, part.rows);
        pile('scoop:' + (part.is || 'paint'), solid(finish(part.is || 'paint')), hood);      // (own piles: these sheets carry no uv, unlike the flat fills)
        pile('scoopMouth', solid(FINISHES.black), mouth);
        continue;
      }
      if (on === 'side' && part.piece === 'blade') {
        for (const side of [1, -1]) pile('blade:' + (part.is || 'paint'), solid(finish(part.is || 'paint')), bladeShape(surface, part.rows, side));
        continue;
      }
      const rows = on === 'side' ? part.rows : rowsOf(part);
      const smooth = smoothRows(rows, on === 'side' ? 0.004 : 0.01);      // (the filling follows the same smooth curve as the rim)
      const tail = on === 'tail', joined = on !== 'side' && rows[0][0] <= 0;
      for (const side of joined ? [1] : [1, -1]) {
        const place = placer(surface, on, side);
        const loop = outline(rows, joined);
        if (part.rim && finish(part.rim)) {
          const r = part.r ?? 0.014;
          pile('rim:' + part.rim, solid(finish(part.rim)), bar(loop.map(([a, b]) => place(a, b, part.out ?? r)), r));
        }
        if (part.piece === 'frame') {
          const out = part.out ?? part.r ?? 0.014, raise = part.raise ?? Math.max(0, out - (part.r ?? 0.014));
          for (const half of joined ? [1, -1] : [side]) {
            // ("inset": metres the filling stays inside the rim all round, so its edge hides behind the bar)
            const inner = part.inset ? smooth.map(([a, lo, hi], k) => [k === smooth.length - 1 ? a - part.inset : a, lo + part.inset, hi - part.inset]) : smooth;
            const fill = on === 'side' ? sidePatch(surface, inner, half) : patch(surface, tail, inner, null, half, raise);
            pile('fill:' + part.is, raise ? solid(finish(part.is)) : finish(part.is), fill);
          }
        } else if (part.piece === 'lamp') {
          for (const half of joined ? [1, -1] : [side]) {
            const housing = on === 'side' ? sidePatch(surface, smooth, half) : patch(surface, tail, smooth, null, half, HOUSING, true)[0];
            pile('housing:' + (part.housing || 'smoked'), on === 'side' ? finish(part.housing || 'smoked') : solid(finish(part.housing || 'smoked')), housing);
            if (on !== 'side') {
              // The clear cover, and a thin dark edge round it down to the body (as a real lamp's seam).
              const [cover, edge] = patch(surface, tail, smooth, null, half, Math.max(part.cover ?? 0.012, HOUSING + 0.014), true);
              pile('cover', glass, cover);
              pile('edge', solid(FINISHES.black), edge);
            }
            const there = placer(surface, on, half);
            for (const [a, b, r, kind = part.is, ahead = 0] of part.units || []) {
              const name = kind === 'signal' ? (half > 0 ? 'signalR' : 'signalL') : kind;
              const [cup, lens] = projector(there, a, b, r, ahead + (on === 'side' ? 0 : HOUSING), kind === 'head');
              pile(kind === 'head' ? 'bowls' : 'rim:chrome', kind === 'head' ? bowlChrome : solid(FINISHES.chrome), cup);
              pile('lens:' + name, kind === 'head' ? lensMaterial(LAMP_COLOURS[kind]) : flat(lensMaterial(LAMP_COLOURS[kind])), lens);   // (a domed lens has real depth)
            }
          }
        }
      }
    }
  }
  const meshes = [], lamps = { head: [], tail: [], brake: [], reverse: [], signalL: [], signalR: [] };
  for (const [name, { material, shapes }] of piles) {
    const mesh = new THREE.Mesh(mergeGeometries(shapes), material);
    mesh.name = 'piece_' + name;
    mesh.renderOrder = name === 'cover' ? 30 : 20;
    meshes.push(mesh);
    const lamp = name.startsWith('lens:') ? name.slice(5) : null;
    if (lamp && lamps[lamp]) lamps[lamp].push(mesh);
  }
  return { meshes, lamps };
}

// place(a, b, out) -> the point on the body at (a, b), pushed out `out` metres along the skin's normal.
//   nose / tail: a = s (metres from the centre line, negative = the left half), b = height
//   side:        a = t along the car, b = 0 sill ... 1 shoulder
function placer(surface, on, side) {
  if (on === 'side') return (t, h, out = 0) => surface.at(clamp(t, 0, 1), lerp(U.sill, U.shoulder, h), side, out);
  const tail = on === 'tail', facing = tail ? 1 : -1;
  const at = (s, y) => { const p = surface.onEnd(tail, Math.abs(s), y); p.x *= (s < 0 ? -1 : 1) * side; return p; };
  return (s, y, out = 0) => {
    const along = at(s + 0.01, y).sub(at(s - 0.01, y)), up = at(s, y + 0.01).sub(at(s, y - 0.01));
    const normal = along.cross(up).normalize();
    if (normal.z * facing < 0 || !Number.isFinite(normal.z)) normal.set(0, 0, facing);
    return at(s, y).addScaledVector(normal, out);
  };
}

// The outline of a part as one closed loop of [a, b]. A part that starts on the centre line
// of the nose is one loop over both halves (its left half has negative s).
function outline(rows, joined) {
  const top = rows.map((r) => [r[0], r[2]]), bottom = rows.map((r) => [r[0], r[1]]).reverse();
  const loop = [...top, ...bottom];
  if (joined) loop.push(...bottom.slice().reverse().map(([s, y]) => [-s, y]), ...top.slice().reverse().map(([s, y]) => [-s, y]));
  // (the same point twice in a row - where the two halves meet on the centre line - would pinch the curve)
  for (let k = loop.length - 1; k >= 0; k--) { const n = loop[(k + 1) % loop.length]; if (loop.length > 3 && Math.hypot(loop[k][0] - n[0], loop[k][1] - n[1]) < 1e-4) loop.splice(k, 1); }
  // A smooth curve through the corners, sampled about every centimetre.
  const curve = new THREE.CatmullRomCurve3(loop.map(([a, b]) => new THREE.Vector3(a, b, 0)), true, 'centripetal');
  const count = Math.max(24, Math.round(curve.getLength() / 0.012));
  return curve.getSpacedPoints(count).slice(0, -1).map((p) => [p.x, p.y]);
}

// The rows of an outline, carried on a smooth curve instead of straight pieces between the
// listed rows (every `step`: metres of s on the nose and tail, or t along the side). The curve
// is the same one the body uses (carShell.js smoothProfile): it never swings back on itself, so
// a rounded end made of closely spaced rows cannot fold over.
function smoothRows(rows, step) {
  if (rows.length < 3) return rows;
  const from = rows[0][0], to = rows[rows.length - 1][0];
  const marks = new Set(rows.map((r) => r[0]));
  for (let a = from; a < to; a += step) marks.add(+a.toFixed(6));
  return [...marks].sort((p, q) => p - q).map((a) => [a, smoothProfile(rows, (r) => r[1], a), smoothProfile(rows, (r) => r[2], a)]);
}

// A round bar along a closed loop of points.
function bar(points, r) {
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  return indexed(new THREE.TubeGeometry(curve, Math.ceil(points.length / 2), r, 8, true));      // (a ring every 2 cm, 8 sides round)
}
// (merged meshes must all be indexed or all not; the flat parts are indexed)
const indexed = (geometry) => {
  if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  return geometry;
};

// ---- Shaped body panels -----------------------------------------------------------------
// Both are listed under "side" in car.json (so a body kit can swap them by "slot" like any part).
//
//   { "piece": "blade", "is": "paint", "rows": [[t, low, high, out], ...] }
//       A panel with real thickness along the side, standing `out` metres proud of the skin between
//       the heights `low` and `high` (0 = sill ... 1 = shoulder): a side skirt that can sweep up the
//       side. Its top edge rolls back into the skin in one smooth curve, so the body above it reads as
//       set back - a scalloped door running into an intake. Give the end rows a small `out` so the
//       blade dies away instead of ending in a cut face.
//   { "piece": "scoop", "is": "paint", "rows": [[t, halfWidth, height], ...] }
//       A raised air scoop on the centre line (roof or engine cover) that grows out of the panel:
//       every row is an arch `halfWidth` metres either side of the centre and `height` metres tall,
//       whose feet run into the skin. The first row is the open mouth (dark inside); let the last
//       rows shrink so the scoop melts back into the panel.
// (Flat parts are painted over everything under them, pieces included: keep flat "side" parts
//  out of the area a blade covers, or give the blade its own black lower blade instead.)

// Grid of positions (rows x columns) -> indexed geometry with smooth normals, facing outward
// (`outward(normal, point)` > 0 for the outside).
function sheet(points, columns, outward) {
  const geometry = new THREE.BufferGeometry(), index = [], rowsCount = points.length / columns;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
  for (let i = 0; i < rowsCount - 1; i++) for (let k = 0; k < columns - 1; k++) {
    const a = i * columns + k, b = a + 1, c = a + columns, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const middle = Math.floor(points.length / 2), n = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, middle);
  if (outward(n, points[middle]) < 0) {                       // wound the wrong way round: turn every triangle over
    for (let j = 0; j < index.length; j += 3) [index[j + 1], index[j + 2]] = [index[j + 2], index[j + 1]];
    geometry.setIndex(index);
    geometry.computeVertexNormals();
  }
  return geometry;
}
// t positions every `step` between the first and last row, plus every row itself.
function marksAlong(rows, step) {
  const marks = new Set(rows.map((r) => r[0]));
  for (let t = rows[0][0]; t < rows[rows.length - 1][0]; t += step) marks.add(+t.toFixed(5));
  return [...marks].sort((p, q) => p - q);
}

function bladeShape(surface, rows, side) {
  const place = placer(surface, 'side', side);
  // Across the blade, from its foot to its top: [share of the way from low to high, share of `out`].
  // (straight up the face, then a quarter-round roll back into the skin over the top 15 %)
  const across = [[0, 0], [0.001, 1], [0.3, 1], [0.6, 1], [0.85, 1]];
  for (let k = 1; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; across.push([0.85 + 0.15 * Math.sin(a), Math.cos(a)]); }
  const points = [];
  for (const t of marksAlong(rows, 0.004)) {
    const low = smoothProfile(rows, (r) => r[1], t), high = smoothProfile(rows, (r) => r[2], t), out = smoothProfile(rows, (r) => r[3], t);
    for (const [f, o] of across) points.push(place(t, lerp(low, high, f), out * o + 0.001));
  }
  return sheet(points, across.length, (n) => n.x * side);
}

function scoopShape(surface, rows) {
  // The point on the skin `x` metres off the centre line at t: walk round the ring from the middle.
  const skinAt = (t, x) => {
    let previous = surface.at(t, U.centre);
    for (let u = U.centre - 0.05; u >= U.glassLow; u -= 0.05) {
      const p = surface.at(t, u);
      if (p.x >= x) return previous.clone().lerp(p, clamp((x - previous.x) / (p.x - previous.x || 1), 0, 1));
      previous = p;
    }
    return previous;
  };
  const ROUND = 16, points = [], first = [];
  marksAlong(rows, 0.005).forEach((t, i) => {
    const w = smoothProfile(rows, (r) => r[1], t), h = smoothProfile(rows, (r) => r[2], t);
    for (let k = 0; k <= ROUND; k++) {
      const a = (k / ROUND) * Math.PI, x = -w * Math.cos(a), p = skinAt(t, Math.abs(x));
      p.x = Math.sign(x) * Math.abs(p.x);
      p.y += h * Math.pow(Math.sin(a), 0.7);                   // (the arch's feet meet the skin at a low angle)
      points.push(p);
      if (i === 0) first.push(p.clone());
    }
  });
  const hood = sheet(points, ROUND + 1, (n) => n.y);
  // The mouth: a dark disc just inside the first arch, closed along the skin.
  const back = first.map((p) => p.clone().add(new THREE.Vector3(0, 0, 0.02)));
  const centre = back.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(back.length);
  const mouth = new THREE.BufferGeometry(), position = [centre, ...back].flatMap((p) => [p.x, p.y, p.z]), index = [];
  for (let k = 1; k < back.length; k++) index.push(0, k, k + 1);
  mouth.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  mouth.setIndex(index);
  mouth.computeVertexNormals();
  return [hood, mouth];
}

// One round lamp, facing out of the skin. A headlight: a chrome reflector bowl opening outward
// with a domed glass lens in it (a projector). Other lamps: a short chrome cup and a flat lens.
function projector(place, a, b, r, ahead = 0, bowl = false) {
  const centre = place(a, b, ahead), normal = place(a, b, 0.01).sub(place(a, b, 0)).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  const at = (geometry, out) => geometry.applyQuaternion(turn).translate(centre.x + normal.x * out, centre.y + normal.y * out, centre.z + normal.z * out);
  if (bowl) {
    const deep = Math.min(0.011, r * 0.45);
    const dish = at(new THREE.CylinderGeometry(r, r * 0.42, deep, 20, 1, true), deep / 2 + 0.001);
    const dome = at(new THREE.SphereGeometry(r * 0.48, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), 0.002);
    return [indexed(dish), indexed(dome)];
  }
  const cup = new THREE.CylinderGeometry(r, r * 0.9, 0.016, 18, 1, true)
    .applyQuaternion(turn).translate(centre.x + normal.x * 0.008, centre.y + normal.y * 0.008, centre.z + normal.z * 0.008);
  const lens = new THREE.CircleGeometry(r * 0.8, 18)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal))
    .translate(centre.x + normal.x * 0.006, centre.y + normal.y * 0.006, centre.z + normal.z * 0.006);
  return [indexed(cup), indexed(lens)];
}
