// ---------------------------------------------------------------------------
// challenge.js — the two scoring games on top of free driving:
//
//  NEAR MISS   Pass another car closer than ~1.3 m at speed without touching
//              it. Oncoming cars count double.
//  TIME ATTACK Press E at an orange cone: a route to a finish gate ~3 km up the
//              road, to be driven WITHIN THE TIME. The HUD counts the time left
//              down. Every near miss gives a little time back; every hard crash
//              takes some away. Run out of time before the gate and the run is over.
//
// A TIME ATTACK IS AN ACTIVITY WITH STARS, like a speed camera (game/speedTraps.js):
//   * There are three time limits: reach the gate inside the longest for one star, the middle
//     one for two, the shortest for three. The clock running past the longest = TIME UP: the run
//     has failed (challenge.result.timeUp). The limits come from an AVERAGE SPEED per star
//     (career.json: "timeAttack" -> "kmh"; a map may give its own in map.json:
//     "timeAttack": { "kmh": [..] }), so they fit whatever the length of the run is.
//   * For each run (a stop's cone, in one direction) the save file keeps the best time and the
//     most stars (save.data.career.timeAttacks). A star level reached for the first time pays
//     reputation and money - once (career.awardStars).
//   * challenge.result says what the run that just ended gave; main.js shows it.
//
// Also owns the glowing finish gate, which races (rivals.js) borrow too.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GAMEPLAY, ROAD } from '../config.js';
import { RULES, career } from './career.js';
import { save } from './save.js';

export function createChallenge(scene, map) {
  // ---- Finish gate: two pillars and a bar of light across the road -----------
  const gate = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x30ff9a, emissiveIntensity: 4 });
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5, 0.25), glow);
    pillar.position.set(side * (ROAD.paveHalfWidth + 0.6), 2.5, 0);
    gate.add(pillar);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD.paveHalfWidth * 2 + 1.4, 0.3, 0.2), glow);
  bar.position.y = 5;
  gate.add(bar);
  gate.visible = false;
  scene.add(gate);
  // Stand the gate across a road: s metres along `way` (the main road unless told otherwise).
  function showGate(s, way = map) {
    const p = way.pointAt(s, 0);
    gate.position.set(p.x, p.y, p.z);
    gate.rotation.y = p.yaw;
    gate.scale.x = way.at(way.road.half, s) / ROAD.paveHalfWidth;      // as wide as the road is there
    gate.visible = true;
  }

  // ---- Records and stars --------------------------------------------------------
  const records = () => (save.data.career.timeAttacks ??= {});       // "map:stop-up" -> { best (seconds), stars }
  const keyOf = (id) => `${map.id}:${id}`;
  const speeds = () => map.info.timeAttack?.kmh || RULES.timeAttack.kmh;      // average km/h for one, two, three stars
  // The record of a run so far. (A best time from before records lived in the save file is carried over.)
  function recordOf(id) {
    const old = parseFloat(localStorage.getItem('speedx-best-' + id));
    return (records()[keyOf(id)] ??= { best: Number.isFinite(old) ? old : null, stars: 0 });
  }

  const challenge = {
    state: 'idle',            // 'idle' | 'running' | 'finished'
    time: 0, bonus: 0, penalty: 0, nearMisses: 0,
    startS: 0, finishS: 0, dir: 1, id: '', best: null, finishedTimer: 0,
    targets: [],              // the clock (seconds) that earns one, two and three stars on this run
    result: null,             // the run that just ended: { time, stars, newStars, reputation, money, newBest, best } - or { timeUp: true, short (metres left) } - main.js takes it (and sets it back to null)
    combo: 0, comboTimer: 0,  // near misses in quick succession
    showGate, hideGate() { gate.visible = false; },
    // The most stars the player has at a stop's cone (the better of its two directions): for the map screen.
    starsAt: (poi) => Math.max(0, ...['-up', '-down'].map((way) => records()[keyOf(poi.id + way)]?.stars || 0)),

    start(poi, playerS, dir) {
      const length = Math.min(GAMEPLAY.challengeLength, map.roomAhead(playerS, dir) - 150);    // (a loop never runs out of road)
      if (length < 800) return false;                       // too close to the end of the road
      const id = poi.id + (dir > 0 ? '-up' : '-down');
      Object.assign(challenge, { state: 'running', time: 0, bonus: 0, penalty: 0, nearMisses: 0, startS: playerS,
        finishS: map.wrap(playerS + dir * length), progress: 0, lastS: playerS, dir, id, best: recordOf(id).best, length,
        targets: speeds().map((kmh) => length / (kmh / 3.6)), result: null });
      showGate(challenge.finishS);
      return true;
    },
    cancel() { challenge.state = 'idle'; gate.visible = false; },

    // Clock shown on the HUD: time driven, minus near-miss bonuses, plus crash penalties.
    get clock() { return Math.max(0, challenge.time - challenge.bonus + challenge.penalty); },
    get remaining() { return Math.max(0, challenge.length - challenge.progress); },
    // The best star still within reach as the clock stands: { stars, time } (null once even one star is gone).
    get nextTarget() {
      for (let stars = 3; stars >= 1; stars--) if (challenge.clock <= challenge.targets[stars - 1]) return { stars, time: challenge.targets[stars - 1] };
      return null;
    },
    // Seconds left to reach the gate for that star: what the HUD counts down.
    get timeLeft() { const next = challenge.nextTarget; return next ? next.time - challenge.clock : 0; },

    crash() { if (challenge.state === 'running') challenge.penalty += GAMEPLAY.crashPenalty; },

    update(dt, playerS) {
      challenge.playerS = playerS;
      challenge.comboTimer -= dt;
      if (challenge.comboTimer <= 0) challenge.combo = 0;
      if (challenge.state === 'running') {
        challenge.time += dt;
        // Metres driven toward the finish, added up frame by frame (on a loop the position itself
        // jumps back to 0 once per lap, so "position now minus start" would be wrong).
        challenge.progress += map.ahead(challenge.lastS, playerS) * challenge.dir;
        challenge.lastS = playerS;
        if (challenge.progress >= challenge.length) finish();
        else if (challenge.clock > challenge.targets[0]) timeUp();   // not even one star's time is left
        else if (challenge.progress < -150) challenge.cancel();   // drove off the other way
      } else if (challenge.state === 'finished') {
        challenge.finishedTimer -= dt;
        if (challenge.finishedTimer <= 0) challenge.state = 'idle';
      }
    },

    /**
     * Look for near misses this frame. Returns a list of { bonus, oncoming, gap }.
     * A car is "passed" the moment it moves from in front of the player to behind.
     */
    detectNearMisses(player, aiCars, time) {
      const v = player.vehicle, found = [];
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
      for (const ai of aiCars) {
        if (!ai.active) { ai.passSide = 0; continue; }
        const dx = ai.x - v.x, dz = ai.z - v.z;
        if (dx * dx + dz * dz > 40 * 40) { ai.passSide = 0; continue; }
        const ahead = dx * fx + dz * fz;
        const side = ahead > 0 ? 1 : -1;
        if (ai.passSide === 1 && side === -1) {
          const gap = Math.abs(dx * rx + dz * rz) - v.halfWidth - ai.halfWidth;
          const relative = Math.hypot(v.vx - ai.vx, v.vz - ai.vz);
          const clean = time - ai.lastHitTime > 2;
          if (clean && gap < GAMEPLAY.nearMissGap && gap > -0.2 && v.speed > GAMEPLAY.nearMissMinSpeed && relative > 6) {
            const oncoming = relative > v.speed + 4;
            const bonus = oncoming ? GAMEPLAY.nearMissOncomingBonus : GAMEPLAY.nearMissBonus;
            challenge.combo++; challenge.comboTimer = 6; challenge.nearMisses++;
            if (challenge.state === 'running') challenge.bonus += bonus;
            found.push({ bonus, oncoming, gap, combo: challenge.combo });
          }
        }
        ai.passSide = side;
      }
      return found;
    },
  };

  // The time ran out before the gate: the run is over, with nothing to show for it.
  function timeUp() {
    challenge.result = { timeUp: true, short: Math.round(challenge.remaining) };
    challenge.cancel();
  }
  // The gate has been reached: the clock stops, the stars are counted, and anything new is paid and saved.
  function finish() {
    const time = challenge.clock, record = recordOf(challenge.id);
    const stars = challenge.targets.filter((target) => time <= target).length;
    const newBest = record.best === null || time < record.best;
    if (newBest) record.best = Number(time.toFixed(3));
    const won = career.awardStars('timeAttack-' + keyOf(challenge.id), record, stars, RULES.timeAttack);
    if (!won.newStars) save.write();
    challenge.result = { time, stars, ...won, newBest, best: record.best };
    challenge.state = 'finished'; challenge.finishedTimer = 7;
    gate.visible = false;
  }
  return challenge;
}
