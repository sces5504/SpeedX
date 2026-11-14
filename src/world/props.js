// ---------------------------------------------------------------------------
// props.js — loads the MODEL FILES of the shared library: 3D models of trees,
// rocks, poles, buildings... (The library also has built-in things made by
// code; library.js lists both kinds and is what the map builders ask.)
//
// A prop is a folder  public/content/props/<id>/model.glb  listed in
// public/content/props/index.json with its real height in metres. At load time
// each model is merged into one mesh, stood on the ground, centred, and scaled
// to that height. If a prop is missing, the built-in thing of the same name is
// used, so deleting a prop folder never breaks a map.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { flattenGltf } from '../vehicles/carModel.js';

const cache = new Map();

export const getProp = (id) => cache.get(id) || null;

export async function loadProps() {
  let index;
  try { index = await (await fetch('content/props/index.json')).json(); } catch { return; }
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(index.props).map(async ([id, info]) => {
    try {
      const gltf = await loader.loadAsync(`content/props/${id}/model.glb`);
      const { geometry, material } = flattenGltf(gltf.scene);
      if (info.yaw) geometry.rotateY(THREE.MathUtils.degToRad(info.yaw));
      geometry.computeBoundingBox();
      const box = geometry.boundingBox, scale = info.height / (box.max.y - box.min.y);
      geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      geometry.scale(scale, scale, scale);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      // Simple, matte look to match the rest of the game: the AI texture is shrunk until
      // only its broad colours are left (no fake dirt, highlights or noisy detail).
      const clean = new THREE.MeshStandardMaterial({ map: simplifyTexture(material.map, info.detail || 48), roughness: 0.92, metalness: 0 });
      cache.set(id, { id, geometry, material: clean, size: geometry.boundingBox.getSize(new THREE.Vector3()), info });
    } catch (error) {
      console.warn(`Prop "${id}" could not be loaded (a simple shape will be used instead):`, error);
    }
  }));
}

// One copy of a prop as a normal mesh, or null if the prop is not available.
export function makeProp(id) {
  const prop = getProp(id);
  if (!prop) return null;
  const mesh = new THREE.Mesh(prop.geometry, prop.material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// The point of a prop that is highest and furthest out sideways — for a street
// light that is the lamp head. Returned in the prop's own coordinates.
export function propTip(id) {
  const prop = getProp(id);
  if (!prop) return null;
  const pos = prop.geometry.attributes.position, top = prop.size.y;
  const tip = new THREE.Vector3(0, top, 0);
  let best = -1;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < top * 0.9) continue;
    const reach = Math.hypot(pos.getX(i), pos.getZ(i));
    if (reach > best) { best = reach; tip.set(pos.getX(i), pos.getY(i), pos.getZ(i)); }
  }
  return tip;
}

// Shrink a texture to `size` pixels across: fine detail disappears, flat areas of colour stay.
function simplifyTexture(texture, size) {
  if (!texture?.image) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(texture.image, 0, 0, size, size);
  const simple = new THREE.CanvasTexture(canvas);
  simple.flipY = false;                       // same layout as the glTF original
  simple.colorSpace = THREE.SRGBColorSpace;
  return simple;
}
