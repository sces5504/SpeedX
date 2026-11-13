// ---------------------------------------------------------------------------
// challenge.js — the two scoring games on top of free driving:
//
//  NEAR MISS   Pass another car closer than ~1.3 m at speed without touching
//              it. Oncoming cars count double.
//  TIME ATTACK Press E at an orange cone to start a timed run to a finish
//              gate ~3 km up the road. Every near miss takes time OFF the
//              clock; every hard crash adds a penalty. Risk versus reward.
//
// Also owns the glowing finish gate, which races (rivals.js) borrow too.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GAMEPLAY, ROAD } from '../config.js';

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
  function showGate(s) {
    const p = map.pointAt(s, 0);
    gate.position.set(p.x, p.y, p.z);
    gate.rotation.y = p.yaw;
    gate.visible = true;
  }

  const bestKey = (id) => 'speedx-best-' + id;
  const challenge = {
    state: 'idle',            // 'idle' | 'running' | 'finished'
    time: 0, bonus: 0, penalty: 0, nearMisses: 0,
    startS: 0, finishS: 0, dir: 1, id: '', best: null, finalTime: 0, newBest: false, finishedTimer: 0,
    combo: 0, comboTimer: 0,  // near misses in quick succession
    showGate, hideGate() { gate.visible = false; },

    start(poi, playerS, dir) {
      const length = Math.min(GAMEPLAY.challengeLength, dir > 0 ? map.road.length - 150 - playerS : playerS - 150);
      if (length < 800) return false;                       // too close to the end of the road
      const id = poi.id + (dir > 0 ? '-up' : '-down');
      const saved = parseFloat(localStorage.getItem(bestKey(id)));
      Object.assign(challenge, { state: 'running', time: 0, bonus: 0, penalty: 0, nearMisses: 0, startS: playerS,
        finishS: playerS + dir * length, dir, id, best: Number.isFinite(saved) ? saved : null, length });
      showGate(challenge.finishS);
      return true;
    },
    cancel() { challenge.state = 'idle'; gate.visible = false; },

    // Clock shown on the HUD: time driven, minus near-miss bonuses, plus crash penalties.
    get clock() { return Math.max(0, challenge.time - challenge.bonus + challenge.penalty); },
    get remaining() { return Math.max(0, (challenge.finishS - challenge.playerS) * challenge.dir); },

    crash() { if (challenge.state === 'running') challenge.penalty += GAMEPLAY.crashPenalty; },

    update(dt, playerS) {
      challenge.playerS = playerS;
      challenge.comboTimer -= dt;
      if (challenge.comboTimer <= 0) challenge.combo = 0;
      if (challenge.state === 'running') {
        challenge.time += dt;
        if ((playerS - challenge.finishS) * challenge.dir >= 0) {
          challenge.finalTime = challenge.clock;
          challenge.newBest = challenge.best === null || challenge.finalTime < challenge.best;
          if (challenge.newBest) localStorage.setItem(bestKey(challenge.id), challenge.finalTime.toFixed(3));
          challenge.state = 'finished'; challenge.finishedTimer = 7;
          gate.visible = false;
        } else if ((playerS - challenge.startS) * challenge.dir < -150) challenge.cancel();   // drove off the other way
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
  return challenge;
}
