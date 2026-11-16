// ---------------------------------------------------------------------------
// revTest.js — an engine being revved on the spot, so you can LISTEN to it:
// in the garage (your car, or an engine you are only trying) and on the
// catalogue page.
//
// Nothing is driven: the rpm is acted out here — up toward the red line while
// the throttle is held, bouncing on the limiter, back to idle when released —
// and handed to the game's own audio.update(), which makes the sound exactly
// as it does on the road: the turbo spools while you hold it, and letting go
// near the red line gives the blow-off and the crackle from the exhaust.
//
//   const rev = createRevTest();
//   rev.setEngine(spec.engine);          which engine (its idle and red line)
//   rev.running = true; rev.held = true; switch on / press the throttle
//   rev.step(dt, audio);                 every frame
// ---------------------------------------------------------------------------
export function createRevTest() {
  let idle = 900, redline = 7000;
  const rev = {
    rpm: 0,
    running: false,          // engine switched on
    held: false,             // throttle pressed
    cut: 0,                  // seconds of fuel cut left after touching the limiter
    get redline() { return redline; },
    setEngine(engine) { idle = engine.idle; redline = engine.redline; },
    /** @param audio the sound system (may be missing before the first click: the numbers still move) */
    step(dt, audio) {
      const sweep = redline - idle;
      if (!rev.running) rev.rpm = Math.max(0, rev.rpm - sweep * dt * 1.5);                     // switched off: the needle drops to zero
      else if (rev.cut > 0) { rev.cut -= dt; rev.rpm -= sweep * dt * 0.9; }                     // on the limiter: fuel cut for a moment
      else if (rev.held) { rev.rpm += (sweep * dt) / 1.1; if (rev.rpm >= redline) { rev.rpm = redline; rev.cut = 0.07; } }
      else rev.rpm = Math.max(idle, rev.rpm - (sweep * dt) / 1.6);
      // The same call main.js makes every frame, for a car standing still in dry weather.
      // (The throttle counts as held right through the limiter's fuel cuts: you hear the revs bounce,
      // but each bounce is not a "lift" - that would dump the boost and pop the exhaust ten times a second.)
      audio?.update({ rpm: Math.max(rev.rpm, idle * 0.5), throttle: rev.running && rev.held ? 1 : 0, speed: 0, slip: 0, wheelSpin: 0, onGravel: false,
        wet: 0, rain: 0, inside: false, scrape: 0, horn: false, trauma: 0, engineOff: !rev.running, shifting: false, redline, rival: null });
    },
  };
  return rev;
}
