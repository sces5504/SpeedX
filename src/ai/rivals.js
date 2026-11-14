// ---------------------------------------------------------------------------
// rivals.js — illegal street racers and the race against them.
//
// A rival normally cruises a bit faster than traffic, overtaking when the
// other lane is clear. A race starts with headlights, like on a real touge:
//   * YOU flash your high beams (F) near a rival            -> race
//   * a RIVAL sits behind you and flashes; you flash back   -> race
// Then: hazards on, a rolling 3-2-1, and first to the finish gate wins.
//
// race.state:  'none' -> 'invite' -> 'countdown' -> 'racing' -> 'done' -> 'none'
//
// SKILL. Every rival has a level from 1 (Sunday driver) to 10 (touge legend),
// picked around GAMEPLAY.rivalLevel each time one appears. skillOf() below
// turns the level into what the driver actually does differently: how fast
// they dare take a bend, how late they brake, how small a gap in the oncoming
// traffic they will overtake into, how tidy their line is.
//   * They weave through traffic: overtake when the other lane is clear, and
//     if they are about to run into the back of someone they DODGE — into the
//     other lane, or round the outside on the shoulder.
//   * Rubber band: in a race a rival that has fallen well behind finds some
//     extra pace (more of it the better the driver), and one that is far
//     ahead eases off a little. It keeps races close without being fake.
//   * Out of a race they still drive hard: well over the limit, quick past traffic.
// ---------------------------------------------------------------------------
import { GAMEPLAY, PHYSICS } from '../config.js';
import { clamp, lerp, smoothstep } from '../core/mathUtils.js';
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { createAiCar, placeAi, removeAi, moveAi, safeSpeed, findAhead, signalSpeed } from './aiCar.js';

// Which way "the inside of a bend" is in the road's own left/right numbering (see think()).
const LINE_SIDE = -1;

// What a driver of this level (1..10) does. Each value runs from "level 1" to "level 10".
export function skillOf(level) {
  const t = (clamp(level, 1, 10) - 1) / 9;
  return {
    level,
    cornerGrip: lerp(9, 17.5, t),     // sideways m/s² they dare in a race (your own tyres give up at about 22)
    braking: lerp(7, 12.5, t),        // m/s² they plan their braking with: higher = brakes later
    power: lerp(0.7, 1, t),           // share of the engine's power they really use
    cruise: lerp(1.3, 1.9, t),        // times the speed limit when they are just driving around
    cruiseGrip: lerp(4.5, 9, t),      // sideways m/s² when just driving around
    cruiseAccel: lerp(2.6, 5.5, t),
    nerve: lerp(4.8, 2.4, t),         // seconds of empty oncoming lane they want before overtaking: less = bolder
    gap: lerp(0.5, 0.22, t),          // seconds behind the car in front while racing
    line: lerp(0, 0.9, t),            // metres they move toward the inside of a bend
    agility: lerp(1, 2.2, t),         // how quickly they change lanes
    catchUp: lerp(0.1, 0.24, t),      // rubber band: extra pace when far behind in a race
  };
}

export function createRivals(scene, map, playerCarId) {
  const ids = Object.keys(HERO_CARS).filter((id) => id !== playerCarId);
  const cars = [];
  for (let k = 0; k < GAMEPLAY.rivalCount; k++) {
    const id = ids[k % ids.length], spec = HERO_CARS[id];
    const ai = createAiCar(scene, id, spec, 'rival');
    // Peak engine power in watts, for how hard the rival can accelerate.
    ai.power = Math.max(...spec.engine.torque.map(([rpm, nm]) => (nm * rpm * 2 * Math.PI) / 60)) * 0.85;
    ai.skill = skillOf(GAMEPLAY.rivalLevel);     // a new level is drawn every time this rival appears (spawn)
    ai.lane = 1;                                 // keeps to the right-hand lane where there are two (see think)
    ai.overtaking = false;
    ai.dodge = { d: 0, time: 0 };                // where it is swerving to, and for how much longer
    ai.behindPlayer = 0;      // seconds spent right behind the player
    ai.honk = false;
    cars.push(ai);
  }

  const race = { state: 'none', rival: null, timer: 0, cooldown: 8, startS: 0, finishS: 0, dir: 1, length: 0,
    playerWon: false, message: '', wins: 0, losses: 0, playerProgress: 0, rivalProgress: 0 };

  function spawn(ai, playerInfo, everyone, anywhere) {
    for (let attempt = 0; attempt < 12; attempt++) {
      // Rivals usually appear behind you and catch up — that is how they find you.
      const behind = Math.random() < 0.6;
      const distance = anywhere ? 150 + Math.random() * 350 : GAMEPLAY.spawnDistance - 100 + Math.random() * 120;
      const dir = anywhere ? (Math.random() < 0.5 ? 1 : -1) : (behind ? playerInfo.dir : (Math.random() < 0.5 ? 1 : -1));
      const s = map.wrap(playerInfo.s + (behind ? -1 : 1) * distance * playerInfo.dir);
      if (map.nearEnd(s, 80)) continue;
      if (everyone.some((o) => o.active && o !== ai && o.dir === dir && Math.abs(map.ahead(o.s, s)) < 50)) continue;
      ai.skill = skillOf(Math.round(GAMEPLAY.rivalLevel + (Math.random() * 2 - 1) * GAMEPLAY.rivalLevelSpread));
      ai.agility = ai.skill.agility;
      ai.pace = ai.skill.cruise * (0.95 + Math.random() * 0.1);            // its cruising speed, as a share of the limit
      ai.cruise = map.at(map.road.limit, s) * ai.pace;
      placeAi(ai, map, s, dir, ai.cruise, ai.spec.colors[Math.floor(Math.random() * ai.spec.colors.length)]);
      ai.overtaking = false; ai.behindPlayer = 0; ai.dodge.time = 0;
      return;
    }
  }

  function startCountdown(rival, playerInfo) {
    const roadLeft = map.roomAhead(playerInfo.s, rival.dir) - 120;      // (endless on a loop)
    if (roadLeft < 700) { race.message = 'Not enough road ahead to race'; race.cooldown = 4; race.state = 'none'; return; }
    Object.assign(race, { state: 'countdown', rival, timer: 3, dir: rival.dir, length: Math.min(GAMEPLAY.raceLength, roadLeft), message: '' });
    rival.flash = 0.9; rival.hazard = true;
  }

  return {
    cars, race,
    reset(playerInfo, everyone) {
      Object.assign(race, { state: 'none', rival: null, cooldown: 8, message: '' });
      for (const ai of cars) { removeAi(ai); spawn(ai, playerInfo, everyone, true); }
    },

    /** @param busy true while a time attack is running (no races then) */
    update(dt, playerInfo, everyone, grip, busy) {
      race.cooldown = Math.max(0, race.cooldown - dt);

      for (const ai of cars) {
        ai.honk = false;
        if (!ai.active) { spawn(ai, playerInfo, everyone, false); continue; }
        const inRace = race.rival === ai && race.state !== 'none';
        const away = Math.abs(map.ahead(playerInfo.s, ai.s));
        if (!inRace && (away > GAMEPLAY.despawnDistance + 150 || map.nearEnd(ai.s, 50))) { removeAi(ai); continue; }
        const racing = inRace && race.state === 'racing';
        think(ai, dt, playerInfo, everyone, grip, racing);
        moveAi(ai, dt, map);

        // --- how races get proposed ---
        const sameWay = ai.dir === playerInfo.dir;
        const behind = map.ahead(ai.s, playerInfo.s) * ai.dir;   // + = rival is behind the player
        if (race.state === 'none' && race.cooldown <= 0 && !busy && sameWay && playerInfo.speed > 3) {
          if (playerInfo.flashPressed && away < 45) { startCountdown(ai, playerInfo); continue; }
          ai.behindPlayer = behind > 4 && behind < 30 ? ai.behindPlayer + dt : 0;
          if (ai.behindPlayer > 2.5) {
            Object.assign(race, { state: 'invite', rival: ai, timer: 8 });
            ai.flash = 1.3; ai.behindPlayer = 0;
          }
        }
      }

      // --- race state machine ---
      const rival = race.rival;
      if (race.state === 'invite') {
        race.timer -= dt;
        if (rival.flash <= 0 && race.timer % 2.5 < 0.1) rival.flash = 1.0;       // keeps flashing at you
        if (playerInfo.flashPressed && rival.dir === playerInfo.dir) startCountdown(rival, playerInfo);
        else if (race.timer <= 0 || busy) { race.state = 'none'; race.cooldown = 35; }
      } else if (race.state === 'countdown') {
        race.timer -= dt;
        if (race.timer <= 0) {
          race.state = 'racing'; race.timer = 0;
          race.startS = playerInfo.s; race.rivalStartS = rival.s;
          race.finishS = map.wrap(playerInfo.s + race.dir * race.length);
          // Progress is added up step by step from here (see below), starting from where each car is now.
          race.playerProgress = 0; race.playerLastS = playerInfo.s;
          race.rivalProgress = map.ahead(playerInfo.s, rival.s) * race.dir; race.rivalLastS = rival.s;
          rival.hazard = false;
        }
      } else if (race.state === 'racing') {
        race.timer += dt;
        // Metres covered since the start, counted from the player's start line, so both run to the same
        // finish and whoever started ahead simply has less road. It is added up frame by frame (not
        // "position now minus start") because on a loop the position jumps back to 0 once per lap.
        race.playerProgress += map.ahead(race.playerLastS, playerInfo.s) * race.dir; race.playerLastS = playerInfo.s;
        race.rivalProgress += map.ahead(race.rivalLastS, rival.s) * race.dir; race.rivalLastS = rival.s;
        const finish = (playerWon, message) => {
          Object.assign(race, { state: 'done', playerWon, message, timer: 6, cooldown: 30 });
          if (playerWon) race.wins++; else race.losses++;
        };
        if (race.playerProgress >= race.length) finish(true, 'YOU WIN');
        else if (race.rivalProgress >= race.length) finish(false, 'YOU LOSE');
        else if (race.rivalProgress - race.playerProgress > 450) finish(false, 'LEFT BEHIND');
      } else if (race.state === 'done') {
        race.timer -= dt;
        if (race.timer <= 0) { race.state = 'none'; race.rival = null; }
      }
    },
  };

  function think(ai, dt, playerInfo, everyone, grip, racing) {
    const k = ai.skill;
    // own = the lane it normally drives in (the right-hand one), other = the lane it overtakes in:
    // the next lane going the same way where the road has one, otherwise the oncoming lane.
    const lanesHere = map.road.lanes[map.indexAt(ai.s)];
    const own = map.laneCentre(ai.s, ai.dir, lanesHere - 1);
    const other = lanesHere > 1 ? map.laneCentre(ai.s, ai.dir, 0) : -own;
    const drag = (0.6 * ai.spec.dragArea * ai.speed * ai.speed) / ai.spec.mass;

    // 1. How fast the road itself allows.
    let want;
    if (racing) {
      // Rubber band (see the top of this file). lead: + = the rival is ahead of you.
      const lead = map.ahead(playerInfo.s, ai.s) * ai.dir;
      const band = lead < -40 ? k.catchUp * smoothstep(40, 160, -lead) : lead > 90 ? -0.08 : 0;
      want = safeSpeed(map, ai, 260, k.cornerGrip * grip * (1 + band), k.braking * grip);
      const push = (ai.power * PHYSICS.powerBoost * k.power * (1 + band * 1.5)) / (ai.spec.mass * Math.max(ai.speed, 9));
      ai.maxAccel = Math.max(0.3, Math.min(8.5 * grip, push) - drag * 0.8);
      ai.maxBrake = (k.braking + 2.5) * grip;
    } else {
      ai.cruise = map.at(map.road.limit, ai.s) * (ai.pace || 1);            // the limit of this stretch of road
      want = Math.min(ai.cruise, safeSpeed(map, ai, 130, k.cruiseGrip * grip, 4.5), signalSpeed(map, ai, 4));     // (out of a race, a racer waits at red lights too)
      ai.maxAccel = k.cruiseAccel; ai.maxBrake = 6.5;
    }

    // 2. Overtaking: if our lane is blocked and the other lane is empty far enough ahead, use it.
    const fits = (o, line) => Math.abs(o.d - line) < ai.halfWidth + o.halfWidth + 0.25;      // would we touch it on that line?
    const blockRange = 10 + ai.speed * (racing ? 1.0 : 1.4);
    const blocker = findAhead(map, ai, everyone, own, 80);
    const blocked = blocker && blocker.speed >= 0 && blocker.gap < blockRange && blocker.speed < want - 1.5;
    const otherLaneFree = !everyone.some((o) => {
      if (o === ai || !o.active || Math.abs(o.d - other) > 2.0) return false;
      const ahead = map.ahead(ai.s, o.s) * ai.dir;
      const need = o.dir === ai.dir ? 30 : 40 + (ai.speed + o.speed) * k.nerve * (racing ? 0.65 : 1);
      return ahead > -8 && ahead < need;
    });
    const ownLaneFree = !everyone.some((o) => {
      if (o === ai || !o.active || Math.abs(o.d - own) > 2.0) return false;
      const ahead = map.ahead(ai.s, o.s) * ai.dir;
      return ahead > -(ai.rear + o.front + 4) && ahead < ai.front + o.rear + 6;
    });
    if (!ai.overtaking && blocked && otherLaneFree) ai.overtaking = true;
    else if (ai.overtaking && (ownLaneFree && !blocked || !otherLaneFree && ownLaneFree)) ai.overtaking = false;
    // The racing line: a good driver uses the width of the lane, toward the inside of each bend.
    const bend = map.at(map.road.curve, ai.s + ai.dir * 15);
    const line = clamp(bend * 70, -1, 1) * k.line * (racing ? 1 : 0.5) * LINE_SIDE;
    ai.wantD = ai.overtaking ? other : own + line;
    ai.lights.left = ai.overtaking && Math.abs(ai.d - other) > 0.8;
    ai.lights.right = false;

    // 3. Whatever lane we are actually in, do not run into the thing ahead.
    const ahead = findAhead(map, ai, everyone, ai.d, 90);
    if (ahead) {
      if (ahead.speed < 0) {
        if (ahead.gap < 110) { want = Math.min(want, ai.speed * 0.5); ai.wantD = own + ai.dir * 1.2; ai.overtaking = false; if (ai.flash <= 0) { ai.flash = 0.6; ai.honk = true; } }
      } else {
        // DODGE: closing so fast that braking alone will not do it? Swerve round it: through the
        // other lane if nothing is coming, otherwise round the outside on the paved shoulder.
        const closing = ai.speed - ahead.speed;
        if (closing > 2 && ahead.gap < (closing * closing) / (2 * ai.maxBrake) + closing * 0.5 + 4 && ai.dodge.time <= 0) {
          const shoulder = ai.dir * (map.at(map.road.half, ai.s) - ai.halfWidth + 0.2);     // out on the paved edge
          const clear = (lineD) => !everyone.some((o) => {
            if (o === ai || !o.active || !fits(o, lineD)) return false;
            const along = map.ahead(ai.s, o.s) * ai.dir;
            return along > -6 && along < (o.dir === ai.dir ? ahead.gap + 14 : 15 + (ai.speed + o.speed) * 1.6);
          });
          const escape = clear(other) ? other : clear(shoulder) ? shoulder : null;
          if (escape !== null) { ai.dodge.d = escape; ai.dodge.time = 1.0; }
        }
        const safeGap = 3 + ai.speed * (racing ? k.gap : 0.45 + k.gap);
        if (ahead.gap < safeGap) want = Math.min(want, Math.max(0, ahead.speed * clamp(ahead.gap / safeGap, 0, 1.05) - (ahead.gap < 2.5 ? 3 : 0)));
      }
    }
    if (ai.dodge.time > 0) { ai.dodge.time -= dt; ai.wantD = ai.dodge.d; }
    ai.wantSpeed = want;
  }
}
