// ---------------------------------------------------------------------------
// carModel.js — turns a car's model.glb (made in Meshy / Blender) into parts
// the game can use. A generated model is ONE lump of triangles in any size and
// direction, so at load time we:
//   1. turn it so the nose points to -Z, and scale it to the car's real length
//   2. find the four wheels and cut them out as separate pieces, so they can
//      spin and steer
//   3. "clean" the painted-on texture: AI textures have smudgy fake highlights
//      baked in, which look uncanny. We keep only WHAT each area is (paint,
//      glass/trim, coloured lamp) and let the game's own lights do the shading.
// Nothing has to be prepared by hand in Blender. The only setting is in
// car.json:   "model": { "file": "model.glb", "flip": true }
//   flip      set it if the car drives backwards (nose/tail swapped)
// Cars without a "model" entry use the simple generated shell instead.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cache = new Map();     // car id -> prepared model (or null if it has none / failed)
const loader = new GLTFLoader();

export const getCarModel = (id) => cache.get(id) || null;

// Load the models of all the given cars (call once, before building cars).
export async function preloadCarModels(specs) {
  await Promise.all(specs.map(async (spec) => {
    if (cache.has(spec.id) || !spec.model?.file) return;
    try {
      const gltf = await loader.loadAsync(spec.folder + spec.model.file);
      cache.set(spec.id, prepare(gltf.scene, spec));
    } catch (error) {
      console.warn(`Model for "${spec.id}" failed to load, using the generated shell:`, error);
      cache.set(spec.id, null);
    }
  }));
}

// Merge every mesh of a loaded .glb into one geometry in world space.
// Returns { geometry, material } (the first material is used for everything).
export function flattenGltf(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  let material = null;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const g = node.geometry.clone().applyMatrix4(node.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    parts.push(g.index ? g.toNonIndexed() : g);
    material ??= Array.isArray(node.material) ? node.material[0] : node.material;
  });
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  repairNormals(geometry);
  return { geometry, material };
}

// Generated meshes sometimes contain broken (zero-length) normals. On screen one
// of those becomes an invalid pixel, which the bloom effect then smears into a
// huge black rectangle. Replace every broken normal with its triangle's own.
function repairNormals(geometry) {
  const p = geometry.attributes.position.array, n = geometry.attributes.normal.array;
  for (let t = 0; t < p.length; t += 9) {
    let face = null;
    for (let v = 0; v < 9; v += 3) {
      const length = Math.hypot(n[t + v], n[t + v + 1], n[t + v + 2]);
      if (length > 0.5 && length < 1.5) continue;            // fine (NaN fails this test too)
      if (!face) {
        const ax = p[t + 3] - p[t], ay = p[t + 4] - p[t + 1], az = p[t + 5] - p[t + 2];
        const bx = p[t + 6] - p[t], by = p[t + 7] - p[t + 1], bz = p[t + 8] - p[t + 2];
        face = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
        const len = Math.hypot(...face);
        face = len > 1e-12 ? face.map((c) => c / len) : [0, 1, 0];
      }
      n[t + v] = face[0]; n[t + v + 1] = face[1]; n[t + v + 2] = face[2];
    }
  }
}

function prepare(scene, spec) {
  const { geometry, material } = flattenGltf(scene);
  const a = spec.wheelbase * (1 - spec.frontWeight), b = spec.wheelbase * spec.frontWeight;
  const frontZ = -a - spec.frontOverhang;

  // ---- 1. Orientation and size -------------------------------------------------
  geometry.computeBoundingBox();
  let size = geometry.boundingBox.getSize(new THREE.Vector3());
  if (size.x > size.z) geometry.rotateY(Math.PI / 2);            // length must run along Z
  // Which end is the nose? Compare the model's roof line with the car's "stations"
  // (the side profile in car.json) both ways round and keep the better match.
  // "flip": true / false in car.json overrides the guess.
  const flip = spec.model.flip ?? looksBackwards(geometry, spec);
  if (flip) geometry.rotateY(Math.PI);
  geometry.computeBoundingBox();
  size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = spec.length / size.z;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, frontZ - box.min.z);   // tyres on the ground, nose at frontZ
  geometry.computeBoundingBox();
  const halfW = geometry.boundingBox.max.x;

  // ---- 2. Find the axles: the only things touching the ground are tyres -----------
  const pos = geometry.attributes.position;
  const r = spec.wheelRadius;
  const lowZ = [];
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < r * 0.45) lowZ.push(pos.getZ(i));
  lowZ.sort((p, q) => p - q);
  let axleFront = -a, axleRear = b;
  if (lowZ.length > 20) {
    let gapAt = 0, gap = 0;                                        // biggest empty stretch = between the axles
    for (let i = 1; i < lowZ.length; i++) if (lowZ[i] - lowZ[i - 1] > gap) { gap = lowZ[i] - lowZ[i - 1]; gapAt = i; }
    const front = (lowZ[0] + lowZ[gapAt - 1]) / 2, rear = (lowZ[gapAt] + lowZ[lowZ.length - 1]) / 2;
    if (Math.abs(front + a) < 0.45 && Math.abs(rear - b) < 0.45) { axleFront = front; axleRear = rear; }
  }

  // ---- 3. Cut the wheels out ---------------------------------------------------------
  const tyreDepth = r * 0.95;                                      // how far in from the body side a wheel reaches
  const wheelCentres = [[-1, axleFront], [1, axleFront], [-1, axleRear], [1, axleRear]];
  const bodyTris = [], wheelTris = [[], [], [], []];
  const p = pos.array, n = geometry.attributes.normal.array, uv = geometry.attributes.uv?.array;
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (p[t * 3] + p[t * 3 + 3] + p[t * 3 + 6]) / 3, cy = (p[t * 3 + 1] + p[t * 3 + 4] + p[t * 3 + 7]) / 3, cz = (p[t * 3 + 2] + p[t * 3 + 5] + p[t * 3 + 8]) / 3;
    let target = bodyTris;
    if (Math.abs(cx) > halfW - tyreDepth) {
      wheelCentres.forEach(([side, z], k) => {
        if (cx * side > 0 && (cz - z) ** 2 + (cy - r) ** 2 < (r * 1.06) ** 2) target = wheelTris[k];
      });
    }
    target.push(t);
  }
  const build = (tris, offset) => {
    const g = new THREE.BufferGeometry();
    const P = new Float32Array(tris.length * 9), N = new Float32Array(tris.length * 9), U = uv ? new Float32Array(tris.length * 6) : null;
    tris.forEach((t, k) => {
      for (let v = 0; v < 3; v++) {
        const src = (t + v) * 3, dst = (k * 3 + v) * 3;
        P[dst] = p[src] - offset[0]; P[dst + 1] = p[src + 1] - offset[1]; P[dst + 2] = p[src + 2] - offset[2];
        N[dst] = n[src]; N[dst + 1] = n[src + 1]; N[dst + 2] = n[src + 2];
        if (U) { U[(k * 3 + v) * 2] = uv[(t + v) * 2]; U[(k * 3 + v) * 2 + 1] = uv[(t + v) * 2 + 1]; }
      }
    });
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };
  const halfTrack = halfW - r * 0.36;
  const wheels = wheelCentres.map(([side, z], k) => ({
    side, z, x: side * halfTrack,
    geometry: wheelTris[k].length > 30 ? build(wheelTris[k], [side * halfTrack, r, z]) : null,   // null -> use a generated wheel
  }));
  const clean = cleanTextures(material);
  // Body: glossy clear-coated paint. Tinting this material's colour repaints the car.
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    map: clean.color, roughnessMap: clean.roughness, metalnessMap: clean.roughness, roughness: 1, metalness: 1, clearcoat: 0.7, clearcoatRoughness: 0.1,
  });
  // Wheels keep their own colours (never tinted with the body paint).
  const wheelMaterial = new THREE.MeshStandardMaterial({ map: clean.wheel, roughness: 0.55, metalness: 0.3 });
  return { body: build(bodyTris, [0, 0, 0]), wheels, material: bodyMaterial, wheelMaterial, halfW, frontZ, rearZ: frontZ + spec.length, height: geometry.boundingBox.max.y };
}

// Height of the top of the model along its length, compared with the spec's profile.
function looksBackwards(geometry, spec) {
  const pos = geometry.attributes.position, box = geometry.boundingBox;
  const SLICES = 24, top = new Float32Array(SLICES).fill(box.min.y);
  for (let i = 0; i < pos.count; i += 3) {
    const k = Math.min(SLICES - 1, Math.floor(((pos.getZ(i) - box.min.z) / (box.max.z - box.min.z)) * SLICES));
    top[k] = Math.max(top[k], pos.getY(i));
  }
  const height = box.max.y - box.min.y;
  // The spec's roof line at fraction t (0 = nose), as a fraction of the car's height.
  const profile = (t) => {
    const st = spec.stations;
    for (let i = 1; i < st.length; i++) {
      if (t <= st[i][0]) {
        const a = st[i - 1], b = st[i], f = (t - a[0]) / (b[0] - a[0] || 1);
        return (Math.max(a[1], a[2]) + (Math.max(b[1], b[2]) - Math.max(a[1], a[2])) * f) / spec.height;
      }
    }
    return 0.5;
  };
  let forwards = 0, backwards = 0;
  for (let k = 0; k < SLICES; k++) {
    const t = (k + 0.5) / SLICES, h = (top[k] - box.min.y) / height;
    forwards += (h - profile(t)) ** 2;          // model's min-Z end is the nose
    backwards += (h - profile(1 - t)) ** 2;     // model's min-Z end is the tail
  }
  return backwards < forwards;
}

// ---------------------------------------------------------------------------
// Texture cleaning. Every pixel of the model's colour texture is sorted into:
//   paint   bright, colourless  -> flat white (the car colour is multiplied in later)
//   dark    glass, trim, grille -> the same dark mirror-like glass the generated cars use
//   lamp    clearly coloured (orange indicators, red tail lamps) -> kept
// The result has no baked shadows or highlights left in it.
// ---------------------------------------------------------------------------
function cleanTextures(material) {
  const size = 1024;
  const read = document.createElement('canvas');
  read.width = read.height = size;
  const g = read.getContext('2d', { willReadFrequently: true });
  if (material.map?.image) g.drawImage(material.map.image, 0, 0, size, size); else { g.fillStyle = '#ddd'; g.fillRect(0, 0, size, size); }
  const source = g.getImageData(0, 0, size, size).data;
  const make = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const colorCanvas = make(), roughCanvas = make(), wheelCanvas = make();
  const color = new ImageData(size, size), rough = new ImageData(size, size), wheel = new ImageData(size, size);
  for (let i = 0; i < source.length; i += 4) {
    const r = source[i] / 255, gr = source[i + 1] / 255, b = source[i + 2] / 255;
    const max = Math.max(r, gr, b), min = Math.min(r, gr, b), luma = 0.3 * r + 0.59 * gr + 0.11 * b;
    const coloured = Math.min(1, Math.max(0, (max - min - 0.22) / 0.2)) * (r > b ? 1 : 0);   // warm, saturated = a lamp lens
    const paint = Math.min(1, Math.max(0, (luma - 0.30) / 0.10));                            // 0 = dark part, 1 = paint
    const base = 0.022 + paint * 0.91;                          // dark parts match the game's own glass: near-black
    color.data[i] = 255 * (base + (r * 0.9 - base) * coloured);
    color.data[i + 1] = 255 * (base + (gr * 0.9 - base) * coloured);
    color.data[i + 2] = 255 * (base + (b * 0.9 - base) * coloured);
    color.data[i + 3] = 255;
    // glTF convention: roughness lives in the green channel
    // ...and blue = metalness. Dark parts get the same mirror-like finish as the original glass (rough 0.06, metal 0.9).
    const glassy = (1 - paint) * (1 - coloured);
    rough.data[i] = 0; rough.data[i + 1] = 255 * (0.32 - glassy * 0.26); rough.data[i + 2] = 255 * (0.3 + glassy * 0.6); rough.data[i + 3] = 255;
    // Wheels: just grey levels (black rubber, silver rim), flattened a little.
    const level = luma < 0.3 ? 0.03 + luma * 0.2 : 0.35 + luma * 0.4;
    wheel.data[i] = wheel.data[i + 1] = wheel.data[i + 2] = 255 * level; wheel.data[i + 3] = 255;
  }
  const finish = (canvas, image, srgb) => {
    canvas.getContext('2d').putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;                               // same layout as the original glTF texture
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  return { color: finish(colorCanvas, color, true), roughness: finish(roughCanvas, rough, false), wheel: finish(wheelCanvas, wheel, true) };
}
