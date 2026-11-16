// ---------------------------------------------------------------------------
// shop.js — what things cost, and buying them.
//
// The prices are in public/content/career.json. Two things are sold:
//   CARS    at the dealership (the main menu's DEALER list). A car with no price
//           is never for sale: it can only be won.
//   PARTS   in the garage: performance parts, engine swaps and body parts.
//           A part is paid for ONCE. From then on it belongs to that car - taken
//           off, it stays in the car's list of bought parts and can be put back
//           for nothing. Each is known by a key:
//               'part:internals-2'   'engine:sr20det'   'look:s13-wing-gt'
//           The factory part, the factory engine and paint are always free.
//
// Money only ever changes hands through career.spend(), which takes the money
// and hands over the goods in a single write to the save file.
// In the SANDBOX (game/save.js) everything is owned already.
// ---------------------------------------------------------------------------
import { ENGINES } from '../vehicles/carSpecs.js';
import { peakPowerPs } from '../vehicles/carStats.js';
import { RULES, career } from './career.js';
import { save, SANDBOX } from './save.js';

const round = (price) => Math.round(price / 50) * 50;

export const shop = {
  // ---- Cars ---------------------------------------------------------------------
  carPrice: (carId) => RULES.cars?.[carId]?.price ?? null,           // null = not for sale
  forSale: (carId) => shop.carPrice(carId) !== null && !career.owns(carId),
  buyCar: (carId) => shop.forSale(carId) && career.spend(shop.carPrice(carId), () => { save.car(carId).owned = true; }),

  // ---- Parts ----------------------------------------------------------------------
  // A performance part: `group` and `option` as in upgrades.json.
  partPrice(group, option) {
    const price = RULES.parts?.[group.id] ?? 0;
    return Array.isArray(price) ? price[Math.min(group.options.indexOf(option), price.length - 1)] : price;
  },
  enginePrice: (engineId) => round(RULES.engineSwap.base + RULES.engineSwap.perPs * peakPowerPs({ engine: ENGINES[engineId] })),
  bodyPartPrice: () => RULES.bodyPart,

  // Has this car's owner paid for the part with this key?
  hasBought: (carId, key) => SANDBOX || save.car(carId).bought.includes(key),
  buyPart: (carId, key, price) => career.spend(price, () => { if (!SANDBOX) save.car(carId).bought.push(key); }),
};
