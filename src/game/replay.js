// ---------------------------------------------------------------------------
// replay.js — the last few seconds, played back like a film.
//
// WHAT A REPLAY IS MADE OF. Not a script and not a video: a RECORDING OF WHERE THE
// CARS WERE. While you drive, thirty times a second, the place and attitude of your
// car and of every car near it is written to a list in memory (`frames`), and
// anything older than SECONDS is forgotten. Nothing is saved to disk.
//
// A MOMENT WORTH SEEING (a speed camera, the end of a race or a time attack) is
// marked with replay.mark(label, time). The recording runs on for TAIL seconds -
// so the moment is not the last thing in it - and then a CLIP is ready (replay.ready).
//
// PLAYBACK. replay.start() takes the clip and cuts it into SHOTS (planShots, below):
// which camera films which stretch. The cameras are chosen when you press R, not
// when it happened - the same clip could be cut another way. replay.step() then puts
// every car back where it was at each instant and aims the camera of that stretch.
//
// THE CAMERAS are picked for SPEED:
//   flyby    stands still at the roadside, low. The car comes at it, goes by in a blur and is
//            gone: the camera swings after it but cannot keep up. This is what makes it look fast.
//   onboard  bolted to the car close to the road (by a wheel, on the nose, low behind it), wide lens.
//   line     only where a race or time attack ends: beyond the gate, low, looking back through
//            it. The last instant before the line plays in SLOW MOTION; at the line the film is
//            back at full speed and cuts to a flyby just past the gate.
// Slow motion is used nowhere else.
//
// Nothing of the real game is changed by this: only the 3D models are moved. When the
// replay ends (or is skipped) the next frame of driving puts every car back where it
// really is. main.js stops the driving for as long as it plays, and lights it (render/replayLook.js).
// ---------------------------------------------------------------------------
import { clamp, damp, lerp, noise1 } from '../core/mathUtils.js';

const SECONDS = 14;         // how much is kept
const RATE = 30;            // times a second
const TAIL = 2.6;           // seconds recorded after a marked moment before the clip is cut
const SLOW = 0.25;          // speed of the film in the slow motion before a finish line...
const SLOW_FROM = 0.5, SLOW_TO = 0.06;      // ...which runs from this long before the line to this long before it (seconds)

export function createReplay() {
  let frames = [];          // { time, rpm, throttle, speed, cars: [{ who, x, y, z, pitch, yaw, roll, wheel, steer, brake }] }
  let sinceLast = 0, marked = null;
  let clip = null, at = 0, live = null;     // while playing: the clip, the time in it, and where the AI cars really are
  let shot = null;                          // the shot being shown

  const replay = {
    ready: null,              // a clip waiting to be watched: { label, moment, frames, finish }
    get playing() { return Boolean(clip); },

    /** Call every frame of driving. player = the player's car, others = the AI cars. */
    record(dt, time, player, others) {
      if (marked && time >= marked.time + TAIL) { replay.ready = { label: marked.label, moment: marked.time, finish: marked.finish, frames: frames.slice() }; marked = null; }
      if ((sinceLast += dt) < 1 / RATE) return;
      sinceLast = 0;
      const v = player.vehicle, g = player.car.group;
      const cars = [{ who: player, x: g.position.x, y: g.position.y, z: g.position.z, pitch: g.rotation.x, yaw: g.rotation.y, roll: g.rotation.z, wheel: v.wheelAngle, steer: v.steerAngle, brake: v.brake > 0.05 }];
      for (const ai of others) {
        if (!ai.active || (ai.x - v.x) ** 2 + (ai.z - v.z) ** 2 > 300 * 300) continue;
        const a = ai.car.group;
        cars.push({ who: ai, x: a.position.x, y: a.position.y, z: a.position.z, pitch: a.rotation.x, yaw: a.rotation.y, roll: a.rotation.z, wheel: ai.wheelAngle, steer: 0, brake: ai.accel < -1.2 });
      }
      frames.push({ time, rpm: v.rpm, throttle: v.throttle, speed: v.speed, cars });
      while (frames.length && frames[0].time < time - SECONDS) frames.shift();
    },
    // Something worth seeing again has just happened. finish = true if the moment is a finish line being crossed.
    mark(label, time, finish = false) { marked = { label, time, finish }; replay.ready = null; },
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
     *   { rpm, throttle, speed, hero: { x, y, z, yaw }, rush: 0..1 (how hard the picture should streak) }
     * or null when the clip has run out (the replay has then stopped itself).
     */
    step(dt, camera) {
      // Slow motion only in the last instant before a finish line; full speed again at the line.
      const toLine = clip.moment - at;
      const film = clip.finish && toLine > 0 && toLine < SLOW_FROM ? lerp(1, SLOW, clamp(Math.min(SLOW_FROM - toLine, toLine - SLOW_TO + 0.08) / 0.08, 0, 1)) : 1;
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
      return { rpm: lerp(a.rpm, b.rpm, t), throttle: a.throttle, speed, hero, rush: rush || 0 };
    },
  };
  return replay;
}

// What was recorded at a time in the clip, and where the player's car was then: { x, y, z, yaw }.
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

// ---- The edit: which camera films which stretch of the clip -------------------------------------------
// Returns the shots in order: [{ from (time it starts), begin(hero), aim(hero, camera, time, dt, speed) -> rush }].
function planShots(clip) {
  const start = clip.frames[0].time, end = clip.frames[clip.frames.length - 1].time, moment = clip.moment;
  const shots = [];
  // Up to the moment itself: flyby, onboard, flyby (other side), onboard... each a couple of seconds.
  const lead = clip.finish ? 1.7 : 1.3;                        // the moment's own camera takes over this long before it
  for (let time = start, k = 0; time < moment - lead - 0.8; k++) {
    const seconds = k % 2 === 0 ? 2.5 : 2.1, until = Math.min(time + seconds, moment - lead);
    shots.push(k % 2 === 0 ? flyby(clip, time, until, (k / 2) % 2 ? 1 : -1, 3.6 + (k % 3) * 0.7, 0.55 + (k % 3) * 0.25) : onboard(time, (k - 1) / 2));
    time = until;
  }
  if (clip.finish) {
    shots.push(line(clip, moment - lead));                     // through the gate, the last of it in slow motion
    shots.push(flyby(clip, moment, end, 1, 3.2, 0.5, 0.45));   // at the line: full speed again, and away
  } else {
    shots.push(flyby(clip, moment - lead, end, 1, 3.0, 1.4, 0.5));      // (a speed camera: about where the camera on its pole sees it from)
  }
  return shots;
}

// FLYBY: a tripod beside the road where the car will be part-way through the shot (`where`: 0 = at
// its start, 1 = at its end), `out` metres to one side of its path, `up` metres off the ground.
// The head swings after the car, but only so fast - as it goes by, it leaves the picture.
function flyby(clip, from_, until, side, out, up, where = 0.5) {
  const there = heroAt(clip, lerp(from_, until, where)), at = from(there, out * side, up, 0);
  let bearing = 0, tilt = 0, shake = 0;
  const toward = (hero) => [Math.atan2(hero.x - at[0], hero.z - at[2]), Math.atan2(hero.y + 0.5 - at[1], Math.hypot(hero.x - at[0], hero.z - at[2]))];
  return {
    from: from_,
    begin(hero) { [bearing, tilt] = toward(hero); shake = 0; },
    aim(hero, camera, time, dt, speed) {
      const [wantBearing, wantTilt] = toward(hero), distance = Math.hypot(hero.x - at[0], hero.z - at[2]);
      const off = Math.atan2(Math.sin(wantBearing - bearing), Math.cos(wantBearing - bearing));
      bearing += off * (1 - Math.exp(-dt * 7));                                // quick, but not quick enough for a car a few metres away
      tilt = damp(tilt, wantTilt, 7, dt);
      // The ground shakes as it goes by.
      const near = clamp(1 - distance / 14, 0, 1) * clamp(speed / 45, 0, 1);
      shake = Math.max(shake * Math.exp(-dt * 5), near);
      const jx = (noise1(time * 38) - 0.5) * 0.09 * shake, jy = (noise1(time * 38 + 9) - 0.5) * 0.07 * shake;
      point(camera, [at[0] + jx, at[1] + jy, at[2]], [at[0] + Math.sin(bearing) * Math.cos(tilt) * 10, at[1] + Math.sin(tilt) * 10 + jy, at[2] + Math.cos(bearing) * Math.cos(tilt) * 10],
        clamp((2 * Math.atan(7 / Math.max(distance, 6)) * 180) / Math.PI, 26, 62));      // long lens while it is far off, wide as it arrives
      return near;
    },
  };
}

// ONBOARD: fixed to the car, low and wide, so the road pours past.  [right, up, ahead, look right, look up, look ahead, lens]
const MOUNTS = [
  [1.25, 0.34, -1.5, 0.9, 0.5, 14, 74],        // by the rear wheel, looking forward along the flank
  [-0.5, 0.42, 4.6, 0, 0.55, 0, 56],           // out in front of the nose, looking back at the car
  [-0.7, 0.8, -4.8, 0, 0.6, 12, 70],           // low behind it
];
function onboard(from_, number) {
  const [right, up, ahead, lookRight, lookUp, lookAhead, fov] = MOUNTS[number % MOUNTS.length];
  return {
    from: from_,
    aim(hero, camera, time, dt, speed) {
      const buzz = clamp(speed / 60, 0, 1) * 0.025;
      const at = from(hero, right + (noise1(time * 31) - 0.5) * buzz, up + (noise1(time * 31 + 5) - 0.5) * buzz, ahead);
      point(camera, at, from(hero, lookRight, lookUp, lookAhead), fov);
      return clamp(speed / 55, 0, 1) * 0.8;
    },
  };
}

// LINE: beyond the finish gate, low, a little to one side of the car's path, looking back at the gate
// and the car coming through it. It stands where the car itself was a moment after the line (so it is
// on the road, whatever the road does there), and its lens is wide enough to hold the whole gate.
function line(clip, from_) {
  const gate = heroAt(clip, clip.moment), speed = Math.max(15, frameAt(clip, clip.moment).speed);
  const at = from(heroAt(clip, clip.moment + 26 / speed), -1.8, 0.45, 0);
  return {
    from: from_,
    aim(hero, camera) {
      // Half way between the middle of the gate and the car: both stay in the picture.
      point(camera, at, [(gate.x + hero.x) / 2, (gate.y + 2.2 + hero.y + 0.7) / 2, (gate.z + hero.z) / 2], 34);
      return 0.2;
    },
  };
}
