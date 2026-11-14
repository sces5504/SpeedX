// ---------------------------------------------------------------------------
// carBuilder.js — builds a 3D car from a spec in carSpecs.js.
//
// The result is a "car object":
//   car.group        put this in the scene and move/rotate it
//   car.body         the shell; lean it for body roll and pitch
//   car.wheels[4]    FL, FR, RL, RR — each has .pivot (steer / suspension)
//                    and .spin (rolls). Every wheel is its own object.
//   car.lamps        the meshes that light up with each switch (each has its own material):
//                    head, tail, brake, reverse, signalL, signalR
//                    (lamps and grilles on the nose and tail: carEnds.js;
//                     body lines, mirrors and other fittings: carDetails.js)
//   car.setLights()  convenient switchboard for all of the above
//
// Local axes of a car: forward = -Z, right = +X, up = +Y. The origin is on the
// ground under the centre of gravity.
//
// If the car has a model.glb (see carModel.js) its body and wheels come from
// that model; otherwise a smooth shell (carShell.js) and wheels (carWheel.js)
// are generated from the measurements and side profile in car.json. Lamps, licence plates and the light switchboard are the same either way.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { lerp } from '../core/mathUtils.js';
import { beamMaterial, canvasTexture, enhanceMaterial, makeGlowTexture } from '../render/materials.js';
import { getCarModel } from './carModel.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { U, makeShell } from './carShell.js';
import { addBodyDetails, buildCargoBox, buildLamp } from './carDetails.js';
import { LAMP_COLOURS, buildEndParts, endParts } from './carEnds.js';
import { buildWheel } from './carWheel.js';
import { smallLights } from '../render/smallLights.js';
import { carReflection } from '../render/reflections.js';

// Bodywork lit by headlights from a few metres away would be far brighter than anything else
// in the picture and bloom into one huge white ball. This limit (see enhanceMaterial) lets it get
// just bright enough to glow a little (GRAPHICS.bloomThreshold is 1.25) and no further.
export const PAINT_LIMIT = 1.5;
const glowTexture = makeGlowTexture();
const lampSpot = new THREE.Vector3();
// Cone for the visible beam of ONE headlight: its narrow end is at the lamp (the origin) and
// it reaches 14 m forward (-Z).
const beamConeGeometry = new THREE.CylinderGeometry(0.07, 0.95, 14, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, -7);
const trimMat = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.7 }), { limit: PAINT_LIMIT });
const shellTrim = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.7, vertexColors: true }), { limit: PAINT_LIMIT });   // underside: shaded by the shell's vertex colours
const glassMat = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.06, metalness: 0.9, envMap: carReflection }), { limit: PAINT_LIMIT });
const archMat = new THREE.MeshBasicMaterial({ color: 0x020202 });
const poolTexture = makePoolTexture();
const shadowTexture = canvasTexture(64, 64, (g, w, h) => {
  const grad = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
}, { repeat: false });

export function buildCar(spec, colorHex) {
  const frontWeight = spec.frontWeight ?? 0.58;
  const a = spec.wheelbase * (1 - frontWeight);       // centre of gravity -> front axle
  const b = spec.wheelbase * frontWeight;             // centre of gravity -> rear axle
  const frontZ = -a - spec.frontOverhang;             // tip of the front bumper
  const rearZ = frontZ + spec.length;
  const model = getCarModel(spec.id);
  const halfW = model ? model.halfW : spec.width / 2;
  const dims = { a, b, frontZ, rearZ, halfW, halfTrack: halfW - 0.13 };

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // ---- Body: a real model if the car has one, otherwise the generated shell ----------
  let paint, partPaint, shell, surface = null;      // surface: where the generated skin is (carShell.js); a model has none
  if (model) {
    // White-painted models are tinted with the chosen colour (texture x colour).
    paint = model.material.clone();
    paint.color.set(colorHex);
    shell = new THREE.Mesh(model.body, paint);
  } else {
    // Metallic paint under a glossy clear coat. vertexColors: the shell is darker underneath (carShell.js).
    const paintLook = { roughness: 0.42, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.07, envMap: carReflection, envMapIntensity: 1.25 };
    const painted = (color, vertexColors) => enhanceMaterial(new THREE.MeshPhysicalMaterial({ color, ...paintLook, vertexColors }), { limit: PAINT_LIMIT });
    paint = painted(colorHex, true);
    partPaint = painted(colorHex, false);                    // for bolted-on parts (mirrors, wing, lamp pods), which have no shading of their own
    const lower = spec.twoTone !== undefined ? painted(spec.twoTone, true) : paint;
    const made = makeShell(spec, dims);
    surface = made.surface;
    shell = new THREE.Mesh(made.geometry, [paint, glassMat, shellTrim, lower]);
  }
  shell.castShadow = true;
  shell.name = 'body_shell';
  body.add(shell);
  const detailPaint = model ? new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.3 }) : partPaint;

  // Where is the surface of the nose (or tail) at a given spot? Lamps and plates sit there.
  // With the generated shell we know the shape; with a real model we shoot a ray at it (and if
  // the body is narrower than expected there, slide inward until the ray hits).
  const ray = new THREE.Raycaster();
  const where = (tail, x, y) => {
    if (surface) { const point = surface.onEnd(tail, Math.abs(x), y); point.x *= Math.sign(x) || 1; return point; }
    for (let tries = 0; tries < 8; tries++, x *= 0.93) {
      ray.set(new THREE.Vector3(x, y, tail ? rearZ + 2 : frontZ - 2), new THREE.Vector3(0, 0, tail ? -1 : 1));
      const hit = ray.intersectObject(shell)[0];
      if (hit) return hit.point;
    }
    return new THREE.Vector3(x, y, tail ? rearZ : frontZ);
  };
  const add = (mesh, x, y, z, parent = body) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
  const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);

  // ---- Lamps, grilles and the rest of the nose and tail ----------------------------------
  // lamps.<switch> = the meshes that light up with that switch.
  const lamps = { head: [], tail: [], brake: [], reverse: [], signalL: [], signalR: [], pods: [] };
  const glows = { head: [], tail: [] }, beams = [];
  const H = spec.headlights, T = spec.taillights;
  const thin = model ? 0.012 : 0.03;          // a real model has its lamps painted on: ours are then thin glowing covers
  const parts = endParts(spec, halfW);
  if (surface) {
    // Generated car: every part is laid on the skin (carEnds.js).
    const ends = buildEndParts(surface, parts);
    body.add(...ends.meshes);
    for (const name in ends.lamps) lamps[name].push(...ends.lamps[name]);
  } else {
    // Real model: only the lamps, as flat plates stuck on its nose and tail.
    for (const [list, tail] of [[parts.nose, false], [parts.tail, true]]) {
      for (const part of list.filter((p) => LAMP_COLOURS[p.is] !== undefined && p.box)) {
        const [from, to, bottom, top] = part.box;
        for (const side of [-1, 1]) {
          const at = where(tail, side * (from + to) / 2, (bottom + top) / 2);
          const lamp = add(buildLamp(to - from, top - bottom, LAMP_COLOURS[part.is], { facing: tail ? 1 : -1, depth: thin }), at.x, at.y, at.z + (tail ? -0.008 : 0.008));
          lamps[part.is === 'signal' ? (side < 0 ? 'signalL' : 'signalR') : part.is].push(lamp);
        }
      }
    }
  }
  const beamMat = beamMaterial(0xfff0d8, 0.3);
  for (const side of [-1, 1]) {
    // The spot the light of this headlight comes from: the middle of the fixed lamp, or a
    // pop-up pod on the bonnet with its own lamp ("popup": true).
    let source;
    if (H.popup) {
      const pod = new THREE.Group();
      pod.add(new THREE.Mesh(new RoundedBoxGeometry(H.w + 0.07, H.h + 0.05, 0.3, 2, 0.02), detailPaint));
      source = buildLamp(H.w, H.h, LAMP_COLOURS.head, { facing: -1, depth: thin });
      source.position.set(0, 0, -0.145);
      pod.add(source);
      const podZ = frontZ + spec.length * (H.z ?? 0.085);       // ("z": how far back the pods are, as a fraction of the length)
      pod.userData.upY = H.y + H.h / 2 + 0.01;
      pod.userData.downY = H.y - H.h / 2 - 0.06;
      if (surface) {
        // Shut, the lid lies in the bonnet: its front and rear edges just proud of it, tilted
        // along its slope. (Open, the lamp looks straight ahead.)
        const bonnet = (z) => surface.at(surface.tOf(z), U.centre - 2).y;
        const front = bonnet(podZ - 0.15), rear = bonnet(podZ + 0.15);
        pod.userData.downY = (front + rear) / 2 + 0.008 - (H.h + 0.05) / 2;
        pod.userData.downTilt = -Math.atan2(rear - front, 0.3);
      }
      pod.position.set(side * H.x * halfW, pod.userData.downY, podZ);
      pod.rotation.x = pod.userData.downTilt ?? 0;
      body.add(pod);
      lamps.pods.push(pod);
      lamps.head.push(source);
    } else {
      source = new THREE.Object3D();
      source.position.copy(where(false, side * H.x * halfW, H.y));
      body.add(source);
    }
    // The beam as a cone of lit air, starting AT the lamp (so it follows a pop-up lamp too).
    const cone = new THREE.Mesh(beamConeGeometry, beamMat);
    cone.scale.set(1.5, 0.6, 1);                              // wide and flat
    cone.rotation.x = -0.035;                                 // dipped toward the road
    cone.position.z = -thin;
    source.add(cone);
    beams.push(cone);
    // Soft flares so lamps are visible from far away
    const headGlow = flare(0xfff0d0, 1); source.add(headGlow); headGlow.position.z = -0.12; glows.head.push(headGlow);
    const tailGlow = flare(0xff2010, 0.5); body.add(tailGlow); tailGlow.position.copy(where(true, side * T.x * halfW, T.y)).z += 0.1; glows.tail.push(tailGlow);
  }

  // ---- Licence plates (each car gets its own random number) -----------------------
  // "plates": [front, rear] in car.json = their heights; otherwise under the nose and under the tail lamps.
  const plate = makePlate();
  const [plateFrontY, plateRearY] = spec.plates ?? [spec.stations[0][1] - 0.12, T.y - T.h - 0.1];
  const plateGeo = new THREE.PlaneGeometry(0.31, 0.155);
  for (const [tail, y] of [[false, plateFrontY], [true, plateRearY]]) {
    // A plate lies against the bodywork: tilted the way the nose or tail leans at that height.
    // (never flatter than about 35 degrees, or a plate on a low nose would sink into the bonnet)
    const upper = where(tail, 0, y + 0.07), lower = where(tail, 0, y - 0.07), out = tail ? 1 : -1;
    const lean = Math.min(0.1, Math.max(-0.1, upper.z - lower.z));
    const facing = new THREE.Vector3(0, lean * -out, 0.14 * out).normalize();
    const mesh = add(new THREE.Mesh(plateGeo, plate.material), 0, y, tail ? Math.max(upper.z, lower.z) - Math.abs(lean) / 2 : Math.min(upper.z, lower.z) + Math.abs(lean) / 2);
    mesh.position.addScaledVector(facing, 0.015);
    mesh.lookAt(mesh.position.clone().add(facing));
  }

  // ---- The details that make the generated shell a car (a real model already has them) -------
  if (surface) {
    const { repeaters } = addBodyDetails(body, surface, spec, dims, detailPaint);
    lamps.signalL.push(...repeaters.L); lamps.signalR.push(...repeaters.R);
    if (spec.spoiler) {
      // Rear wing.  "spoiler": 1.0  = a body-colour blade at that height on two posts.
      // "spoiler": { "height": 1.2, "gt": true }  = a racing wing: a wide black blade with end
      // plates on two tall stays ("back": metres from the tail, default 0.2).
      const wing = typeof spec.spoiler === 'number' ? { height: spec.spoiler } : spec.spoiler;
      const material = wing.gt ? trimMat : detailPaint, z = rearZ - (wing.back ?? 0.2);
      const deckY = surface.at(surface.tOf(z), U.centre).y, span = spec.width * (wing.gt ? 0.98 : 0.94);
      add(new THREE.Mesh(new RoundedBoxGeometry(span, 0.03, wing.gt ? 0.3 : 0.24, 2, 0.012), material), 0, wing.height, z).rotation.x = 0.07;
      for (const side of [-1, 1]) {
        add(box(wing.gt ? 0.02 : 0.035, wing.height - deckY, wing.gt ? 0.2 : 0.16, material), side * halfW * (wing.gt ? 0.4 : 0.72), (wing.height + deckY) / 2, z);
        if (wing.gt) add(box(0.015, 0.17, 0.34, material), side * span / 2, wing.height - 0.02, z);
      }
    }
    if (spec.skirts) {
      // Side skirts: a body-colour blade under each sill, from wheel arch to wheel arch.
      const reach = spec.wheelRadius + 0.1, length = spec.wheelbase - 2 * reach;
      for (const side of [-1, 1]) add(new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.1, length, 2, 0.02), detailPaint), side * (halfW - 0.03), spec.clearance + 0.03, (b - a) / 2);
    }
    if (spec.cargoBox) {
      const c = spec.cargoBox, length = (c.to - c.from) * spec.length;
      add(buildCargoBox(spec.width + 0.1, c.top - c.bottom, length), 0, (c.top + c.bottom) / 2, frontZ + (c.from + c.to) / 2 * spec.length);
    }
  }
  // Dark blob under the car so it sits on the road even without real shadows
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.width * 1.25, spec.length * 1.12),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.9 }));
  blob.rotation.x = -Math.PI / 2;
  add(blob, 0, 0.03, (frontZ + rearZ) / 2, group);

  // ---- Wheels (each one its own object so it can spin and steer) ---------------------
  const r = spec.wheelRadius, tyreWidth = r * 0.62;
  const wheelStyle = spec.role === 'hero' ? { spokes: 8, dark: false } : { spokes: 5, dark: true };   // bright racing rims / plain dark ones
  const wheels = [];
  ['FL', 'FR', 'RL', 'RR'].forEach((name, k) => {
    const side = k % 2 === 0 ? -1 : 1;
    const fromModel = model?.wheels[k];
    const z = fromModel ? fromModel.z : (k < 2 ? -a : b);
    const x = fromModel ? fromModel.x : side * (dims.halfTrack - tyreWidth * 0.1);
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.name = 'wheel_' + name;
    pivot.position.set(x, r, z);
    if (fromModel?.geometry) {
      const wheel = new THREE.Mesh(fromModel.geometry, model.wheelMaterial);   // cut out of the model
      wheel.castShadow = true;
      spin.add(wheel);
    } else {
      const wheel = buildWheel(r, tyreWidth, wheelStyle);
      wheel.scale.x = side;                                    // the pretty side faces outward
      spin.add(wheel);
    }
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ name, pivot, spin, side, z, restY: r });
    // black disc = the dark inner wall of the wheel arch
    const arch = new THREE.Mesh(new THREE.CircleGeometry(r + 0.075, 20), archMat);
    arch.rotation.y = side * Math.PI / 2;
    add(arch, model ? side * (halfW - r * 0.98) : side * (halfW * 0.5), r + 0.01, z);
  });

  // ---- Fake pool of light on the road (for AI cars without a real spotlight) -------
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 26), new THREE.MeshBasicMaterial({
    map: poolTexture, color: 0xfff0d2, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  add(pool, 0, 0.05, frontZ - 13.5, group);
  pool.visible = false;

  // Where the lamps' glow lands (left, right): low and a little way off, so it spills over the
  // road and the things around the car instead of flooding the car's own bodywork.
  const lampSpots = {
    head: [-1, 1].map((side) => new THREE.Vector3(side * H.x * halfW, 0.3, frontZ - 1.5)),
    tail: [-1, 1].map((side) => new THREE.Vector3(side * T.x * halfW, 0.15, rearZ + 1.5)),
  };
  const car = { spec, group, body, shell, wheels, lamps, glows, pool, dims, paint, plate, lightState: {} };
  // Change the body colour (AI cars are repainted when they are recycled).
  car.setColor = (hex) => { paint.color.set(hex); detailPaint.color.set(hex); };

  // ---- Light switchboard ----------------------------------------------------------
  // head: 0 off, 1 low beam, 2 high beam.   usePool: draw the fake light on the road.
  car.setLights = ({ head = 0, brake = false, reverse = false, left = false, right = false, usePool = false, poolFade = 1 }) => {
    const set = (list, value) => { for (const m of list) m.material.emissiveIntensity = value; };
    set(lamps.head, head === 0 ? 0 : head === 1 ? 6 : 10);
    set(lamps.tail, head > 0 ? 1.6 : 0);
    set(lamps.brake, brake ? 7 : head > 0 ? 1.0 : 0);
    set(lamps.reverse, reverse ? 4 : 0);
    set(lamps.signalL, left ? 5 : 0);
    set(lamps.signalR, right ? 5 : 0);
    for (const g of glows.head) { g.visible = head > 0; g.material.opacity = head === 2 ? 1 : 0.75; g.userData.gain = head === 2 ? 1.4 : 1; }
    for (const g of glows.tail) { g.visible = head > 0 || brake; g.material.opacity = brake ? 0.9 : 0.45; }
    for (const beam of beams) beam.visible = head > 0;
    beamMat.uniforms.uStrength.value = head === 2 ? 0.55 : 0.3;
    pool.visible = usePool && head > 0;
    pool.material.opacity = (head === 2 ? 0.34 : 0.2) * poolFade;
    Object.assign(car.lightState, { head, brake, left, right });
  };
  // Call every frame: raises/lowers pop-up headlights and sizes the flares by distance.
  car.updateLights = (dt, cameraPosition) => {
    for (const pod of lamps.pods) {
      const target = car.lightState.head > 0 ? pod.userData.upY : pod.userData.downY;
      pod.position.y = lerp(pod.position.y, target, Math.min(1, dt * 6));
      pod.rotation.x = (pod.userData.downTilt ?? 0) * (pod.userData.upY - pod.position.y) / (pod.userData.upY - pod.userData.downY);
    }
    const dx = cameraPosition.x - group.position.x, dz = cameraPosition.z - group.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    // A lamp only dazzles when it points at you: +1 = camera straight ahead of the car, -1 = behind it.
    const yaw = group.rotation.y, facing = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / dist;
    const front = Math.min(1, Math.max(0, facing * 2.5)), back = Math.min(1, Math.max(0, -facing * 2.5));
    // Far lamps would shrink to nothing; real ones stay visible as bright points, so grow with distance.
    const size = 0.3 + dist * 0.011;
    for (const g of glows.head) { g.scale.setScalar(size * 1.2 * (g.userData.gain || 1) * (0.3 + 0.7 * front)); g.material.opacity = front * (car.lightState.head === 2 ? 0.8 : 0.55); }
    for (const g of glows.tail) { g.scale.setScalar(size * 0.8); g.material.opacity = back * (car.lightState.brake ? 0.9 : 0.4); }
  };
  // Tell smallLights.js about this car's lamps, so they tint the road and whatever is near.
  // headShare: 0..1 how much of the headlight glow to add (0 when real spotlights do that job).
  car.addSmallLights = (camera, headShare = 1) => {
    const state = car.lightState;
    const offer = (list, hex, power) => {
      for (const spot of list) { lampSpot.copy(spot).applyMatrix4(group.matrixWorld); smallLights.add(lampSpot.x, lampSpot.y, lampSpot.z, hex, power, camera); }
    };
    if (state.head > 0) offer(lampSpots.head, 0xfff0d8, (state.head === 2 ? 150 : 60) * headShare);
    offer(lampSpots.tail, 0xff1a08, state.brake ? 6 : state.head > 0 ? 2.5 : 0);
    if (state.left) offer([lampSpots.tail[0]], 0xff8a00, 14);
    if (state.right) offer([lampSpots.tail[1]], 0xff8a00, 14);
  };
  car.setLights({ head: 0 });
  return car;
}

// ---------------------------------------------------------------------------
// Licence plate: a little canvas with a random California-style number.
// plate.setText() gives it a new number (used when an AI car is recycled).
// ---------------------------------------------------------------------------
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export function randomPlateText() {
  const letter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
  const digit = () => Math.floor(Math.random() * 10);
  return `${1 + Math.floor(Math.random() * 9)}${letter()}${letter()}${letter()}${digit()}${digit()}${digit()}`;
}
function makePlate() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const material = enhanceMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }), { retro: 1.2, limit: PAINT_LIMIT });
  const plate = {
    material, text: '',
    setText(text) {
      plate.text = text;
      const g = canvas.getContext('2d');
      g.fillStyle = '#f1f1ea'; g.fillRect(0, 0, 256, 128);
      g.strokeStyle = '#8a8a86'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 122);
      g.textAlign = 'center';
      g.fillStyle = '#c0282c'; g.font = 'italic bold 24px Georgia, serif'; g.fillText('California', 128, 30);
      g.fillStyle = '#1b2a6b'; g.font = 'bold 68px "Arial Narrow", Arial, sans-serif'; g.fillText(text, 128, 100);
      texture.needsUpdate = true;
    },
  };
  plate.setText(randomPlateText());
  return plate;
}

function flare(color, opacity) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.visible = false;
  return sprite;
}

function makePoolTexture() {
  return canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w / 2, h * 0.8, 0, w / 2, h * 0.8, h * 0.8);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(w / 2, 0); g.scale(0.5, 1); g.translate(-w / 2, 0);
    g.fillStyle = grad; g.fillRect(-w, 0, w * 3, h); g.restore();
  }, { repeat: false });
}
