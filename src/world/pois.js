// ---------------------------------------------------------------------------
// pois.js — "places of interest" beside the road: a gas station, a mini-mart,
// two turnouts and the road-closed barriers at both ends.
//
// Buildings, lamps, barriers and cones use models from the props library
// (public/content/props/) when they exist, otherwise simple boxes. Glowing
// (emissive) panels and signs are always added on top.
// Positions are given as (along, out):
//   along = metres further up the road from the middle of the lot
//   out   = metres away from the centre line, into the lot
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { ROAD } from '../config.js';
import { canvasTexture, enhanceMaterial, makeGlowTexture } from '../render/materials.js';
import { getProp, makeProp, propTip } from './props.js';

const glowTexture = makeGlowTexture();
const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 0.9 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6, metalness: 0.5 });
const whitePanel = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.7 });

export function buildPois(map) {
  const group = new THREE.Group();
  group.name = 'pois';
  const lamps = [];          // places where a real light should shine: { position, color, intensity }
  const interactables = [];  // places where pressing E does something
  const parking = [];        // spots where parked cars can be placed: { x, y, z, yaw }
  const obstacles = [];      // solid things you can crash into: { x, z, yaw, halfWidth, front, rear }
  // Make a box-shaped part of a placed object solid. (lx, lz) = its centre inside the object,
  // w = size across (X), d = size along (Z).
  const solid = (object, lx, lz, w, d) => {
    object.updateMatrixWorld(true);
    const p = object.localToWorld(new THREE.Vector3(lx, 0, lz));
    obstacles.push({ x: p.x, z: p.z, yaw: object.rotation.y, halfWidth: w / 2, front: d / 2, rear: d / 2 });
  };

  for (const poi of map.pois) {
    // Helper that puts an object at (along, out) inside this lot.
    const place = (object, along, out, y = 0, turn = 0) => {
      const p = map.pointAt(poi.s + along, out * poi.side);
      object.position.set(p.x, p.y + y, p.z);
      object.rotation.y = p.yaw + (poi.side > 0 ? 0 : Math.PI) + turn;
      group.add(object);
      return object;
    };
    const spot = (along, out, y) => { const p = map.pointAt(poi.s + along, out * poi.side); return new THREE.Vector3(p.x, p.y + y, p.z); };
    const half = poi.length / 2;

    // A row of concrete blocks marks the back edge of every lot.
    for (let a = -half; a <= half; a += 3.4) {
      const block = makeProp('barrier');
      if (block) place(block, a, poi.depth + 0.9, 0, getProp('barrier').size.x > getProp('barrier').size.z ? Math.PI / 2 : 0);
      else place(box(2.8, 0.7, 0.5, concrete), a, poi.depth + 0.9, 0.35, Math.PI / 2);
    }

    if (poi.type === 'gas' || poi.type === 'mart') {
      const isMart = poi.type === 'mart';
      // --- pump canopy ---
      const canopy = new THREE.Group();
      const canopyModel = makeProp('gas-canopy');
      if (canopyModel) {
        // Real model: long side along the road, plus our own glowing light panels under the roof.
        const size = getProp('gas-canopy').size;
        if (size.x > size.z) canopyModel.rotation.y = Math.PI / 2;
        canopy.add(canopyModel);
        canopy.add(box(Math.min(size.x, size.z) * 0.55, 0.05, Math.max(size.x, size.z) * 0.6, emissive(0xf4f8ff, 3.2), 0, size.y * 0.8, 0));
      } else {
        canopy.add(box(8, 0.5, 13, whitePanel, 0, 5.0, 0));
        canopy.add(box(8.1, 0.22, 13.1, emissive(isMart ? 0x18a064 : 0xc02020, 1.6), 0, 4.9, 0));          // coloured band
        canopy.add(box(6.4, 0.05, 11, emissive(0xf4f8ff, 3.2), 0, 4.73, 0));                              // light panels underneath
        for (const [x, z] of [[-3, -5], [3, -5], [-3, 5], [3, 5]]) canopy.add(box(0.35, 4.8, 0.35, whitePanel, x, 2.4, z));
        for (const z of [-3.2, 3.2]) {                                                                   // pump islands
          canopy.add(box(1.2, 0.18, 3.4, concrete, 0, 0.09, z));
          for (const dz of [-0.9, 0.9]) {
            canopy.add(box(0.7, 1.7, 0.5, darkMetal, 0, 1.0, z + dz));
            canopy.add(box(0.72, 0.4, 0.3, emissive(0xbfe6ff, 1.4), 0, 1.45, z + dz));
          }
        }
      }
      place(canopy, -8, 15);
      for (const [x, z] of [[-3, -5], [3, -5], [-3, 5], [3, 5]]) solid(canopy, x, z, 0.5, 0.5);    // the four columns
      for (const z of [-3.2, 3.2]) solid(canopy, 0, z, 1.3, 3.5);                                   // pump islands
      lamps.push({ poi, position: spot(-8, 15, 4.4), color: 0xeaf2ff, intensity: 260, distance: 45 });
      interactables.push({ type: 'fuel', label: 'Refuel', position: spot(-8, 15, 0), radius: 7 });

      // --- store building ---
      const store = new THREE.Group();
      const storeModel = makeProp('store');
      if (storeModel) {
        const size = getProp('store').size;
        if (size.x > size.z) storeModel.rotation.y = Math.PI / 2;      // long side along the road
        storeModel.scale.setScalar(18 / Math.max(size.x, size.z));      // 18 m shop front
        store.add(storeModel);
      } else {
        store.add(box(8, 4, 18, new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.9 }), 0, 2, 0));
        store.add(box(8.6, 0.5, 18.4, darkMetal, 0, 4.2, 0));
        const front = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshStandardMaterial({
          map: storeWindowTexture(), emissiveMap: storeWindowTexture(), emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.2 }));
        front.position.set(-4.01, 1.6, 0); front.rotation.y = -Math.PI / 2;
        store.add(front);
      }
      const sign = signBoard(poi.name.toUpperCase() + (isMart ? '  24H' : ''), isMart ? '#0f8a55' : '#b01818', 12, 1.2);
      sign.position.set(-4.3, 4.3, 0); sign.rotation.y = -Math.PI / 2;
      store.add(sign);
      place(store, 16, poi.depth - 5);
      solid(store, 0, 0, 8, 18);
      lamps.push({ poi, position: spot(16, poi.depth - 11.5, 3.2), color: 0xfff0d0, intensity: 150, distance: 35 });
      if (isMart) {                                          // vending machines by the door
        for (const [k, color] of [[0, 0x2a66ff], [1, 0xff3b30]]) {
          const machine = new THREE.Group();
          machine.add(box(1.0, 1.9, 0.8, darkMetal, 0, 0.95, 0));
          machine.add(box(0.85, 1.3, 0.05, emissive(color, 1.8), 0, 1.1, -0.41));
          solid(place(machine, 27 + k * 1.3, poi.depth - 9.6), 0, 0, 1.0, 0.8);
        }
      }

      // --- tall price sign near the road, visible from far away ---
      const pylon = new THREE.Group();
      pylon.add(box(0.4, 9, 0.4, darkMetal, 0, 4.5, 0));
      const price = signBoard(isMart ? 'MART  ·  FUEL' : 'CREST  3.89⁹', isMart ? '#0f8a55' : '#b01818', 3.4, 1.9, true);
      price.position.set(0, 8.2, 0);
      pylon.add(price);
      solid(place(pylon, -half + 6, ROAD.barrierOffset + 3.5), 0, 0, 0.5, 0.5);

      for (const a of [-half + 4, half - 4]) lamps.push(streetLamp(place, a, ROAD.barrierOffset + 2.6, poi, 0xfff1d6, solid));
      for (let k = 0; k < 4; k++) {                          // parking bays in front of the store
        const p = map.pointAt(poi.s + 9.5 + k * 3.4, (poi.depth - 12.5) * poi.side);
        parking.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw + (poi.side > 0 ? -Math.PI / 2 : Math.PI / 2), poi });
      }
    } else {
      // --- turnout: one sodium lamp, an info board, room for racers to meet ---
      lamps.push(streetLamp(place, 0, poi.depth - 1, poi, 0xffa040, solid));
      const board = new THREE.Group();
      board.add(box(0.12, 2.2, 0.12, darkMetal, -1.2, 1.1, 0), box(0.12, 2.2, 0.12, darkMetal, 1.2, 1.1, 0));
      board.add(signBoard(poi.name.toUpperCase(), '#3b2a17', 2.6, 1.0, false, 0.5));
      board.children[2].position.set(0, 1.9, 0);
      solid(place(board, 14, poi.depth - 1.5, 0, -Math.PI / 2), 0, 0, 2.6, 0.3);
      for (let k = 0; k < 3; k++) {
        const p = map.pointAt(poi.s - 22 + k * 7, (poi.depth - 4.5) * poi.side);
        parking.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw + 0.25 * poi.side, poi });
      }
    }
    // Every lot has a time-attack start cone you can interact with.
    const cone = new THREE.Group();
    const coneModel = makeProp('cone');
    if (coneModel) cone.add(coneModel);
    else {
      cone.add(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 10), emissive(0xff5a12, 0.9)).translateY(0.35));
      cone.add(box(0.5, 0.04, 0.5, darkMetal, 0, 0.02, 0));
    }
    place(cone, -half + 14, ROAD.barrierOffset + 1.2);
    interactables.push({ type: 'challenge', label: 'Start time attack', position: spot(-half + 14, ROAD.barrierOffset + 1.2, 0), radius: 6, poi });
  }

  // ---- Road closed barriers at both ends --------------------------------------
  const stripes = canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e2571a';
    for (let x = -h; x < w; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 16, 0); g.lineTo(x + 16, h); g.fill(); }
  });
  const stripeMat = enhanceMaterial(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5 }), { retro: 3 });
  for (const s of [5, map.road.length - 5]) {
    for (const d of [-4, 0, 4]) {
      const p = map.pointAt(s, d);
      const barrier = new THREE.Group();
      for (const y of [0.55, 1.0, 1.45]) barrier.add(box(3.0, 0.24, 0.05, stripeMat, 0, y, 0));
      barrier.add(box(0.08, 1.6, 0.5, darkMetal, -1.3, 0.8, 0), box(0.08, 1.6, 0.5, darkMetal, 1.3, 0.8, 0));
      barrier.position.set(p.x, p.y, p.z); barrier.rotation.y = p.yaw;
      group.add(barrier);
    }
  }
  return { group, lamps, interactables, parking, obstacles };
}

// ---- Small building blocks ---------------------------------------------------
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function emissive(color, intensity) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.5 });
}
function glow(color, size) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
  sprite.scale.setScalar(size);
  return sprite;
}
function streetLamp(place, along, out, poi, color, solid) {
  const lamp = new THREE.Group();
  let head = new THREE.Vector3(-1.6, 7.86, 0);                 // where the light comes out
  const model = makeProp('streetlight');
  if (model) {
    const tip = propTip('streetlight');
    model.rotation.y = Math.atan2(tip.z, tip.x) - Math.PI;     // turn the arm toward the road (-X)
    lamp.add(model);
    head = new THREE.Vector3(-Math.hypot(tip.x, tip.z) + 0.25, tip.y - 0.12, 0);
  } else {
    lamp.add(box(0.16, 8, 0.16, darkMetal, 0, 4, 0), box(1.8, 0.1, 0.12, darkMetal, -0.9, 7.95, 0));
  }
  lamp.add(box(0.55, 0.06, 0.24, emissive(color, 6), head.x, head.y, head.z));
  const flare = glow(color, 3.2); flare.position.copy(head).y -= 0.06;
  lamp.add(flare);
  place(lamp, along, out);
  solid(lamp, 0, 0, 0.4, 0.4);                                  // the pole
  const position = lamp.localToWorld(head.clone().setY(head.y - 0.3));
  return { poi, position, color, intensity: 320, distance: 50 };
}
function signBoard(text, background, width, height, doubleSided = false, glowAmount = 1.6) {
  const tex = canvasTexture(512, Math.round((512 * height) / width), (g, w, h) => {
    g.fillStyle = background; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = h * 0.56; g.font = `bold ${size}px Arial`;
    while (g.measureText(text).width > w * 0.9) { size -= 2; g.font = `bold ${size}px Arial`; }
    g.fillText(text, w / 2, h / 2);
  }, { repeat: false });
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glowAmount,
    roughness: 0.4, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}
function storeWindowTexture() {
  return canvasTexture(512, 96, (g, w, h) => {
    g.fillStyle = '#e9e2c8'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 6) {                         // shelves full of colourful products
      for (let y = 14; y < h - 8; y += 16) {
        g.fillStyle = `hsl(${(x * 37 + y * 11) % 360}, 55%, ${40 + ((x * 7) % 25)}%)`;
        g.fillRect(x, y, 5, 11);
      }
    }
    g.fillStyle = '#1b1b1b';
    for (let x = 0; x <= w; x += 102) g.fillRect(x - 3, 0, 6, h);   // window frames
    g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
  }, { repeat: false });
}
