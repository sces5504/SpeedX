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
  for (const x of [-2.6, 0, 2.6]) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 7.5), tubes);
    tube.position.set(x, 4.2, 0);
    room.add(tube);
  }
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

  // ---- Camera -------------------------------------------------------------------------------------
  const view = { yaw: 2.5, pitch: 0.24, distance: 7, wantDistance: 7, idle: REST, aim: -0.15 };      // aim: the height the camera looks at (a little under the car, so it sits above the buttons)
  const target = new THREE.Vector3(), offset = new THREE.Vector3();
  let car = null;
  window.addEventListener('wheel', (event) => {
    if (car && event.target.tagName === 'CANVAS') view.wantDistance = clamp(view.wantDistance * (1 + Math.sign(event.deltaY) * 0.1), 3.2, 11);
  }, { passive: true });

  return {
    scene,
    view,                    // the camera: { yaw, pitch, wantDistance, idle, aim } (handy in the browser console: speedx.showroom.view)
    show(carGroup) { car = carGroup; scene.add(carGroup); },
    hide(worldScene) { if (car) worldScene.add(car); car = null; },
    /** @param mouse input.mouse: { down, dx, dy } */
    update(dt, camera, mouse) {
      if (!car) return;
      // The room stands wherever the car is, tilted the way the car is (it may be parked on a slope).
      room.position.copy(car.position);
      room.quaternion.copy(car.quaternion);
      if (mouse.down) {
        view.yaw -= mouse.dx * 0.006;
        view.pitch = clamp(view.pitch + mouse.dy * 0.004, 0.03, 1.2);
        view.idle = 0;
      } else if ((view.idle += dt) > REST) view.yaw += dt * TURN_SPEED;
      view.distance = damp(view.distance, view.wantDistance, 8, dt);
      offset.set(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch)).multiplyScalar(view.distance);
      target.set(0, view.aim, 0).applyQuaternion(car.quaternion).add(car.position);
      camera.position.copy(offset.applyQuaternion(car.quaternion)).add(target);
      camera.up.set(0, 1, 0).applyQuaternion(car.quaternion);
      camera.lookAt(target);
      camera.fov = 42; camera.updateProjectionMatrix();
    },
    // Hand the camera back the way the rest of the game expects it.
    release(camera) { camera.up.set(0, 1, 0); },
  };
}
