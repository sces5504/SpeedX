// ---------------------------------------------------------------------------
// config.js — every "magic number" that is fun to tweak lives here.
// Units: metres, seconds, radians, kilograms unless a name says otherwise.
// ---------------------------------------------------------------------------

// The real Angeles Crest Highway has 3.66 m (12 ft) lanes; the map itself is true to scale
// (6.03 miles measured from the real road). The lanes here are ~15% wider than real, because
// at game speeds and with a wide-angle camera a true-width road feels too narrow.
export const ROAD = {
  step: 2,              // distance between road sample points
  laneWidth: 4.2,       // one lane
  paveHalfWidth: 5.8,   // centre line to edge of asphalt (lane + paved shoulder)
  gravelEdge: 7.5,      // where the gravel shoulder ends
  barrierOffset: 7.0,   // guardrail / dirt berm position
  driveLimit: 6.7,      // how far from the centre a car body may get (wall)
  bench: 10.5,          // flat ground kept on each side of the road
  blend: 28,            // distance over which the bench blends into the mountain
};

export const GRAPHICS = {
  maxPixelRatio: 1.5,
  msaaSamples: 4,
  shadowMapSize: 1024,
  bloomStrength: 0.26,
  bloomRadius: 0.5,
  bloomThreshold: 1.25,
  lensDistortion: 0.16,   // wide-angle dash cam barrel distortion
  grain: 0.055,
  fovChase: 58,
  fovCockpit: 60,
  viewDistance: 2600,
};

// How dramatic the driving FEELS. None of this changes the physics.
// 1 = as designed, 0 = off. Turn things down here if it is too much.
export const FEEL = {
  cameraShake: 1.0,     // trembling and swaying with speed
  neck: 1.0,            // head thrown around by braking / cornering / gear changes
  speedFov: 36,         // extra degrees of field of view at top speed
  fovKick: 1.0,         // view widens when you floor the throttle
  motionBlur: 1.0,      // streaking at the edges of the picture at speed
  dangerShake: 1.0,     // violent rattle that only starts above ~130 km/h and keeps growing
  passBuffet: 1.0,      // the car and camera get shoved when traffic flashes past close by
  crashShake: 1.0,      // camera slam on impact
  crashFx: 1.0,         // black-out, blur, double vision and slow motion after a big hit
};

// The night moves through four stages (see world/sky.js) and then starts again.
export const NIGHT = {
  stageSeconds: 240,    // how long each stage lasts (4 minutes -> a full night every 16 minutes)
  blendSeconds: 90,     // the last part of a stage, spent fading into the next one
};

export const GAMEPLAY = {
  trafficCount: 5,         // ordinary cars alive around the player
  rivalCount: 2,           // illegal racers cruising the road
  spawnDistance: 420,      // traffic appears this far away (out of headlight range)
  despawnDistance: 650,
  speedLimit: 22,          // 22 m/s ≈ 50 mph, what normal traffic drives
  nearMissGap: 1.3,        // side gap (m) that counts as a near miss
  nearMissMinSpeed: 16,    // you must be going at least this fast (m/s)
  nearMissBonus: 0.25,     // seconds removed from the clock
  nearMissOncomingBonus: 0.5,
  crashPenalty: 1.0,       // seconds added for a hard hit during a challenge
  idleShutOff: 3,          // seconds standing still before the engine switches off
  knockoutSpeed: 17,       // m/s (~38 mph) INTO an obstacle before the black-and-white slow-motion crash plays
  raceLength: 2400,        // metres for a race against a rival
  challengeLength: 3000,   // metres for a time-attack run
};

export const PHYSICS = {
  substeps: 4,             // physics steps per rendered frame (at 60 fps -> 240 Hz)
  gravity: 9.81,
  // --- "arcade" dials: 1.0 everywhere = the real car. Raise for a Need-for-Speed feel. ---
  gripBoost: 1.75,         // tyre grip multiplier (more = corners harder, less understeer)
  speedGrip: 0.7,          // extra grip at high speed (0.7 = +70% at 215 km/h), like big downforce: fights high-speed understeer
  powerBoost: 2.0,         // engine torque multiplier (2 = heavily tuned cars)
  gearing: 0.8,            // < 1 = taller gears: higher top speed in every gear (0.8 = +25%)
  brakeBoost: 1.55,        // braking force multiplier
  steerAssist: 1.0,        // 0..1 how strongly the car is helped to rotate toward your steering
  keyboardAids: false,     // true = cut engine power while the tail is sliding (feels like the throttle is held back in corners)
  dryGrip: 1.0,
  wetGrip: 0.72,           // rain multiplies tyre grip by this
  gravelGrip: 0.62,        // off the asphalt
};

export const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  horn: ['KeyH'],
  lights: ['KeyL'],        // cycle off -> low beam -> high beam
  flash: ['KeyF'],         // hold to flash high beams (challenges a rival)
  camera: ['KeyC'],
  map: ['KeyM'],
  pause: ['Escape'],
  interact: ['KeyE'],
  reset: ['Backspace'],    // put the car back on the road
};

export const MPH = 2.23694; // metres per second -> miles per hour
