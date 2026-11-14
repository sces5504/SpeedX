// ---------------------------------------------------------------------------
// traffic.js — ordinary drivers. HOW they drive depends on the map: a mountain
// pass, a city grid with junctions and a motorway need different rules. So the
// rules live in "rule sets", one file each, and every map names the one it
// wants in its map.json:
//
//     "traffic": { "rules": "two-lane", "count": 5, "speedLimit": 22 }
//
// (all three are optional: the defaults are "two-lane" and the numbers in
// config.js -> GAMEPLAY.)
//
// To add a rule set: write  src/ai/traffic<Name>.js  exporting one function
//     create(scene, map, settings)
// that returns the same three things as trafficTwoLane.js:
//     cars                                  the AI cars it made (aiCar.js: createAiCar)
//     reset(playerS, everyone)              put them all somewhere new (after a fast travel)
//     update(dt, playerInfo, everyone)      one frame: decide and move
// then add one line to TRAFFIC_RULES below and describe it in
// public/content/props/index.json ("builtIn" -> "traffic").
// The rest of the game (collisions, near misses, rivals, the map screen) only
// looks at the cars themselves, so it works with any rule set.
// ---------------------------------------------------------------------------
import { GAMEPLAY } from '../config.js';
import { createTwoLaneTraffic } from './trafficTwoLane.js';

export const TRAFFIC_RULES = {
  'two-lane': createTwoLaneTraffic,
};

// What this map asks of its traffic, with the defaults filled in.
export function trafficSettings(map) {
  return { rules: 'two-lane', count: GAMEPLAY.trafficCount, speedLimit: GAMEPLAY.speedLimit, ...map.info.traffic };
}

export function createTraffic(scene, map) {
  const settings = trafficSettings(map);
  let create = TRAFFIC_RULES[settings.rules];
  if (!create) {
    console.warn(`This map asks for traffic rules "${settings.rules}", which do not exist (see src/ai/traffic.js). Using "two-lane".`);
    create = createTwoLaneTraffic;
  }
  return create(scene, map, settings);
}
