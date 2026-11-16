// ---------------------------------------------------------------------------
// carSetup.js — turns "a car + what its owner changed" into the ONE finished
// setup that everything else uses.
//
// A car's performance is decided in three layers, always in this order:
//
//   1. STOCK       the real car as it left the factory
//                  public/content/cars/<id>/car.json  + its engine in engines.json
//                  (loaded by carSpecs.js)
//   2. BUILD       what the owner changed            -> setupCar() in this file
//                  an engine swap and the performance parts in content/upgrades.json
//   3. GAME TUNE   the arcade dials, the same for every car
//                  PHYSICS in src/config.js (powerBoost, gripBoost, gearing, brakeBoost...),
//                  applied by vehiclePhysics.js while the car is being driven
//
// setupCar() does layers 1 + 2 and hands back a finished spec. The physics, the
// AI drivers, the rating (carRating.js) and every menu are given THAT object, so
// what a menu shows is what the car does on the road.
// A finished spec is never changed afterwards: a different build gets a new one.
//
// A BUILD is plain data (it is what the save file stores for each car):
//   {
//     engine: 'sr20det',                    the engine fitted now (left out = the factory one)
//     engineParts: {                        the parts on each engine the car has had; they stay with
//       'sr20det': { internals: 'internals-2', induction: 'turbo-m', ecu: 'ecu-1' },   that engine
//     },
//     parts: { gearbox: 'gearbox-1', tyres: 'tyres-2' },      the parts on the car itself
//   }
// Each name on the left is a group in upgrades.json, each value one of its options.
// Nothing listed for a group = the factory part.
// ---------------------------------------------------------------------------
import { ENGINES, UPGRADES } from './carSpecs.js';
import { engineTorque } from './vehiclePhysics.js';
import { smoothstep } from '../core/mathUtils.js';

const made = new Map();                      // "car + build" -> finished spec (so the same build is only worked out once)

// ---- Reading and changing a build ---------------------------------------------------------
// (A build is never changed in place: each of these returns a new one. That is what lets the
// garage show "before" and "after" side by side.)

export const engineOf = (stock, build = {}) => build.engine || stock.stockEngine;

// The id of the option fitted in a group ('' = the factory part).
export function fittedIn(stock, build, group) {
  const where = group.perEngine ? build?.engineParts?.[engineOf(stock, build)] : build?.parts;
  return where?.[group.id] || '';
}

// Fit an option ('' = back to the factory part).
export function fitPart(stock, build = {}, group, optionId) {
  if (!group.perEngine) return { ...build, parts: { ...build.parts, [group.id]: optionId } };
  const engineId = engineOf(stock, build);
  return { ...build, engineParts: { ...build.engineParts, [engineId]: { ...build.engineParts?.[engineId], [group.id]: optionId } } };
}

// Fit another engine. Its own parts come back with it if it has been in this car before.
export const swapEngine = (build = {}, engineId) => ({ ...build, engine: engineId });

// The engines that can go in this car: its own first, then the swaps its car.json allows.
export const enginesFor = (stock) => [stock.stockEngine, ...stock.engineSwaps].filter((id) => ENGINES[id]);

// The options of a group that can be fitted with the build as it is now. Every car only ever
// shows these, so there is no combination without a defined effect.
export function optionsFor(stock, build, group) {
  const engine = ENGINES[engineOf(stock, build)];
  return group.options.filter((option) => !option.kind || (engine.fits || []).includes(option.kind));
}

// Every option fitted right now, in the order of upgrades.json. (An option the present engine
// cannot take - say a part left in an old save - is simply not fitted.)
function fittedOptions(stock, build) {
  return UPGRADES.groups.map((group) => optionsFor(stock, build, group).find((option) => option.id === fittedIn(stock, build, group))).filter(Boolean);
}

// ---- The engine with its parts ------------------------------------------------------------------
// (Also used by the catalogue page to show and rev one engine with a kit on it: engineWithParts.)
export const engineWithParts = (engine, options) => tunedEngine(engine, options);
function tunedEngine(engine, options) {
  let torque = 1, redline = engine.redline, kit = null;
  for (const option of options) {
    torque *= option.torque ?? 1;
    redline += option.redline ?? 0;
    if (option.boost) kit = option;
  }
  if (torque === 1 && redline === engine.redline && !kit) return engine;      // nothing fitted: the engine as it is in the library
  const induction = kit ? kit.kind : engine.induction;           // what is blowing air into it now (the sound uses this)

  // A kit on an engine that already has a factory turbo replaces that turbo: only part of the gain.
  const boost = kit ? kit.boost * (engine.aspiration === 'turbo' ? UPGRADES.factoryTurboShare : 1) : 0;
  // Read the factory curve every 250 rpm, then change it point by point.
  const first = engine.torque[0][0], peakRpm = engine.torque.reduce((best, point) => (point[1] > best[1] ? point : best))[0];
  const curve = [];
  for (let rpm = first; ; rpm = Math.min(rpm + 250, engine.redline)) {
    // a higher red line stretches the part of the curve above the torque peak
    const newRpm = rpm <= peakRpm ? rpm : peakRpm + (rpm - peakRpm) * (redline - peakRpm) / (engine.redline - peakRpm);
    // a turbo gives little below its spool speed (lag) and everything above it; a supercharger always pushes
    const pushing = kit?.kind === 'turbo' ? 0.15 + 0.85 * smoothstep(kit.spool - 1500, kit.spool, newRpm) : 1;
    curve.push([Math.round(newRpm), engineTorque({ engine }, rpm) * torque * (1 + boost * pushing)]);
    if (rpm >= engine.redline) break;
  }
  return { ...engine, torque: curve, redline, induction, turboSize: kit?.size ?? 1 };
}

// ---- The whole car ---------------------------------------------------------------------------------
/**
 * @param stock  a car from carSpecs.js (HERO_CARS[id])
 * @param build  what the owner changed (see the top of this file); nothing = the car as it left the factory
 * @returns the finished spec: the same fields as `stock`, changed by the build
 */
export function setupCar(stock, build = {}) {
  const engineId = ENGINES[engineOf(stock, build)] ? engineOf(stock, build) : stock.stockEngine;
  const options = fittedOptions(stock, { ...build, engine: engineId });
  if (engineId === stock.stockEngine && !options.length) return stock;       // nothing changed: the factory car itself
  const key = [stock.id, engineId, ...options.map((option) => option.id)].join('|');
  if (made.has(key)) return made.get(key);

  const spec = { ...stock, engine: tunedEngine(ENGINES[engineId], options), gears: [...stock.gears] };
  spec.sound = spec.engine.sound;
  spec.mass = stock.mass + (ENGINES[engineId].mass - ENGINES[stock.stockEngine].mass);     // a heavier or lighter engine
  for (const option of options) {
    spec.mass *= option.mass ?? 1;
    spec.grip *= option.grip ?? 1;
    spec.brakeG *= option.brakeG ?? 1;
    spec.shiftTime = option.shiftTime ?? spec.shiftTime;
    spec.driveEfficiency = option.efficiency ?? spec.driveEfficiency;
    if (option.extraGear) spec.gears.push(spec.gears[spec.gears.length - 1] * option.extraGear);
  }
  spec.mass = Math.round(spec.mass);
  made.set(key, spec);
  return spec;
}
