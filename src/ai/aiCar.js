// ---------------------------------------------------------------------------
// aiCar.js — the shared "body" of every computer-driven car (traffic + rivals).
//
// AI cars do not use the full tyre physics. They ride on rails: each one knows
//   way    which road it is on (world/mapData.js: WAYS)
//   s      how far along that road it is
//   d      how far right of the centre line it is
//   dir    +1 driving up the road, -1 driving down
//   speed  metres per second
// The "brain" (traffic.js / rivals.js) only decides two things every frame:
// wantSpeed and wantD. This file moves the car smoothly toward them, poses the
// 3D model, and handles being hit by the player.
//
// TURNS. At a junction a car may leave its road for another (ai/junctions.js decides).
// For those few metres it follows a curve drawn from where it is to its lane on the new
// road (ai.turn); when the curve ends it is an ordinary car on rails again, on that road.
//
// OTHER CARS. A brain never reads another car's s and d directly, because that car may be on
// another road. It asks lookAround(), which says where each car near enough to matter is
// along the asker's OWN road - a car crossing at a junction is then simply "something in
// my lane, 30 m ahead, hardly moving", and the usual rules deal with it.
// ---------------------------------------------------------------------------
import { angleDiff, clamp, approach, curvePoint, damp } from '../core/mathUtils.js';
import { buildCar, randomPlateText } from '../vehicles/carBuilder.js';

const p = {}, proj = {};

// The 3D model of a car and the measurements that go with it ("body" fields used by collisions.js).
function modelOf(scene, specId, spec) {
  const car = buildCar(spec, spec.colors[0]);
  car.group.rotation.order = 'YXZ';
  car.group.visible = false;
  scene.add(car.group);
  return { specId, spec, car, mass: spec.mass, yawInertia: spec.mass * spec.wheelbase * spec.wheelbase * 0.26,
    halfWidth: car.dims.halfW, front: -car.dims.frontZ, rear: car.dims.rearZ };
}
// Give a driver another car (a street racer turns up in a different one each time). The old
// model is thrown away; do it while the car is out of sight.
export function changeAiCar(ai, scene, specId, spec) {
  ai.car.dispose();
  Object.assign(ai, modelOf(scene, specId, spec), { soundCar: null, beam: 0 });
}

export function createAiCar(scene, specId, spec, kind) {
  return {
    ...modelOf(scene, specId, spec),
    kind, active: false,
    way: null, s: 0, d: 0, dir: 1, speed: 0,
    turn: null,               // the curve it is following through a junction, if it is turning (see TURNS above)
    plan: null,               // what it means to do at the next junction (ai/junctions.js)
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
    x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, roadIndex: -1,
    accel: 0,
    calmAccel: 0, pitch: 0, roll: 0,   // slow copies of acceleration and road slope, for a body that does not twitch
  };
}

// Put a car on a road: `way`, s metres along, driving dir.
export function placeAi(ai, way, s, dir, speed, color) {
  ai.way = way;
  const lane = way.laneCentre(s, dir, ai.lane);
  Object.assign(ai, { s, dir, speed, wantSpeed: speed, d: lane, wantD: lane, turn: null, plan: null,
    sideSpeed: 0, wobble: 0, wobbleSpeed: 0, stun: 0, hazard: false, flash: 0, active: true, roadIndex: -1, passSide: 0,
    accel: 0, calmAccel: 0, pitch: null, roll: null });
  if (color !== undefined) { ai.car.setColor(color); ai.car.plate.setText(randomPlateText()); }   // "new" car: new paint, new plate
  ai.car.group.visible = true;
  poseAi(ai);
}

export function removeAi(ai) { ai.active = false; ai.car.group.visible = false; }

// ---- Moving -------------------------------------------------------------------
export function moveAi(ai, dt) {
  const way = ai.way, { road } = way;
  // Speed: accelerate gently, brake harder. A shaken driver slows right down.
  if (ai.stun > 0) { ai.stun -= dt; ai.wantSpeed = Math.min(ai.wantSpeed, 6); ai.hazard = true; if (ai.stun <= 0) ai.hazard = false; }
  const before = ai.speed;
  ai.speed = approach(ai.speed, ai.wantSpeed, dt * (ai.wantSpeed > ai.speed ? ai.maxAccel : ai.maxBrake));
  ai.accel = (ai.speed - before) / Math.max(dt, 1e-4);
  ai.wheelAngle += (ai.speed / ai.spec.wheelRadius) * dt;
  ai.blink += dt;
  if (ai.flash > 0) ai.flash -= dt;
  // Yaw wobble after a hit dies away.
  ai.wobbleSpeed += (-ai.wobble * 30 - ai.wobbleSpeed * 5) * dt;
  ai.wobble += ai.wobbleSpeed * dt;
  if (ai.turn) { followTurn(ai, dt); return; }

  ai.s = way.wrap(ai.s + ai.dir * ai.speed * dt);
  // Sideways: steer toward the wanted lane position like a spring with a damper.
  const index = way.indexAt(ai.s);
  const room = (ai.d > 0 ? road.limitR[index] : road.limitL[index]) - ai.halfWidth;
  const pull = (ai.wantD - ai.d) * 2.2 * ai.agility - ai.sideSpeed * 2.6 * Math.sqrt(ai.agility);
  ai.sideSpeed += pull * dt;
  ai.sideSpeed = clamp(ai.sideSpeed, -Math.max(1, ai.speed * 0.25), Math.max(1, ai.speed * 0.25));
  ai.d += ai.sideSpeed * dt;
  if (Math.abs(ai.d) > room) { ai.d = Math.sign(ai.d) * room; ai.sideSpeed *= -0.2; }
  poseAi(ai, dt);
}

// Put the 3D model where s/d say it is, and fill in the collision body fields.
// (dt = 0 when a car has just been placed: it then takes the road's slope at once.)
export function poseAi(ai, dt = 0) {
  const way = ai.way, { road } = way;
  way.pointAt(ai.s, ai.d, p);
  const grade = (way.at(road.y, ai.s + 1.5) - way.at(road.y, ai.s - 1.5)) / 3;   // blended, so no twitching every 2 m
  const drift = -ai.dir * Math.atan2(ai.sideSpeed, Math.max(ai.speed, 4));
  ai.x = p.x; ai.y = p.y; ai.z = p.z;
  ai.yaw = p.yaw + (ai.dir < 0 ? Math.PI : 0) + drift + ai.wobble;
  ai.vx = p.tx * ai.dir * ai.speed - p.tz * ai.sideSpeed;
  ai.vz = p.tz * ai.dir * ai.speed + p.tx * ai.sideSpeed;
  ai.yawRate = 0;
  ai.roadIndex = way.indexAt(ai.s);
  settleBody(ai, Math.atan(grade * ai.dir), Math.atan(way.at(road.bank, ai.s) * ai.dir), drift, dt);
}

// The 3D model follows the slope of the road and dives when braking - but through slow averages.
// A driver's right foot is never still (ai.accel jumps between "a little gas" and "a little
// brake" from one frame to the next), and using it directly made every car nod up and down.
function settleBody(ai, slope, bank, drift, dt) {
  const g = ai.car.group;
  g.position.set(ai.x, ai.y, ai.z);
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

// ---- Turning at a junction (see TURNS at the top) ------------------------------------
// Start the turn onto `arm` (a road leaving the junction: { way, s, dir }), rejoining that road
// `reach` metres along it. The curve leaves along the car's present heading and arrives along
// the new road's: two "handles", each a good third of the way, give a smooth sweep.
export function startTurn(ai, arm, reach) {
  const from = ai.way.pointAt(ai.s, ai.d), heading = ai.dir;
  const sOut = arm.way.wrap(arm.s + arm.dir * reach);
  const lane = arm.way.laneCentre(sOut, arm.dir, arm.way.road.lanes[arm.way.indexAt(sOut)] - 1);     // into the right-hand lane
  const to = arm.way.pointAt(sOut, lane);
  const handle = Math.hypot(to.x - from.x, to.z - from.z) * 0.4;
  const points = [[from.x, from.z], [from.x + from.tx * heading * handle, from.z + from.tz * heading * handle],
    [to.x - to.tx * arm.dir * handle, to.z - to.tz * arm.dir * handle], [to.x, to.z]];
  // The curve is measured in short straight pieces, so the car can move along it at its true speed.
  const steps = [0];
  let last = points[0];
  for (let k = 1; k <= 16; k++) { const at = curvePoint(points, k / 16); steps.push(steps[k - 1] + Math.hypot(at[0] - last[0], at[1] - last[1])); last = at; }
  ai.turn = { points, steps, gone: 0, from: ai.way, dir: arm.dir, sOut, lane };
  ai.way = arm.way; ai.dir = arm.dir; ai.roadIndex = -1; ai.plan = null;
  ai.sideSpeed = 0;
}
// How many metres of its curve a turning car has clear in front of it (Infinity = all of it):
// the distance to the first place, in the next 14 m, where another car is in the way.
// patient = false: it has been held up too long, and now only minds cars that are moving.
export function roomOnTurn(ai, everyone, patient = true) {
  const turn = ai.turn, total = turn.steps[16];
  for (let ahead = 2; ahead <= 14; ahead += 2) {
    const at = Math.min(total, turn.gone + ai.front + ahead);
    let k = 1;
    while (k < 16 && turn.steps[k] < at) k++;
    const point = curvePoint(turn.points, (k - 1 + (at - turn.steps[k - 1]) / Math.max(turn.steps[k] - turn.steps[k - 1], 1e-6)) / 16);
    for (const o of everyone) {
      if (o === ai || !o.active || (!patient && o.speed < 0.5)) continue;
      if (Math.hypot(o.x - point[0], o.z - point[1]) < ai.halfWidth + o.halfWidth + 0.6) return ahead;
    }
  }
  return Infinity;
}
// One frame of a turn: move along the curve; at its end the car is on rails again, on the new road.
function followTurn(ai, dt) {
  const turn = ai.turn, way = ai.way, total = turn.steps[16];
  turn.gone = Math.min(total, turn.gone + ai.speed * dt);
  let k = 1;
  while (k < 16 && turn.steps[k] < turn.gone) k++;                         // which short piece we are on
  const t = (k - 1 + (turn.gone - turn.steps[k - 1]) / Math.max(turn.steps[k] - turn.steps[k - 1], 1e-6)) / 16;
  const at = curvePoint(turn.points, t), ahead = curvePoint(turn.points, Math.min(1, t + 0.02)), behind = curvePoint(turn.points, Math.max(0, t - 0.02));
  const len = Math.hypot(ahead[0] - behind[0], ahead[1] - behind[1]) || 1, tx = (ahead[0] - behind[0]) / len, tz = (ahead[1] - behind[1]) / len;
  // Where that is along the new road: other drivers there see the car arriving from the side.
  way.project(at[0], at[1], ai.roadIndex, proj);
  ai.roadIndex = proj.index; ai.s = proj.s; ai.d = proj.d;
  ai.x = at[0]; ai.z = at[1]; ai.y = way.roadHeight(proj.s, proj.d);
  ai.yaw = Math.atan2(-tx, -tz) + ai.wobble;
  ai.vx = tx * ai.speed; ai.vz = tz * ai.speed; ai.yawRate = 0;
  const steer = angleDiff(Math.atan2(-(ahead[0] - at[0]), -(ahead[1] - at[1])), Math.atan2(-(at[0] - behind[0]), -(at[1] - behind[1])));
  settleBody(ai, ai.pitch ?? 0, 0, clamp(steer * 6, -0.45, 0.45), dt);
  if (turn.gone >= total) { ai.turn = null; ai.d = ai.wantD = turn.lane; }
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
  ai.turn = null;                                    // knocked off its curve: it carries on from wherever it now is
  const spot = map.locate(ai.x, ai.z, ai.way, ai.roadIndex);
  const { road } = spot.way, i = spot.index;
  const dvx = ai.vx - before.vx, dvz = ai.vz - before.vz;
  ai.speed = Math.max(0, ai.speed + (dvx * road.tx[i] + dvz * road.tz[i]) * ai.dir);
  ai.sideSpeed += -dvx * road.tz[i] + dvz * road.tx[i];
  ai.wobbleSpeed += ai.yawRate;
  ai.way = spot.way; ai.roadIndex = i; ai.s = spot.s; ai.d = spot.d;
  ai.lastHitTime = time;
  if (hit.speed > 2.5 && ai.kind !== 'rival') ai.stun = 3.5;       // an ordinary driver is shaken: hazards on, slow for a while. A racer just drives on.
}

// ---- Helpers the brains share ------------------------------------------------------

// Every other car that matters to `ai`, placed along ai's OWN road (see OTHER CARS at the top):
//   [{ car, s, d, dir, speed, ahead }]   ahead = metres in front of ai (negative = behind),
//                                        dir and speed = which way and how fast it moves along this road
// `everyone` = every car in the game (AI cars and the player's "shadow" object).
export function lookAround(ai, everyone) {
  const way = ai.way, seen = [];
  for (const o of everyone) {
    if (o === ai || !o.active) continue;
    if (o.way === way && !o.turn) { seen.push({ car: o, s: o.s, d: o.d, dir: o.dir, speed: o.speed, ahead: way.ahead(ai.s, o.s) * ai.dir }); continue; }
    if ((o.x - ai.x) ** 2 + (o.z - ai.z) ** 2 > 220 * 220) continue;       // far away on another road
    const near = way.sampleNearby(o.x, o.z);
    if (near < 0) continue;                                                // not near this road at all
    const spot = way.project(o.x, o.z, near);
    if (spot.past > 0) continue;                                           // beyond the end of this road
    const along = o.vx * way.road.tx[spot.index] + o.vz * way.road.tz[spot.index];
    seen.push({ car: o, s: spot.s, d: spot.d, dir: along >= 0 ? 1 : -1, speed: Math.abs(along), ahead: way.ahead(ai.s, spot.s) * ai.dir });
  }
  return seen;
}

// Is the end of the road that `ai` is driving toward within `margin` metres - an end that just
// stops, not one that joins another road? (Never, on a loop.)
export function nearDeadEnd(ai, margin) {
  const { road } = ai.way;
  if (road.closed) return false;
  return ai.dir > 0 ? !road.joinedEnd && ai.s > road.length - margin : !road.joinedStart && ai.s < margin;
}

// Fastest safe speed for the bends in the next `lookahead` metres, allowing
// for the distance needed to brake down to each bend.
export function safeSpeed(ai, lookahead, lateralAccel, braking) {
  const way = ai.way, { road } = way;
  const deadEnd = !road.closed && !(ai.dir > 0 ? road.joinedEnd : road.joinedStart);
  let best = Infinity;
  for (let ahead = 0; ahead <= lookahead; ahead += 6) {
    if (ahead > way.roomAhead(ai.s, ai.dir)) {          // the end of this road:
      if (deadEnd) best = Math.min(best, Math.sqrt(Math.max(0, 2 * braking * (ahead - 30))));     // stop before the barrier
      break;                                            // (where it joins another road, ai/junctions.js sets the speed)
    }
    const i = way.indexAt(ai.s + ai.dir * ahead);
    const cornerSpeed = Math.sqrt(lateralAccel / Math.max(Math.abs(road.curve[i]), 1e-4));
    best = Math.min(best, Math.sqrt(cornerSpeed * cornerSpeed + 2 * braking * ahead));
  }
  return best;
}

// The fastest `ai` may go so that it can stop at the next traffic light on its road, if that light
// is not green (way.signals, kept up to date by world/signals.js). Infinity when nothing has to be done.
// A driver who is already too close to stop when it turns yellow carries on through.
const STOP_LINE = 7;                    // metres before the light (a light at a junction says how far itself: signal.line)
export function signalSpeed(ai, braking) {
  let best = Infinity;
  for (const signal of ai.way.signals) {
    if (signal.state === 'green' || (signal.dirs && !signal.dirs.includes(ai.dir))) continue;      // green, or not facing this car
    const stopAt = signal.line !== undefined ? signal.line + 1 : STOP_LINE;
    const gap = ai.way.ahead(ai.s, signal.s - ai.dir * stopAt) * ai.dir - ai.front;      // bumper to stop line
    if (gap < -2 || gap > 140) continue;                                                 // already past it, or far away
    if (signal.state === 'yellow' && (ai.speed * ai.speed) / (2 * braking) > gap + 2) continue;
    best = Math.min(best, Math.sqrt(Math.max(0, 2 * braking * (gap - 1))));
  }
  return best;
}

// The closest thing ahead of `ai` in roughly the lane position laneD.
// `seen` = lookAround(ai, everyone). Returns { gap, speed, other } or null: gap is bumper to
// bumper, speed is along ai's direction (negative = it is coming toward ai).
export function findAhead(ai, seen, laneD, range) {
  let best = null;
  for (const o of seen) {
    if (o.ahead <= 0 || o.ahead > range) continue;
    if (Math.abs(o.d - laneD) > ai.halfWidth + o.car.halfWidth + 0.3) continue;
    const gap = o.ahead - ai.front - (o.dir === ai.dir ? o.car.rear : o.car.front);
    if (!best || gap < best.gap) best = { gap, speed: o.speed * (o.dir === ai.dir ? 1 : -1), other: o.car };
  }
  return best;
}
