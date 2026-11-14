// ---------------------------------------------------------------------------
// signals.js — traffic lights, for maps whose map.json lists "signals" (the
// real ones along the road, found by tools/build-map.mjs).
//
// Each light is a mast on the right of each direction of travel with an arm
// over the lanes and a row of three lamps (red on the left, as in Taiwan), and
// a white stop line and a zebra crossing painted across those lanes before it.
//
// A light runs green -> yellow -> red on a fixed cycle; lights further up the
// road start a little later, so traffic moving at the limit meets a "green
// wave". The state is written to map.signals[i].state, which is where the AI
// drivers read it (ai/aiCar.js: signalSpeed). Nothing forces YOU to stop.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS } from '../config.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';
import { drawNear } from '../render/drawDistance.js';
import { roadPaint } from './road.js';

const GREEN_S = 24, YELLOW_S = 3, RED_S = 13;                  // seconds each colour lasts
const CYCLE_S = GREEN_S + YELLOW_S + RED_S;
const STOP_LINE_M = 6;                                          // how far before the mast the stop line is painted
const COLORS = { red: 0xff2a1a, yellow: 0xffb000, green: 0x22ff8a };
const LEVEL = GRAPHICS.buildingLights;

/** @returns { group, lights, update(dt) } — lights: [{ position, color, power }] for the coloured glow on the road */
export function buildSignals(map) {
  const group = new THREE.Group();
  group.name = 'signals';
  const steel = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.6, metalness: 0.5 }), { limit: 0.5 });
  const housing = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
  const paint = roadPaint(0xd8d8d2);
  // Zebra stripes: a picture of white bars, repeated across the road.
  const stripes = roadPaint(0xd8d8d2, { alphaTest: 0.5, map: canvasTexture(32, 8, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, w / 2, h); }) });
  stripes.map.repeat.set(9, 1);
  const lights = [], heads = [];
  const p = {};
  const box = (w, h, d, material, x, y, z) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); return mesh; };

  map.signals.forEach((signal, number) => {
    const { road } = map, i = signal.index;
    const lanesWide = road.lanes[i] * road.laneWidth[i];
    const one = new THREE.Group();
    // Its own three lamp materials, so this light can change colour on its own.
    const lamps = { red: new THREE.MeshBasicMaterial(), yellow: new THREE.MeshBasicMaterial(), green: new THREE.MeshBasicMaterial() };
    for (const dir of [1, -1]) {
      // The mast stands just behind the guardrail line on the right of someone driving `dir`.
      // In its own coordinates: -Z is the way they are driving, +X is their right.
      const mast = new THREE.Group();
      map.pointAt(signal.s, dir * (road.barrier[i] + 0.6), p);
      mast.position.set(p.x, p.y, p.z);
      mast.rotation.y = p.yaw + (dir > 0 ? 0 : Math.PI);
      const reach = road.barrier[i] + 0.6 - road.median[i] - lanesWide / 2;          // from the mast to the middle of their lanes
      mast.add(box(0.22, 6.6, 0.22, steel, 0, 3.3, 0), box(reach, 0.14, 0.14, steel, -reach / 2, 6.4, 0), box(1.6, 0.55, 0.3, housing, -reach, 6.4, 0.05));
      ['red', 'yellow', 'green'].forEach((color, k) => mast.add(box(0.36, 0.36, 0.1, lamps[color], -reach - 0.5 + k * 0.5, 6.4, 0.22)));   // facing the drivers coming up behind
      one.add(mast);
      // What its lit lamp throws on the road below.
      mast.updateMatrixWorld(true);
      lights.push({ signal, position: mast.localToWorld(new THREE.Vector3(-reach, 5.6, 1.5)), color: COLORS.green, power: 0 });
      // The stop line, across this direction's lanes.
      map.pointAt(signal.s - dir * STOP_LINE_M, dir * (road.median[i] + lanesWide / 2), p);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(lanesWide, 0.4), paint);
      line.rotation.set(-Math.PI / 2, p.yaw, 0, 'YXZ');                               // turned to lie across the road, then laid flat
      line.position.set(p.x, p.y + 0.015, p.z);
      line.receiveShadow = true;
      one.add(line);
      // ...and a zebra crossing between the stop line and the mast.
      map.pointAt(signal.s - dir * (STOP_LINE_M - 3.2), dir * (road.median[i] + lanesWide / 2), p);
      const zebra = new THREE.Mesh(new THREE.PlaneGeometry(lanesWide, 3.2), stripes);
      zebra.rotation.set(-Math.PI / 2, p.yaw, 0, 'YXZ');
      zebra.position.set(p.x, p.y + 0.014, p.z);
      one.add(zebra);
    }
    heads.push({ signal, lamps, offset: (signal.s / 14 + number * 3) % CYCLE_S });     // 14 m/s: the green wave
    group.add(drawNear(one));
  });

  let clock = 0;
  const dark = new THREE.Color(0x0a0a0a);
  function update(dt) {
    clock += dt;
    for (const head of heads) {
      const t = (clock + CYCLE_S - head.offset) % CYCLE_S;
      const state = t < GREEN_S ? 'green' : t < GREEN_S + YELLOW_S ? 'yellow' : 'red';
      head.signal.state = state;
      for (const color of ['red', 'yellow', 'green']) {
        if (color === state) head.lamps[color].color.set(COLORS[color]).multiplyScalar(3.2 * LEVEL);       // bright enough to bloom
        else head.lamps[color].color.copy(dark);
      }
    }
    for (const light of lights) { light.color = COLORS[light.signal.state]; light.power = 26 * LEVEL; }
  }
  update(0);
  return { group, lights, update };
}
