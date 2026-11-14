// check-car-shape.mjs — looks for wrinkles in the generated bodywork of every car.
//   node tools/check-car-shape.mjs            every car
//   node tools/check-car-shape.mjs fd civic   just these
// Real panels are smooth: following the skin along the car it bends one way, gently. A wrinkle
// is a place where it steps or zig-zags. For every point of every ring this measures how far
// the point sits off the straight line between its two neighbours along the car ("bump") and
// reports the places where three bumps in a row point up, down, up.
import fs from 'node:fs';
import { makeShell, ACROSS } from '../src/vehicles/carShell.js';
import { finishSpec } from '../src/vehicles/carSpecs.js';

const LIMIT = 0.002;         // metres: zig-zags smaller than this cannot be seen
const names = ['floor', 'floor', 'floor', 'sill', 'lower door', 'waist', 'upper door', 'under the shoulder', 'shoulder', 'glass (bottom)', 'glass (top)', 'roof edge', 'roof', 'roof', 'centre line'];
const ids = process.argv.length > 2 ? process.argv.slice(2) : JSON.parse(fs.readFileSync('public/content/cars/index.json')).cars;
let total = 0;
for (const id of ids) {
  const spec = finishSpec({ ...JSON.parse(fs.readFileSync(`public/content/cars/${id}/car.json`)), id });
  // (the same measurements carBuilder.js works out)
  const a = spec.wheelbase * (1 - spec.frontWeight), frontZ = -a - spec.frontOverhang;
  const dims = { a, b: spec.wheelbase * spec.frontWeight, frontZ, rearZ: frontZ + spec.length, halfW: spec.width / 2 };
  const position = makeShell(spec, dims).geometry.attributes.position, perRing = ACROSS * 2 - 2, rings = position.count / perRing;
  const at = (i, j) => [position.getX(i * perRing + j), position.getY(i * perRing + j), position.getZ(i * perRing + j)];
  const found = [];
  for (let j = 5; j < ACROSS; j++) {                         // (from the waist up: the sill steps up at each wheel arch on purpose)
    if (j === 9 || j === 10) continue;                       // (the edges of the side glass follow the window outlines, corners and all)
    // bump[i] = how far point i is off the line between its neighbours, sideways (x) and up (y)
    const bump = [];
    for (let i = 1; i < rings - 1; i++) {
      const p = at(i - 1, j), q = at(i, j), r = at(i + 1, j), f = (q[2] - p[2]) / (r[2] - p[2]);
      bump[i] = [q[0] - (p[0] + (r[0] - p[0]) * f), q[1] - (p[1] + (r[1] - p[1]) * f)];
    }
    for (let i = 2; i < rings - 2; i++) {
      if (Math.min(at(i, j)[2] - frontZ, frontZ + spec.length - at(i, j)[2]) < 0.1) continue;     // (the last 10 cm are the corners of the nose and tail: edges on purpose)
      for (const axis of [0, 1]) {
        // three bumps in a row pointing up, down, up (or the other way round) = a zig-zag
        const [before, here, after] = [bump[i - 1][axis], bump[i][axis], bump[i + 1][axis]];
        const size = Math.min(Math.abs(before), Math.abs(here), Math.abs(after));
        if (before * here < 0 && here * after < 0 && size > LIMIT) found.push({ t: (at(i, j)[2] - frontZ) / spec.length, j, size: Math.abs(here), axis });
      }
    }
  }
  // Report each stretch of the car once, with its worst spot.
  found.sort((p, q) => q.size - p.size);
  const shown = [];
  for (const spot of found) if (!shown.some((s) => Math.abs(s.t - spot.t) < 0.03 && Math.abs(s.j - spot.j) <= 1)) shown.push(spot);
  total += shown.length;
  console.log(`${id}: ${shown.length ? shown.length + ' wrinkle(s)' : 'smooth'}`);
  for (const s of shown.slice(0, 12)) console.log(`   ${(s.t * spec.length).toFixed(2)} m from the nose (t = ${s.t.toFixed(3)}), ${names[s.j]}: ${(s.size * 1000).toFixed(0)} mm ${s.axis ? 'up/down' : 'in/out'}`);
}
if (total) process.exitCode = 1;
