// ---------------------------------------------------------------------------
// carBuilder.js — builds a 3D car from a spec in carSpecs.js.
//
// The result is a "car object":
//   car.group        put this in the scene and move/rotate it
//   car.body         the shell; lean it for body roll and pitch
//   car.wheels[4]    FL, FR, RL, RR — each has .pivot (steer / suspension)
//                    and .spin (rolls). Every wheel is its own object.
//   car.lamps        every lamp is its own mesh with its own material:
//                    head[2], tail[2], brake[2], reverse[2], signalL[3], signalR[3]
//                    (lenses, body lines, mirrors and other fittings: carDetails.js)
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
import { shellGeometry, shellSurface } from './carShell.js';
import { addBodyDetails, buildLamp, chrome, plateGeometry, rubber } from './carDetails.js';
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
// The red strip between the tail lamps of some cars: it shines back at headlights like a reflector.
const reflectorRed = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.15, envMap: carReflection }), { retro: 0.5, limit: PAINT_LIMIT });
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
  let paint, partPaint, shell;
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
    shell = new THREE.Mesh(shellGeometry(spec, dims), [paint, glassMat, shellTrim, lower]);
  }
  shell.castShadow = true;
  shell.name = 'body_shell';
  body.add(shell);
  const detailPaint = model ? new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.3 }) : partPaint;

  // Where is the surface of the nose (or tail) at a given spot? Lamps and plates sit there.
  // With a real model we shoot a ray at it; with the shell we know the shape.
  const ray = new THREE.Raycaster();
  const zAtHeight = (y, fromRear = false, x = 0) => {
    if (!model) return bodyEndZ(spec, dims, y, fromRear);
    ray.set(new THREE.Vector3(x, y, fromRear ? rearZ + 2 : frontZ - 2), new THREE.Vector3(0, 0, fromRear ? -1 : 1));
    const hit = ray.intersectObject(shell)[0];
    return hit ? hit.point.z : (fromRear ? rearZ : frontZ);
  };
  // A lamp must sit ON the body. If the body is narrower than expected at that height the
  // ray misses, so slide inward until it hits. Returns the x to use.
  const seatX = (x, y, fromRear) => {
    if (!model) return x;
    for (let tries = 0; tries < 8; tries++, x *= 0.93) {
      ray.set(new THREE.Vector3(x, y, fromRear ? rearZ + 2 : frontZ - 2), new THREE.Vector3(0, 0, fromRear ? -1 : 1));
      if (ray.intersectObject(shell).length) break;
    }
    return x;
  };
  const add = (mesh, x, y, z, parent = body) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
  const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);

  // ---- Lamps (each one its own mesh and material, so each can be lit alone) -------------
  const lamps = { head: [], tail: [], brake: [], reverse: [], signalL: [], signalR: [], pods: [] };
  const glows = { head: [], tail: [] };
  const H = spec.headlights, T = spec.taillights;
  const RED = 0xff1505, AMBER = 0xff8a00;
  const thin = model ? 0.012 : 0.03;          // a real model has its lamps painted on: ours are then thin glowing covers
  const beamMat = beamMaterial(0xfff0d8, 0.3);
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'L' : 'R';
    // Headlight — fixed in the nose, or a pop-up pod on the bonnet
    const head = buildLamp(H.w, H.h, 0xfff2d8, { facing: -1, depth: thin });
    head.name = 'light_head_' + name;
    if (H.popup) {
      const pod = new THREE.Group();
      const podZ = frontZ + spec.length * 0.085;
      pod.add(new THREE.Mesh(new RoundedBoxGeometry(H.w + 0.07, H.h + 0.05, 0.3, 2, 0.02), detailPaint));
      head.position.set(0, 0, -0.145);
      pod.add(head);
      pod.userData.upY = H.y + H.h / 2 + 0.01;
      pod.userData.downY = H.y - H.h / 2 - 0.06;
      pod.position.set(side * H.x * halfW, pod.userData.downY, podZ);
      body.add(pod);
      lamps.pods.push(pod);
    } else {
      const hx = seatX(side * H.x * halfW, H.y, false);
      add(head, hx, H.y, zAtHeight(H.y, false, hx) + 0.008);
    }
    lamps.head.push(head);
    // The beam as a cone of lit air, starting AT this lamp (so it follows a pop-up lamp too).
    const cone = new THREE.Mesh(beamConeGeometry, beamMat);
    cone.scale.set(1.5, 0.6, 1);                              // wide and flat
    cone.rotation.x = -0.035;                                 // dipped toward the road
    cone.position.z = -thin;
    cone.name = 'beam';
    head.add(cone);

    // Rear cluster, from the outside in: amber indicator, tail lamp, brake lamp; a small white
    // reversing lamp underneath. "style": "round" in car.json gives three round lamps instead.
    const rear = (lamp, x, y) => { const sx = seatX(side * x, y, true); return add(lamp, sx, y, zAtHeight(y, true, sx) - 0.008); };
    const outer = T.x * halfW + T.w / 2;                      // outer edge of the cluster
    let tail, brake, sigRear;
    if (T.style === 'round') {
      const d = Math.min(T.h * 1.3, (T.w - 0.05) / 3), step = d + 0.025;
      tail = rear(buildLamp(d, d, RED, { round: true, depth: thin }), outer - d / 2, T.y);
      brake = rear(buildLamp(d, d, RED, { round: true, depth: thin }), outer - d / 2 - step, T.y);
      sigRear = rear(buildLamp(d * 0.8, d * 0.8, AMBER, { round: true, depth: thin }), outer - d / 2 - step * 2 + d * 0.1, T.y);
    } else if (T.h > T.w) {                                   // a tall cluster (vans, SUVs): stacked instead
      const x = T.x * halfW, top = T.y + T.h / 2;
      tail = rear(buildLamp(T.w, T.h * 0.44, RED, { depth: thin }), x, top - T.h * 0.22);
      brake = rear(buildLamp(T.w, T.h * 0.3, RED, { depth: thin }), x, top - T.h * 0.61);
      sigRear = rear(buildLamp(T.w, T.h * 0.2, AMBER, { depth: thin }), x, top - T.h * 0.9);
    } else {
      const wSignal = T.w * 0.17, wTail = T.w * 0.42, wBrake = T.w * 0.35, space = T.w * 0.03;
      sigRear = rear(buildLamp(wSignal, T.h, AMBER, { depth: thin }), outer - wSignal / 2, T.y);
      tail = rear(buildLamp(wTail, T.h, RED, { depth: thin }), outer - wSignal - space - wTail / 2, T.y);
      brake = rear(buildLamp(wBrake, T.h, RED, { depth: thin }), outer - wSignal - wTail - space * 2 - wBrake / 2, T.y);
    }
    const reverse = rear(buildLamp(0.1, 0.045, 0xffffff, { depth: thin * 0.6 }), T.x * halfW - T.w * 0.25, T.y - T.h / 2 - 0.05);
    tail.name = 'light_tail_' + name; brake.name = 'light_brake_' + name; reverse.name = 'light_reverse_' + name;
    lamps.tail.push(tail); lamps.brake.push(brake); lamps.reverse.push(reverse);
    const noseSignalY = spec.stations[0][1] - 0.04, sfx = seatX(side * halfW * 0.8, noseSignalY, false);
    const sigFront = add(buildLamp(0.14, 0.05, AMBER, { facing: -1, depth: thin * 0.6 }), sfx, noseSignalY, zAtHeight(noseSignalY, false, sfx) + 0.006);
    sigFront.name = 'light_signal_front_' + name; sigRear.name = 'light_signal_rear_' + name;
    (side < 0 ? lamps.signalL : lamps.signalR).push(sigFront, sigRear);

    // Soft flares so lamps are visible from far away
    const headGlow = flare(0xfff0d0, 1); head.add(headGlow); headGlow.position.z = -0.12; glows.head.push(headGlow);
    const tailGlow = flare(0xff2010, 0.5); tail.add(tailGlow); tailGlow.position.z = 0.1; glows.tail.push(tailGlow);
  }
  // A panel between the two rear clusters ("garnish": "red" = a reflector strip, "black" = plain).
  if (T.garnish && !model) {
    const width = 2 * (T.x * halfW - T.w / 2) - 0.03;
    const panel = new THREE.Mesh(plateGeometry(width, T.h + 0.024, 0.022, 0.02), T.garnish === 'red' ? reflectorRed : rubber);
    add(panel, 0, T.y, zAtHeight(T.y, true) - 0.008);
  }

  // ---- Licence plates (each car gets its own random number) -----------------------
  const plate = makePlate();
  const noseY = spec.stations[0][1], plateRearY = T.y - T.h - 0.1;
  const plateGeo = new THREE.PlaneGeometry(0.31, 0.155);
  const frontPlate = add(new THREE.Mesh(plateGeo, plate.material), 0, noseY - 0.12, zAtHeight(noseY - 0.12) - 0.015);
  frontPlate.rotation.y = Math.PI;                              // faces forward
  add(new THREE.Mesh(plateGeo, plate.material), 0, plateRearY, zAtHeight(plateRearY, true) + 0.015);

  // ---- The details that make the generated shell a car (a real model already has them) -------
  if (!model) {
    const { repeaters } = addBodyDetails(body, shellSurface(spec, dims), spec, dims, detailPaint);
    lamps.signalL.push(...repeaters.L); lamps.signalR.push(...repeaters.R);
    if (spec.grille) {
      // A radiator grille between the headlights: chrome frame, dark inside, chrome bars.
      const width = 2 * (H.x * halfW - H.w / 2) - 0.05, z = zAtHeight(H.y) + 0.006;
      const frame = (w, h, depth, material) => add(new THREE.Mesh(plateGeometry(w, h, depth, 0.015).rotateY(Math.PI), material), 0, H.y, z);
      frame(width, H.h + 0.01, 0.02, chrome); frame(width - 0.03, H.h - 0.02, 0.026, rubber);
      for (const y of [-0.3, 0, 0.3]) add(box(width - 0.04, 0.008, 0.01, chrome), 0, H.y + y * H.h, z - 0.026);
    }
    if (spec.spoiler) {
      // Rear wing: a blade on two posts.
      add(new THREE.Mesh(new RoundedBoxGeometry(spec.width * 0.94, 0.03, 0.24, 2, 0.012), detailPaint), 0, spec.spoiler, rearZ - 0.2).rotation.x = 0.07;
      const deckY = T.y + T.h / 2 + 0.04;
      for (const side of [-1, 1]) add(box(0.035, spec.spoiler - deckY, 0.16, detailPaint), side * halfW * 0.72, (spec.spoiler + deckY) / 2, rearZ - 0.2);
    }
    if (spec.cargoBox) {
      const c = spec.cargoBox, len = (c.to - c.from) * spec.length;
      const cargo = add(box(spec.width + 0.1, c.top - c.bottom, len, new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.8 })),
        0, (c.top + c.bottom) / 2, frontZ + (c.from + c.to) / 2 * spec.length);
      cargo.castShadow = true;
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
    for (const lamp of lamps.head) lamp.getObjectByName('beam').visible = head > 0;
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

// Where is the nose (or tail) of the body at a given height? Lamps sit there.
function bodyEndZ(spec, dims, y, fromRear = false) {
  const st = fromRear ? [...spec.stations].reverse() : spec.stations;
  for (let i = 0; i < st.length; i++) {
    const top = Math.max(st[i][1], st[i][2]);
    if (top >= y) {
      if (i === 0) return dims.frontZ + st[0][0] * spec.length;
      const prevTop = Math.max(st[i - 1][1], st[i - 1][2]);
      const t = lerp(st[i - 1][0], st[i][0], (y - prevTop) / (top - prevTop));
      return dims.frontZ + t * spec.length;
    }
  }
  return fromRear ? dims.rearZ : dims.frontZ;
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
