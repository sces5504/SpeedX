// ---------------------------------------------------------------------------
// road.js — everything that is part of the highway itself:
// asphalt, painted lines, shoulders, guardrails, reflectors and curve signs.
//
// Most of it is made with one tool: buildStrip(). It walks along the road and
// at every sample asks you for a "cross-section" (a few points from left to
// right), then stitches those into a ribbon.
//
// Nothing here is one piece for the whole road: ribbons are cut every kilometre
// and small things (posts, reflectors, signs) are grouped by area, so that only
// the pieces near the camera are drawn (render/drawDistance.js). That is what
// lets a map be long.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS, ROAD } from '../config.js';
import { enhanceMaterial, makeAsphaltTexture, makeNoiseNormalMap, canvasTexture } from '../render/materials.js';
import { drawNear } from '../render/drawDistance.js';

const PIECE_ROWS = 500;      // road samples per piece of ribbon (500 x 2 m = one kilometre)
const AREA_SIZE = 600;       // metres: small roadside things are grouped into squares this big

// The brightest the road may get. Headlights mirrored in wet asphalt would otherwise be a
// white-hot patch that blooms and streaks. This lets the road get properly bright (set too low,
// everything your headlights touch turns the same flat cream) but keeps it below the level at
// which lamps start to bloom (1.25) and the streak filter (render/streak.js) draws lines (5).
export const ROAD_GLARE = 1.1;

export function buildRoad(map) {
  const { road } = map;
  const group = new THREE.Group();
  group.name = 'road';
  const asphaltTex = makeAsphaltTexture();
  const normalTex = makeNoiseNormalMap();

  // ---- Asphalt ------------------------------------------------------------
  const asphalt = enhanceMaterial(new THREE.MeshStandardMaterial({
    map: asphaltTex, normalMap: normalTex, normalScale: new THREE.Vector2(0.15, 0.15), roughness: 0.9,
  }), { wet: true, limit: ROAD_GLARE });
  // Every roadside position is measured from two per-sample numbers (mapData.js): road.half = centre line
  // to the edge of the asphalt, road.barrier = centre line to the guardrail. Both change where the road
  // changes kind (two lanes, four lanes with a median, a narrow country road).
  group.add(buildStrip(map, asphalt, (i) => [{ d: -road.half[i] }, { d: 0 }, { d: road.half[i] }]));

  // ---- Painted lines (slightly above the asphalt) --------------------------
  const paint = (color) => {
    const m = enhanceMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.55 }), { retro: 0.55, wet: true, limit: ROAD_GLARE });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    return m;
  };
  const yellow = paint(0xc8961a), white = paint(0xd8d8d2);
  // One painted line on each side of the centre: where(i) = metres from the centre line at
  // sample i, or null for "no paint here" (the gaps of a broken line).
  const lines = (material, where, width) => {
    const stripe = (d) => [{ d: d - width / 2, y: 0.012 }, { d: d + width / 2, y: 0.012, cut: true }];
    group.add(buildStrip(map, material, (i) => { const d = where(i); return d === null ? null : [...stripe(-d), ...stripe(d)]; }));
  };
  lines(yellow, (i) => Math.max(0.14, road.median[i]), 0.11);                       // double yellow: together, or one each side of a median
  lines(white, (i) => road.median[i] + road.lanes[i] * road.laneWidth[i], 0.12);    // white edge lines
  // A wide median between the two double lines is filled with slanted yellow bars (no driving here).
  const hatch = paint(0xc8961a);
  hatch.map = canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 9;
    for (let x = -h; x < w * 2; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); }
  });
  hatch.map.repeat.set(3, 2); hatch.alphaTest = 0.5;
  group.add(buildStrip(map, hatch, (i) => (road.median[i] > 0.5 ? [{ d: -road.median[i] + 0.22, y: 0.012 }, { d: road.median[i] - 0.22, y: 0.012 }] : null)));
  // Broken white line between two lanes going the same way: 4 m of paint, 6 m of gap.
  lines(white, (i) => (road.lanes[i] > 1 && i % 5 < 3 ? road.median[i] + road.laneWidth[i] : null), 0.1);

  // ---- Shoulders: gravel, dirt berm on the hill side, parking lots ----------
  const shoulderMat = enhanceMaterial(new THREE.MeshStandardMaterial({
    map: asphaltTex, normalMap: normalTex, vertexColors: true, roughness: 0.95,
  }), { wet: true, limit: ROAD_GLARE });
  const GRAVEL = [1.5, 1.3, 1.05], LOT = [0.8, 0.8, 0.82], DIRT = [1.0, 0.85, 0.6];
  // The cross-section of one shoulder at sample i, from the asphalt outward (side: +1 right, -1 left).
  const shoulder = (i, side) => {
    const bench = side > 0 ? road.benchR : road.benchL;
    const rail = side > 0 ? road.railR : road.railL;
    const b = bench[i], outer = b + 2, half = road.half[i], B = road.barrier[i];
    const edge = map.terrainHeight(road.x[i] - road.tz[i] * outer * side, road.z[i] + road.tx[i] * outer * side) - 0.3;
    let pts;
    if (rail[i] === 2) {          // open lot (gas station, turnout, turnaround)
      pts = [{ d: half, c: LOT }, { d: B - 0.1, c: LOT }, { d: B + 0.1, c: LOT }, { d: b - 3, c: LOT }, { d: b - 1.5, y: -0.05, c: GRAVEL }, { d: outer, abs: edge, c: DIRT }];
    } else if (rail[i] === 1) {   // guardrail side
      pts = [{ d: half, c: GRAVEL }, { d: B - 0.1, y: -0.03, c: GRAVEL }, { d: B + 0.1, y: -0.04, c: GRAVEL }, { d: B + 0.6, y: -0.06, c: GRAVEL }, { d: b - 1.5, y: -0.12, c: DIRT }, { d: outer, abs: edge, c: DIRT }];
    } else {                      // hill side: a dirt berm stops cars
      pts = [{ d: half, c: GRAVEL }, { d: B - 0.15, y: -0.02, c: GRAVEL }, { d: B + 0.05, y: 0.24, c: DIRT }, { d: B + 0.6, y: 0.32, c: DIRT }, { d: b - 1.5, y: 0.5, c: DIRT }, { d: outer, abs: edge, c: DIRT }];
    }
    if (side < 0) pts = pts.map((p) => ({ ...p, d: -p.d })).reverse();
    return pts;
  };
  // Both shoulders share one ribbon (fewer things to draw): left one, a cut, then the right one.
  group.add(buildStrip(map, shoulderMat, (i) => {
    const left = shoulder(i, -1);
    left[left.length - 1] = { ...left[left.length - 1], cut: true };
    return [...left, ...shoulder(i, 1)];
  }));

  // ---- Guardrails -----------------------------------------------------------
  const steel = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x9a9fa3, metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide }), { limit: ROAD_GLARE });
  const wallConcrete = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x8a8882, roughness: 0.9, side: THREE.DoubleSide }), { limit: ROAD_GLARE });
  const postTransforms = [], reflectorWhite = [], reflectorYellow = [], delineators = [];
  const p = {};
  for (const side of [-1, 1]) {
    const rail = side > 0 ? road.railR : road.railL;
    group.add(buildStrip(map, steel, (i) => {
      if (rail[i] !== 1 || road.lanes[i] > 1) return null;  // gap in the rail (the wide road has a concrete wall instead, below)
      const o = road.barrier[i] * side;
      // W-shaped steel beam, seen from the end
      return [[0, 0.50], [-0.07, 0.56], [-0.02, 0.655], [-0.07, 0.75], [0, 0.81]]
        .map(([dx, y]) => ({ d: o + dx * side, y }));
    }, { cast: true }));
    // Where the road has two lanes each way the drop side gets a concrete "New Jersey" wall, as on Taiwan's coast road.
    group.add(buildStrip(map, wallConcrete, (i) => {
      if (rail[i] !== 1 || road.lanes[i] < 2) return null;
      const o = road.barrier[i] * side;
      return [[-0.3, 0], [-0.3, 0.08], [-0.17, 0.3], [-0.1, 0.8], [0.1, 0.8], [0.17, 0.3], [0.3, 0.08], [0.3, 0]].map(([dx, y]) => ({ d: o + dx * side, y }));
    }, { cast: true }));
    for (let i = 0; i < road.count; i += 2) {               // a post every 4 m
      if (rail[i] === 1 && road.lanes[i] > 1) {             // concrete wall: only a reflector on its face, every 16 m
        if (i % 8 === 0) { map.pointAt(i * ROAD.step, (road.barrier[i] - 0.2) * side, p); (side > 0 ? reflectorWhite : reflectorYellow).push({ x: p.x, y: p.y + 0.5, z: p.z, yaw: p.yaw }); }
      } else if (rail[i] === 1) {
        map.pointAt(i * ROAD.step, (road.barrier[i] + 0.08) * side, p);
        postTransforms.push({ x: p.x, y: p.y + 0.36, z: p.z, yaw: p.yaw });
        if (i % 8 === 0) {                                  // reflector every 16 m
          map.pointAt(i * ROAD.step, (road.barrier[i] - 0.09) * side, p);
          (side > 0 ? reflectorWhite : reflectorYellow).push({ x: p.x, y: p.y + 0.66, z: p.z, yaw: p.yaw });
        }
      } else if (rail[i] === 0 && i % 20 === 0) {           // hill side: marker post every 40 m
        map.pointAt(i * ROAD.step, (road.barrier[i] + 0.9) * side, p);
        delineators.push({ x: p.x, y: p.y + 0.85, z: p.z, yaw: p.yaw });
      }
    }
  }
  const postMat = new THREE.MeshStandardMaterial({ color: 0x70757a, metalness: 0.6, roughness: 0.6 });
  group.add(instancesByArea(new THREE.BoxGeometry(0.09, 0.9, 0.14), postMat, postTransforms, { cast: true }));

  // ---- Reflectors -------------------------------------------------------------
  const reflector = (color) => enhanceMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.3 }), { retro: 4 });
  const tab = new THREE.BoxGeometry(0.04, 0.12, 0.1);
  group.add(instancesByArea(tab, reflector(0xffffff), reflectorWhite));
  group.add(instancesByArea(tab, reflector(0xffb820), reflectorYellow));
  // Raised yellow markers between the centre lines, every 14 m
  const studs = [];
  for (let s = 6; s < road.length; s += 14) { map.pointAt(s, 0, p); studs.push({ x: p.x, y: p.y + 0.012, z: p.z, yaw: p.yaw }); }
  group.add(instancesByArea(new THREE.BoxGeometry(0.16, 0.03, 0.16), reflector(0xffb820), studs));
  // White marker posts with a reflective band
  const postWhite = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6 }), { retro: 1.2 });
  group.add(instancesByArea(new THREE.BoxGeometry(0.03, 1.2, 0.1), postWhite, delineators));
  group.add(instancesByArea(new THREE.BoxGeometry(0.035, 0.16, 0.085), reflector(0xffffff),
    delineators.map((t) => ({ ...t, y: t.y + 0.45 }))));

  // ---- Chevron signs on the outside of sharp bends ----------------------------
  const chevronLeft = [], chevronRight = [], chevronPosts = [];
  const clearOfEnds = road.closed ? 0 : 30;                  // an open road keeps signs away from its end barriers
  for (let i = clearOfEnds; i < road.count - clearOfEnds; i += 12) {
    const curve = road.curve[i];
    if (Math.abs(curve) < 1 / 120) continue;
    const side = curve > 0 ? 1 : -1;                         // outside of the bend
    if ((side > 0 ? road.railR : road.railL)[i] === 2) continue;
    map.pointAt(i * ROAD.step, (road.barrier[i] + 1.3) * side, p);
    const t = { x: p.x, y: p.y + 1.45, z: p.z, yaw: p.yaw };  // front faces drivers coming along +s
    (curve > 0 ? chevronLeft : chevronRight).push(t);
    chevronPosts.push({ x: p.x, y: p.y + 0.55, z: p.z, yaw: p.yaw });
  }
  const chevronTex = canvasTexture(64, 80, (g, w, h) => {
    g.fillStyle = '#f2c200'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; g.beginPath();                     // arrow head pointing left
    g.moveTo(46, 8); g.lineTo(18, 40); g.lineTo(46, 72); g.lineTo(58, 72); g.lineTo(30, 40); g.lineTo(58, 8);
    g.closePath(); g.fill();
  }, { repeat: false });
  const chevronMat = enhanceMaterial(new THREE.MeshStandardMaterial({ map: chevronTex, roughness: 0.5, side: THREE.DoubleSide }), { retro: 1.8 });
  const board = new THREE.PlaneGeometry(0.46, 0.6);
  group.add(instancesByArea(board, chevronMat, chevronLeft));
  group.add(instancesByArea(board, chevronMat, chevronRight.map((t) => ({ ...t, flip: true }))));
  group.add(instancesByArea(new THREE.BoxGeometry(0.05, 2.0, 0.05), postMat, chevronPosts, { cast: true }));

  // ---- Speed limit signs ------------------------------------------------------------
  // Speed-limit signs every ~1.3 km, for both directions, each showing the limit of the stretch it stands
  // on (road.limit). A map says which country's signs it uses with "signs" in map.json: "tw" = Taiwan's
  // round sign with a red ring and the limit in km/h; anything else = the American board in mph.
  const taiwan = map.info.signs === 'tw';
  const signFace = (limit) => canvasTexture(128, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    if (taiwan) {
      g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(w / 2, h / 2, 60, 0, 7); g.fill();
      g.strokeStyle = '#c8181c'; g.lineWidth = 13; g.beginPath(); g.arc(w / 2, h / 2, 53, 0, 7); g.stroke();
      g.fillStyle = '#111'; g.font = 'bold 60px Arial'; g.textBaseline = 'middle'; g.fillText(String(Math.round((limit * 3.6) / 10) * 10), w / 2, h / 2 + 4);
    } else {
      g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#111';
      g.font = 'bold 24px Arial'; g.fillText('SPEED', w / 2, 40); g.fillText('LIMIT', w / 2, 66);
      g.font = 'bold 76px Arial'; g.fillText(String(Math.round((limit * 2.237) / 5) * 5), w / 2, 138);
    }
  }, { repeat: false });
  const signsByLimit = new Map(), speedPosts = [];
  for (let s = 700; s < road.length - 300; s += 1300) {
    for (const dir of [1, -1]) {
      const at = s + dir * 40, limit = Math.round(map.at(road.limit, at) * 10) / 10;
      map.pointAt(at, (map.at(road.barrier, at) + 1.4) * dir, p);
      if (!signsByLimit.has(limit)) signsByLimit.set(limit, []);
      signsByLimit.get(limit).push({ x: p.x, y: p.y + 2.0, z: p.z, yaw: p.yaw + (dir > 0 ? 0 : Math.PI) });
      speedPosts.push({ x: p.x, y: p.y + 0.8, z: p.z - 0.0, yaw: p.yaw });
    }
  }
  for (const [limit, places] of signsByLimit) {
    const face = enhanceMaterial(new THREE.MeshStandardMaterial({ map: signFace(limit), roughness: 0.5, alphaTest: 0.5 }), { retro: 1.8 });
    group.add(instancesByArea(new THREE.PlaneGeometry(0.61, 0.76), face, places));
  }
  group.add(instancesByArea(new THREE.BoxGeometry(0.05, 2.4, 0.05), postMat, speedPosts));

  return group;
}

// ---------------------------------------------------------------------------
// buildStrip — the ribbon maker.
// section(i) returns the cross-section at road sample i: an array of points
//   { d, y, abs, c }   d   = metres right of the centre line
//                      y   = height above the road surface (default 0)
//                      abs = use this exact world height instead
//                      c   = [r, g, b] vertex colour (optional)
//                      cut = true: the ribbon is not joined from this point to the next one
//                            (so several separate stripes can share one mesh)
// Return null to leave a gap (used for guardrails).
//
// The ribbon comes back as a group of pieces, each PIECE_ROWS samples long and drawn only
// when near. cast / receive = whether it throws and shows shadows.
// ---------------------------------------------------------------------------
export function buildStrip(map, material, section, { cast = false, receive = true } = {}) {
  const { road } = map, group = new THREE.Group();
  // On a loop the ribbon gets one extra row at the very end, standing on sample 0 again, so the
  // last piece is stitched back to the start (its texture carries on instead of jumping back to 0).
  const rows = road.closed ? road.count + 1 : road.count;
  for (let first = 0; first < rows - 1; first += PIECE_ROWS) {
    const piece = stripPiece(map, material, section, first, Math.min(rows - 1, first + PIECE_ROWS));
    if (!piece) continue;                                   // (nothing along this stretch, e.g. no guardrail)
    piece.castShadow = cast; piece.receiveShadow = receive;
    group.add(drawNear(piece));
  }
  return group;
}

// One piece of ribbon, from row `first` to row `last` (both included, so neighbouring pieces meet).
function stripPiece(map, material, section, first, last) {
  const { road } = map;
  const positions = [], uvs = [], colors = [], indices = [];
  let previousStart = -1, previousCount = 0;
  for (let row = first; row <= last; row++) {
    const i = row % road.count;
    const pts = section(i);
    if (!pts) { previousStart = -1; continue; }
    const start = positions.length / 3;
    for (const pt of pts) {
      const y = pt.abs !== undefined ? pt.abs : map.roadHeight(i * ROAD.step, pt.d) + (pt.y || 0);
      positions.push(road.x[i] - road.tz[i] * pt.d, y, road.z[i] + road.tx[i] * pt.d);
      uvs.push(pt.d / 6, (row * ROAD.step) / 6);
      if (pt.c) colors.push(...pt.c);
    }
    if (previousStart >= 0 && previousCount === pts.length) {
      for (let j = 0; j < pts.length - 1; j++) {
        if (pts[j].cut) continue;
        const a = previousStart + j, b = start + j;        // a = previous row, b = this row
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    previousStart = start; previousCount = pts.length;
  }
  if (!indices.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

// The same as instances() below, for things scattered along the whole road: they are split
// into squares of AREA_SIZE metres, one mesh per square, each drawn only when near.
export function instancesByArea(geometry, material, transforms, { cast = false } = {}) {
  const areas = new Map();
  for (const t of transforms) {
    const key = Math.floor(t.x / AREA_SIZE) + ',' + Math.floor(t.z / AREA_SIZE);
    if (!areas.has(key)) areas.set(key, []);
    areas.get(key).push(t);
  }
  const group = new THREE.Group();
  for (const list of areas.values()) {
    const mesh = instances(geometry, material, list);
    mesh.castShadow = cast;
    group.add(drawNear(mesh, GRAPHICS.drawDistance / 2));     // too small to be seen from as far as the road itself
  }
  return group;
}

// Draw the same small shape many times cheaply (one draw call).
// transforms: [{ x, y, z, yaw, scale?, flip? }]
export function instances(geometry, material, transforms) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, transforms.length));
  mesh.count = transforms.length;
  const dummy = new THREE.Object3D();
  transforms.forEach((t, i) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, t.yaw || 0, 0);
    const s = t.scale || 1;
    dummy.scale.set(t.flip ? -s : s, t.scaleY || s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
