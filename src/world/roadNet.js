// ---------------------------------------------------------------------------
// roadNet.js — finding your way round the roads of a map.
//
// mapData.js knows each road (a WAY) and where the ways meet (map.junctions). This
// file answers the questions a driver or a race has on top of that:
//
//   net.nextJunction(way, s, dir)   the next junction ahead: { junction, s, gap } (gap = metres to it), or null
//   net.exits(junction, way, dir)   the arms you may leave it by, arriving along `way` going `dir`
//                                   (every arm but the one you came in on: nobody turns back)
//   net.straightOn(junction, way, dir)   the arm that simply carries on, if your road does
//   net.walk(way, s, dir, metres, choose)   drive `metres` from there, picking an arm at each junction:
//                                   where you end up, { way, s, dir, travelled }
//   net.findRoute(from, to)         the shortest way from one place to another:
//                                   { length, legs: [{ way, from, to, dir }] }, or null if there is none
//   net.nextTurn(route)             what a route asks of the driver next: { metres, side, onto }
//                                   (side: -1 = turn left, +1 = right, 0 = nothing until the end)
//
// A place is { way, s } (s = metres along that way). An ARM is one road leaving a junction:
// { way, s, dir } = along `way`, starting at `s`, driving `dir` (+1 up the road, -1 down).
// On a map with one road there are no junctions: walk() just follows the road, and a route is one leg.
// ---------------------------------------------------------------------------

export function createRoadNet(map) {
  for (const way of map.ways) way.junctions.sort((a, b) => a.s - b.s);
  // An arm is a dead end when it leads to nothing but the end of its road.
  for (const junction of map.junctions) for (const arm of junction.arms) arm.deadEnd = !arm.way.road.closed && !nextJunction(arm.way, arm.s, arm.dir);

  // Metres from s to `to`, driving dir along a way: Infinity if `to` lies the other way on a road with ends.
  function distanceAlong(way, s, dir, to) {
    const gap = (to - s) * dir;
    if (way.road.closed) return ((gap % way.road.length) + way.road.length) % way.road.length;
    return gap >= 0 ? gap : Infinity;
  }

  function nextJunction(way, s, dir) {
    let best = null;
    for (const at of way.junctions) {
      let gap = distanceAlong(way, s, dir, at.s);
      if (gap < 1 && way.road.closed) gap += way.road.length;       // the one we are standing on: next time round
      if (gap >= 1 && gap < Infinity && (!best || gap < best.gap)) best = { junction: at.junction, s: at.s, gap };
    }
    return best;
  }

  const cameFrom = (arm, way, dir) => arm.way === way && arm.dir === -dir;
  const exits = (junction, way, dir) => junction.arms.filter((arm) => !cameFrom(arm, way, dir));
  const straightOn = (junction, way, dir) => junction.arms.find((arm) => arm.way === way && arm.dir === dir) || null;

  // The usual choice at a junction: carry straight on if the road does, otherwise any arm that is not a dead end.
  const keepGoing = (arms, junction, way, dir) => straightOn(junction, way, dir) || arms.find((arm) => !arm.deadEnd) || arms[0];

  function walk(way, s, dir, metres, choose = keepGoing) {
    let travelled = 0;
    for (let turns = 0; turns < 60; turns++) {
      const next = nextJunction(way, s, dir);
      const room = way.roomAhead(s, dir);                              // (endless on a loop)
      if (!next || next.gap > metres - travelled) {
        const step = Math.min(metres - travelled, room);
        return { way, s: way.wrap(s + dir * step), dir, travelled: travelled + step };     // (short of `metres` if the road ran out)
      }
      travelled += next.gap;
      const arm = choose(exits(next.junction, way, dir), next.junction, way, dir);
      if (!arm) return { way, s: next.s, dir, travelled };
      ({ way, s, dir } = arm);
    }
    return { way, s, dir, travelled };
  }

  // ---- The shortest route ------------------------------------------------------------
  // The junctions are the places where a choice is made; between two of them there is only the
  // road. So: from the start, try every junction you can reach, always carrying on from the
  // nearest one not yet settled, until the goal is the nearest (Dijkstra's method).
  // from = { way, s, dir? }: with a dir, the route must set off that way (a moving car cannot turn round).
  function findRoute(from, to) {
    const reached = new Map();                 // junction (or the word 'goal') -> { cost, legs }
    const open = [];                           // places still to carry on from: { cost, legs, junction }
    // Drive off from (way, s) going dir: note the goal if it comes first, else the next junction.
    const explore = (way, s, dir, cost, legs) => {
      const next = nextJunction(way, s, dir);
      const toGoal = to.way === way ? distanceAlong(way, s, dir, to.s) : Infinity;
      if (toGoal <= (next ? next.gap : way.roomAhead(s, dir))) offer('goal', cost + toGoal, [...legs, { way, from: s, to: to.s, dir }]);
      if (next) offer(next.junction, cost + next.gap, [...legs, { way, from: s, to: next.s, dir }]);
    };
    const offer = (junction, cost, legs) => {
      const known = reached.get(junction);
      if (known && known.cost <= cost) return;
      const entry = { cost, legs, junction };
      reached.set(junction, entry);
      if (junction !== 'goal') open.push(entry);
    };
    for (const dir of from.dir ? [from.dir] : [1, -1]) explore(from.way, from.s, dir, 0, []);
    while (open.length) {
      open.sort((a, b) => b.cost - a.cost);
      const here = open.pop();
      if (reached.get(here.junction) !== here) continue;               // a shorter way here was found meanwhile
      const goal = reached.get('goal');
      if (goal && goal.cost <= here.cost) break;
      const last = here.legs[here.legs.length - 1];
      for (const arm of exits(here.junction, last.way, last.dir)) explore(arm.way, arm.s, arm.dir, here.cost, here.legs);
    }
    const goal = reached.get('goal');
    return goal ? { length: goal.cost, legs: goal.legs } : null;
  }

  // A route as a line of [x, z] points (for the map screen).
  function routeLine(route, spacing = 12) {
    const line = [];
    for (const leg of route.legs) {
      const length = distanceAlong(leg.way, leg.from, leg.dir, leg.to);
      for (let gone = 0; gone <= length; gone += spacing) { const i = leg.way.indexAt(leg.from + leg.dir * gone); line.push([leg.way.road.x[i], leg.way.road.z[i]]); }
      const i = leg.way.indexAt(leg.to); line.push([leg.way.road.x[i], leg.way.road.z[i]]);
    }
    return line;
  }

  // The first place along a route where the driver has to leave the road they are on.
  function nextTurn(route) {
    let metres = 0;
    for (let k = 0; k < route.legs.length - 1; k++) {
      const leg = route.legs[k], next = route.legs[k + 1];
      metres += distanceAlong(leg.way, leg.from, leg.dir, leg.to);
      if (next.way === leg.way && next.dir === leg.dir) continue;                // straight on through a junction
      // Headings before and after, as arrows on the map (x east, z south): which side does the new road lead off to?
      const here = leg.way.pointAt(leg.to, 0), there = next.way.pointAt(next.from, 0);
      const sideways = here.tx * leg.dir * there.tz * next.dir - here.tz * leg.dir * there.tx * next.dir;
      return { metres, side: sideways > 0 ? 1 : -1, onto: next.way };
    }
    return { metres: route.length, side: 0, onto: null };
  }

  return { nextJunction, exits, straightOn, keepGoing, walk, findRoute, routeLine, nextTurn, distanceAlong };
}
