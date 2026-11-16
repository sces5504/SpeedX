// content.mjs — lets the tools in this folder load cars exactly the way the game does.
//   import { loadHeroCars } from './content.mjs';
// The game reads its content files with fetch(); a tool reads the same files from disk.
// Run tools from the project folder (node tools/<name>.mjs).
import fs from 'node:fs';
import { ALL_CARS, HERO_CARS, loadCars } from '../src/vehicles/carSpecs.js';

export const readJson = async (path) => JSON.parse(fs.readFileSync('public/' + path));

// Every installed car, finished the way the game finishes it (engine from the library, names...).
export async function loadAllCars() { await loadCars(readJson); return ALL_CARS; }
export async function loadHeroCars() { await loadCars(readJson); return HERO_CARS; }
