// ---------------------------------------------------------------------------
// playerCar.js — glues together everything about the car you drive:
// the physics (vehiclePhysics.js), the 3D model (carBuilder.js), the cockpit
// (interior.js), real headlight beams, and the body's lean / dive / bounce.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS, PHYSICS, ROAD } from '../config.js';
import { clamp, damp, lerp, noise1 } from '../core/mathUtils.js';
import { buildCar } from './carBuilder.js';
import { buildInterior } from './interior.js';
import { createVehicle, pickGear, stepVehicle } from './vehiclePhysics.js';
import { collideWithRoadEdges } from '../game/collisions.js';
import { shared, makeHeadlightCookie } from '../render/materials.js';
import { releaseResources } from './carResources.js';

const cookie = makeHeadlightCookie();

// spec = the finished setup of the car to drive (carSetup.js).
export function createPlayer(scene, map, spec, colorIndex, mirrorTexture) {
  const carId = spec.id;
  const car = buildCar(spec, spec.colors[colorIndex % spec.colors.length]);
  const interior = buildInterior(car, mirrorTexture);
  car.body.add(interior.group);
  scene.add(car.group);
  car.group.rotation.order = 'YXZ';                          // yaw first, then pitch, then roll

  const vehicle = createVehicle(spec);
  // Extra fields so collisions.js can treat the vehicle as a "body".
  Object.assign(vehicle, { mass: spec.mass, halfWidth: car.dims.halfW, front: -car.dims.frontZ, rear: car.dims.rearZ, roadIndex: -1, way: map.ways[0] });

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
    beamScale: 1,            // 1 = the beams at full strength; less while a replay films the car (render/replayLook.js)
    flashing: false,         // high-beam flash held
    lastImpact: null,        // filled when we hit a wall this frame
    onGravel: false,
    bodyRoll: 0, bodyRollSpeed: 0, bodyPitch: 0, bodyPitchSpeed: 0, bounce: 0, bounceSpeed: 0,
    s: 0, d: 0, pitch: 0, roll: 0, calmLat: 0, calmLong: 0,

    way: map.ways[0],        // the road the car is on (world/mapData.js: WAYS); s and d are measured along it

    // Put the car on a road: s metres along, d metres right of centre, facing +1 (up) or -1 (down).
    // way = which road (the main one unless told otherwise).
    placeAt(s, d = ROAD.laneWidth / 2, direction = 1, way = map.ways[0]) {
      const p = way.pointAt(s, d * direction);
      Object.assign(vehicle, { x: p.x, z: p.z, yaw: p.yaw + (direction < 0 ? Math.PI : 0), vx: 0, vz: 0, yawRate: 0, gear: 1, roadIndex: -1, way });
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
    // Which road is under the car, and where on it? (The car remembers: that keeps the search quick.)
    const proj = map.locate(vehicle.x, vehicle.z, vehicle.way, vehicle.roadIndex);
    const way = proj.way, { road } = way;
    vehicle.way = player.way = way;
    vehicle.roadIndex = proj.index;
    player.s = proj.s; player.d = proj.d;
    const i = Math.min(proj.index, road.count - 2);
    // Slopes are blended between road samples, otherwise the car would twitch every 2 metres.
    const grade = (way.at(road.y, proj.s + 1.5) - way.at(road.y, proj.s - 1.5)) / 3;   // rise per metre along the road
    const half = way.at(road.half, proj.s);                          // centre line to the edge of the asphalt, here
    const bank = Math.abs(proj.d) < half ? way.at(road.bank, proj.s) : 0;
    const fx = -Math.sin(vehicle.yaw), fz = -Math.cos(vehicle.yaw);
    const along = fx * road.tx[i] + fz * road.tz[i];                // 1 = driving up the road, -1 = down
    const across = -fx * road.tz[i] + fz * road.tx[i];
    const lot = (proj.d > 0 ? road.railR[i] : road.railL[i]) >= 2;  // parking lots and junction mouths are paved
    player.onGravel = Math.abs(proj.d) > half && !lot;
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
    v.y = player.way.roadHeight(player.s, player.d);
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
      if (!(v.handbrake && index >= 2 && v.drift < 0.5)) wheel.spin.rotation.x = -v.wheelAngle * (index >= 2 ? 1 + v.wheelSpin * 0.5 : 1);
    });

    // Lights
    const head = player.flashing ? 2 : player.lightMode;
    car.setLights({ head, brake: v.brake > 0.05, reverse: v.gear === -1 });
    const power = head === 0 ? 0 : head === 1 ? 1 : 2.3;
    for (const beam of beams) {
      beam.intensity = lerp(beam.intensity, power * 760 * player.beamScale, Math.min(1, dt * 18));
      beam.distance = head === 2 ? 260 : 150;
      beam.target.position.y = spec.headlights.y - (head === 2 ? 0.25 : 1.0);
    }
    // Tell the retroreflective materials where the headlights are.
    g.updateMatrixWorld();
    shared.headPos.value.set(0, spec.headlights.y, car.dims.frontZ).applyMatrix4(car.body.matrixWorld);
    shared.headDir.value.set(0, -0.03, -1).transformDirection(car.body.matrixWorld);
    shared.headPower.value = lerp(shared.headPower.value, power * player.beamScale, Math.min(1, dt * 18));
    interior.update(v, player.wiperCycle, dt);
  }
  // The owner fitted different parts: drive on with the new finished setup (carSetup.js).
  // Only numbers change, so the 3D car stays as it is.
  // Put the car exactly here, facing `yaw`, rolling at `speed` (m/s: it only turns the wheels). No
  // physics at all: scenes (render/director.js) and replays move the car themselves, with this.
  player.pose = (x, z, yaw, speed = 0, dt = 1 / 60) => {
    Object.assign(vehicle, { x, z, yaw, vx: -Math.sin(yaw) * speed, vz: -Math.cos(yaw) * speed, yawRate: 0, speed: Math.abs(speed), forwardSpeed: speed,
      steerAngle: 0, accelLong: 0, accelLat: 0, slipFront: 0, slipRear: 0, wheelSpin: 0, drift: 0 });
    vehicle.wheelAngle += (speed / spec.wheelRadius) * dt;
    pickGear(vehicle);                                        // (so a car handed back while moving is in the right gear)
    updateVisuals(dt);
  };
  player.applySetup = (newSpec) => {
    player.spec = newSpec;
    Object.assign(vehicle, { spec: newSpec, mass: newSpec.mass, yawInertia: newSpec.mass * vehicle.a * vehicle.b * 1.05 });
    vehicle.gear = Math.min(vehicle.gear, newSpec.gears.length);
  };
  // Throw the car away and free its 3D data (the cockpit first: it was claimed on its own).
  player.dispose = () => { car.body.remove(interior.group); releaseResources(interior.group); car.dispose(); };
  return player;
}
