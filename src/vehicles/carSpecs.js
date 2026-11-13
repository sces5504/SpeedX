// ---------------------------------------------------------------------------
// carSpecs.js — loads every car's data sheet.
//
// Cars are NOT written in code. Each car is a folder:
//     public/content/cars/<id>/car.json      the data sheet (real-world numbers)
//     public/content/cars/<id>/model.glb     optional 3D model
// and public/content/cars/index.json lists which folders are switched on.
// Add a folder + its id to the list = new car. Remove them = car gone.
// (See .claude/skills/speedx-add-car for the full recipe and the JSON fields.)
//
// "hero" cars can be driven by the player and by rival racers.
// "traffic" cars are ordinary road users, driven by AI only.
// ---------------------------------------------------------------------------

export const HERO_CARS = {};
export const TRAFFIC_CARS = {};
export const ALL_CARS = {};

const toNumber = (color) => (typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : color);

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
  spec.gaugeColor ??= '#ffffff';
  return spec;
}

export async function loadCars() {
  const index = await (await fetch('content/cars/index.json')).json();
  const loaded = await Promise.all(index.cars.map(async (id) => {
    try {
      const spec = await (await fetch(`content/cars/${id}/car.json`)).json();
      return finishSpec({ ...spec, id, folder: `content/cars/${id}/` });
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
