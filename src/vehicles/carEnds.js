// ---------------------------------------------------------------------------
// carEnds.js — what is drawn on the nose and the tail of a car: head and tail
// lamps of any shape, grilles, air intakes, bumper inserts, reflector panels.
//
// car.json lists them as "nose" and "tail". Every part is a flat shape that is
// laid ON the skin (carShell.js), so it follows the body round the corners the
// way a real wrap-around lamp does. A part is measured like on the real car:
//
//     s = metres from the centre line, along the body (round the corner and on down the side)
//     y = metres above the road
//
//     { "is": "tail",   "box": [from, to, bottom, top], "round": 0.02 }     a box from s = from to s = to
//     { "is": "brake",  "circle": [s, y, radius] }                          a round lamp
//     { "is": "grille", "rows": [[s, bottom, top], [s, bottom, top], ...] } any other outline
//
// Only the right half is listed; the left half is its mirror image (a part that
// starts at s = 0 joins up with its mirror image across the middle).
// Later parts in the list lie on top of earlier ones.
//
// "is" can be a lamp (head, tail, brake, signal, reverse: it lights up with that switch) or
// a finish (FINISHES: black, chrome, grey, smoked, red, grille, mesh).
// A car.json without the lists gets a simple set made from its "headlights" and "taillights".
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp } from '../core/mathUtils.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';
import { carReflection } from '../render/reflections.js';
import { LIMIT, lensMaterial } from './carDetails.js';

export const LAMP_COLOURS = { head: 0xfff2d8, tail: 0xff1505, brake: 0xff1505, signal: 0xff8a00, reverse: 0xffffff };

// Parts are paper-thin and lie on the skin, sometimes on top of each other. To keep them from
// flickering against the skin or one another they are drawn after the body, in the order of
// the list, and each simply paints over what is under it (see `flat` and renderOrder below).
const flat = (material) => Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false });
const plastic = (settings) => flat(enhanceMaterial(new THREE.MeshStandardMaterial({ envMap: carReflection, ...settings }), { limit: LIMIT }));
// A grille: black with bright bars. The picture repeats every 4 cm of the real car.
const grilleLook = (draw) => plastic({ color: 0xffffff, roughness: 0.35, metalness: 0.5, map: canvasTexture(32, 32, (g, w, h) => { g.fillStyle = '#050506'; g.fillRect(0, 0, w, h); draw(g, w, h); }) });
const FINISHES = {
  black: plastic({ color: 0x08090a, roughness: 0.6 }),                       // unpainted bumper, intake, plastic trim
  chrome: plastic({ color: 0xc9ccd1, roughness: 0.18, metalness: 1 }),
  grey: plastic({ color: 0x4a4d52, roughness: 0.6 }),                        // grey plastic bumper
  smoked: plastic({ color: 0x0a0b0d, roughness: 0.06, metalness: 0.7 }),     // dark glossy cover (lamp panel, piano black)
  red: flat(enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.15, envMap: carReflection }), { retro: 0.5, limit: 1.5 })),   // reflector: shines back at headlights
  grille: grilleLook((g, w) => { g.fillStyle = '#3d4046'; g.fillRect(0, 4, w, 5); g.fillRect(0, 20, w, 5); }),                 // horizontal bars
  mesh: grilleLook((g, w, h) => { g.strokeStyle = '#34373c'; g.lineWidth = 2.5; for (const x of [-16, 0, 16, 32]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, h); g.moveTo(x + 16, 0); g.lineTo(x, h); g.stroke(); } }),   // diamond mesh
};
const LIFT = 0.004;     // metres a part stands off the skin
const TILE = 0.04;      // metres of car covered by one copy of a grille picture

/**
 * The nose and tail lists of a car: its own, or simple ones made from "headlights" / "taillights".
 * @returns {{ nose: object[], tail: object[] }}
 */
export function endParts(spec, halfW) {
  const H = spec.headlights, T = spec.taillights;
  const box = (is, s, y, w, h) => ({ is, box: [s - w / 2, s + w / 2, y - h / 2, y + h / 2] });
  const low = spec.clearance + 0.07;
  const nose = spec.nose ?? [
    { is: 'black', box: [0, halfW * 0.525, low + 0.03, low + 0.115], round: 0.03 },          // air intake low in the bumper
    !H.popup && box('head', H.x * halfW, H.y, H.w, H.h),                                     // (pop-up lamps live in pods: carBuilder.js)
    box('signal', halfW * 0.8, spec.stations[0][1] - 0.04, 0.14, 0.05),
  ].filter(Boolean);
  // Rear cluster. Wide ones, from the outside in: amber indicator, tail lamp, brake lamp.
  // Tall ones (vans, SUVs) are stacked instead. A small white reversing lamp sits underneath.
  const outer = T.x * halfW + T.w / 2, top = T.y + T.h / 2;
  const cluster = T.h > T.w
    ? [box('tail', T.x * halfW, top - T.h * 0.22, T.w, T.h * 0.44), box('brake', T.x * halfW, top - T.h * 0.61, T.w, T.h * 0.3), box('signal', T.x * halfW, top - T.h * 0.9, T.w, T.h * 0.2)]
    : [box('signal', outer - T.w * 0.085, T.y, T.w * 0.17, T.h), box('tail', outer - T.w * 0.41, T.y, T.w * 0.42, T.h), box('brake', outer - T.w * 0.825, T.y, T.w * 0.35, T.h)];
  const tail = spec.tail ?? [...cluster, box('reverse', T.x * halfW - T.w * 0.25, T.y - T.h / 2 - 0.05, 0.1, 0.045)];
  return { nose, tail };
}

/**
 * Build the nose and tail parts of a generated car.
 * @param surface  the skin (carShell.js makeShell().surface)     @param parts  { nose, tail } from endParts()
 * @returns {{ meshes: THREE.Mesh[], lamps: { head, tail, brake, reverse, signalL, signalR } }}
 *   a few meshes per finish and per lamp switch; lamps.<switch> lists the meshes that light up with it
 */
export function buildEndParts(surface, parts) {
  // Everything with the same finish (or lamp switch) at the same depth of the stack becomes one mesh.
  const piles = new Map();       // "name|order" -> { name, order, shapes: [] }
  const pile = (name, order, shape) => {
    const key = name + '|' + order;
    if (!piles.has(key)) piles.set(key, { name, order, shapes: [] });
    piles.get(key).shapes.push(shape);
  };
  for (const [list, tail] of [[parts.nose, false], [parts.tail, true]]) {
    const placed = [];           // [from, to, bottom, top, layer] of the parts so far, to stack overlapping ones
    for (const part of list) {
      const rows = rowsOf(part), lamp = LAMP_COLOURS[part.is] !== undefined;
      if (!lamp && !FINISHES[part.is]) { console.warn(`car "nose"/"tail": unknown part "${part.is}"`); continue; }
      const bounds = [rows[0][0], rows[rows.length - 1][0], Math.min(...rows.map((r) => r[1])), Math.max(...rows.map((r) => r[2]))];
      const layer = 1 + Math.max(0, ...placed.filter((p) => p[0] < bounds[1] && p[1] > bounds[0] && p[2] < bounds[3] && p[3] > bounds[2]).map((p) => p[4]));
      placed.push([...bounds, layer]);
      for (const side of [1, -1]) {
        if (lamp) {
          // A lamp: its lens, on a black surround a little bigger than itself.
          if (part.frame !== false) pile('black', layer, patch(surface, tail, grown(rows, 0.012), null, side));
          pile(part.is === 'signal' ? (side > 0 ? 'signalR' : 'signalL') : part.is, layer + 0.5, patch(surface, tail, rows, bounds, side));
        } else {
          pile(part.is, layer, patch(surface, tail, rows, null, side));
        }
      }
    }
  }
  const meshes = [], lamps = { head: [], tail: [], brake: [], reverse: [], signalL: [], signalR: [] };
  for (const { name, order, shapes } of piles.values()) {
    const glow = LAMP_COLOURS[name.replace(/[LR]$/, '')];
    const mesh = new THREE.Mesh(mergeGeometries(shapes), glow === undefined ? FINISHES[name] : flat(lensMaterial(glow)));
    mesh.name = 'end_' + name;
    mesh.renderOrder = order;
    meshes.push(mesh);
    if (lamps[name]) lamps[name].push(mesh);
  }
  return { meshes, lamps };
}

// ---- Outlines ---------------------------------------------------------------------------
// Every outline becomes rows of [s, bottom, top], in order of s.
function rowsOf(part) {
  if (part.rows) return part.rows;
  const c = part.circle;
  const [from, to, bottom, top] = c ? [c[0] - c[2], c[0] + c[2], c[1] - c[2], c[1] + c[2]] : part.box;
  const r = Math.min(c ? c[2] : part.round ?? Math.min(0.02, (top - bottom) * 0.3), (to - from) / 2, (top - bottom) / 2);
  if (r < 0.001) return [[from, bottom, top], [to, bottom, top]];
  const corner = [], steps = c ? 6 : 3;                          // a quarter circle: [how far in from the end, how much shorter]
  for (let k = 0; k <= steps; k++) { const a = (k / steps) * Math.PI / 2; corner.push([r * (1 - Math.cos(a)), r * (1 - Math.sin(a))]); }
  const rows = from <= 0 ? [[0, bottom, top]] : corner.map(([dx, dy]) => [from + dx, bottom + dy, top - dy]);   // (no corner at the centre line)
  return [...rows, ...corner.reverse().map(([dx, dy]) => [to - dx, bottom + dy, top - dy])];
}
// The same outline, `by` metres bigger all round.
function grown(rows, by) {
  const first = rows[0], last = rows[rows.length - 1];
  const bigger = rows.map(([s, lo, hi]) => [s, lo - by, hi + by]);
  return [...(first[0] > 0 ? [[first[0] - by, first[1], first[2]]] : []), ...bigger, [last[0] + by, last[1], last[2]]];
}

// ---- One part laid on the skin -----------------------------------------------------------
// bounds = [from, to, bottom, top] the picture is stretched over (lamps), or null to repeat
// it every TILE metres (grilles).     side = +1 right half, -1 its mirror image.
function patch(surface, tail, rows, bounds, side) {
  // Columns every two centimetres along s, the same number of steps up each column (small
  // triangles, so the part hugs the curve of the body).
  const columns = [];
  rows.forEach((row, k) => {
    if (k > 0) {
      const before = rows[k - 1], pieces = Math.max(1, Math.ceil((row[0] - before[0]) / 0.02));
      for (let i = 1; i < pieces; i++) columns.push(before.map((value, m) => lerp(value, row[m], i / pieces)));
    }
    columns.push(row);
  });
  const up = clamp(Math.ceil(Math.max(...columns.map((c) => c[2] - c[1])) / 0.025), 1, 16);
  const positions = [], uvs = [], index = [];
  for (const [s, bottom, top] of columns) {
    for (let r = 0; r <= up; r++) {
      const y = lerp(bottom, top, r / up), point = surface.onEnd(tail, Math.max(0, s), y);
      positions.push(point.x * side, point.y, point.z);
      if (bounds) uvs.push((s - bounds[0]) / (bounds[1] - bounds[0]), (y - bounds[2]) / (bounds[3] - bounds[2]));
      else uvs.push(s / TILE, y / TILE);
    }
  }
  // Triangles, wound so that the front of the part faces away from the car.
  const flip = (tail ? 1 : -1) * side < 0;
  for (let c = 0; c < columns.length - 1; c++) {
    for (let r = 0; r < up; r++) {
      const a = c * (up + 1) + r, b = a + up + 1;
      if (flip) index.push(a, a + 1, b, b, a + 1, b + 1); else index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Raise it off the skin a little. (Where an outline comes to a point its corner has no
  // direction of its own: it borrows the one next to it.)
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const lost = (i) => normal.getX(i) ** 2 + normal.getY(i) ** 2 + normal.getZ(i) ** 2 < 0.5;
  for (let i = 0; i < position.count; i++) {
    let from = i;
    for (const other of [i + up + 1, i - up - 1, i + 2 * (up + 1), i - 2 * (up + 1)]) if (lost(from) && other >= 0 && other < position.count) from = other;
    if (lost(from)) normal.setXYZ(i, 0, 0, tail ? 1 : -1); else if (from !== i) normal.setXYZ(i, normal.getX(from), normal.getY(from), normal.getZ(from));
    position.setXYZ(i, position.getX(i) + normal.getX(i) * LIFT, position.getY(i) + normal.getY(i) * LIFT, position.getZ(i) + normal.getZ(i) * LIFT);
  }
  return geometry;
}
