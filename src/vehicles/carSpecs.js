// ---------------------------------------------------------------------------
// carSpecs.js — loads every car's data sheet, the engine library and the name list.
//
// Cars are NOT written in code. Each car is a folder:
//     public/content/cars/<id>/car.json      the data sheet (real-world numbers)
//     public/content/cars/<id>/model.glb     optional 3D model
// and public/content/cars/index.json lists which folders are switched on.
// Add a folder + its id to the list = new car. Remove them = car gone.
// (See .claude/skills/speedx-add-car for the full recipe and the JSON fields.)
//
// "hero" cars can be driven by the player and by rival racers. They have an engine:
//     public/content/engines.json   every engine in the game, with its real factory figures.
//                                   A hero car.json names one: "engine": "sr20det".
//     public/content/names.json     the made-up brand and model names players see
//                                   (edit that file to rename a car, an engine or a part).
//     public/content/upgrades.json  the performance parts a hero car can be fitted with.
//     public/content/cars/<id>/kit.json   optional: the body parts that car can be restyled with (carLook.js).
// "traffic" cars are ordinary road users, driven by AI only: no engine data, no rating.
//
// What comes out of this file is each car AS IT LEFT THE FACTORY. A car the player has
// modified is made from one of these by carSetup.js.
// ---------------------------------------------------------------------------

export const HERO_CARS = {};
export const TRAFFIC_CARS = {};
export const ALL_CARS = {};
export const ENGINES = {};                  // engine id -> its data, ready to use (see readyEngine)
export const UPGRADES = { groups: [] };     // upgrades.json: the performance parts, group by group
const NAMES = { cars: {}, engines: {}, parts: {} };    // names.json

export const toNumber = (color) => (typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : color);
const fetchJson = async (path) => (await fetch(path)).json();

// The made-up name of a car, an engine or a part: { brand, name, full }.   kind: 'cars' | 'engines' | 'parts'
// (a part also has `is`: a few plain words saying what it is)
// Something that is not in names.json yet is shown by its id, so it is easy to spot.
export function nameOf(kind, id) {
  const entry = NAMES[kind]?.[id];
  if (!entry) return { brand: '', name: id.toUpperCase(), full: id.toUpperCase() };
  return { brand: entry.brand, name: entry.name, full: `${entry.brand} ${entry.name}`, real: entry.real, is: entry.is };     // (real: only the catalogue page shows it)
}

// An engine from the library with its id and its player-facing name filled in.
function readyEngine(id, data) {
  const label = nameOf('engines', id);
  // brakeTorque: how hard the engine holds the car back off the throttle (its factory peak torque; tuning does not change it)
  return { ...data, id, brand: label.brand, name: label.name, fullName: label.full, realName: label.real,
    brakeTorque: Math.max(...data.torque.map((point) => point[1])),
    // induction: what blows air into it - 'turbo', 'supercharger' or null. (A kit from the garage changes it; the sound uses it.)
    induction: { turbo: 'turbo', supercharged: 'supercharger' }[data.aspiration] || null };
}

// Fill in anything a data sheet left out, so the rest of the game can rely on it.
export function finishSpec(spec) {
  spec.colors = spec.colors.map(toNumber);
  if (spec.twoTone !== undefined) spec.twoTone = toNumber(spec.twoTone);
  spec.frontWeight ??= 0.58;
  spec.clearance ??= 0.18;
  spec.tumble ??= 0.8;
  spec.grip ??= 1;
  spec.brakeG ??= 1;
  spec.cgHeight ??= 0.5;
  spec.dragArea ??= 0.65;
  spec.driverSide ??= -1;
  spec.drive ??= 'rwd';                     // which wheels the engine turns: 'rwd', 'fwd' or 'awd'
  spec.shiftTime ??= 0.14;                  // seconds without drive during a gear change
  spec.driveEfficiency ??= 0.88;            // share of the engine's power that reaches the wheels
  spec.engineSwaps ??= [];                  // other engines (ids in engines.json) that fit this car
  spec.gaugeColor ??= '#ffffff';
  if (typeof spec.engine === 'string') {
    // car.json names its engine; the game works with the engine's data.
    spec.stockEngine = spec.engine;         // remembered, so an engine swap can be undone
    spec.engine = ENGINES[spec.engine];
    if (!spec.engine) throw new Error(`engine "${spec.stockEngine}" is not in content/engines.json`);
    spec.sound = spec.engine.sound;         // the engine decides the voice (audio.js)
  }
  if (spec.role === 'hero') {
    const label = nameOf('cars', spec.id);
    Object.assign(spec, { brand: label.brand, modelName: label.name, name: label.full, realName: label.real });   // e.g. "BRINEWAKE", "Lowtide S27"
  }
  return spec;
}

// readJson(path) reads one file under public/. The game fetches it; the tools in tools/ pass
// their own reader (see tools/content.mjs), so they load cars exactly the way the game does.
export async function loadCars(readJson = fetchJson) {
  const [index, engines, names, upgrades, kits] = await Promise.all(['cars/index', 'engines', 'names', 'upgrades', 'kits'].map((file) => readJson(`content/${file}.json`)));
  Object.assign(NAMES, names);
  Object.assign(UPGRADES, upgrades);
  for (const [id, data] of Object.entries(engines.engines)) ENGINES[id] = readyEngine(id, data);
  const loaded = await Promise.all(index.cars.map(async (id) => {
    try {
      const spec = await readJson(`content/cars/${id}/car.json`);
      // "kit": true in car.json = the car has body parts to choose from, in kit.json beside it (carLook.js).
      const kit = spec.kit ? await readJson(`content/cars/${id}/kit.json`) : undefined;
      // { "use": "rims" } in a kit = that group of shared parts from content/kits.json, minus any options listed in "without".
      if (kit) kit.groups = kit.groups.map((group) => (group.use ? { ...kits.groups[group.use], options: kits.groups[group.use].options.filter((option) => !group.without?.includes(option.id)) } : group));
      return finishSpec({ ...spec, kit, id, folder: `content/cars/${id}/` });
    } catch (error) {
      console.warn(`Car "${id}" could not be loaded and was skipped:`, error);   // a broken add-on never breaks the game
      return null;
    }
  }));
  for (const spec of loaded) {
    if (!spec) continue;
    ALL_CARS[spec.id] = spec;
    (spec.role === 'hero' ? HERO_CARS : TRAFFIC_CARS)[spec.id] = spec;
  }
}
