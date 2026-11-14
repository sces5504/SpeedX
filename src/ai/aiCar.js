// ---------------------------------------------------------------------------
// aiCar.js — the shared "body" of every computer-driven car (traffic + rivals).
//
// AI cars do not use the full tyre physics. They ride on rails: each one knows
//   s      how far along the road it is
//   d      how far right of the centre line it is
//   dir    +1 driving up the road, -1 driving down
//   speed  metres per second
// The "brain" (traffic.js / rivals.js) only decides two things every frame:
// wantSpeed and wantD. This file moves the car smoothly toward them, poses the
// 3D model, and handles being hit by the player.
// ---------------------------------------------------------------------------
import { clamp, approach, damp } from '../core/mathUtils.js';
import { buildCar, randomPlateText } from '../vehicles/carBuilder.js';

const p = {}, proj = {};

export function createAiCar(scene, specId, spec, kind) {
  const car = buildCar(spec, spec.colors[0]);
  car.group.rotation.order = 'YXZ';
  car.group.visible = false;
  scene.add(car.group);
  const fw = spec.frontWeight ?? 0.58;
  return {
    kind, specId, spec, car, active: false,
    s: 0, d: 0, dir: 1, speed: 0,
    lane: 0,                  // which lane it keeps to: 0 = next to the centre line, 1 = the next one out (map.laneCentre)
    wantSpeed: 0, wantD: 0, maxAccel: 2.0, maxBrake: 5.5,
    sideSpeed: 0,             // sideways speed (in the d direction)
    wobble: 0, wobbleSpeed: 0, // yaw shake after being hit
    stun: 0,                  // seconds left of "driver is shaken, slowing down"
    lights: { head: 1, brake: false, left: false, right: false },
    hazard: false, flash: 0,  // flash = seconds left of high-beam flashing
    blink: 0, wheelAngle: 0,
    agility: 1,               // how briskly it changes lanes (rivals: more with skill)
    beam: 0,                  // 0..1 how much of this car's light comes from a real spotlight (fades in/out)
    brakeHold: 0,             // keeps the brake lamps on briefly so they do not flicker
    lastHitTime: -99,         // used by the near-miss rule
    passSide: 0,              // was it ahead (+) or behind (-) the player last frame
    // --- "body" fields used by collisions.js ---
    x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0,
    mass: spec.mass, yawInertia: spec.mass * spec.wheelbase * spec.wheelbase * 0.26,
    halfWidth: car.dims.halfW, front: -car.dims.frontZ, rear: car.dims.rearZ, roadIndex: -1,
    accel: 0,
    calmAccel: 0, pitch: 0, roll: 0,   // slow copies of acceleration and road slope, for a body that does not twitch
  };
}

export function placeAi(ai, map, s, dir, speed, color) {
  const lane = map.laneCentre(s, dir, ai.lane);
  Object.assign(ai, { s, dir, speed, wantSpeed: speed, d: lane, wantD: lane,
    sideSpeed: 0, wobble: 0, wobbleSpeed: 0, stun: 0, hazard: false, flash: 0, active: true, roadIndex: -1, passSide: 0,
    accel: 0, calmAccel: 0, pitch: null, roll: null });
  if (color !== undefined) { ai.car.setColor(color); ai.car.plate.setText(randomPlateText()); }   // "new" car: new paint, new plate
  ai.car.group.visible = true;
  poseAi(ai, map);
}

export function removeAi(ai) { ai.active = false; ai.car.group.visible = false; }

// ---- Moving -------------------------------------------------------------------
export function moveAi(ai, dt, map) {
  const { road } = map;
  // Speed: accelerate gently, brake harder. A shaken driver slows right down.
  if (ai.stun > 0) { ai.stun -= dt; ai.wantSpeed = Math.min(ai.wantSpeed, 6); ai.hazard = true; if (ai.stun <= 0) ai.hazard = false; }
  const before = ai.speed;
  ai.speed = approach(ai.speed, ai.wantSpeed, dt * (ai.wantSpeed > ai.speed ? ai.maxAccel : ai.maxBrake));
  ai.accel = (ai.speed - before) / Math.max(dt, 1e-4);
  ai.s = map.wrap(ai.s + ai.dir * ai.speed * dt);

  // Sideways: steer toward the wanted lane position like a spring with a damper.
  const index = map.indexAt(ai.s);
  const room = (ai.d > 0 ? road.limitR[index] : road.limitL[index]) - ai.halfWidth;
  const pull = (ai.wantD - ai.d) * 2.2 * ai.agility - ai.sideSpeed * 2.6 * Math.sqrt(ai.agility);
  ai.sideSpeed += pull * dt;
  ai.sideSpeed = clamp(ai.sideSpeed, -Math.max(1, ai.speed * 0.25), Math.max(1, ai.speed * 0.25));
  ai.d += ai.sideSpeed * dt;
  if (Math.abs(ai.d) > room) { ai.d = Math.sign(ai.d) * room; ai.sideSpeed *= -0.2; }
  // Yaw wobble after a hit dies away.
  ai.wobbleSpeed += (-ai.wobble * 30 - ai.wobbleSpeed * 5) * dt;
  ai.wobble += ai.wobbleSpeed * dt;

  ai.wheelAngle += (ai.speed / ai.spec.wheelRadius) * dt;
  ai.blink += dt;
  if (ai.flash > 0) ai.flash -= dt;
  poseAi(ai, map, dt);
}

// Put the 3D model where s/d say it is, and fill in the collision body fields.
// (dt = 0 when a car has just been placed: it then takes the road's slope at once.)
export function poseAi(ai, map, dt = 0) {
  const { road } = map;
  map.pointAt(ai.s, ai.d, p);
  const i = map.indexAt(ai.s);
  const grade = (map.at(road.y, ai.s + 1.5) - map.at(road.y, ai.s - 1.5)) / 3;   // blended, so no twitching every 2 m
  const drift = -ai.dir * Math.atan2(ai.sideSpeed, Math.max(ai.speed, 4));
  ai.x = p.x; ai.y = p.y; ai.z = p.z;
  ai.yaw = p.yaw + (ai.dir < 0 ? Math.PI : 0) + drift + ai.wobble;
  ai.vx = p.tx * ai.dir * ai.speed - p.tz * ai.sideSpeed;
  ai.vz = p.tz * ai.dir * ai.speed + p.tx * ai.sideSpeed;
  ai.yawRate = 0;
  ai.roadIndex = i;
  const g = ai.car.group;
  g.position.set(p.x, p.y, p.z);
  // The car follows the slope of the road and dives when braking - but through slow averages.
  // A driver's right foot is never still (ai.accel jumps between "a little gas" and "a little
  // brake" from one frame to the next), and using it directly made every car nod up and down.
  const slope = Math.atan(grade * ai.dir), bank = Math.atan(map.at(road.bank, ai.s) * ai.dir);
  const fresh = dt === 0 || ai.pitch === null;
  ai.pitch = fresh ? slope : damp(ai.pitch, slope, 6, dt);
  ai.roll = fresh ? bank : damp(ai.roll, bank, 6, dt);
  ai.calmAccel = fresh ? 0 : damp(ai.calmAccel, ai.accel, 2.5, dt);
  g.rotation.set(ai.pitch, ai.yaw, ai.roll);
  ai.car.body.rotation.set(clamp(ai.calmAccel * 0.004, -0.03, 0.02), 0, clamp(-ai.dir * ai.sideSpeed * 0.02, -0.05, 0.05) + ai.wobble * 0.3);
  ai.car.wheels.forEach((wheel, k) => {
    wheel.spin.rotation.x = -ai.wheelAngle;
    if (k < 2) wheel.pivot.rotation.y = drift * 1.5;
  });
}

export function updateAiLights(ai, dt, cameraPosition) {
  const blinkOn = ai.blink % 0.7 < 0.35;
  const flashing = ai.flash > 0 && ai.flash % 0.3 > 0.12;
  ai.brakeHold = ai.accel < -1.2 || ai.speed < 0.5 ? 0.5 : ai.brakeHold - dt;
  ai.car.setLights({
    head: flashing ? 2 : ai.lights.head,
    brake: ai.brakeHold > 0,
    left: (ai.lights.left || ai.hazard) && blinkOn,
    right: (ai.lights.right || ai.hazard) && blinkOn,
    usePool: true, poolFade: 1 - ai.beam,
  });
  ai.car.updateLights(dt, cameraPosition);
}

// ---- Being hit ------------------------------------------------------------------
// collisions.js changed ai.x/z/vx/vz/yawRate. Translate that back into s, d, speed...
export function absorbHit(ai, before, hit, map, time) {
  const { road } = map;
  const i = Math.max(0, ai.roadIndex);
  const dvx = ai.vx - before.vx, dvz = ai.vz - before.vz;
  ai.speed = Math.max(0, ai.speed + (dvx * road.tx[i] + dvz * road.tz[i]) * ai.dir);
  ai.sideSpeed += -dvx * road.tz[i] + dvz * road.tx[i];
  ai.wobbleSpeed += ai.yawRate;
  map.project(ai.x, ai.z, ai.roadIndex, proj);
  ai.s = proj.s; ai.d = proj.d;
  ai.lastHitTime = time;
  if (hit.speed > 2.5) ai.stun = 3.5;
}

// ---- Helpers the brains share ------------------------------------------------------

// Fastest safe speed for the bends in the next `lookahead` metres, allowing
// for the distance needed to brake down to each bend.
export function safeSpeed(map, ai, lookahead, lateralAccel, braking) {
  const { road } = map;
  let best = Infinity;
  for (let ahead = 0; ahead <= lookahead; ahead += 6) {
    if (ahead > map.roomAhead(ai.s, ai.dir)) {          // end of the road: stop before the barrier
      best = Math.min(best, Math.sqrt(Math.max(0, 2 * braking * (ahead - 30))));
      break;
    }
    const i = map.indexAt(ai.s + ai.dir * ahead);
    const cornerSpeed = Math.sqrt(lateralAccel / Math.max(Math.abs(road.curve[i]), 1e-4));
    best = Math.min(best, Math.sqrt(cornerSpeed * cornerSpeed + 2 * braking * ahead));
  }
  return best;
}

// The fastest `ai` may go so that it can stop at the next traffic light, if that light is not
// green (map.signals, kept up to date by world/signals.js). Infinity when nothing has to be done.
// A driver who is already too close to stop when it turns yellow carries on through.
const STOP_LINE = 7;                    // metres before the light
export function signalSpeed(map, ai, braking) {
  let best = Infinity;
  for (const signal of map.signals) {
    if (signal.state === 'green') continue;
    const gap = map.ahead(ai.s, signal.s - ai.dir * STOP_LINE) * ai.dir - ai.front;     // bumper to stop line
    if (gap < -2 || gap > 140) continue;                                                 // already past it, or far away
    if (signal.state === 'yellow' && (ai.speed * ai.speed) / (2 * braking) > gap + 2) continue;
    best = Math.min(best, Math.sqrt(Math.max(0, 2 * braking * (gap - 1))));
  }
  return best;
}

// The closest thing ahead of `ai` in roughly the same lane position.
// `others` = every car on the road (AI cars and the player's "shadow" object).
// Returns { gap, speed } or null.  gap is bumper to bumper.
export function findAhead(map, ai, others, laneD, range) {
  let best = null;
  for (const o of others) {
    if (o === ai || !o.active) continue;
    const ahead = map.ahead(ai.s, o.s) * ai.dir;
    if (ahead <= 0 || ahead > range) continue;
    if (Math.abs(o.d - laneD) > ai.halfWidth + o.halfWidth + 0.3) continue;
    const gap = ahead - ai.front - (o.dir === ai.dir ? o.rear : o.front);
    if (!best || gap < best.gap) best = { gap, speed: o.speed * (o.dir === ai.dir ? 1 : -1), other: o };
  }
  return best;
}
