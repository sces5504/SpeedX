// ---------------------------------------------------------------------------
// career.js — what the player has earned and owns.
//
//   reputation  how well known you are on the street. It only ever goes up in play,
//               and it is what a Blacklist driver asks for before they will race you.
//   money       spent on cars (the dealership) and parts (the garage): see shop.js.
//   cars        the ones that are yours: the starter car, any you bought, any you won.
//   Blacklist   which of its drivers you have beaten.
//
// The RULES - what you start with, what things cost, what a win pays, who is on the
// Blacklist - are data: public/content/career.json, read once by loadCareer().
// What the player HAS lives in the save file (game/save.js).
//
// PAYING OUT. Everything a finished activity gives - money, reputation, a car, a
// Blacklist driver crossed off - is handed over in ONE go by settle(), with a
// receipt number. A receipt is honoured once: if the same one turns up again
// (the result screen fired twice, the page was reloaded at the wrong moment)
// nothing more is paid. And because it is one write to the save file, a reload
// can never leave half of a reward behind.
//
// In the SANDBOX (game/save.js) every car counts as owned and nothing costs anything.
// ---------------------------------------------------------------------------
import { save, SANDBOX } from './save.js';

export const RULES = {};                     // career.json

const fetchJson = async (path) => (await fetch(path)).json();
let data = null;                             // save.data.career

// Read the rules, and give a new player what they start with.
export async function loadCareer(readJson = fetchJson) {
  Object.assign(RULES, await readJson('content/career.json'));
  data = (save.data.career ??= { reputation: 0, money: 0 });
  data.receipts ??= [];                      // the numbers of the last rewards paid (see settle)
  data.beaten ??= [];                        // ids of the Blacklist drivers beaten
  const cars = save.data.garage.cars;
  if (!SANDBOX && !Object.values(cars).some((car) => car.owned)) {
    save.car(RULES.start.car).owned = true;
    save.data.garage.current = RULES.start.car;
    data.money = RULES.start.money;
    save.write();
  }
}

export const career = {
  get reputation() { return data.reputation; },
  get money() { return data.money; },
  // amount may be negative (the developer console takes reputation away to test with); never below zero.
  addReputation(amount) { data.reputation = Math.max(0, Math.round(data.reputation + amount)); save.write(); return data.reputation; },
  addMoney(amount) { data.money = Math.max(0, Math.round(data.money + amount)); save.write(); return data.money; },
  canAfford: (price) => SANDBOX || data.money >= price,
  // Pay `price` and, in the same write to the save file, do whatever was bought (`then`).
  // False = not enough money: nothing happens.
  spend(price, then = () => {}) {
    if (!career.canAfford(price)) return false;
    if (!SANDBOX) data.money -= price;
    then();
    save.write();
    return true;
  },

  // ---- Cars ---------------------------------------------------------------------
  owns: (carId) => SANDBOX || Boolean(save.data.garage.cars[carId]?.owned),
  giveCar(carId) { save.car(carId).owned = true; save.write(); },

  // ---- The Blacklist ------------------------------------------------------------
  get blacklist() { return RULES.blacklist || []; },
  hasBeaten: (entry) => data.beaten.includes(entry.id),
  mayChallenge: (entry) => SANDBOX || data.reputation >= entry.reputation,

  // ---- Stars ------------------------------------------------------------------------
  /**
   * An activity that gives one to three stars (a speed camera, a time attack) has just been done.
   * Each star level pays ONCE, the first time it is reached - the levels skipped on the way included.
   * @param key     names the place, e.g. "camera-shimen-coast:danjin" (the receipt is this plus the level)
   * @param record  its entry in the save file: { stars, ... } - the stars are written into it here
   * @param stars   how many were reached this time (0..3)
   * @param rules   what each level pays: { reputation: [a, b, c], money: [a, b, c] } (career.json)
   * @returns { newStars, reputation, money } - all zero if no new level was reached
   */
  awardStars(key, record, stars, rules) {
    const newStars = Math.max(0, stars - record.stars);
    let reputation = 0, money = 0;
    for (let level = record.stars; level < stars; level++) { reputation += rules.reputation?.[level] || 0; money += rules.money?.[level] || 0; }
    if (newStars) { record.stars = stars; career.settle({ id: `${key}-${stars}`, reputation, money }); }
    return { newStars, reputation, money };
  },

  /**
   * Hand over everything one finished activity gives (see PAYING OUT above).
   * @param receipt { id, money, reputation, car (an id, to be given), beaten (a Blacklist driver's id) }
   * @returns the receipt if it was paid, null if that receipt had been paid before
   */
  settle(receipt) {
    if (data.receipts.includes(receipt.id)) return null;
    data.money += receipt.money || 0;
    data.reputation += receipt.reputation || 0;
    if (receipt.car) save.car(receipt.car).owned = true;
    if (receipt.beaten && !data.beaten.includes(receipt.beaten)) data.beaten.push(receipt.beaten);
    data.receipts = [...data.receipts, receipt.id].slice(-60);
    save.write();
    return receipt;
  },
};
