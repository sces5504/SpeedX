// ---------------------------------------------------------------------------
// audio.js — all sound. Two kinds of source:
//   * RECORDINGS cut from real cars and weather (public/audio/, made by
//     tools/build-audio.py): engine loops, pass-by whooshes, rain, crashes
//   * SYNTHESISED noise and tones for things that must follow the car exactly:
//     wind, tyre roar, skids, scraping, horn, turbo whistle
//
// ENGINES. Four recorded loops (idle / low / mid / high revs) play all the time. Each is sped
// up or slowed down to match the current RPM and only the one or two nearest that RPM are
// heard. Which four recordings depends on the ENGINE: every kind of engine (four, straight six,
// V8, rotary...) has its own set, its VOICE (see VOICES below). That signal is then split in two:
//   BASE     the engine itself: steady, slightly dull, always there. Follows RPM only, so
//            when you lift off you still hear the revs fall.
//   EXHAUST  the roar: distorted, bright and loud. Follows the THROTTLE (its "load"), swells
//            the instant you press, eases away when you lift, and drops out for a moment
//            during a gear change before slamming back in.
// On top, each triggered by its own rule (see updateExtras):
//   turbo         whistle follows built-up BOOST; one blow-off when you lift with boost up
//   supercharger  a whine whose pitch follows RPM and loudness follows load
//   afterfire     a burst of crackles from the exhaust when you lift at high revs, and
//                 sometimes one bang on a flat-out upshift
// WHO DECIDES WHAT YOU HEAR
//   the engine   "sound" in content/engines.json names a profile below: the recordings (voice)
//                and how the exhaust is shaped. Swap the engine and the car sounds like the new
//                one; upgrade it and it keeps its voice.
//   the car      "soundBody" in car.json: a small colouring by the body it sits in (a resonance
//                and a brightness), so the same engine is slightly different in another car.
//   induction    the turbo whistle / blow-off or the supercharger whine plays when the engine
//                has one - from the factory or from a kit fitted in the garage.
//
// The mix is "cinematic": everything outside the car runs through a long
// canyon echo, the cabin muffles the outside world, and a big crash drops the
// whole mix under water with ringing ears.
// ---------------------------------------------------------------------------
import { clamp, lerp } from '../core/mathUtils.js';

// A VOICE = the recordings of one kind of engine, from idle to the red line (clip names from
// public/audio/clips.json, cut by tools/build-audio.py). Each recording is loudest at the engine
// speed it was recorded at and fades into its neighbours. Where a kind of engine has no
// recording of its own for part of the range, it borrows one from another engine:
// ['clip', rpm] = "play that clip as if it had been recorded at this rpm" (the rpm at which
// THIS engine fires as often as the borrowed one did).
const F1 = 0.45;   // a Formula 1 V10 revs to 19,000 rpm, ours to about 8,500: see the v10 voice
export const VOICES = {
  i4: ['engine_idle', 'engine_low', 'engine_mid', 'engine_high'],                   // VW 2.0 turbo four
  i4race: ['i4race_idle', 'race_low', 'i4race_mid', 'i4race_high'],                 // Mercedes 190E 2.3-16 (low revs: a vintage race four)
  i6: ['i6_idle', 'i6_low', 'i6_mid', 'i6_high'],                                   // BMW idle, Toyota Supra turbo on the dyno
  f4: ['f4_idle', 'f4_low', 'f4_mid', 'f4_high'],                                   // Subaru WRX low down, supercharged GT-86 higher up
  f6: ['i6_idle', 'f6_low', 'f6_mid', 'i6_high'],                                   // Porsche 911 low down (idle and top end BORROWED from the straight six: same number of bangs)
  v6: ['v6_idle', 'v6_low', 'v6_mid', 'v6_high'],                                   // Alfa Romeo Giulia Quadrifoglio
  v8: ['v8_idle', 'v8_low', 'v8_mid'],                                              // cross-plane V8: Maserati low down, an American V8 flat out (nothing recorded in between)
  v8t: ['v8t_idle', 'v8_low', 'v8t_mid', 'v8t_high'],                               // flat-plane exotic V8 (Maserati idle and low revs, then Ferrari F40)
  // V10: a Lamborghini's idle, then Formula 1 V10s (Ferrari F2004, Renault R25). Each F1 recording is placed
  // at 0.45 x the rpm it was recorded at, so the whole F1 range - idle to the 19,000 rpm scream - is spread
  // over our road engines' range. That makes the note about an octave higher than a real road V10's: on
  // purpose. A profile's `pitch` moves it back down (see v10 / v10smooth / v10race below).
  v10: [['v10_idle', 1000], ['v10f1_idle', 3740 * F1], ['v10f1_low', 7650 * F1], ['v10f1_mid', 12210 * F1], ['v10f1_high', 19010 * F1]],
  v12: ['v12_idle', 'v12_low', ['v8t_mid', 3930], ['v8t_high', 4690]],              // Ferrari 812 (above 2770 rpm: BORROWED from the flat-plane V8)
  // Mazda rotary: RX-8 and RX-7 from 4290 rpm up. Nothing smooth was recorded lower: BORROWED from the four, which fires as often.
  rotary: ['engine_idle', 'engine_low', 'rotary_low', 'rotary_mid', 'rotary_high'],
  // No recording of a W16 exists in the library. BORROWED: the V12's idle, the V10 and the flat-plane V8.
  w16: [['v12_idle', 725], ['v10_low', 2050], ['v8t_mid', 2945], ['v8t_high', 3520]],
};
// voice   which recordings (VOICES)                    firing  bangs per turn of the crank (cylinders / 2; rotors for a rotary)
// pitch   >1 = higher, smaller-sounding engine         tone   how bright the exhaust is at full throttle (Hz)
// drive   how hard the exhaust is distorted (rasp)     buzz   amount of added harmonic "brap", on harmonic `order` of the firing
// turbo   how loud the whistle and blow-off are when the engine has a turbo (1 = normal)
// backfire  [chance when lifting at high revs, chance on a full-throttle upshift]
// bass    (optional) a fuller, deeper note, in decibels: lifts the engine's lowest note (its firing) and all below it
// An engine in content/engines.json picks one of these with "sound". Two engines with the same
// number of cylinders share recordings but not their shaping, so they still differ.
export const ENGINE_PROFILES = {
  // ---- fours ----
  turbo4: { voice: 'i4', firing: 2, pitch: 1.00, tone: 3000, drive: 1.6, buzz: 0.10, order: 1.0, turbo: 1.0, backfire: [0.85, 0.35], volume: 1.0 },      // SR20DET
  vtec4:  { voice: 'i4', firing: 2, pitch: 1.18, tone: 4800, drive: 1.3, buzz: 0.18, order: 2.0, turbo: 1.0, backfire: [0.5, 0.12], volume: 0.95 },   // K20A: higher and harder than the 4A-GE, screams to 8600
  na4:    { voice: 'i4', firing: 2, pitch: 1.12, tone: 4200, drive: 1.2, buzz: 0.22, order: 2.0, turbo: 1.0, backfire: [0.5, 0.12], volume: 0.95 },   // 4A-GE: revvy, induction rasp
  race4:  { voice: 'i4race', firing: 2, pitch: 1.00, tone: 3600, drive: 2.4, buzz: 0.12, order: 1.0, turbo: 1.0, backfire: [0.7, 0.25], volume: 1.05 }, // M102 16-valve: big-bore bark
  boxer4: { voice: 'f4', firing: 2, pitch: 1.00, tone: 2800, drive: 1.7, buzz: 0.10, order: 0.5, turbo: 1.1, backfire: [0.85, 0.35], volume: 1.0 },    // EJ20: off-beat rumble
  // ---- sixes ----
  six26:  { voice: 'i6', firing: 3, pitch: 1.05, tone: 4200, drive: 1.9, buzz: 0.06, order: 1.0, turbo: 1.0, backfire: [0.85, 0.35], volume: 1.0 },      // RB26DETT: hard, metallic
  six30:  { voice: 'i6', firing: 3, pitch: 0.94, tone: 3000, drive: 1.4, buzz: 0.04, order: 1.0, turbo: 1.2, backfire: [0.8, 0.3], volume: 1.0 },     // 2JZ-GTE: deeper, smoother, more turbo
  flat6:  { voice: 'f6', firing: 3, pitch: 1.00, tone: 4600, drive: 1.9, buzz: 0.06, order: 1.0, turbo: 1.0, backfire: [0.7, 0.25], volume: 1.0 },     // Mezger flat six: dry, mechanical howl
  v6:     { voice: 'v6', firing: 3, pitch: 0.97, tone: 3400, drive: 1.6, buzz: 0.08, order: 0.5, turbo: 1.0, backfire: [0.6, 0.2], volume: 1.0 },      // VQ35: the trumpet-like V6
  v6tt:   { voice: 'v6', firing: 3, pitch: 0.92, tone: 4800, drive: 3.0, buzz: 0.09, order: 0.5, turbo: 1.3, backfire: [0.9, 0.4], volume: 1.06 },     // VR38: deep but angry - a hard, raspy bark that crackles when you lift
  // ---- eights and up ----
  v8:     { voice: 'v8', firing: 4, pitch: 1.00, tone: 2600, drive: 2.0, buzz: 0.08, order: 0.5, turbo: 1.0, backfire: [0.7, 0.25], volume: 1.05 },     // Coyote 5.0: cross-plane burble
  v8big:  { voice: 'v8', firing: 4, pitch: 0.92, tone: 2400, drive: 2.3, buzz: 0.10, order: 0.5, turbo: 1.0, backfire: [0.85, 0.3], volume: 1.08 },    // AMG 6.2: lower, thunderous, crackles
  v8flat: { voice: 'v8t', firing: 4, pitch: 1.00, tone: 5200, drive: 2.2, buzz: 0.05, order: 1.0, turbo: 1.0, backfire: [0.8, 0.35], volume: 1.0 },    // flat-plane exotic: wail
  // (no added buzz on the V10s: it is tuned to a road engine's firing, and would be out of tune with the F1 recordings)
  v10:    { voice: 'v10', firing: 5, pitch: 0.88, tone: 5400, drive: 1.7, buzz: 0, order: 1.0, turbo: 1.0, backfire: [0.75, 0.3], volume: 1.0 },      // Lamborghini 5.2: the lowest of the three, a howl
  v10smooth: { voice: 'v10', firing: 5, pitch: 0.92, tone: 4800, drive: 1.4, buzz: 0, order: 1.0, turbo: 1.0, backfire: [0.5, 0.2], volume: 1.0 },   // BMW S85: smooth, metallic
  v10race: { voice: 'v10', firing: 5, pitch: 1.00, tone: 6600, drive: 1.8, buzz: 0, order: 1.0, turbo: 1.0, backfire: [0.8, 0.35], volume: 1.03 },   // Carrera GT: the full F1 shriek
  v12:    { voice: 'v12', firing: 6, pitch: 1.00, tone: 5600, drive: 1.6, buzz: 0.03, order: 1.0, turbo: 1.0, backfire: [0.6, 0.2], volume: 1.0, bass: 3 },
  v12rasp: { voice: 'v12', firing: 6, pitch: 0.97, tone: 5000, drive: 2.1, buzz: 0.05, order: 1.0, turbo: 1.0, backfire: [0.85, 0.35], volume: 1.03, bass: 3 }, // Lamborghini: rougher, bangs on the overrun
  v12smooth: { voice: 'v12', firing: 6, pitch: 0.9, tone: 3200, drive: 1.3, buzz: 0.02, order: 1.0, turbo: 1.0, backfire: [0.3, 0.1], volume: 0.97 },   // Mercedes M120: silky, low
  w16:    { voice: 'w16', firing: 8, pitch: 0.62, tone: 2200, drive: 1.9, buzz: 0.08, order: 0.25, turbo: 1.4, backfire: [0.6, 0.2], volume: 1.08 },  // deep and breathy: four turbos
  // ---- rotaries ----
  rotary: { voice: 'rotary', firing: 2, pitch: 1.00, tone: 5600, drive: 2.0, buzz: 0.10, order: 1.5, turbo: 0.9, backfire: [0.9, 0.45], volume: 0.95 },  // 13B: buzz-saw, spits flames
  rotary3: { voice: 'rotary', firing: 3, pitch: 1.50, tone: 6000, drive: 1.7, buzz: 0.08, order: 1.0, turbo: 0.9, backfire: [0.85, 0.4], volume: 0.95 },  // 20B: three rotors, half as many bangs again
  default: { voice: 'i4', firing: 2, pitch: 1.05, tone: 3000, drive: 1.4, buzz: 0.12, order: 1.0, turbo: 1.0, backfire: [0.1, 0.05], volume: 0.9 },
};
// What a car's body adds when its car.json says nothing ("soundBody"): nothing at all.
const PLAIN_BODY = { resonance: 0, brightness: 1 };
// Everything the sound system needs to know about a car (a finished setup from vehicles/carSetup.js):
//   profile    the engine's entry in ENGINE_PROFILES       induction  'turbo', 'supercharger' or null
//   body       { resonance: Hz the shell booms at (0 = none), brightness: 1 = as recorded, more = brighter }
//   turboSize  how big the turbo sounds (1 = factory; a big single is louder and lower, small twins quieter and higher)
export const soundOf = (spec) => ({ profile: spec.sound, induction: spec.engine?.induction || null, turboSize: spec.engine?.turboSize ?? 1, body: { ...PLAIN_BODY, ...spec.soundBody } });
const NO_CAR = { profile: 'default', induction: null, turboSize: 1, body: PLAIN_BODY };
const IMPACT_LEVEL = 0.63;      // -4 dB, as asked for the real impact recordings
const PASS_LEVEL = 0.4;         // pass-by whooshes sit well under your own engine
const ENGINE_LEVEL = 1.9;       // your engine is the star of the mix
const BASE_LEVEL = 0.30;        // the always-there engine bed, relative to the full exhaust roar
const TURBO_LEVEL = 0.12;       // the turbo's whistle at full boost
const BLOWOFF_LEVEL = 1.1;      // the blow-off ("tu-tu-tu") when you lift with boost up
const CHARGER_LEVEL = 0.9;      // the supercharger's whine at full load
const POP_LEVEL = 1.25;         // exhaust crackles and bangs

export function createAudio() {
  const audio = { ready: false, start, preload, update() {}, impact() {}, crash() {}, passBy() {}, beep() {}, hornAt() {}, shift() {}, play() {}, setPaused() {}, clips: {} };
  let lastUpdate = 0;
  let ctx, master, muffle, outside, cabinFilter, echo, noiseBuffer, probe, probeData, lastCheck = 0, playerCar = NO_CAR;
  const buffers = {};                 // decoded recordings (kept if the sound system has to restart)

  // Download every recording listed in clips.json. main.js calls this as soon as the game opens, so
  // nothing is left to fetch when the player presses DRIVE. (Turning the files into playable sound has
  // to wait for that click — see start() — because browsers only allow sound after one.)
  let downloads = null;               // the download in progress or finished: [[clip name, file bytes], ...]
  function preload() {
    if (!downloads) {
      downloads = (async () => {
        audio.clips = await (await fetch('audio/clips.json')).json();
        return Promise.all(Object.entries(audio.clips).map(async ([clipName, clip]) => [clipName, await (await fetch('audio/' + clip.file)).arrayBuffer()]));
      })();
      downloads.catch(() => { downloads = null; });         // it failed (no network?): try again next time
    }
    return downloads;
  }

  // Browsers only allow sound after a click/key press, so this is called from the menu.
  // car = soundOf(the car being driven); leave it out to carry on with the same car.
  async function start(car) {
    playerCar = car || playerCar;
    if (ctx) { setCar(playerEngine, playerCar); ctx.resume(); return; }
    // Decode every recording (only once). They were downloaded by preload() when the game opened.
    const Context = window.AudioContext || window.webkitAudioContext;
    ctx = new Context();
    if (!Object.keys(buffers).length) {
      await Promise.all((await preload()).map(async ([clipName, bytes]) => { buffers[clipName] = await ctx.decodeAudioData(bytes); }));
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
    setCar(playerEngine, playerCar);
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
    // The car body: a gentle boom at the frequency this shell resonates at (set by setCar).
    const bass = filterNode('lowshelf', 300, 0, pan); bass.gain.value = 0;      // a fuller low end for engines that ask for it (profile.bass)
    const body = filterNode('peaking', 140, 1.4, bass); body.gain.value = 0;
    const loops = ctx.createGain();                                  // the blended loops, before the split
    // BASE: the loops, gently dulled, at a steady level
    const baseGain = gainNode(BASE_LEVEL, body), baseTone = filterNode('lowpass', 1400, 0.5, baseGain);
    loops.connect(baseTone);
    // EXHAUST: the loops pushed into distortion, through a filter that opens with load
    const exhaustGain = gainNode(0, body), tone = filterNode('lowpass', 1200, 0.7, exhaustGain);
    const shaper = ctx.createWaveShaper(); shaper.oversample = '2x'; shaper.connect(tone);
    const push = gainNode(0.5, shaper);
    loops.connect(push);
    // the added harmonic buzz lives in the exhaust
    const buzzGain = gainNode(0, push), buzzFilter = filterNode('bandpass', 400, 1.5, buzzGain);
    const buzz = ctx.createOscillator(); buzz.type = 'sawtooth'; buzz.connect(buzzFilter); buzz.start();
    return { out, pan, bass, body, loops, baseTone, baseGain, exhaustGain, tone, shaper, push, layers: [], voice: null, buzz, buzzGain, buzzFilter,
      car: NO_CAR, profile: ENGINE_PROFILES.default, load: 0, boost: 0, wasShifting: false };
  }
  // Make this engine sound like `car` (see soundOf): its profile, its recordings, its body.
  function setCar(engine, car) {
    if (!engine) return;
    engine.car = car;
    engine.profile = ENGINE_PROFILES[car.profile] || ENGINE_PROFILES.default;
    const curve = new Float32Array(512), k = engine.profile.drive;
    for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
    engine.shaper.curve = curve;
    set(engine.body.frequency, car.body.resonance || 140);
    set(engine.body.gain, car.body.resonance ? 5 : 0);            // decibels
    set(engine.bass.gain, engine.profile.bass || 0);              // decibels
    // The recordings: stop the old voice's loops and start this voice's, lowest rpm first.
    const voice = VOICES[engine.profile.voice] || VOICES.i4;
    if (voice === engine.voice) return;
    for (const layer of engine.layers) { layer.source.stop(); layer.gain.disconnect(); }
    engine.voice = voice;
    engine.layers = voice.map((entry) => [].concat(entry)).filter(([clip]) => buffers[clip]).map(([clip, rpm]) => {
      const gain = gainNode(0, engine.loops);
      return { gain, source: loopSource(buffers[clip], gain), rpm: rpm ?? audio.clips[clip].rpm };     // rpm: where this recording sounds as recorded
    }).sort((a, b) => a.rpm - b.rpm);
  }
  /**
   * @param rpm       real engine speed: sets pitch and which loops are heard
   * @param throttle  0..1 pedal
   * @param shifting  true while a gear change is in progress (power is cut)
   * @param volume    overall level of this engine (0 = switched off)
   */
  function driveEngine(engine, { rpm, throttle, shifting = false, volume, dt = 1 / 60 }) {
    const p = engine.profile;
    engine.layers.forEach((layer, k) => {
      // Blend: full volume at its own rpm, silent at its neighbours'. Below the lowest recording
      // and above the highest, that one plays alone. The square root keeps the TOTAL loudness
      // level through a cross-fade (a straight blend dips in the middle).
      const below = engine.layers[k - 1], above = engine.layers[k + 1];
      const weight = rpm < layer.rpm ? (below ? (rpm - below.rpm) / (layer.rpm - below.rpm) : 1) : (above ? (above.rpm - rpm) / (above.rpm - layer.rpm) : 1);
      set(layer.gain.gain, Math.sqrt(clamp(weight, 0, 1)), 0.04);
      set(layer.source.playbackRate, clamp((rpm * p.pitch) / layer.rpm, 0.3, 3.2), 0.03);
    });
    // LOAD = how much the exhaust is working. Up almost at once when you press (40 ms), away
    // smoothly when you lift (0.35 s), and dumped during a gear change so you hear the
    // drive let go and bite again.
    const wanted = shifting ? throttle * 0.08 : throttle;
    const rate = wanted > engine.load ? 1 / 0.04 : shifting ? 1 / 0.03 : 1 / 0.35;
    engine.load += (wanted - engine.load) * Math.min(1, dt * rate);
    const load = engine.load, revs = clamp(rpm / 8000, 0, 1.2);
    const firing = (rpm / 60) * p.firing;                      // bangs per second
    set(engine.buzz.frequency, firing * p.order, 0.03);
    set(engine.buzzFilter.frequency, firing * p.order * 2.2);
    set(engine.buzzGain.gain, p.buzz * load * 1.2 * clamp(rpm / 6000, 0.1, 1.2), 0.03);
    set(engine.bass.frequency, Math.max(250, firing * 2));     // the bass lift follows the firing note up the revs: the note gets all of it, the hiss above none
    // Base: always there, a little louder and brighter with revs. Never touched by the pedal.
    set(engine.baseTone.frequency, 900 + rpm * 0.28);
    set(engine.baseGain.gain, BASE_LEVEL * (0.7 + revs * 0.5));
    // Exhaust: thickness (push), brightness (tone) and volume all come from load.
    set(engine.push.gain, 0.4 + load * 1.5, 0.02);
    set(engine.tone.frequency, (600 + load * (p.tone * 1.4) + rpm * 0.2) * engine.car.body.brightness, 0.02);
    set(engine.exhaustGain.gain, load * (0.85 + revs * 0.25), 0.02);
    set(engine.out.gain, volume * p.volume, volume === 0 ? 0.25 : 0.05);
  }

  let playerEngine, rivalEngine, turbo, charger, wind, roll, skid, gravel, scrape, grind, horn, rain, wipers, wetRoad, ring, lastPass = '';
  function build() {
    playerEngine = makeEngine(master);
    rivalEngine = makeEngine(outside);
    turbo = noiseVoice('bandpass', 5000, 5, master);
    // supercharger whine: a recorded Hellcat blower (only heard on an engine that has a supercharger)
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
   *          rival: { distance, side -1..1, rpm, throttle, car (its soundOf) } | null }
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
      if (rivalEngine.car !== state.rival.car) setCar(rivalEngine, state.rival.car);
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
    // (what is fitted: from the factory, or a kit from the garage)
    const size = engine.car.turboSize, turboLevel = engine.car.induction === 'turbo' ? p.turbo * size : 0, chargerLevel = engine.car.induction === 'supercharger' ? 1 : 0;
    // TURBO: boost builds over ~0.8 s of load above 2800 rpm and bleeds away without it.
    // The whistle follows boost. Lifting with boost up fires ONE blow-off and empties the
    // boost, so it cannot fire again until the turbo has spooled up afresh.
    const spooling = turboLevel > 0 && state.throttle > 0.5 && !shifting && state.rpm > 2800;
    engine.boost = clamp(engine.boost + (spooling ? dt / 0.8 : -dt / 0.6), 0, 1);
    set(turbo.gain.gain, turboLevel * engine.boost * TURBO_LEVEL, 0.08);
    set(turbo.filter.frequency, (3200 + engine.boost * 2600 + state.rpm * 0.25) / Math.sqrt(size));
    if (turboLevel > 0 && engine.boost > 0.45 && state.throttle < 0.2) {
      // a real turbo letting go (two takes of a Ferrari F40's wastegate, picked at random)
      audio.play(Math.random() < 0.5 ? 'blowoff1' : 'blowoff2', { volume: BLOWOFF_LEVEL * turboLevel * engine.boost, rate: (0.95 + Math.random() * 0.15) / Math.cbrt(size), outsideBus: false });
      engine.boost = 0;
    }
    // SUPERCHARGER: pitch is locked to the engine, loudness to load.
    set(charger.source.playbackRate, clamp(state.rpm / audio.clips.supercharger.rpm, 0.35, 1.6), 0.03);
    set(charger.gain.gain, chargerLevel * load * CHARGER_LEVEL, 0.05);
    // AFTERFIRE: fuel popping in the hot exhaust at two moments - coming off the throttle at
    // high revs (a burst of crackles), and at the start of a flat-out upshift (one bang).
    // (A lift only counts after the engine has pulled for a moment: dabbing the throttle does not crackle.)
    engine.pulling = state.throttle > 0.7 ? (engine.pulling || 0) + dt : state.throttle >= 0.2 ? engine.pulling || 0 : 0;
    const lifted = engine.wasLoaded && state.throttle < 0.2, shiftStarted = shifting && !engine.wasShifting;
    if (high && lifted && Math.random() < p.backfire[0]) backfire(1, 2 + Math.floor(Math.random() * 3));
    if (high && shiftStarted && state.throttle > 0.8 && Math.random() < p.backfire[1]) backfire(0.8, 1);
    engine.wasLoaded = engine.pulling > 0.4;
    engine.wasShifting = shifting;
  }
  // `count` recorded exhaust pops one after another, each a little quieter (five takes from an
  // Audi R8; never the same one twice running). They go straight to the main mix, not through
  // the cabin's muffling: this is the sound the player is listening for.
  let lastPop = 0;
  function backfire(strength, count = 1) {
    let delay = 0;
    for (let k = 0; k < count; k++) {
      let pick = 1 + Math.floor(Math.random() * 5);
      if (pick === lastPop) pick = (pick % 5) + 1;
      lastPop = pick;
      audio.play('pop' + pick, { volume: POP_LEVEL * (0.8 + Math.random() * 0.4) * strength * (1 - k * 0.15), rate: 0.9 + Math.random() * 0.25, delay, outsideBus: false });
      delay += 0.07 + Math.random() * 0.1;
    }
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
