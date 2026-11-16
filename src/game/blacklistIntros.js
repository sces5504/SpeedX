// ---------------------------------------------------------------------------
// blacklistIntros.js — how each Blacklist driver is introduced before the race.
//
// Every driver has an introduction of their own. It is a scene (render/director.js:
// a list of shots) played on the black stage (world/stage.js), where the driver's
// car can be shown as glowing lines in their colour, lit by lamps that come up, or
// crossed by a bar of light - and it always ends the same way: back on the road,
// with their headlights behind the player (the shot `arrival` below).
//
// WHICH ONE PLAYS is the driver's "intro" in public/content/career.json:
//     "intro": "unveil"        the name of one of the INTROS below
// The driver's "colour" tints the lines, and their "line" is the sentence under their name.
//
// TO GIVE A NEW DRIVER THEIR OWN: write one more function like `unveil` (use the helpers
// below: they keep a shot to a line or two), add it to INTROS, name it in career.json.
// Make it THEIRS - other angles, another order, another rhythm. The skill
// .claude/skills/speedx-blacklist walks through it.
//
// What a scene gets:
//   entry   the driver (career.json)          rank    their number on the list
//   boss    their AI car (ai/aiCar.js): boss.car is the 3D car
//   player  the player's car                  stage   world/stage.js
//   tools   { toStage(), toRoad(), caption(big, small), fade(amount, seconds) }
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { beside, between, ease } from '../render/director.js';

// ---- Helpers for writing these shots ---------------------------------------------------------
// A camera move: from one place beside the car to another, looking at a third, through a lens.
// Places are [metres to the car's right, height, metres ahead of its middle].
const move = (car, from, to, look, fov) => (t) => ({ at: between(beside(car, ...from), beside(car, ...to), ease(t)), look: beside(car, ...look), fov });
// 0 -> 1 -> 0 over a shot (a pulse of light).
const pulse = (t) => Math.sin(Math.PI * t);

/** The scene for this driver: their own introduction, then their arrival behind the player. */
export function blacklistIntro(entry, rank, boss, player, stage, tools) {
  // The driver's lamps: head 0 off / 1 dipped / 2 main beam; brake = tail lamps bright.
  const lights = (head, brake = false) => { boss.car.setLights({ head, brake }); boss.car.updateLights(1 / 60, new THREE.Vector3(...beside(boss, 3, 1, 5))); };
  const make = INTROS[entry.intro] || INTROS.unveil;
  const shots = make({ entry, rank, car: boss, stage, tools, lights });
  // Every introduction begins on the stage, in the dark, in the driver's colour...
  const first = shots[0], begin = first.enter;
  first.enter = () => { tools.toStage(); stage.tint(entry.colour); stage.set(0, 0); stage.sweep(null); lights(0); tools.fade(0, 0.8); begin?.(); };
  // ...and ends on the road.
  return [...shots, arrival(boss, player, stage, tools, lights)];
}

// Back on the road: past the player's car to the headlights that have just arrived behind it.
function arrival(boss, player, stage, tools, lights) {
  const v = player.vehicle;
  return {
    seconds: 2.4,
    enter() { tools.caption(''); stage.sweep(null); tools.toRoad(); lights(2); tools.fade(0, 0.5); },
    camera: (t) => ({ at: between(beside(v, 2.3, 1.0, 5.5), beside(v, 1.9, 0.9, 3.5), ease(t)), look: [boss.x, boss.y + 0.7, boss.z], fov: 30 }),
    leave() { lights(1); },
  };
}

export const INTROS = {
  // UNVEIL (VANTA). Slow and cold. A heartbeat of lines in the dark; the camera slides along the
  // flank; one headlamp flickers awake; a bar of light crosses the bodywork from nose to tail;
  // the tail lamps burn; then the whole car, and the name.
  unveil({ entry, rank, car, stage, tools, lights }) {
    return [
      { // 1. Nothing - then the outline beats twice, like a pulse.
        seconds: 2.4,
        camera: move(car, [3.4, 1.3, 6.2], [3.2, 1.25, 5.9], [0, 0.6, 0.3], 30),
        update(t) { stage.set(0.9 * Math.max(0, Math.sin(t * Math.PI * 4)) ** 3, 0); },
      },
      { // 2. Along the flank at wheel height: only the lines.
        seconds: 3.2,
        enter() { tools.caption(`BLACKLIST #${rank}`); },
        camera: (t) => ({ at: between(beside(car, 2.0, 0.42, 3.0), beside(car, 1.6, 0.5, -1.8), ease(t)), look: beside(car, 0, 0.55, 0.6 - t * 1.2), fov: 28 }),
        update(t) { stage.set(Math.min(1, 0.25 + t * 1.5), 0); },
        leave() { tools.caption(''); },
      },
      { // 3. Close on one headlamp: it flickers, then holds.
        seconds: 2.4,
        camera: move(car, [1.9, 0.62, 3.6], [1.55, 0.6, 3.2], [0.55, 0.62, 2.0], 22),
        update(t) {
          stage.set(0.8, 0.04);
          lights(t > 0.62 || (t > 0.34 && t < 0.4) || (t > 0.48 && t < 0.52) ? 1 : 0);
        },
      },
      { // 4. From high behind: a bar of light travels the length of the car and the paint appears under it.
        seconds: 3.0,
        camera: move(car, [-2.0, 2.7, -4.4], [-0.6, 2.2, -4.0], [0, 0.7, 0.4], 34),
        update(t) { stage.set(0.8 - t * 0.5, t * 0.12); stage.sweep(ease(t)); },
        leave() { stage.sweep(null); },
      },
      { // 5. Low behind it: the tail lamps come on full.
        seconds: 2.2,
        camera: move(car, [-1.5, 0.38, -4.6], [-0.9, 0.5, -4.2], [0, 0.72, -1.2], 30),
        update(t) { stage.set(0.3, 0.12 + t * 0.2); lights(1, t > 0.3); },
        leave() { lights(1, false); },
      },
      { // 6. The car itself, three-quarters from the front - and who drives it.
        seconds: 4.2,
        enter() { tools.caption(entry.name, entry.line || `BLACKLIST #${rank}`); },
        camera: move(car, [3.3, 1.0, 6.0], [2.4, 0.8, 4.4], [0, 0.6, 0.6], 32),
        update(t) { stage.set(Math.max(0, 0.3 - t), 0.32 + ease(Math.min(1, t * 1.5)) * 0.68); if (t > 0.88) tools.fade(1, 0.4); },
      },
    ];
  },

  // STROBE. Fast and loud, for a driver with a temper: six looks at the car, each lit by one hard
  // flash of light that dies away, quicker and quicker - then everything on at once, and the name.
  strobe({ entry, rank, car, stage, tools, lights }) {
    const looks = [
      [[2.2, 0.5, 3.4], [2.0, 0.5, 3.1], [0.4, 0.6, 1.8], 26],      // front wheel and lamp
      [[-2.4, 0.9, -3.6], [-2.2, 0.9, -3.4], [0, 0.7, -1.0], 30],   // rear quarter
      [[0, 3.8, 0.6], [0, 3.6, 0.2], [0, 0.5, 0], 40],              // straight down on the roof
      [[1.3, 0.35, -4.2], [1.1, 0.35, -4.0], [0, 0.6, -1.6], 28],   // exhausts
      [[-2.6, 0.7, 1.0], [-2.4, 0.7, 0.6], [0, 0.6, 0], 34],        // the door
      [[0, 0.7, 6.4], [0, 0.7, 6.0], [0, 0.6, 0], 30],              // nose on
    ];
    const flashes = looks.map(([from, to, look, fov], k) => ({
      seconds: 1.15 - k * 0.12,
      enter() { if (k === 0) tools.caption(`BLACKLIST #${rank}`); if (k === 5) lights(2); },
      camera: move(car, from, to, look, fov),
      update(t) { const flash = Math.max(0, 1 - t * 2.4) ** 2; stage.set(0.35 + flash, flash * 0.9); },
    }));
    return [
      ...flashes,
      { seconds: 3.8,
        enter() { tools.caption(entry.name, entry.line || `BLACKLIST #${rank}`); lights(1); },
        camera: move(car, [-3.4, 1.1, 5.8], [-2.5, 0.85, 4.4], [0, 0.6, 0.6], 32),
        update(t) { stage.set(0.5 * pulse(Math.min(1, t * 3)), Math.min(1, t * 4)); if (t > 0.88) tools.fade(1, 0.4); },
      },
    ];
  },
};
