// ---------------------------------------------------------------------------
// carBuilder.js — builds a 3D car from a spec in carSpecs.js.
//
// The result is a "car object":
//   car.group        put this in the scene and move/rotate it
//   car.body         the shell; lean it for body roll and pitch
//   car.wheels[4]    FL, FR, RL, RR — each has .pivot (steer / suspension)
//                    and .spin (rolls). Every wheel is its own object.
//   car.lamps        every lamp is its own mesh with its own material:
//                    head[2], tail[2], brake[2], reverse[2], signalL[2], signalR[2]
//   car.setLights()  convenient switchboard for all of the above
//
// Local axes of a car: forward = -Z, right = +X, up = +Y. The origin is on the
// ground under the centre of gravity.
//
// If the car has a model.glb (see carModel.js) its body and wheels come from
// that model; otherwise a simple shell is generated from the "stations" in
// car.json. Lamps, licence plates and the light switchboard are the same either way.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { lerp } from '../core/mathUtils.js';
import { canvasTexture, enhanceMaterial, makeGlowTexture } from '../render/materials.js';
import { getCarModel } from './carModel.js';

const glowTexture = makeGlowTexture();
const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.7 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.06, metalness: 0.9 });
const archMat = new THREE.MeshBasicMaterial({ color: 0x020202 });
const rimTexture = makeRimTexture();
const rimMat = new THREE.MeshStandardMaterial({ map: rimTexture, roughness: 0.35, metalness: 0.7, transparent: true });
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
  let paint, shell;
  if (model) {
    // White-painted models are tinted with the chosen colour (texture x colour).
    paint = model.material.clone();
    paint.color.set(colorHex);
    shell = new THREE.Mesh(model.body, paint);
  } else {
    paint = new THREE.MeshPhysicalMaterial({ color: colorHex, roughness: 0.38, metalness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 });
    const lower = spec.twoTone !== undefined ? new THREE.MeshPhysicalMaterial({ color: spec.twoTone, roughness: 0.4, metalness: 0.4, clearcoat: 0.6 }) : paint;
    shell = new THREE.Mesh(shellGeometry(spec, dims), [paint, glassMat, trimMat, lower]);
  }
  shell.castShadow = true;
  shell.name = 'body_shell';
  body.add(shell);
  const detailPaint = model ? new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.3 }) : paint;

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

  // ---- Lamps (each one separate) -----------------------------------------------
  const lampMaterial = (color) => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: color, emissiveIntensity: 0, roughness: 0.25 });
  const lamps = { head: [], tail: [], brake: [], reverse: [], signalL: [], signalR: [], pods: [] };
  const glows = { head: [], tail: [] };
  const H = spec.headlights, T = spec.taillights;
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'L' : 'R';
    // Headlight — fixed in the nose, or a pop-up pod on the bonnet
    const head = box(H.w, H.h, 0.1, lampMaterial(0xfff2d8));
    head.name = 'light_head_' + name;
    if (H.popup) {
      const pod = new THREE.Group();
      const podZ = frontZ + spec.length * 0.085;
      pod.add(box(H.w + 0.06, H.h + 0.04, 0.26, detailPaint));
      head.position.set(0, 0, -0.1);
      pod.add(head);
      pod.userData.upY = H.y + H.h / 2 + 0.01;
      pod.userData.downY = H.y - H.h / 2 - 0.05;
      pod.position.set(side * H.x * halfW, pod.userData.downY, podZ);
      body.add(pod);
      lamps.pods.push(pod);
    } else {
      head.scale.z = model ? 0.3 : 1;
      const hx = seatX(side * H.x * halfW, H.y, false);
      add(head, hx, H.y, zAtHeight(H.y, false, hx) - 0.02);
    }
    lamps.head.push(head);
    // Rear cluster: tail lamp outside, brake lamp inside, small reverse lamp, amber signal
    // On a real model the lamps are already painted on, so ours are thin glowing plates over them.
    const lampDepth = model ? 0.03 : 0.08, lampH = model ? T.h * 0.7 : T.h, lampW = model ? 0.8 : 1;
    const rearLamp = (w, h, color, x, y) => {
      const sx = seatX(side * x, y, true);
      return add(box(w, h, lampDepth, lampMaterial(color)), sx, y, zAtHeight(y, true, sx) + (model ? -0.005 : 0.02));
    };
    const tail = rearLamp(T.w * 0.55 * lampW, lampH, 0xff1505, T.x * halfW + T.w * 0.2 * lampW, T.y);
    const brake = rearLamp(T.w * 0.4 * lampW, lampH, 0xff1505, T.x * halfW - T.w * 0.28 * lampW, T.y);
    const reverse = rearLamp(0.1, 0.05, 0xffffff, T.x * halfW - T.w * 0.28, T.y - T.h / 2 - 0.04);
    tail.name = 'light_tail_' + name; brake.name = 'light_brake_' + name; reverse.name = 'light_reverse_' + name;
    lamps.tail.push(tail); lamps.brake.push(brake); lamps.reverse.push(reverse);
    const noseSignalY = spec.stations[0][1] - 0.04, sfx = seatX(side * halfW * 0.82, noseSignalY, false);
    const sigFront = add(box(0.12, 0.06, model ? 0.03 : 0.08, lampMaterial(0xff8a00)), sfx, noseSignalY, zAtHeight(noseSignalY, false, sfx) + (model ? 0.005 : -0.02));
    const sigRear = rearLamp(0.07, lampH, 0xff8a00, Math.min(halfW * 0.9, T.x * halfW + T.w * 0.5 * lampW), T.y);
    sigFront.name = 'light_signal_front_' + name; sigRear.name = 'light_signal_rear_' + name;
    (side < 0 ? lamps.signalL : lamps.signalR).push(sigFront, sigRear);

    // Soft flares so lamps are visible from far away
    const headGlow = flare(0xfff0d0, 1); head.add(headGlow); headGlow.position.z = -0.12; glows.head.push(headGlow);
    const tailGlow = flare(0xff2010, 0.5); tail.add(tailGlow); tailGlow.position.z = 0.1; glows.tail.push(tailGlow);
  }

  // ---- Licence plates (each car gets its own random number) -----------------------
  const plate = makePlate();
  const noseY = spec.stations[0][1], plateRearY = T.y - T.h - 0.1;
  const plateGeo = new THREE.PlaneGeometry(0.31, 0.155);
  const frontPlate = add(new THREE.Mesh(plateGeo, plate.material), 0, noseY - 0.12, zAtHeight(noseY - 0.12) - 0.015);
  frontPlate.rotation.y = Math.PI;                              // faces forward
  add(new THREE.Mesh(plateGeo, plate.material), 0, plateRearY, zAtHeight(plateRearY, true) + 0.015);

  // ---- Small details the generated shell needs (a real model already has them) -------
  const cowl = spec.stations.find((s) => s[4] === 'ws');
  const cowlZ = frontZ + cowl[0] * spec.length;
  if (!model) {
    add(box(halfW * (spec.grille ? 0.9 : 1.1), spec.grille ? 0.16 : 0.09, 0.05, trimMat), 0, spec.grille ? H.y : noseY - 0.13, zAtHeight(spec.grille ? H.y : noseY - 0.13) - 0.012);
    for (const side of [-1, 1]) add(box(0.16, 0.1, 0.07, paint), side * (halfW + 0.07), cowl[1] + 0.1, cowlZ + 0.42);   // mirrors
    if (spec.spoiler) {
      add(box(spec.width * 0.92, 0.035, 0.26, paint), 0, spec.spoiler, rearZ - 0.2);
      for (const side of [-1, 1]) add(box(0.04, spec.spoiler - 0.9, 0.2, paint), side * halfW * 0.72, (spec.spoiler + 0.9) / 2, rearZ - 0.2);
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
  const tyreGeo = new THREE.CylinderGeometry(r, r, tyreWidth, 22).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CircleGeometry(r * 0.68, 20);
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
      const tyre = new THREE.Mesh(tyreGeo, rubber);
      tyre.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.x = side * (tyreWidth / 2 + 0.004); rim.rotation.y = side * Math.PI / 2;
      spin.add(tyre, rim);
    }
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ name, pivot, spin, side, z, restY: r });
    // black disc = the dark inside of the wheel arch
    const arch = new THREE.Mesh(new THREE.CircleGeometry(r + 0.075, 20), archMat);
    arch.rotation.y = side * Math.PI / 2;
    add(arch, model ? side * (halfW - r * 0.98) : side * (halfW * 0.985), r + 0.01, z);
  });

  // ---- Fake pool of light on the road (for AI cars without a real spotlight) -------
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 26), new THREE.MeshBasicMaterial({
    map: poolTexture, color: 0xfff0d2, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  add(pool, 0, 0.05, frontZ - 13.5, group);
  pool.visible = false;

  const car = { spec, group, body, shell, wheels, lamps, glows, pool, dims, paint, plate, lightState: {} };
  // Change the body colour (AI cars are repainted when they are recycled).
  car.setColor = (hex) => { paint.color.set(hex); detailPaint.color.set(hex); };

  // ---- Light switchboard ----------------------------------------------------------
  // head: 0 off, 1 low beam, 2 high beam.   usePool: draw the fake light on the road.
  car.setLights = ({ head = 0, brake = false, reverse = false, left = false, right = false, usePool = false, poolFade = 1 }) => {
    const set = (list, value) => { for (const m of list) m.material.emissiveIntensity = value; };
    set(lamps.head, head === 0 ? 0 : head === 1 ? 5 : 12);
    set(lamps.tail, head > 0 ? 1.6 : 0);
    set(lamps.brake, brake ? 7 : head > 0 ? 1.0 : 0);
    set(lamps.reverse, reverse ? 4 : 0);
    set(lamps.signalL, left ? 5 : 0);
    set(lamps.signalR, right ? 5 : 0);
    for (const g of glows.head) { g.visible = head > 0; g.material.opacity = head === 2 ? 1 : 0.75; g.userData.gain = head === 2 ? 1.9 : 1; }
    for (const g of glows.tail) { g.visible = head > 0 || brake; g.material.opacity = brake ? 0.9 : 0.45; }
    pool.visible = usePool && head > 0;
    pool.material.opacity = (head === 2 ? 0.34 : 0.2) * poolFade;
    car.lightState.head = head; car.lightState.brake = brake;
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
    const size = 0.45 + dist * 0.02;
    for (const g of glows.head) { g.scale.setScalar(size * 1.6 * (g.userData.gain || 1) * (0.3 + 0.7 * front)); g.material.opacity = front * (car.lightState.head === 2 ? 1 : 0.75); }
    for (const g of glows.tail) { g.scale.setScalar(size * 0.8); g.material.opacity = back * (car.lightState.brake ? 0.9 : 0.4); }
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
  const material = enhanceMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }), { retro: 1.6 });
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

// ---------------------------------------------------------------------------
// Shell geometry: a skin stretched over the stations of the spec.
// ---------------------------------------------------------------------------
function ringPoints(spec, dims, station, isFirst, isLast) {
  const [, belt, roof, wf] = station;
  const w = dims.halfW * wf;
  const bottom = spec.clearance + (isFirst || isLast ? 0.07 : 0);
  const hasRoof = roof > belt + 0.2;
  const top = roof > 0 ? roof : belt;
  const roofW = hasRoof ? w * spec.tumble : w * 0.86;
  // Right half, from the middle of the floor up to the middle of the roof.
  // Each point is higher than the one before it, so the skin never folds over itself.
  return [
    [0, bottom], [w * 0.80, bottom], [w * 0.97, bottom + 0.1],
    [w, lerp(bottom, belt, 0.55)], [w * 0.965, belt - (hasRoof ? 0 : 0.035)],
    [roofW, hasRoof ? top - 0.05 : top], [roofW * 0.5, top + (hasRoof ? -0.008 : 0.014)], [0, top + (hasRoof ? 0 : 0.02)],
  ];
}

function shellGeometry(spec, dims) {
  // Bands of the skin (indices into the 8 half-ring points) and their material:
  // 0 paint, 1 glass, 2 black trim, 3 lower paint (two-tone cars)
  const bands = [
    { pts: [0, 1, 2], material: () => 2 },
    { pts: [2, 3], material: () => 3 },
    { pts: [3, 4], material: () => 0 },
    { pts: [4, 5], material: (span) => (span === 'cab' ? 1 : 0) },
    { pts: [5, 6, 7], material: (span) => (span === 'ws' || span === 'rw' ? 1 : 0) },
  ];
  const positions = [], indexLists = [[], [], [], []];
  const stations = spec.stations;
  const rings = stations.map((st, i) => ringPoints(spec, dims, st, i === 0, i === stations.length - 1));
  const zOf = (i) => dims.frontZ + stations[i][0] * spec.length;

  for (const mirror of [1, -1]) {
    for (const band of bands) {
      const base = positions.length / 3;
      for (let i = 0; i < stations.length; i++) {
        for (const p of band.pts) positions.push(rings[i][p][0] * mirror, rings[i][p][1], zOf(i));
      }
      const n = band.pts.length;
      for (let i = 0; i < stations.length - 1; i++) {
        const list = indexLists[band.material(stations[i][4])];
        for (let j = 0; j < n - 1; j++) {
          const A = base + i * n + j, B = A + 1, C = A + n, D = C + 1;
          if (mirror > 0) list.push(A, B, C, B, D, C); else list.push(A, C, B, B, C, D);
        }
      }
    }
  }
  // Flat caps on the nose and tail.
  for (const [i, facing] of [[0, -1], [stations.length - 1, 1]]) {
    const base = positions.length / 3, ring = rings[i];
    for (const mirror of [1, -1]) for (const p of ring) positions.push(p[0] * mirror, p[1], zOf(i));
    for (const offset of [0, 8]) {
      for (let j = 1; j < 7; j++) {
        const A = base + offset, B = base + offset + j, C = B + 1;
        const flip = (facing > 0) === (offset === 0);
        if (flip) indexLists[0].push(A, B, C); else indexLists[0].push(A, C, B);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const all = [];
  indexLists.forEach((list, material) => { geo.addGroup(all.length, list.length, material); all.push(...list); });
  geo.setIndex(all);
  geo.computeVertexNormals();
  return geo;
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

function makeRimTexture() {
  return canvasTexture(128, 128, (g, w) => {
    const c = w / 2;
    g.clearRect(0, 0, w, w);
    g.fillStyle = '#16171a'; g.beginPath(); g.arc(c, c, c, 0, 7); g.fill();
    g.strokeStyle = '#c9ccd0'; g.lineWidth = 9; g.beginPath(); g.arc(c, c, c - 6, 0, 7); g.stroke();
    g.lineWidth = 11; g.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2;
      g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(ang) * (c - 8), c + Math.sin(ang) * (c - 8)); g.stroke();
    }
    g.fillStyle = '#9da1a6'; g.beginPath(); g.arc(c, c, 13, 0, 7); g.fill();
  }, { repeat: false });
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
