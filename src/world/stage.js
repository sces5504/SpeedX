// ---------------------------------------------------------------------------
// stage.js — the black stage a Blacklist driver's car stands on.
//
// A Blacklist driver's car is shown the way a car is unveiled: in the dark,
// first only as glowing LINES tracing its shape, then - as the lamps come up -
// as the car itself. This file is that dark place, those lines and those lamps.
// It is used twice:
//   * the Blacklist screen (ui/blacklist.js): the chosen driver's car, turning slowly
//   * a driver's introduction before the race (game/blacklistIntros.js): the camera
//     moves and the timing are a scene; this file only does what the scene asks
//
//   stage.scene              what to draw while it is in use
//   stage.show(carGroup)     put a car on it (it is lifted out of the world, as in the showroom)
//   stage.hide(world)        give the car back to the world (or to nobody: hide())
//   stage.tint(colour)       the colour of the lines: the driver's own (career.json: "colour")
//   stage.set(lines, light)  lines: 0..1 how bright the outline is; light: 0..1 how far the lamps are up
//   stage.sweep(t)           a bar of light passing over the car from nose to tail: t 0 -> 1 (null = off)
//   stage.update(dt, camera, mouse)   the Blacklist screen's camera, circling the car (drag to look round it)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { orbitCamera } from './showroom.js';

const LINE_COLOUR = 0x57ff9a;      // the game's own green, unless the driver has a colour of their own

export function createStage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const room = new THREE.Group();          // floor and lamps: kept exactly where the car stands
  scene.add(room);
  // A black, slightly shiny floor: it shows the car's reflection and nothing else.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.5, metalness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  // Three lamps, all off to begin with: one high in front, a cold one behind for the outline of the roof, one low at the side.
  const lamps = [[0xfff2e0, 420, 5, 6, -6], [0xbfe0ff, 300, -3, 5, 8], [0xffffff, 160, -7, 2.5, -1]].map(([color, power, x, y, z]) => {
    const lamp = new THREE.SpotLight(color, 0, 45, 0.7, 0.8, 2);
    lamp.position.set(x, y, z);
    lamp.target.position.set(0, 0.5, 0);
    lamp.userData.power = power;
    room.add(lamp, lamp.target);
    return lamp;
  });
  const glow = new THREE.HemisphereLight(0xdfe8ff, 0x101216, 0);
  room.add(glow);
  // The sweep: a narrow lamp straight overhead that travels the length of the car, and the glowing bar it comes from.
  const sweepLamp = new THREE.SpotLight(0xffffff, 0, 12, 0.5, 0.9, 1.5);
  const sweepBar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.04, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sweepBar.visible = false;
  room.add(sweepLamp, sweepLamp.target, sweepBar);

  let car = null, outline = null;
  const colour = new THREE.Color(LINE_COLOUR);
  const lineMaterial = new THREE.LineBasicMaterial({ color: LINE_COLOUR, transparent: true, opacity: 0, depthWrite: false });
  // The camera of the Blacklist screen (the same kind as the showroom's: world/showroom.js).
  const view = { yaw: 2.6, pitch: 0.2, distance: 7.8, wantDistance: 7.8, idle: 99, aim: -0.55 };      // (aim: under the car, so it stands above the name)

  return {
    scene, view,
    show(carGroup) {
      this.hide();
      car = carGroup;
      scene.add(car);
      room.position.copy(car.position); room.quaternion.copy(car.quaternion);
      // The outline: the edges of every piece of the car, drawn as lines that ride along with it.
      outline = [];
      car.traverse((part) => {
        if (!part.isMesh || part.isInstancedMesh || !part.visible) return;
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(part.geometry, 28), lineMaterial);
        part.add(lines);
        outline.push(lines);
      });
    },
    hide(worldScene) {
      for (const lines of outline || []) { lines.removeFromParent(); lines.geometry.dispose(); }
      outline = null;
      if (car && worldScene) worldScene.add(car); else if (car) car.removeFromParent();
      car = null;
      this.sweep(null);
    },
    tint(value) { colour.set(value || LINE_COLOUR); sweepBar.material.color.copy(colour).lerp(new THREE.Color(0xffffff), 0.6).multiplyScalar(2.5); },
    set(lines, light) {
      lineMaterial.opacity = Math.min(1, lines);
      lineMaterial.color.copy(colour).multiplyScalar(1 + lines);            // (over 1: bright enough to glow)
      for (const lamp of lamps) lamp.intensity = lamp.userData.power * light;
      glow.intensity = 0.35 * light;
    },
    sweep(t) {
      sweepBar.visible = t !== null;
      sweepLamp.intensity = t === null ? 0 : 2600 * Math.sin(Math.PI * t);
      if (t === null) return;
      const z = -4.2 + t * 8.4;                                            // nose (-z) to tail
      sweepLamp.position.set(0, 2.6, z); sweepLamp.target.position.set(0, 0, z);
      sweepBar.position.set(0, 2.62, z);
    },
    update(dt, camera, mouse) { if (car) orbitCamera(view, car, dt, camera, mouse); },
  };
}
