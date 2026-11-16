// ---------------------------------------------------------------------------
// director.js — plays a SCENE: a few seconds in which the game takes the camera
// (and sometimes the car) out of the player's hands to show something - driving
// into the garage, a Blacklist driver turning up, the opening of the game.
//
// A scene is a list of SHOTS, played one after the other:
//
//   { seconds,                       how long the shot lasts
//     camera(t) -> { at: [x, y, z], look: [x, y, z], fov }
//                                    where the camera is and what it looks at; t runs 0 -> 1 over the shot
//     enter()                        (optional) called once when the shot begins
//     update(t, dt)                  (optional) called every frame: move a car, raise a door...
//     leave()                        (optional) called once when the shot ends
//   }
//
//   director.play(shots, { onEnd, skippable })
//
// THE RULES THAT KEEP THE GAME IN ONE PIECE
//   * While a scene plays, main.js runs no driving: the shots move whatever needs moving.
//   * A scene can be SKIPPED (Space, Enter or Esc). Skipping does not just stop: every
//     shot still to come is entered, taken straight to its last moment (update(1, 0)) and
//     left - so a door that was going to end up open IS open, and a car that was going to
//     end up inside IS inside. Then onEnd() runs, exactly as if the scene had played out.
//   * onEnd() is where the game says what happens next (open the garage, start the
//     countdown, hand the car back to the player). It is called once, always.
// The black bars at the top and bottom and the "skip" hint are drawn here too;
// director.fade() darkens the whole picture for a cut between two places,
// director.caption() and director.big() put words over it.
// ---------------------------------------------------------------------------
export function createDirector() {
  // ---- What is put on the screen (made here: it belongs to nothing else) -----------------
  const layer = document.createElement('div');
  layer.id = 'cinema';
  layer.innerHTML = '<div class="bar top"></div><div class="bar bottom"><span id="cinema-skip">SPACE · SKIP</span></div><div id="cinema-title"></div><div id="cinema-count"></div><div id="cinema-fade"></div>';
  document.body.append(layer);
  const fadeLayer = layer.querySelector('#cinema-fade'), title = layer.querySelector('#cinema-title'), count = layer.querySelector('#cinema-count');

  let scene = null;                          // { shots, index, time, onEnd, skippable } while one is playing

  function begin(index) {
    scene.index = index; scene.time = 0;
    scene.shots[index].enter?.();
  }
  function finish() {
    const done = scene;
    scene = null;
    layer.classList.remove('on');
    title.classList.remove('on'); count.classList.remove('on');
    done.onEnd?.();
  }

  const director = {
    get playing() { return Boolean(scene); },
    play(shots, { onEnd, skippable = true } = {}) {
      scene = { shots, onEnd, skippable };
      layer.classList.add('on');
      layer.querySelector('#cinema-skip').style.visibility = skippable ? 'visible' : 'hidden';
      begin(0);
    },
    // Jump to the end of the scene (see the rules above).
    skip() {
      if (!scene || !scene.skippable) return;
      const { shots } = scene;
      shots[scene.index].update?.(1, 0); shots[scene.index].leave?.();
      for (let k = scene.index + 1; k < shots.length; k++) { shots[k].enter?.(); shots[k].update?.(1, 0); shots[k].leave?.(); }
      finish();
    },
    /** Call every frame while a scene is playing: moves the shot on and aims the camera. */
    update(dt, camera) {
      if (!scene) return;
      const shot = scene.shots[scene.index];
      scene.time += dt;
      const t = Math.min(1, scene.time / shot.seconds);
      shot.update?.(t, dt);
      const view = shot.camera(t);
      camera.position.set(...view.at);
      camera.up.set(0, 1, 0);
      camera.lookAt(...view.look);
      camera.fov = view.fov ?? 45;
      camera.updateProjectionMatrix();
      if (t < 1) return;
      shot.leave?.();
      if (!scene) return;                                        // (a shot's leave() may itself have ended the scene)
      if (scene.index + 1 < scene.shots.length) begin(scene.index + 1); else finish();
    },
    // Just the black bars (and the skip hint), with no scene: a replay uses them (game/replay.js).
    bars(on) { layer.classList.toggle('on', on); layer.querySelector('#cinema-skip').style.visibility = 'visible'; },
    // Darken the whole picture (amount 1 = black) over so many seconds - for a cut between two places.
    fade(amount, seconds = 0.4) {
      fadeLayer.style.transition = `opacity ${seconds}s linear`;
      fadeLayer.style.opacity = amount;
    },
    // One big word in the middle of the picture (the 3, 2, 1 of a rolling start). '' takes it away.
    big(text, color = '#ffd166') {
      count.textContent = text; count.style.color = color;
      count.classList.remove('on');
      if (text) { void count.offsetWidth; count.classList.add('on'); }          // (reading its size starts the pop-in again)
    },
    // Words over the picture during a scene (a driver's name, the game's title). '' takes them away.
    caption(big, small = '') {
      title.innerHTML = '';
      if (!big) { title.classList.remove('on'); return; }
      title.append(big);
      if (small) { const line = document.createElement('small'); line.textContent = small; title.append(line); }
      title.classList.add('on');
    },
  };
  return director;
}

// ---- Helpers for writing shots -----------------------------------------------------------
// Smooth start and stop: 0 -> 1 with no jerk at either end.
export const ease = (t) => t * t * (3 - 2 * t);
// A point given in a car's own directions: `right` metres to its right, `up` above the ground
// under it, `ahead` in front of it. car = anything with x, y, z, yaw (the player's vehicle, an AI car).
export function beside(car, right, up, ahead) {
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
  return [car.x + rx * right + fx * ahead, car.y + up, car.z + rz * right + fz * ahead];
}
// The point part of the way from a to b (both [x, y, z]).
export const between = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
