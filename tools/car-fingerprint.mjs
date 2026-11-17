// car-fingerprint.mjs — proves that a change to the car generator left the other cars exactly as
// they were. It builds every car's body the way the game does and keeps a fingerprint of it
// (every point of the skin, its colours and materials, and where the lamps and parts sit on it).
//   node tools/car-fingerprint.mjs save      before changing src/vehicles/   (-> previews/car-fingerprints.json)
//   node tools/car-fingerprint.mjs check     after: lists every car whose body changed at all
//   node tools/car-fingerprint.mjs check s13 fd     just these cars
// A car you are working on is expected to change; every other car must say "unchanged".
import crypto from 'node:crypto';
import fs from 'node:fs';
import { makeShell } from '../src/vehicles/carShell.js';
import { loadAllCars } from './content.mjs';

const FILE = 'previews/car-fingerprints.json';
const [mode, ...only] = process.argv.slice(2);
if (!['save', 'check'].includes(mode)) { console.log('use: node tools/car-fingerprint.mjs save | check [car ids]'); process.exit(1); }

const cars = await loadAllCars();
const prints = {};
for (const [id, spec] of Object.entries(cars)) {
  if (only.length && !only.includes(id)) continue;
  // (the same measurements carBuilder.js works out)
  const a = spec.wheelbase * (1 - spec.frontWeight), frontZ = -a - spec.frontOverhang;
  const { geometry, surface } = makeShell(spec, { a, b: spec.wheelbase * spec.frontWeight, frontZ, rearZ: frontZ + spec.length, halfW: spec.width / 2 });
  const hash = crypto.createHash('sha1');
  for (const name of Object.keys(geometry.attributes).sort()) hash.update(name + Buffer.from(geometry.attributes[name].array.buffer).toString('hex'));
  if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
  hash.update(JSON.stringify(geometry.groups));
  // Where things are placed on the skin (lamps, door lines, side panels use these).
  for (let t = 0; t <= 1.0001; t += 0.05) for (let u = 0; u <= 14; u += 0.5) { const p = surface.at(t, u, 1, 0.01); hash.update(`${p.x},${p.y},${p.z}`); }
  for (const tail of [false, true]) for (let y = 0.2; y < 1; y += 0.1) for (let s = 0; s < 1; s += 0.1) { const p = surface.onEnd(tail, s, y); hash.update(`${p.x},${p.y},${p.z}`); }
  hash.update(JSON.stringify(surface.windows) + JSON.stringify(surface.cabin));
  prints[id] = hash.digest('hex');
}

if (mode === 'save') {
  fs.mkdirSync('previews', { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(prints, null, 1));
  console.log(`Saved the fingerprints of ${Object.keys(prints).length} cars to ${FILE}.`);
} else {
  if (!fs.existsSync(FILE)) { console.log(`No ${FILE} yet: run "save" before changing the generator.`); process.exit(1); }
  const before = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let changed = 0;
  for (const [id, print] of Object.entries(prints)) {
    const was = before[id];
    const verdict = !was ? 'new (no fingerprint saved)' : was === print ? 'unchanged' : 'CHANGED';
    if (verdict === 'CHANGED') changed++;
    console.log(`${id}: ${verdict}`);
  }
  if (changed) process.exitCode = 1;
}
