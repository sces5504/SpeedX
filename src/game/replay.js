// ---------------------------------------------------------------------------
// replay.js — the last few seconds, played back like a film.
//
// WHAT A REPLAY IS MADE OF. Not a script and not a video: a RECORDING OF WHERE THE
// CARS WERE. While you drive, thirty times a second, the place and attitude of your
// car and of every car near it is written to a list in memory (`frames`), and
// anything older than SECONDS is forgotten. Nothing is saved to disk.
//
// A MOMENT WORTH SEEING (a speed camera, the end of a race or a time attack) is
// marked with replay.mark(label, time, details). The recording runs on for TAIL seconds -
// so the moment is not the last thing in it - and then a CLIP is ready (replay.ready).
//
// PLAYBACK. replay.start() takes the clip and cuts it into SHOTS (planShots, below):
// which camera films which stretch. replay.step() then puts every car back where it
// was at each instant and aims the camera of that stretch.
//
// THE EDIT IS MADE AFRESH EVERY TIME R IS PRESSED. Which cameras, in what order, where
// each one stands and how long it runs are all drawn by lot - so the same clip never
// plays the same way twice. Only two things are fixed:
//   * the same kind of camera is never used twice running;
//   * THE MOMENT ITSELF has a camera of its own (the last part of the film):
//       a speed camera   STILL: a camera that does not move at all, at the roadside with the pole
//                        in its picture. The car goes through at full speed and the pole's flash
//                        fires (step() says when: main.js sets it off).
//       a finish line    LINE: beyond the gate, low, looking back through it. The last instant
//                        before the line plays in SLOW MOTION; at the line the film is back at
//                        full speed and cuts to a camera just past the gate.
//     Slow motion is used nowhere else.
//
// THE CAMERAS that the lot is drawn from (KINDS, below):
//   flyby    stands still at the roadside, low. The car comes at it, goes by in a blur and is
//            gone: the camera swings after it but cannot keep up. This is what makes it look fast.
//   tele     a long lens far down a straight: the car grows out of the dark towards it.
//   crane    high over the roadside, sinking as the car passes underneath.
//   chase    a camera car running with it, drifting from one place round the car to another.
//   onboard  bolted to the car close to the road (by a wheel, on the nose, low behind it), wide lens.
// A camera at the roadside is kept between the car and whatever stands beside it there (the
// guardrail, the wall on the median): record() is told how much room there was.
//
// Nothing of the real game is changed by this: only the 3D models are moved. When the
// replay ends (or is skipped) the next frame of driving puts every car back where it
// really is. main.js stops the driving for as long as it plays, and lights it (render/replayLook.js).
// ---------------------------------------------------------------------------
import { angleDiff, clamp, damp, lerp, noise1, smoothstep } from '../core/mathUtils.js';

const SECONDS = 14;         // how much is kept
const RATE = 30;            // times a second
const TAIL = 2.6;           // seconds recorded after a marked moment before the clip is cut
const SLOW = 0.25;          // speed of the film in the slow motion before a finish line...
const SLOW_FROM = 0.5, SLOW_TO = 0.06;      // ...which runs from this long before the line to this long before it (seconds)

export function createReplay() {
  let frames = [];          // { time, rpm, throttle, speed, cars: [{ who, x, y, z, pitch, yaw, roll, wheel, steer, brake }] } (the player's car first, with its `room`)
  let sinceLast = 0, marked = null;
  let clip = null, at = 0, live = null;     // while playing: the clip, the time in it, and where the AI cars really are
  let shot = null;                          // the shot being shown

  const replay = {
    ready: null,              // a clip waiting to be watched: { label, moment, frames, finish, trap }
    get playing() { return Boolean(clip); },
    // The film being shown, as a list (handy in the browser console: speedx.replay.edit): [{ camera, from (seconds into the clip) }].
    get edit() { return clip ? clip.shots.map((s) => ({ camera: s.name, from: Number((s.from - clip.frames[0].time).toFixed(2)) })) : null; },

    /**
     * Call every frame of driving. player = the player's car, others = the AI cars,
     * room = [left, right]: metres of open ground beside the player's car, as its driver sees it.
     */
    record(dt, time, player, others, room) {
      if (marked && time >= marked.time + TAIL) { replay.ready = { ...marked, moment: marked.time, frames: frames.slice() }; marked = null; }
      if ((sinceLast += dt) < 1 / RATE) return;
      sinceLast = 0;
      const v = player.vehicle, g = player.car.group;
      const cars = [{ who: player, x: g.position.x, y: g.position.y, z: g.position.z, pitch: g.rotation.x, yaw: g.rotation.y, roll: g.rotation.z, wheel: v.wheelAngle, steer: v.steerAngle, brake: v.brake > 0.05, room }];
      for (const ai of others) {
        if (!ai.active || (ai.x - v.x) ** 2 + (ai.z - v.z) ** 2 > 300 * 300) continue;
        const a = ai.car.group;
        cars.push({ who: ai, x: a.position.x, y: a.position.y, z: a.position.z, pitch: a.rotation.x, yaw: a.rotation.y, roll: a.rotation.z, wheel: ai.wheelAngle, steer: 0, brake: ai.accel < -1.2 });
      }
      frames.push({ time, rpm: v.rpm, throttle: v.throttle, speed: v.speed, cars });
      while (frames.length && frames[0].time < time - SECONDS) frames.shift();
    },
    // Something worth seeing again has just happened. details says what kind of moment it is:
    //   { finish: true }   a finish line being crossed
    //   { trap: camera }   a speed camera (game/speedTraps.js) being passed: its pole is camera.pole
    mark(label, time, details = {}) { marked = { label, time, ...details }; replay.ready = null; },
    // Forget everything (the car was put somewhere else: what was recorded no longer joins up).
    clear() { frames = []; marked = null; replay.ready = null; },

    // Start playing the clip that is ready. others = the AI cars (so they can be put back afterwards).
    start(others) {
      clip = replay.ready; replay.ready = null;
      at = clip.frames[0].time;
      live = others.map((ai) => ({ ai, x: ai.x, y: ai.y, z: ai.z, yaw: ai.yaw, visible: ai.car.group.visible }));
      clip.shots = planShots(clip);
      shot = null;
    },
    stop() {
      if (!clip) return;
      for (const { ai, x, y, z, yaw, visible } of live) { Object.assign(ai, { x, y, z, yaw }); ai.car.group.visible = visible; }
      clip = live = shot = null;
    },
    /**
     * One frame of playback. Returns what there is to hear and feel then:
     *   { rpm, throttle, speed, hero: { x, y, z, yaw }, rush: 0..1 (how hard the picture should streak),
     *     flash: the speed camera to set off now (only on the frame the film reaches the moment) }
     * or null when the clip has run out (the replay has then stopped itself).
     */
    step(dt, camera) {
      // Slow motion only in the last instant before a finish line; full speed again at the line.
      const toLine = clip.moment - at;
      const film = clip.finish && toLine > 0 && toLine < SLOW_FROM ? lerp(1, SLOW, clamp(Math.min(SLOW_FROM - toLine, toLine - SLOW_TO + 0.08) / 0.08, 0, 1)) : 1;
      const reached = at < clip.moment && at + dt * film >= clip.moment;      // this is the frame the film gets to the moment
      at += dt * film;
      const last = clip.frames[clip.frames.length - 1];
      if (at >= last.time) { replay.stop(); return null; }
      let i = 0;
      while (i < clip.frames.length - 2 && clip.frames[i + 1].time <= at) i++;
      const a = clip.frames[i], b = clip.frames[i + 1], t = clamp((at - a.time) / (b.time - a.time), 0, 1);
      // Every car that was there: back where it was (cars that were not there are hidden).
      for (const { ai } of live) ai.car.group.visible = false;
      let hero = null;
      for (const was of a.cars) {
        const then = b.cars.find((c) => c.who === was.who) || was;
        const x = lerp(was.x, then.x, t), y = lerp(was.y, then.y, t), z = lerp(was.z, then.z, t);
        const yaw = was.yaw + Math.atan2(Math.sin(then.yaw - was.yaw), Math.cos(then.yaw - was.yaw)) * t;
        const car = was.who.car;
        car.group.visible = true;
        car.group.position.set(x, y, z);
        car.group.rotation.set(lerp(was.pitch, then.pitch, t), yaw, lerp(was.roll, then.roll, t));
        car.wheels.forEach((wheel, k) => { wheel.spin.rotation.x = -lerp(was.wheel, then.wheel, t); if (k < 2) wheel.pivot.rotation.y = was.steer; });
        if (was.who.vehicle) hero = { x, y, z, yaw };                       // the player's car: what the cameras follow
        else Object.assign(was.who, { x, y, z, yaw });                      // an AI car: its lamps are aimed from these
      }
      const speed = lerp(a.speed, b.speed, t);
      const next = clip.shots.findLast((s) => s.from <= at) || clip.shots[0];
      if (next !== shot) { shot = next; shot.begin?.(hero); }
      const rush = shot.aim(hero, camera, at, dt * film, speed);
      return { rpm: lerp(a.rpm, b.rpm, t), throttle: a.throttle, speed, hero, rush: rush || 0, flash: reached ? clip.trap || null : null };
    },
  };
  return replay;
}

// ---- Small helpers ------------------------------------------------------------------------------------
// What was recorded at a time in the clip, and where the player's car was then: { x, y, z, yaw, room }.
function frameAt(clip, time) {
  let frame = clip.frames[0];
  for (const f of clip.frames) { if (f.time > time) break; frame = f; }
  return frame;
}
const heroAt = (clip, time) => frameAt(clip, time).cars[0];
// A point given from where the car was: `right` metres to its right, `up` above it, `ahead` in front.
const from = (car, right, up, ahead) => [car.x + Math.cos(car.yaw) * right - Math.sin(car.yaw) * ahead, car.y + up, car.z - Math.sin(car.yaw) * right - Math.cos(car.yaw) * ahead];
function point(camera, at, look, fov) {
  camera.position.set(...at); camera.up.set(0, 1, 0); camera.lookAt(...look);
  camera.fov = fov; camera.updateProjectionMatrix();
}
// Drawing lots.
const random = (least, most) => least + Math.random() * (most - least);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const eitherSide = () => (Math.random() < 0.5 ? 1 : -1);
// The lens (degrees) that shows about `size` metres of whatever is `distance` metres away.
const lensFor = (size, distance, least, most) => clamp((2 * Math.atan(size / Math.max(distance, 1)) * 180) / Math.PI, least, most);
// How strongly a car going by a camera standing on the ground is felt: 0..1.
const passing = (distance, speed) => clamp(1 - distance / 14, 0, 1) * clamp(speed / 45, 0, 1);

// The side of the car's path a camera can stand on at a time in the clip, and how far out:
// { there (the car then), side (+1 right, -1 left), out (metres) }. It asks for wanted = [least, most]
// metres, and gets no more than there is room for before the guardrail or the median wall.
function roadside(clip, time, wanted, side = eitherSide()) {
  const there = heroAt(clip, time), room = there.room || [9, 9], roomOn = (s) => room[s > 0 ? 1 : 0];
  if (roomOn(side) < wanted[0] && roomOn(-side) > roomOn(side)) side = -side;
  return { there, side, out: Math.max(1.6, Math.min(random(...wanted), roomOn(side))) };
}
// Did the car drive more or less in a straight line between two times? (A long lens needs that:
// round a bend there would be a hillside or a house between it and the car.)
function straight(clip, start, end) {
  const a = heroAt(clip, start), b = heroAt(clip, end), length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < 40) return false;                               // (it was hardly moving: nothing to see from far away)
  return clip.frames.every((frame) => {
    const car = frame.cars[0];
    return frame.time < start || frame.time > end || Math.abs((car.x - a.x) * (b.z - a.z) - (car.z - a.z) * (b.x - a.x)) / length < 3.5;
  });
}

// ---- The edit: which camera films which stretch of the clip -------------------------------------------
// The cameras the lot is drawn from. seconds = the shortest and longest such a shot runs; often = how
// likely it is to be drawn; make(clip, start, end) -> the shot, or null if it does not suit that stretch.
const KINDS = [
  { name: 'flyby', seconds: [1.7, 3.0], often: 3, make: (clip, start, end) => flyby(clip, start, end) },
  { name: 'tele', seconds: [2.2, 3.6], often: 2, make: (clip, start, end) => tele(clip, start, end) },
  { name: 'crane', seconds: [2.4, 3.4], often: 1, make: (clip, start, end) => flyby(clip, start, end, { out: [3, 5], up: random(6, 8), sink: random(2, 3.5), where: random(0.55, 0.7) }) },
  { name: 'chase', seconds: [2.4, 3.8], often: 2, make: (clip, start, end) => chase(clip, start, end) },
  { name: 'onboard', seconds: [1.3, 2.5], often: 3, make: (clip, start, end, mounts) => onboard(clip, start, mounts) },
];

// Returns the shots in order: [{ name, from (time it starts), begin(hero), aim(hero, camera, time, dt, speed) -> rush }].
function planShots(clip) {
  const start = clip.frames[0].time, end = clip.frames[clip.frames.length - 1].time;
  // The moment itself has its own camera, which takes over a little before it...
  const closing = clip.finish ? finishShots(clip, end) : clip.trap ? trapShots(clip, end) : [flyby(clip, clip.moment - 1.3, end)];
  const takeover = closing[0].from;
  // ...and up to there the cameras are drawn by lot, each for a length of its own.
  const shots = [], mounts = [];           // (mounts: the places on the car already used in this film)
  let time = start, last = null;
  while (takeover - time > 1.2) {
    const kind = pick(KINDS.filter((k) => k !== last).flatMap((k) => Array(k.often).fill(k)));
    let until = Math.min(time + random(...kind.seconds), takeover);
    if (takeover - until < 1.2) until = takeover;              // (rather a longer shot than a scrap left over)
    shots.push(kind.make(clip, time, until, mounts) || flyby(clip, time, until));
    time = until; last = kind;
  }
  return [...shots, ...closing];
}

// A FINISH LINE: through the gate, the last of it in slow motion; at the line full speed again, and away.
function finishShots(clip, end) {
  const lead = random(1.5, 2.0);
  return [line(clip, clip.moment - lead), flyby(clip, clip.moment, end, { where: random(0.35, 0.5), up: random(0.4, 0.8) })];
}

// A SPEED CAMERA: the camera that stands still, and then one more to watch the car go.
function trapShots(clip, end) {
  const watch = still(clip), left = end - watch.until;
  if (left < 0.7) return [watch];
  return [watch, pick([() => chase(clip, watch.until, end), () => flyby(clip, watch.until, end, { where: random(0.3, 0.5) })])()];
}

// ---- The cameras ---------------------------------------------------------------------------------
// FLYBY: a tripod beside the road where the car will be part-way through the shot (`where`: 0 = at
// its start, 1 = at its end), `out` = [least, most] metres to one side of its path, `up` metres off
// the ground. The head swings after the car, but only so fast - as it goes by, it leaves the picture.
// sink = metres the camera comes down during the shot (a CRANE is a flyby that starts high and sinks).
function flyby(clip, start, end, { where = random(0.5, 0.7), out = [3, 5.5], up = random(0.4, 1.5), sink = 0, side } = {}) {
  const spot = roadside(clip, lerp(start, end, where), out, side), eye = from(spot.there, spot.out * spot.side, up, 0);
  let bearing = 0, tilt = 0, shake = 0;
  const toward = (hero) => [Math.atan2(hero.x - eye[0], hero.z - eye[2]), Math.atan2(hero.y + 0.5 - eye[1], Math.hypot(hero.x - eye[0], hero.z - eye[2]))];
  return {
    name: sink ? 'crane' : 'flyby', from: start,
    begin(hero) { [bearing, tilt] = toward(hero); shake = 0; },
    aim(hero, camera, time, dt, speed) {
      eye[1] = spot.there.y + up - sink * smoothstep(start, end, time);
      const [wantBearing, wantTilt] = toward(hero), distance = Math.hypot(hero.x - eye[0], hero.z - eye[2]);
      bearing += angleDiff(wantBearing, bearing) * (1 - Math.exp(-dt * 7));    // quick, but not quick enough for a car a few metres away
      tilt = damp(tilt, wantTilt, 7, dt);
      // The ground shakes as it goes by.
      const near = passing(distance, speed);
      shake = Math.max(shake * Math.exp(-dt * 5), near);
      const jx = (noise1(time * 38) - 0.5) * 0.09 * shake, jy = (noise1(time * 38 + 9) - 0.5) * 0.07 * shake;
      point(camera, [eye[0] + jx, eye[1] + jy, eye[2]], [eye[0] + Math.sin(bearing) * Math.cos(tilt) * 10, eye[1] + Math.sin(tilt) * 10 + jy, eye[2] + Math.cos(bearing) * Math.cos(tilt) * 10],
        lensFor(7, Math.max(distance, 6), 26, 62));                             // long lens while it is far off, wide as it arrives
      return near;
    },
  };
}

// TELE: a long lens a long way down the road, held by hand. It stands beside where the car will be a
// moment AFTER the shot is over, so the car comes at it out of the dark, growing in the picture, and
// the cut comes before it arrives. Only on a straight (see `straight`): elsewhere it says no (null).
function tele(clip, start, end) {
  const beyond = end + random(0.9, 1.5);
  if (!straight(clip, start, beyond)) return null;
  const spot = roadside(clip, beyond, [2, 3.2]), eye = from(spot.there, spot.out * spot.side, random(0.7, 1.3), 0);
  return {
    name: 'tele', from: start,
    aim(hero, camera, time, dt, speed) {
      const distance = Math.hypot(hero.x - eye[0], hero.z - eye[2]);
      const sway = distance * 0.0025;                                           // (a long lens never holds quite still)
      point(camera, eye, [hero.x + (noise1(time * 1.7) - 0.5) * sway, hero.y + 0.6 + (noise1(time * 1.7 + 4) - 0.5) * sway, hero.z], lensFor(3.5, distance, 3.5, 38));
      return passing(distance, speed) * 0.6;
    },
  };
}

// CHASE: a camera car running with the car, drifting from one place round it to another during the
// shot. It takes the car's turns a little late, as a real one would, so in a bend the car moves in
// the picture.  [where it starts, where it ends: each right, up, ahead], lens
const RUNS = [
  [[2.4, 0.9, -7.5], [3.2, 0.7, -2], 54],        // from behind, drawing up alongside
  [[2.6, 0.8, 8.5], [1.9, 0.55, 5.4], 40],       // ahead of it, looking back, letting it catch up
  [[0.5, 4.2, -10], [0, 1.5, -6.5], 50],         // high behind it, sinking to the road
  [[3.8, 0.6, 2.5], [3.6, 0.9, -4.5], 60],       // alongside, falling back to its tail
];
function chase(clip, start, end) {
  const [a, b, fov] = pick(RUNS);
  const spot = roadside(clip, lerp(start, end, 0.5), [3.8, 3.8]), reach = spot.side * Math.min(1, spot.out / 3.8);   // (closer in where there is little room)
  let yaw = 0;
  return {
    name: 'chase', from: start,
    begin(hero) { yaw = hero.yaw; },
    aim(hero, camera, time, dt, speed) {
      yaw += angleDiff(hero.yaw, yaw) * (1 - Math.exp(-dt * 4));
      const k = smoothstep(start, end, time);
      point(camera, from({ ...hero, yaw }, lerp(a[0], b[0], k) * reach, lerp(a[1], b[1], k), lerp(a[2], b[2], k)), [hero.x, hero.y + 0.55, hero.z], fov);
      return clamp(speed / 55, 0, 1) * 0.6;
    },
  };
}

// ONBOARD: fixed to the car, low and wide, so the road pours past.  [right, up, ahead, look right, look up, look ahead, lens]
const MOUNTS = [
  [1.25, 0.34, -1.5, 0.9, 0.5, 14, 74],        // by the rear wheel, looking forward along the flank
  [1.3, 0.3, 2.7, 0.95, 0.45, -14, 72],        // by the front wheel, looking back along the flank
  [-0.5, 0.42, 4.6, 0, 0.55, 0, 56],           // out in front of the nose, looking back at the car
  [-0.7, 0.8, -4.8, 0, 0.6, 12, 70],           // low behind it
  [1.2, 0.98, 0.3, 1.0, 0.8, 18, 62],          // at the door mirror, looking up the road
];
// used = the mounts this film has had already (a film does not go back to one while others are left).
function onboard(clip, start, used = []) {
  if (used.length >= MOUNTS.length) used.length = 0;
  const mount = pick(MOUNTS.filter((m) => !used.includes(m)));
  used.push(mount);
  const [right, up, ahead, lookRight, lookUp, lookAhead, fov] = mount;
  const side = roadside(clip, start, [right, right]).side;                     // (on the side with room to see past the car)
  return {
    name: 'onboard', from: start,
    aim(hero, camera, time, dt, speed) {
      const buzz = clamp(speed / 60, 0, 1) * 0.025;
      const at = from(hero, right * side + (noise1(time * 31) - 0.5) * buzz, up + (noise1(time * 31 + 5) - 0.5) * buzz, ahead);
      point(camera, at, from(hero, lookRight * side, lookUp, lookAhead), fov);
      return clamp(speed / 55, 0, 1) * 0.8;
    },
  };
}

// STILL: the speed camera's own shot. This camera does not move and does not turn. It stands at the
// roadside some way along from the pole - on the side the pole's flash faces, so the flash is seen -
// with the pole on one side of its picture and the road on the other, and the car goes through.
// `until` = when the next shot may take over (the car has left the picture).
function still(clip) {
  const pole = clip.trap.pole, car = heroAt(clip, clip.moment), pace = Math.max(12, frameAt(clip, clip.moment).speed);      // (pace: how fast it went by, m/s)
  // The flash looks down the road (the pole's own +Z). Is that the way the car is going? Then the camera
  // stands beyond the pole and the car comes at it; otherwise before the pole, and the car goes away from it.
  const beyond = -Math.sin(car.yaw) * Math.sin(pole.rotation.y) - Math.cos(car.yaw) * Math.cos(pole.rotation.y) > 0 ? 1 : -1;
  const away = random(15, 21);                                                 // metres along the road from the pole
  const spot = heroAt(clip, clip.moment + (beyond * away) / pace);            // the car's own path there...
  const across = (pole.position.x - car.x) * Math.cos(car.yaw) - (pole.position.z - car.z) * Math.sin(car.yaw);      // (the pole is this far to the car's right; minus = left)
  // ...and to one side of it. Usually the pole's side: just on the road's side of the pole, but never far
  // from the car. Where the car has no room on that side (a wall stands between it and the pole, which
  // is on the other carriageway), the other side: the car then goes by between the camera and the pole.
  const toPole = Math.sign(across), room = car.room || [9, 9], roomOn = (side) => room[side > 0 ? 1 : 0];
  const out = roomOn(toPole) > 3 ? toPole * Math.min(Math.abs(across) - random(1.9, 2.6), roomOn(toPole), 4.5) : -toPole * Math.max(1.6, Math.min(random(2.6, 3.4), roomOn(-toPole)));
  const eye = from(spot, out, random(0.7, 1.1), 0);
  const look = [lerp(car.x, pole.position.x, 0.4), car.y + 1.7, lerp(car.z, pole.position.z, 0.4)];
  return {
    name: 'still',
    from: clip.moment - (beyond > 0 ? random(1.6, 2.2) : away / pace + random(0.7, 1.1)),      // (coming at it: from far off; from behind it: just before it bursts in)
    until: clip.moment + (beyond > 0 ? away / pace + 0.3 : random(0.8, 1.1)),
    aim(hero, camera, time, dt, speed) {
      point(camera, eye, look, 44);
      return passing(Math.hypot(hero.x - eye[0], hero.z - eye[2]), speed);
    },
  };
}

// LINE: beyond the finish gate, low, a little to one side of the car's path, looking back at the gate
// and the car coming through it. It stands where the car itself was a moment after the line (so it is
// on the road, whatever the road does there), and its lens is wide enough to hold the whole gate.
function line(clip, start) {
  const gate = heroAt(clip, clip.moment), speed = Math.max(15, frameAt(clip, clip.moment).speed);
  const at = from(heroAt(clip, clip.moment + random(22, 30) / speed), eitherSide() * random(1.4, 2.2), random(0.35, 0.6), 0);
  return {
    name: 'line', from: start,
    aim(hero, camera) {
      // Half way between the middle of the gate and the car: both stay in the picture.
      point(camera, at, [(gate.x + hero.x) / 2, (gate.y + 2.2 + hero.y + 0.7) / 2, (gate.z + hero.z) / 2], 34);
      return 0.2;
    },
  };
}
