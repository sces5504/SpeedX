// ---------------------------------------------------------------------------
// carDetails.js — the small parts that turn a smooth shell into a car:
//
//   lenses       head and tail lamps as moulded glass with a pattern inside
//                (dark and glossy when off, glowing through the pattern when on)
//   body lines   the gaps round the doors, bonnet and boot, window rubbers
//   fittings     door mirrors, door handles, side repeaters, exhaust pipes,
//                front air intake and lip, windscreen wipers
//
// Everything sits ON the skin made by carShell.js (shellSurface()), so it works
// for any car.json. carBuilder.js calls these and wires up the lamps.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';
import { carReflection } from '../render/reflections.js';

const LIMIT = 0.5;      // same reason as PAINT_LIMIT in carBuilder.js: nothing burns out in a headlight beam
const gap = new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.DoubleSide });       // a shut line is just darkness
export const rubber = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.6, side: THREE.DoubleSide }), { limit: LIMIT });
const pipeMetal = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x8d9197, roughness: 0.3, metalness: 1, side: THREE.DoubleSide, envMap: carReflection }), { limit: LIMIT });
export const chrome = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.18, metalness: 1, envMap: carReflection }), { limit: LIMIT });
const mirrorGlass = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.05, metalness: 1, envMap: carReflection }), { limit: LIMIT });

// ---- Lenses -----------------------------------------------------------------------

// A flat piece with rounded corners and a soft edge, `depth` thick, facing +Z, centred.
// Its picture (uv) covers the whole face. radius >= half the height gives a round lamp.
export function plateGeometry(w, h, depth = 0.02, radius = 0.02) {
  const r = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001), x = w / 2, y = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y); shape.absarc(x - r, -y + r, r, -Math.PI / 2, 0);
  shape.lineTo(x, y - r); shape.absarc(x - r, y - r, r, 0, Math.PI / 2);
  shape.lineTo(-x + r, y); shape.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-x, -y + r); shape.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5);
  const edge = Math.min(0.005, depth * 0.4);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - edge, bevelEnabled: true, bevelSize: edge, bevelThickness: edge, bevelSegments: 2, curveSegments: 6 });
  const uv = geometry.attributes.uv, position = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / w + 0.5, position.getY(i) / h + 0.5);
  return geometry;
}

// What you see inside a lamp. White = where the light comes out strongest.
const headPattern = canvasTexture(128, 64, (g, w, h) => {
  g.fillStyle = '#6d7379'; g.fillRect(0, 0, w, h);                       // silvered reflector bowl
  const bowl = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.55);
  bowl.addColorStop(0, '#ffffff'); bowl.addColorStop(0.18, '#e9edf2'); bowl.addColorStop(0.6, '#8d949b'); bowl.addColorStop(1, '#4b5056');
  g.fillStyle = bowl; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(20,24,28,0.35)'; g.lineWidth = 1;                // flutes moulded into the glass
  for (let x = 4; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.strokeStyle = 'rgba(10,12,14,0.9)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
}, { repeat: false });
const tailPattern = canvasTexture(128, 64, (g, w, h) => {
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
  const hot = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.6);
  hot.addColorStop(0, '#ffffff'); hot.addColorStop(0.35, '#c9c9c9'); hot.addColorStop(1, '#5c5c5c');
  g.fillStyle = hot; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.3)';                                       // ribs across the lens, and a grid of little prisms
  for (let y = 3; y < h; y += 7) g.fillRect(0, y, w, 2);
  for (let x = 5; x < w; x += 9) g.fillRect(x, 0, 1, h);
  g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
}, { repeat: false });

// Lens colour when the lamp is off, by the colour of its light.
const UNLIT = { white: 0x9aa0a6, red: 0x5a0a08, amber: 0x6a3a06 };
const kindOf = (glow) => { const c = new THREE.Color(glow); return c.b > 0.5 ? 'white' : c.g > 0.3 ? 'amber' : 'red'; };

/** A lamp material. Switch it on with  material.emissiveIntensity  (carBuilder.js setLights). */
export function lensMaterial(glow) {
  const kind = kindOf(glow), pattern = kind === 'white' ? headPattern : tailPattern;
  return enhanceMaterial(new THREE.MeshStandardMaterial({ color: UNLIT[kind], map: pattern, emissive: glow, emissiveMap: pattern, emissiveIntensity: 0,
    roughness: 0.12, metalness: kind === 'white' ? 0.6 : 0.1, envMap: carReflection, envMapIntensity: 1.2 }), { limit: LIMIT });
}

/**
 * One lamp: a lens in a black surround.
 * @param facing  +1 = looks backward (+Z, tail lamps), -1 = looks forward (headlights)
 * @param round   true for a circular lamp (w is then its diameter)
 */
export function buildLamp(w, h, glow, { facing = 1, depth = 0.03, round = false } = {}) {
  const height = round ? w : h, radius = round ? w / 2 : Math.min(0.025, height * 0.3);
  const turn = facing > 0 ? 0 : Math.PI;
  const lamp = new THREE.Mesh(plateGeometry(w, height, depth, radius).rotateY(turn), lensMaterial(glow));
  const surround = new THREE.Mesh(plateGeometry(w + 0.024, height + 0.024, depth * 0.6, radius + 0.012).rotateY(turn), rubber);
  lamp.add(surround);
  return lamp;
}

// ---- Body lines and fittings ---------------------------------------------------------

// A thin strip between two rows of points (same number of points in each).
function strip(rowA, rowB, material) {
  const positions = [], index = [];
  rowA.forEach((a, i) => { positions.push(a.x, a.y, a.z, rowB[i].x, rowB[i].y, rowB[i].z); });
  for (let i = 0; i < rowA.length - 1; i++) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}
const steps = (from, to, count) => Array.from({ length: count + 1 }, (_, k) => from + ((to - from) * k) / count);

/**
 * Add shut lines, window rubbers, mirrors, handles, repeaters, wipers, intake, lip and exhausts.
 * @param body     the group to add to               @param surface  shellSurface(spec, dims)
 * @param paint    the body colour material
 * @returns {{ repeaters: {L: Mesh[], R: Mesh[]} }}  the side indicator lamps, for the light switchboard
 */
export function addBodyDetails(body, surface, spec, dims, paint) {
  const L = spec.length, LIFT = 0.0025, hero = spec.role === 'hero';
  const cab = surface.cabin, wheelGap = spec.wheelRadius + 0.1;
  const repeaters = { L: [], R: [] };
  if (!cab) return { repeaters };
  const frontArchEnd = surface.tOf(-dims.a + wheelGap), rearArchStart = surface.tOf(dims.b - wheelGap);
  const cowl = spec.stations.find((s) => s[4] === 'ws')[0];
  const rearWindow = spec.stations.findIndex((s) => s[4] === 'rw');
  const deck = rearWindow >= 0 ? spec.stations[rearWindow + 1]?.[0] ?? 1 : 1;                 // where the rear window meets the boot (1 = no boot)
  const doorFront = Math.max(cowl - 0.015, frontArchEnd + 0.012);
  const pillarB = cab.middle + 0.03 / L;
  // Two doors: the door ends behind the B-pillar. Four doors: a second door runs back to the rear wheel.
  const doorEnds = spec.doors === 4 ? [pillarB - 0.03 / L, Math.min(cab.to + 0.01, rearArchStart - 0.004)] : [Math.min(pillarB + 0.03 / L, rearArchStart - 0.01)];
  const line = 0.007 / L;                                    // half the width of a shut line, as a fraction of the length

  for (const side of [-1, 1]) {
    const row = (t, us) => us.map((u) => surface.at(t, u, side, LIFT));
    const lengthwise = (ts, u) => ts.map((t) => surface.at(t, u, side, LIFT));
    // doors: front edge, rear edge(s), and the sill under them
    const upTheSide = steps(3.3, 7.0, 10);
    for (const t of [doorFront, ...doorEnds]) body.add(strip(row(t - line, upTheSide), row(t + line, upTheSide), gap));
    const sillRun = steps(doorFront, doorEnds[doorEnds.length - 1], 14);
    body.add(strip(lengthwise(sillRun, 3.3), lengthwise(sillRun, 3.42), gap));
    // bonnet and boot lid: a line along each edge and one across the front (or back)
    for (const [from, to, cross] of [[0.045, cowl - 0.02, 0.045], [deck + 0.02, 0.965, 0.965]]) {
      if (to - from < 0.05) continue;                        // no real boot (hatchback, truck)
      const run = steps(from, to, 12);
      body.add(strip(lengthwise(run, 9.25), lengthwise(run, 9.38), gap));
      const acrossTheTop = steps(9.3, 13, 8);
      body.add(strip(row(cross - line, acrossTheTop), row(cross + line, acrossTheTop), gap));
    }
    // rubber along the bottom of the side windows
    const glassRun = steps(surface.glassSpan[0], surface.glassSpan[1], 20);
    body.add(strip(lengthwise(glassRun, 7.82), lengthwise(glassRun, 8.06), rubber));
    // "moulding": true in car.json = a black rubbing strip along the doors and round the bumpers
    if (spec.moulding) {
      for (const [from, to] of [[0.004, frontArchEnd - (wheelGap * 2 + 0.02) / L], [frontArchEnd + 0.004, rearArchStart - 0.004], [rearArchStart + (wheelGap * 2 + 0.02) / L, 0.996]]) {
        if (to - from < 0.02) continue;
        const run = steps(from, to, 12);
        body.add(strip(lengthwise(run, 4.75), lengthwise(run, 5.02), rubber));
      }
    }

    // door mirror: a rounded housing on a short stalk at the front corner of the side window
    const mirrorAt = surface.at(surface.glassSpan[0] + 0.05, 7.9, side);
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.105, 0.085, 3, 0.035), paint);
    housing.position.set(mirrorAt.x + side * 0.115, mirrorAt.y + 0.06, mirrorAt.z);
    housing.rotation.y = side * -0.18;
    const glassFace = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.078), mirrorGlass);
    glassFace.position.z = 0.0435;
    housing.add(glassFace);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.05), rubber);
    stalk.position.set(mirrorAt.x + side * 0.02, mirrorAt.y + 0.03, mirrorAt.z);
    housing.castShadow = true;
    body.add(housing, stalk);

    // door handles: one per door, near its rear edge, just under the shoulder
    for (const end of doorEnds) {
      const at = surface.at(end - 0.085 / L, 6.3, side, 0.006);
      const handle = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.024, 0.115, 2, 0.006), hero ? rubber : chrome);
      handle.position.copy(at);
      body.add(handle);
    }
    // side repeater: a small amber lamp on the front wing (flashes with the indicators)
    const repeater = buildLamp(0.06, 0.028, 0xff8a00, { depth: 0.012 });
    repeater.position.copy(surface.at(Math.max(0.04, frontArchEnd - (wheelGap * 2 + 0.16) / L), 5.6, side, 0.002));
    repeater.rotation.y = side * Math.PI / 2;
    body.add(repeater);
    (side < 0 ? repeaters.L : repeaters.R).push(repeater);
  }

  // windscreen wipers, parked along the bottom of the glass
  for (const x of [-0.42, 0.12]) {
    const from = surface.at(cowl + 0.012, 13, 1, 0.012), wiper = new THREE.Mesh(new THREE.BoxGeometry(dims.halfW * 0.62, 0.012, 0.018), rubber);
    wiper.position.set((x + 0.31) * dims.halfW, from.y + 0.004, from.z + 0.02);
    wiper.rotation.y = -0.07;
    wiper.name = 'wiper_parked';                            // (the player's car swaps these for working ones: interior.js)
    body.add(wiper);
  }
  // front: a dark air intake low in the bumper, and (sports cars) a lip under it
  const noseZ = dims.frontZ, low = spec.clearance + 0.07;
  const intake = new THREE.Mesh(plateGeometry(dims.halfW * 1.05, 0.085, 0.02, 0.03).rotateY(Math.PI), rubber);
  intake.position.set(0, low + 0.07, noseZ + 0.012);
  body.add(intake);
  if (hero) {
    const lip = new THREE.Mesh(new RoundedBoxGeometry(dims.halfW * 1.62, 0.035, 0.16, 2, 0.015), rubber);
    lip.position.set(0, low - 0.01, noseZ + 0.07);
    body.add(lip);
    // exhaust: one pipe (or two, "exhausts": 2 in car.json) poking out under the rear bumper
    const pipes = spec.exhausts === 2 ? [-0.5, 0.5] : [0.52];
    for (const x of pipes) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.16, 14, 1, true).rotateX(Math.PI / 2), pipeMetal);
      pipe.position.set(x * dims.halfW, low + 0.03, dims.rearZ - 0.03);
      body.add(pipe);
    }
  }
  return { repeaters };
}
