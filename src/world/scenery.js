// ---------------------------------------------------------------------------
// scenery.js — plants, rocks and poles beside the road. They are what makes
// speed visible: shapes that flash through the headlights and vanish.
//
// WHAT grows is decided by the map file ("scenery" list in map.json): each
// entry names a prop from public/content/props/ and how many per kilometre.
// If that prop does not exist, a simple built-in shape is used.
// Thousands of copies are drawn with InstancedMesh, grouped into chunks along
// the road so that chunks outside the view are skipped automatically.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD } from '../config.js';
import { makeRandom } from '../core/mathUtils.js';
import { instances } from './road.js';
import { getProp } from './props.js';

const CHUNK_LENGTH = 500;   // metres of road per chunk

// Built-in stand-ins, sized in metres, used when a prop model is missing.
const FALLBACKS = {
  bush: () => ({ geometry: bushGeometry(), color: 0x6f7355 }),
  pine: () => ({ geometry: pineGeometry(), color: 0x2f4630 }),
  rock: () => ({ geometry: new THREE.DodecahedronGeometry(0.7, 0), color: 0x77706a }),
};

export function buildScenery(map) {
  const { road } = map;
  const group = new THREE.Group();
  group.name = 'scenery';
  const rnd = makeRandom(2024);
  const projected = {};

  for (const kind of map.info.scenery || []) {
    const prop = getProp(kind.prop);
    const fallback = FALLBACKS[kind.prop]?.();
    if (!prop && !fallback) continue;
    const geometry = prop ? prop.geometry : fallback.geometry;
    const material = prop ? prop.material : new THREE.MeshStandardMaterial({ color: fallback.color, roughness: 1, flatShading: true });
    for (let start = 0; start < road.length; start += CHUNK_LENGTH) {
      const transforms = [];
      const count = Math.round((kind.perKm * CHUNK_LENGTH) / 1000);
      for (let k = 0; k < count; k++) {
        const s = start + rnd() * CHUNK_LENGTH;
        if (s >= road.length) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const i = Math.min(road.count - 1, Math.round(s / ROAD.step));
        const bench = side > 0 ? road.benchR[i] : road.benchL[i];
        const d = (bench + 1.5 + rnd() * rnd() * kind.maxDist) * side;   // rnd*rnd = more of them close by
        const x = road.x[i] - road.tz[i] * d, z = road.z[i] + road.tx[i] * d;
        // The road winds back on itself: make sure we are not standing on another piece of it.
        map.project(x, z, -1, projected);
        const j = projected.index;
        if (Math.abs(projected.d) < Math.max(road.benchL[j], road.benchR[j]) + 1) continue;
        const scale = kind.minScale + rnd() * (kind.maxScale - kind.minScale);
        transforms.push({ x, y: map.terrainHeight(x, z) - 0.15, z, yaw: rnd() * 6.28, scale, scaleY: scale * (0.85 + rnd() * 0.35) });
      }
      if (transforms.length) group.add(instances(geometry, material, transforms));
    }
  }

  // Utility poles march along one side of the road (only if the map asks and the prop exists).
  const poles = map.info.poles, poleProp = poles && getProp(poles.prop);
  if (poleProp) {
    const p = {}, transforms = [];
    for (let s = poles.spacing; s < road.length - 20; s += poles.spacing) {
      const i = Math.round(s / ROAD.step);
      const side = road.railL[i] === 0 ? -1 : road.railR[i] === 0 ? 1 : 0;   // stand on the hill side, never in a lot
      if (!side) continue;
      map.pointAt(s, side * 8.2, p);
      transforms.push({ x: p.x, y: p.y + 0.2, z: p.z, yaw: p.yaw });
    }
    const mesh = instances(poleProp.geometry, poleProp.material, transforms);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

// A scrubby chaparral bush: a lumpy flattened ball.
function bushGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const wobble = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    pos.setXYZ(i, pos.getX(i) * wobble, Math.max(-0.1, pos.getY(i) * 0.7 * wobble) + 0.35, pos.getZ(i) * wobble);
  }
  geo.computeVertexNormals();
  return geo;
}

// A pine tree: trunk plus three stacked cones, merged into one geometry.
function pineGeometry() {
  const parts = [new THREE.CylinderGeometry(0.16, 0.24, 2.2, 5).translate(0, 1.1, 0)];
  [[1.9, 3.2, 2.8], [1.5, 2.8, 4.6], [1.0, 2.6, 6.4]].forEach(([radius, height, y]) => {
    parts.push(new THREE.ConeGeometry(radius, height, 7).translate(0, y, 0));
  });
  return mergeGeometries(parts);
}
