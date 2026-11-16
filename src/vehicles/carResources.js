// ---------------------------------------------------------------------------
// carResources.js — frees a car's 3D data when the car is thrown away.
//
// A car is made of geometries (shapes), materials (looks) and textures
// (pictures). They live in the graphics card's memory and are NOT freed just
// because the car left the scene: someone has to call dispose() on them.
// But many are shared — every car uses the same black trim, the same tyre
// rubber, the same lamp pattern — and those must stay while any car uses them.
//
// So this file counts users:
//   claimResources(root)     "a new car uses all of this"   (call when it is built)
//   releaseResources(root)   "that car is gone"             (call when it is removed)
// and a thing is disposed the moment its last user is gone.
//
// Changing car or previewing parts over and over therefore never piles up
// memory (see renderer.info.memory in the browser console to check).
// ---------------------------------------------------------------------------
const users = new Map();       // geometry / material / texture -> how many living cars use it
const TEXTURE_SLOTS = ['map', 'emissiveMap', 'normalMap', 'alphaMap', 'roughnessMap'];

// Everything a group of meshes is made of, each thing listed once.
function resourcesOf(root) {
  const found = new Set();
  root.traverse((object) => {
    if (object.geometry) found.add(object.geometry);
    for (const material of [].concat(object.material || [])) {
      found.add(material);
      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        // (a render target's picture - the rear-view mirror, the paint reflection - belongs to whoever draws it)
        if (texture && !texture.isRenderTargetTexture) found.add(texture);
      }
    }
  });
  return found;
}

export function claimResources(root) {
  for (const thing of resourcesOf(root)) users.set(thing, (users.get(thing) || 0) + 1);
}

export function releaseResources(root) {
  for (const thing of resourcesOf(root)) {
    const left = (users.get(thing) || 1) - 1;
    if (left > 0) { users.set(thing, left); continue; }
    users.delete(thing);
    thing.dispose();
  }
  root.traverse((object) => { if (object.isLight) object.dispose(); });      // (a light that casts shadows owns a shadow picture)
}
