// ---------------------------------------------------------------------------
// main.js — the conductor. It builds the world once, then runs the game loop:
//
//   every frame:  read keys -> move the player -> move AI cars -> collisions
//                 -> scoring -> lights -> camera -> sound -> HUD -> draw
//
// The real work is in the other folders:
//   world/     map data, terrain, road, scenery, places, sky, weather
//   vehicles/  car data, car models, cockpit, driving physics
//   ai/        traffic and rival racers
//   game/      collisions, near misses, time attack
//   render/    cameras, materials, post-processing, sparks
//   audio/     synthesised sound          ui/  HUD, map, menus
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FEEL, FIRST_TIME, GAMEPLAY, GRAPHICS, ROAD } from './config.js';
import { input } from './core/input.js';
import { clamp, damp, formatTime, smoothstep } from './core/mathUtils.js';
import { loadMap, loadMapInfo, listMaps } from './world/mapData.js';
import { buildTerrain } from './world/terrain.js';
import { buildRoad } from './world/road.js';
import { buildScenery } from './world/scenery.js';
import { buildPois } from './world/pois.js';
import { buildSea } from './world/sea.js';
import { buildTown } from './world/town.js';
import { buildSignals } from './world/signals.js';
import { drawNear, updateDrawDistance } from './render/drawDistance.js';
import { loadProps } from './world/props.js';
import { createSky, NIGHT_PRESETS } from './world/sky.js';
import { createWeather } from './world/weather.js';
import { ALL_CARS, HERO_CARS, TRAFFIC_CARS, loadCars } from './vehicles/carSpecs.js';
import { preloadCarModels } from './vehicles/carModel.js';
import { buildCar } from './vehicles/carBuilder.js';
import { createPlayer } from './vehicles/playerCar.js';
import { absorbHit, updateAiLights } from './ai/aiCar.js';
import { createTraffic } from './ai/traffic.js';
import { createRivals } from './ai/rivals.js';
import { collideCars } from './game/collisions.js';
import { createChallenge } from './game/challenge.js';
import { createCameras } from './render/cameras.js';
import { createPostFx } from './render/postfx.js';
import { FILTERS } from './render/filters.js';
import { createSparks } from './render/sparks.js';
import { shared, makeHeadlightCookie } from './render/materials.js';
import { smallLights } from './render/smallLights.js';
import { createCarProbe } from './render/reflections.js';
import { createAudio } from './audio/audio.js';
import { createHud } from './ui/hud.js';
import { createMapView } from './ui/mapView.js';
import { createMenu } from './ui/menu.js';

// ---- Renderer and scene -------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;        // the scene is drawn several times a frame (mirror, reflections); shadows only need one update
const scene = new THREE.Scene();

// ---- World ----------------------------------------------------------------------
// Cars and maps are content folders under public/content/ (add-ons live there too).
await loadCars();
await Promise.all([preloadCarModels(Object.values(ALL_CARS)), loadProps()]);
const mapList = await listMaps();
const wantedMap = new URLSearchParams(location.search).get('map') || localStorage.getItem('speedx-map');
const map = await loadMap(mapList.maps.includes(wantedMap) ? wantedMap : mapList.default);
scene.add(buildTerrain(map), buildRoad(map), buildScenery(map));
const sea = buildSea(map);                      // null on a map with no sea
if (sea) scene.add(sea.mesh);
const pois = buildPois(map);
scene.add(pois.group);
// The ordinary buildings of the map ("buildings" in map.json). Their lights join the stops' lists.
const town = buildTown(map);
scene.add(town.group);
pois.lamps.push(...town.lamps); pois.neons.push(...town.neons);
// Traffic lights ("signals" in map.json). Their colour also falls on the road, like any neon.
const signals = buildSignals(map);
scene.add(signals.group);
pois.neons.push(...signals.lights);
const sky = createSky(scene, renderer, map.info.cityLights);
const weather = createWeather(scene);
// Rain as the player left it last time; the very first time, as FIRST_TIME says.
const savedRain = localStorage.getItem('speedx-rain');
weather.raining = savedRain === null ? FIRST_TIME.rain : savedRain === 'on';
const rig = createCameras();
const postfx = createPostFx(renderer, scene, rig.camera);
postfx.setFilter(localStorage.getItem('speedx-filter') || FIRST_TIME.filter);      // the picture filter chosen last time (pause menu)
const carProbe = createCarProbe(renderer, scene);
const sparks = createSparks(scene);
const challenge = createChallenge(scene, map);
const audio = createAudio();
audio.preload().catch(() => {});       // download every sound now, so pressing DRIVE does not have to wait for them
const hud = createHud();
const mapView = createMapView(map, (poi) => travelTo(poi));

// A few real lights are shared between all lamps and AI cars: each frame they
// jump to whichever lamps/cars are closest to you. (Hundreds of real lights
// would be far too slow; the rest are just glowing surfaces.)
const lampLights = Array.from({ length: GRAPHICS.realLamps }, () => { const l = new THREE.PointLight(0xffffff, 0, 50, 1.8); scene.add(l); return l; });
const cookie = makeHeadlightCookie();
const trafficBeams = Array.from({ length: 3 }, () => {
  const l = new THREE.SpotLight(0xfff1dc, 0, 90, 0.6, 0.6, 1.0);
  l.map = cookie; scene.add(l, l.target);
  return { light: l, owner: null };      // owner = the AI car this beam is currently lighting for
});

// Parked cars at the gas station, mart and turnouts (solid, but never move).
const parked = pois.parking.filter((_, i) => i % 2 === 0).map((spot, i) => {
  const ids = Object.keys(spot.who === 'racers' ? HERO_CARS : TRAFFIC_CARS);
  const spec = ALL_CARS[ids[i % ids.length]];
  const car = buildCar(spec, spec.colors[i % spec.colors.length]);
  car.group.position.set(spot.x, spot.y, spot.z);
  car.group.rotation.y = spot.yaw;
  scene.add(drawNear(car.group, GRAPHICS.drawDistance / 2));      // (only drawn when near: a parked car is many pieces)
  return { active: true, x: spot.x, z: spot.z, yaw: spot.yaw, vx: 0, vz: 0, yawRate: 0, mass: 1e6, yawInertia: 1e9,
    halfWidth: car.dims.halfW, front: -car.dims.frontZ, rear: car.dims.rearZ };
});

// Buildings, pumps, columns and lamp posts: solid and immovable, like the parked cars.
const solids = [...parked, ...pois.obstacles.map((o) => ({ ...o, active: true, vx: 0, vz: 0, yawRate: 0, mass: 1e6, yawInertia: 1e9 }))];

const traffic = createTraffic(scene, map);
let player = null, rivals = null;
let state = 'menu';            // 'menu' | 'driving' | 'paused'
let time = 0, frame = 0, impactCooldown = 0, lastCountdown = 0, wasThrottle = 0, lastRaceState = 'none', lastGear = 1;
let idleTime = 0;               // seconds spent standing still with no pedals
let slowMo = 0;                // seconds of slow motion left after a big crash
const startPoi = map.pois.find((poi) => poi.id === map.info.startPoi) || map.pois[0];
let everDriven = false;

// ---- Starting / changing car ----------------------------------------------------
function spawnPlayer(carId, colorIndex) {
  // Changing car from the pause menu keeps your place on the road; the first start is at the gas station.
  const previous = player && everDriven ? { s: player.s, dir: playerDirection() } : null;
  if (player) player.dispose();
  if (rivals) for (const ai of rivals.cars) scene.remove(ai.car.group);
  player = createPlayer(scene, map, carId, colorIndex, rig.mirrorTarget.texture);
  if (previous) player.placeAt(previous.s, map.laneCentre(previous.s, 1), previous.dir);
  else player.placeAt(startPoi.s - 30, startPoi.side * (ROAD.barrierOffset + startPoi.shift + 3), 1);       // start in the gas station lot
  player.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: true }, 1);
  rig.snapTo(player);
  rivals = createRivals(scene, map, carId);
  const info = playerInfo();
  traffic.reset(info.s, [info]);
  rivals.reset(info, [info, ...traffic.cars]);
}

// Fast travel from the map screen: put the car in that lot and restart the traffic around it.
function travelTo(poi) {
  challenge.cancel();
  player.placeAt(poi.s, poi.side * (ROAD.barrierOffset + poi.shift + 3), 1);
  rig.snapTo(player);
  const info = playerInfo();
  traffic.reset(info.s, [info]);
  rivals.reset(info, [info, ...traffic.cars]);
  mapView.toggle(false);
  hud.popup(poi.name.toUpperCase(), 'info');
}

function playerDirection() {
  const i = Math.max(0, player.vehicle.roadIndex);
  const along = -Math.sin(player.vehicle.yaw) * map.road.tx[i] - Math.cos(player.vehicle.yaw) * map.road.tz[i];
  return along >= 0 ? 1 : -1;
}

// What AI drivers need to know about the player (also acts as the player's
// stand-in in their "who is ahead of me?" checks).
function playerInfo() {
  const v = player.vehicle, dir = playerDirection();
  return { isPlayer: true, active: true, s: player.s, d: player.d, dir, speed: Math.max(0, v.forwardSpeed),
    halfWidth: v.halfWidth, front: v.front, rear: v.rear,
    flashing: player.flashing, flashPressed: input.wasPressed('flash'), honking: input.isHeld('horn') };
}

const menu = createMenu({
  // Every installed map with its map.json, for the map cards (only the chosen map is actually built).
  maps: await Promise.all(mapList.maps.map(async (id) => ({ id, info: await loadMapInfo(id) }))),
  currentMap: map.id, mapName: map.info.name,
  onPreview: (carId, colorIndex) => spawnPlayer(carId, colorIndex),
  onPickMap: (id, name) => {                                   // maps are built at start-up, so: remember the choice and reload
    localStorage.setItem('speedx-map', id);
    document.body.insertAdjacentHTML('beforeend', `<div id="loading">LOADING ${name.toUpperCase()}…</div>`);
    location.search = '?map=' + id;
  },
  onStart: (carId, colorIndex) => {
    if (!player || player.carId !== carId) spawnPlayer(carId, colorIndex);
    audio.start(player.spec.sound);
    state = 'driving'; everDriven = true;
    audio.setPaused(false);
    hud.show(true);
    hud.banner('SPEEDX', 'flash a racer to race · find a cone for time attack', 4);
  },
  onResume: () => setPaused(false),
  onToggleRain: () => { weather.toggle(); localStorage.setItem('speedx-rain', weather.raining ? 'on' : 'off'); return weather.raining; },
  onNextNight: () => { sky.setPreset(sky.index + 1); return sky.preset.name; },
  onNextFilter: () => {                                        // step to the next picture filter in render/filters.js
    const next = FILTERS[(FILTERS.indexOf(postfx.filter) + 1) % FILTERS.length];
    postfx.setFilter(next.id);
    localStorage.setItem('speedx-filter', next.id);
    return next.name;
  },
  onGarage: () => { setPaused(false); state = 'menu'; hud.show(false); audio.setPaused(true); menu.showMain(); },
});

function setPaused(paused) {
  state = paused ? 'paused' : 'driving';
  menu.showPause(paused, weather.raining, sky.preset.name, postfx.filter.name);
  audio.setPaused(paused);
}

// ---- One frame of driving ------------------------------------------------------------
function updateDriving(dt) {
  const v = player.vehicle;

  // 1. Keys that switch things
  if (input.wasPressed('camera')) rig.toggle();
  if (input.wasPressed('lights')) { player.lightMode = (player.lightMode + 1) % 3; hud.popup(['LIGHTS OFF', 'LOW BEAM', 'HIGH BEAM'][player.lightMode], 'info'); }
  if (input.wasPressed('reset')) { player.placeAt(player.s, map.laneCentre(player.s, 1), playerDirection()); rig.snapTo(player); }
  player.flashing = input.isHeld('flash');

  // 2. Drive
  const controls = {
    throttle: input.isHeld('throttle') ? 1 : 0,
    brake: input.isHeld('brake') ? 1 : 0,
    steer: (input.isHeld('left') ? 1 : 0) - (input.isHeld('right') ? 1 : 0),
    handbrake: input.isHeld('handbrake'),
  };
  player.wiperCycle = weather.wiper;
  player.update(dt, controls, weather.grip);
  if (v.gear !== lastGear) { if (v.gear > 0 && lastGear > 0) audio.shift(); lastGear = v.gear; }
  // Stand still with no pedals for 3 seconds and the engine switches itself off; any pedal restarts it.
  idleTime = v.speed < 0.3 && controls.throttle === 0 && controls.brake === 0 ? idleTime + dt : 0;
  v.engineOff = idleTime > GAMEPLAY.idleShutOff;

  // 3. Other cars
  const info = playerInfo();
  const everyone = [info, ...traffic.cars, ...rivals.cars];
  const aiCars = [...traffic.cars, ...rivals.cars];
  traffic.update(dt, info, everyone);
  rivals.update(dt, info, everyone, weather.grip, challenge.state === 'running');

  // 4. Collisions
  impactCooldown -= dt;
  let scrape = 0;
  const feelImpact = (speed, side, forward, x, z, canKnockOut = true) => {
    // Light touch -> sparks and a nudge. Hard hit -> thud, jolt, blur.
    // HUGE hit -> white flash, slow motion, the picture drains and the sound goes under water.
    const strength = clamp(speed / 16, 0, 1);
    sparks.emit(x, v.y + 0.5, z, v.vx, v.vz, 4 + Math.round(strength * 30));
    if (speed <= 1.0 || impactCooldown > 0) return;
    impactCooldown = 0.18;
    audio.impact(strength, side * 0.6);
    rig.kick(0.05 + strength * 0.55, side, forward);
    postfx.punch(strength);
    // Only a really violent hit knocks you out: black-and-white, double vision and slow motion.
    // (Speed here is how fast you went INTO the thing, so scraping a rail at speed does not count.)
    if (canKnockOut && speed > GAMEPLAY.knockoutSpeed) {
      const big = clamp((speed - GAMEPLAY.knockoutSpeed) / 14 + 0.55, 0.55, 1);
      postfx.crash(big);
      audio.crash(big);
      slowMo = 0.6 * FEEL.crashFx;
    }
    if (speed > 6 && challenge.state === 'running') { challenge.crash(); hud.popup(`CRASH +${GAMEPLAY.crashPenalty.toFixed(1)}s`, 'bad'); }
  };
  if (player.lastImpact) {
    const hit = player.lastImpact;
    scrape = hit.scrape;
    feelImpact(hit.speed, hit.side, 0.3, hit.x, hit.z);
  }
  for (const other of [...aiCars, ...solids]) {
    const reach = Math.max(other.front, other.rear, other.halfWidth) + 6;      // long buildings can be touched far from their centre
    if (!other.active || (other.x - v.x) ** 2 + (other.z - v.z) ** 2 > reach * reach) continue;
    const before = { vx: other.vx, vz: other.vz };
    // Rear-ending a car that is going the same way as you is a shunt, not a knock-out crash.
    const sameWay = other.vx * v.vx + other.vz * v.vz > 0 && Math.hypot(other.vx, other.vz) > 3;
    const hit = collideCars(v, other);
    if (!hit) continue;
    if (other.kind) absorbHit(other, before, hit, map, time); else { other.vx = other.vz = other.yawRate = 0; }
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const side = Math.sign((hit.x - v.x) * rx + (hit.z - v.z) * rz), forward = Math.sign((hit.x - v.x) * fx + (hit.z - v.z) * fz);
    feelImpact(hit.speed, side, forward, hit.x, hit.z, !sameWay);
    scrape = Math.max(scrape, hit.speed > 0 ? 8 : 3);
  }

  // 5. Near misses, time attack, races
  for (const miss of challenge.detectNearMisses(player, aiCars, time)) {
    const text = (miss.oncoming ? 'HEAD-ON NEAR MISS' : 'NEAR MISS') + (miss.combo > 1 ? ` x${miss.combo}` : '');
    hud.popup(challenge.state === 'running' ? `${text}  -${miss.bonus.toFixed(2)}s` : text, 'good');
    audio.beep(miss.oncoming ? 1320 : 990, 0.18, 0.1);
  }
  // Whoosh as cars go by (timed so its loudest moment is when they are closest), horns, tyre spray.
  const pfx = -Math.sin(v.yaw), pfz = -Math.cos(v.yaw), prx = Math.cos(v.yaw), prz = -Math.sin(v.yaw);
  weather.sprayFrom(v.x - pfx * v.rear, v.y, v.z - pfz * v.rear, v.vx, v.vz, v.speed, dt);
  aiCars.forEach((ai, index) => {
    if (!ai.active) { ai.passArmed = true; return; }
    const relX = ai.x - v.x, relZ = ai.z - v.z, dvx = ai.vx - v.vx, dvz = ai.vz - v.vz;
    const dist = Math.hypot(relX, relZ), closing = Math.hypot(dvx, dvz);
    const pan = clamp((relX * prx + relZ * prz) / 6, -0.8, 0.8);
    if (ai.honk) audio.hornAt(dist, pan);
    if (dist < 130) weather.sprayFrom(ai.x, ai.y, ai.z, ai.vx, ai.vz, ai.speed, dt);
    if (dist > 50) ai.passArmed = true;
    const untilClosest = closing > 1 ? -(relX * dvx + relZ * dvz) / (closing * closing) : -1;
    const miss = Math.hypot(relX + dvx * untilClosest, relZ + dvz * untilClosest);
    // The moment a car flashes past close by, its wake shoves the camera and smears the picture.
    const beside = dist < 5.5 && closing > 18;
    if (beside && !ai.buffeted) { rig.buffet(clamp(closing / 60, 0.2, 1) * clamp(1.4 - dist / 5, 0.3, 1), pan > 0 ? -1 : 1); postfx.punch(clamp(closing / 90, 0.15, 0.6)); }
    ai.buffeted = beside;
    if (ai.passArmed && untilClosest > 0 && untilClosest < 3.2 && miss < 11 && closing > 9) {
      // What kind of vehicle is it? Size changes the pitch; trucks add a diesel rumble.
      const vehicle = ai.kind === 'rival' ? 'rival' : ai.spec.mass > 3000 ? 'truck' : ai.spec.mass > 1600 ? 'big' : ai.spec.mass < 1150 ? 'small' : 'car';
      audio.passBy({ vehicle, timeToClosest: untilClosest, closingSpeed: closing, pan, closeness: clamp(1 - miss / 11, 0, 1),
        wet: weather.soak > 0.5, inside: rig.mode === 'cockpit' });
      ai.passArmed = false;
    }
  });
  challenge.update(dt, player.s);
  updateRaceHud();
  updateInteraction(v);

  // 6. Lights, camera, weather, sound
  rig.update(dt, player);
  updateLights(dt);
  sky.update(rig.camera, weather.amount, dt);              // passing dt lets the night move on
  tellWeatherWhereTheRoadIs();
  weather.update(dt, rig.camera, new THREE.Vector3(v.vx, 0, v.vz));
  sparks.update(dt);
  const race = rivals.race;
  audio.update({
    rpm: v.rpm, throttle: v.gear === -1 ? controls.brake : controls.throttle, speed: v.speed, slip: Math.max(v.slipFront, v.slipRear), wheelSpin: v.wheelSpin,
    onGravel: player.onGravel, wet: weather.soak, rain: weather.amount, inside: rig.mode === 'cockpit', scrape,
    horn: input.isHeld('horn'), trauma: postfx.trauma, engineOff: v.engineOff,
    shifting: v.shiftTimer > 0, redline: v.spec.engine.redline,
    rival: nearestRival(v, prx, prz),
  });

  // 7. HUD
  const timerInfo = { visible: false, text: '', extra: '' };
  if (challenge.state === 'running') Object.assign(timerInfo, { visible: true, text: formatTime(challenge.clock),
    extra: `${Math.round(challenge.remaining)} m` + (challenge.best !== null ? `  best ${formatTime(challenge.best)}` : '') });
  else if (race.state === 'racing') Object.assign(timerInfo, { visible: true, text: formatTime(race.timer),
    extra: `${race.playerProgress >= race.rivalProgress ? 'AHEAD' : 'BEHIND'} ${Math.abs(race.playerProgress - race.rivalProgress).toFixed(0)} m · ${Math.max(0, race.length - race.playerProgress).toFixed(0)} m to go` });
  hud.update(dt, { vehicle: v, lightMode: player.flashing ? 2 : player.lightMode, timer: timerInfo,
    statusLines: [sky.preset.name.toUpperCase() + (weather.raining ? ' · RAIN' : ''), `CAM ${rig.mode.toUpperCase()}`,
      race.wins + race.losses > 0 ? `RACES ${race.wins}W ${race.losses}L` : ''] });
  if (frame % 6 === 0) mapView.drawMini(mapInfo());
}

// The rival you can hear: the closest one, with a made-up but believable rev counter
// (revs climb with speed and drop back at each "gear change").
function nearestRival(v, rightX, rightZ) {
  let best = null;
  for (const ai of rivals.cars) {
    if (!ai.active) continue;
    const distance = Math.hypot(ai.x - v.x, ai.z - v.z);
    if (distance > 110 || (best && distance > best.distance)) continue;
    best = { distance, side: ((ai.x - v.x) * rightX + (ai.z - v.z) * rightZ) / Math.max(distance, 4),
      rpm: 2600 + ((ai.speed % 16) / 16) * 4300, throttle: ai.accel > -0.5 ? 0.9 : 0.15, sound: ai.spec.sound };
  }
  return best;
}

function mapInfo() {
  const gate = challenge.state === 'running' ? map.pointAt(challenge.finishS, 0)
    : rivals.race.state === 'racing' ? map.pointAt(rivals.race.finishS, 0) : null;
  return { player: player.vehicle, others: [...traffic.cars, ...rivals.cars].filter((ai) => ai.active), challenge: gate };
}

// Banners and beeps for the rival race.
function updateRaceHud() {
  const race = rivals.race;
  if (race.message && race.state === 'none') { hud.popup(race.message, 'info'); race.message = ''; }
  if (race.state === 'invite') hud.setPrompt('F', `A level ${race.rival.skill.level} racer is flashing you — flash back to race`);
  if (race.state === 'countdown') {
    const count = Math.ceil(race.timer);
    if (count !== lastCountdown) { hud.banner(String(count), `RACE · ${race.rival.spec.name} · LEVEL ${race.rival.skill.level}`, 0.9, '#ffd166'); audio.beep(660, 0.15); lastCountdown = count; }
  }
  if (race.state !== lastRaceState) {
    if (race.state === 'racing') { hud.banner('GO!', `${(race.length / 1000).toFixed(1)} km to the gate`, 1.6, '#57ff9a'); audio.beep(1320, 0.5); challenge.showGate(race.finishS); lastCountdown = 0; }
    if (race.state === 'done') { hud.banner(race.message, race.playerWon ? formatTime(race.timer) : 'flash another racer for a rematch', 4, race.playerWon ? '#57ff9a' : '#ff5148'); challenge.hideGate(); race.message = ''; }
    lastRaceState = race.state;
  }
  if (challenge.state === 'finished' && challenge.finishedTimer > 6.9) {
    hud.banner(formatTime(challenge.finalTime), challenge.newBest ? 'NEW BEST' : `best ${formatTime(challenge.best)}` + ` · ${challenge.nearMisses} near misses`, 5, '#57ff9a');
    audio.beep(1320, 0.5);
  }
}

// "Press E" spots: refuel at a pump, start a time attack at a cone.
function updateInteraction(v) {
  let found = null;
  for (const spot of pois.interactables) {
    if (Math.hypot(spot.position.x - v.x, spot.position.z - v.z) < spot.radius && v.speed < 4) found = spot;
  }
  if (rivals.race.state === 'invite') return;                 // the race prompt has priority
  if (!found || challenge.state === 'running') { hud.setPrompt('', null); return; }
  hud.setPrompt('E', found.type === 'fuel' ? 'Refuel' : 'Start time attack (in the direction you are facing)');
  if (!input.wasPressed('interact')) return;
  if (found.type === 'fuel') { v.fuel = 1; hud.popup('TANK FULL', 'info'); audio.beep(520, 0.25); }
  else if (rivals.race.state === 'none') {
    if (challenge.start(found.poi, player.s, playerDirection())) { hud.banner('TIME ATTACK', 'near misses take time off the clock', 2.5, '#ffd166'); audio.beep(880, 0.3); }
    else hud.popup('Not enough road that way — turn around', 'info');
  }
}

// Rain splashes are drawn on the piece of road around your car.
function tellWeatherWhereTheRoadIs() {
  const v = player.vehicle, i = Math.max(0, v.roadIndex);
  const slope = (map.at(map.road.y, player.s + 3) - map.at(map.road.y, player.s - 3)) / 6;
  weather.setGround(v.x, v.y, v.z, map.road.tx[i], map.road.tz[i], slope);
}

// Moves the shared real lights and lists the cars whose light shines in your face (dazzlers).
const tmp = new THREE.Vector3(), camForward = new THREE.Vector3();
const lampPair = [new THREE.Vector3(), new THREE.Vector3()];
const dazzlers = [];      // the cars dazzling the camera this frame: { id, power, at: [x, y, x, y] } (see postfx.js)
// Where a car's two headlights are in the world - or, for its tail, two spots on the bodywork
// between and below the tail lamps (that is what throws your light back; the lamps stay red).
function lampsOf(ai, front) {
  const lamp = front ? ai.spec.headlights : { x: ai.spec.taillights.x * 0.4, y: ai.spec.taillights.y - 0.2 };
  const along = front ? ai.front : -ai.rear, out = lamp.x * ai.halfWidth;
  const fx = -Math.sin(ai.yaw), fz = -Math.cos(ai.yaw), rx = Math.cos(ai.yaw), rz = -Math.sin(ai.yaw);
  lampPair.forEach((at, k) => { const side = k ? 1 : -1; at.set(ai.x + fx * along + rx * out * side, ai.y + lamp.y, ai.z + fz * along + rz * out * side); });
  return lampPair;
}
// Is the ground in the way between two points? (checked at a few places along the line)
function hiddenByTerrain(from, to) {
  for (let k = 1; k <= 5; k++) {
    const f = k / 6, x = from.x + (to.x - from.x) * f, z = from.z + (to.z - from.z) * f;
    if (map.terrainHeight(x, z) > from.y + (to.y - from.y) * f + 1.5) return true;     // (the terrain data is coarse: allow for that)
  }
  return false;
}
function updateLights(dt) {
  const cam = rig.camera, v = player.vehicle;
  cam.getWorldDirection(camForward);
  // Street lamps: the four closest get real lights.
  const lamps = pois.lamps.map((lamp) => ({ lamp, dist: lamp.position.distanceTo(cam.position) })).sort((a, b) => a.dist - b.dist);
  lampLights.forEach((light, i) => {
    const entry = lamps[i];
    if (!entry || entry.dist > 260) { light.intensity = 0; return; }
    light.position.copy(entry.lamp.position); light.color.set(entry.lamp.color);
    light.intensity = entry.lamp.intensity; light.distance = entry.lamp.distance;
  });
  // Everything else that glows is a "small light" (see render/smallLights.js): the street lamps
  // that did not get a real light, neon signs, and further down every car's own lamps.
  smallLights.begin();
  // (the four with real lights are listed too, faintly: rain and spray only know about small lights)
  lamps.forEach(({ lamp, dist }, i) => { if (dist < 400) smallLights.add(lamp.position.x, lamp.position.y, lamp.position.z, lamp.color, lamp.intensity * (i < lampLights.length ? 0.12 : 0.6), cam); });
  for (const neon of pois.neons) smallLights.add(neon.position.x, neon.position.y, neon.position.z, neon.color, neon.power, cam);

  // AI cars: three real spotlights are shared. A car far away borrows one at zero brightness
  // and it fades up as the car gets closer — so lights never pop on in front of you.
  const aiCars = [...traffic.cars, ...rivals.cars].filter((ai) => ai.active);
  const distanceTo = (ai) => Math.hypot(ai.x - v.x, ai.z - v.z);
  for (const beam of trafficBeams) {
    if (beam.owner && (!beam.owner.active || distanceTo(beam.owner) > 175) && beam.owner.beam < 0.02) beam.owner = null;
  }
  const waiting = aiCars.filter((ai) => !trafficBeams.some((b) => b.owner === ai) && distanceTo(ai) < 160).sort((a, b) => distanceTo(a) - distanceTo(b));
  for (const beam of trafficBeams) if (!beam.owner && waiting.length) { beam.owner = waiting.shift(); beam.owner.beam = 0; }
  for (const ai of aiCars) {
    const beam = trafficBeams.find((b) => b.owner === ai), dist = distanceTo(ai);
    const high = ai.car.lightState.head === 2, on = ai.car.lightState.head > 0;
    ai.beam = damp(ai.beam, beam && ai.active && on ? smoothstep(160, 95, dist) : 0, 4, dt);
    updateAiLights(ai, dt, cam.position);
    if (dist < 300) ai.car.addSmallLights(cam, 1 - ai.beam * 0.6);      // less from the lamp itself once a real beam does the work
    if (beam) {
      const fx = -Math.sin(ai.yaw), fz = -Math.cos(ai.yaw);
      beam.light.position.set(ai.x + fx * (ai.front + 0.2), ai.y + ai.spec.headlights.y, ai.z + fz * (ai.front + 0.2));
      beam.light.target.position.set(ai.x + fx * 30, ai.y + (high ? 0.5 : -0.4), ai.z + fz * 30);
      beam.light.intensity = damp(beam.light.intensity, ai.beam * (high ? 1000 : 520), 10, dt);
    }
    // Glare: only lamps that point at the camera and are in view count.
    tmp.set(cam.position.x - ai.x, 0, cam.position.z - ai.z);
    const camDist = Math.max(4, tmp.length());
    const facing = (tmp.x * -Math.sin(ai.yaw) + tmp.z * -Math.cos(ai.yaw)) / camDist;
    const inView = -(tmp.x * camForward.x + tmp.z * camForward.z) / camDist;
    // What dazzles: headlights aimed at you, and - much weaker - your own headlights thrown
    // back by the tail of a car just in front. Nothing dazzles from outside the picture.
    if (inView <= 0.3) continue;
    let power = 0;
    if (facing > 0.3 && on) {
      // A dipped beam dazzles up to "1", a main beam up to "2" (and from further away).
      power = facing ** 3 * (high ? 2 * clamp(1400 / (camDist * camDist + 100), 0, 1) : clamp(700 / (camDist * camDist + 100), 0, 1));
    } else if (facing < 0 && shared.headPower.value > 0.05) {
      tmp.set(ai.x - shared.headPos.value.x, 0, ai.z - shared.headPos.value.z);
      const reach = tmp.length() || 1, inBeam = (tmp.x * shared.headDir.value.x + tmp.z * shared.headDir.value.z) / reach;
      power = 0.3 * Math.min(shared.headPower.value, 1.6) * smoothstep(0.85, 0.97, inBeam) * clamp(260 / (reach * reach + 60), 0, 1);
    }
    if (power <= 0.01) continue;
    const lamps = lampsOf(ai, facing > 0);
    if (camDist > 40 && hiddenByTerrain(cam.position, lamps[0]) && hiddenByTerrain(cam.position, lamps[1])) continue;   // behind a hill (nothing hides a car this close)
    // Where its two lamps are on the screen (0..1 across and up): postfx.js draws its light there.
    lamps[0].project(cam); lamps[1].project(cam);
    dazzlers.push({ id: ai, power, at: [lamps[0].x * 0.5 + 0.5, lamps[0].y * 0.5 + 0.5, lamps[1].x * 0.5 + 0.5, lamps[1].y * 0.5 + 0.5] });
  }
  dazzlers.sort((a, b) => b.power - a.power);
  for (const beam of trafficBeams) if (!beam.owner) beam.light.intensity = damp(beam.light.intensity, 0, 10, dt);
  player.car.updateLights(dt, cam.position);
  player.car.addSmallLights(cam, 0);                                   // your tail and brake lamps (the headlights are real lights)
  smallLights.finish();
}

// ---- Main loop ---------------------------------------------------------------------
const clock = new THREE.Clock();
let menuAngle = 0, orbitSpeed = 0.18;
function tick() {
  requestAnimationFrame(tick);
  runFrame(clamp(clock.getDelta(), 1 / 500, 1 / 30));       // never simulate more than 1/30 s at once
}
// Everything that happens in one frame, dt seconds after the last one.
function runFrame(dt) {
  frame++;
  fitToWindow();
  if (viewWidth === 0) return;
  dazzlers.length = 0;                      // filled again by updateLights() if the game is running

  if (input.wasPressed('pause') && state !== 'menu') {
    if (mapView.open) mapView.toggle(false); else setPaused(state === 'driving');
  }
  if (input.wasPressed('map') && state === 'driving') { mapView.toggle(); if (mapView.open) mapView.drawFull(mapInfo()); }

  if (state === 'driving' && !mapView.open) {
    // After a big crash the world runs in slow motion for a moment.
    slowMo -= dt;
    const simDt = dt * (slowMo > 0 ? 0.28 : 1);
    time += simDt;
    updateDriving(simDt);
  } else if (state === 'menu' && player) {
    // Slow orbit around the car behind the menu.
    menuAngle += dt * orbitSpeed;
    const v = player.vehicle;
    player.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: true }, 1);
    rig.camera.position.set(v.x + Math.sin(menuAngle) * 5.0, v.y + 1.3, v.z + Math.cos(menuAngle) * 5.0);
    rig.camera.lookAt(v.x, v.y + 0.3, v.z);               // a little low, so the car sits above the DRIVE button
    rig.camera.fov = 50; rig.camera.updateProjectionMatrix();
    player.interior.group.visible = false;
    updateLights(dt);
    sky.update(rig.camera, weather.amount);
    tellWeatherWhereTheRoadIs();
    weather.update(dt, rig.camera, tmp.set(0, 0, 0));
  }

  shared.time.value += dt;
  if (sea) sea.update(dt);
  signals.update(dt);
  updateDrawDistance(rig.camera.position);         // only what is near gets drawn (render/drawDistance.js)
  renderer.shadowMap.needsUpdate = true;
  // Car paint and glass mirror the world around your car (one side of the probe per frame).
  if (player) carProbe.update(tmp.copy(player.car.group.position).setY(player.car.group.position.y + 1.1), [player.car.group]);

  // Rear-view mirror: a second, tiny render of the scene (every other frame, cockpit only).
  if (player && rig.mode === 'cockpit' && state === 'driving' && frame % 2 === 0) {
    player.car.group.visible = false;
    renderer.setRenderTarget(rig.mirrorTarget);
    renderer.render(scene, rig.mirrorCamera);
    renderer.setRenderTarget(null);
    player.car.group.visible = true;
  }
  const cockpit = rig.mode === 'cockpit' && state !== 'menu';
  postfx.render(dt, { dazzlers, baseExposure: sky.exposure, rain: weather.amount * (cockpit ? 1 : 0.4), inside: cockpit,
    wiper: weather.wiper, speed: state === 'driving' ? rig.speedFactor : 0 });
  input.endFrame();
}

// Keep the picture the same size as the window (checked every frame so it also
// works when the page was opened in a hidden tab with no size yet).
let viewWidth = 0, viewHeight = 0;
function fitToWindow() {
  const width = window.innerWidth, height = window.innerHeight;
  if (width === viewWidth && height === viewHeight || width === 0 || height === 0) return;
  viewWidth = width; viewHeight = height;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS.maxPixelRatio));
  renderer.setSize(width, height);
  rig.camera.aspect = width / height;
  rig.camera.updateProjectionMatrix();
  postfx.resize(width, height);
}

// ---- Go ----------------------------------------------------------------------------
spawnPlayer(menu.selection.carId, menu.selection.colorIndex);
menu.showMain();
document.getElementById('loading').remove();
// Developer helper (used by the add-car skill): type  speedx.preview('camry')  in the browser
// console while the main menu is open to look at ANY car, lights on, as the camera circles it.
let previewCar = null;
function preview(id) {
  if (previewCar) scene.remove(previewCar.group);
  previewCar = buildCar(ALL_CARS[id], ALL_CARS[id].colors[0]);
  previewCar.group.position.copy(player.car.group.position);
  previewCar.group.rotation.copy(player.car.group.rotation);
  previewCar.setLights({ head: 1 });
  scene.add(previewCar.group);
  player.car.group.visible = false;
}
// speedx.step(120) fast-forwards 120 frames at once (useful when the page is in the background and runs slowly).
const step = (frames = 60) => { for (let i = 0; i < frames; i++) runFrame(1 / 60); };
window.speedx = { preview, step, postfx, audio, setOrbit(angle, speed = 0) { menuAngle = angle; orbitSpeed = speed; }, get player() { return player; }, map, rig, sky, weather, traffic, get rivals() { return rivals; }, challenge, scene, renderer };  // handy in the browser console
tick();
