// ---------------------------------------------------------------------------
// placesPage.js — two sections of the catalogue about how a map is used:
//
//   停靠點    the roadside stops a map can ask for in its "pois" list (gas
//             station, mini-mart, turnout): what the player can do there, and
//             a 3D sample laid out by the game's own buildPois() (world/pois.js)
//   交通規則  the traffic rule sets a map can pick with "traffic": { "rules": ... }
//
// The texts come from public/content/props/index.json ("builtIn": stops, does,
// traffic); which maps use what comes from each map's map.json.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GAMEPLAY, MPH, ROAD } from '../config.js';
import { add, badge, card, el, facts, fmt } from './dom.js';
import { measureObject } from './viewer.js';
import { MARK_COLORS, boxMark, ringMark } from './marks.js';

// The rule set a map gets when its map.json does not name one.
export const DEFAULT_RULES = 'two-lane';
// Names for the things a stop can offer (the ids are in index.json -> builtIn.does, with their explanations).
export const DOES_NAMES = { travel: '快速移動', fuel: '加油', 'time-attack': '計時賽', parking: '停車位' };
const unique = (list) => [...new Set(list)];
const rulesOf = (info) => info.traffic?.rules ?? DEFAULT_RULES;

export function sections(page) {
  const texts = page.library.builtIn || {}, maps = Object.values(page.mapInfos);
  const stopIds = unique([...Object.keys(texts.stops || {}), ...maps.flatMap((info) => (info.pois || []).map((poi) => poi.type))]);
  const ruleIds = unique([...Object.keys(texts.traffic || {}), ...maps.map(rulesOf)]);
  return [
    { id: 'stops', title: '停靠點', items: stopIds.map((id) => ({ id, name: id })), open: openStop },
    { id: 'traffic', title: '交通規則', items: ruleIds.map((id) => ({ id, name: id })), open: openRules },
  ];
}

// The list of things to do at a stop, e.g. ["travel", "fuel"], as readable lines.
export function doesList(does, page) {
  const meaning = page.library.builtIn?.does || {};
  return el('ul', { class: 'does' }, (does || []).map((id) => el('li', {}, badge(DOES_NAMES[id] || id, 'good'), el('span', {}, meaning[id] || '（index.json 的 does 沒有這一項的說明）'))));
}

// ---- 停靠點 -----------------------------------------------------------------------------------
function openStop(type, page) {
  const about = page.library.builtIn?.stops?.[type];
  // Every place on every map that is this kind of stop.
  const uses = Object.entries(page.mapInfos).flatMap(([mapId, info]) => (info.pois || []).filter((poi) => poi.type === type).map((poi) => ({ mapId, map: info.name || mapId, poi })));
  const built = el('div', { class: 'cards' });
  page.showMarksButton(true);
  add(page.info,
    el('header', { class: 'title' }, el('h2', {}, type), el('p', {}, badge('停靠點')), el('p', { class: 'muted' }, about?.about || 'index.json 的 stops 沒有這一項的說明。')),
    card('玩家在這裡可以做什麼', about?.does?.length ? doesList(about.does, page) : el('p', { class: 'muted' }, '沒有列出功能。')),
    built,
    card('在地圖裡使用',
      el('p', { class: 'muted' }, '寫在 map.json 的 pois 清單裡。s = 希望放在沿路幾公尺處（遊戲會挪到附近最直的一段，並自動選比較平的那一側）；length × depth = 空地的長和深。',
        about?.options?.length ? ` 可以另外設定：${about.options.join('、')}。` : ''),
      el('pre', { class: 'raw' }, `"pois": [\n  ${JSON.stringify(uses[0]?.poi || { id: 'my-stop', type, name: 'My Stop', s: 1000, length: 90, depth: 30 })}\n]`),
      uses.length ? el('ul', { class: 'plain' }, uses.map((use) => el('li', {}, el('a', { href: `#maps/${use.mapId}` }, use.map), `　${use.poi.name} · 約 ${fmt(use.poi.s / 1000, 2)} km 處 · ${use.poi.length} × ${use.poi.depth} m`)))
        : el('p', { class: 'muted' }, '目前沒有地圖用到這種停靠點。')),
  );
  showSampleStop(type, uses[0]?.poi, page, built);
}

// Lay out ONE stop of this type on a straight, flat piece of pretend road, with the game's own
// buildPois(). The road runs away from you along -Z; the stop is on its right (+X).
async function showSampleStop(type, example, page, built) {
  const stillHere = page.visit(), middle = 300;
  const poi = { id: 'sample', name: type, length: 90, depth: 30, ...example, type, s: middle, index: middle / ROAD.step, side: 1 };
  const flatRoad = {
    info: { objects: [] }, road: { length: middle * 2 }, pois: [poi],
    pointAt(s, d, out = {}) { return Object.assign(out, { x: d, y: 0, z: middle - s, tx: 0, tz: -1, yaw: 0 }); },
  };
  try {
    const { buildPois } = await import('../world/pois.js');
    const stop = buildPois(flatRoad);
    if (!stillHere()) return;
    // buildPois also closes both ends of the road with barriers: those are not part of the stop.
    const near = (z) => Math.abs(z) < poi.length / 2 + 30;
    for (const child of [...stop.group.children]) if (!near(child.position.z)) stop.group.remove(child);
    stop.group.add(roadLines(poi.length + 10));
    // Outlines for the "顯示範圍" button.
    const marks = new THREE.Group();
    for (const o of stop.obstacles.filter((o) => near(o.z))) marks.add(boxMark(o.x, o.z, o.yaw, o.halfWidth * 2, o.front + o.rear, 1.6, MARK_COLORS.solid));
    for (const spot of stop.interactables) marks.add(ringMark(spot.position.x, spot.position.z, spot.radius, MARK_COLORS.interact));
    for (const bay of stop.parking) marks.add(boxMark(bay.x, bay.z, bay.yaw, 1.8, 4.4, 1.3, MARK_COLORS.parking));
    page.viewer.show(stop.group, {
      lamps: stop.lamps.map((lamp) => ({ ...lamp, at: lamp.position })), neons: stop.neons.map((neon) => ({ ...neon, at: neon.position })), marks, yaw: -1.25 });
    const size = measureObject(stop.group);
    built.replaceChildren(card('實際排出來的樣子',
      facts([
        ['空地大小', `${poi.length} × ${poi.depth} m`, example ? `取自「${example.name}」` : '示範用的大小'],
        ['真正的燈光', `${stop.lamps.length} 盞`],
        ['霓虹光暈', `${stop.neons.length} 處`],
        ['按 E 的地方', el('div', {}, stop.interactables.map((spot) => el('div', {}, badge(spot.label, 'good'), ` 半徑 ${spot.radius} m`)))],
        ['停車位', `${stop.parking.length} 個`, '遊戲會在這裡放停著的車'],
        ['撞得到的實體', `${stop.obstacles.filter((o) => near(o.z)).length} 個`],
        ['三角形', size.triangles.toLocaleString(), `${size.meshes} 個零件`],
      ]),
      el('p', { class: 'note' }, '這是用遊戲的 buildPois()（world/pois.js）在一段筆直的平地上排出來的：道路在左邊（黃線是道路中線），停靠點在右邊。按「顯示範圍」：',
        el('span', { style: `color:${MARK_COLORS.solid}` }, '紅框 = 實體'), '、', el('span', { style: `color:${MARK_COLORS.interact}` }, '綠圈 = 按 E'), '、', el('span', { style: `color:${MARK_COLORS.parking}` }, '黃框 = 停車位'), '。')));
  } catch (error) {
    if (!stillHere()) return;
    console.warn(`The sample "${type}" stop could not be built:`, error);
    page.showStage(false);
  }
}

// Painted lines of the pretend road, so you can tell where the road is: a yellow centre line and
// white edge lines at the real distances from ROAD in config.js.
function roadLines(length) {
  const lines = new THREE.Group();
  const stripe = (x, color) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.25, length).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(x, 0.01, 0);
    lines.add(mesh);
  };
  stripe(0, 0x8a7412); stripe(-ROAD.laneWidth, 0x707070); stripe(ROAD.laneWidth, 0x707070);
  return lines;
}

// ---- 交通規則 ---------------------------------------------------------------------------------
function openRules(id, page) {
  const about = page.library.builtIn?.traffic?.[id];
  page.showStage(false);                                    // nothing to show in 3D
  const kmh = (metresPerSecond) => `${fmt(metresPerSecond * 3.6, 0)} km/h（${fmt(metresPerSecond * MPH, 0)} mph）`;
  const users = Object.entries(page.mapInfos).filter(([, info]) => rulesOf(info) === id);
  add(page.info,
    el('header', { class: 'title' }, el('h2', {}, id), el('p', {}, badge('交通規則'), id === DEFAULT_RULES && badge('預設', 'good')),
      el('p', { class: 'muted' }, about?.about || 'index.json 的 traffic 沒有這條規則的說明。')),
    card('使用這套規則的地圖',
      users.length ? el('table', { class: 'table' },
        el('tr', {}, ['地圖', '規則', '車流數量', '速限'].map((text) => el('th', {}, text))),
        users.map(([mapId, info]) => el('tr', {},
          el('td', {}, el('a', { href: `#maps/${mapId}` }, info.name || mapId)),
          el('td', {}, info.traffic?.rules ? id : `${id}（沒寫，使用預設）`),
          el('td', {}, info.traffic?.count !== undefined ? `${info.traffic.count} 台` : `${GAMEPLAY.trafficCount} 台（預設）`),
          el('td', {}, info.traffic?.speedLimit !== undefined ? kmh(info.traffic.speedLimit) : `${kmh(GAMEPLAY.speedLimit)}（預設）`))))
        : el('p', { class: 'muted' }, '目前沒有地圖使用。')),
    card('在地圖裡使用',
      el('p', { class: 'muted' }, 'map.json 可以（不一定要）加一段 traffic；沒寫的項目就用預設值（GAMEPLAY，在 src/config.js）。speedLimit 的單位是公尺／秒。'),
      el('pre', { class: 'raw' }, `"traffic": ${JSON.stringify({ rules: id, count: GAMEPLAY.trafficCount, speedLimit: GAMEPLAY.speedLimit })}`)),
  );
}
