// ---------------------------------------------------------------------------
// speedTraps.js — speed cameras: drive past one as fast as you dare.
//
// A map lists its cameras in map.json:
//     "speedCameras": [{ "id": "avenue", "road": "avenue", "s": 620, "name": "Avenue",
//                        "stars": [110, 150, 190] }]
//   road = which road it stands on (left out = the main road), s = metres along it,
//   stars = the speeds, in km/h, that earn one, two and three stars.
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
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeObject } from '../world/library.js';
import { RULES, career } from './career.js';
import { save } from './save.js';

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
    const middle = way.pointAt(s, 0);
    return { ...entry, way, s, x: middle.x, z: middle.z, pole, side: null, flash: 0 };
  });
  const records = () => (save.data.career.cameras ??= {});       // "map:camera" -> { best (km/h), stars }
  const keyOf = (camera) => `${map.id}:${camera.id}`;

  return {
    group, neons, obstacles, cameras,
    // The best speed and stars at a camera so far: { best, stars } (zeros if never passed).
    record: (camera) => records()[keyOf(camera)] || { best: 0, stars: 0 },

    /** Call every frame while driving. player = the player's car; dt lets the flash die away. */
    update(player, dt) {
      let event = null;
      for (const camera of cameras) {
        // The flash: bright for a moment after it fires.
        camera.flash = Math.max(0, camera.flash - dt);
        camera.pole.userData.flash.color.setScalar(camera.flash > 0 ? 6 * (camera.flash / 0.25) : 0.05);
        // Which side of the camera the car is on. Changing sides close to it = the car has just gone past.
        const side = player.way === camera.way ? Math.sign(camera.way.ahead(player.s, camera.s)) : null;
        const passed = side !== null && camera.side !== null && side !== 0 && side !== camera.side
          && Math.abs(camera.way.ahead(player.s, camera.s)) < 40 && Math.abs(player.d) < camera.way.at(camera.way.road.barrier, camera.s);
        camera.side = side || camera.side;
        if (player.way !== camera.way) camera.side = null;
        if (!passed) continue;
        camera.flash = 0.25;
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
