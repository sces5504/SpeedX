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
//   audio/     synthesised sound          ui/  HUD, map, menus, garage
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FEEL, FIRST_TIME, GAMEPLAY, GRAPHICS, ROAD } from './config.js';
import { input } from './core/input.js';
import { clamp, damp, formatTime, smoothstep } from './core/mathUtils.js';
import { loadMap, loadMapInfo, listMaps } from './world/mapData.js';
import { createRoadNet } from './world/roadNet.js';
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
import { ALL_CARS, HERO_CARS, TRAFFIC_CARS, finishSpec, loadCars } from './vehicles/carSpecs.js';
import { setupCar } from './vehicles/carSetup.js';
import { dressCar } from './vehicles/carLook.js';
import { preloadCarModels } from './vehicles/carModel.js';
import { buildCar } from './vehicles/carBuilder.js';
import { createPlayer } from './vehicles/playerCar.js';
import { absorbHit, removeAi, updateAiLights } from './ai/aiCar.js';
import { createTraffic } from './ai/traffic.js';
import { createRivals } from './ai/rivals.js';
import { collideCars } from './game/collisions.js';
import { createChallenge } from './game/challenge.js';
import { save } from './game/save.js';
import { career, loadCareer } from './game/career.js';
import { createActivities } from './game/activities.js';
import { shop } from './game/shop.js';
import { createSpeedTraps } from './game/speedTraps.js';
import { createReplay } from './game/replay.js';
import { rateCar } from './vehicles/carRating.js';
import { createBlacklistScreen } from './ui/blacklist.js';
import { createDealer } from './ui/dealer.js';
import { createDirector } from './render/director.js';
import { createStage } from './world/stage.js';
import { dealerIn, gameIntro, garageIn, garageOut, rollingStart } from './game/scenes.js';
import { blacklistIntro } from './game/blacklistIntros.js';
import { SANDBOX } from './game/save.js';
import { addDevCommands } from './game/devCommands.js';
import { createCameras } from './render/cameras.js';
import { createPostFx } from './render/postfx.js';
import { FILTERS } from './render/filters.js';
import { createSparks } from './render/sparks.js';
import { shared, makeHeadlightCookie } from './render/materials.js';
import { smallLights } from './render/smallLights.js';
import { createCarProbe } from './render/reflections.js';
import { createNavArrows } from './render/navArrows.js';
import { createReplayLook } from './render/replayLook.js';
import { createAudio, soundOf } from './audio/audio.js';
import { createRevTest } from './audio/revTest.js';
import { createShowroom } from './world/showroom.js';
import { createHud } from './ui/hud.js';
import { createMapView } from './ui/mapView.js';
import { createMenu } from './ui/menu.js';
import { createGarage } from './ui/garage.js';
import { createDevConsole } from './ui/devConsole.js';

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
await loadCareer();                             // the career's rules, and a new player's first car (game/career.js)
await Promise.all([preloadCarModels(Object.values(ALL_CARS)), loadProps()]);
const mapList = await listMaps();
const wantedMap = new URLSearchParams(location.search).get('map') || localStorage.getItem('speedx-map');
const map = await loadMap(mapList.maps.includes(wantedMap) ? wantedMap : mapList.default);
const net = createRoadNet(map);                 // finding the way round the map's roads (world/roadNet.js)
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
// Speed cameras ("speedCameras" in map.json) and the recorder that lets a moment be watched again.
const traps = createSpeedTraps(map);
scene.add(traps.group);
pois.neons.push(...traps.neons);
const replay = createReplay();
const replayLook = createReplayLook(scene);     // how a replay is lit (render/replayLook.js)
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
const activities = createActivities();          // the race or timed run in progress, from start to pay-out (game/activities.js)
// Whatever the player was in the middle of is called off: nothing is paid, nothing is lost.
function abandonActivity() {
  if (rivals) rivals.cancelRace();
  challenge.cancel(); challenge.hideGate();
  activities.cancel();
}
const mapView = createMapView(map, (poi) => travelTo(poi), (x, z) => setDestination(x, z));
// Navigation: a place the player picked on the map screen, and the shortest way there from the car.
const nav = { goal: null, route: null };
const navArrows = createNavArrows(scene);       // the way to go, drawn on the road (render/navArrows.js)

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
// (Half the spots are left empty - except a dealership's display spots, which always hold a car that is for sale.)
const parked = pois.parking.filter((spot, i) => spot.who === 'display' || i % 2 === 0).map((spot, i) => {
  const sold = Object.keys(HERO_CARS).filter((id) => shop.carPrice(id) !== null);
  const ids = spot.who === 'traffic' ? Object.keys(TRAFFIC_CARS) : sold;      // (racers park the same cars the dealer sells: never a Blacklist driver's)
  const spec = ALL_CARS[ids[i % ids.length]];
  const car = buildCar(spec, spec.colors[i % spec.colors.length]);
  car.group.position.set(spot.x, spot.y, spot.z);
  car.group.rotation.y = spot.yaw;
  scene.add(drawNear(car.group, GRAPHICS.drawDistance / 2));      // (only drawn when near: a parked car is many pieces)
  return { active: true, x: spot.x, z: spot.z, yaw: spot.yaw, vx: 0, vz: 0, yawRate: 0, mass: 1e6, yawInertia: 1e9,
    halfWidth: car.dims.halfW, front: -car.dims.frontZ, rear: car.dims.rearZ };
});

// Buildings, pumps, columns and lamp posts: solid and immovable, like the parked cars.
const solids = [...parked, ...[...pois.obstacles, ...signals.obstacles, ...traps.obstacles].map((o) => ({ ...o, active: true, vx: 0, vz: 0, yawRate: 0, mass: 1e6, yawInertia: 1e9 }))];

const traffic = createTraffic(scene, map, net);
let player = null, rivals = null;
let state = 'menu';            // 'menu' | 'driving' | 'paused'
let time = 0, frame = 0, impactCooldown = 0, lastCountdown = 0, wasThrottle = 0, lastRaceState = 'none', lastGear = 1;
let idleTime = 0;               // seconds spent standing still with no pedals
let slowMo = 0;                // seconds of slow motion left after a big crash
const startPoi = map.pois.find((poi) => poi.id === map.info.startPoi) || map.pois[0];
let everDriven = false;

// ---- Starting / changing car ----------------------------------------------------
// One of the player's cars as it is driven and drawn: the factory car + the performance parts
// (carSetup.js) + the body parts (carLook.js) kept in the save file. `look`: other body parts
// to show instead (the garage, trying something on).
const setupOf = (carId, look = save.car(carId).look) => dressCar(setupCar(HERO_CARS[carId], save.car(carId).build), look);

function spawnPlayer(carId) {
  // Changing car from the pause menu keeps your place on the road; the first start is at the gas station.
  const previous = player && everDriven ? { s: player.s, dir: playerDirection(), way: player.way } : null;
  if (player) player.dispose();
  if (rivals) for (const ai of rivals.cars) ai.car.dispose();
  player = createPlayer(scene, map, setupOf(carId), save.car(carId).color, rig.mirrorTarget.texture);
  if (previous) player.placeAt(previous.s, previous.way.laneCentre(previous.s, 1), previous.dir, previous.way);
  else player.placeAt(startPoi.s - 30, startPoi.side * (ROAD.barrierOffset + startPoi.shift + 3), 1);       // start in the gas station lot
  player.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: true }, 1);
  rig.snapTo(player);
  abandonActivity();                                           // (a race does not survive a change of car)
  replay.clear();
  rivals = createRivals(scene, map, net, player.spec);
  const info = playerInfo();
  traffic.reset(info, [info]);
  rivals.reset(info, [info, ...traffic.cars]);
}

// Put the car somewhere else on the road (s metres along, d metres right of centre) and restart
// the traffic around it. `name` is shown on arrival.
// way = which road (the main one unless told otherwise).
function teleport(s, d, name, way = map.ways[0]) {
  abandonActivity();
  replay.clear();
  player.placeAt(s, d, 1, way);
  player.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: true }, 1);      // (so the car knows at once which road it is on)
  rig.snapTo(player);
  const info = playerInfo();
  traffic.reset(info, [info]);
  rivals.reset(info, [info, ...traffic.cars]);
  updateNavigation();
  hud.popup(name.toUpperCase(), 'info');
}
// Where the car is along the MAIN road (the time attack is still run along that one road only).
const mainRoadS = () => (player.way === map.ways[0] ? player.s : map.project(player.vehicle.x, player.vehicle.z).s);

// Navigation. Clicking a road on the map screen sets a destination there (clicking it again takes
// it away); the map then shows the shortest way to it from wherever the car is.
function setDestination(x, z) {
  const spot = map.locate(x, z), at = spot.way.pointAt(spot.s, 0);
  const same = nav.goal && Math.hypot(at.x - nav.goal.x, at.z - nav.goal.z) < 60;
  nav.goal = same ? null : { way: spot.way, s: spot.s, x: at.x, z: at.z };
  updateNavigation();
  if (mapView.open) mapView.drawFull(mapInfo());
}
function updateNavigation() {
  nav.route = nav.goal ? net.findRoute({ way: player.way, s: player.s }, nav.goal) : null;
  if (nav.route && nav.route.length < 25) { nav.goal = nav.route = null; hud.popup('ARRIVED', 'info'); }
}

// The way to go, shown where the driver is looking: chevrons on the road and, at the top of the
// screen, the next instruction (turn left in 300 m...). A race's route to its gate comes first,
// otherwise the way to the destination picked on the map.
function showTheWay() {
  const race = rivals.race, racing = race.state === 'racing' && race.route;
  const route = racing ? race.route : nav.route, color = racing ? '#57ff9a' : '#59d7e6';
  navArrows.update(route, net, color, time, racing || frame % 20 === 0);
  if (!route) { hud.setNav(null); return; }
  const first = route.legs[0], turn = net.nextTurn(route);
  const wrongWay = first.way === player.way && first.dir !== playerDirection() && player.vehicle.speed > 2;
  const end = racing ? 'TO THE GATE' : 'DESTINATION';
  if (wrongWay) hud.setNav({ arrow: 'back', metres: route.length, text: 'TURN ROUND', color });
  else if (!turn.side) hud.setNav({ arrow: turn.metres < 150 ? 'end' : 'straight', metres: turn.metres, text: end, color });
  else hud.setNav({ arrow: turn.side < 0 ? 'left' : 'right', metres: turn.metres, text: turn.side < 0 ? 'TURN LEFT' : 'TURN RIGHT', color });
}

// Fast travel from the map screen: into that stop's lot.
function travelTo(poi) {
  teleport(poi.s, poi.side * (ROAD.barrierOffset + poi.shift + 3), poi.name);
  mapView.toggle(false);
}

// Which way along its road the car points: +1 up the road, -1 down.
function playerDirection() {
  const i = Math.max(0, player.vehicle.roadIndex), { road } = player.way;
  const along = -Math.sin(player.vehicle.yaw) * road.tx[i] - Math.cos(player.vehicle.yaw) * road.tz[i];
  return along >= 0 ? 1 : -1;
}

// What AI drivers need to know about the player (also acts as the player's
// stand-in in their "who is ahead of me?" checks).
function playerInfo() {
  const v = player.vehicle, dir = playerDirection();
  return { isPlayer: true, active: true, way: player.way, s: player.s, d: player.d, dir, speed: Math.max(0, v.forwardSpeed),
    x: v.x, z: v.z, vx: v.vx, vz: v.vz, halfWidth: v.halfWidth, front: v.front, rear: v.rear,
    flashing: player.flashing, flashPressed: input.wasPressed('flash'), honking: input.isHeld('horn') };
}

const menu = createMenu({
  // Every installed map with its map.json, for the map cards (only the chosen map is actually built).
  maps: await Promise.all(mapList.maps.map(async (id) => ({ id, info: await loadMapInfo(id) }))),
  currentMap: map.id, mapName: map.info.name,
  onPreview: (carId) => spawnPlayer(carId),
  onPaint: (colorIndex) => paintPlayer(colorIndex),
  onPickMap: (id, name) => {                                   // maps are built at start-up, so: remember the choice and reload
    localStorage.setItem('speedx-map', id);
    document.body.insertAdjacentHTML('beforeend', `<div id="loading">LOADING ${name.toUpperCase()}…</div>`);
    location.search = '?map=' + id;
  },
  onStart: (carId) => {
    if (!player || player.carId !== carId) spawnPlayer(carId);
    audio.start(soundOf(player.spec));
    state = 'driving'; everDriven = true;
    audio.setPaused(false);
    // The very first drive of a career opens with a scene (game/scenes.js); after that, just a reminder.
    const story = save.data.career;
    if (!SANDBOX && !story.introSeen) {
      story.introSeen = true; save.write();
      playScene(gameIntro(player, map.info.name, director.caption), resumeDriving);
    } else {
      hud.show(true);
      hud.banner('SPEEDX', 'flash a racer to race · speed cameras and time attacks earn stars', 4);
    }
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
  // The Blacklist can be read anywhere (entry = the driver to show first), but a driver can only be
  // challenged out on the road. The garage screen opens from the main menu; out on the road, drive into a garage.
  onOpenBlacklist: (entry) => { menu.hidePause(); menu.hideMain(); hud.show(false); blacklistScreen.open(entry); },
  onOpenGarage: () => { menu.hideMain(); garage.open(); enterShowroom(); },
  onMainMenu: () => toMainMenu(),
  volume: () => audio.volume,
  onVolume: (level) => audio.setVolume(level),
});
// Back to the main menu from the road. Whatever was going on is called off; the car stays where it is,
// and DRIVE carries on from there.
function toMainMenu() {
  abandonActivity();
  replay.clear();
  mapView.toggle(false);
  setPaused(false);
  state = 'menu';
  hud.show(false);
  audio.setPaused(true);
  menu.showMain();
}

// ---- The garage's bright room (world/showroom.js) ---------------------------------------------
// While the garage is open the car stands in the showroom scene and the picture is drawn from there.
const showroom = createShowroom();
const revTest = createRevTest();          // the engine being revved in the garage (audio/revTest.js)
let heardSpec = null;                     // the setup whose engine the sound system is playing in the garage
let lightsBefore = 1;
// What the picture is drawn from: the world, or a room of its own (the showroom, the Blacklist stage).
let drawn = scene;
const draw = (what) => { drawn = what; postfx.setScene(what); };
function enterShowroom(theme = 'garage') {
  lightsBefore = player.lightMode;
  player.lightMode = 0;                   // lamps off in the bright room (the LIGHTS button switches them on)
  showroom.theme(theme);
  showroom.show(player.car.group);
  draw(showroom.scene);
}
function leaveShowroom() {
  showroom.hide(scene);
  showroom.release(rig.camera);
  draw(scene);
  player.lightMode = lightsBefore;
  revTest.running = revTest.held = false; revTest.step(0, audio);      // engine off
  audio.setPaused(true);
  garage.showRpm(0);
}
// One frame of the garage: the camera, and the engine if it is being revved.
function updateShowroom(dt) {
  player.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: true }, 1);
  player.interior.group.visible = false;
  showroom.update(dt, rig.camera, input.mouse);
  smallLights.begin(); smallLights.finish();                 // none of the world's lamps reach the showroom
  player.car.updateLights(dt, rig.camera.position);
  const spec = garage.trialSpec, pressing = garage.revHeld || input.isHeld('throttle');
  if (pressing && !revTest.running) revTest.running = true;                 // first press: start the engine
  if (revTest.running && heardSpec !== spec) {                              // ...and whenever another engine or kit is tried, hear THAT one
    heardSpec = spec;
    audio.start(soundOf(spec)).then(() => audio.setPaused(false));
  }
  revTest.setEngine(spec.engine);
  revTest.held = pressing;
  revTest.step(dt, audio);
  garage.showRpm(revTest.rpm);
}

// The same car with other body parts (or the same ones again): the 3D car is built afresh where it stands.
function redressPlayer(look, colorIndex) {
  const v = player.vehicle, place = { x: v.x, z: v.z, yaw: v.yaw, roadIndex: v.roadIndex, way: v.way }, lights = player.lightMode, carId = player.carId;
  player.dispose();
  player = createPlayer(scene, map, setupOf(carId, look), colorIndex, rig.mirrorTarget.texture);
  Object.assign(player.vehicle, place);
  player.lightMode = lights;
  player.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: true }, 1);
  showroom.show(player.car.group);
}
const paintPlayer = (colorIndex) => player.car.setColor(player.spec.colors[colorIndex % player.spec.colors.length]);
const garage = createGarage({
  onSwitchCar: (carId) => { spawnPlayer(carId); player.lightMode = 0; showroom.show(player.car.group); },
  onPaint: paintPlayer,                                        // (also used to show a paint that is only being tried)
  onLook: redressPlayer,                                       // body parts being tried, or put back
  onApply: () => { player.applySetup(setupOf(player.carId)); rivals.playerChanged(player.spec); },     // new parts: the same 3D car drives on with the new numbers
  onLights: () => { player.lightMode = player.lightMode ? 0 : 1; },
  onSection: (sectionId) => showroom.focus(sectionId),          // the camera goes to the part of the car being worked on
  onTravel: () => travelFromGarage(),
  // Leaving: back to the main menu - or, if the car was driven in through a garage's door, out through it again.
  onClose: () => {
    leaveShowroom(); heardSpec = null;
    if (!garageDoor) { menu.showMain(); return; }
    const building = garageDoor;
    garageDoor = null;
    state = 'driving';
    audio.start(soundOf(player.spec));                           // (the engine may not be the one that drove in)
    director.fade(1, 0);
    playScene(garageOut(building, player, director.fade), resumeDriving);
  },
});

// ---- Scenes (render/director.js) and the places they happen at -------------------------------------
const director = createDirector();
const stage = createStage();              // the black stage a Blacklist driver's car is unveiled on (world/stage.js)
let filmLit = false;                      // a scene has asked for the film light (render/replayLook.js): see startBlacklistRace
let garageDoor = null;                    // the garage the car was driven into (null = the garage screen was opened from a menu)
// Play a scene out on the road: the HUD goes away, the car is out of the player's hands, and
// `then` says what happens when it ends (played out or skipped: it is called either way).
function playScene(shots, then, options = {}) {
  hud.show(false); hud.setPrompt('', null);
  director.play(shots, { ...options, onEnd: then });
}
// Hand the car back to the player after a scene.
function resumeDriving() {
  director.fade(0, 0.5);
  state = 'driving';
  hud.show(true);
  rig.snapTo(player);
  audio.setPaused(false);
}
// One frame of a scene: the director moves the camera (and whatever its shots move); the world
// around it is lit and heard as usual, but nobody drives.
function updateScene(dt) {
  if (input.wasPressed('handbrake') || input.wasPressed('pause') || input.wasPressed('interact')) director.skip();
  if (!director.playing) return;
  director.update(dt, rig.camera);
  if (filmLit) replayLook.follow(rig.camera, player.vehicle);
  player.interior.group.visible = false;
  if (drawn !== scene) { smallLights.begin(); smallLights.finish(); return; }       // on the stage: none of the world's lamps
  updateLights(dt);
  sky.update(rig.camera, weather.amount, dt);
  tellWeatherWhereTheRoadIs();
  weather.update(dt, rig.camera, tmp.set(0, 0, 0));
  const v = player.vehicle;
  audio.update({ rpm: v.spec.engine.idle + v.speed * 260, throttle: v.speed > 0.5 ? 0.35 : 0, speed: v.speed, slip: 0, wheelSpin: 0, onGravel: false,
    wet: weather.soak, rain: weather.amount, inside: false, scrape: 0, horn: false, trauma: 0, engineOff: false, shifting: false, redline: v.spec.engine.redline, rival: null });
}

// ---- Speed cameras and replays ------------------------------------------------------------------
// The car has just gone past a speed camera: the flash, the result, and the offer of a replay.
function showSpeedCamera({ camera, kmh, stars, newStars, reputation, money, newBest }) {
  postfx.punch(0.4);
  audio.beep(stars ? 1320 : 660, 0.25, 0.1);
  const earned = [newStars ? `+${reputation} REPUTATION · +$${money.toLocaleString()}` : '', newBest && !newStars ? 'NEW BEST' : ''].filter(Boolean);
  hud.banner(`${kmh} KM/H`, [`${camera.name.toUpperCase()} · ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, ...earned].join(' · '), 4, stars ? '#57ff9a' : '#ffd166');
  replay.mark('speed camera', time);
}
let replayGate = null;                    // where the finish gate of the last race or time attack stood: { s, way } (a replay shows it again)
let replayRush = 0;                       // 0..1 how hard the picture streaks in the replay's present shot
// The finish gate as the game itself needs it right now (a replay borrows the gate, then hands it back).
function restoreGate() {
  const race = rivals.race;
  if (challenge.state === 'running') challenge.showGate(challenge.finishS);
  else if (race.state === 'racing') challenge.showGate(race.finish.s, race.finish.way);
  else challenge.hideGate();
}
function startReplay() {
  if (replay.ready.finish && replayGate) challenge.showGate(replayGate.s, replayGate.way);      // the gate that was crossed is part of the film
  replay.start([...traffic.cars, ...rivals.cars]);
  replayLook.on(player);
  hud.show(false);
  director.bars(true);
  director.caption('REPLAY', 'space · back to the road');
}
function endReplay() {
  replay.stop();
  replayLook.off(player);
  restoreGate();
  director.bars(false); director.caption('');
  hud.show(true);
  rig.snapTo(player);
}
// One frame of a replay: the cars are put where they were and filmed; nothing is driven.
function updateReplay(dt) {
  const sound = input.wasPressed('handbrake') || input.wasPressed('pause') || input.wasPressed('interact') ? null : replay.step(dt, rig.camera);
  if (!sound) { endReplay(); return; }
  replayLook.follow(rig.camera, sound.hero);
  replayRush = sound.rush;
  player.interior.group.visible = false;
  updateLights(dt);
  sky.update(rig.camera, weather.amount, dt);
  weather.update(dt, rig.camera, tmp.set(0, 0, 0));
  audio.update({ rpm: sound.rpm, throttle: sound.throttle, speed: sound.speed, slip: 0, wheelSpin: 0, onGravel: false, wet: weather.soak, rain: weather.amount,
    inside: false, scrape: 0, horn: false, trauma: 0, engineOff: false, shifting: false, redline: player.vehicle.spec.engine.redline, rival: null });
}

// The garage, entered through its door: the scene, then the garage screen.
function enterGarage(building) {
  abandonActivity();
  playScene(garageIn(building, player, director.fade), () => {
    garageDoor = building;
    state = 'menu'; audio.setPaused(true);
    garage.open(true);
    enterShowroom();
    director.fade(0, 0.5);
  });
}
// From the garage screen's TRAVEL button: straight to the map, to be put down at another stop.
function travelFromGarage() {
  leaveShowroom(); heardSpec = null;
  garageDoor.userData.setDoor(0);
  garageDoor = null;
  resumeDriving();
  mapView.toggle(true); mapView.drawFull(mapInfo());
}

// The dealership (ui/dealer.js): the scene, then its screen, with the car being looked at in the showroom.
let forSale = null;                       // that car: a model only (vehicles/carBuilder.js), thrown away when another is looked at
const dealer = createDealer({
  onLook: (carId) => {
    if (forSale) forSale.dispose();
    scene.add(player.car.group);                                 // (the player's own car waits outside, in the world)
    const spec = HERO_CARS[carId];
    forSale = buildCar(spec, spec.colors[0]);
    forSale.group.position.copy(player.car.group.position);
    forSale.group.quaternion.copy(player.car.group.quaternion);
    forSale.setLights({ head: 0 });
    showroom.show(forSale.group);
  },
  onBought: (carId) => { save.data.garage.current = carId; save.write(); },     // the new car is the one to drive away in
  onClose: () => {
    if (forSale) { forSale.dispose(); forSale = null; }
    showroom.show(player.car.group);
    leaveShowroom();
    if (save.data.garage.current !== player.carId) spawnPlayer(save.data.garage.current);
    audio.start(soundOf(player.spec));
    resumeDriving();
  },
});
function enterDealer(building) {
  abandonActivity();
  playScene(dealerIn(building, director.fade), () => {
    state = 'menu'; audio.setPaused(true);
    enterShowroom('dealer');
    dealer.open();
    director.fade(0, 0.5);
  });
}
// One frame of the dealership screen: the camera round the car on show.
function updateDealer(dt) {
  showroom.update(dt, rig.camera, input.mouse);
  smallLights.begin(); smallLights.finish();
  if (forSale) forSale.updateLights(dt, rig.camera.position);
}

// The Blacklist screen (ui/blacklist.js). The driver being looked at has their car on the black stage.
let onShow = null;                        // that car: a model only (vehicles/carBuilder.js), thrown away when another driver is looked at
function clearStage() {
  stage.hide();
  if (onShow) { onShow.dispose(); onShow = null; }
  draw(scene);
}
const blacklistScreen = createBlacklistScreen({
  canRace: () => state !== 'menu' && !activities.current && ['none', 'invite'].includes(rivals.race.state),
  onLook: (entry) => {
    stage.hide();
    if (onShow) onShow.dispose();
    const spec = dressCar(setupCar(HERO_CARS[entry.car], entry.build), entry.look);
    onShow = buildCar(spec, spec.colors[0]);
    onShow.group.position.copy(player.car.group.position);
    onShow.group.quaternion.copy(player.car.group.quaternion);
    onShow.setLights({ head: 0 });                               // (lamps off: their beams would wash out the words under the car)
    stage.tint(entry.colour);
    stage.show(onShow.group);
    stage.set(0.45, 0.5);                                        // half lit (full lamps glare off the black floor), the outline glowing over it
    draw(stage.scene);
  },
  onChallenge: (entry) => { clearStage(); challengeDriver(entry); },
  onClose: () => { clearStage(); if (state === 'paused') { hud.show(true); setPaused(true); } else menu.showMain(); },
});
// One frame of the Blacklist screen: the camera round the car on the stage.
function updateBlacklist(dt) {
  stage.update(dt, rig.camera, input.mouse);
  smallLights.begin(); smallLights.finish();
  if (onShow) onShow.updateLights(dt, rig.camera.position);
}
// A Blacklist driver is challenged: they come to the player, here and now. First their own
// introduction (game/blacklistIntros.js), then the start of the race.
function challengeDriver(entry) {
  setPaused(false);
  const info = playerInfo(), boss = rivals.bring(entry, info);
  if (!rivals.challenge(entry, info)) { hud.popup(rivals.race.message || 'No room to race here', 'info'); return; }
  // (The race now stands at its countdown, which does not run during a scene.)
  const rank = career.blacklist.length - career.blacklist.indexOf(entry);
  director.fade(1, 0.3);
  playScene(blacklistIntro(entry, rank, boss, player, stage, {
    toStage: () => { stage.show(boss.car.group); draw(stage.scene); },
    toRoad: () => { stage.hide(scene); draw(scene); },
    caption: director.caption, fade: director.fade,
  }), () => startBlacklistRace(entry, boss));
}
// The start of a Blacklist race is fair: a ROLLING START (game/scenes.js) in which the game drives
// both cars side by side to the line. It cannot be skipped. Where the road ahead is too short for
// that, the race starts the way a street race does (a rolling 3-2-1, the car in the player's hands).
function startBlacklistRace(entry, boss) {
  const way = player.way, dir = playerDirection();
  if (way.roomAhead(player.s, dir) < 420) { resumeDriving(); return; }
  // Nobody may be in the way: traffic on the stretch ahead is taken off the road (it comes back further on).
  for (const ai of traffic.cars) {
    const ahead = way.ahead(player.s, ai.s) * dir;
    if (ai.active && ai.way === way && ahead > -20 && ahead < 320) removeAi(ai);
  }
  playScene(rollingStart(entry, player, boss, { way, dir, s: player.s }, {
    caption: director.caption, big: director.big,
    beep: (pitch) => audio.beep(pitch, 0.15),
    // Filmed from outside, the two cars are lit as a replay is (render/replayLook.js); behind the wheel, as always.
    filmLight: (on) => { filmLit = on; if (on) replayLook.on(player); else replayLook.off(player); },
    world: (dt) => { const me = playerInfo(); traffic.update(dt, me, [me, ...traffic.cars, ...rivals.cars]); },
  }), () => { resumeDriving(); rivals.go(); }, { skippable: false });
}

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
  if (input.wasPressed('reset')) { player.placeAt(player.s, player.way.laneCentre(player.s, 1), playerDirection(), player.way); rig.snapTo(player); }
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
    if (!ai.active || ai.passArmed === undefined) { ai.passArmed = true; if (!ai.active) return; }
    const relX = ai.x - v.x, relZ = ai.z - v.z, dvx = ai.vx - v.vx, dvz = ai.vz - v.vz;
    const dist = Math.hypot(relX, relZ), closing = Math.hypot(dvx, dvz);
    const pan = clamp((relX * prx + relZ * prz) / 6, -0.8, 0.8);
    if (ai.honk) audio.hornAt(dist, pan);
    if (dist < 130) weather.sprayFrom(ai.x, ai.y, ai.z, ai.vx, ai.vz, ai.speed, dt);
    const untilClosest = closing > 1 ? -(relX * dvx + relZ * dvz) / (closing * closing) : -1;
    // One whoosh per pass: a car may only whoosh again once it has gone by and is well away.
    // (Arming it on distance alone made a fast-closing car whoosh again every frame, dozens of
    // times on top of each other: at speed the whole sound broke up.)
    if (dist > 50 && untilClosest <= 0) ai.passArmed = true;
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
  challenge.update(dt, mainRoadS());
  // Speed cameras, and the recording a replay is cut from (game/speedTraps.js, game/replay.js).
  const caught = traps.update(player, dt);
  if (caught) showSpeedCamera(caught);
  replay.record(dt, time, player, aiCars);
  if (replay.ready && (replay.ready.until ??= time + 12) < time) replay.ready = null;          // the offer stands for twelve seconds
  if (replay.ready && input.wasPressed('replay')) startReplay();
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
    extra: `${Math.round(challenge.remaining)} m` + (challenge.nextTarget ? `  ${'★'.repeat(challenge.nextTarget.stars)} ${formatTime(challenge.nextTarget.time)}` : '') });
  else if (race.state === 'racing') Object.assign(timerInfo, { visible: true, text: formatTime(race.timer),
    extra: `${race.playerProgress >= race.rivalProgress ? 'AHEAD' : 'BEHIND'} ${Math.abs(race.playerProgress - race.rivalProgress).toFixed(0)} m · ${Math.max(0, race.length - race.playerProgress).toFixed(0)} m to go` });
  hud.update(dt, { vehicle: v, lightMode: player.flashing ? 2 : player.lightMode, timer: timerInfo,
    statusLines: [sky.preset.name.toUpperCase() + (weather.raining ? ' · RAIN' : ''), `CAM ${rig.mode.toUpperCase()}`,
      race.wins + race.losses > 0 ? `RACES ${race.wins}W ${race.losses}L` : '',
      `REP ${career.reputation.toLocaleString()} · $${career.money.toLocaleString()}`] });
  if (frame % 20 === 0) updateNavigation();
  showTheWay();
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
      rpm: 2600 + ((ai.speed % 16) / 16) * 4300, throttle: ai.accel > -0.5 ? 0.9 : 0.15, car: (ai.soundCar ??= soundOf(ai.spec)) };
  }
  return best;
}

// What the map screen draws besides the roads: the cars, the finish of a time attack or a race,
// and a route - the shortest way to the race's gate, or else to the player's own destination.
function mapInfo() {
  const race = rivals.race, racing = race.state === 'racing';
  const gate = challenge.state === 'running' ? map.pointAt(challenge.finishS, 0) : racing ? race.finish.way.pointAt(race.finish.s, 0) : null;
  const route = racing ? race.route : nav.route;
  return { player: player.vehicle, others: [...traffic.cars, ...rivals.cars].filter((ai) => ai.active), challenge: gate,
    cameras: traps.cameras.map((camera) => ({ x: camera.x, z: camera.z, name: camera.name, stars: traps.record(camera).stars })),
    stopStars: challenge.starsAt,
    route: route ? net.routeLine(route) : null, routeColor: racing ? '#57ff9a' : '#59d7e6', goal: racing ? null : nav.goal };
}

// Banners and beeps for the rival race.
function updateRaceHud() {
  const race = rivals.race;
  if (race.message && race.state === 'none') { hud.popup(race.message, 'info'); race.message = ''; }
  if (race.state === 'invite') hud.setPrompt('F', race.rival.style.ask);
  if (race.state === 'countdown') {
    const count = Math.ceil(race.timer);
    if (count !== lastCountdown && count > 0) { hud.banner(String(count), `RACE · ${race.rival.spec.name} · ${race.rival.rating}`, 0.9, '#ffd166'); audio.beep(660, 0.15); lastCountdown = count; }
  }
  if (race.state !== lastRaceState) {
    // A race is an activity (game/activities.js): it begins with the countdown, is paid out when it is done, and is called off if it just stops.
    // (A Blacklist race's countdown is a scene, so the first this function sees of it may be 'racing'.)
    if (race.state === 'countdown' || (race.state === 'racing' && !activities.current)) activities.begin(race.kind, { entry: race.entry, rivalRating: race.rival.rating, playerRating: rateCar(player.spec).rating, length: race.length });
    if (race.state === 'racing') { hud.banner('GO!', `${(race.length / 1000).toFixed(1)} km to the gate`, 1.6, '#57ff9a'); audio.beep(1320, 0.5); challenge.showGate(race.finish.s, race.finish.way); lastCountdown = 0; }
    if (race.state === 'done') {
      const paid = activities.finish(race.playerWon) || {};
      const won = [paid.money ? `+$${paid.money.toLocaleString()}` : '', paid.reputation ? `+${paid.reputation.toLocaleString()} REPUTATION` : '', paid.car ? `THE ${HERO_CARS[paid.car].name} IS YOURS` : ''].filter(Boolean);
      hud.banner(race.message, race.playerWon ? [formatTime(race.timer), ...won].join(' · ') : 'flash another racer for a rematch', paid.car ? 7 : 4.5, race.playerWon ? '#57ff9a' : '#ff5148');
      challenge.hideGate(); race.message = '';
      // The finish can be watched again. (A race is called 10 m before its gate: the moment marked is the car reaching it.)
      replayGate = { s: race.finish.s, way: race.finish.way };
      replay.mark('race', time + (race.playerWon ? 10 / Math.max(12, player.vehicle.speed) : 0), race.playerWon);
    }
    if (race.state === 'none' && lastRaceState !== 'done' && activities.current?.kind !== 'timeAttack') activities.cancel();
    lastRaceState = race.state;
  }
  // A time attack is an activity too: it keeps races from starting on top of it. Its stars are counted and
  // paid by challenge.js itself (first time per level, like a speed camera's); here they are shown.
  if (challenge.state === 'running') activities.begin('timeAttack');
  else if (activities.current?.kind === 'timeAttack') activities.cancel();
  if (challenge.result) {
    const run = challenge.result;
    challenge.result = null;
    const earned = run.newStars ? `+${run.reputation} REPUTATION · +$${run.money.toLocaleString()}` : run.newBest ? 'NEW BEST' : `best ${formatTime(run.best)}`;
    hud.banner(formatTime(run.time), [`TIME ATTACK · ${'★'.repeat(run.stars)}${'☆'.repeat(3 - run.stars)}`, earned, `${challenge.nearMisses} near misses`].join(' · '), 6, run.stars ? '#57ff9a' : '#ffd166');
    audio.beep(1320, 0.5);
    replayGate = { s: challenge.finishS, way: map.ways[0] };
    replay.mark('time attack', time, true);                    // the run to the gate can be watched again
  }
}

// "Press E" spots: refuel at a pump, start a time attack at a cone.
function updateInteraction(v) {
  let found = null;
  for (const spot of pois.interactables) {
    if (Math.hypot(spot.position.x - v.x, spot.position.z - v.z) < spot.radius && v.speed < 4) found = spot;
  }
  const race = rivals.race;
  if (race.state === 'invite') return;                        // a racer is asking: that prompt has priority (updateRaceHud)
  if (!found || challenge.state === 'running') {
    // Nothing to press E for. Is there a racer near enough to race? A replay to watch?
    if (race.inReach && !activities.current) hud.setPrompt('F', `Flash your lights to race the ${race.inReach.spec.name} · ${race.inReach.rating}`);
    else if (replay.ready) hud.setPrompt('R', 'Watch the replay');
    else hud.setPrompt('', null);
    return;
  }
  hud.setPrompt('E', { fuel: 'Refuel', garage: 'Enter the garage', dealer: 'Enter the dealership' }[found.type] || 'Start time attack (in the direction you are facing)');
  if (!input.wasPressed('interact')) return;
  if (found.type === 'fuel') { v.fuel = 1; hud.popup('TANK FULL', 'info'); audio.beep(520, 0.25); }
  else if (found.type === 'garage') enterGarage(found.object);
  else if (found.type === 'dealer') enterDealer(found.object);
  else if (rivals.race.state === 'none') {
    if (challenge.start(found.poi, mainRoadS(), playerDirection())) {
      // What the clock must show at the gate for one, two and three stars.
      hud.banner('TIME ATTACK', challenge.targets.map((seconds, k) => `${'★'.repeat(k + 1)} ${formatTime(seconds)}`).join('   '), 4, '#ffd166');
      audio.beep(880, 0.3);
    }
    else hud.popup('Not enough road that way — turn around', 'info');
  }
}

// Rain splashes are drawn on the piece of road around your car.
function tellWeatherWhereTheRoadIs() {
  const v = player.vehicle, i = Math.max(0, v.roadIndex), way = player.way;
  const slope = (way.at(way.road.y, player.s + 3) - way.at(way.road.y, player.s - 3)) / 6;
  weather.setGround(v.x, v.y, v.z, way.road.tx[i], way.road.tz[i], slope);
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
      beam.light.intensity = damp(beam.light.intensity, ai.beam * (high ? 1000 : 520) * replayLook.beams, 10, dt);
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

  if (input.wasPressed('pause') && menu.howOpen) menu.closeHow();
  else if (input.wasPressed('pause') && blacklistScreen.isOpen) document.getElementById('btn-blacklist-back').click();
  else if (input.wasPressed('pause') && state !== 'menu' && !director.playing && !replay.playing) {
    if (mapView.open) mapView.toggle(false); else setPaused(state === 'driving');
  }
  if (input.wasPressed('map') && state === 'driving' && !director.playing && !replay.playing) { mapView.toggle(); if (mapView.open) mapView.drawFull(mapInfo()); }

  if (replay.playing) {
    updateReplay(dt);                                // the last few seconds again, as television (game/replay.js)
  } else if (director.playing) {
    updateScene(dt);                                 // a scene has the camera: nobody drives (render/director.js)
  } else if (dealer.isOpen) {
    updateDealer(dt);
  } else if (blacklistScreen.isOpen) {
    updateBlacklist(dt);
  } else if (state === 'driving' && !mapView.open) {
    // After a big crash the world runs in slow motion for a moment.
    slowMo -= dt;
    const simDt = dt * (slowMo > 0 ? 0.28 : 1);
    time += simDt;
    updateDriving(simDt);
  } else if (state === 'menu' && player && garage.isOpen) {
    updateShowroom(dt);
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
  const inShowroom = drawn !== scene;              // the picture is of a room of its own: the showroom, or the Blacklist stage
  if (player) carProbe.update(tmp.copy(player.car.group.position).setY(player.car.group.position.y + 1.1), [player.car.group], drawn);

  // Rear-view mirror: a second, tiny render of the scene (every other frame, cockpit only).
  if (player && rig.mode === 'cockpit' && state === 'driving' && frame % 2 === 0) {
    player.car.group.visible = false;
    renderer.setRenderTarget(rig.mirrorTarget);
    renderer.render(scene, rig.mirrorCamera);
    renderer.setRenderTarget(null);
    player.car.group.visible = true;
  }
  const cockpit = rig.mode === 'cockpit' && state !== 'menu';
  if (inShowroom) postfx.render(dt, { baseExposure: 1, rain: 0, inside: false, wiper: 0, speed: 0 });      // indoors: no rain on the lens, no glare
  else if (replay.playing) {
    // A replay: lit for the camera (render/replayLook.js) - a little brighter, far less dazzle, and the picture streaks as the car goes by.
    const look = GRAPHICS.replay;
    postfx.render(dt, { dazzlers: dazzlers.map((source) => ({ ...source, power: source.power * look.glare })), baseExposure: sky.exposure * look.exposure,
      rain: weather.amount * 0.4, inside: false, wiper: weather.wiper, speed: replayRush });
  } else postfx.render(dt, { dazzlers, baseExposure: sky.exposure, rain: weather.amount * (cockpit ? 1 : 0.4), inside: cockpit,
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
menu.showMain();                 // (first, so the save file names a car that is really installed)
spawnPlayer(save.data.garage.current);
document.getElementById('loading').remove();
// Developer helper (used by the add-car skill): type  speedx.preview('camry')  in the browser
// console while the main menu is open to look at ANY car, lights on, as the camera circles it.
let previewCar = null;
function preview(id) {
  if (previewCar) previewCar.dispose();
  previewCar = buildCar(ALL_CARS[id], ALL_CARS[id].colors[0]);
  previewCar.group.position.copy(player.car.group.position);
  previewCar.group.rotation.copy(player.car.group.rotation);
  previewCar.setLights({ head: 1 });
  scene.add(previewCar.group);
  player.car.group.visible = false;
}
// The developer console (the ~ key): its window is ui/devConsole.js, its commands game/devCommands.js.
const devConsole = createDevConsole();
addDevCommands(devConsole, {
  map, net, nav, weather, sky, hud, travelTo, teleport, playerInfo, setDestination,
  player: () => player, rivals: () => rivals, driving: () => state === 'driving',
  // Another car, there and then: on the road it keeps your place; its engine is the one you hear.
  switchCar: (carId) => { spawnPlayer(carId); if (state === 'driving') audio.start(soundOf(player.spec)); },
  toMainMenu,
});
// speedx.step(120) fast-forwards 120 frames at once (useful when the page is in the background and runs slowly).
const step = (frames = 60) => { for (let i = 0; i < frames; i++) runFrame(1 / 60); };
window.speedx = { preview, step, postfx, audio, save, career, devConsole, garage, showroom, buildCar, finishSpec, setOrbit(angle, speed = 0) { menuAngle = angle; orbitSpeed = speed; }, get player() { return player; }, map, net, nav, signals, pois, director, traps, replay, rig, sky, weather, traffic, get rivals() { return rivals; }, challenge, scene, renderer, stage, menu, activities, blacklistScreen, replayLook, get state() { return state; } };  // handy in the browser console
tick();
