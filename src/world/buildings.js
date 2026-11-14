// ---------------------------------------------------------------------------
// buildings.js — what the roadside things LOOK like: gas-station canopy with
// pumps, the store with its lit shop window, the tall price sign, street
// lamps, vending machines, concrete barriers and cones.
//
// They are part of the shared library (library.js lists them by name); pois.js
// decides WHERE they go. Every builder returns a THREE.Group whose
//     +X points away from the road, Z runs along it, Y is up, origin on the ground
// and says what it does in  group.userData:
//     lamps:  [{ at: Vector3, color, intensity, distance }]   strong lights (a few get real lights)
//     neons:  [{ at: Vector3, color, power }]                  coloured glow (see render/smallLights.js)
//     solids: [[x, z, across, along], ...]                     boxes you can crash into
//     interact: { type: 'fuel', label, at: Vector3, radius }  something to do there with E
// (all in the group's own coordinates; pois.js turns them into world positions.)
// How bright everything glows is GRAPHICS.buildingLights in config.js.
// The lighting style - coloured neon, not white floodlight - is explained at "Neon" below.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { beamMaterial, canvasTexture, enhanceMaterial, makeGlowTexture, makeNoiseNormalMap } from '../render/materials.js';
import { carReflection } from '../render/reflections.js';
import { GRAPHICS } from '../config.js';

const LEVEL = GRAPHICS.buildingLights;       // one dial for every sign, light panel and lamp in this file

const glowTexture = makeGlowTexture();
const roughNormal = makeNoiseNormalMap(128, 1.4, 11);
roughNormal.repeat.set(3, 3);
// enhanceMaterial() lets car lamps and neon tint these surfaces; the limit stops white walls
// right under a lamp from burning out.
const solid = (color, roughness = 0.8, metalness = 0, extra = {}) => enhanceMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }), { limit: 0.45 });
export const concrete = solid(0x8a8882, 0.92, 0, { normalMap: roughNormal, normalScale: new THREE.Vector2(0.5, 0.5) });
export const darkMetal = solid(0x26282b, 0.55, 0.6);
const whitePanel = solid(0xd9d9d5, 0.55, 0.1);
const wallPaint = solid(0x8b857a, 0.9, 0, { normalMap: roughNormal, normalScale: new THREE.Vector2(0.25, 0.25) });
const safetyYellow = solid(0xd9a514, 0.6);
const shopGlass = new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.28, envMap: carReflection });

// ---- Small building blocks ---------------------------------------------------
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function tube(radiusTop, radiusBottom, height, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}
// A surface that gives off light of its own (values above ~1.7 glow and streak on screen).
export function emissive(color, intensity) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity * LEVEL, roughness: 0.5 });
}
function glow(color, size, opacity = 0.8) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  sprite.scale.setScalar(size);
  return sprite;
}
const at = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- Neon: how buildings in this game are lit ------------------------------------------
// Not with white floodlight but with COLOUR, like a night scene in a film: a brand colour, an
// accent colour, and a tinted light under the roofs; warm orange against cool green-blue.
// Use these three helpers for any new building:
//   neon(color, w, h, d, x, y, z, brightness)   a glowing tube or panel (bright enough to bloom)
//   haze(color, size, x, y, z, opacity)         that colour hanging in the air round it
//   and list it under userData.neons so it tints the ground and the cars near it.
export const NEON = { accent: 0xffb000, light: 0x5cffc4 };     // amber tubes, mint-green light under a roof (the defaults)
// (Keep neon between about 2 and 3.5: brighter than that and the colour burns out toward white.)
const WARM = 0xffc27a;                                         // shop down-lights
export function neon(color, w, h, d, x, y, z, brightness = 2.8) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), emissive(color, brightness));
  mesh.position.set(x, y, z);
  return mesh;
}
export function haze(color, size, x, y, z, opacity = 0.3) {
  const sprite = glow(color, size, opacity * LEVEL);
  sprite.position.set(x, y, z);
  return sprite;
}
// Apply the brightness dial to the light a finished building throws on its surroundings.
function dimmed(group) {
  for (const lamp of group.userData.lamps || []) lamp.intensity *= LEVEL;
  for (const neon of group.userData.neons || []) neon.power *= LEVEL;
  return group;
}

// A flat lit sign with text on it. look: 'panel' = backlit plastic, 'neon' = glowing tubes on black.
export function signBoard(text, background, width, height, { doubleSided = false, glowAmount = 1.6, look = 'panel', ink = '#fff' } = {}) {
  const tex = canvasTexture(512, Math.max(16, Math.round((512 * height) / width)), (g, w, h) => {
    g.fillStyle = look === 'neon' ? '#000' : background; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = h * (look === 'neon' ? 0.62 : 0.56); g.font = `bold ${size}px Arial`;
    while (g.measureText(text).width > w * 0.88) { size -= 2; g.font = `bold ${size}px Arial`; }
    if (look === 'neon') {                               // bright core with a coloured halo, like a gas tube
      g.shadowColor = background; g.shadowBlur = h * 0.22; g.strokeStyle = background; g.lineWidth = h * 0.07;
      g.strokeText(text, w / 2, h / 2); g.strokeText(text, w / 2, h / 2);
      g.shadowBlur = 0; g.strokeStyle = '#fff'; g.lineWidth = h * 0.018; g.strokeText(text, w / 2, h / 2);
    } else {
      g.fillStyle = ink; g.fillText(text, w / 2, h / 2);
      const shade = g.createLinearGradient(0, 0, 0, h);   // the tubes behind the plastic are brighter in the middle
      shade.addColorStop(0, 'rgba(0,0,0,0.28)'); shade.addColorStop(0.5, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.28)');
      g.fillStyle = shade; g.fillRect(0, 0, w, h);
    }
  }, { repeat: false });
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glowAmount * LEVEL,
    roughness: 0.4, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide, transparent: look === 'neon', blending: look === 'neon' ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: look !== 'neon' });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}
// Put a sign on a wall that faces the road (-X).
const facingRoad = (sign, x, y, z) => { sign.position.set(x, y, z); sign.rotation.y = -Math.PI / 2; return sign; };

// ---- Gas-station canopy with two pump islands -----------------------------------------
// brand = the station's colour (red for fuel, green for the mart).
export function buildCanopy(brand, name, { accent = NEON.accent, light = NEON.light } = {}) {
  const g = new THREE.Group();
  const brandDark = solid(new THREE.Color(brand).multiplyScalar(0.55), 0.5, 0.2);
  g.add(box(8.6, 0.5, 13.6, whitePanel, 0, 5.05, 0));                                   // roof
  g.add(box(8.3, 0.06, 13.3, darkMetal, 0, 4.78, 0));                                   // underside
  // Neon all the way round the roof: a fat tube in the brand colour, a thin one in the accent colour under it.
  for (const [w, d, x, z] of [[0.05, 13.7, -4.33, 0], [0.05, 13.7, 4.33, 0], [8.7, 0.05, 0, -6.83], [8.7, 0.05, 0, 6.83]]) {
    g.add(neon(brand, w, 0.26, d, x, 5.1, z, 2.4));
    g.add(neon(accent, w, 0.05, d, x, 4.88, z, 3.2));
  }
  g.add(facingRoad(signBoard(name, '#' + new THREE.Color(brand).getHexString(), 3.2, 0.3, { glowAmount: 3 }), -4.37, 5.1, 0));
  // Six recessed light panels pour COLOURED light down on the pumps (the "light" colour), and the
  // air under the roof hangs in that colour like thin fog.
  for (const x of [-1.9, 1.9]) for (const z of [-4.2, 0, 4.2]) {
    g.add(box(1.25, 0.05, 1.25, darkMetal, x, 4.76, z));
    g.add(neon(light, 1.05, 0.04, 1.05, x, 4.74, z, 2.8));
  }
  const fog = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 5.2, 4.6, 24, 1, true), beamMaterial(light, 0.55 * LEVEL));
  fog.position.set(0, 2.4, 0); fog.scale.z = 1.55;
  g.add(fog, haze(light, 13, 0, 3.0, 0, 0.3));
  for (const [x, z] of [[-3, -5], [3, -5], [-3, 5], [3, 5]]) {                          // columns, each with a neon strip up its road side
    g.add(box(0.36, 4.8, 0.36, whitePanel, x, 2.4, z));
    g.add(box(0.5, 1.1, 0.5, brandDark, x, 0.55, z));
    g.add(neon(accent, 0.04, 3.3, 0.05, x - 0.2, 2.95, z, 3));
  }
  for (const z of [-6.9, 0, 6.9]) g.add(haze(brand, 7, -4.4, 5.1, z * 0.6, 0.4));           // the brand colour glowing in the air at the roof edge
  for (const z of [-3.2, 3.2]) {                                                        // pump islands
    g.add(box(1.3, 0.16, 3.6, concrete, 0, 0.08, z));
    for (const end of [-1.95, 1.95]) g.add(tube(0.075, 0.075, 1.0, safetyYellow, 0, 0.5, z + end));   // bollards
    for (const dz of [-0.9, 0.9]) g.add(buildPump(brand).translateZ(z + dz));
    g.add(tube(0.2, 0.17, 0.75, darkMetal, 0, 0.53, z));                                // bin between the pumps
  }
  g.userData.lamps = [{ at: at(0, 4.4, 0), color: light, intensity: 170, distance: 42 }];
  g.userData.neons = [{ at: at(-4.6, 4.9, -3), color: brand, power: 40 }, { at: at(-4.6, 4.9, 3), color: brand, power: 40 },
    { at: at(4.6, 4.9, 0), color: brand, power: 40 }, { at: at(-3.4, 2.6, -5), color: accent, power: 22 }, { at: at(-3.4, 2.6, 5), color: accent, power: 22 }];
  g.userData.solids = [[-3, -5, 0.5, 0.5], [3, -5, 0.5, 0.5], [-3, 5, 0.5, 0.5], [3, 5, 0.5, 0.5], [0, -3.2, 1.3, 3.9], [0, 3.2, 1.3, 3.9]];   // columns, pump islands
  g.userData.interact = { type: 'fuel', label: 'Refuel', at: at(0, 0, 0), radius: 7 };
  return dimmed(g);
}

function buildPump(brand) {
  const pump = new THREE.Group();
  pump.add(box(0.7, 1.45, 0.48, whitePanel, 0, 0.89, 0));                                // cabinet
  pump.add(box(0.74, 0.5, 0.52, darkMetal, 0, 0.41, 0));                                 // dark lower panel
  pump.add(neon(brand, 0.8, 0.3, 0.56, 0, 1.76, 0, 2.2));                                  // lit brand header
  for (const side of [-1, 1]) {
    pump.add(box(0.02, 0.24, 0.3, emissive(0xbfe6ff, 2.2), side * 0.36, 1.32, 0));       // screens, one per side
    pump.add(box(0.05, 0.42, 0.09, darkMetal, side * 0.38, 0.95, 0.15));                 // nozzle in its holster
    pump.add(tube(0.016, 0.016, 0.9, darkMetal, side * 0.4, 0.75, -0.14));               // hose
  }
  return pump;
}

// ---- Store: 8 m deep, 18 m long, shop window facing the road -------------------------------
export function buildStore(brand, name, isMart, { accent = NEON.accent } = {}) {
  const g = new THREE.Group();
  const cssBrand = '#' + new THREE.Color(brand).getHexString();
  // Back part is solid; the front 3 m is the shop floor you can see into.
  g.add(box(5, 4, 18, wallPaint, 1.5, 2, 0));
  for (const z of [-8.9, 8.9]) g.add(box(3, 4, 0.2, wallPaint, -2.5, 2, z));              // side walls of the shop floor
  g.add(box(3, 0.2, 18, wallPaint, -2.5, 3.9, 0));                                       // ceiling slab
  g.add(box(3, 0.08, 17.6, solid(0xb9b4a6, 0.4), -2.5, 0.04, 0));                        // shiny floor
  // Shelves full of products on the back wall, and strip lights on the ceiling.
  const shelves = new THREE.Mesh(new THREE.PlaneGeometry(17.6, 3.1), new THREE.MeshStandardMaterial({
    map: shelfTexture(), emissiveMap: shelfTexture(), emissive: 0xffffff, emissiveIntensity: 1.25 * LEVEL, roughness: 0.6 }));
  g.add(facingRoad(shelves, -0.98, 1.75, 0));
  for (const z of [-6, -2, 2, 6]) g.add(box(0.2, 0.05, 2.6, emissive(0xfff6e6, 5), -2.6, 3.76, z));
  // Shop front: low wall, glass, dark frames, a door, and the lit sign above.
  g.add(box(0.2, 0.5, 18, darkMetal, -3.95, 0.25, 0));
  g.add(box(0.06, 2.5, 17.8, shopGlass, -3.95, 1.75, 0));
  for (let z = -9; z <= 9.01; z += 2.25) g.add(box(0.12, 2.55, 0.09, darkMetal, -3.95, 1.75, z));
  g.add(box(0.14, 2.9, 1.9, darkMetal, -3.96, 1.45, 5.6));                               // door frame...
  g.add(box(0.16, 2.6, 1.6, shopGlass, -3.97, 1.4, 5.6));                                // ...and door
  g.add(box(0.3, 1.0, 18.2, darkMetal, -3.95, 3.5, 0));                                  // header above the glass
  g.add(facingRoad(signBoard(name + (isMart ? '  24H' : ''), cssBrand, 12, 0.85, { glowAmount: 3 }), -4.12, 3.5, -1));
  g.add(neon(accent, 0.06, 0.07, 18.4, -4.3, 4.02, 0, 3));                             // a line of neon along the roof edge
  g.add(haze(brand, 5, -4.6, 3.9, -1, 0.14), haze(0xff2a4a, 3, -4.2, 2.3, 7.4, 0.3));   // colour hanging in the air round the signs
  g.add(facingRoad(signBoard('OPEN', '#ff2a4a', 1.5, 0.6, { look: 'neon', glowAmount: 4 }), -3.85, 2.3, 7.4));
  if (isMart) g.add(facingRoad(signBoard('COLD DRINKS', '#27b7ff', 2.6, 0.5, { look: 'neon', glowAmount: 3.5 }), -3.85, 2.5, -6.6));
  // Roof edge, air-conditioning units, an awning over the pavement with down-lights.
  g.add(box(8.5, 0.5, 18.5, darkMetal, 0, 4.22, 0));
  for (const z of [-5, 3]) g.add(box(1.6, 0.9, 1.3, whitePanel, 1.6, 4.9, z));
  g.add(box(1.7, 0.12, 18.2, darkMetal, -4.9, 3.08, 0));
  for (const z of [-7, -3.5, 0, 3.5, 7]) g.add(neon(WARM, 0.3, 0.04, 0.3, -4.9, 3.01, z, 3.5));        // warm down-lights: orange against the canopy's cool light
  g.add(box(2.3, 0.14, 18.6, concrete, -5.1, 0.07, 0));                                   // pavement
  // An ice chest by the door.
  g.add(box(0.9, 1.5, 1.8, whitePanel, -4.55, 0.89, -7.6));
  g.add(facingRoad(signBoard('ICE', '#1c66d6', 1.4, 0.45, { glowAmount: 2 }), -5.01, 1.35, -7.6));

  g.userData.lamps = [{ at: at(-5.2, 2.9, 0), color: WARM, intensity: 120, distance: 32 }];
  g.userData.neons = [{ at: at(-4.6, 1.8, -4.5), color: 0xfff0d8, power: 34 }, { at: at(-4.6, 1.8, 4.5), color: 0xfff0d8, power: 34 },
    { at: at(-4.5, 3.5, -1), color: brand, power: 36 }, { at: at(-4.3, 2.3, 7.4), color: 0xff2a4a, power: 20 }, { at: at(-4.6, 4.0, 5), color: accent, power: 18 }];
  if (isMart) g.userData.neons.push({ at: at(-4.3, 2.5, -6.6), color: 0x27b7ff, power: 16 });
  g.userData.solids = [[0, 0, 8, 18]];
  return dimmed(g);
}

function shelfTexture() {
  return canvasTexture(1024, 192, (g, w, h) => {
    g.fillStyle = '#e9e2c8'; g.fillRect(0, 0, w, h);
    for (let y = 16; y < h - 12; y += 34) {                    // five shelves of colourful products
      g.fillStyle = '#6d675a'; g.fillRect(0, y + 26, w, 4);
      for (let x = 4; x < w; x += 9) {
        const tall = 14 + ((x * 13 + y * 7) % 11);
        g.fillStyle = `hsl(${(x * 37 + y * 11) % 360}, ${45 + ((x * 3) % 30)}%, ${38 + ((x * 7 + y) % 28)}%)`;
        g.fillRect(x, y + 26 - tall, 7, tall);
      }
    }
    g.fillStyle = '#d5d9dc';                                   // glass-door fridges at one end
    g.fillRect(w * 0.78, 6, w * 0.22, h - 12);
    g.fillStyle = '#20262b';
    for (let x = w * 0.78; x < w; x += w * 0.055) g.fillRect(x, 6, 5, h - 12);
  }, { repeat: false });
}

// ---- Tall price sign by the road -------------------------------------------------------
// title = the big word on top ("CREST").
export function buildPylon(brand, title) {  // (the sign's own colours come from `brand`)
  const g = new THREE.Group();
  const cssBrand = '#' + new THREE.Color(brand).getHexString();
  for (const z of [-1.2, 1.2]) g.add(tube(0.11, 0.14, 7.4, darkMetal, 0, 3.7, z));
  g.add(box(0.5, 3.3, 3.5, darkMetal, 0, 8.35, 0));
  const prices = canvasTexture(512, 480, (c, w, h) => {
    c.fillStyle = cssBrand; c.fillRect(0, 0, w, 130);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 84px Arial'; c.fillText(title, w / 2, 68, w - 30);
    c.fillStyle = '#0d0d0f'; c.fillRect(0, 130, w, h - 130);
    [['REGULAR', '3.89'], ['PLUS', '4.09'], ['DIESEL', '4.29']].forEach(([grade, price], k) => {
      const y = 190 + k * 112;
      c.fillStyle = '#d8d8d8'; c.font = 'bold 34px Arial'; c.textAlign = 'left'; c.fillText(grade, 26, y);
      c.fillStyle = k === 2 ? '#62ff8a' : '#ff5a3c'; c.font = 'bold 96px "Courier New", monospace'; c.textAlign = 'right'; c.fillText(price, w - 22, y + 6);
    });
  }, { repeat: false });
  const face = new THREE.MeshStandardMaterial({ map: prices, emissiveMap: prices, emissive: 0xffffff, emissiveIntensity: 2.0 * LEVEL, roughness: 0.4 });
  for (const side of [-1, 1]) {                       // readable from both directions of travel
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 3.1), face);
    plane.position.set(0, 8.35, side * 1.76); plane.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(plane);
  }
  // A frame of neon round the sign on both sides, and its colour glowing in the air.
  for (const side of [-1, 1]) {
    for (const y of [6.72, 9.98]) g.add(neon(brand, 3.5, 0.06, 0.05, 0, y, side * 1.78, 2.8));
    for (const x of [-1.7, 1.7]) g.add(neon(brand, 0.05, 3.3, 0.05, x, 8.35, side * 1.78, 2.8));
    g.add(haze(brand, 8, 0, 8.4, side * 2.0, 0.3));
  }
  g.userData.neons = [{ at: at(0, 8.3, 2.2), color: brand, power: 36 }, { at: at(0, 8.3, -2.2), color: brand, power: 36 }];
  g.userData.solids = [[0, 0, 0.5, 2.8]];
  return dimmed(g);
}

// ---- Street lamp: tapered pole, an arm reaching toward the road (-X), a visible cone of light ----
export function buildStreetLamp(color) {
  const g = new THREE.Group();
  g.add(box(0.3, 0.5, 0.3, darkMetal, 0, 0.25, 0));
  g.add(tube(0.06, 0.1, 7.6, darkMetal, 0, 4.3, 0));
  const arm = tube(0.04, 0.05, 1.9, darkMetal, -0.9, 8.18, 0);
  arm.rotation.z = Math.PI / 2 - 0.12;
  g.add(arm);
  const head = at(-1.85, 8.26, 0);                                        // where the light comes out
  g.add(box(0.7, 0.12, 0.3, darkMetal, head.x, head.y + 0.05, 0));
  g.add(box(0.52, 0.04, 0.2, emissive(color, 7), head.x, head.y - 0.03, 0));
  const flare = glow(color, 2.2, 0.8 * LEVEL); flare.position.copy(head).y -= 0.08;
  g.add(flare);
  // The cone of lit air under the lamp (clearer in mist and rain).
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 4.6, 8.0, 24, 1, true), beamMaterial(color, 0.5 * LEVEL));
  cone.position.set(head.x, head.y - 4.05, 0);
  g.add(cone);
  g.userData.lamps = [{ at: head.clone().setY(head.y - 0.3), color, intensity: 300, distance: 48 }];
  g.userData.solids = [[0, 0, 0.4, 0.4]];
  return dimmed(g);
}

// ---- Vending machine with a lit front (facing the road) ------------------------------------
export function buildVendingMachine(color) {
  const g = new THREE.Group();
  g.add(box(0.8, 1.9, 1.0, solid(color, 0.5, 0.2), 0, 0.95, 0));
  const front = canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#f4f6f8'; c.fillRect(0, 0, w, h);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {         // rows of cans
      c.fillStyle = `hsl(${(row * 67 + col * 29) % 360}, 70%, 50%)`;
      c.fillRect(10 + col * 22, 14 + row * 34, 16, 26);
    }
    c.fillStyle = '#' + new THREE.Color(color).getHexString(); c.fillRect(0, h - 70, w, 70);
    c.fillStyle = '#111'; c.fillRect(w - 34, h - 58, 22, 30);
  }, { repeat: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.7), new THREE.MeshStandardMaterial({ map: front, emissiveMap: front, emissive: 0xffffff, emissiveIntensity: 2.2 * LEVEL, roughness: 0.3 }));
  g.add(facingRoad(face, -0.41, 1.0, 0));
  g.userData.neons = [{ at: at(-0.9, 1.1, 0), color, power: 12 }];
  g.userData.solids = [[0, 0, 0.8, 1.0]];
  return dimmed(g);
}

// ---- Concrete "Jersey" barrier, 2.8 m long (runs along Z) --------------------------------
const barrierGeometry = (() => {
  const outline = [[-0.3, 0], [-0.3, 0.08], [-0.17, 0.3], [-0.1, 0.78], [0.1, 0.78], [0.17, 0.3], [0.3, 0.08], [0.3, 0]];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: 2.8, bevelEnabled: false }).translate(0, 0, -1.4);
})();
export function buildBarrier() {
  const mesh = new THREE.Mesh(barrierGeometry, concrete);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// ---- Traffic cone with a reflective white collar -------------------------------------------
const coneOrange = solid(0xff5a12, 0.6, 0, { emissive: 0xff5a12, emissiveIntensity: 0.25 });
const coneCollar = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }), { retro: 2.5 });
export function buildCone() {
  const g = new THREE.Group();
  const spin = (points, material) => new THREE.Mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), 14), material);
  g.add(spin([[0.2, 0.04], [0.055, 0.7], [0, 0.71]], coneOrange));
  g.add(spin([[0.158, 0.27], [0.114, 0.47]], coneCollar));
  g.add(box(0.5, 0.04, 0.5, darkMetal, 0, 0.02, 0));
  return g;
}

// ---- Turnout: a wooden-looking information board ------------------------------------------
export function buildInfoBoard(name) {
  const g = new THREE.Group();
  const wood = solid(0x4a3524, 0.9);
  g.add(box(0.14, 2.3, 0.14, wood, -1.3, 1.15, 0), box(0.14, 2.3, 0.14, wood, 1.3, 1.15, 0), box(3.0, 0.1, 0.5, wood, 0, 2.42, 0));
  const sign = signBoard(name, '#3b2a17', 2.5, 1.0, { glowAmount: 0.5 });
  sign.position.set(0, 1.8, 0.08);
  g.add(sign, box(2.6, 1.1, 0.06, wood, 0, 1.8, 0));
  g.userData.solids = [[0, 0, 2.6, 0.3]];
  return g;
}
