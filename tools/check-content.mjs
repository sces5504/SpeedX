// check-content.mjs — checks every car and map folder for mistakes BEFORE you open the game.
//   node tools/check-content.mjs
// Prints one line per problem and exits with an error if there are any.
import fs from 'node:fs';

const problems = [];
const bad = (where, message) => problems.push(`${where}: ${message}`);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file)); } catch (e) { bad(file, 'missing or not valid JSON (' + e.message + ')'); return null; } };
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- Engines and names (hero cars use both) ---------------------------------------------
const engines = readJson('public/content/engines.json')?.engines || {};
const names = readJson('public/content/names.json') || {};
for (const [id, engine] of Object.entries(engines)) {
  if (!Array.isArray(engine.torque) || engine.torque.length < 3) bad('engines/' + id, 'needs "torque" with at least 3 [rpm, Nm] points');
  else if (engine.torque.some((point, k) => k > 0 && point[0] <= engine.torque[k - 1][0])) bad('engines/' + id, '"torque" points must run from low rpm to high rpm');
  if (!isNumber(engine.idle) || !isNumber(engine.redline)) bad('engines/' + id, 'needs "idle" and "redline"');
  for (const key of ['layout', 'aspiration', 'sound']) if (typeof engine[key] !== 'string') bad('engines/' + id, `needs "${key}"`);
  if (!names.engines?.[id]?.name) bad('engines/' + id, 'has no name in names.json (players would see its id)');
}

// ---- Performance parts ----------------------------------------------------------------------
const upgrades = readJson('public/content/upgrades.json') || {};
const EFFECTS = ['torque', 'redline', 'boost', 'spool', 'size', 'kind', 'mass', 'grip', 'brakeG', 'shiftTime', 'extraGear', 'efficiency'];   // what src/vehicles/carSetup.js applies
const partIds = new Set();
for (const group of upgrades.groups || []) {
  for (const option of group.options || []) {
    const where = `upgrades/${group.id}/${option.id}`;
    if (partIds.has(option.id)) bad(where, 'two options share this id'); partIds.add(option.id);
    for (const key of Object.keys(option)) if (key !== 'id' && !EFFECTS.includes(key)) bad(where, `"${key}" is not something a part can change (allowed: ${EFFECTS.join(', ')})`);
    if (option.boost && !['turbo', 'supercharger'].includes(option.kind)) bad(where, 'an option with "boost" needs "kind": "turbo" or "supercharger"');
    if (option.kind === 'turbo' && !isNumber(option.spool)) bad(where, 'a turbo needs "spool" (rpm)');
    if (!names.parts?.[option.id]?.name) bad(where, 'has no name in names.json (players would see its id)');
  }
}
const { ENGINE_PROFILES, VOICES } = await import('../src/audio/audio.js');
const clipList = readJson('public/audio/clips.json') || {};
for (const [name, voice] of Object.entries(VOICES)) for (const entry of voice) if (!clipList[[].concat(entry)[0]]) bad('audio voice ' + name, `clip "${[].concat(entry)[0]}" is not in public/audio/clips.json`);
for (const [name, profile] of Object.entries(ENGINE_PROFILES)) if (!VOICES[profile.voice]) bad('audio profile ' + name, `there is no voice "${profile.voice}"`);
for (const [id, engine] of Object.entries(engines)) {
  if (!ENGINE_PROFILES[engine.sound]) bad('engines/' + id, `"sound": there is no profile "${engine.sound}" in src/audio/audio.js`);
  if (!isNumber(engine.mass)) bad('engines/' + id, 'needs "mass" (kg)');
  for (const kind of engine.fits || []) if (!['turbo', 'supercharger'].includes(kind)) bad('engines/' + id, `"fits": unknown kind "${kind}"`);
}

// ---- Cars ---------------------------------------------------------------------------
const PART_KINDS = ['head', 'tail', 'brake', 'signal', 'reverse', 'black', 'chrome', 'grey', 'smoked', 'red', 'grille', 'mesh', 'paint2'];   // same names as src/vehicles/carEnds.js
const carIndex = readJson('public/content/cars/index.json');
for (const id of carIndex?.cars || []) {
  const dir = `public/content/cars/${id}`, car = readJson(`${dir}/car.json`);
  if (!car) continue;
  if (!['hero', 'traffic'].includes(car.role)) bad(id, 'role must be "hero" or "traffic"');
  for (const key of ['length', 'width', 'height', 'wheelbase', 'frontOverhang', 'wheelRadius', 'mass']) if (!isNumber(car[key])) bad(id, `"${key}" must be a number`);
  if (!Array.isArray(car.colors) || !car.colors.length) bad(id, '"colors" needs at least one "#rrggbb" colour');
  for (const lamp of ['headlights', 'taillights']) for (const key of ['x', 'y', 'w', 'h']) if (!isNumber(car[lamp]?.[key])) bad(id, `"${lamp}.${key}" must be a number`);
  const st = car.stations || [];
  if (st.length < 5) bad(id, '"stations" needs at least 5 rows');
  if (st.length && (st[0][0] !== 0 || st[st.length - 1][0] !== 1)) bad(id, 'stations must run from t = 0 (nose) to t = 1 (tail)');
  for (let i = 1; i < st.length; i++) if (st[i][0] <= st[i - 1][0]) bad(id, `station ${i}: t must increase`);
  const ws = st.findIndex((row) => row[4] === 'ws');
  if (ws < 0) bad(id, 'one station must be marked "ws" (base of the windscreen)');
  else if (!(st[ws + 1]?.[2] > 0)) bad(id, 'the station after "ws" needs a roof height (3rd number)');
  if (car.frontOverhang + car.wheelbase >= car.length) bad(id, 'frontOverhang + wheelbase must be shorter than the car');
  // Optional shape lists: side windows, door cuts, and the parts drawn on the nose and tail.
  const inside = (t) => isNumber(t) && t >= 0 && t <= 1;
  for (const rows of car.windows || []) {
    if (!Array.isArray(rows) || rows.length < 2 || !rows.every((row) => inside(row[0]))) bad(id, 'each of "windows" needs 2 or more rows [t, lo, hi] with t between 0 and 1');
    else if (rows.some((row, k) => k > 0 && row[0] <= rows[k - 1][0])) bad(id, 'the rows of a window must run from front to back (t increasing)');
  }
  if (car.doorLines && !(car.doorLines.length >= 2 && car.doorLines.every(inside))) bad(id, '"doorLines" needs 2 or more positions between 0 and 1');
  for (const end of ['nose', 'tail']) {
    for (const part of car[end] || []) {
      if (!PART_KINDS.includes(part.is)) bad(id, `"${end}": unknown part "${part.is}" (use one of ${PART_KINDS.join(', ')})`);
      const numbers = part.box || part.circle || (part.rows || []).flat();
      if (!numbers.length || !numbers.every(isNumber) || (part.box && part.box.length !== 4) || (part.circle && part.circle.length !== 3)) bad(id, `"${end}": a "${part.is}" part needs "box": [from, to, bottom, top], "circle": [s, y, radius] or "rows": [[s, bottom, top], ...]`);
    }
  }
  for (const part of car.side || []) {
    if (!PART_KINDS.includes(part.is) || !Array.isArray(part.rows) || part.rows.length < 2 || !part.rows.every((row) => row.length === 3 && row.every(isNumber))) bad(id, '"side": each part needs "is" (a finish) and "rows": [[t, low, high], ...] with 2 or more rows');
  }
  if (car.model && !fs.existsSync(`${dir}/${car.model.file}`)) bad(id, `model file "${car.model.file}" not found`);
  // Body parts (kit.json): every option needs a name, and may only touch what src/vehicles/carLook.js allows.
  if (car.kit) {
    const LOOK = ['flares', 'skirts', 'spoiler', 'exhausts', 'lip', 'wheelOut', 'hood', 'roofScoop', 'rimColor', 'twoTone', 'twoToneZone', 'endLift', 'headlights', 'taillights', 'nose', 'tail', 'side'];
    const kit = readJson(`${dir}/kit.json`), shared = readJson('public/content/kits.json')?.groups || {};
    for (const group of kit?.groups || []) if (group.use && !shared[group.use]) bad(`${id}/kit`, `"use": there is no shared group "${group.use}" in content/kits.json`);
    const groups = (kit?.groups || []).map((group) => (group.use && shared[group.use] ? { ...shared[group.use], options: shared[group.use].options.filter((option) => !group.without?.includes(option.id)) } : group)).filter((group) => group.options), groupIds = groups.map((group) => group.id);
    for (const group of groups) {
      for (const option of group.options || []) {
        const where = `${id}/kit/${option.id}`;
        if (!names.parts?.[option.id]?.name) bad(where, 'has no name in names.json (players would see its id)');
        for (const key of Object.keys(option.look || {})) if (!LOOK.includes(key)) bad(where, `"${key}" is not something a body part can change (allowed: ${LOOK.join(', ')})`);
        for (const blocked of option.blocks || []) if (!groupIds.includes(blocked)) bad(where, `"blocks": there is no group "${blocked}" in this kit`);
        for (const end of ['nose', 'tail', 'side']) {
          for (const [slot, parts] of Object.entries(option.look?.[end] || {})) {
            for (const part of parts) if (!PART_KINDS.includes(part.is)) bad(where, `"${end}": unknown part "${part.is}"`);
          }
        }
      }
    }
  }
  if (car.role === 'hero') {
    if (!engines[car.engine]) bad(id, `hero cars need "engine": the id of an engine in engines.json (found ${JSON.stringify(car.engine)})`);
    if (!names.cars?.[id]?.name) bad(id, 'has no name in names.json (players would see its id)');
    for (const swap of car.engineSwaps || []) if (!engines[swap]) bad(id, `"engineSwaps": there is no engine "${swap}" in engines.json`);
    if (car.drive && !['rwd', 'fwd', 'awd'].includes(car.drive)) bad(id, '"drive" must be "rwd", "fwd" or "awd"');
    if (!Array.isArray(car.gears) || car.gears.length < 3 || !isNumber(car.finalDrive)) bad(id, 'hero cars need "gears" (3 or more) and "finalDrive"');
    for (const key of ['frontWeight', 'cgHeight', 'dragArea']) if (!isNumber(car[key])) bad(id, `hero cars need "${key}"`);
    // The look every hero car is held to: its own cabin colours and a finished tail.
    for (const key of ['seats', 'dash', 'carpet', 'accent']) if (!/^#[0-9a-f]{6}$/i.test(car.interior?.[key] || '')) bad(id, `hero cars need "interior.${key}" (a "#rrggbb" colour)`);
    if (!car.gaugeColor) bad(id, 'hero cars need "gaugeColor"');
    if (![1, -1].includes(car.driverSide)) bad(id, 'hero cars need "driverSide" (1 = right-hand drive, -1 = left)');
  }
}
for (const dir of fs.readdirSync('public/content/cars', { withFileTypes: true })) {
  if (dir.isDirectory() && !carIndex?.cars.includes(dir.name)) console.log(`note: cars/${dir.name} exists but is not listed in cars/index.json (switched off)`);
}

// ---- Maps ---------------------------------------------------------------------------
const mapIndex = readJson('public/content/maps/index.json');
if (mapIndex && !mapIndex.maps.includes(mapIndex.default)) bad('maps/index.json', '"default" must be one of "maps"');
const library = readJson('public/content/props/index.json') || {};
const props = library.props || {}, builtIn = library.builtIn || {};
const known = (group, name) => Boolean(props[name] || builtIn[group]?.[name]);
for (const id of mapIndex?.maps || []) {
  const dir = `public/content/maps/${id}`, map = readJson(`${dir}/map.json`);
  if (!map) continue;
  const hm = map.heightmap || {};
  if (!fs.existsSync(`${dir}/${hm.file}`)) bad(id, `height file "${hm.file}" not found`);
  else if (fs.statSync(`${dir}/${hm.file}`).size !== hm.cols * hm.rows * 2) bad(id, 'height file size does not match cols x rows');
  if (!Array.isArray(map.road) || map.road.length < 20) { bad(id, '"road" needs at least 20 [x, z] points'); continue; }
  let length = 0;
  for (let i = 1; i < map.road.length; i++) length += Math.hypot(map.road[i][0] - map.road[i - 1][0], map.road[i][1] - map.road[i - 1][1]);
  if (map.loop) length += Math.hypot(map.road[0][0] - map.road[map.road.length - 1][0], map.road[0][1] - map.road[map.road.length - 1][1]);   // back to the start
  if (length < 1500) bad(id, `road is only ${Math.round(length)} m long (need 1500 m or more)`);
  const ids = new Set();
  for (const poi of map.pois || []) {
    if (ids.has(poi.id)) bad(id, `two pois share the id "${poi.id}"`); ids.add(poi.id);
    if (!builtIn.stops?.[poi.type]) bad(id, `poi "${poi.id}": type must be one of ${Object.keys(builtIn.stops || {}).join(', ')}`);
    if (!(poi.s > 150 && poi.s < length - 150)) bad(id, `poi "${poi.id}": s must be between 150 and ${Math.round(length - 150)}`);
  }
  if (!(map.pois || []).length) bad(id, 'a map needs at least one poi (the start point)');
  if (map.startPoi && !ids.has(map.startPoi)) bad(id, `startPoi "${map.startPoi}" is not one of the pois`);
  for (const kind of map.scenery || []) {
    if (!known('plants', kind.prop)) bad(id, `scenery prop "${kind.prop}" is not in props/index.json`);
  }
  for (const object of map.objects || []) {
    if (!known('objects', object.prop)) bad(id, `object "${object.prop}" is not in props/index.json`);
    if (!(object.s > 0 && object.s < length)) bad(id, `object "${object.prop}": s must be between 0 and ${Math.round(length)}`);
  }
  for (const building of map.buildings || []) {
    if (!builtIn.buildings?.[building.kind]) bad(id, `building kind "${building.kind}" is not in props/index.json`);
    if (!Array.isArray(building.at) && !isNumber(building.s)) bad(id, `a "${building.kind}" building needs "at": [x, z] or "s" (metres along the road)`);
  }
  if (map.ground && !builtIn.grounds?.[map.ground]) bad(id, `ground "${map.ground}" is not in props/index.json`);
  if (map.traffic?.rules && !builtIn.traffic?.[map.traffic.rules]) bad(id, `traffic rules "${map.traffic.rules}" are not in props/index.json`);
  console.log(`map ${id}: ${(length / 1000).toFixed(1)} km${map.loop ? ' loop' : ''}, ${(map.pois || []).length} pois`);
}
for (const [id] of Object.entries(props)) if (!fs.existsSync(`public/content/props/${id}/model.glb`)) bad('props/' + id, 'model.glb not found');

console.log(`cars: ${carIndex?.cars.length || 0}, engines: ${Object.keys(engines).length}, maps: ${mapIndex?.maps.length || 0}, props: ${Object.keys(props).length}`);
if (problems.length) { console.error('\n' + problems.map((p) => 'PROBLEM  ' + p).join('\n')); process.exit(1); }
console.log('All content looks fine.');
