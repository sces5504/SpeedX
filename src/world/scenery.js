// ---------------------------------------------------------------------------
// scenery.js — plants, rocks and poles beside the road. They are what makes
// speed visible: shapes that flash through the headlights and vanish.
//
// WHAT grows is decided by the map file ("scenery" list in map.json): each
// entry names a plant from the shared library (library.js) and how many per
// kilometre. Thousands of copies are drawn with InstancedMesh, grouped into
// chunks along the road so that chunks outside the view are skipped
// automatically.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS, ROAD } from '../config.js';
import { makeRandom } from '../core/mathUtils.js';
import { instances, instancesByArea } from './road.js';
import { drawNear } from '../render/drawDistance.js';
import { getProp } from './props.js';
import { plantParts } from './library.js';

const CHUNK_LENGTH = 500;   // metres of road per chunk

export function buildScenery(map) {
  const { road } = map;
  const group = new THREE.Group();
  group.name = 'scenery';
  const rnd = makeRandom(2024);
  const projected = {};

  for (const kind of map.info.scenery || []) {
    const parts = plantParts(kind.prop);
    if (!parts) continue;
    for (let start = 0; start < road.length; start += CHUNK_LENGTH) {
      const transforms = [];
      const count = Math.round((kind.perKm * CHUNK_LENGTH) / 1000);
      for (let k = 0; k < count; k++) {
        const s = start + rnd() * CHUNK_LENGTH;
        if (s >= road.length) continue;
        const side = kind.side || (rnd() < 0.5 ? -1 : 1);            // a scenery entry may keep to one side of the road
        if (!inStretch(s, kind)) continue;
        const i = Math.min(road.count - 1, Math.round(s / ROAD.step));
        const bench = side > 0 ? road.benchR[i] : road.benchL[i];
        const d = (bench + (kind.minDist ?? 1.5) + rnd() * rnd() * kind.maxDist) * side;   // rnd*rnd = more of them close by
        const x = road.x[i] - road.tz[i] * d, z = road.z[i] + road.tx[i] * d;
        // The road winds back on itself: make sure we are not standing on another piece of it.
        map.project(x, z, -1, projected);
        const j = projected.index;
        if (Math.abs(projected.d) < Math.max(road.benchL[j], road.benchR[j]) + (kind.minDist ?? 1.5) - 0.5) continue;
        if (hidesABuilding(map, projected)) continue;
        const scale = kind.minScale + rnd() * (kind.maxScale - kind.minScale);
        const y = map.terrainHeight(x, z);
        if (map.seaLevel !== null && y < map.seaLevel + 0.8) continue;      // nothing grows in the sea or on the wet sand
        transforms.push({ x, y: y - 0.15, z, yaw: rnd() * 6.28, scale, scaleY: scale * (0.85 + rnd() * 0.35) });
      }
      // One mesh per plant part per 500 m of road, drawn only when near (render/drawDistance.js) —
      // at half the usual distance: at night plants are only seen in headlights or as close silhouettes.
      if (transforms.length) for (const part of parts) group.add(drawNear(instances(part.geometry, part.material, transforms), GRAPHICS.drawDistance / 2));
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
      map.pointAt(s, side * (road.barrier[i] + 1.2), p);
      transforms.push({ x: p.x, y: p.y + 0.2, z: p.z, yaw: p.yaw });
    }
    group.add(instancesByArea(poleProp.geometry, poleProp.material, transforms, { cast: true }));
  }
  return group;
}

// Would a plant here stand in a building, or between a building and the road? Nothing grows on a
// building's plot, and the strip in front of it is kept clear so it can be seen from the road.
function hidesABuilding(map, { s, d }) {
  for (const b of map.buildings) {
    if (b.kind === 'power-tower' || b.kind === 'bus-stop' || Math.sign(d) !== b.side) continue;      // (pylons and bus stops stand among the plants)
    if (Math.abs(map.ahead(b.s, s)) < b.width / 2 + 6 && Math.abs(d) < b.front + b.depth + 3) return true;
  }
  return false;
}

// Does this kind of plant grow at s? A scenery entry may name a stretch of road with "from" and
// "to" (metres from the start); on a loop a stretch may run across the join (from bigger than to).
function inStretch(s, { from = 0, to = Infinity }) {
  return from <= to ? s >= from && s < to : s >= from || s < to;
}
