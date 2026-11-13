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
// ---------------------------------------------------------------------------
import { GAMEPLAY, PHYSICS } from '../config.js';
import { clamp } from '../core/mathUtils.js';
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { createAiCar, placeAi, removeAi, moveAi, laneCentre, safeSpeed, findAhead } from './aiCar.js';

export function createRivals(scene, map, playerCarId) {
  const ids = Object.keys(HERO_CARS).filter((id) => id !== playerCarId);
  const cars = [];
  for (let k = 0; k < GAMEPLAY.rivalCount; k++) {
    const id = ids[k % ids.length], spec = HERO_CARS[id];
    const ai = createAiCar(scene, id, spec, 'rival');
    // Peak engine power in watts, for how hard the rival can accelerate.
    ai.power = Math.max(...spec.engine.torque.map(([rpm, nm]) => (nm * rpm * 2 * Math.PI) / 60)) * 0.85;
    ai.skill = 0.86 + Math.random() * 0.1;
    ai.overtaking = false;
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
      const s = playerInfo.s + (behind ? -1 : 1) * distance * playerInfo.dir;
      if (s < 80 || s > map.road.length - 80) continue;
      if (everyone.some((o) => o.active && o !== ai && o.dir === dir && Math.abs(o.s - s) < 50)) continue;
      ai.cruise = GAMEPLAY.speedLimit * (1.35 + Math.random() * 0.2);
      placeAi(ai, map, s, dir, ai.cruise, ai.spec.colors[Math.floor(Math.random() * ai.spec.colors.length)]);
      ai.overtaking = false; ai.behindPlayer = 0;
      return;
    }
  }

  function startCountdown(rival, playerInfo) {
    const roadLeft = rival.dir > 0 ? map.road.length - 120 - playerInfo.s : playerInfo.s - 120;
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
        const away = Math.abs(ai.s - playerInfo.s);
        if (!inRace && (away > GAMEPLAY.despawnDistance + 150 || ai.s < 50 || ai.s > map.road.length - 50)) { removeAi(ai); continue; }
        const racing = inRace && race.state === 'racing';
        think(ai, playerInfo, everyone, grip, racing);
        moveAi(ai, dt, map);

        // --- how races get proposed ---
        const sameWay = ai.dir === playerInfo.dir;
        const behind = (playerInfo.s - ai.s) * ai.dir;        // + = rival is behind the player
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
          race.finishS = playerInfo.s + race.dir * race.length;
          rival.hazard = false;
        }
      } else if (race.state === 'racing') {
        race.timer += dt;
        race.playerProgress = (playerInfo.s - race.startS) * race.dir;
        // Both run to the same finish line; whoever started ahead simply has less road.
        race.rivalProgress = (rival.s - race.startS) * race.dir;
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

  function think(ai, playerInfo, everyone, grip, racing) {
    const own = laneCentre(ai.dir), other = -own;
    const drag = (0.6 * ai.spec.dragArea * ai.speed * ai.speed) / ai.spec.mass;
    let want;
    if (racing) {
      // Gentle rubber band so races stay close without being fake.
      const lead = (ai.s - playerInfo.s) * ai.dir;
      const effort = ai.skill * (lead > 90 ? 0.92 : lead < -90 ? 1.05 : 1);
      want = safeSpeed(map, ai, 260, 13.5 * grip * effort * effort, 9.5 * grip);
      ai.maxAccel = Math.max(0.3, Math.min(8.5 * grip, (ai.power * PHYSICS.powerBoost) / (ai.spec.mass * Math.max(ai.speed, 9))) - drag * 0.8);
      ai.maxBrake = 12 * grip;
    } else {
      want = Math.min(ai.cruise, safeSpeed(map, ai, 110, 4.0 * grip, 3.2));
      ai.maxAccel = 2.6; ai.maxBrake = 5.5;
    }

    // Overtaking: if our lane is blocked and the other lane is empty far enough ahead, use it.
    const blockRange = 10 + ai.speed * (racing ? 1.0 : 1.6);
    const blocker = findAhead(ai, everyone, own, 80);
    const blocked = blocker && blocker.speed >= 0 && blocker.gap < blockRange && blocker.speed < want - 1.5;
    const otherLaneFree = !everyone.some((o) => {
      if (o === ai || !o.active || Math.abs(o.d - other) > 2.0) return false;
      const ahead = (o.s - ai.s) * ai.dir;
      const need = o.dir === ai.dir ? 30 : 70 + (ai.speed + o.speed) * (racing ? 3.0 : 4.5);
      return ahead > -8 && ahead < need;
    });
    const ownLaneFree = !everyone.some((o) => {
      if (o === ai || !o.active || Math.abs(o.d - own) > 2.0) return false;
      const ahead = (o.s - ai.s) * ai.dir;
      return ahead > -(ai.rear + o.front + 4) && ahead < ai.front + o.rear + 6;
    });
    if (!ai.overtaking && blocked && otherLaneFree) ai.overtaking = true;
    else if (ai.overtaking && (ownLaneFree && !blocked || !otherLaneFree && ownLaneFree)) ai.overtaking = false;
    ai.wantD = ai.overtaking ? other : own;
    ai.lights.left = ai.overtaking && Math.abs(ai.d - other) > 0.8;
    ai.lights.right = false;

    // Whatever lane we are actually in, do not run into the thing ahead.
    const ahead = findAhead(ai, everyone, ai.d, 90);
    if (ahead) {
      if (ahead.speed < 0) {
        if (ahead.gap < 110) { want = Math.min(want, ai.speed * 0.5); ai.wantD = own + ai.dir * 1.2; ai.overtaking = false; if (ai.flash <= 0) { ai.flash = 0.6; ai.honk = true; } }
      } else {
        const safeGap = 3 + ai.speed * (racing ? 0.35 : 1.1);
        if (ahead.gap < safeGap) want = Math.min(want, Math.max(0, ahead.speed * clamp(ahead.gap / safeGap, 0, 1.05) - (ahead.gap < 2.5 ? 3 : 0)));
      }
    }
    ai.wantSpeed = want;
  }
}
