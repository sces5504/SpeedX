// ---------------------------------------------------------------------------
// audio.js — all sound. Two kinds of source:
//   * RECORDINGS cut from real cars and weather (public/audio/, made by
//     tools/build-audio.py): engine loops, pass-by whooshes, rain, crashes
//   * SYNTHESISED noise and tones for things that must follow the car exactly:
//     wind, tyre roar, skids, scraping, horn, turbo whistle
//
// ENGINES. Four recorded loops (idle / low / mid / high revs) play all the time. Each is sped
// up or slowed down to match the current RPM and only the one or two nearest that RPM are
// heard. That signal is then split in two:
//   BASE     the engine itself: steady, slightly dull, always there. Follows RPM only, so
//            when you lift off you still hear the revs fall.
//   EXHAUST  the roar: distorted, bright and loud. Follows the THROTTLE (its "load"), swells
//            the instant you press, eases away when you lift, and drops out for a moment
//            during a gear change before slamming back in.
// On top, each triggered by its own rule (see updateExtras):
//   turbo         whistle follows built-up BOOST; one blow-off when you lift with boost up
//   supercharger  a whine whose pitch follows RPM and loudness follows load (only if fitted)
//   backfire      an occasional single pop when lifting at high revs or on a flat-out upshift
// A car's "sound" in car.json picks a profile below. Add a profile to give a car a new voice.
//
// The mix is "cinematic": everything outside the car runs through a long
// canyon echo, the cabin muffles the outside world, and a big crash drops the
// whole mix under water with ringing ears.
// ---------------------------------------------------------------------------
import { clamp, lerp } from '../core/mathUtils.js';

// pitch   >1 = higher, smaller-sounding engine         tone   how bright the exhaust is at full throttle (Hz)
// drive   how hard the exhaust is distorted (rasp)     buzz   amount of added harmonic "brap", on harmonic `order`
// turbo   whistle + blow-off amount (0 = no turbo)     supercharger  whine amount (0 = not fitted)
// backfire  [chance when lifting at high revs, chance on a full-throttle upshift]
// low     which recording fills the low-rev slot (default 'engine_low')
export const ENGINE_PROFILES = {
  turbo4: { pitch: 1.00, tone: 3000, drive: 1.6, buzz: 0.10, order: 1.0, turbo: 1.0, supercharger: 0, backfire: [0.5, 0.3], volume: 1.0 },    // SR20DET
  na4:    { pitch: 1.12, tone: 4200, drive: 1.2, buzz: 0.22, order: 2.0, turbo: 0.0, supercharger: 0, backfire: [0.15, 0.05], volume: 0.95 }, // 4A-GE: revvy, induction rasp
  rotary: { pitch: 1.45, tone: 5600, drive: 2.4, buzz: 0.45, order: 1.5, turbo: 0.7, supercharger: 0, backfire: [0.7, 0.45], volume: 0.95 },  // 13B: high buzz, spits flames
  race4:  { pitch: 0.90, tone: 3600, drive: 2.8, buzz: 0.30, order: 1.0, turbo: 0.0, supercharger: 0, backfire: [0.35, 0.2], volume: 1.05, low: 'race_low' },  // big-bore 16-valve bark
  default: { pitch: 1.05, tone: 3000, drive: 1.4, buzz: 0.12, order: 1.0, turbo: 0.0, supercharger: 0, backfire: [0.1, 0.05], volume: 0.9 },
};
const IMPACT_LEVEL = 0.63;      // -4 dB, as asked for the real impact recordings
const PASS_LEVEL = 0.4;         // pass-by whooshes sit well under your own engine
const ENGINE_LEVEL = 1.9;       // your engine is the star of the mix
const BASE_LEVEL = 0.30;        // the always-there engine bed, relative to the full exhaust roar
// Four "slots" share the rev range; each plays one recording. `centre` = the rpm where that
// slot is at full volume. The LOW slot has two candidate recordings: a profile picks one with
// `low:` (e.g. the race engine's lumpy burble instead of the road car's smooth coasting sound).
const ENGINE_LAYERS = [
  { slot: 'idle', clip: 'engine_idle', centre: 900 }, { slot: 'low', clip: 'engine_low', centre: 2600 },
  { slot: 'low', clip: 'race_low', centre: 2600 }, { slot: 'mid', clip: 'engine_mid', centre: 5000 },
  { slot: 'high', clip: 'engine_high', centre: 6800 },
];
const SLOT_CENTRES = { idle: 900, low: 2600, mid: 5000, high: 6800 }, SLOTS = ['idle', 'low', 'mid', 'high'];

export function createAudio() {
  const audio = { ready: false, start, update() {}, impact() {}, crash() {}, passBy() {}, beep() {}, hornAt() {}, shift() {}, play() {}, setPaused() {}, clips: {} };
  let lastUpdate = 0;
  let ctx, master, muffle, outside, cabinFilter, echo, noiseBuffer, probe, probeData, lastCheck = 0, profileName = 'default';
  const buffers = {};                 // decoded recordings (kept if the sound system has to restart)

  // Browsers only allow sound after a click/key press, so this is called from the menu.
  async function start(name) {
    profileName = name || profileName;
    if (ctx) { setProfile(playerEngine, profileName); ctx.resume(); return; }
    // Load every recording listed in clips.json (only once).
    const Context = window.AudioContext || window.webkitAudioContext;
    ctx = new Context();
    if (!Object.keys(buffers).length) {
      audio.clips = await (await fetch('audio/clips.json')).json();
      await Promise.all(Object.entries(audio.clips).map(async ([clipName, clip]) => {
        const bytes = await (await fetch('audio/' + clip.file)).arrayBuffer();
        buffers[clipName] = await ctx.decodeAudioData(bytes);
      }));
    }
    wire();
  }

  // Build the whole chain of sound nodes on the current audio context.
  function wire() {
    lastCheck = 0; lastUpdate = 0;              // a new context's clock starts from zero
    master = ctx.createGain(); master.gain.value = 0.9;
    muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;   // closes after a crash
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16; limiter.ratio.value = 5; limiter.attack.value = 0.004; limiter.release.value = 0.25;
    probe = ctx.createAnalyser(); probe.fftSize = 256; probeData = new Float32Array(probe.fftSize);
    master.connect(muffle).connect(limiter).connect(probe).connect(ctx.destination);

    // "outside" bus: everything that is not inside the cabin. Muffled in cockpit view, and echoes off the canyon.
    cabinFilter = ctx.createBiquadFilter(); cabinFilter.type = 'lowpass'; cabinFilter.frequency.value = 20000;
    outside = ctx.createGain();
    outside.connect(cabinFilter).connect(master);
    echo = ctx.createConvolver(); echo.buffer = makeEchoImpulse(2.6);
    const echoGain = ctx.createGain(); echoGain.gain.value = 0.22;
    outside.connect(echo).connect(echoGain).connect(master);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    build();
    setProfile(playerEngine, profileName);
    audio.ready = true;
  }

  // SAFETY NET for "the sound just stopped":
  //  1. Browsers put audio to sleep when the tab is hidden or the output device changes -> wake it.
  //  2. One bad number (NaN) inside a filter silences everything after it, for good. Once a second
  //     we listen to the final output; if it has gone bad, the whole sound system is rebuilt.
  const wake = () => { if (ctx && ctx.state !== 'running') ctx.resume(); };
  for (const event of ['visibilitychange', 'focus', 'keydown', 'mousedown']) window.addEventListener(event, wake);
  // How loud the final output is right now (0 = silence). Handy for hunting drop-outs:
  // type  speedx.audio.level()  in the browser console.
  audio.level = () => {
    if (!audio.ready) return 0;
    probe.getFloatTimeDomainData(probeData);
    let sum = 0;
    for (const sample of probeData) sum += sample * sample;
    return Math.sqrt(sum / probeData.length);
  };
  audio.contextState = () => (ctx ? ctx.state : 'none');
  // A diary of anything odd, kept in the browser so it survives a reload.
  // Read it in the console with  speedx.audio.log()
  const note = (text) => {
    const line = `${new Date().toLocaleTimeString()}  ${text}`;
    console.warn('[audio] ' + text);
    try { const kept = JSON.parse(localStorage.getItem('speedx-audio-log') || '[]'); kept.push(line); localStorage.setItem('speedx-audio-log', JSON.stringify(kept.slice(-40))); } catch { /* storage full or blocked: ignore */ }
  };
  audio.log = () => JSON.parse(localStorage.getItem('speedx-audio-log') || '[]');
  let silentFor = 0, lastState = '';
  function restart(reason) {
    note(`restarting the sound system (${reason})`);
    audio.ready = false;
    audio.restarts = (audio.restarts || 0) + 1;
    ctx.close();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    wire();
    ctx.resume();
  }
  // Called every frame. `shouldBeLoud` = the engine is running with the throttle open.
  function healthCheck(shouldBeLoud) {
    if (ctx.state !== lastState) { if (lastState) note(`audio context went from "${lastState}" to "${ctx.state}"`); lastState = ctx.state; }
    wake();                                     // (a sleeping context's clock stands still, so this must come first)
    if (ctx.currentTime - lastCheck < 0.25) return;
    const elapsed = ctx.currentTime - lastCheck;
    lastCheck = ctx.currentTime;
    probe.getFloatTimeDomainData(probeData);
    if (probeData.some((sample) => !Number.isFinite(sample))) return restart('the output contained an invalid number');
    // The output is silent although the engine should be roaring: something upstream died
    // without producing an invalid number. Give it 0.75 s, then rebuild.
    silentFor = shouldBeLoud && ctx.state === 'running' && audio.level() < 0.002 ? silentFor + elapsed : 0;
    if (silentFor > 0.75) { silentFor = 0; restart('silent while the engine should be loud'); }
  }

  // A long, dark tail: sound bouncing around a mountain valley.
  function makeEchoImpulse(seconds) {
    const length = ctx.sampleRate * seconds, impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        smooth += ((Math.random() * 2 - 1) - smooth) * 0.25;                 // darker than white noise
        d[i] = smooth * Math.pow(1 - t, 2.4) * (i < 2200 ? i / 2200 : 1);
      }
    }
    return impulse;
  }

  // ---- building blocks -----------------------------------------------------
  const gainNode = (value, destination) => { const g = ctx.createGain(); g.gain.value = value; g.connect(destination); return g; };
  const filterNode = (type, frequency, q, destination) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = q; f.connect(destination); return f;
  };
  // Smoothly move a setting. A bad number (NaN) is ignored instead of being passed on.
  const set = (param, value, smooth = 0.05) => { if (Number.isFinite(value)) param.setTargetAtTime(value, ctx.currentTime, smooth); };
  const loopSource = (buffer, destination) => {
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(destination);
    src.start(0, Math.random() * buffer.duration); return src;
  };
  // A looping filtered-noise voice: noise -> filter -> volume.
  const noiseVoice = (type, frequency, q, destination) => {
    const gain = gainNode(0, destination), filter = filterNode(type, frequency, q, gain);
    loopSource(noiseBuffer, filter);
    return { gain, filter };
  };
  // A looping recording: buffer -> volume.
  const clipVoice = (name, destination) => { const gain = gainNode(0, destination); return { gain, source: loopSource(buffers[name], gain) }; };

  // ---- engines -----------------------------------------------------------------
  function makeEngine(destination) {
    const out = gainNode(0, destination);
    const pan = ctx.createStereoPanner(); pan.connect(out);
    const loops = ctx.createGain();                                  // the blended loops, before the split
    // BASE: the loops, gently dulled, at a steady level
    const baseGain = gainNode(BASE_LEVEL, pan), baseTone = filterNode('lowpass', 1400, 0.5, baseGain);
    loops.connect(baseTone);
    // EXHAUST: the loops pushed into distortion, through a filter that opens with load
    const exhaustGain = gainNode(0, pan), tone = filterNode('lowpass', 1200, 0.7, exhaustGain);
    const shaper = ctx.createWaveShaper(); shaper.oversample = '2x'; shaper.connect(tone);
    const push = gainNode(0.5, shaper);
    loops.connect(push);
    const layers = ENGINE_LAYERS.map((layer) => {
      const gain = gainNode(0, loops);
      return { ...layer, gain, source: loopSource(buffers[layer.clip], gain), recordedRpm: audio.clips[layer.clip].rpm };
    });
    // the added harmonic buzz lives in the exhaust
    const buzzGain = gainNode(0, push), buzzFilter = filterNode('bandpass', 400, 1.5, buzzGain);
    const buzz = ctx.createOscillator(); buzz.type = 'sawtooth'; buzz.connect(buzzFilter); buzz.start();
    return { out, pan, baseTone, baseGain, exhaustGain, tone, shaper, push, layers, buzz, buzzGain, buzzFilter,
      profile: ENGINE_PROFILES.default, load: 0, boost: 0, wasShifting: false };
  }
  function setProfile(engine, name) {
    if (!engine) return;
    engine.profile = ENGINE_PROFILES[name] || ENGINE_PROFILES.default;
    const curve = new Float32Array(512), k = engine.profile.drive;
    for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
    engine.shaper.curve = curve;
  }
  /**
   * @param rpm       real engine speed: sets pitch and which loops are heard
   * @param throttle  0..1 pedal
   * @param shifting  true while a gear change is in progress (power is cut)
   * @param volume    overall level of this engine (0 = switched off)
   */
  function driveEngine(engine, { rpm, throttle, shifting = false, volume, dt = 1 / 60 }) {
    const p = engine.profile;
    for (const layer of engine.layers) {
      // Blend: full volume at its own rpm, silent at its neighbours'. The square root keeps
      // the TOTAL loudness level through a cross-fade (a straight blend dips in the middle).
      const k = SLOTS.indexOf(layer.slot), centre = SLOT_CENTRES[layer.slot];
      const below = k > 0 ? SLOT_CENTRES[SLOTS[k - 1]] : centre - 1500;
      const above = k < SLOTS.length - 1 ? SLOT_CENTRES[SLOTS[k + 1]] : centre + 4000;
      let weight = rpm < centre ? (rpm - below) / (centre - below) : (above - rpm) / (above - centre);
      if (k === 0 && rpm < centre) weight = 1;
      if (k === SLOTS.length - 1 && rpm > centre) weight = 1;
      if (layer.slot === 'low' && layer.clip !== (p.low || 'engine_low')) weight = 0;   // the other car's low-rev recording
      set(layer.gain.gain, Math.sqrt(clamp(weight, 0, 1)), 0.04);
      set(layer.source.playbackRate, clamp((rpm * p.pitch) / layer.recordedRpm, 0.3, 3.2), 0.03);
    }
    // LOAD = how much the exhaust is working. Up almost at once when you press (40 ms), away
    // smoothly when you lift (0.35 s), and dumped during a gear change so you hear the
    // drive let go and bite again.
    const wanted = shifting ? throttle * 0.08 : throttle;
    const rate = wanted > engine.load ? 1 / 0.04 : shifting ? 1 / 0.03 : 1 / 0.35;
    engine.load += (wanted - engine.load) * Math.min(1, dt * rate);
    const load = engine.load, revs = clamp(rpm / 8000, 0, 1.2);
    const firing = rpm / 30;                                   // 4-cylinder / 2-rotor: two bangs per turn
    set(engine.buzz.frequency, firing * p.order, 0.03);
    set(engine.buzzFilter.frequency, firing * p.order * 2.2);
    set(engine.buzzGain.gain, p.buzz * load * 1.2 * clamp(rpm / 6000, 0.1, 1.2), 0.03);
    // Base: always there, a little louder and brighter with revs. Never touched by the pedal.
    set(engine.baseTone.frequency, 900 + rpm * 0.28);
    set(engine.baseGain.gain, BASE_LEVEL * (0.7 + revs * 0.5));
    // Exhaust: thickness (push), brightness (tone) and volume all come from load.
    set(engine.push.gain, 0.4 + load * 1.5, 0.02);
    set(engine.tone.frequency, 600 + load * (p.tone * 1.4) + rpm * 0.2, 0.02);
    set(engine.exhaustGain.gain, load * (0.85 + revs * 0.25), 0.02);
    set(engine.out.gain, volume * p.volume, volume === 0 ? 0.25 : 0.05);
  }

  let playerEngine, rivalEngine, turbo, charger, wind, roll, skid, gravel, scrape, grind, horn, rain, wipers, wetRoad, ring, lastPass = '';
  function build() {
    playerEngine = makeEngine(master);
    rivalEngine = makeEngine(outside);
    turbo = noiseVoice('bandpass', 5000, 5, master);
    // supercharger whine: a recorded Hellcat blower (only audible on cars whose profile has supercharger > 0)
    charger = clipVoice('supercharger', master);
    wind = noiseVoice('bandpass', 500, 0.4, outside);
    roll = noiseVoice('lowpass', 300, 0.7, master);
    skid = noiseVoice('bandpass', 1300, 5, outside);
    gravel = noiseVoice('bandpass', 420, 0.8, master);
    // Scraping metal: a harsh high band plus a lower grinding band, both chopped ~40 times a
    // second ("chatter") so it sounds like a panel dragging, not like hiss.
    scrape = noiseVoice('bandpass', 2600, 3, outside);
    grind = noiseVoice('bandpass', 850, 5, outside);
    const chatter = ctx.createOscillator(); chatter.type = 'sawtooth'; chatter.frequency.value = 41;
    const chop = ctx.createGain(); chop.gain.value = 0;
    chatter.connect(chop); chop.connect(scrape.gain.gain); chop.connect(grind.gain.gain);
    scrape.chop = chop; chatter.start();
    rain = clipVoice('rain_cabin', master);
    wipers = clipVoice('rain_wipers', master);
    wetRoad = clipVoice('road_wet', master);
    const hornGain = gainNode(0, outside), hornFilter = filterNode('lowpass', 2400, 0.8, hornGain);
    horn = { gain: hornGain, oscs: [415, 522].map((f) => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hornFilter); o.start(); return o; }) };
    // ringing ears after a crash
    const ringGain = ctx.createGain(); ringGain.gain.value = 0; ringGain.connect(ctx.destination);
    const ringOsc = ctx.createOscillator(); ringOsc.frequency.value = 3350; ringOsc.connect(ringGain); ringOsc.start();
    ring = ringGain;
  }

  /**
   * Call every frame.
   * state: { rpm, throttle, speed, slip 0..1, wheelSpin, onGravel, wet 0..1, rain 0..1, inside bool,
   *          scrape (m/s along a wall), horn bool, trauma 0..1 (crash daze), engineOff bool,
 *          shifting bool (gear change in progress), redline (rpm),
   *          rival: { distance, side -1..1, rpm, throttle, sound } | null }
   */
  audio.update = (state) => {
    if (!audio.ready) return;
    healthCheck(state.throttle > 0.5 && !state.engineOff && state.trauma < 0.05);
    if (!audio.ready) return;
    const speed = Math.abs(state.speed), inside = state.inside ? 1 : 0;
    // engineOff: after idling at a standstill the engine is switched off - silence, not a drone.
    const dt = Math.min(0.1, Math.max(0.001, ctx.currentTime - lastUpdate)); lastUpdate = ctx.currentTime;
    const shifting = !!state.shifting;
    driveEngine(playerEngine, { rpm: state.rpm, throttle: state.throttle, shifting, dt, volume: state.engineOff ? 0 : lerp(0.8, 0.95, inside) * ENGINE_LEVEL });
    updateExtras(playerEngine, state, shifting, dt);

    // Wind is what really sells speed: it rises with the SQUARE of speed and gets shriller.
    // Cockpit: rises with the square of speed. Chase view: stays low for normal driving and
    // only builds to the same roar when you are going very fast (~290 km/h).
    const windCockpit = clamp((speed / 50) ** 2, 0, 1.6) * 0.34, windChase = clamp(speed / 80, 0, 1) ** 3 * 0.8;
    set(wind.gain.gain, inside ? windCockpit : windChase);
    set(wind.filter.frequency, 300 + speed * 22);
    set(roll.gain.gain, clamp(speed / 40, 0, 1.2) * 0.34);
    set(roll.filter.frequency, 140 + speed * 11);
    set(wetRoad.gain.gain, state.wet * clamp(speed / 30, 0, 1) * 0.5, 0.2);
    set(wetRoad.source.playbackRate, 0.7 + clamp(speed / 50, 0, 1) * 0.7, 0.2);
    const squeal = Math.max(state.slip, clamp(state.wheelSpin, 0, 1) * 0.8);
    set(skid.gain.gain, squeal * lerp(0.22, 0.06, state.wet) * (state.onGravel ? 0 : 1), 0.04);
    set(skid.filter.frequency, 1000 + squeal * 500 + speed * 4);
    set(gravel.gain.gain, state.onGravel ? clamp(speed / 20, 0, 1) * 0.35 : 0);
    const scraping = clamp(state.scrape / 22, 0, 1);
    set(scrape.gain.gain, scraping * 0.26, 0.03);
    set(grind.gain.gain, scraping * 0.34, 0.03);
    set(scrape.chop.gain, scraping * 0.16, 0.03);
    set(scrape.filter.frequency, 1900 + state.scrape * 45);
    set(grind.filter.frequency, 600 + state.scrape * 18);
    set(horn.gain.gain, state.horn ? 0.2 : 0, 0.015);
    // Rain: on the roof in the cabin (with the wipers thumping), a wash of hiss outside.
    set(rain.gain.gain, state.rain * lerp(0.5, 0.25, inside), 0.4);
    set(wipers.gain.gain, state.rain * inside * 0.75, 0.4);
    // In the cabin the outside world is dull; after a crash everything is under water.
    set(cabinFilter.frequency, inside ? 1900 : 20000, 0.15);
    // (Once the daze is over the filter is opened fully again, so nothing stays dull.)
    set(muffle.frequency, state.trauma > 0.01 ? lerp(20000, 320, clamp(state.trauma * 1.4, 0, 1) ** 0.5) : 20000, 0.08);
    set(ring.gain, state.trauma * state.trauma * 0.05, 0.1);

    if (state.rival) {
      if (rivalEngine.profile !== (ENGINE_PROFILES[state.rival.sound] || ENGINE_PROFILES.default)) setProfile(rivalEngine, state.rival.sound);
      const near = 1 / (1 + (state.rival.distance / 12) ** 2);
      driveEngine(rivalEngine, { rpm: state.rival.rpm, throttle: state.rival.throttle, dt, volume: near * 1.5 });
      set(rivalEngine.pan.pan, clamp(state.rival.side, -0.9, 0.9), 0.1);
    } else set(rivalEngine.out.gain, 0, 0.2);
  };

  // ---- one-shot sounds -------------------------------------------------------------
  // Play a recording once. options: volume, rate (speed/pitch), pan -1..1, offset (seconds to skip),
  // delay (seconds from now), fadeIn / fadeOut (seconds; fadeOut starts at `hold` seconds after it begins)
  audio.play = (name, { volume = 1, rate = 1, pan = 0, offset = 0, delay = 0, fadeIn = 0, hold = 0, fadeOut = 0, outsideBus = true } = {}) => {
    if (!audio.ready || !buffers[name]) return;
    const start = ctx.currentTime + Math.max(0, delay);
    const src = ctx.createBufferSource(); src.buffer = buffers[name]; src.playbackRate.value = rate;
    const gain = ctx.createGain();
    if (fadeIn > 0) { gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), start + fadeIn); } else gain.gain.setValueAtTime(volume, start);
    if (fadeOut > 0) { gain.gain.setValueAtTime(Math.max(volume, 0.0002), start + Math.max(fadeIn, hold)); gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(fadeIn, hold) + fadeOut); }
    const panner = ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
    src.connect(gain).connect(panner).connect(outsideBus ? outside : master);
    src.start(start, clamp(offset, 0, buffers[name].duration - 0.05));
  };
  // A burst of noise that fades out: thuds and hisses.
  function burst({ type, from, to = from, q = 1, volume, attack = 0.005, length }) {
    const now = ctx.currentTime;
    const gain = gainNode(0, master), filter = filterNode(type, from, q, gain), source = ctx.createBufferSource();
    source.buffer = noiseBuffer; source.connect(filter);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + length);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    source.start(now, Math.random()); source.stop(now + length + 0.05);
  }

  /**
   * Any contact: one real recorded car impact, played quieter and a little higher for a tap,
   * louder and deeper for a hard hit (no synthesised drums or tones). A tiny click of noise
   * marks the first touch on very light scrapes.   strength 0..1, pan = which side.
   */
  audio.impact = (strength, pan = 0) => {
    if (!audio.ready) return;
    const s = clamp(strength, 0.03, 1);
    const variation = 0.93 + Math.random() * 0.14;                       // never exactly the same twice
    audio.play('impact', { volume: (0.16 + s * 0.6) * IMPACT_LEVEL, rate: lerp(1.25, 0.85, s) * variation, pan, outsideBus: false });
    if (s < 0.25) burst({ type: 'highpass', from: 2600, volume: 0.08 + s * 0.3, attack: 0.001, length: 0.03 });
    if (s > 0.7) burst({ type: 'highpass', from: 5200, to: 2600, volume: (s - 0.6) * 0.35, attack: 0.04, length: 0.8 });   // debris
  };
  // A knock-out crash: the full recorded crash.
  audio.crash = (strength) => audio.play('crash', { volume: (0.6 + strength * 0.4) * IMPACT_LEVEL, rate: 0.92, outsideBus: false });

  /**
   * A car going past. Call it BEFORE the cars meet: the loudest moment is lined up with the
   * moment they are closest. No two passes sound the same: the recording is chosen by speed
   * (and never the same twice running), its pitch depends on the size of the vehicle, and
   * synthesised layers are added on top - a rush of air for speed, a diesel rumble for trucks,
   * a hiss of spray in the wet.
   * @param vehicle 'small' | 'car' | 'big' | 'truck' | 'rival'
   */
  audio.passBy = ({ vehicle, timeToClosest, closingSpeed, pan, closeness, wet, inside }) => {
    if (!audio.ready) return;
    let options = closingSpeed > 45 ? ['fast', 'cabin'] : closingSpeed > 24 ? ['fast', 'highway', 'cabin'] : ['highway', 'fast'];
    if (vehicle === 'rival') options = ['race', 'fast'];
    else if (wet) options = ['wet', 'highway'];
    else if (!inside) options = options.filter((o) => o !== 'cabin').concat('highway');
    const choices = options.filter((o) => o !== lastPass);
    const kind = lastPass = choices[Math.floor(Math.random() * choices.length)] || options[0];
    const clip = audio.clips['pass_' + kind];
    const size = { small: 1.14, car: 1.0, big: 0.86, truck: 0.7, rival: 1.05 }[vehicle] || 1;
    const rate = clamp((0.78 + closingSpeed / 105) * size * (0.94 + Math.random() * 0.12), 0.55, 1.6);
    const volume = clamp(0.3 + closeness * 0.7, 0, 1) * (vehicle === 'truck' ? 1.15 : 1) * PASS_LEVEL;
    // Line the recording's loudest moment up with the closest point. If we are told early, the
    // sound simply starts later; either way it swells in and dies away - it never just appears.
    const lead = clip.peak / rate;                                         // seconds of recording before its peak
    const delay = Math.max(0, timeToClosest - lead), offset = Math.max(0, (lead - timeToClosest) * rate);
    const rise = Math.max(0.35, timeToClosest - delay);
    audio.play('pass_' + kind, { volume, rate, pan, offset, delay, fadeIn: rise, hold: rise + 0.15, fadeOut: 1.6 });

    // Synthesised layers, timed to peak exactly at the closest point.
    const at = ctx.currentTime + timeToClosest, speed01 = clamp(closingSpeed / 70, 0, 1);
    const swell = (type, f0, f1, f2, q, peak, rise, fall) => {
      const gain = ctx.createGain(), panner = ctx.createStereoPanner(), filter = filterNode(type, f0, q, gain), source = ctx.createBufferSource();
      gain.gain.value = 0; panner.pan.setValueAtTime(clamp(pan, -1, 1), ctx.currentTime); panner.pan.linearRampToValueAtTime(clamp(-pan * 0.6, -1, 1), at + fall);   // sweeps across you
      gain.connect(panner).connect(outside);
      source.buffer = noiseBuffer; source.connect(filter);
      const start = Math.max(ctx.currentTime, at - rise);
      filter.frequency.setValueAtTime(f0, start); filter.frequency.exponentialRampToValueAtTime(f1, at); filter.frequency.exponentialRampToValueAtTime(f2, at + fall);   // Doppler: up, then down
      gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(peak, at); gain.gain.exponentialRampToValueAtTime(0.0001, at + fall);
      source.start(start, Math.random()); source.stop(at + fall + 0.05);
    };
    swell('bandpass', 500, 900 + speed01 * 1800, 300, 0.9, (0.06 + speed01 * 0.3) * (0.4 + closeness * 0.6) * PASS_LEVEL, Math.min(timeToClosest, lerp(2.2, 1.2, speed01)), lerp(1.8, 1.0, speed01));   // rush of air
    if (vehicle === 'truck' || vehicle === 'big') swell('lowpass', 90, 150, 60, 1.2, (vehicle === 'truck' ? 0.7 : 0.35) * PASS_LEVEL, Math.min(timeToClosest, 2.4), 2.2);                                  // heavy engine rumble
    if (wet) swell('highpass', 3000, 5200, 2500, 0.5, (0.2 + speed01 * 0.25) * PASS_LEVEL, Math.min(timeToClosest, 1.5), 1.6);                                                                              // spray
  };
  audio.shift = () => audio.play('shift', { volume: 0.5, outsideBus: false });

  // Forced induction and backfire for the player's engine. Each has its OWN trigger:
  function updateExtras(engine, state, shifting, dt) {
    const p = engine.profile, load = engine.load, high = state.rpm > (state.redline || 7000) * 0.6;
    // TURBO: boost builds over ~0.8 s of load above 2800 rpm and bleeds away without it.
    // The whistle follows boost. Lifting with boost up fires ONE blow-off and empties the
    // boost, so it cannot fire again until the turbo has spooled up afresh.
    const spooling = p.turbo > 0 && state.throttle > 0.5 && !shifting && state.rpm > 2800;
    engine.boost = clamp(engine.boost + (spooling ? dt / 0.8 : -dt / 0.6), 0, 1);
    set(turbo.gain.gain, p.turbo * engine.boost * 0.04, 0.08);
    set(turbo.filter.frequency, 3200 + engine.boost * 2600 + state.rpm * 0.25);
    if (p.turbo > 0 && engine.boost > 0.45 && state.throttle < 0.2) {
      // a real turbo letting go (two takes of a Ferrari F40's wastegate, picked at random)
      audio.play(Math.random() < 0.5 ? 'blowoff1' : 'blowoff2', { volume: 0.55 * p.turbo * engine.boost, rate: 0.95 + Math.random() * 0.15, outsideBus: false });
      engine.boost = 0;
    }
    // SUPERCHARGER: pitch is locked to the engine, loudness to load.
    set(charger.source.playbackRate, clamp(state.rpm / audio.clips.supercharger.rpm, 0.35, 1.6), 0.03);
    set(charger.gain.gain, p.supercharger * load * 0.5, 0.05);
    // BACKFIRE: a single pop, sometimes, at two moments - coming off the throttle at high revs,
    // and at the start of a flat-out upshift.
    const lifted = engine.wasLoaded && state.throttle < 0.2, shiftStarted = shifting && !engine.wasShifting;
    if (high && lifted && Math.random() < p.backfire[0]) backfire(0.9);
    if (high && shiftStarted && state.throttle > 0.8 && Math.random() < p.backfire[1]) backfire(0.7);
    engine.wasLoaded = state.throttle > 0.7 || (engine.wasLoaded && state.throttle >= 0.2);
    engine.wasShifting = shifting;
  }
  // One recorded exhaust pop (five takes from an Audi R8; never the same one twice running).
  let lastPop = 0;
  function backfire(strength) {
    let pick = 1 + Math.floor(Math.random() * 5);
    if (pick === lastPop) pick = (pick % 5) + 1;
    lastPop = pick;
    audio.play('pop' + pick, { volume: (0.55 + Math.random() * 0.3) * strength, rate: 0.9 + Math.random() * 0.25 });
  }
  audio.beep = (frequency = 880, length = 0.12, volume = 0.12) => {
    if (!audio.ready) return;
    const now = ctx.currentTime, gain = gainNode(0, master), osc = ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = frequency; osc.connect(gain);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.start(now); osc.stop(now + length + 0.02);
  };
  // Another driver honking at you from `distance` metres away.
  audio.hornAt = (distance, pan = 0) => {
    if (!audio.ready) return;
    const now = ctx.currentTime, gain = ctx.createGain(), filter = filterNode('lowpass', 1800, 0.8, gain);
    const panner = ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
    gain.gain.value = 0; gain.connect(panner).connect(outside);
    const volume = 0.3 / (1 + distance / 25);
    for (const f of [370, 466]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(filter); o.start(now); o.stop(now + 0.9); }
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.setValueAtTime(volume, now + 0.7);
    gain.gain.linearRampToValueAtTime(0, now + 0.85);
  };
  audio.setPaused = (paused) => { if (audio.ready) set(master.gain, paused ? 0 : 0.9, 0.08); };
  return audio;
}
