// ---------------------------------------------------------------------------
// carRating.js — a car's three ability bars and its overall rating (1-999).
//
// HOW A CAR IS RATED
//   1. It is DRIVEN, not calculated: carStats.js puts the car on a flat, dry,
//      endless car park and runs the game's own physics. Same test for every car:
//      standing start, full throttle, automatic gearbox; full brakes from
//      100 km/h; full steering at a steady 100 km/h.
//   2. Five measured numbers are each turned into points (0-100) with the
//      tables below. The tables are FIXED: they do not look at which cars are
//      installed, so a car added next year is scored on the same scale and can
//      be compared with every car that came before.
//   3. The points make the three bars the player sees:
//        ACCELERATION  half 0-100 km/h time, half time over the first 400 m
//        TOP SPEED     speed after a minute flat out
//        HANDLING      60% cornering grip, 40% braking distance
//   4. RATING = 10 x (40% acceleration + 25% top speed + 35% handling), 1-999.
//
// THE SCALE (where the tables put real cars, with the game tune in config.js):
//      about 370   a light 130 PS coupe from the eighties, as it left the factory
//      about 500   a 200-250 PS sports car from the nineties
//      about 870   a 1000 PS, four-wheel-drive, 400 km/h hypercar (the top of the Blacklist)
//      999         needs every bar full: nothing road-legal gets there
//
// Because the numbers come from driving the real physics, a part that changes
// the car (carSetup.js) changes its bars by exactly what it does on the road.
//
// The same measurements also tell the AI drivers what their car can do
// (`limits`): how hard it corners, brakes and how fast it goes. Street racers all
// use the same share of that (GAMEPLAY.racer in config.js): see ai/rivals.js.
// ---------------------------------------------------------------------------
import { clamp, lerp } from '../core/mathUtils.js';
import { measureCar } from './carStats.js';

// Points tables: [measured value, points]. Between two rows the points are blended;
// beyond the ends they stay at 0 or 100. 100 is about the best this game's tyres allow.
const POINTS = {
  t100: [[12, 0], [8, 20], [6, 35], [5, 45], [4, 58], [3, 75], [2.4, 88], [2, 96], [1.7, 100]],                    // seconds, 0-100 km/h
  t400m: [[18, 0], [15, 20], [13.5, 35], [12.5, 47], [11.5, 60], [10.5, 72], [9.5, 84], [8.8, 92], [8, 100]],      // seconds, first 400 m
  top: [[140, 0], [200, 20], [250, 38], [300, 55], [350, 70], [400, 82], [450, 92], [500, 100]],                   // km/h
  gripG: [[1.7, 0], [2.0, 20], [2.2, 38], [2.4, 56], [2.6, 72], [2.8, 86], [3.0, 95], [3.2, 100]],                 // g, steady cornering at 100 km/h
  brakeDist: [[36, 0], [30, 20], [27, 38], [25, 54], [23, 70], [21, 84], [19, 95], [17.5, 100]],                   // metres, 100-0 km/h
};
// How much each bar counts toward the rating (they add up to 1).
export const RATING_WEIGHTS = { accel: 0.40, topSpeed: 0.25, handling: 0.35 };

// Read a points table at `value` (the rows may run upward or downward in value).
function pointsFor(table, value) {
  if (value === null || value === undefined) return 0;                 // "never got there" scores nothing
  const rising = table[1][0] > table[0][0];
  for (let i = 1; i < table.length; i++) {
    const [v0, p0] = table[i - 1], [v1, p1] = table[i];
    if (rising ? value <= v1 : value >= v1) return clamp(lerp(p0, p1, (value - v0) / (v1 - v0)), Math.min(p0, p1), Math.max(p0, p1));
  }
  return table[table.length - 1][1];
}

const KMH_100 = 27.78;                       // 100 km/h in metres per second
const done = new WeakMap();                  // spec -> its rating (a spec never changes once made, so measure it once)

/**
 * Rate a car. `spec` is a finished car setup (from carSpecs.js or carSetup.js).
 * Returns { accel, topSpeed, handling (each 0-100), rating (1-999),
 *           measured (everything carStats.js found), limits (for AI drivers) }.
 */
export function rateCar(spec) {
  if (done.has(spec)) return done.get(spec);
  const m = measureCar(spec);
  const accel = (pointsFor(POINTS.t100, m.t100) + pointsFor(POINTS.t400m, m.t400m)) / 2;
  const topSpeed = pointsFor(POINTS.top, m.top);
  const handling = 0.6 * pointsFor(POINTS.gripG, m.gripG) + 0.4 * pointsFor(POINTS.brakeDist, m.brakeDist);
  const overall = RATING_WEIGHTS.accel * accel + RATING_WEIGHTS.topSpeed * topSpeed + RATING_WEIGHTS.handling * handling;
  const result = {
    accel, topSpeed, handling,
    rating: clamp(Math.round(overall * 10), 1, 999),
    measured: m,
    limits: {
      cornering: m.gripG * 9.81,                             // sideways m/s² at the limit
      braking: (KMH_100 * KMH_100) / (2 * m.brakeDist),      // m/s² under full brakes
      topSpeed: m.top / 3.6,                                 // m/s
    },
  };
  done.set(spec, result);
  return result;
}
