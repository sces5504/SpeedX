// ---------------------------------------------------------------------------
// carWheel.js — a wheel for generated cars: a tyre with rounded shoulders and
// a real alloy rim (barrel, spokes, hub, brake disc), instead of a flat disc
// with a picture of a rim on it. Two meshes per wheel: tyre and rim.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { carReflection } from '../render/reflections.js';
import { enhanceMaterial } from '../render/materials.js';

const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.88 });
// (limit: polished metal in a headlight beam must not flare up — see enhanceMaterial)
const alloy = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.28, metalness: 0.95, envMap: carReflection }), { limit: 0.6 });
const darkAlloy = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.35, metalness: 0.9, envMap: carReflection }), { limit: 0.6 });
const cache = new Map();     // wheels of the same size and style share their geometry

/**
 * @param radius  outside radius of the tyre (m)      @param width  tyre width (m)
 * @param style   { spokes: 5, dark: false }  — hero cars get dark deep-dish rims, traffic gets plain silver
 * @returns THREE.Group whose axle runs along X, with the pretty side at +X (flip it for left wheels)
 */
export function buildWheel(radius, width, { spokes = 5, dark = false } = {}) {
  const key = `${radius}|${width}|${spokes}`;
  if (!cache.has(key)) cache.set(key, { tyre: tyreGeometry(radius, width), rim: rimGeometry(radius, width, spokes) });
  const { tyre, rim } = cache.get(key);
  const wheel = new THREE.Group();
  const tyreMesh = new THREE.Mesh(tyre, rubber);
  tyreMesh.castShadow = true;
  wheel.add(tyreMesh, new THREE.Mesh(rim, dark ? darkAlloy : alloy));
  return wheel;
}

// The tyre: its cross-section (from the bead, round the tread, to the other bead) spun round the axle.
function tyreGeometry(r, w) {
  const h = w / 2, inner = r * 0.64;
  const outline = [[inner, -h * 0.82], [r * 0.80, -h], [r * 0.95, -h * 0.94], [r, -h * 0.7], [r, h * 0.7], [r * 0.95, h * 0.94], [r * 0.80, h], [inner, h * 0.82]];
  return new THREE.LatheGeometry(outline.map(([x, y]) => new THREE.Vector2(x, y)), 28).rotateZ(-Math.PI / 2);
}

// The rim: a barrel inside the tyre, a lip, spokes, a hub cap and the brake disc behind them.
function rimGeometry(r, w, spokes) {
  const h = w / 2, rimR = r * 0.66, face = h * 0.72;      // face = how far out the spokes sit
  const parts = [];
  const barrel = [[rimR * 0.9, -h * 0.8], [rimR, -h * 0.75], [rimR, h * 0.8], [rimR * 1.04, h * 0.86], [rimR * 0.93, h * 0.84], [rimR * 0.9, face]];
  parts.push(new THREE.LatheGeometry(barrel.map(([x, y]) => new THREE.Vector2(x, y)), 28).rotateZ(-Math.PI / 2));
  for (let k = 0; k < spokes; k++) {
    // A spoke runs from the hub out to the barrel, a little thicker at the hub.
    const spoke = new THREE.BoxGeometry(0.03, rimR * 0.92, r * 0.17).translate(face - 0.015, rimR * 0.46, 0);
    parts.push(spoke.rotateX((k / spokes) * Math.PI * 2));
  }
  parts.push(new THREE.CylinderGeometry(r * 0.17, r * 0.2, 0.05, 16).rotateZ(-Math.PI / 2).translate(face, 0, 0));          // hub cap
  parts.push(new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.02, 24).rotateZ(-Math.PI / 2).translate(face - 0.07, 0, 0));   // brake disc
  return mergeGeometries(parts.map((g) => { const flat = g.index ? g.toNonIndexed() : g; flat.deleteAttribute('uv'); return flat; }));
}
