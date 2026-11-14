// ---------------------------------------------------------------------------
// library.js — the shared library: every ready-made thing a map can be built
// from, by name. Any map can use any of them from its map.json:
//
//   PLANTS    scattered beside the road by the thousand (plants.js)
//               "scenery": [{ "prop": "pine", "perKm": 170, ... }]
//   OBJECTS   buildings and street furniture, placed one at a time (buildings.js)
//               "objects": [{ "prop": "street-lamp", "s": 1200, "side": 1, "out": 9 }]
//   GROUNDS   what the mountain itself looks like (terrain.js)
//               "ground": "chaparral"
//
// Whole roadside stops ("gas", "mart", "turnout" in a map's "pois") are laid out
// from the same objects in pois.js.
//
//   BUILDINGS ordinary buildings of a town, street furniture and landmarks (town.js)
//               "buildings": [{ "kind": "seafood", "at": [x, z] }]      one at a time
//               "roadside":  [{ "kind": "road-lamp", "from": 0, "to": 5000, "spacing": 48, "side": -1 }]
//             Made for Taiwan and meant to be reused by every Taiwanese map: townhouses, sheet-metal
//             shacks, cafés, eateries, seafood restaurants, temples, bus shelters, sodium road lamps,
//             utility poles, pylons — and landmarks, each modelled on one real place.
//   ROAD      kinds of road (ROAD_TYPES in config.js): two-lane, divided four-lane, narrow country road
//   also for Taiwan: the plants casuarina, broadleaf, pandanus, silvergrass; the ground "north-coast";
//   the sea ("sea": true); round km/h speed signs ("signs": "tw").
//
// A model file in public/content/props/<id>/ with the same name replaces the
// built-in plant or object. The same list, for people and for
// tools/check-content.mjs, is in public/content/props/index.json ("builtIn").
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { getProp, makeProp } from './props.js';
import { PLANTS } from './plants.js';
import { BUILDING_KINDS, buildOne } from './town.js';
import { buildBarrier, buildCanopy, buildCone, buildInfoBoard, buildPylon, buildStore, buildStreetLamp, buildVendingMachine } from './buildings.js';

const hex = (color) => new THREE.Color(color).getHex();
// The neon colours a map may set on a building, passed on only if given (otherwise the building's own defaults).
const neonOf = ({ accent, light }) => ({ ...(accent && { accent: hex(accent) }), ...(light && { light: hex(light) }) });

// Each object is made from a few options (all optional), which a map can give in its "objects" list:
//   color  the brand / lamp / paint colour, e.g. "#ff3a24"      name  the text on its sign
//   accent, light  (lit buildings) the second neon colour, and the colour of the light under its roof
export const OBJECTS = {
  'gas-canopy': ({ color = '#ff3a24', name = 'FUEL', ...rest } = {}) => buildCanopy(hex(color), name, neonOf(rest)),   // neon-lit roof over two pump islands, 8.6 x 13.6 m
  'store': ({ color = '#ff3a24', name = 'STORE', mart = false, ...rest } = {}) => buildStore(hex(color), name, mart, neonOf(rest)),   // lit shop, 8 x 18 m; mart: 24H sign and drinks neon
  'price-sign': ({ color = '#ff3a24', name = 'FUEL' } = {}) => buildPylon(hex(color), name),            // 10 m fuel price sign in a frame of neon
  'street-lamp': ({ color = '#fff1d6' } = {}) => buildStreetLamp(hex(color)),                           // 8 m pole, arm toward the road ("#ffa040" = sodium orange)
  'vending-machine': ({ color = '#2a66ff' } = {}) => buildVendingMachine(hex(color)),
  'info-board': ({ name = 'VISTA POINT' } = {}) => buildInfoBoard(name),                               // wooden sign for a turnout
  'barrier': () => buildBarrier(),                                                                      // concrete, 2.8 m long
  'cone': () => buildCone(),
};

// Every kind of town building, landmark and street furniture (town.js) is an object of the library
// too — registered here by itself, so nothing has to be added by hand when a new kind is written.
for (const kind of BUILDING_KINDS) if (!OBJECTS[kind]) OBJECTS[kind] = (options) => buildOne(kind, options);

export { PLANTS };      // (made in plants.js; listed here so the whole library can be read from one file)
export { BUILDING_KINDS };      // (made in town.js: every kind a map's "buildings" and "roadside" may name)

// How the bare mountain is coloured. gentle = flat ground (brush, soil), steep = cliffs (rock),
// shore (optional) = the lowest few metres beside the sea, on a map that has one;
// the dirt-and-stones picture from materials.js is tinted with these.
export const GROUNDS = {
  chaparral: { gentle: [0.42, 0.40, 0.28], steep: [0.72, 0.64, 0.52] },      // dry Californian hills
  // Taiwan's north coast: wet green hills, dark volcanic rock, and (shore) grey-brown sand by the water.
  'north-coast': { gentle: [0.24, 0.36, 0.19], steep: [0.40, 0.39, 0.35], shore: [0.52, 0.48, 0.40] },
};

// The parts of a plant for scenery.js: [{ geometry, material }, ...], or null if there is no such plant.
const plantCache = new Map();
export function plantParts(id) {
  const model = getProp(id);
  if (model) return [model];
  if (!PLANTS[id]) return null;
  if (!plantCache.has(id)) plantCache.set(id, PLANTS[id]());
  return plantCache.get(id);
}

// One building or piece of street furniture, ready to be put in the scene (null if the name is unknown).
export function makeObject(id, options) {
  return makeProp(id) || OBJECTS[id]?.(options) || null;
}
