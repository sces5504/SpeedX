// ---------------------------------------------------------------------------
// signals.js — traffic lights. A map has them in two ways (world/mapData.js):
//   "signals"          places along a road: a light on its own, with a zebra crossing
//   "signalJunctions"  junctions: a light on every road that meets there
//
// Each light is a mast on the right of the direction of travel it faces, with an arm
// over the lanes and a row of three lamps (red on the left, as in Taiwan), and
// a white stop line and a zebra crossing painted across those lanes before it.
//
// A light on its own runs green -> yellow -> red on a fixed cycle; lights further up the
// road start a little later, so traffic moving at the limit meets a "green wave".
// At a junction the main road and the roads that join it get green in turn, with a
// moment of red for everyone in between.
// The state is written to each signal (way.signals[i].state), which is where the AI
// drivers read it (ai/aiCar.js: signalSpeed). Nothing forces YOU to stop.
// The masts are solid: `obstacles` lists them for the collisions (main.js).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS } from '../config.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';
import { drawNear } from '../render/drawDistance.js';
import { roadPaint } from './road.js';

const GREEN_S = 24, YELLOW_S = 3, RED_S = 13;                  // a light on its own: seconds each colour lasts
const CYCLE_S = GREEN_S + YELLOW_S + RED_S;
// A junction: seconds of green for the main road and for the roads joining it, yellow, and red for everyone.
const MAIN_GREEN_S = 18, SIDE_GREEN_S = 12, ALL_RED_S = 1.5;
const JUNCTION_CYCLE_S = MAIN_GREEN_S + SIDE_GREEN_S + 2 * (YELLOW_S + ALL_RED_S);
const STOP_LINE_M = 6;                                          // how far before the mast the stop line is painted (a light on its own)
const COLORS = { red: 0xff2a1a, yellow: 0xffb000, green: 0x22ff8a };
const LEVEL = GRAPHICS.buildingLights;

// The colour of one signal, `t` seconds into its cycle.
function colourOf(signal, t) {
  if (!signal.junction) return t < GREEN_S ? 'green' : t < GREEN_S + YELLOW_S ? 'yellow' : 'red';
  // (the roads that join start their part of the cycle where the main road's ends)
  const mine = signal.group === 0 ? t : (t - MAIN_GREEN_S - YELLOW_S - ALL_RED_S + JUNCTION_CYCLE_S) % JUNCTION_CYCLE_S;
  const green = signal.group === 0 ? MAIN_GREEN_S : SIDE_GREEN_S;
  return mine < green ? 'green' : mine < green + YELLOW_S ? 'yellow' : 'red';
}

/** @returns { group, lights, obstacles, update(dt) } — lights: [{ position, color, power }] for the coloured glow on the road */
export function buildSignals(map) {
  const group = new THREE.Group();
  group.name = 'signals';
  const steel = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.6, metalness: 0.5 }), { limit: 0.5 });
  const housing = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
  const paint = roadPaint(0xd8d8d2);
  // Zebra stripes: a picture of white bars, repeated across the road.
  const stripes = roadPaint(0xd8d8d2, { alphaTest: 0.5, map: canvasTexture(32, 8, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, w / 2, h); }) });
  stripes.map.repeat.set(9, 1);
  const lights = [], heads = [], obstacles = [];
  const p = {};
  const box = (w, h, d, material, x, y, z) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); return mesh; };

  let number = 0;
  for (const way of map.ways) for (const signal of way.signals) {
    const { road } = way, atJunction = Boolean(signal.junction);
    const one = new THREE.Group();
    // Its own three lamp materials, so this light can change colour on its own.
    const lamps = { red: new THREE.MeshBasicMaterial(), yellow: new THREE.MeshBasicMaterial(), green: new THREE.MeshBasicMaterial() };
    for (const dir of signal.dirs || [1, -1]) {
      // Where things stand along the road, for someone driving `dir`. On its own: the mast at the
      // light's place, the stop line a little before it. At a junction: the stop line where the
      // signal says (clear of the road being crossed), the mast beside it.
      const lineS = signal.s - dir * (atJunction ? signal.line : STOP_LINE_M), mastS = atJunction ? lineS + dir * 0.6 : signal.s;
      const i = way.indexAt(lineS), lanesWide = road.lanes[i] * road.laneWidth[i];
      // The mast stands on the right, just behind the guardrail line - or, at a junction, just
      // outside the paving of its cut-back corner. In its own coordinates: -Z is the way they are driving, +X is their right.
      const out = atJunction ? (dir > 0 ? road.limitR[i] : road.limitL[i]) + 0.8 : road.barrier[i] + 0.6;
      const mast = new THREE.Group();
      way.pointAt(mastS, dir * out, p);
      mast.position.set(p.x, p.y, p.z);
      mast.rotation.y = p.yaw + (dir > 0 ? 0 : Math.PI);
      obstacles.push({ x: p.x, z: p.z, yaw: mast.rotation.y, halfWidth: 0.2, front: 0.2, rear: 0.2 });
      const reach = out - road.median[i] - lanesWide / 2;                              // from the mast to the middle of their lanes
      mast.add(box(0.22, 6.6, 0.22, steel, 0, 3.3, 0), box(reach, 0.14, 0.14, steel, -reach / 2, 6.4, 0), box(1.6, 0.55, 0.3, housing, -reach, 6.4, 0.05));
      ['red', 'yellow', 'green'].forEach((color, k) => mast.add(box(0.36, 0.36, 0.1, lamps[color], -reach - 0.5 + k * 0.5, 6.4, 0.22)));   // facing the drivers coming up behind
      one.add(mast);
      // What its lit lamp throws on the road below.
      mast.updateMatrixWorld(true);
      lights.push({ signal, position: mast.localToWorld(new THREE.Vector3(-reach, 5.6, 1.5)), color: COLORS.green, power: 0 });
      // The stop line, across this direction's lanes.
      way.pointAt(lineS, dir * (road.median[i] + lanesWide / 2), p);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(lanesWide, 0.4), paint);
      line.rotation.set(-Math.PI / 2, p.yaw, 0, 'YXZ');                               // turned to lie across the road, then laid flat
      line.position.set(p.x, p.y + 0.015, p.z);
      line.receiveShadow = true;
      one.add(line);
      // ...and a zebra crossing just beyond the stop line.
      way.pointAt(lineS + dir * 3.2, dir * (road.median[i] + lanesWide / 2), p);
      const zebra = new THREE.Mesh(new THREE.PlaneGeometry(lanesWide, 3.2), stripes);
      zebra.rotation.set(-Math.PI / 2, p.yaw, 0, 'YXZ');
      zebra.position.set(p.x, p.y + 0.014, p.z);
      one.add(zebra);
    }
    // When its cycle starts: a light on its own a little later the further up the road it is (14 m/s:
    // the green wave); the lights of one junction together.
    const offset = atJunction ? (map.junctions.indexOf(signal.junction) * 7) % JUNCTION_CYCLE_S : (signal.s / 14 + number * 3) % CYCLE_S;
    heads.push({ signal, lamps, offset, cycle: atJunction ? JUNCTION_CYCLE_S : CYCLE_S });
    group.add(drawNear(one));
    number++;
  }

  let clock = 0;
  const dark = new THREE.Color(0x0a0a0a);
  function update(dt) {
    clock += dt;
    for (const head of heads) {
      const state = colourOf(head.signal, (clock + head.cycle - head.offset) % head.cycle);
      head.signal.state = state;
      for (const color of ['red', 'yellow', 'green']) {
        if (color === state) head.lamps[color].color.set(COLORS[color]).multiplyScalar(3.2 * LEVEL);       // bright enough to bloom
        else head.lamps[color].color.copy(dark);
      }
    }
    for (const light of lights) { light.color = COLORS[light.signal.state]; light.power = 26 * LEVEL; }
  }
  update(0);
  return { group, lights, obstacles, update };
}
