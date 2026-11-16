// ---------------------------------------------------------------------------
// junctions.js — what a computer-driven car does about the next junction on its road.
//
// Every frame a brain (traffic or racer) asks approachJunction(). It:
//   1. PLANS   as the junction comes into view, picks the arm to leave by (the brain says how:
//              `choose`), and works out the turn: where the curve starts, how fast it can be taken
//   2. SLOWS   returns the fastest the car may go right now so that it reaches the turn at that
//              speed - or stops at the line, if it has to give way and the junction is not clear
//   3. TURNS   when the car reaches the start of the curve, hands it over to startTurn() (aiCar.js)
//
// GIVING WAY. One road at a junction is the main one (the road listed first in map.json; its two
// arms are junction.arms[0] and [1]). A car that carries straight on along it has priority.
// Everyone else - joining it, crossing it, turning off it - waits at the line while a car is in
// the junction, one is coming along the main road, or another car is already turning there
// (junction.turning: one turn at a time). Racers in a race give way to nobody.
// At a junction with traffic lights (junction.lights) the lights decide who goes: the drivers stop
// at red (aiCar.js: signalSpeed) and nobody gives way - except that turns are still taken one at a time.
// A car in the middle of its turn stops for anything in the way on its curve (roomOnTurn).
// ---------------------------------------------------------------------------
import { roomOnTurn, startTurn } from './aiCar.js';

const IN_SIGHT = 160;       // metres: a driver starts to think about a junction this far ahead
const BOX = 15;             // metres from the middle of a junction that count as "in it"
const PATIENCE = 6;         // seconds a driver waits for a gap before nosing out anyway

// How ordinary drivers pick an arm: straight on a little more often than not, never into a dead end.
export function wander(exits, junction, ai) {
  const open = exits.filter((arm) => !arm.deadEnd), arms = open.length ? open : exits;
  const straight = arms.find((arm) => arm.way === ai.way && arm.dir === ai.dir);
  return straight && Math.random() < 0.55 ? straight : arms[Math.floor(Math.random() * arms.length)];
}

/**
 * @param everyone  every car in the game, the player's shadow included
 * @param choose    (exits, junction, ai) -> the arm to leave by
 * @param manners   { turnGrip: sideways m/s² used in a turn, braking: m/s² planned with, yields: gives way or not }
 * @returns the fastest the junction lets the car go right now (Infinity = it has no say)
 */
export function approachJunction(ai, net, everyone, choose, manners, dt) {
  ai.indicate = ai.turn ? ai.turn.side : 0;                    // -1 = left indicator, +1 = right, 0 = none
  if (ai.turn) {
    // Already turning: hold the turn's speed, and stop short of anything in the way on the curve.
    const turn = ai.turn, room = roomOnTurn(ai, everyone, turn.held < PATIENCE);
    turn.held = room < 6 && ai.speed < 0.5 ? turn.held + dt : 0;
    return Math.min(turn.speed, Math.sqrt(2 * manners.braking * Math.max(0, room - 2.5)));
  }
  const next = net.nextJunction(ai.way, ai.s, ai.dir);
  if (!next || next.gap > IN_SIGHT) { ai.plan = null; return Infinity; }
  if (!ai.plan || ai.plan.junction !== next.junction) ai.plan = makePlan(ai, next, choose(net.exits(next.junction, ai.way, ai.dir), next.junction, ai), manners);
  const plan = ai.plan;
  plan.gap = next.gap;
  let fastest = Infinity;
  if (!plan.straight) {
    if (next.gap < 80) ai.indicate = plan.side;
    fastest = Math.sqrt(plan.speed ** 2 + 2 * manners.braking * Math.max(0, next.gap - plan.begin));
  }
  // Give way? (plan.line = how far before the middle of the junction the car's nose waits)
  const lit = next.junction.lights;
  const priority = plan.straight && (lit || next.junction.arms[0].way === ai.way);
  const toLine = next.gap - plan.line - ai.front;
  if (manners.yields && !priority && toLine > -2) {
    const clear = lit ? !turningThere(ai, next.junction) : isClear(ai, next.junction, everyone, plan.waited > PATIENCE);
    plan.waited = !clear && ai.speed < 1 ? plan.waited + dt : clear ? 0 : plan.waited;
    if (!clear) fastest = Math.min(fastest, Math.sqrt(2 * manners.braking * Math.max(0, toLine - 0.5)));
  }
  if (!plan.straight && next.gap <= plan.begin) {
    startTurn(ai, plan.arm, plan.reach);
    Object.assign(ai.turn, { speed: plan.speed * 1.1, side: plan.side, junction: next.junction, held: 0 });
    next.junction.turning = ai;
  }
  return fastest;
}

// The plan for one junction: which arm, and if that is a turn, its shape.
function makePlan(ai, next, arm, manners) {
  const main = next.junction.arms[0];
  const plan = { junction: next.junction, arm, straight: arm.way === ai.way && arm.dir === ai.dir, waited: 0, gap: next.gap,
    line: main.way.at(main.way.road.barrier, main.s) + 3 };          // going straight across: wait at the main road's edge
  if (plan.straight) return plan;
  // Headings before and after, as arrows on the map (x east, z south).
  const here = ai.way.pointAt(next.s, 0), there = arm.way.pointAt(arm.s, 0);
  const hx = here.tx * ai.dir, hz = here.tz * ai.dir, ox = there.tx * arm.dir, oz = there.tz * arm.dir;
  const sideways = hx * oz - hz * ox;                                // + = the new road leads off to the right
  const angle = Math.acos(Math.max(-1, Math.min(1, hx * ox + hz * oz)));
  const slant = Math.max(0.5, Math.abs(sideways));                   // 1 = the roads meet square; less = at a slant, so the turn is longer
  plan.side = sideways > 0 ? 1 : -1;
  plan.begin = Math.min(45, (arm.way.at(arm.way.road.barrier, arm.s) + 4) / slant);     // metres before the middle where the curve starts
  plan.reach = Math.min(45, (ai.way.at(ai.way.road.barrier, next.s) + 6) / slant);      // metres beyond it where the curve ends
  const radius = Math.max(5, (plan.begin + plan.reach) / 2 / Math.tan(Math.max(angle, 0.2) / 2));
  plan.speed = Math.sqrt(manners.turnGrip * radius);
  plan.line = plan.begin + 1;
  return plan;
}

// Is some other car in the middle of a turn at this junction?
function turningThere(ai, junction) {
  const turner = junction.turning;
  return Boolean(turner && turner !== ai && turner.active && turner.turn && turner.turn.junction === junction);
}

// May a car that has to give way go now? Not while another car is in the junction, or one is
// coming along the main road and would be there within a few seconds.
// impatient = it has waited long enough: only a car actually in the junction stops it now.
function isClear(ai, junction, everyone, impatient) {
  const main = junction.arms[0];
  if (turningThere(ai, junction)) return false;                      // one turn at a time
  for (const o of everyone) {
    if (o === ai || !o.active) continue;
    const away = Math.hypot(o.x - junction.x, o.z - junction.z);
    if (away < BOX && o.speed > 0.5) return false;                   // (a car parked in the junction blocks nobody)
    if (impatient || o.way !== main.way || o.turn || o.speed < 2) continue;
    const coming = (main.s - o.s) * o.dir, toGo = main.way.road.closed ? ((coming % main.way.road.length) + main.way.road.length) % main.way.road.length : coming;
    if (toGo > 0 && toGo < Math.max(30, o.speed * 5.5) + BOX) return false;      // (pulling out from a standstill takes a good five seconds)
  }
  return true;
}
