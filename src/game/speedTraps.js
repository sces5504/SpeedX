// ---------------------------------------------------------------------------
// speedTraps.js — speed cameras: drive past one as fast as you dare.
//
// A map lists its cameras in map.json:
//     "speedCameras": [{ "id": "avenue", "road": "avenue", "s": 620, "name": "Avenue",
//                        "stars": [150, 200, 250] }]
//   road = which road it stands on (left out = the main road), s = metres along it,
//   stars = the speeds, in km/h, that earn one, two and three stars. On a straight where a car can be flat
//           out the standard is 150 / 200 / 250; where a bend holds every car back, less in the same proportions.
//
// Passing a camera in either direction is measured. For each camera the save file keeps the
// best speed and the most stars ever reached there (save.data.career.cameras). Reaching a
// star level for the FIRST time pays reputation and money (career.json: "speedCamera"); jump
// straight to three stars and the ones skipped are paid too. A level is never paid twice
// (career.awardStars: the same rule as a time attack's stars).
//
//   traps.update(player)  ->  null, or what just happened:
//       { camera, kmh, stars, newStars, reputation, money, newBest }
// The cameras themselves (the pole, its flash) are made here too: traps.group, .neons, .obstacles.
//
// THE FLASH. traps.fire(camera) sets it off: the lamp on the pole goes white and, for that
// instant, throws light on the road and the car (it is one of the world's small lights:
// render/smallLights.js). traps.glow(dt) lets it die away. update() does both while driving;
// a replay, which drives nothing, calls them itself (main.js).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeObject } from '../world/library.js';
import { RULES, career } from './career.js';
import { save } from './save.js';

const FLASH_SECONDS = 0.22;     // how long a flash takes to die away
const FLASH_POWER = 300;        // how much light it throws at its brightest (about what a street lamp gives)

export function createSpeedTraps(map) {
  const group = new THREE.Group();
  group.name = 'speed cameras';
  const neons = [], obstacles = [];
  const cameras = (map.info.speedCameras || []).map((entry) => {
    const way = map.ways.find((w) => w.id === entry.road) || map.ways[0], s = way.wrap(entry.s);
    // The pole stands just outside the guardrail on the right of someone driving up the road.
    const p = way.pointAt(s, way.at(way.road.barrier, s) + 0.9), pole = makeObject('speed-camera');
    pole.position.set(p.x, p.y, p.z); pole.rotation.y = p.yaw;
    group.add(pole);
    pole.updateMatrixWorld(true);
    for (const neon of pole.userData.neons) neons.push({ ...neon, position: pole.localToWorld(neon.at.clone()) });
    obstacles.push({ x: p.x, z: p.z, yaw: p.yaw, halfWidth: 0.2, front: 0.2, rear: 0.2 });
    // The light its flash throws: dark until it fires (glow, below).
    const lamp = { position: pole.localToWorld(new THREE.Vector3(-0.2, 4.72, 0.6)), color: 0xf2f6ff, power: 0 };
    neons.push(lamp);
    const middle = way.pointAt(s, 0);
    return { ...entry, way, s, x: middle.x, z: middle.z, pole, lamp, side: null, flash: 0 };
  });
  const records = () => (save.data.career.cameras ??= {});       // "map:camera" -> { best (km/h), stars }
  const keyOf = (camera) => `${map.id}:${camera.id}`;

  // Every flash that has been fired dies away.
  function glow(dt) {
    for (const camera of cameras) {
      camera.flash = Math.max(0, camera.flash - dt);
      const lit = camera.flash / FLASH_SECONDS;
      camera.pole.userData.flash.color.setScalar(lit > 0 ? 6 * lit : 0.05);
      camera.lamp.power = FLASH_POWER * lit;
    }
  }

  return {
    group, neons, obstacles, cameras, glow,
    fire(camera) { camera.flash = FLASH_SECONDS; },
    // The best speed and stars at a camera so far: { best, stars } (zeros if never passed).
    record: (camera) => records()[keyOf(camera)] || { best: 0, stars: 0 },

    /** Call every frame while driving. player = the player's car; dt lets the flash die away. */
    update(player, dt) {
      let event = null;
      glow(dt);
      for (const camera of cameras) {
        // Which side of the camera the car is on. Changing sides close to it = the car has just gone past.
        const side = player.way === camera.way ? Math.sign(camera.way.ahead(player.s, camera.s)) : null;
        const passed = side !== null && camera.side !== null && side !== 0 && side !== camera.side
          && Math.abs(camera.way.ahead(player.s, camera.s)) < 40 && Math.abs(player.d) < camera.way.at(camera.way.road.barrier, camera.s);
        camera.side = side || camera.side;
        if (player.way !== camera.way) camera.side = null;
        if (!passed) continue;
        camera.flash = FLASH_SECONDS;
        const kmh = Math.round(player.vehicle.speed * 3.6);
        const stars = camera.stars.filter((needed) => kmh >= needed).length;
        const record = (records()[keyOf(camera)] ??= { best: 0, stars: 0 });
        const newBest = kmh > record.best;
        if (newBest) record.best = kmh;
        const won = career.awardStars('camera-' + keyOf(camera), record, stars, RULES.speedCamera);
        if (!won.newStars && newBest) save.write();
        event = { camera, kmh, stars, ...won, newBest };
      }
      return event;
    },
  };
}
