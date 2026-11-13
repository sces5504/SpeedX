// Headless sanity test for the car physics:  node tools/physics-test.mjs
// Prints 0-100 km/h, top speed, braking distance and cornering grip per car.
import fs from 'node:fs';
import { finishSpec } from '../src/vehicles/carSpecs.js';
import { createVehicle, stepVehicle } from '../src/vehicles/vehiclePhysics.js';

// Read every hero car straight from its content folder (so add-on cars are tested too).
const HERO_CARS = Object.fromEntries(JSON.parse(fs.readFileSync('public/content/cars/index.json')).cars
  .map((id) => [id, finishSpec({ id, ...JSON.parse(fs.readFileSync(`public/content/cars/${id}/car.json`)) })])
  .filter(([, spec]) => spec.role === 'hero'));
const only = process.argv[2];                       // optional: node tools/physics-test.mjs <carId>
const dt = 1 / 240;
const flat = { grip: 1, slopeForward: 0, slopeRight: 0, extraDrag: 0 };
const run = (v, controls, seconds, each) => {
  for (let t = 0; t < seconds; t += dt) { stepVehicle(v, controls(t, v), dt, flat); if (each && each(t, v) === false) break; }
};

for (const [id, spec] of Object.entries(HERO_CARS)) {
  if (only && id !== only) continue;
  // Acceleration + top speed
  let v = createVehicle(spec), t100 = null, t160 = null;
  run(v, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: false }), 60, (t, v) => {
    if (!t100 && v.speed >= 27.78) t100 = t;
    if (!t160 && v.speed >= 44.44) t160 = t;
  });
  const top = v.speed * 3.6, topGear = v.gear;
  // Braking from 100 km/h
  v = createVehicle(spec); v.vz = -27.78; v.gear = 3;
  const z0 = v.z; let stopT = 0;
  run(v, () => ({ throttle: 0, brake: 1, steer: 0, handbrake: false }), 10, (t, v) => { stopT = t; return v.speed > 0.3 && v.gear !== -1; });
  const brakeDist = Math.abs(v.z - z0);
  // Cornering: hold 80 km/h-ish in 3rd and steer fully, measure lateral g and slide angle
  v = createVehicle(spec); v.vz = -25; v.gear = 3;
  let latG = 0, maxBeta = 0, spun = false;
  run(v, (t, v) => ({ throttle: v.speed < 25 ? 0.6 : 0.2, brake: 0, steer: t > 0.5 ? 1 : 0, handbrake: false }), 8, (t, v) => {
    if (t > 4) { latG = Math.max(latG, Math.abs(v.accelLat) / 9.81); }
    const beta = Math.abs(Math.atan2(v.sideSpeed, Math.abs(v.forwardSpeed) + 0.1));
    maxBeta = Math.max(maxBeta, beta); if (beta > 1.2) spun = true;
  });
  // Full throttle while cornering in 2nd (power oversteer check)
  v = createVehicle(spec); v.vz = -14; v.gear = 2;
  let betaPower = 0, spunPower = false;
  run(v, (t) => ({ throttle: t > 1.5 ? 1 : 0.3, brake: 0, steer: 1, handbrake: false }), 6, (t, v) => {
    const beta = Math.abs(Math.atan2(v.sideSpeed, Math.abs(v.forwardSpeed) + 0.1));
    betaPower = Math.max(betaPower, beta); if (beta > 1.3) spunPower = true;
  });
  // High-speed turn-in: 160 km/h, full steering for 2 s -> how much does the heading change?
  v = createVehicle(spec); v.vz = -44; v.gear = 4;
  run(v, (t) => ({ throttle: 0.5, brake: 0, steer: 1, handbrake: false }), 2);
  const turn = v.yaw * 57.3, betaHi = Math.atan2(v.sideSpeed, Math.abs(v.forwardSpeed)) * 57.3;
  // Brake hard in the middle of a 130 km/h corner: the tail must NOT step out.
  v = createVehicle(spec); v.vz = -36; v.gear = 4;
  let brakeSlide = 0, brakeSlideFast = 0;
  run(v, (t) => ({ throttle: t < 1.2 ? 0.5 : 0, brake: t < 1.2 ? 0 : 1, steer: 1, handbrake: false }), 3.2, (t, v) => {
    const slide = Math.abs(Math.atan2(v.sideSpeed, Math.abs(v.forwardSpeed) + 0.1)) * 57.3;
    if (v.speed > 4) brakeSlide = Math.max(brakeSlide, slide);
    if (v.speed > 15) brakeSlideFast = Math.max(brakeSlideFast, slide);
  });
  // Handbrake turn at 90 km/h: the tail SHOULD step out.
  v = createVehicle(spec); v.vz = -25; v.gear = 3;
  let handSlide = 0;
  run(v, (t) => ({ throttle: 0, brake: 0, steer: 1, handbrake: t > 0.4 && t < 1.4 }), 2.5, (t, v) => {
    if (v.speed > 4) handSlide = Math.max(handSlide, Math.abs(Math.atan2(v.sideSpeed, Math.abs(v.forwardSpeed) + 0.1)) * 57.3);
  });
  console.log(`      brake-in-corner slide ${brakeSlideFast.toFixed(0)}° above 55 km/h, ${brakeSlide.toFixed(0)}° overall (want < 10 / < 20)   handbrake slide ${handSlide.toFixed(0)}° (want > 20)`);
  // The same at 230 km/h, and while braking from 200 km/h (trail-braking into a corner).
  v = createVehicle(spec); v.vz = -64; v.gear = 5;
  run(v, () => ({ throttle: 0.6, brake: 0, steer: 1, handbrake: false }), 2);
  const turnFast = v.yaw * 57.3;
  v = createVehicle(spec); v.vz = -55; v.gear = 5;
  run(v, () => ({ throttle: 0, brake: 1, steer: 1, handbrake: false }), 2);
  console.log(`      turn-in @230: ${turnFast.toFixed(0)}° in 2 s   braking from 200 with full steering: ${(v.yaw * 57.3).toFixed(0)}° in 2 s`);
  console.log(`      turn-in @160: ${turn.toFixed(0)}° in 2 s (slide ${betaHi.toFixed(0)}°)`);
  console.log(`${id.padEnd(5)} 0-100 ${t100?.toFixed(1)}s  0-160 ${t160?.toFixed(1)}s  top ${top.toFixed(0)} km/h (gear ${topGear})  100-0 ${brakeDist.toFixed(1)} m  corner ${latG.toFixed(2)} g  slide ${(maxBeta * 57.3).toFixed(0)}°${spun ? ' SPUN' : ''}  power-slide ${(betaPower * 57.3).toFixed(0)}°${spunPower ? ' SPUN' : ''}`);
}
