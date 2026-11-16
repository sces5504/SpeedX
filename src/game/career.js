// ---------------------------------------------------------------------------
// career.js — what the player has earned: REPUTATION and MONEY.
//
//   reputation  how well known you are on the street. It only ever goes up in play,
//               and it is what the Blacklist asks for before a driver will race you.
//   money       spent on cars (the dealership) and parts (the garage).
//
// Both live in the save file (game/save.js) under `career`, so they are still there
// next time. Everything that pays or charges the player goes through this file:
// nothing else changes the two numbers.
// ---------------------------------------------------------------------------
import { save } from './save.js';

const data = (save.data.career ??= { reputation: 0, money: 0 });

export const career = {
  get reputation() { return data.reputation; },
  get money() { return data.money; },
  // amount may be negative (the developer console takes reputation away to test with); never below zero.
  addReputation(amount) { data.reputation = Math.max(0, Math.round(data.reputation + amount)); save.write(); return data.reputation; },
  addMoney(amount) { data.money = Math.max(0, Math.round(data.money + amount)); save.write(); return data.money; },
  canAfford: (price) => data.money >= price,
};
