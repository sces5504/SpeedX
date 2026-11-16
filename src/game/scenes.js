// ---------------------------------------------------------------------------
// scenes.js — the game's scenes, written as lists of shots for the director
// (render/director.js: what a shot is, and the rules about skipping).
//
//   garageIn / garageOut    the roller door goes up and the car drives in; later it drives out again
//   dealerIn                a look along the showroom window, then in through the doors
//   rollingStart            a Blacklist race begins: both cars side by side, driven by the game, 3 - 2 - 1
//   gameIntro               the first time a career starts: the car, the place, what to do
// (A Blacklist driver's own introduction is in game/blacklistIntros.js: every driver has one.)
//
// Each function only DESCRIBES a scene and returns its shots. main.js plays it and
// says what happens when it ends. Positions round a building are worked out from
// the building itself (its own coordinates: +X away from the road), so a scene works
// at every garage and every dealership on every map.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { angleDiff } from '../core/mathUtils.js';
import { poseAi } from '../ai/aiCar.js';
import { beside, between, ease } from '../render/director.js';

// A point given in a building's own coordinates, as [x, y, z] in the world.
const from = (building, x, y, z) => building.localToWorld(new THREE.Vector3(x, y, z)).toArray();
// The way a car must face to drive from one point to another.
const facing = (a, b) => Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));

// Where things are at a garage: the car waits at `outside`, squarely in front of the door, and ends up at `inside`.
function garagePlaces(garage) {
  const { z, front } = garage.userData.entry;
  const outside = from(garage, front - 8.5, 0, z), inside = from(garage, front + 5.2, 0, z);
  return { z, front, outside, inside, yawIn: facing(outside, inside) };
}

/** Drive into the garage. player = the player's car (vehicles/playerCar.js); fade = director.fade */
export function garageIn(garage, player, fade) {
  const { z, front, outside, inside, yawIn } = garagePlaces(garage), v = player.vehicle;
  const start = { x: v.x, z: v.z, yaw: v.yaw };
  return [
    { // 1. The car lines up with the door while the door rolls up.
      seconds: 2.0,
      camera: (t) => ({ at: from(garage, front - 14 + t * 1.5, 1.2, z + 6), look: from(garage, front, 1.5, z), fov: 40 }),
      update(t, dt) {
        const k = ease(t);
        player.pose(start.x + (outside[0] - start.x) * k, start.z + (outside[2] - start.z) * k, start.yaw + angleDiff(yawIn, start.yaw) * k, 2 * (1 - t), dt);
        garage.userData.setDoor(ease(Math.max(0, (t - 0.25) / 0.75)));
      },
    },
    { // 2. It drives in. Seen from low down beside the doorway; the picture goes dark as it disappears inside.
      seconds: 2.4,
      camera: (t) => ({ at: from(garage, front - 10.5, 0.6, z - 3.4), look: [v.x, v.y + 0.6, v.z], fov: 38 + t * 6 }),
      update(t, dt) {
        const at = between(outside, inside, ease(t));
        player.pose(at[0], at[2], yawIn, 5 * Math.sin(Math.PI * t), dt);
        if (t > 0.7) fade(1, 0.5);
      },
    },
  ];
}

/** Drive out of the garage (the car starts inside, nose to the door) and shut the door behind it. */
export function garageOut(garage, player, fade) {
  const { z, front, outside, inside, yawIn } = garagePlaces(garage), yawOut = yawIn + Math.PI, v = player.vehicle;
  const away = from(garage, front - 11.5, 0, z);                 // a little further out than where it waited to go in
  return [{
    seconds: 3.0,
    enter() { garage.userData.setDoor(1); player.pose(inside[0], inside[2], yawOut); fade(0, 0.6); },
    camera: (t) => ({ at: from(garage, front - 16, 0.9 + t * 0.5, z - 2.8), look: [v.x, v.y + 0.6, v.z], fov: 36 }),
    update(t, dt) {
      const at = between(inside, away, ease(Math.min(1, t / 0.75)));
      player.pose(at[0], at[2], yawOut, t < 0.75 ? 5 * Math.sin((Math.PI * t) / 0.75) : 0, dt);
      garage.userData.setDoor(1 - ease(Math.max(0, (t - 0.55) / 0.45)));
    },
  }];
}

/** Arrive at the dealership: along the lit window, then in through the doors. */
export function dealerIn(dealership, fade) {
  const front = -6;                                               // (the showroom is 12 m deep: its front wall is 6 m from its middle)
  return [
    { seconds: 2.6, camera: (t) => ({ at: from(dealership, front - 9 + ease(t) * 2, 1.5, 11.5 - ease(t) * 8.5), look: from(dealership, 2, 1.1, 6.2), fov: 34 }) },
    { seconds: 1.6, camera: (t) => ({ at: from(dealership, front - 7 + ease(t) * 5.5, 1.5, -3), look: from(dealership, 5, 1.4, -3), fov: 42 }),
      update(t) { if (t > 0.45) fade(1, 0.6); } },
  ];
}

/**
 * THE ROLLING START of a Blacklist race. Both cars are driven by the game, side by side along the
 * road the player is on: nobody can gain anything before the line. Three cameras, then 3 - 2 - 1
 * from behind the player's car - and at GO the car is theirs again, already at speed.
 *   boss  = the driver's AI car;  way, dir, s = the road, the direction along it and where the run begins
 *   tools = { caption(big, small), big(text, colour), beep(pitch), world(dt) (the traffic keeps moving),
 *             filmLight(on) (the soft light of a replay, for the shots from outside the car) }
 */
export function rollingStart(entry, player, boss, { way, dir, s }, tools) {
  const v = player.vehicle, CRUISE = 25;                       // metres per second: 90 km/h
  let speed = Math.max(10, v.speed), counted = 0;
  // Where each car runs: the player in the lane they would drive in, the driver in the lane beside it.
  const lanesAt = (at) => {
    const lanes = way.road.lanes[way.indexAt(at)], own = way.laneCentre(at, dir, lanes - 1);
    return { own, other: lanes > 1 ? way.laneCentre(at, dir, 0) : -own };
  };
  // The driver's car, seen from the player's seat: so many metres to the right (minus = to the left).
  const across = () => { const lanes = lanesAt(s); return (lanes.other - lanes.own) * dir; };
  const roll = (dt) => {
    speed = Math.min(CRUISE, speed + 6 * dt);
    s = way.wrap(s + dir * speed * dt);
    const lanes = lanesAt(s), p = way.pointAt(s, lanes.own);
    player.pose(p.x, p.z, p.yaw + (dir < 0 ? Math.PI : 0), speed, dt);
    Object.assign(boss, { way, s, dir, d: lanes.other, wantD: lanes.other, speed, wantSpeed: speed, sideSpeed: 0, turn: null, plan: null });
    poseAi(boss, dt);
    tools.world(dt);
  };
  const middle = (up, ahead) => beside(v, across() / 2, up, ahead);       // a point between the two cars
  let tripod = null;
  return [
    { // 1. From in front and low, looking back at the two of them coming on side by side.
      seconds: 2.6,
      enter() { roll(0); tools.filmLight(true); tools.caption(entry.name, `${(entry.raceLength / 1000).toFixed(1)} km · rolling start`); },
      camera: (t) => ({ at: middle(0.42, 11 - t * 2.5), look: middle(0.75, 0), fov: 34 }),
      update: (t, dt) => roll(dt),
      leave() { tools.caption(''); },
    },
    { // 2. A camera standing at the roadside: they go past it.
      seconds: 1.8,
      enter() { const there = way.pointAt(way.wrap(s + dir * 34), lanesAt(s).own + dir * 4.5); tripod = [there.x, there.y + 0.7, there.z]; },
      camera: () => ({ at: tripod, look: middle(0.6, 0), fov: 44 }),
      update: (t, dt) => roll(dt),
    },
    { // 3. Behind the player's car, where the driving camera will be: 3 - 2 - 1.
      seconds: 3.0,
      enter() { tools.filmLight(false); },
      camera: () => ({ at: beside(v, 0, 2.2, -5.4), look: beside(v, 0, 0.7, 9), fov: 62 }),
      update(t, dt) {
        roll(dt);
        const number = 3 - Math.min(2, Math.floor(t * 3));
        if (number !== counted && t < 1) { counted = number; tools.big(String(number)); tools.beep(660); }
      },
      leave() { tools.big(''); },
    },
  ];
}

/** The opening of a new career. caption = director.caption */
export function gameIntro(player, placeName, caption) {
  const v = player.vehicle;
  return [
    { seconds: 3.4, enter() { caption('SPEEDX', placeName.toUpperCase()); },
      camera: (t) => ({ at: between(beside(v, 15, 9, -19), beside(v, 9, 4.5, -10), ease(t)), look: [v.x, v.y + 0.5, v.z], fov: 42 }) },
    { seconds: 3.2, enter() { caption('BEAT THE STREET RACERS', 'flash your lights at one · win reputation and money'); },
      camera: (t) => ({ at: between(beside(v, 2.6, 0.5, 5), beside(v, -2.6, 0.55, 5), ease(t)), look: beside(v, 0, 0.6, 0), fov: 36 }) },
    { seconds: 3.4, enter() { caption('TAKE THE BLACKLIST', 'reach a driver\'s reputation · beat them · their car is yours'); },
      camera: (t) => ({ at: between(beside(v, -1.6, 0.8, -5.5), beside(v, 0, 1.7, -6.8), ease(t)), look: beside(v, 0, 0.7, 4), fov: 40 }),
      leave() { caption(''); } },
  ];
}
