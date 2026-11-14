// ---------------------------------------------------------------------------
// carStats.js — measures what a car can really do in the game.
//
// Nothing here is worked out with a formula: each test puts the car on a flat,
// dry, endless car park and DRIVES it with the game's own physics
// (vehiclePhysics.js), exactly as the game would, then reads the result off
// the "stopwatch". So the arcade dials in config.js (PHYSICS.powerBoost,
// gripBoost, gearing, brakeBoost...) are all included, and the numbers change
// by themselves when the physics or a car.json changes.
//
// Two things use this file, so their numbers can never disagree:
//   tools/physics-test.mjs     prints every hero car's figures in the terminal
//   src/catalog/carsPage.js    shows them on the catalogue page
//
// No graphics, no files, no browser: plain numbers in, plain numbers out.
// Only "hero" cars can be measured (traffic cars have no engine data).
// ---------------------------------------------------------------------------
import { createVehicle, stepVehicle } from './vehiclePhysics.js';

const DT = 1 / 240;                   // the game's physics rate (60 fps x 4 substeps)
const FLAT = { grip: 1, slopeForward: 0, slopeRight: 0, extraDrag: 0 };   // level, dry asphalt
const DEGREES = 57.3;                 // radians -> degrees
const KMH = 3.6;                      // metres per second -> km/h

// Drive car `v` for `seconds`. controls(t, v) says what the driver does at time t;
// each(t, v) is called after every step and may return false to stop early.
function drive(v, controls, seconds, each) {
  for (let t = 0; t < seconds; t += DT) {
    stepVehicle(v, controls(t, v), DT, FLAT);
    if (each && each(t, v) === false) break;
  }
}

// A fresh car already rolling forward at `speed` m/s in `gear`.
function rollingCar(spec, speed, gear) {
  const v = createVehicle(spec);
  v.vz = -speed;                      // forward is -Z
  v.gear = gear;
  return v;
}

// How far the car is sliding sideways right now, in radians (0 = going where it points).
const slideAngle = (v) => Math.abs(Math.atan2(v.sideSpeed, Math.abs(v.forwardSpeed) + 0.1));

// ---- Straight line: acceleration, top speed, braking --------------------------------
export function measureStraightLine(spec) {
  // Flat out from a standstill for a minute.
  let v = createVehicle(spec), t100 = null, t160 = null;
  drive(v, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: false }), 60, (t, v) => {
    if (!t100 && v.speed >= 27.78) t100 = t;
    if (!t160 && v.speed >= 44.44) t160 = t;
  });
  const top = v.speed * KMH, topGear = v.gear;
  // Full brakes from 100 km/h.
  v = rollingCar(spec, 27.78, 3);
  const z0 = v.z;
  drive(v, () => ({ throttle: 0, brake: 1, steer: 0, handbrake: false }), 10, (t, v) => v.speed > 0.3 && v.gear !== -1);
  return {
    t100, t160,                       // seconds to 100 and 160 km/h (null = never got there)
    top, topGear,                     // km/h after a minute flat out, and the gear it was in
    brakeDist: Math.abs(v.z - z0),    // metres to stop from 100 km/h
  };
}

// ---- Cornering: grip, and whether the tail stays in line ----------------------------
export function measureCornering(spec) {
  // Hold 80 km/h-ish in 3rd and steer fully: sideways g and slide angle.
  let v = rollingCar(spec, 25, 3), latG = 0, maxSlide = 0, spun = false;
  drive(v, (t, v) => ({ throttle: v.speed < 25 ? 0.6 : 0.2, brake: 0, steer: t > 0.5 ? 1 : 0, handbrake: false }), 8, (t, v) => {
    if (t > 4) latG = Math.max(latG, Math.abs(v.accelLat) / 9.81);
    maxSlide = Math.max(maxSlide, slideAngle(v));
    if (slideAngle(v) > 1.2) spun = true;
  });
  // Full throttle while cornering in 2nd (power oversteer check).
  v = rollingCar(spec, 14, 2);
  let powerSlide = 0, spunPower = false;
  drive(v, (t) => ({ throttle: t > 1.5 ? 1 : 0.3, brake: 0, steer: 1, handbrake: false }), 6, (t, v) => {
    powerSlide = Math.max(powerSlide, slideAngle(v));
    if (slideAngle(v) > 1.3) spunPower = true;
  });
  return {
    latG,                                               // steady cornering grip, in g
    maxSlide: maxSlide * DEGREES, spun,                 // biggest slide angle on the way (degrees); spun = it went round
    powerSlide: powerSlide * DEGREES, spunPower,        // the same with the throttle floored
  };
}

// ---- Handling at speed: turn-in, braking in a bend, handbrake ------------------------
export function measureHandling(spec) {
  // High-speed turn-in: 160 km/h, full steering for 2 s -> how much does the heading change?
  let v = rollingCar(spec, 44, 4);
  drive(v, () => ({ throttle: 0.5, brake: 0, steer: 1, handbrake: false }), 2);
  const turn160 = v.yaw * DEGREES, slide160 = Math.atan2(v.sideSpeed, Math.abs(v.forwardSpeed)) * DEGREES;
  // Brake hard in the middle of a 130 km/h corner: the tail must NOT step out.
  v = rollingCar(spec, 36, 4);
  let brakeSlide = 0, brakeSlideFast = 0;
  drive(v, (t) => ({ throttle: t < 1.2 ? 0.5 : 0, brake: t < 1.2 ? 0 : 1, steer: 1, handbrake: false }), 3.2, (t, v) => {
    const slide = slideAngle(v) * DEGREES;
    if (v.speed > 4) brakeSlide = Math.max(brakeSlide, slide);
    if (v.speed > 15) brakeSlideFast = Math.max(brakeSlideFast, slide);
  });
  // Handbrake turn at 90 km/h: the tail SHOULD step out.
  v = rollingCar(spec, 25, 3);
  let handSlide = 0;
  drive(v, (t) => ({ throttle: 0, brake: 0, steer: 1, handbrake: t > 0.4 && t < 1.4 }), 2.5, (t, v) => {
    if (v.speed > 4) handSlide = Math.max(handSlide, slideAngle(v) * DEGREES);
  });
  // Turn-in again at 230 km/h, and while braking from 200 km/h (trail-braking into a corner).
  v = rollingCar(spec, 64, 5);
  drive(v, () => ({ throttle: 0.6, brake: 0, steer: 1, handbrake: false }), 2);
  const turn230 = v.yaw * DEGREES;
  v = rollingCar(spec, 55, 5);
  drive(v, () => ({ throttle: 0, brake: 1, steer: 1, handbrake: false }), 2);
  return {
    turn160, slide160,                // degrees of heading change in 2 s at 160 km/h, and the slide angle after it
    turn230,                          // the same at 230 km/h
    turnBraking200: v.yaw * DEGREES,  // ...and with the brakes on from 200 km/h
    brakeSlide, brakeSlideFast,       // slide angle when braking in a bend: overall / while still above 55 km/h
    handSlide,                        // slide angle of a handbrake turn
  };
}

// Everything at once.
export function measureCar(spec) {
  return { ...measureStraightLine(spec), ...measureCornering(spec), ...measureHandling(spec) };
}
