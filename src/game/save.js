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
//         ae86: { color: 2,               which of the car's paints
//                 build: { ... },         engine, engine parts, parts (see vehicles/carSetup.js)
//                 look: { ... } },        body parts (see vehicles/carLook.js)
//       },
//     },
//   }
//
// Change save.data, then call save.write(). A later part of the game (money,
// reputation, the Blacklist, speed cameras) adds its own section next to
// `garage`; `version` is there so an old save can be brought up to date.
// ---------------------------------------------------------------------------
const KEY = 'speedx-save';
const fresh = () => ({ version: 1, garage: { current: null, cars: {} } });

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    if (stored?.version === 1 && stored.garage?.cars) return stored;
  } catch { /* nothing saved yet, or the browser blocks storage: start fresh */ }
  // First visit with this save file: carry over the car and colour the old menu remembered.
  const data = fresh(), oldCar = localStorage.getItem('speedx-car');
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
  // The saved entry of one car (made on first use: factory build, first paint).
  car(id) {
    const entry = (save.data.garage.cars[id] ??= { color: 0, build: {}, look: {} });
    entry.look ??= {};                       // (a save from before body parts existed)
    return entry;
  },
};
