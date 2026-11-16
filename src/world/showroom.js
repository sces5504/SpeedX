// ---------------------------------------------------------------------------
// showroom.js — the bright room the garage shows your car in.
//
// The game world is always night, which is no place to choose paint or check
// a bumper. So the garage has a small scene of its own: a polished floor, a
// dark curved wall, strip lights overhead and three lamps aimed at the car
// (key, fill and a rim light from behind). While the garage is open the car
// is lifted out of the world into this scene and the picture is drawn from
// here; closing the garage puts it back where it was.
//
// The camera circles the car by itself. Hold the left mouse button and drag
// to look round it yourself, scroll to move in and out.
//
//   showroom.scene            what to draw while the garage is open
//   showroom.show(carGroup)   put this car in the room (also after changing car)
//   showroom.hide(world)      give the car back to the world scene
//   showroom.update(dt, camera, mouse)   every frame: follow the car, move the camera
//   showroom.theme(name)      whose room it is - each has its own furniture, floor, wall and light (ROOMS below):
//                               'garage'  a workshop: painted bay, roller door, tool chests, tyres, work lamps, green neon
//                               'dealer'  a car salon at night: a lit turntable, a ring of light overhead, a wall of
//                                         glass with the town's lights beyond it, a rope round the car, cyan neon
//   showroom.focus(part)      swing the camera to the part of the car being worked on (a line of the garage screen)
//   orbitCamera(...)          the camera that circles a car (also used by the Blacklist's stage, world/stage.js)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, damp } from '../core/mathUtils.js';
import { canvasTexture } from '../render/materials.js';

const TURN_SPEED = 0.16;          // radians per second when the camera circles by itself
const REST = 4;                   // seconds after you let go before it starts circling again

export function createShowroom() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);
  const room = new THREE.Group();          // everything except the car; kept exactly where the car stands
  scene.add(room);

  // ---- Floor and wall ---------------------------------------------------------------------
  // Polished concrete: dark, with a pool of light worn into the middle and faint tile joints.
  const floorPicture = canvasTexture(512, 512, (g, w, h) => {
    const pool = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 2);
    pool.addColorStop(0, '#6c7178'); pool.addColorStop(0.45, '#3c4046'); pool.addColorStop(1, '#101215');
    g.fillStyle = pool; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1;
    for (let k = 0; k <= 16; k++) { g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32, h); g.moveTo(0, k * 32); g.lineTo(w, k * 32); g.stroke(); }
  }, { repeat: false });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshStandardMaterial({ map: floorPicture, roughness: 0.38, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  // A curved wall all the way round, darker toward the top so the car stands out against it.
  const wallPicture = canvasTexture(8, 256, (g, w, h) => {
    const fade = g.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, '#07090c'); fade.addColorStop(0.7, '#161b21'); fade.addColorStop(1, '#262d35');
    g.fillStyle = fade; g.fillRect(0, 0, w, h);
  }, { repeat: false });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 7, 48, 1, true), new THREE.MeshBasicMaterial({ map: wallPicture, side: THREE.BackSide }));
  wall.position.y = 3.5;
  room.add(floor, wall);

  // ---- Light ------------------------------------------------------------------------------------
  // Strip lights overhead: glowing bars that also show up as long reflections in the paint.
  const tubes = new THREE.MeshBasicMaterial({ color: 0xf2f6ff });
  tubes.color.multiplyScalar(1.5);                         // brighter than white: they bloom a little
  const tubeRack = new THREE.Group();                      // (the workshop's; the salon has a ring of light instead)
  for (const x of [-2.6, 0, 2.6]) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 7.5), tubes);
    tube.position.set(x, 4.2, 0);
    tubeRack.add(tube);
  }
  room.add(tubeRack);
  // Two green neon rings low on the wall: the game's own colour, so the room belongs to it.
  const neon = new THREE.MeshBasicMaterial({ color: 0x57ff9a });
  neon.color.multiplyScalar(1.2);
  for (const y of [0.35, 2.6]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(15.8, 0.03, 6, 96), neon);
    ring.rotation.x = Math.PI / 2; ring.position.y = y;
    room.add(ring);
  }
  room.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2e36, 0.55));         // soft light from everywhere: no black sides
  const lamp = (color, power, x, y, z, shadow = false) => {
    const light = new THREE.SpotLight(color, power, 40, 0.75, 0.7, 2);
    light.position.set(x, y, z);
    light.target.position.set(0, 0.5, 0);
    if (shadow) {
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = 2; light.shadow.camera.far = 20;
      light.shadow.bias = -0.0006; light.shadow.normalBias = 0.03;
    }
    room.add(light, light.target);
  };
  lamp(0xfff4e6, 260, 4.5, 6.5, -5.5, true);      // key: above the front right corner
  lamp(0xdde8ff, 110, -6, 5, -2);                 // fill: from the left
  lamp(0xcfe0ff, 150, -1, 5.5, 7);                // rim: from behind, picks out the roof and tail

  // ---- The two rooms ------------------------------------------------------------------------------
  // What makes the garage a workshop and the dealership a salon. Each: its furniture (a group, shown
  // only in that room), the floor's and the wall's picture, how shiny the floor is, and its colours.
  const ROOMS = {
    garage: { ...buildWorkshop(), floor: floorPicture, wall: wallPicture, shine: 0.38, neon: 0x57ff9a, tubes: 0xf2f6ff, strips: true },
    dealer: { ...buildSalon(), shine: 0.3, neon: 0x35d8ff, tubes: 0xfff0dc, strips: false },
  };
  for (const set of Object.values(ROOMS)) { set.group.visible = false; room.add(set.group); }

  // ---- Camera -------------------------------------------------------------------------------------
  const view = { yaw: 2.5, pitch: 0.24, distance: 7, wantDistance: 7, idle: REST, aim: -0.15 };      // aim: the height the camera looks at (a little under the car, so it sits above the buttons)
  let car = null;
  window.addEventListener('wheel', (event) => {
    if (car && event.target.tagName === 'CANVAS') view.wantDistance = clamp(view.wantDistance * (1 + Math.sign(event.deltaY) * 0.1), 3.2, 11);
  }, { passive: true });

  // Where the camera goes for each line of the garage screen: [yaw, pitch, distance] (yaw: PI = from the front,
  // 0 = from behind, PI / 2 = from the right). Anything not listed: the usual three-quarter view.
  const VIEWS = {
    car: [2.5, 0.24, 7], paint: [2.5, 0.3, 7.5],
    'look-frontBumper': [2.75, 0.14, 5.2], 'look-headlights': [2.9, 0.16, 4.8], 'look-hood': [2.85, 0.5, 5.6], 'look-canards': [2.4, 0.12, 4.8],
    'look-rearBumper': [0.4, 0.14, 5.2], 'look-taillights': [0.25, 0.16, 4.8], 'look-spoiler': [0.55, 0.32, 5.4], 'look-exhaust': [0.3, 0.08, 4.6],
    'look-skirts': [1.45, 0.1, 5.2], 'look-widebody': [1.1, 0.2, 5.8], 'look-rims': [1.35, 0.08, 4.4], 'look-roofScoop': [2.2, 0.75, 6], 'look-livery': [1.9, 0.38, 7],
    swap: [2.9, 0.42, 5.4], internals: [2.9, 0.42, 5.4], induction: [2.9, 0.42, 5.4], ecu: [2.9, 0.42, 5.4],
    gearbox: [1.57, 0.16, 6], brakes: [1.3, 0.07, 4.2], tyres: [1.8, 0.07, 4.2], weight: [0.9, 0.5, 7],
  };

  return {
    scene,
    theme(name) {
      const look = ROOMS[name] || ROOMS.garage;
      for (const set of Object.values(ROOMS)) set.group.visible = set === look;
      floor.material.map = look.floor; floor.material.roughness = look.shine;
      wall.material.map = look.wall;
      tubeRack.visible = look.strips;
      neon.color.set(look.neon).multiplyScalar(1.2);
      tubes.color.set(look.tubes).multiplyScalar(1.5);
    },
    focus(part) {
      const [yaw, pitch, distance] = VIEWS[part] || VIEWS.car;
      Object.assign(view, { wantYaw: yaw, wantPitch: pitch, wantDistance: distance, idle: -3 });      // (and it stays there a few seconds before circling again)
    },
    view,                    // the camera: { yaw, pitch, wantDistance, idle, aim } (handy in the browser console: speedx.showroom.view)
    show(carGroup) { car = carGroup; scene.add(carGroup); },
    hide(worldScene) { if (car) worldScene.add(car); car = null; },
    /** @param mouse input.mouse: { down, dx, dy } */
    update(dt, camera, mouse) {
      if (!car) return;
      // The room stands wherever the car is, tilted the way the car is (it may be parked on a slope).
      room.position.copy(car.position);
      room.quaternion.copy(car.quaternion);
      orbitCamera(view, car, dt, camera, mouse);
    },
    // Hand the camera back the way the rest of the game expects it.
    release(camera) { camera.up.set(0, 1, 0); },
  };
}

// ---- The camera that circles a car ------------------------------------------------------------------
// view = { yaw, pitch, distance, wantDistance, idle, aim, wantYaw?, wantPitch? } (see createShowroom);
// car = the car's 3D group; mouse = input.mouse. It turns by itself, the player may drag it round,
// and it swings to view.wantYaw / wantPitch when those are set.
const target = new THREE.Vector3(), offset = new THREE.Vector3();
export function orbitCamera(view, car, dt, camera, mouse) {
  if (mouse.down) {
    view.yaw -= mouse.dx * 0.006;
    view.pitch = clamp(view.pitch + mouse.dy * 0.004, 0.03, 1.2);
    view.idle = 0;
    view.wantYaw = null;                                   // the player has taken the camera: forget where it was going
  } else {
    if (view.wantYaw !== null && view.wantYaw !== undefined) {
      // Swinging round to the part being worked on (the short way).
      view.yaw += Math.atan2(Math.sin(view.wantYaw - view.yaw), Math.cos(view.wantYaw - view.yaw)) * Math.min(1, dt * 3);
      view.pitch = damp(view.pitch, view.wantPitch, 3, dt);
    }
    if ((view.idle += dt) > REST) { view.wantYaw = null; view.yaw += dt * TURN_SPEED; }
  }
  view.distance = damp(view.distance, view.wantDistance, 8, dt);
  offset.set(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch)).multiplyScalar(view.distance);
  target.set(0, view.aim, 0).applyQuaternion(car.quaternion).add(car.position);
  camera.position.copy(offset.applyQuaternion(car.quaternion)).add(target);
  camera.up.set(0, 1, 0).applyQuaternion(car.quaternion);
  camera.lookAt(target);
  camera.fov = 42; camera.updateProjectionMatrix();
}

// ---- Furniture ---------------------------------------------------------------------------------------
// Small helpers: a box and an upright cylinder, standing on the floor at (x, z).
const matt = (color, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const glowing = (color, strength = 1.4) => { const m = new THREE.MeshBasicMaterial({ color }); m.color.multiplyScalar(strength); return m; };
function block(group, material, w, h, d, x, y, z, turn = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); mesh.rotation.y = turn;
  group.add(mesh);
  return mesh;
}
function drum(group, material, radius, h, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 20), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

// THE WORKSHOP (the garage). The car stands in a bay painted on the floor; behind it the roller door
// it came in by; round the walls what a tuning shop has: tool chests, a bench, tyres, drums, work lamps.
function buildWorkshop() {
  const group = new THREE.Group();
  // The bay: yellow corner marks round the car and a hazard strip across the front of it.
  const paint = canvasTexture(512, 768, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255, 196, 40, 0.8)'; g.lineWidth = 9;
    for (const [x, y, dx, dy] of [[70, 110, 1, 1], [w - 70, 110, -1, 1], [70, h - 110, 1, -1], [w - 70, h - 110, -1, -1]]) {
      g.beginPath(); g.moveTo(x + dx * 90, y); g.lineTo(x, y); g.lineTo(x, y + dy * 90); g.stroke();
    }
    for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? 'rgba(20, 20, 20, 0.85)' : 'rgba(255, 196, 40, 0.85)'; g.fillRect(70 + k * 28.6, 40, 28.6, 26); }
    g.fillStyle = 'rgba(232, 242, 234, 0.55)'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.fillText('BAY 01', w / 2, h - 46);
  }, { repeat: false });
  const bay = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 6.9), new THREE.MeshBasicMaterial({ map: paint, transparent: true, depthWrite: false, opacity: 0.8 }));
  bay.rotation.x = -Math.PI / 2; bay.position.y = 0.006;
  group.add(bay);
  // The roller door behind the car: slats, a frame, hazard posts either side.
  const slats = canvasTexture(64, 256, (g, w, h) => {
    g.fillStyle = '#3d444b'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) { g.fillStyle = '#23282d'; g.fillRect(0, y, w, 3); g.fillStyle = '#59626b'; g.fillRect(0, y + 3, w, 2); }
  }, { repeat: false });
  block(group, new THREE.MeshStandardMaterial({ map: slats, roughness: 0.55, metalness: 0.5 }), 6.4, 3.6, 0.12, 0, 1.8, 12.6);
  const frame = matt(0x15181b, 0.6, 0.4);
  block(group, frame, 7, 0.3, 0.3, 0, 3.75, 12.5); block(group, frame, 0.3, 3.9, 0.3, -3.35, 1.95, 12.5); block(group, frame, 0.3, 3.9, 0.3, 3.35, 1.95, 12.5);
  const hazard = canvasTexture(32, 128, (g, w, h) => { for (let k = -2; k < 10; k++) { g.fillStyle = k % 2 ? '#141414' : '#f2b21c'; g.beginPath(); g.moveTo(0, k * 16); g.lineTo(w, k * 16 + 16); g.lineTo(w, k * 16 + 32); g.lineTo(0, k * 16 + 16); g.fill(); } }, { repeat: false });
  for (const x of [-3.9, 3.9]) block(group, new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 }), 0.22, 1.1, 0.22, x, 0.55, 12.2);
  // Tool chests (red, with drawer fronts), a bench with a steel top, drums, stacks of tyres.
  const red = matt(0xa81f1a, 0.45, 0.3), steel = matt(0x8d949b, 0.35, 0.8), wood = matt(0x3b2c1f, 0.8), rubber = matt(0x0b0b0c, 0.9);
  for (const [x, z, turn] of [[-8.6, 7.4, 0.9], [9.2, 5.2, -1.0]]) {
    const chest = block(group, red, 1.5, 1.05, 0.62, x, 0.6, z, turn);
    for (let k = 0; k < 4; k++) { const drawer = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.03, 0.02), steel); drawer.position.set(0, -0.36 + k * 0.24, -0.32); chest.add(drawer); }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.62), matt(0x1b1d20, 0.5)); lid.position.y = 0.55; chest.add(lid);
  }
  const bench = block(group, wood, 2.6, 0.86, 0.75, -10.2, 0.43, -2.2, 1.35);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.05, 0.8), steel); top.position.y = 0.45; bench.add(top);
  for (const [x, z, color] of [[10.4, -4.4, 0x1d4f8a], [11.0, -3.5, 0x23683a], [9.9, -3.4, 0x1d4f8a]]) drum(group, matt(color, 0.5, 0.4), 0.3, 0.9, x, 0.45, z);
  for (const [x, z, count] of [[6.6, 10.2, 4], [7.5, 9.5, 3], [-9.6, 3.6, 4], [-10.3, 4.4, 2]]) {
    for (let k = 0; k < count; k++) drum(group, rubber, 0.34, 0.23, x + (k % 2) * 0.03, 0.12 + k * 0.235, z);
  }
  // Two work lamps on stands, turned toward the car.
  const lampGlow = glowing(0xffe2b0, 1.6), stand = matt(0x202326, 0.5, 0.6);
  for (const [x, z] of [[-5.6, -6.8], [6.2, 7.2]]) {
    drum(group, stand, 0.025, 1.9, x, 0.95, z);
    const head = block(group, stand, 0.62, 0.42, 0.12, x, 1.95, z, Math.atan2(x, z));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), lampGlow); face.position.z = -0.065; face.rotation.y = Math.PI; head.add(face);
  }
  // Their light on the walls and the furniture (the three big lamps are all aimed at the car).
  for (const [x, z] of [[-7.5, 3], [7.5, 8], [0, 10.5]]) { const light = new THREE.PointLight(0xffe2b0, 14, 14, 1.8); light.position.set(x, 2.6, z); group.add(light); }
  return { group };
}

// THE SALON (the dealership). A glass wall with the town's lights beyond, a floor like dark stone, the
// car on a turntable ringed with light, a ring of light overhead, and a rope round it all.
function buildSalon() {
  const group = new THREE.Group();
  const floor = canvasTexture(512, 512, (g, w, h) => {
    const pool = g.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, w / 2);
    pool.addColorStop(0, '#9a9da3'); pool.addColorStop(0.35, '#5a5d64'); pool.addColorStop(1, '#17191d');
    g.fillStyle = pool; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;                       // large stone slabs
    for (let k = 0; k <= 8; k++) { g.beginPath(); g.moveTo(k * 64, 0); g.lineTo(k * 64, h); g.moveTo(0, k * 64); g.lineTo(w, k * 64); g.stroke(); }
  }, { repeat: false });
  // The wall: night outside, and the lights of the town out of focus.
  const wall = canvasTexture(1024, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#04060b'); sky.addColorStop(0.55, '#0a1322'); sky.addColorStop(1, '#101a2b');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    let seed = 7; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };       // (the same town every time)
    // (the picture is stretched four times wider than tall on the wall, so each light is drawn narrow)
    for (let k = 0; k < 420; k++) {
      const x = random() * w, y = h * (0.66 + random() * 0.26), size = 0.8 + random() * 1.6;
      g.fillStyle = ['rgba(255,196,128,', 'rgba(255,224,180,', 'rgba(170,205,255,'][Math.floor(random() * 3)] + (0.18 + random() * 0.4) + ')';
      g.beginPath(); g.ellipse(x, y, size * 0.3, size, 0, 0, 7); g.fill();
    }
  }, { repeat: false });
  // The glass is held by upright posts all the way round.
  const post = matt(0x0d0f12, 0.4, 0.7);
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; block(group, post, 0.12, 7, 0.12, Math.sin(a) * 15.7, 3.5, Math.cos(a) * 15.7, a); }
  // The turntable: a dark, glossy disc let into the floor, its edge a line of light.
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.9, 64), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.08, metalness: 0.7 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005;
  const edge = new THREE.Mesh(new THREE.TorusGeometry(3.92, 0.03, 6, 96), glowing(0x35d8ff, 1.5));
  edge.rotation.x = Math.PI / 2; edge.position.y = 0.02;
  group.add(disc, edge);
  // Overhead: two rings of warm light (they show as long curves in the paint).
  for (const [radius, y] of [[5.4, 4.5], [3.1, 4.7]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.07, 8, 96), glowing(0xfff0dc, 1.6));
    ring.rotation.x = Math.PI / 2; ring.position.y = y;
    group.add(ring);
  }
  // A rope round the car on chrome posts, as round something precious.
  const chrome = matt(0xd8dde2, 0.15, 1), velvet = matt(0x7a0f1c, 0.8);
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; drum(group, chrome, 0.035, 0.95, Math.sin(a) * 6.3, 0.475, Math.cos(a) * 6.3); }
  const rope = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.022, 6, 96), velvet);
  rope.rotation.x = Math.PI / 2; rope.position.y = 0.88;
  group.add(rope);
  // The rings' own warm light on the floor round the car and up the glass.
  for (const [x, z] of [[0, 7], [-6, -4], [6, -4]]) { const light = new THREE.PointLight(0xfff0dc, 7, 16, 1.8); light.position.set(x, 4, z); group.add(light); }
  return { group, floor, wall };
}
