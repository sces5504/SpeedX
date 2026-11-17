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

// The kinds of road a map can be made of. A map's "sections" (map.json) say which stretch is
// which kind: world/mapData.js picks one from what the real map says about that stretch, or a
// section can name one itself with "type". A map without sections is 'two-lane' all the way.
//   lanes     lanes in EACH direction          laneWidth  metres
//   shoulder  paved strip outside the lanes    median     half the width of the strip between the two directions
//   wall      true = a concrete wall stands on the median (no crossing), with an opening `openLength` metres
//             long every `openEvery` metres and at every traffic light, so the player can turn round
//   centreLine  false = no line down the middle (a road too narrow for one)
// Everything further out (gravel, guardrail, flat verge) keeps the distances from the edge of the
// asphalt that ROAD above gives it.
export const ROAD_TYPES = {
  'two-lane': { lanes: 1, laneWidth: ROAD.laneWidth, shoulder: ROAD.paveHalfWidth - ROAD.laneWidth, median: 0 },   // the standard mountain road
  'divided': { lanes: 2, laneWidth: 3.5, shoulder: 1.3, median: 0.9, wall: true, openEvery: 400, openLength: 26 },   // four lanes either side of a concrete wall (Taiwan's Highway 2)
  'country': { lanes: 1, laneWidth: 3.4, shoulder: 0.5, median: 0 },        // an ordinary two-lane local road with a double yellow line
  'narrow': { lanes: 1, laneWidth: 2.9, shoulder: 0.3, median: 0, centreLine: false },   // a hill road with white edge lines only
};

// How big each kind of building is unless a map says otherwise: [width along the road, depth], in metres.
// (The kinds themselves are made in world/town.js; mapData.js needs the sizes to level the ground.)
export const BUILDING_SIZES = {
  house: [10.4, 11], shack: [8, 7], cafe: [8, 7], eatery: [9, 8], seafood: [14, 10], police: [12, 9], temple: [6, 5], hall: [14, 10], toilet: [5, 4],
  'surf-base': [18, 11], shrine: [7, 6], columbarium: [30, 18], 'police-post': [14, 9], harbour: [60, 40],
  'bus-stop': [4, 2], 'power-tower': [9, 9], 'road-lamp': [0.5, 0.5], 'utility-pole': [0.5, 0.5], 'median-lamp': [0.5, 5],
};

export const GRAPHICS = {
  maxPixelRatio: 1.5,
  msaaSamples: 4,
  shadowMapSize: 1024,
  // --- the film camera (render/postfx.js) ---
  bloomStrength: 0.46,    // glow around bright things
  bloomRadius: 0.86,      // how far that glow spreads (0..1): wide = soft, hazy lights
  bloomThreshold: 1.25,   // only light brighter than this glows: lamps, neon, and whatever stands right in their light
  streak: 0.3,            // long horizontal streaks from lamps (anamorphic "streak filter"); 0 = off
  streakTint: 0x6fa8ff,   // their colour
  glare: 0.9,             // how hard headlights in your face dazzle: a white ball of light round them, extra bloom and streaks, and the
                          // rest of the picture going dark while the "eye" adapts. 0 = not at all
  saturation: 1.14,       // 1 = as rendered, more = richer neon
  contrast: 0.32,         // 0 = flat, 1 = very punchy
  lensDistortion: 0.13,   // wide-angle barrel distortion
  grain: 0.05,
  // --- replays only (render/replayLook.js): lit like a night shoot, so the car has shape and nothing burns white ---
  replay: {
    fill: 0.5,            // soft cool light from the whole sky
    key: 55,              // the gentle lamp that stays near the camera
    beams: 0.3,           // headlight beams, as a share of their driving brightness (a wet road throws them straight back at a low camera)
    exposure: 1.1,        // the whole picture, a touch brighter
    glare: 0.35,          // how much of the usual dazzle from oncoming lamps is left
  },
  // --- the world ---
  dampRoad: 0.4,         // the asphalt always looks a little damp, like a film set, so lights reflect in it
                          // (looks only: grip is not affected). 0 = bone dry unless it rains
  mist: 0.2,              // how visible light beams are in dry air (rain adds more)
  realLamps: 8,           // how many street lamps and shop lights near you are REAL lights at once (each one costs a little speed)
  lightPools: false,      // true = also paint a soft pool of colour on the ground under signs and lamps (a cheap fake; real lamps make it unnecessary)
  buildingLights: 0.8,    // brightness of shop signs, canopy lights, neon and street lamps (1 = full)
  carReflections: 128,    // size of the live reflection on car paint and glass; 0 = off
  fovChase: 58,
  fovCockpit: 60,
  viewDistance: 2600,
  // Only draw what is near (render/drawDistance.js). At night the fog hides everything long before these.
  drawDistance: 1200,     // road, roadside posts and signs, plants: not drawn further away than this
  detailDistance: 1200,   // the mountain is drawn in full detail within this, as rough shapes beyond
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

// What someone gets the FIRST time they play. After that the game remembers what they chose
// themselves (in the pause menu) and these are not used again.
export const FIRST_TIME = {
  filter: 'classic',       // the picture filter: 'off', 'classic' (CLASSIC GREEN) or 'vhs' - see render/filters.js
  rain: true,              // start in the rain
};

export const GAMEPLAY = {
  freeParts: false,        // true = a new visitor starts in the SANDBOX (every car and part for nothing) instead of
                           // the career. Either way the developer console's "sandbox on / off" switches (game/save.js).
  trafficCount: 5,         // ordinary cars alive around the player
  rivalCount: 3,           // illegal racers cruising the road
  // How every street racer drives in a race (ai/rivals.js). None of them holds back: these are the
  // shares of what THEIR CAR can do (carRating.js: limits), and what makes one faster than another
  // is the car, which each of them has tuned differently (vehicles/randomBuild.js).
  racer: {
    cornering: 0.9,        // share of the car's cornering grip they use
    braking: 0.86,         // share of its braking they plan with: higher = brakes later
    straight: 0.94,        // share of its power and top speed on the straights while they are not behind you
    catchUp: 0.2,          // rubber band: this much extra pace when they have fallen 160 m behind
    easeOff: 0.08,         // ...and this much less when they are 90 m ahead
    ratingSpread: 90,      // their cars are rated within about this many points of yours
  },
  spawnDistance: 420,      // traffic appears this far away (out of headlight range)
  despawnDistance: 650,
  speedLimit: 22,          // 22 m/s ≈ 80 km/h, what normal traffic drives
  nearMissGap: 1.3,        // side gap (m) that counts as a near miss
  nearMissMinSpeed: 16,    // you must be going at least this fast (m/s)
  nearMissBonus: 0.25,     // seconds a near miss gives back in a time attack
  nearMissOncomingBonus: 0.5,
  crashPenalty: 1.0,       // seconds a hard hit costs in a time attack
  idleShutOff: 3,          // seconds standing still before the engine switches off
  knockoutSpeed: 17,       // m/s (~60 km/h) INTO an obstacle before the black-and-white slow-motion crash plays
  raceLength: 2400,        // metres for a race against a rival
  rollingStartRoom: 300,   // metres of road a Blacklist race's rolling start needs ahead of it (it covers about 185; the rest is room to brake for what comes next)
  challengeLength: 3000,   // metres for a time-attack run
};

export const PHYSICS = {
  substeps: 4,             // physics steps per rendered frame (at 60 fps -> 240 Hz)
  gravity: 9.81,
  // --- "arcade" dials: 1.0 everywhere = the real car. Raise for a Need-for-Speed feel. ---
  gripBoost: 1.75,         // tyre grip multiplier (more = corners harder, less understeer)
  speedGrip: 0.7,          // extra grip at high speed (0.7 = +70% at 215 km/h), like big downforce: fights high-speed understeer
  powerBoost: 1.3,         // engine torque multiplier for EVERY car. 1.3 = a factory car is lively but leaves room to grow;
                           // tuning parts (content/upgrades.json) add the rest. It was 2.0 before the game had upgrades
  gearing: 0.8,            // < 1 = taller gears: higher top speed in every gear (0.8 = +25%)
  brakeBoost: 1.55,        // braking force multiplier
  steerAssist: 1.0,        // 0..1 how strongly the car is helped to rotate toward your steering
  keyboardAids: false,     // true = cut engine power while the tail is sliding (feels like the throttle is held back in corners)
  dryGrip: 1.0,
  wetGrip: 1.0,            // tyre grip in rain. Same as dryGrip: rain changes how the game looks and sounds, NOT how the car drives (lower it, e.g. 0.72, for a slippery wet road)
  gravelGrip: 0.62,        // off the asphalt
  // --- DRIFT MODE: what SPACE (the handbrake) does at speed (vehicles/vehiclePhysics.js, step 6b) ---
  // Tap or hold SPACE while steering and the tail steps out into a slide you steer with A / D and
  // keep going with the throttle; steer straight (or the other way) and it gathers itself up again.
  // None of this is used until SPACE is pressed: ordinary driving does not go through it at all.
  drift: {
    minSpeed: 9,           // m/s (~32 km/h). Slower than this SPACE is a plain handbrake: locked rear wheels
    rearGrip: 0.45,        // share of their sideways grip the rear tyres keep in a drift (lower = the tail swings wider)
    turnRate: 1.2,         // how fast the car rotates at full steering lock, radians per second at ~80 km/h (less the faster you go)
    flick: 1.5,            // ...times this while SPACE is still held down (the tail is thrown out faster)
    hold: 9,               // how firmly the car's rotation follows the steering (higher = more exact, less "floaty")
    maxAngle: 0.56,        // radians (it settles a little above this, at about 35-40 degrees): the widest the tail hangs out before the car is turned back - it will not spin
    carry: 0.6,            // share of the speed a slide would scrub off that is given back while the throttle is down
    handbrakeDrag: 0.25,   // g of braking while SPACE itself is held (letting go keeps the drift, without the braking)
    exitAngle: 0.1,        // radians: once the car is this straight again (and SPACE is up), drift mode ends
  },
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
  console: ['Backquote'],  // ~ : the developer console (ui/devConsole.js)
  replay: ['KeyR'],        // watch the replay that has just been offered (game/replay.js)
};

export const KMH = 3.6;     // metres per second -> kilometres per hour (every speed the player sees is in km/h)
