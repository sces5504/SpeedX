// ---------------------------------------------------------------------------
// replayLook.js — how a replay is LIT. Only when the car is filmed from outside (a replay, and
// the first shots of a Blacklist race's rolling start): driving looks as it always did.
//
// Driving, the night is lit for the driver: black beyond the headlights, and the
// headlights themselves burning white whatever they touch. Seen from a camera at
// the roadside that is harsh - a white patch and a black car. So for a replay the
// scene is lit the way a film crew lights a night shoot:
//   * FILL: a soft, cool light from the whole sky, so the car has shape in the dark
//   * KEY:  one gentle lamp that stays near the camera, on the car's side of it
//   * the HEADLIGHT BEAMS are turned down (yours and everyone's), and so is what
//     road signs and paint throw back, so nothing burns out
// The strengths are GRAPHICS.replay in config.js.
//
//   look.on(player)            when the replay starts
//   look.follow(camera, hero)  every frame of it (hero = where the player's car is: { x, y, z })
//   look.off(player)           when it ends: everything is as it was
//   look.beams                 1 while driving, less in a replay: main.js multiplies the AI cars' beams by it
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS } from '../config.js';
import { shared } from './materials.js';

export function createReplayLook(scene) {
  const fill = new THREE.HemisphereLight(0x9db4e0, 0x23262c, 0);
  const key = new THREE.PointLight(0xfff1e2, 0, 45, 1.4);
  scene.add(fill, key);

  const look = {
    beams: 1,
    on(player) {
      if (look.beams !== 1) return;                            // (already on)
      const dial = GRAPHICS.replay;
      fill.intensity = dial.fill; key.intensity = dial.key;
      look.beams = dial.beams;
      player.beamScale = dial.beams;                           // (playerCar.js keeps its beams to this from now on)
      player.beams.forEach((beam) => { beam.intensity *= dial.beams; });
      shared.headPower.value *= dial.beams;                    // (signs and lane paint answer the headlights less)
    },
    follow(camera, hero) {
      // Between the camera and the car, nearer the camera, and well above the road.
      key.position.set(camera.position.x + (hero.x - camera.position.x) * 0.3, Math.max(camera.position.y, hero.y) + 3.5, camera.position.z + (hero.z - camera.position.z) * 0.3);
    },
    off(player) {
      fill.intensity = key.intensity = 0;
      look.beams = 1;
      if (player.beamScale !== 1) player.beams.forEach((beam) => { beam.intensity /= player.beamScale; });
      player.beamScale = 1;                                    // (the next frame of driving sets shared.headPower itself)
    },
  };
  return look;
}
