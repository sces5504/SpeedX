// ---------------------------------------------------------------------------
// pois.js — puts buildings and street furniture beside the road:
//   * the roadside stops listed in map.json "pois" — a gas station, a
//     mini-mart or a turnout, each laid out here from library objects.
//     Stops are also the game's fast-travel points, on every map.
//   * single objects listed in map.json "objects" (a lamp on a bend, a sign...)
//   * the road-closed barriers at both ends
//
// This file decides WHERE things go and where you can press E. What they look
// like, what glows and what is solid comes with each object (buildings.js, by
// way of the shared library in library.js).
// Positions inside a stop are given as (along, out):
//   along = metres further up the road from the middle of the lot
//   out   = metres away from the centre line, into the lot — measured as if the road had
//           the standard width (ROAD in config.js). Beside a wider or narrower road the
//           whole lot is moved out or in by poi.shift (worked out in mapData.js).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { ROAD } from '../config.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';
import { ROAD_GLARE } from './road.js';
import { box, darkMetal } from './buildings.js';
import { makeObject } from './library.js';
import { drawNear } from '../render/drawDistance.js';

const lotPaint = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0xcfcfc8, roughness: 0.6 }), { retro: 0.4, wet: true, limit: ROAD_GLARE });
// The neon of a stop unless its entry in map.json says otherwise ("color", "accent", "light", "sign"):
// color = the brand's tubes and signs, accent = the second neon colour, light = the light under the roof.
const STOP_LOOK = {
  gas: { color: '#ff3a24', accent: '#ffb000', light: '#5cffc4', sign: 'CREST' },      // red and amber neon over mint-green light
  mart: { color: '#19e0a0', accent: '#ff4fd8', light: '#bfe9ff', sign: 'MART' },      // green and pink neon over cool white light
};

// ---- The kinds of stop ---------------------------------------------------------------
// A layout puts library objects into one lot. It gets a toolkit `lot`:
//   lot.poi                                    the stop's entry in map.json (name, length, depth, color, sign)
//   lot.place(object, along, out, y?, turn?)   put an object in the lot
//   lot.park(along, out, turn, who?)           mark a place where a parked car may stand
// To add a kind of stop: write its layout, add it to STOP_LAYOUTS, and describe it in
// public/content/props/index.json ("builtIn" -> "stops") so maps and tools know it exists.
const STOP_LAYOUTS = { gas: layStation, mart: layStation, turnout: layTurnout };

// Gas station or mini-mart: pump canopy, store with parking bays, price sign, two lamps.
function layStation({ poi, half, place, park }) {
  const isMart = poi.type === 'mart';
  const base = STOP_LOOK[poi.type], name = poi.name.toUpperCase();
  const color = poi.color || base.color, accent = poi.accent || base.accent, light = poi.light || base.light;
  place(makeObject('gas-canopy', { color, accent, light, name }), -8, 15);                    // (the canopy brings its own "press E to refuel")
  place(makeObject('store', { color, accent, name, mart: isMart }), 16, poi.depth - 5);
  for (let k = 0; k < 4; k++) {
    park(9.5 + k * 3.4, poi.depth - 12.5, -Math.PI / 2);
    place(box(0.25, 0.14, 1.9, lotPaint), 9.5 + k * 3.4, poi.depth - 10.4, 0.07);             // wheel stop
  }
  for (let k = 0; k <= 4; k++) place(box(4.8, 0.012, 0.1, lotPaint), 7.8 + k * 3.4, poi.depth - 12.6, 0.008);   // bay lines
  if (isMart) ['#2a66ff', '#ff3b30'].forEach((machine, k) => place(makeObject('vending-machine', { color: machine }), 27 + k * 1.3, poi.depth - 9.6));   // by the door
  place(makeObject('price-sign', { color, name: poi.sign || base.sign }), -half + 6, ROAD.barrierOffset + 3.5);   // near the road, seen from far away
  for (const a of [-half + 4, half - 4]) place(makeObject('street-lamp', { color: '#ffb46a' }), a, ROAD.barrierOffset + 2.6);   // sodium orange, not white
}

// Turnout: one sodium lamp, an info board, room for racers to meet.
function layTurnout({ poi, place, park }) {
  place(makeObject('street-lamp', { color: '#ffa040' }), 0, poi.depth - 1);
  place(makeObject('info-board', { name: poi.name.toUpperCase() }), 14, poi.depth - 1.5, 0, -Math.PI / 2);
  for (let k = 0; k < 3; k++) park(-22 + k * 7, poi.depth - 4.5, 0.25, 'racers');
}

export function buildPois(map) {
  const group = new THREE.Group();
  group.name = 'pois';
  const lamps = [];          // places where a real light should shine: { position, color, intensity }
  const interactables = [];  // places where pressing E does something
  const parking = [];        // spots where parked cars can be placed: { x, y, z, yaw }
  const obstacles = [];      // solid things you can crash into: { x, z, yaw, halfWidth, front, rear }
  const neons = [];          // glowing signs that tint what is near them: { position, color, power }  (see render/smallLights.js)

  // Put an object beside the road: s metres along it, `out` metres from the centre line on
  // side +1 (right, looking up the road) or -1. Its +X then points away from the road.
  // Whatever the object says glows or is solid (userData, see buildings.js) is noted down.
  const placeAt = (object, s, side, out, y = 0, turn = 0, poi = null) => {
    const p = map.pointAt(s, out * side);
    object.position.set(p.x, p.y + y, p.z);
    object.rotation.y = p.yaw + (side > 0 ? 0 : Math.PI) + turn;
    (poi?.group || group).add(object);          // a stop's things are kept together (see below)
    object.updateMatrixWorld(true);
    for (const lamp of object.userData.lamps || []) lamps.push({ ...lamp, poi, position: object.localToWorld(lamp.at.clone()) });
    for (const neon of object.userData.neons || []) neons.push({ ...neon, position: object.localToWorld(neon.at.clone()) });
    const todo = object.userData.interact;
    if (todo) interactables.push({ type: todo.type, label: todo.label, radius: todo.radius, position: object.localToWorld(todo.at.clone()), poi });
    for (const [x, z, across, along] of object.userData.solids || []) {
      const centre = object.localToWorld(new THREE.Vector3(x, 0, z));
      obstacles.push({ x: centre.x, z: centre.z, yaw: object.rotation.y, halfWidth: across / 2, front: along / 2, rear: along / 2 });
    }
    return object;
  };

  // ---- Roadside stops -----------------------------------------------------------
  // Every stop, whatever its kind, is a FAST-TRAVEL POINT (the map screen lists them all),
  // has a row of concrete barriers along its back edge and a cone where a time attack starts.
  // What else stands in it is up to the layout for its kind (STOP_LAYOUTS, below).
  for (const poi of map.pois) {
    const half = poi.length / 2;
    // Everything of one stop goes in a group of its own, drawn only when the stop is near
    // (render/drawDistance.js) — a lit station a kilometre down a straight road is still a lot to draw.
    poi.group = new THREE.Group();
    group.add(poi.group);
    const lot = {
      poi, half,
      // put a library object (along, out) inside this lot
      place: (object, along, out, y = 0, turn = 0) => placeAt(object, poi.s + along, poi.side, out + poi.shift, y, turn, poi),
      // a place where a parked car may stand; who = 'traffic' (ordinary cars) or 'racers'
      park(along, out, turn, who = 'traffic') {
        const p = map.pointAt(poi.s + along, (out + poi.shift) * poi.side);
        parking.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw + turn * poi.side, poi, who });
      },
    };
    for (let a = -half; a <= half; a += 3.4) lot.place(makeObject('barrier'), a, poi.depth + 0.9);
    STOP_LAYOUTS[poi.type]?.(lot);
    const cone = map.pointAt(poi.s - half + 14, (ROAD.barrierOffset + poi.shift + 1.2) * poi.side);
    lot.place(makeObject('cone'), -half + 14, ROAD.barrierOffset + 1.2);
    interactables.push({ type: 'challenge', label: 'Start time attack', position: new THREE.Vector3(cone.x, cone.y, cone.z), radius: 6, poi });
    drawNear(poi.group);
  }

  // ---- Single objects the map asks for ("objects" in map.json) ------------------------
  // { "prop": name in the library, "s": metres along the road, "side": 1 | -1, "out": metres from the
  //   centre line (the flat verge ends about 10 m out), "turn": degrees, plus the object's own options }
  for (const wish of map.info.objects || []) {
    const object = makeObject(wish.prop, wish);
    if (object) placeAt(object, wish.s, wish.side ?? 1, wish.out ?? map.at(map.road.barrier, wish.s) + 2, 0, THREE.MathUtils.degToRad(wish.turn || 0));
    else console.warn(`map.json asks for "${wish.prop}", which is not in the library (see src/world/library.js)`);
  }

  // ---- Road closed barriers at both ends --------------------------------------
  const stripes = canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e2571a';
    for (let x = -h; x < w; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 16, 0); g.lineTo(x + 16, h); g.fill(); }
  });
  const stripeMat = enhanceMaterial(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5 }), { retro: 3 });
  for (const s of map.road.closed ? [] : [5, map.road.length - 5]) {            // (a loop has no ends to close)
    for (const d of [-4, 0, 4]) {
      const p = map.pointAt(s, d);
      const barrier = new THREE.Group();
      for (const y of [0.55, 1.0, 1.45]) barrier.add(box(3.0, 0.24, 0.05, stripeMat, 0, y, 0));
      barrier.add(box(0.08, 1.6, 0.5, darkMetal, -1.3, 0.8, 0), box(0.08, 1.6, 0.5, darkMetal, 1.3, 0.8, 0));
      barrier.position.set(p.x, p.y, p.z); barrier.rotation.y = p.yaw;
      group.add(barrier);
    }
  }
  return { group, lamps, interactables, parking, obstacles, neons };
}
