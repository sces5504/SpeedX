// ---------------------------------------------------------------------------
// trafficTwoLane.js — the traffic rule set "two-lane": one road with one lane
// each way and right-hand traffic (a mountain pass, a coast road). Where the
// road widens to two lanes each way the drivers spread over both lanes, keep to
// the right-hand one, and move to the left-hand one to pass someone slower.
// They follow what the MAP says: the speed limit of the stretch they are on
// (road.limit, from the map's "sections") and its traffic lights (map.signals) —
// they stop at red, and you are free not to.
// The drivers:
//   * keep to their lane and to about the speed limit, slower in bends
//   * FOLLOW: keep a safe gap to whatever is ahead (including you)
//   * YIELD: if you sit on their bumper, flash or honk, they pull to the right
//     edge, indicate, and ease off so you can pass
//   * PANIC: if you come at them head-on in their lane they brake and honk
// Cars far from the player are recycled: removed and re-placed ahead or behind,
// out of sight, so the road always has traffic without simulating all of it.
//
// traffic.js picks this file for maps that ask for "two-lane" (the default).
// ---------------------------------------------------------------------------
import { GAMEPLAY } from '../config.js';
import { clamp } from '../core/mathUtils.js';
import { TRAFFIC_CARS } from '../vehicles/carSpecs.js';
import { createAiCar, placeAi, removeAi, moveAi, safeSpeed, findAhead, signalSpeed } from './aiCar.js';

/** @param settings { count, speedLimit } — from the map, see traffic.js */
export function createTwoLaneTraffic(scene, map, settings) {
  const ids = Object.keys(TRAFFIC_CARS);
  const cars = [];
  for (let k = 0; k < settings.count; k++) {
    const id = ids[k % ids.length];
    const ai = createAiCar(scene, id, TRAFFIC_CARS[id], 'traffic');
    ai.cruise = settings.speedLimit;
    ai.tailgated = 0;       // seconds someone has been close behind
    ai.yielding = 0;        // seconds left of "pulled over to let someone by"
    ai.honk = false;        // set true for one frame when this driver honks
    cars.push(ai);
  }

  // Put a car somewhere sensible relative to the player.
  function spawn(ai, playerS, everyone, anywhere) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const offset = anywhere
        ? (Math.random() * 2 - 1) * GAMEPLAY.despawnDistance * 0.9
        : (Math.random() < 0.65 ? 1 : -1) * (GAMEPLAY.spawnDistance + Math.random() * 160);
      const s = map.wrap(playerS + offset);
      if (map.nearEnd(s, 60) || Math.abs(offset) < 90) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      // Not on top of another car in the same lane.
      if (everyone.some((o) => o.active && o !== ai && o.dir === dir && Math.abs(map.ahead(o.s, s)) < 45)) continue;
      ai.pace = (0.82 + Math.random() * 0.3) * (ai.spec.mass > 2000 ? 0.85 : 1);     // this driver's speed, as a share of the limit
      ai.cruise = map.at(map.road.limit, s) * ai.pace;
      ai.lane = 1; ai.laneWait = 0;                 // starts in the right-hand lane (where there are two)
      placeAi(ai, map, s, dir, ai.cruise * 0.9, ai.spec.colors[Math.floor(Math.random() * ai.spec.colors.length)]);
      ai.tailgated = 0; ai.yielding = 0;
      return true;
    }
    return false;
  }

  return {
    cars,
    reset(playerS, everyone) { for (const ai of cars) { removeAi(ai); spawn(ai, playerS, everyone, true); } },

    /**
     * @param everyone   all cars on the road, including the player's shadow
     * @param playerInfo { s, d, dir, speed, flashing, honking } — what the player is doing
     */
    update(dt, playerInfo, everyone) {
      for (const ai of cars) {
        ai.honk = false;
        if (!ai.active) { spawn(ai, playerInfo.s, everyone, false); continue; }
        const fromPlayer = map.ahead(playerInfo.s, ai.s);
        if (Math.abs(fromPlayer) > GAMEPLAY.despawnDistance || map.nearEnd(ai.s, 40)) { removeAi(ai); continue; }
        think(ai, dt, playerInfo, everyone);
        moveAi(ai, dt, map);
      }
    },
  };

  function think(ai, dt, playerInfo, everyone) {
    // 1. Speed for the road itself.
    ai.cruise = map.at(map.road.limit, ai.s) * (ai.pace || 1);       // the limit of this stretch of road
    let want = Math.min(ai.cruise, safeSpeed(map, ai, 70, 2.8, 2.5), signalSpeed(map, ai, 3.2));
    ai.lights.left = ai.lights.right = false;
    // Two lanes each way: pass a slower car in the left-hand lane, then come back to the right.
    ai.laneWait = Math.max(0, (ai.laneWait || 0) - dt);
    if (map.road.lanes[map.indexAt(ai.s)] > 1 && ai.laneWait === 0) {
      const slower = findAhead(map, ai, everyone, map.laneCentre(ai.s, ai.dir, ai.lane), 45);
      const laneClear = (lane) => !everyone.some((o) => o !== ai && o.active && Math.abs(o.d - map.laneCentre(ai.s, ai.dir, lane)) < 1.8
        && map.ahead(ai.s, o.s) * ai.dir > -14 && map.ahead(ai.s, o.s) * ai.dir < 38);
      if (ai.lane === 1 && slower && slower.speed >= 0 && slower.speed < ai.cruise - 2 && laneClear(0)) { ai.lane = 0; ai.laneWait = 4; }
      else if (ai.lane === 0 && laneClear(1)) { ai.lane = 1; ai.laneWait = 4; }
    }
    let lane = map.laneCentre(ai.s, ai.dir, ai.lane);
    if (Math.abs(ai.d - lane) > 0.8) ai.lights[(lane - ai.d) * ai.dir > 0 ? 'right' : 'left'] = true;       // indicating while it changes lane
    ai.honkWait = (ai.honkWait || 0) - 1 / 60;
    ai.lights.head = 1;

    // 2. Is someone pushing from behind? (the player or a rival)
    let pusher = null;
    for (const o of everyone) {
      if (o === ai || !o.active || !(o.isPlayer || o.kind === 'rival') || o.dir !== ai.dir) continue;
      const behind = map.ahead(o.s, ai.s) * ai.dir;
      const asking = o.isPlayer && (playerInfo.flashing || playerInfo.honking);
      if (behind > 0 && behind < (asking ? 45 : 16) && Math.abs(o.d - ai.d) < 2.2 && (o.speed > ai.speed - 1 || asking)) pusher = { asking };
    }
    ai.tailgated = pusher ? ai.tailgated + dt : Math.max(0, ai.tailgated - dt * 2);
    if (pusher && (pusher.asking || ai.tailgated > 1.6)) ai.yielding = 4;
    if (ai.yielding > 0) {
      ai.yielding -= dt;
      lane += ai.dir * 1.35;                       // hug the right edge
      want = Math.min(want, ai.cruise * 0.72);
      ai.lights.right = true;                      // right indicator on
    }

    // 3. Keep a gap to the car ahead (2 second rule + a car length).
    const ahead = findAhead(map, ai, everyone, ai.d, 70);
    if (ahead) {
      const safeGap = 4 + ai.speed * 1.5;
      if (ahead.speed < 0) {
        // Something is coming at us head-on in our lane!
        if (ahead.gap < 90) {
          want = Math.min(want, ai.speed * 0.4);
          lane += ai.dir * 1.3;
          if (ai.honkWait <= 0) { ai.honk = true; ai.honkWait = 4; }   // lean on the horn (no high-beam flash: it blinded the player)
        }
      } else if (ahead.gap < safeGap) {
        want = Math.min(want, Math.max(0, ahead.speed * clamp(ahead.gap / safeGap, 0, 1.05) - (ahead.gap < 3 ? 3 : 0)));
      }
    }
    ai.wantSpeed = want;
    ai.wantD = lane;
    ai.maxBrake = ahead && ahead.gap < 10 ? 8.5 : 4.5;
    ai.maxAccel = 1.9;
  }
}
