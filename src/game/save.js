// ---------------------------------------------------------------------------
// save.js — the player's save file.
//
// Everything worth keeping between visits is ONE object, kept in the browser
// (localStorage) under one name. The game is a plain web page with no server,
// so the save lives on this computer, in this browser.
//
//   save.data = {
//     version: 1,
//     garage: {
//       current: 'ae86',                  the car being driven
//       cars: {                           one entry per car the player has touched
//         ae86: { owned: true,            it is theirs (game/career.js)
//                 color: 2,               which of the car's paints
//                 build: { ... },         engine, engine parts, parts (see vehicles/carSetup.js)
//                 look: { ... },          body parts (see vehicles/carLook.js)
//                 bought: [ ... ] },      the parts paid for, fitted or not (game/shop.js)
//       },
//     },
//     career: { ... },                    reputation, money, the Blacklist, what has been paid out (game/career.js)
//   }
//
// Change save.data, then call save.write(). A later part of the game (speed cameras)
// adds its own section next to these; `version` is there so an old save can be
// brought up to date.
//
// TWO SAVES. The game is played as a CAREER: you own what you have earned. For
// trying things out there is also the SANDBOX: every car and part is yours for
// nothing (it is the old "test garage", and still has whatever was built in it).
// Each has its own save, so neither can spoil the other. GAMEPLAY.freeParts in
// config.js says which one a new visitor gets; the developer console's
// "sandbox on / off" switches.
// ---------------------------------------------------------------------------
import { GAMEPLAY } from '../config.js';

const chosen = (() => { try { return localStorage.getItem('speedx-sandbox'); } catch { return null; } })();
export const SANDBOX = chosen ? chosen === 'on' : GAMEPLAY.freeParts;
const KEY = SANDBOX ? 'speedx-save' : 'speedx-career';
const fresh = () => ({ version: 1, garage: { current: null, cars: {} } });

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    if (stored?.version === 1 && stored.garage?.cars) return stored;
  } catch { /* nothing saved yet, or the browser blocks storage: start fresh */ }
  // First visit with this save file: carry over the car and colour the old menu remembered.
  const data = fresh(), oldCar = SANDBOX && localStorage.getItem('speedx-car');
  if (oldCar) {
    data.garage.current = oldCar;
    data.garage.cars[oldCar] = { color: parseInt(localStorage.getItem('speedx-color') || '0', 10) || 0, build: {} };
  }
  return data;
}

export const save = {
  data: read(),
  write() {
    try { localStorage.setItem(KEY, JSON.stringify(save.data)); } catch { /* storage full or blocked: keep playing, just not saved */ }
  },
  // Throw the whole save away (the developer console's "save reset"). Reload the page afterwards.
  erase() { try { localStorage.removeItem(KEY); } catch { /* storage blocked: there was nothing to erase */ } },
  // The saved entry of one car (made on first use: factory build, first paint).
  car(id) {
    const entry = (save.data.garage.cars[id] ??= { color: 0, build: {}, look: {} });
    entry.look ??= {};                       // (a save from before body parts existed)
    entry.bought ??= [];                     // (...or from before parts cost money)
    return entry;
  },
};
