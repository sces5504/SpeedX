// ---------------------------------------------------------------------------
// randomBuild.js — a car as some street racer might have built it.
//
// The racers you meet on the road do not drive factory cars: each has a car with
// its own mix of performance parts (carSetup.js) and body parts (carLook.js),
// drawn at random here from exactly the parts the player's garage offers for
// that car. Nothing special is made for them: a racer's car is one the player
// could build too.
//
//   randomCar(heroCars)  ->  { id, build, look, setup, spec, rating, limits }
//       setup = the finished car (carSetup.js), spec = the same with its body parts on
//       (ready for carBuilder.js), rating and limits = how good it is (carRating.js)
//
// `tune` (0..1) is how far the owner has gone: 0 = as it left the factory,
// 1 = everything, probably with another engine in it.
// ---------------------------------------------------------------------------
import { UPGRADES } from './carSpecs.js';
import { enginesFor, fitPart, optionsFor, setupCar, swapEngine } from './carSetup.js';
import { dressCar, fitLook, lookGroups, takenOverBy } from './carLook.js';
import { rateCar } from './carRating.js';

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Performance parts. A group whose options are steps (stage 1, 2, 3) gets a step about as
// high as `tune`; a group whose options are different kinds of the same thing (single turbo,
// twin turbos, supercharger) gets one of them or none.
export function randomBuild(stock, tune) {
  let build = {};
  const engines = enginesFor(stock);
  if (engines.length > 1 && Math.random() < tune * 0.4) build = swapEngine(build, pick(engines.slice(1)));
  for (const group of UPGRADES.groups) {
    const options = optionsFor(stock, build, group);
    if (!options.length) continue;
    if (options.some((option) => option.kind)) {
      if (Math.random() < tune * 0.7) build = fitPart(stock, build, group, pick(options).id);
      continue;
    }
    const step = Math.round(tune * options.length + (Math.random() - 0.5) * 1.6);       // 0 = the factory part
    if (step >= 1) build = fitPart(stock, build, group, options[Math.min(step, options.length) - 1].id);
  }
  return build;
}

// Body parts: each place on the car (bumper, wing, rims, livery...) is restyled about half the time.
export function randomLook(stock) {
  let look = {};
  for (const group of lookGroups(stock)) {
    if (Math.random() < 0.5 && !takenOverBy(stock, look, group)) look = fitLook(look, group, pick(group.options).id);
  }
  return look;
}

// One racer's car: any hero car, tuned a little or a lot (most of them only a little).
export function randomCar(heroCars) {
  const id = pick(Object.keys(heroCars)), stock = heroCars[id];
  const build = randomBuild(stock, Math.random() ** 1.6), look = randomLook(stock);
  const setup = setupCar(stock, build);
  return { id, build, look, spec: dressCar(setup, look), rating: rateCar(setup).rating, limits: rateCar(setup).limits, setup };
}
