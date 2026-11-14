// Headless sanity test for the car physics:  node tools/physics-test.mjs
// Prints 0-100 km/h, top speed, braking distance and cornering grip per car.
// The measuring itself is in src/vehicles/carStats.js (shared with the catalogue page,
// catalog.html, so both always show the same numbers); this file only prints.
import fs from 'node:fs';
import { finishSpec } from '../src/vehicles/carSpecs.js';
import { measureCar } from '../src/vehicles/carStats.js';

// Read every hero car straight from its content folder (so add-on cars are tested too).
const HERO_CARS = Object.fromEntries(JSON.parse(fs.readFileSync('public/content/cars/index.json')).cars
  .map((id) => [id, finishSpec({ id, ...JSON.parse(fs.readFileSync(`public/content/cars/${id}/car.json`)) })])
  .filter(([, spec]) => spec.role === 'hero'));
const only = process.argv[2];                       // optional: node tools/physics-test.mjs <carId>

for (const [id, spec] of Object.entries(HERO_CARS)) {
  if (only && id !== only) continue;
  const m = measureCar(spec);
  console.log(`      brake-in-corner slide ${m.brakeSlideFast.toFixed(0)}° above 55 km/h, ${m.brakeSlide.toFixed(0)}° overall (want < 10 / < 20)   handbrake slide ${m.handSlide.toFixed(0)}° (want > 20)`);
  console.log(`      turn-in @230: ${m.turn230.toFixed(0)}° in 2 s   braking from 200 with full steering: ${m.turnBraking200.toFixed(0)}° in 2 s`);
  console.log(`      turn-in @160: ${m.turn160.toFixed(0)}° in 2 s (slide ${m.slide160.toFixed(0)}°)`);
  console.log(`${id.padEnd(5)} 0-100 ${m.t100?.toFixed(1)}s  0-160 ${m.t160?.toFixed(1)}s  top ${m.top.toFixed(0)} km/h (gear ${m.topGear})  100-0 ${m.brakeDist.toFixed(1)} m  corner ${m.latG.toFixed(2)} g  slide ${m.maxSlide.toFixed(0)}°${m.spun ? ' SPUN' : ''}  power-slide ${m.powerSlide.toFixed(0)}°${m.spunPower ? ' SPUN' : ''}`);
}
