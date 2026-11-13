// ---------------------------------------------------------------------------
// vehiclePhysics.js — how the player's car moves. No graphics in this file.
//
// The model (a "bicycle model" with weight transfer) in plain words:
//   * The car is a rigid body sliding on a plane: position, heading (yaw),
//     velocity and spin (yaw rate).
//   * The two front tyres are treated as one tyre, same for the rear.
//   * A tyre pushes sideways depending on its SLIP ANGLE — the angle between
//     where it points and where it is actually going. Grip rises with slip
//     angle, peaks around 8-9 degrees, then falls off: that is a slide.
//   * A tyre has one budget of grip. Braking or accelerating spends part of
//     it, leaving less for cornering ("friction circle").
//   * Braking shifts weight to the front tyres, accelerating to the rear.
//   * Rear-wheel drive: engine torque -> gearbox -> rear tyres.
//
// Sign conventions: forward speed +, sideways speed + = to the right,
// steering and yaw rate + = to the LEFT (matches Three.js rotation.y).
// ---------------------------------------------------------------------------
import { PHYSICS } from '../config.js';
import { clamp, lerp, approach, smoothstep } from '../core/mathUtils.js';

const G = PHYSICS.gravity;
const DRIVETRAIN_EFFICIENCY = 0.88;
const AIR_DENSITY = 1.2;
const TYRE_B = 11.5, TYRE_C = 1.45;      // shape of the grip curve (stiffness, peak)
const MAX_STEER = 0.60;                  // 34 degrees of front wheel lock
const SHIFT_TIME = 0.14;
const REAR_BIAS = 1.06;
const BRAKE_STABILITY = 0.7;
const SLIDE_EASE = 0.42;

export function createVehicle(spec) {
  const a = spec.wheelbase * (1 - spec.frontWeight);
  const b = spec.wheelbase * spec.frontWeight;
  return {
    spec, a, b,
    yawInertia: spec.mass * a * b * 1.05,
    // --- motion state ---
    x: 0, y: 0, z: 0, yaw: 0,
    vx: 0, vz: 0, yawRate: 0,
    // --- controls after smoothing ---
    steerInput: 0, steerAngle: 0, throttle: 0, brake: 0, handbrake: false,
    // --- drivetrain ---
    gear: 1, rpm: spec.engine.idle, shiftTimer: 0, fuel: 1,
    // --- values other systems read (camera, audio, HUD, effects) ---
    speed: 0, forwardSpeed: 0, sideSpeed: 0,
    accelLong: 0, accelLat: 0,           // in g-ish m/s², smoothed
    slipFront: 0, slipRear: 0,           // 0 = gripping, 1 = fully sliding
    wheelSpin: 0,                        // driven wheels spinning faster than the road
    wheelAngle: 0,                       // how far the wheels have rolled (for graphics)
  };
}

// Normalised tyre grip curve: input slip (radians), output -1..1.
function tyreCurve(slip) {
  return Math.sin(TYRE_C * Math.atan(TYRE_B * slip));
}

export function engineTorque(spec, rpm) {
  const curve = spec.engine.torque;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const t = (rpm - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]);
      return lerp(curve[i - 1][1], curve[i][1], t);
    }
  }
  return 0;                              // past the red line: fuel cut
}

/**
 * Advance the car by dt seconds.
 * @param v        vehicle from createVehicle()
 * @param controls { throttle 0..1, brake 0..1, steer -1..1 (+ = left), handbrake bool }
 * @param ground   { grip, slopeForward, slopeRight } — slopes are rise per metre
 */
export function stepVehicle(v, controls, dt, ground) {
  if (!(dt > 0)) return;                                    // nothing to do for a zero-length step
  const spec = v.spec, m = spec.mass, L = spec.wheelbase;

  // Directions of the car on the ground plane.
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);       // forward
  const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);        // right
  let vLong = v.vx * fx + v.vz * fz;
  let vLat = v.vx * rx + v.vz * rz;

  // ---- 1. Pedals. Holding the brake at a standstill selects reverse. ---------
  let throttleWish = controls.throttle, brakeWish = controls.brake;
  if (v.gear === -1) {
    if (controls.throttle > 0 && vLong > -0.5) v.gear = 1;
    else { throttleWish = controls.brake; brakeWish = controls.throttle; }
  } else if (controls.brake > 0 && controls.throttle === 0 && vLong < 0.5) {
    v.gear = -1; throttleWish = controls.brake; brakeWish = 0;
  }
  if (v.fuel <= 0) throttleWish *= 0.25;                    // out of fuel: limp along
  v.throttle = approach(v.throttle, throttleWish, dt * (throttleWish > v.throttle ? 5 : 9));
  v.brake = approach(v.brake, brakeWish, dt * 14);
  v.handbrake = controls.handbrake;

  // ---- 2. Steering: slower and with less lock at speed, like power steering ---
  const speed = Math.hypot(v.vx, v.vz);
  const cornerG = 10.5 * spec.grip * ground.grip * PHYSICS.gripBoost * (1 + PHYSICS.speedGrip * clamp(speed / 60, 0, 1));   // sideways acceleration the tyres can give
  const lock = Math.min(MAX_STEER, Math.atan((L * cornerG) / Math.max(1, vLong * vLong)) * 1.15 + 0.14);
  const steerRate = controls.steer === 0 ? 8 : lerp(7.0, 4.2, clamp(speed / 55, 0, 1));
  v.steerInput = approach(v.steerInput, controls.steer, dt * steerRate);
  // Self-aligning: the front wheels want to point where the car is actually going.
  // This is what lets you catch a slide on a keyboard.
  const travelAngle = speed > 5 ? Math.atan2(vLat, Math.abs(vLong) + 2) : 0;
  const assist = clamp(-travelAngle * 0.55, -0.35, 0.35) * Math.sign(vLong || 1);
  v.steerAngle = clamp(v.steerInput * lock + assist, -MAX_STEER, MAX_STEER);
  const cosS = Math.cos(v.steerAngle), sinS = Math.sin(v.steerAngle);

  // ---- 3. Weight on each axle (shifts with acceleration and braking) ----------
  // Under braking only part of the weight shift is applied: a full shift unloads the rear
  // tyres and the tail steps out ("brake to drift"). Sliding is the HANDBRAKE's job here.
  const transfer = (m * v.accelLong * spec.cgHeight * (v.accelLong < 0 ? 0.15 : 1)) / L;
  const staticFront = (m * G * v.b) / L, staticRear = (m * G * v.a) / L;
  const loadFront = Math.max(staticFront - transfer, m * G * 0.08);
  const loadRear = Math.max(staticRear + transfer, m * G * 0.08);
  // Tyres grip slightly less per kilo when loaded harder (keeps handling honest).
  const mu = spec.grip * ground.grip * PHYSICS.gripBoost * (1 + PHYSICS.speedGrip * clamp(speed / 60, 0, 1));
  // REAR_BIAS > 1 gives the rear a little extra grip so the car pushes wide (understeers)
  // at the limit instead of snapping sideways — the way road cars are set up.
  const gripFront = mu * loadFront * (1 - 0.07 * (loadFront / staticFront - 1));
  // BRAKE_STABILITY: while the foot brake is on, the rear tyres get extra grip, so the car
  // slows in a straight, stable line instead of rotating.
  const gripRear = mu * REAR_BIAS * (1 + BRAKE_STABILITY * v.brake) * loadRear * (1 - 0.07 * (loadRear / staticRear - 1));

  // ---- 4. Engine and gearbox ---------------------------------------------------
  const ratio = v.gear === -1 ? -spec.gears[0] * 0.95 : spec.gears[v.gear - 1];
  const totalRatio = ratio * spec.finalDrive * PHYSICS.gearing;
  const wheelRpm = (Math.abs(vLong) / spec.wheelRadius) * Math.abs(totalRatio) * (60 / (2 * Math.PI));
  const launchRpm = spec.engine.idle + v.throttle * (spec.engine.redline * 0.45 - spec.engine.idle);
  const targetRpm = Math.min(spec.engine.redline + 150, Math.max(wheelRpm * (1 + v.wheelSpin * 0.35), launchRpm));
  v.rpm = lerp(v.rpm, targetRpm, Math.min(1, dt * 14));

  let driveForce = 0;
  if (v.shiftTimer > 0) {
    v.shiftTimer -= dt;                                     // mid-shift: no power
  } else {
    const torque = v.rpm > spec.engine.redline ? 0 : engineTorque(spec, v.rpm) * v.throttle * PHYSICS.powerBoost;
    const engineBrake = (1 - v.throttle) * 0.10 * spec.engine.torque[2][1] * (v.rpm / spec.engine.redline);
    driveForce = ((torque - engineBrake * (wheelRpm > spec.engine.idle ? 1 : 0)) * totalRatio * DRIVETRAIN_EFFICIENCY) / spec.wheelRadius;
    // Automatic gearbox
    if (v.gear >= 1) {
      const gears = spec.gears;
      if (v.gear < gears.length && wheelRpm > spec.engine.redline * 0.97) { v.gear++; v.shiftTimer = SHIFT_TIME; }
      // Kick-down: with your foot down the gearbox drops gears to keep the engine screaming
      // near its power peak; cruising or lifting, it only changes down when the revs get low.
      else if (v.gear > 1 && wheelRpm * (gears[v.gear - 2] / gears[v.gear - 1]) < spec.engine.redline * (v.throttle > 0.7 ? 0.9 : 0.6)) { v.gear--; v.shiftTimer = SHIFT_TIME * 0.6; }
    }
  }
  if (v.handbrake) driveForce = 0;

  // ---- 5. Front tyres -----------------------------------------------------------
  const latFront = vLat - v.a * v.yawRate;                  // sideways speed at the front axle
  const wheelSide = latFront * cosS + vLong * sinS;         // ...seen from the steered wheel
  const wheelFwd = vLong * cosS - latFront * sinS;
  const slipAngleFront = Math.atan2(wheelSide, Math.max(Math.abs(wheelFwd), 3));
  const maxBrake = (m * Math.abs(vLong)) / dt;              // never brake past a standstill
  const brakeTotal = Math.min(v.brake * spec.brakeG * PHYSICS.brakeBoost * m * G, maxBrake);
  const brakeFront = Math.min(brakeTotal * 0.70, gripFront * 0.96);          // 0.96 = ABS keeps it rolling
  const frontLong = -brakeFront * Math.sign(wheelFwd);
  const frontBudget = Math.sqrt(Math.max(0.05, 1 - 0.22 * (brakeFront / gripFront) ** 2));   // you can still steer under braking
  const frontSide = -gripFront * tyreCurve(slipAngleFront) * frontBudget;

  // ---- 6. Rear tyres ------------------------------------------------------------
  const latRear = vLat + v.b * v.yawRate;
  let rearLong, rearSide;
  if (v.handbrake) {
    // Locked wheels just skid: friction points against the sliding direction.
    const slide = Math.hypot(vLong, latRear), fade = clamp(slide / 0.8, 0, 1);
    const force = gripRear * 0.82 * fade;
    rearLong = slide > 1e-3 ? (-force * vLong) / slide : 0;
    rearSide = slide > 1e-3 ? (-force * latRear) / slide : 0;
    v.slipRear = fade;
    v.wheelSpin = 0;
  } else {
    const slipAngleRear = Math.atan2(latRear, Math.max(Math.abs(vLong), 3));
    const brakeRear = Math.min(brakeTotal * 0.30, gripRear * 0.96);
    // Keyboard throttle is all-or-nothing, so ease the power off as the tail steps out.
    // You can still hold a power slide, it just does not instantly spin.
    const slideEase = PHYSICS.keyboardAids ? 1 - SLIDE_EASE * smoothstep(0.14, 0.5, Math.abs(slipAngleRear)) : 1;
    const wanted = driveForce * (driveForce * vLong > 0 ? slideEase : 1) - brakeRear * Math.sign(vLong);
    rearLong = clamp(wanted, -gripRear, gripRear);
    v.wheelSpin = lerp(v.wheelSpin, clamp(Math.abs(wanted) / gripRear - 1, 0, 2) * (v.throttle > 0.2 ? 1 : 0), Math.min(1, dt * 10));
    // Power spends rear grip (power oversteer is allowed); braking does not (the car stays straight).
    const spending = rearLong * vLong > 0 ? 0.42 : 0.12;
    const rearBudget = Math.sqrt(Math.max(0.06, 1 - spending * (rearLong / gripRear) ** 2));
    rearSide = -gripRear * tyreCurve(slipAngleRear) * rearBudget;
    v.slipRear = clamp((Math.abs(slipAngleRear) - 0.11) / 0.2, 0, 1) * clamp(speed / 6, 0, 1);
  }
  v.slipFront = clamp((Math.abs(slipAngleFront) - 0.13) / 0.2, 0, 1) * clamp(speed / 6, 0, 1);

  // ---- 7. Add everything up in the car's own frame ---------------------------------
  const drag = 0.5 * AIR_DENSITY * spec.dragArea * 0.8 * vLong * Math.abs(vLong);
  const rolling = m * G * (0.013 + ground.extraDrag) * clamp(vLong / 0.5, -1, 1);
  const forceLong = frontLong * cosS + frontSide * sinS + rearLong - drag - rolling - m * G * ground.slopeForward;
  const frontRight = -frontLong * sinS + frontSide * cosS;
  const forceRight = frontRight + rearSide - m * G * ground.slopeRight;
  let torque = -v.a * frontRight + v.b * rearSide;          // + turns the car left
  // Arcade helper: nudge the car's rotation toward what the steering asks for (limited to
  // what the tyres could really do), so it turns in eagerly instead of ploughing straight on.
  if (PHYSICS.steerAssist > 0 && !v.handbrake && speed > 3) {
    const maxYawRate = (cornerG * 1.08) / Math.max(speed, 6);
    const wantedYawRate = clamp((vLong * Math.tan(v.steerInput * lock)) / L, -maxYawRate, maxYawRate);
    const sliding = clamp(Math.abs(vLat) / (speed * 0.35 + 1), 0, 1);       // back off while drifting
    // Under braking the helper only ever CALMS rotation (it never adds any).
    let help = (wantedYawRate - v.yawRate) * v.yawInertia * 9 * PHYSICS.steerAssist * (1 - sliding);
    if (v.brake > 0.1 && help * v.yawRate > 0) help *= 1 - 0.45 * v.brake;   // still turns in on the brakes, just less eagerly
    torque += help;
  }

  const accLong = forceLong / m, accRight = forceRight / m;
  v.accelLong = lerp(v.accelLong, accLong, Math.min(1, dt * 12));
  v.accelLat = lerp(v.accelLat, accRight, Math.min(1, dt * 12));

  // ---- 8. Move -----------------------------------------------------------------------
  v.vx += (fx * accLong + rx * accRight) * dt;
  v.vz += (fz * accLong + rz * accRight) * dt;
  v.yawRate += (torque / v.yawInertia) * dt;
  // Parked: no pedals and nearly stopped -> hold still (stops creeping on slopes).
  if (Math.hypot(v.vx, v.vz) < 0.25 && v.throttle < 0.02) { v.vx = 0; v.vz = 0; v.yawRate *= 0.8; }
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  v.yaw += v.yawRate * dt;

  vLong = v.vx * fx + v.vz * fz;
  vLat = v.vx * rx + v.vz * rz;
  v.speed = Math.hypot(v.vx, v.vz);
  v.forwardSpeed = vLong;
  v.sideSpeed = vLat;
  v.wheelAngle += (vLong / spec.wheelRadius) * dt;
  v.fuel = Math.max(0, v.fuel - v.throttle * dt * 0.0012);  // a full tank lasts ~14 min flat out
}
