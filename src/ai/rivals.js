// ---------------------------------------------------------------------------
// rivals.js — illegal street racers and the race against them.
//
// A rival normally cruises a bit faster than traffic, overtaking when the
// other lane is clear. A race starts with headlights, like on a real touge:
//   * YOU flash your high beams (F) near a rival            -> race
//   * a RIVAL sits behind you and flashes; you flash back   -> race
// Then: hazards on, a rolling 3-2-1, and first to the finish gate wins.
//
// THE RACE IS TO A PLACE, not along a fixed stretch: a gate so many metres further on, the way
// the road leads (world/roadNet.js: walk). How you get there is up to you - the map shows the
// shortest way, and "how far ahead" is simply whose shortest way left is shorter. The rival
// takes that shortest way, turning at junctions as needed (ai/junctions.js).
//
// race.state:  'none' -> 'invite' -> 'countdown' -> 'racing' -> 'done' -> 'none'
//
// THE DRIVERS. None of them holds back: in a race every one uses nearly all their car can do
// (GAMEPLAY.racer: the shares of its cornering grip, braking and power). So what makes one
// harder to beat than another is the CAR - and each turns up in a different one, tuned and
// restyled at random (vehicles/randomBuild.js) and rated within reach of yours. They never
// drive a Blacklist driver's car: those are met only by challenging the driver (challenge()).
//   * On the straights they give away a little while they are level or ahead; one that has
//     fallen behind finds extra pace (rubber band), one far ahead eases off. Races stay close.
//   * They weave through traffic: overtake when the other lane is clear, and if they are
//     about to run into the back of someone they DODGE - into the other lane, or round the
//     outside on the shoulder.
// What differs is their STYLE - what they do when they are not racing (STYLES below):
//   flyer    flat out all the time, as if the road were a race. Keep up with one and it will race you.
//   hunter   looks for you: catches you up, sits on your tail and flashes its lights.
//   showoff  snakes from side to side; gets in front of you and taunts with its hazards on.
// However the offer is made, you take it the same way: flash your lights (F).
// ---------------------------------------------------------------------------
import { GAMEPLAY, PHYSICS } from '../config.js';
import { clamp, smoothstep } from '../core/mathUtils.js';
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { rateCar } from '../vehicles/carRating.js';
import { peakPower } from '../vehicles/carStats.js';
import { randomCar } from '../vehicles/randomBuild.js';
import { setupCar } from '../vehicles/carSetup.js';
import { dressCar } from '../vehicles/carLook.js';
import { RULES } from '../game/career.js';
import { createAiCar, changeAiCar, placeAi, removeAi, moveAi, safeSpeed, findAhead, signalSpeed, lookAround, nearDeadEnd } from './aiCar.js';
import { approachJunction, wander } from './junctions.js';

// Which way "the inside of a bend" is in the road's own left/right numbering (see think()).
const LINE_SIDE = -1;
const R = GAMEPLAY.racer;
// The same for every racer: how they handle traffic.
const NERVE = 2.6;          // seconds of empty oncoming lane they want before overtaking
const TAIL_GAP = 0.25;      // seconds behind the car in front while racing
const LINE = 0.8;           // metres they move toward the inside of a bend
const AGILITY = 2.0;        // how quickly they change lanes

// What a racer does when it is NOT racing.
//   pace    its speed as a multiple of the speed limit (flatOut: no multiple - as fast as the car and the road allow)
//   grip    sideways m/s² it uses in bends when just driving around
//   weave   metres it snakes from side to side on a clear road
//   offer   how it asks for a race: 'tail' = from behind you, 'front' = from in front, 'run' = by keeping pace with you
//   ask     what the player is told when it does
export const STYLES = {
  flyer: { pace: 3.2, flatOut: true, grip: 0, weave: 0, offer: 'run', ask: 'This one wants a run — flash your lights to race' },
  hunter: { pace: 1.7, grip: 7.5, weave: 0, offer: 'tail', ask: 'The racer behind is flashing you — flash back to race' },
  showoff: { pace: 1.5, grip: 7, weave: 1.1, offer: 'front', ask: 'The racer ahead is taunting you — flash your lights to race' },
};

/**
 * @param net        the road network (world/roadNet.js)
 * @param playerSpec the car the player is driving (the racers' cars are rated near it)
 */
export function createRivals(scene, map, net, playerSpec) {
  // A handful of racers' cars are made up in advance (rating one takes a moment), and one more
  // each time a racer turns up, so there is always a fresh choice.
  // (Any car in the game except the Blacklist drivers' own.)
  const reserved = new Set((RULES.blacklist || []).map((entry) => entry.car));
  const streetCars = Object.fromEntries(Object.entries(HERO_CARS).filter(([id]) => !reserved.has(id)));
  const garage = Array.from({ length: 8 }, () => randomCar(streetCars));
  let playerRating = rateCar(playerSpec).rating;
  // The car for the next racer: of four from the garage, the one rated nearest to "yours, give or take".
  function nextCar() {
    const wanted = playerRating + (Math.random() * 2 - 1) * R.ratingSpread;
    const choice = Array.from({ length: 4 }, () => garage[Math.floor(Math.random() * garage.length)])
      .sort((a, b) => Math.abs(a.rating - wanted) - Math.abs(b.rating - wanted))[0];
    garage[Math.floor(Math.random() * garage.length)] = randomCar(streetCars);         // (one car in the garage is replaced by a new one)
    return choice;
  }
  // Put a racer in a car, with a style of its own.
  function dress(ai, entry) {
    if (ai.entry !== entry) changeAiCar(ai, scene, entry.id, entry.spec);
    ai.entry = entry;
    ai.boss = null;                                  // (set by bring() when this car is a Blacklist driver's)
    ai.limits = entry.limits;                        // what this car can do: cornering and braking in m/s², top speed in m/s
    ai.rating = entry.rating;
    ai.power = peakPower(entry.setup) * 0.85;        // watts that reach the road, for how hard it can accelerate
    ai.style = STYLES[Object.keys(STYLES)[Math.floor(Math.random() * Object.keys(STYLES).length)]];
    ai.agility = AGILITY;
  }

  const cars = [];
  for (let k = 0; k < GAMEPLAY.rivalCount; k++) {
    const entry = nextCar(), ai = createAiCar(scene, entry.id, entry.spec, 'rival');
    ai.entry = entry;
    dress(ai, entry);
    ai.lane = 1;                                 // keeps to the right-hand lane where there are two (see think)
    ai.overtaking = false;
    ai.dodge = { d: 0, time: 0 };                // where it is swerving to, and for how much longer
    ai.nearPlayer = 0;        // seconds spent where its style makes its offer from (see STYLES)
    ai.bored = 0;             // seconds left of "you said no: I am not interested in you"
    ai.honk = false;
    ai.clock = Math.random() * 10;               // its own time, for the snaking
    cars.push(ai);
  }

// finish = the place the race runs to ({ way, s }); length = metres from the start line to it;
  // playerProgress / rivalProgress = metres of that each has covered (length minus what is left).
  // kind = 'street' or 'blacklist' (then entry = that Blacklist driver, from career.json).
  // inReach = a racer close enough, going your way, to be raced by flashing your lights right now (null = none): the HUD says so.
  const race = { state: 'none', kind: 'street', entry: null, rival: null, timer: 0, cooldown: 8, finish: null, length: 0, route: null,
    playerWon: false, message: '', wins: 0, losses: 0, playerProgress: 0, rivalProgress: 0, inReach: null };
  const anyArm = (exits) => exits[Math.floor(Math.random() * exits.length)];
  // How far a car is from the player: by road when they share one, otherwise as the crow flies (and a bit, for the bends).
  const distanceTo = (ai, playerInfo) => (ai.way === playerInfo.way ? Math.abs(ai.way.ahead(playerInfo.s, ai.s)) : Math.hypot(ai.x - playerInfo.x, ai.z - playerInfo.z) * 1.3);
  // Metres of road between a car and the finish, by the shortest way. turnsRound = it may set off in either direction.
  const leftToGo = (car, turnsRound) => net.findRoute({ way: car.way, s: car.s, dir: turnsRound ? 0 : car.dir }, race.finish)?.length ?? Infinity;

  function spawn(ai, playerInfo, everyone, anywhere) {
    for (let attempt = 0; attempt < 12; attempt++) {
      // Rivals usually appear behind you and catch up — that is how they find you.
      const behind = Math.random() < 0.6;
      const metres = anywhere ? 150 + Math.random() * 350 : GAMEPLAY.spawnDistance - 100 + Math.random() * 120;
      const place = net.walk(playerInfo.way, playerInfo.s, (behind ? -1 : 1) * playerInfo.dir, metres, anyArm), way = place.way;
      if (place.travelled < metres - 1 || way.nearEnd(place.s, 80)) continue;                     // the road ran out
      if (way.junctions.some((at) => Math.abs(way.ahead(at.s, place.s)) < 110)) continue;        // not at a junction: no room to slow for it
      // One that turns up behind you is coming after you; the others may be going either way.
      const dir = !anywhere && behind ? -place.dir : (Math.random() < 0.5 ? 1 : -1);
      if (everyone.some((o) => o.active && o !== ai && o.way === way && o.dir === dir && Math.abs(way.ahead(o.s, place.s)) < 50)) continue;
      dress(ai, nextCar());                                                 // a different car and a different style each time
      ai.pace = ai.style.pace * (0.95 + Math.random() * 0.1);              // its cruising speed, as a multiple of the limit
      ai.cruise = way.at(way.road.limit, place.s) * Math.min(ai.pace, 1.8);
      placeAi(ai, way, place.s, dir, ai.cruise, ai.spec.colors[Math.floor(Math.random() * ai.spec.colors.length)]);
      ai.overtaking = false; ai.nearPlayer = 0; ai.bored = 0; ai.dodge.time = 0;
      return;
    }
  }

  // Where to race to: GAMEPLAY.raceLength further on, the way the road leads. On a small network
  // that could be just round the corner the other way, so the distance is cut down until the
  // place really is that far off by ANY road. Starts the countdown, or says why not.
  function startCountdown(rival, playerInfo, wanted = GAMEPLAY.raceLength) {
    const from = { way: playerInfo.way, s: playerInfo.s, dir: rival.dir };
    for (let length = wanted; length >= 700; length *= 0.8) {
      const place = net.walk(from.way, from.s, from.dir, length + 120);     // (the gate stands 120 m clear of the end of a road that just stops)
      if (place.travelled < length + 120) continue;
      const finish = net.walk(from.way, from.s, from.dir, length);
      const anyWay = net.findRoute({ way: from.way, s: from.s }, finish);
      if (!anyWay || anyWay.length < length * 0.85) continue;
      Object.assign(race, { state: 'countdown', kind: 'street', entry: null, rival, timer: 3, finish, length, message: '' });
      rival.flash = 0.9; rival.hazard = true;
      return;
    }
    Object.assign(race, { message: 'Not enough road ahead to race', cooldown: 4, state: 'none' });
  }

  // The rival's choice at a junction during a race: the arm the shortest way to the finish takes.
  const raceLine = (exits, junction, ai) => {
    const next = net.findRoute({ way: ai.way, s: ai.s, dir: ai.dir }, race.finish)?.legs[1];
    return (next && exits.find((arm) => arm.way === next.way && arm.dir === next.dir)) || net.keepGoing(exits, junction, ai.way, ai.dir);
  };

  return {
    cars, race,
    reset(playerInfo, everyone) {
      Object.assign(race, { state: 'none', rival: null, cooldown: 8, message: '' });
      for (const ai of cars) { removeAi(ai); spawn(ai, playerInfo, everyone, true); }
    },
    // The player changed car or fitted parts: the racers that turn up from now on are rated near the new one.
    playerChanged(spec) { playerRating = rateCar(spec).rating; },
    // For the developer console: the race in progress is won on the spot.
    winNow() { race.given = race.state === 'racing'; return race.given; },
    // Call the race off (the player went somewhere else, into the garage...). Nobody wins.
    cancelRace() {
      if (race.rival) race.rival.hazard = false;
      Object.assign(race, { state: 'none', rival: null, route: null, cooldown: 8, message: '' });
    },
    // Put a Blacklist driver in their car, 25 m behind the player. Returns that AI car.
    bring(entry, playerInfo) {
      const setup = setupCar(HERO_CARS[entry.car], entry.build), rated = rateCar(setup), ai = cars[0];
      dress(ai, { id: entry.car, setup, spec: dressCar(setup, entry.look), rating: rated.rating, limits: rated.limits });
      ai.style = STYLES.hunter; ai.boss = entry;
      placeAi(ai, playerInfo.way, playerInfo.way.wrap(playerInfo.s - playerInfo.dir * 25), playerInfo.dir, playerInfo.speed, ai.spec.colors[0]);
      return ai;
    },
    // A Blacklist driver (an entry of career.json) comes to race the player, here and now: one of
    // the racers is taken off the road and comes back as them, in their car, on the player's tail.
    // False if no race can start here (one is running, or there is not enough road ahead).
    challenge(entry, playerInfo) {
      if (race.state !== 'none' && race.state !== 'invite') return false;
      const ai = cars[0].boss === entry && cars[0].active ? cars[0] : this.bring(entry, playerInfo);      // (already there, if a scene introduced them first)
      startCountdown(ai, playerInfo, entry.raceLength);
      if (race.state !== 'countdown') return false;
      Object.assign(race, { kind: 'blacklist', entry });
      return true;
    },
    // The countdown has been done elsewhere (the rolling start of a Blacklist race is a scene: game/scenes.js): GO on the next frame.
    go() { if (race.state === 'countdown') race.timer = 0; },
    // For the developer console: put a racer 25 m behind the player, going the same way at the same speed.
    summon(playerInfo) {
      const ai = cars.find((car) => car !== race.rival) || cars[0];
      placeAi(ai, playerInfo.way, playerInfo.way.wrap(playerInfo.s - playerInfo.dir * 25), playerInfo.dir, playerInfo.speed);
      return ai;
    },
    // For the developer console: start the countdown with the nearest racer going your way. False if none can.
    raceNow(playerInfo) {
      if (race.state !== 'none' && race.state !== 'invite') return false;
      const near = cars.filter((ai) => ai.active && ai.way === playerInfo.way && ai.dir === playerInfo.dir)
        .sort((a, b) => distanceTo(a, playerInfo) - distanceTo(b, playerInfo))[0];
      if (near) startCountdown(near, playerInfo);
      return race.state === 'countdown';
    },

    /** @param busy true while a time attack is running (no races then) */
    update(dt, playerInfo, everyone, grip, busy) {
      race.cooldown = Math.max(0, race.cooldown - dt);
      race.inReach = null;

      for (const ai of cars) {
        ai.honk = false;
        if (!ai.active) { spawn(ai, playerInfo, everyone, false); continue; }
        const inRace = race.rival === ai && race.state !== 'none';
        if (!inRace && (distanceTo(ai, playerInfo) > GAMEPLAY.despawnDistance + 150 || nearDeadEnd(ai, 50))) { removeAi(ai); continue; }
        const racing = inRace && race.state === 'racing';
        think(ai, dt, playerInfo, everyone, grip, racing);
        moveAi(ai, dt);

        // --- how races get proposed ---
        // (where the player is, seen from this rival's road: null if the player is on some other road)
        const player = lookAround(ai, [playerInfo])[0];
        ai.bored = Math.max(0, ai.bored - dt);
        if (race.state === 'none' && race.cooldown <= 0 && !busy && player && player.dir === ai.dir && playerInfo.speed > 3) {
          if (Math.abs(player.ahead) < 45) race.inReach = ai;
          if (playerInfo.flashPressed && Math.abs(player.ahead) < 45) { startCountdown(ai, playerInfo); continue; }
          if (ai.bored > 0) continue;                              // it asked, you did not answer: it leaves you alone for a minute
          // Each style makes its offer from its own place: on your tail, just in front of you, or simply keeping pace.
          const inPlace = { tail: player.ahead > 4 && player.ahead < 30, front: player.ahead < -6 && player.ahead > -40,
            run: Math.abs(player.ahead) < 60 && playerInfo.speed > 22 }[ai.style.offer];
          ai.nearPlayer = inPlace ? ai.nearPlayer + dt : 0;
          if (ai.nearPlayer > (ai.style.offer === 'run' ? 4 : 2.5)) {
            Object.assign(race, { state: 'invite', rival: ai, timer: 8 });
            ai.flash = ai.style.offer === 'tail' ? 1.3 : 0; ai.nearPlayer = 0;
          }
        }
      }

      // --- race state machine ---
      const rival = race.rival;
      if (race.state === 'invite') {
        race.timer -= dt;
        // It keeps asking: high beams from behind you, hazard lights from anywhere else.
        if (rival.style.offer === 'tail') { if (rival.flash <= 0 && race.timer % 2.5 < 0.1) rival.flash = 1.0; } else rival.hazard = true;
        if (playerInfo.flashPressed && rival.way === playerInfo.way && rival.dir === playerInfo.dir) startCountdown(rival, playerInfo);
        else if (race.timer <= 0 || busy) { race.state = 'none'; race.cooldown = 12; rival.hazard = false; rival.bored = 60; }
      } else if (race.state === 'countdown') {
        race.timer -= dt;
        if (race.timer <= 0) {
          // GO. The length is measured again from where the player is now (the countdown was a rolling one).
          race.state = 'racing'; race.timer = 0;
          race.length = leftToGo(playerInfo, true);
          rival.hazard = false;
        }
      }
      if (race.state === 'racing') {
        race.timer += dt;
        // Whoever has less road left to the gate is ahead. The player may take any road, so their
        // distance is the shortest way from wherever they are (the map screen draws that way).
        race.route = net.findRoute({ way: playerInfo.way, s: playerInfo.s }, race.finish);
        const playerLeft = race.route ? race.route.length : Infinity, rivalLeft = leftToGo(rival, false);
        race.playerProgress = race.length - playerLeft; race.rivalProgress = race.length - rivalLeft;
        const finish = (playerWon, message) => {
          Object.assign(race, { state: 'done', playerWon, message, timer: 6, cooldown: 30, route: null });
          if (playerWon) race.wins++; else race.losses++;
        };
        if (playerLeft < 10 || race.given) { race.given = false; finish(true, 'YOU WIN'); }
        else if (rivalLeft < 10) finish(false, 'YOU LOSE');
        else if (playerLeft - rivalLeft > 450) finish(false, 'LEFT BEHIND');
      } else if (race.state === 'done') {
        race.timer -= dt;
        if (race.timer <= 0) { race.state = 'none'; race.rival = null; }
      }
    },
  };

  function think(ai, dt, playerInfo, everyone, grip, racing) {
    const way = ai.way, { road } = way, seen = lookAround(ai, everyone), car = ai.limits, style = ai.style;
    ai.clock += dt;
    // own = the lane it normally drives in (the right-hand one), other = the lane it overtakes in:
    // the next lane going the same way where the road has one, otherwise the oncoming lane.
    const lanesHere = road.lanes[way.indexAt(ai.s)];
    const own = way.laneCentre(ai.s, ai.dir, lanesHere - 1);
    const other = lanesHere > 1 ? way.laneCentre(ai.s, ai.dir, 0) : -own;
    const drag = (0.6 * ai.spec.dragArea * ai.speed * ai.speed) / ai.spec.mass;
    // How hard the engine can push the car at this speed, using `share` of its power.
    const push = (share) => Math.max(0.3, Math.min(8.5 * grip, (ai.power * PHYSICS.powerBoost * share) / (ai.spec.mass * Math.max(ai.speed, 9))) - drag * 0.8);
    // The player, seen from this car's road (null = on some other road) - what its style does about them.
    const player = ai.bored > 0 ? null : seen.find((o) => o.car.isPlayer && o.dir === ai.dir && playerInfo.speed > 3);
    const asking = race.state === 'invite' && race.rival === ai;

    // 1. How fast the road itself allows, and the junction coming up.
    let want, weave = 0;
    if (racing) {
      // lead: + = the rival is ahead of you. Behind: everything the car has, and then some (rubber
      // band). Level or ahead: a little less on the straights. Far ahead: easing off.
      const lead = race.rivalProgress - race.playerProgress;
      const band = lead < -40 ? R.catchUp * smoothstep(40, 160, -lead) : lead > 90 ? -R.easeOff : 0;
      const straight = lead < -20 ? 1 : R.straight;
      const cornering = car.cornering * R.cornering * grip * (1 + band), braking = car.braking * R.braking * grip;
      want = Math.min(car.topSpeed * straight * (1 + band * 0.5), safeSpeed(ai, 260, cornering, braking),
        approachJunction(ai, net, everyone, raceLine, { turnGrip: cornering, braking, yields: false }, dt));
      ai.maxAccel = push(straight * (1 + band * 1.5));
      ai.maxBrake = car.braking * (R.braking + 0.1) * grip;      // in an emergency they find a little more than they plan with
    } else {
      // Just driving around, each in its own style. (Even a racer waits at red lights and gives way at junctions.)
      const limit = way.at(road.limit, ai.s);
      const cornering = style.flatOut ? car.cornering * 0.75 * grip : style.grip * grip, braking = style.flatOut ? car.braking * 0.7 * grip : 4.5;
      ai.cruise = style.flatOut ? Math.min(car.topSpeed * 0.9, Math.max(45, limit * ai.pace)) : limit * ai.pace;
      want = ai.cruise;
      ai.maxAccel = style.flatOut ? push(0.9) : Math.min(push(1), 5.5);
      ai.maxBrake = style.flatOut ? car.braking * 0.8 * grip : 6.5;
      weave = style.weave;
      if (player && style.offer === 'tail' && player.ahead > 0 && player.ahead < 400) {
        // HUNTER: the player is up ahead - go and get them, then sit on their tail (not past them).
        want = Math.min(car.topSpeed * 0.9, player.speed + clamp((player.ahead - 16) * 0.4, -3, 14)); ai.maxAccel = push(1);
      } else if (player && style.offer === 'tail' && player.ahead < -8 && player.ahead > -150) {
        want = Math.min(want, Math.max(9, player.speed - 5));                    // ...or the player is behind: let them come past
      } else if (player && style.offer === 'front' && player.ahead > -4 && player.ahead < 120) {
        // SHOWOFF: get past the player...
        want = Math.min(car.topSpeed * 0.9, Math.max(want, player.speed + 9)); ai.maxAccel = push(1);
      } else if (player && style.offer === 'front' && player.ahead <= -4 && player.ahead > -45) {
        // ...then sit just in front of them, snaking wider.
        want = Math.min(want, Math.max(9, player.speed + (player.ahead > -14 ? 3 : -1))); weave = style.weave * 1.6;
      }
      if (asking && style.offer === 'run') want = Math.min(want, Math.max(20, playerInfo.speed + 2));     // a flyer that has made its offer waits for you
      want = Math.min(want, safeSpeed(ai, style.flatOut ? 220 : 130, cornering, braking), signalSpeed(ai, 4),
        approachJunction(ai, net, everyone, wander, { turnGrip: cornering * 0.7, braking: Math.min(braking, 5), yields: true }, dt));
    }
    const turning = ai.turn || (ai.plan && !ai.plan.straight && ai.plan.gap < 90);      // in a turn, or about to be: no lane games

    // 2. Overtaking: if our lane is blocked and the other lane is empty far enough ahead, use it.
    const fits = (o, line) => Math.abs(o.d - line) < ai.halfWidth + o.car.halfWidth + 0.25;      // would we touch it on that line?
    const blockRange = 10 + ai.speed * (racing ? 1.0 : 1.4);
    const blocker = findAhead(ai, seen, own, 80);
    const blocked = blocker && blocker.speed >= 0 && blocker.gap < blockRange && blocker.speed < want - 1.5;
    const otherLaneFree = !seen.some((o) => {
      if (Math.abs(o.d - other) > 2.0) return false;
      const need = o.dir === ai.dir ? 30 : 40 + (ai.speed + o.speed) * NERVE * (racing ? 0.65 : 1);
      return o.ahead > -8 && o.ahead < need;
    });
    const ownLaneFree = !seen.some((o) => Math.abs(o.d - own) <= 2.0 && o.ahead > -(ai.rear + o.car.front + 4) && o.ahead < ai.front + o.car.rear + 6);
    if (!ai.overtaking && blocked && otherLaneFree && !turning) ai.overtaking = true;
    else if (ai.overtaking && (ownLaneFree && !blocked || !otherLaneFree && ownLaneFree || turning && ownLaneFree)) ai.overtaking = false;
    // The racing line: a good driver uses the width of the lane, toward the inside of each bend.
    const bend = way.at(road.curve, ai.s + ai.dir * 15);
    const line = clamp(bend * 70, -1, 1) * LINE * (racing ? 1 : 0.5) * LINE_SIDE;
    // Snaking (a showoff on a clear road): side to side about once every three seconds - across
    // both lanes where there are two going its way, inside its own lane otherwise.
    const roadClear = !turning && !ai.overtaking && !seen.some((o) => !o.car.isPlayer && o.ahead > -10 && o.ahead < 70);
    const snake = weave && roadClear ? Math.sin(ai.clock * 2.1) * (lanesHere > 1 ? Math.abs(own - other) / 2 + 0.4 : weave) : 0;
    const middle = weave && roadClear && lanesHere > 1 ? (own + other) / 2 : own;
    ai.wantD = ai.overtaking ? other : middle + line + snake;
    ai.lights.left = ai.overtaking && Math.abs(ai.d - other) > 0.8;
    ai.lights.right = false;
    if (ai.indicate) ai.lights[ai.indicate > 0 ? 'right' : 'left'] = true;       // turning at the junction

    // 3. Whatever lane we are actually in, do not run into the thing ahead.
    // (In the middle of a turn the junction rules look after it: see approachJunction.)
    const ahead = ai.turn ? null : findAhead(ai, seen, ai.d, 90);
    if (ahead) {
      if (ahead.speed < -2) {
        if (ahead.gap < 110) { want = Math.min(want, ai.speed * 0.5); ai.wantD = own + ai.dir * 1.2; ai.overtaking = false; if (ai.flash <= 0) { ai.flash = 0.6; ai.honk = true; } }
      } else {
        // DODGE: closing so fast that braking alone will not do it? Swerve round it: through the
        // other lane if nothing is coming, otherwise round the outside on the paved shoulder.
        const closing = ai.speed - ahead.speed;
        if (closing > 2 && ahead.gap < (closing * closing) / (2 * ai.maxBrake) + closing * 0.5 + 4 && ai.dodge.time <= 0 && !ai.turn) {
          const shoulder = ai.dir * (way.at(road.half, ai.s) - ai.halfWidth + 0.2);     // out on the paved edge
          const clear = (lineD) => !seen.some((o) => fits(o, lineD) && o.ahead > -6 && o.ahead < (o.dir === ai.dir ? ahead.gap + 14 : 15 + (ai.speed + o.speed) * 1.6));
          const escape = clear(other) ? other : clear(shoulder) ? shoulder : null;
          if (escape !== null) { ai.dodge.d = escape; ai.dodge.time = 1.0; }
        }
        const safeGap = 3 + ai.speed * (racing ? TAIL_GAP : 0.45 + TAIL_GAP);
        if (ahead.gap < safeGap) want = Math.min(want, Math.max(0, Math.max(0, ahead.speed) * clamp(ahead.gap / safeGap, 0, 1.05) - (ahead.gap < 2.5 ? 3 : 0)));
      }
    }
    if (ai.dodge.time > 0) { ai.dodge.time -= dt; ai.wantD = ai.dodge.d; }
    ai.wantSpeed = want;
  }
}
