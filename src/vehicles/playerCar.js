// ---------------------------------------------------------------------------
// playerCar.js — glues together everything about the car you drive:
// the physics (vehiclePhysics.js), the 3D model (carBuilder.js), the cockpit
// (interior.js), real headlight beams, and the body's lean / dive / bounce.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS, PHYSICS, ROAD } from '../config.js';
import { clamp, damp, lerp, noise1 } from '../core/mathUtils.js';
import { HERO_CARS } from './carSpecs.js';
import { buildCar } from './carBuilder.js';
import { buildInterior } from './interior.js';
import { createVehicle, stepVehicle } from './vehiclePhysics.js';
import { collideWithRoadEdges } from '../game/collisions.js';
import { shared, makeHeadlightCookie } from '../render/materials.js';

const cookie = makeHeadlightCookie();
const proj = {};

export function createPlayer(scene, map, carId, colorIndex, mirrorTexture) {
  const spec = HERO_CARS[carId];
  const car = buildCar(spec, spec.colors[colorIndex % spec.colors.length]);
  const interior = buildInterior(car, mirrorTexture);
  car.body.add(interior.group);
  scene.add(car.group);
  car.group.rotation.order = 'YXZ';                          // yaw first, then pitch, then roll

  const vehicle = createVehicle(spec);
  // Extra fields so collisions.js can treat the vehicle as a "body".
  Object.assign(vehicle, { mass: spec.mass, halfWidth: car.dims.halfW, front: -car.dims.frontZ, rear: car.dims.rearZ, roadIndex: -1 });

  // ---- Real headlight beams -------------------------------------------------------
  const beams = [-1, 1].map((side) => {
    // decay 0.9 (real light is 2): softer fall-off, so a car right in front is not burnt white
    const light = new THREE.SpotLight(0xfff1dc, 0, 150, 0.62, 0.55, 0.9);
    light.map = cookie;
    light.position.set(side * spec.headlights.x * car.dims.halfW, spec.headlights.y, car.dims.frontZ - 0.2);
    light.target.position.set(side * 1.2, spec.headlights.y - 1.0, car.dims.frontZ - 30);
    if (side < 0) {                                          // one beam casts shadows (two would cost double)
      light.castShadow = true;
      light.shadow.mapSize.set(GRAPHICS.shadowMapSize, GRAPHICS.shadowMapSize);
      light.shadow.camera.near = 0.4; light.shadow.camera.far = 120;
      light.shadow.bias = -0.0008; light.shadow.normalBias = 0.03;
    }
    car.body.add(light, light.target);
    return light;
  });

  const player = {
    carId, spec, car, vehicle, interior, beams,
    lightMode: 1,            // 0 off, 1 low beam, 2 high beam
    flashing: false,         // high-beam flash held
    lastImpact: null,        // filled when we hit a wall this frame
    onGravel: false,
    bodyRoll: 0, bodyRollSpeed: 0, bodyPitch: 0, bodyPitchSpeed: 0, bounce: 0, bounceSpeed: 0,
    s: 0, d: 0, pitch: 0, roll: 0, calmLat: 0, calmLong: 0,

    // Put the car on the road: s metres along, d metres right of centre, facing +1 (up) or -1 (down).
    placeAt(s, d = ROAD.laneWidth / 2, direction = 1) {
      const p = map.pointAt(s, d * direction);
      Object.assign(vehicle, { x: p.x, z: p.z, yaw: p.yaw + (direction < 0 ? Math.PI : 0), vx: 0, vz: 0, yawRate: 0, gear: 1, roadIndex: -1 });
      vehicle.rpm = spec.engine.idle;
    },

    wiperCycle: 0,           // set by main.js from the weather

    update(dt, controls, weatherGrip) {
      player.lastImpact = null;
      const steps = PHYSICS.substeps, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        stepVehicle(vehicle, controls, h, readGround(weatherGrip));
        const hit = collideWithRoadEdges(vehicle, map);
        if (hit && (!player.lastImpact || hit.speed > player.lastImpact.speed)) player.lastImpact = hit;
      }
      updateVisuals(dt);
    },
  };

  // What is under the car right now? (grip and slope, in the car's own directions)
  function readGround(weatherGrip) {
    const { road } = map;
    map.project(vehicle.x, vehicle.z, vehicle.roadIndex, proj);
    vehicle.roadIndex = proj.index;
    player.s = proj.s; player.d = proj.d;
    const i = Math.min(proj.index, road.count - 2);
    // Slopes are blended between road samples, otherwise the car would twitch every 2 metres.
    const grade = (map.at(road.y, proj.s + 1.5) - map.at(road.y, proj.s - 1.5)) / 3;   // rise per metre along the road
    const bank = Math.abs(proj.d) < ROAD.paveHalfWidth ? map.at(road.bank, proj.s) : 0;
    const fx = -Math.sin(vehicle.yaw), fz = -Math.cos(vehicle.yaw);
    const along = fx * road.tx[i] + fz * road.tz[i];                // 1 = driving up the road, -1 = down
    const across = -fx * road.tz[i] + fz * road.tx[i];
    const lot = (proj.d > 0 ? road.railR[i] : road.railL[i]) === 2; // parking lots are paved
    player.onGravel = Math.abs(proj.d) > ROAD.paveHalfWidth && !lot;
    return {
      grip: weatherGrip * (player.onGravel ? PHYSICS.gravelGrip : 1),
      extraDrag: player.onGravel ? 0.03 : 0,
      slopeForward: grade * along + bank * across,
      slopeRight: -grade * across + bank * along,
    };
  }

  function updateVisuals(dt) {
    const v = vehicle, g = car.group;
    const ground = readGround(1);
    v.y = map.roadHeight(player.s, player.d);
    g.position.set(v.x, v.y, v.z);
    player.pitch = damp(player.pitch, Math.atan(ground.slopeForward), 4, dt);
    player.roll = damp(player.roll, Math.atan(ground.slopeRight), 4, dt);
    g.rotation.set(player.pitch, v.yaw, player.roll);

    // Body on springs: it leans out in corners, dives under braking, squats on power.
    const spring = (value, speed, target, stiffness, damping) => {
      speed += ((target - value) * stiffness - speed * damping) * dt;
      return [value + speed * dt, speed];
    };
    // The body follows a slow average of the g-forces. (The raw values flick on and off with
    // every key press and gear change, which made the car visibly bob.)
    player.calmLat = damp(player.calmLat, v.accelLat, 3, dt);
    player.calmLong = damp(player.calmLong, v.accelLong, 2.5, dt);
    [player.bodyRoll, player.bodyRollSpeed] = spring(player.bodyRoll, player.bodyRollSpeed, clamp(player.calmLat * 0.004, -0.06, 0.06), 45, 14);
    [player.bodyPitch, player.bodyPitchSpeed] = spring(player.bodyPitch, player.bodyPitchSpeed, clamp(player.calmLong * 0.0022, -0.03, 0.025), 40, 14);
    // Road texture: tiny bumps that get busier with speed (rougher on gravel).
    const rough = (player.onGravel ? 0.016 : 0) * clamp(v.speed / 30, 0, 1.5);   // smooth on asphalt, bumpy only on gravel
    const bumpTarget = (noise1(v.wheelAngle * 0.35) - 0.5) * rough;
    [player.bounce, player.bounceSpeed] = spring(player.bounce, player.bounceSpeed, bumpTarget, 220, 14);
    car.body.rotation.set(player.bodyPitch + (noise1(v.wheelAngle * 0.21 + 50) - 0.5) * rough * 0.6, 0, player.bodyRoll);
    car.body.position.y = player.bounce;

    // Wheels: fronts steer, all roll (rears lock with the handbrake).
    car.wheels.forEach((wheel, index) => {
      if (index < 2) wheel.pivot.rotation.y = v.steerAngle;
      if (!(v.handbrake && index >= 2)) wheel.spin.rotation.x = -v.wheelAngle * (index >= 2 ? 1 + v.wheelSpin * 0.5 : 1);
    });

    // Lights
    const head = player.flashing ? 2 : player.lightMode;
    car.setLights({ head, brake: v.brake > 0.05, reverse: v.gear === -1 });
    const power = head === 0 ? 0 : head === 1 ? 1 : 2.3;
    for (const beam of beams) {
      beam.intensity = lerp(beam.intensity, power * 760, Math.min(1, dt * 18));
      beam.distance = head === 2 ? 260 : 150;
      beam.target.position.y = spec.headlights.y - (head === 2 ? 0.25 : 1.0);
    }
    // Tell the retroreflective materials where the headlights are.
    g.updateMatrixWorld();
    shared.headPos.value.set(0, spec.headlights.y, car.dims.frontZ).applyMatrix4(car.body.matrixWorld);
    shared.headDir.value.set(0, -0.03, -1).transformDirection(car.body.matrixWorld);
    shared.headPower.value = lerp(shared.headPower.value, power, Math.min(1, dt * 18));
    interior.update(v, player.wiperCycle, dt);
  }
  player.dispose = () => { scene.remove(car.group); };
  return player;
}
