// ---------------------------------------------------------------------------
// statBars.js — draws a car's overall rating and its three ability bars
// (ACCELERATION, TOP SPEED, HANDLING) into a box on the page.
//
// The numbers come from vehicles/carRating.js. Give it a second car setup
// (`before`) and it shows the CHANGE as well: the part of each bar that was
// gained is bright, a part that was lost is red, with +/- figures beside it.
// Used by the main menu; the garage uses the same function to compare a car
// before and after a part is fitted.
// ---------------------------------------------------------------------------
import { rateCar } from '../vehicles/carRating.js';

const BARS = [['accel', 'ACCELERATION'], ['topSpeed', 'TOP SPEED'], ['handling', 'HANDLING']];

// "+12" / "-3" with its colour class, or nothing when there is no change to show.
function change(now, before) {
  const diff = Math.round(now) - Math.round(before);
  return diff === 0 ? '' : `<em class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : '−'}${Math.abs(diff)}</em>`;
}

/**
 * @param box     the element to fill (give it class="stats" in the page)
 * @param spec    the finished car setup to show
 * @param before  optional: the setup to compare with (for example the car without the part)
 */
export function renderStats(box, spec, before = null) {
  const now = rateCar(spec), was = before && before !== spec ? rateCar(before) : now;
  const rows = BARS.map(([key, label]) => {
    const kept = Math.min(now[key], was[key]), moved = Math.abs(now[key] - was[key]);
    return `<div class="stat"><span>${label}</span>`
      + `<div class="bar"><i style="width:${kept}%"></i><i class="${now[key] >= was[key] ? 'gain' : 'loss'}" style="left:${kept}%;width:${moved}%"></i></div>`
      + `<b>${Math.round(now[key])}</b>${change(now[key], was[key])}</div>`;
  });
  box.innerHTML = `<div class="rating"><b>${now.rating}</b><span>RATING</span>${change(now.rating, was.rating)}</div><div class="stat-rows">${rows.join('')}</div>`;
}
