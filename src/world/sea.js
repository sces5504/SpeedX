// ---------------------------------------------------------------------------
// sea.js — the sea, for maps beside one ("sea": true in map.json; build-map.mjs
// sets it when the elevation data reaches the water).
//
// It is one big flat sheet of dark water at sea level (map.seaLevel). The
// terrain under it is the sea bed, which build-map.mjs keeps a few metres deep,
// so the shoreline is simply where the land comes up through the sheet.
// At night the sea is almost black; what you see of it is the sky's glow and
// the lights on shore reflected in its ripples. The ripples are a bumpy
// "normal map" laid over the sheet and slid slowly sideways.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS } from '../config.js';
import { enhanceMaterial, makeNoiseNormalMap } from '../render/materials.js';

const RIPPLE_SIZE = 14;        // metres one copy of the ripple picture covers
const DRIFT = 0.35;            // metres per second the ripples slide

/** @returns null for a map without sea, otherwise { mesh, update(dt) } */
export function buildSea(map) {
  if (map.seaLevel === null) return null;
  const hm = map.heightmap;
  // Big enough to reach the fog in every direction from anywhere on the map.
  const width = (hm.cols - 1) * hm.cell + GRAPHICS.viewDistance * 2, depth = (hm.rows - 1) * hm.cell + GRAPHICS.viewDistance * 2;
  const ripples = makeNoiseNormalMap(256, 1.6, 41);
  ripples.repeat.set(width / RIPPLE_SIZE, depth / RIPPLE_SIZE);
  const water = enhanceMaterial(new THREE.MeshStandardMaterial({
    color: 0x0c2636, roughness: 0.08, metalness: 0.0,
    normalMap: ripples, normalScale: new THREE.Vector2(0.55, 0.55),
    envMapIntensity: 5,            // mirrors the sky far more than dry land does: that glow is what sets the sea apart from the shore
  }), { limit: 0.9 });             // headlights must not light the water up like a wall
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), water);
  mesh.name = 'sea';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(hm.x0 + ((hm.cols - 1) * hm.cell) / 2, map.seaLevel, hm.z0 + ((hm.rows - 1) * hm.cell) / 2);
  mesh.receiveShadow = false;
  return {
    mesh,
    update(dt) {
      ripples.offset.x += (DRIFT * dt) / RIPPLE_SIZE;
      ripples.offset.y += (DRIFT * 0.6 * dt) / RIPPLE_SIZE;
    },
  };
}
