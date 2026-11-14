// ---------------------------------------------------------------------------
// libraryPage.js — three sections of the catalogue that show the shared
// library every map is built from (src/world/library.js):
//
//   建築與物件  OBJECTS   built with makeObject(id, options)
//   植被        PLANTS    built from plantParts(id)
//   地表        GROUNDS   shown on a sample hill made by the game's buildTerrain()
//
// What each thing IS comes from the texts in public/content/props/index.json;
// what it DOES (light, glow, solid boxes, press-E) is read off the object the
// game's builder returns — object.userData, see world/buildings.js — and its
// size and triangle count are measured from the real 3D shape.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import * as library from '../world/library.js';
import * as plantFile from '../world/plants.js';
import { getProp } from '../world/props.js';
import { makeGroundTexture } from '../render/materials.js';
import { GRAPHICS } from '../config.js';
import { smoothstep } from '../core/mathUtils.js';
import { add, badge, card, chip, cssColor, el, facts, fmt } from './dom.js';
import { measureGlow, measureObject } from './viewer.js';
import { MARK_COLORS, boxMark, ringMark } from './marks.js';

const OBJECTS = library.OBJECTS || {}, GROUNDS = library.GROUNDS || {};
const PLANTS = library.PLANTS || plantFile.PLANTS || {};
const unique = (list) => [...new Set(list)];

export function sections(page) {
  const texts = page.library.builtIn || {}, models = Object.keys(page.library.props || {});
  const objectIds = unique([...Object.keys(OBJECTS), ...Object.keys(texts.objects || {}), ...Object.keys(texts.buildings || {}), ...models.filter((id) => !PLANTS[id] && !texts.plants?.[id])]);
  const plantIds = unique([...Object.keys(PLANTS), ...Object.keys(texts.plants || {})]);
  const groundIds = unique([...Object.keys(GROUNDS), ...Object.keys(texts.grounds || {})]);
  const item = (id) => ({ id, name: id, tag: getProp(id) ? '模型檔' : '' });
  return [
    { id: 'objects', title: '建築與物件', items: objectIds.map(item), open: openObject },
    { id: 'plants', title: '植被', items: plantIds.map(item), open: openPlant },
    { id: 'grounds', title: '地表', items: groundIds.map((id) => ({ id, name: id })), open: openGround },
  ];
}

// The line every item starts with: its name, where it comes from and what index.json says about it.
function heading(id, about, kind) {
  return el('header', { class: 'title' },
    el('h2', {}, id),
    el('p', {}, badge(kind), ' ', getProp(id) ? badge('模型檔 model.glb 取代內建', 'warn') : badge('程式內建')),
    el('p', { class: 'muted' }, about?.about || 'public/content/props/index.json 裡沒有這一項的說明。'));
}

// Which maps use this, according to their map.json. pick(info) returns the matching entries of one map.
function usedBy(page, pick, describe) {
  const rows = Object.entries(page.mapInfos).flatMap(([mapId, info]) => pick(info).map((entry) => el('li', {}, el('a', { href: `#maps/${mapId}` }, info.name || mapId), '　', describe(entry))));
  return rows.length ? el('ul', { class: 'plain' }, rows) : el('p', { class: 'muted' }, '目前沒有地圖直接用到。');
}

const metres = (v) => `${fmt(v, 2)} m`;

// ---- 建築與物件 ------------------------------------------------------------------------------
function openObject(id, page) {
  const about = page.library.builtIn?.objects?.[id] || page.library.builtIn?.buildings?.[id];      // (town buildings keep their texts under "buildings")
  const options = {};                          // only what the user changed; empty = the game's own defaults
  const details = el('div', { class: 'cards' }), snippet = el('pre', { class: 'raw' });
  let timer = 0;

  function rebuild(keepView = true) {
    const object = library.makeObject(id, options);
    if (!object) {
      page.viewer.clear();
      details.replaceChildren(card('無法建立', el('p', {}, `library.js 的 makeObject("${id}") 沒有回傳東西：這個名字不在 OBJECTS 裡，也沒有同名的模型檔。`)));
      return;
    }
    const { lamps = [], neons = [], solids = [], interact } = object.userData;
    // Outlines for the "顯示範圍" button: what is solid, and where E works.
    const marks = new THREE.Group();
    for (const [x, z, across, along] of solids) marks.add(boxMark(x, z, 0, across, along, 1.6, MARK_COLORS.solid));
    if (interact) marks.add(ringMark(interact.at.x, interact.at.z, interact.radius, MARK_COLORS.interact));
    const size = page.viewer.show(object, { lamps, neons, marks, keepView });
    details.replaceChildren(sizeCard(size, '離路方向（深）× 沿路方向（長）× 高'), glowCard(object, lamps, neons), solidCard(solids, interact, page));
    snippet.textContent = `"objects": [\n  ${JSON.stringify({ prop: id, s: 1200, side: 1, out: 9, ...options })}\n]`;
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(rebuild, 150); };    // wait until the typing or colour-dragging pauses

  page.showMarksButton(true);
  add(page.info,
    heading(id, about, '物件'),
    optionsCard(about?.options || [], options, later),
    details,
    card('在地圖裡使用',
      el('p', { class: 'muted' }, '寫在 map.json 的 objects 清單裡（s = 沿路幾公尺、side = 1 右側／-1 左側、out = 離道路中線幾公尺），可以放在路上任何地方：'),
      snippet,
      usedBy(page, (info) => [...(info.objects || []).filter((entry) => entry.prop === id), ...(info.buildings || []).filter((entry) => entry.kind === id), ...(info.roadside || []).filter((entry) => entry.kind === id)],
        (entry) => (entry.spacing ? `沿路每 ${entry.spacing} m 一個` : entry.s !== undefined ? `${fmt(entry.s / 1000, 2)} km 處` : entry.note || '依真實位置')),
      el('p', { class: 'muted' }, '加油站、商店、休息區等整個停靠點也是用這些物件排出來的，見「停靠點」。')),
  );
  rebuild(false);
  return () => clearTimeout(timer);
}

// The options a map may set for this object (listed in index.json): colour, sign text, switches.
function optionsCard(names, options, changed) {
  if (!names.length) return null;
  // One row per option: { name, input, hint, reset() }.
  const rows = names.map((name) => {
    const set = (value) => { if (value === '' || value === false) delete options[name]; else options[name] = value; changed(); };
    if (['color', 'accent', 'light'].includes(name)) {         // the neon colours
      const hint = el('span', { class: 'muted' }, '遊戲預設');
      const input = el('input', { type: 'color', value: '#57ff9a', oninput: () => { hint.textContent = input.value; set(input.value); } });
      return { name, input, hint, reset: () => { hint.textContent = '遊戲預設'; } };
    }
    if (name === 'mart') return { name, input: el('input', { type: 'checkbox', onchange: (event) => set(event.target.checked) }), hint: el('span', { class: 'muted' }, '24H 招牌與飲料霓虹') };
    return { name, input: el('input', { type: 'text', placeholder: '遊戲預設', maxLength: 24, oninput: (event) => set(event.target.value) }), hint: el('span', { class: 'muted' }, '招牌上的字') };
  });
  const resetAll = () => {                     // (the button's type="reset" empties the boxes themselves)
    for (const key of Object.keys(options)) delete options[key];
    for (const row of rows) row.reset?.();
    changed();
  };
  const form = el('form', { class: 'options', onsubmit: (event) => event.preventDefault() },
    rows.map((row) => el('label', {}, el('code', {}, row.name), row.input, row.hint)),
    el('button', { class: 'tool', type: 'reset', onclick: resetAll }, '還原預設'));
  return card('試試它的選項', el('p', { class: 'muted' }, '地圖可以替這個物件設定的選項。改了就會用遊戲的 makeObject() 重新建一個。'), form);
}

function sizeCard(size, order) {
  return card('實測大小',
    facts([
      ['大小', `${metres(size.size.x)} × ${metres(size.size.z)} × ${metres(size.size.y)}`, order],
      ['三角形', size.triangles.toLocaleString(), `${size.meshes} 個零件`],
    ]),
    el('p', { class: 'note' }, '直接從遊戲建出來的 3D 形狀量的（光束、光暈這類特效不算在內）。'));
}

// Does it shine? Three different ways, all read from the built object.
function glowCard(object, lamps, neons) {
  const glow = measureGlow(object), any = glow.count > 0 || lamps.length > 0 || neons.length > 0;
  const blooms = glow.strongest > GRAPHICS.bloomThreshold;
  const where = (at) => `高 ${fmt(at.y, 1)} m`;
  return card('發光',
    el('p', {}, any ? badge('會發光', 'good') : badge('不發光'), any ? ' 切到「夜間」看得最清楚。' : ' 只會被車燈和路燈照亮。'),
    facts([
      ['自己發亮的表面', glow.count ? `${glow.count} 個，最亮 ${fmt(glow.strongest, 1)}` : '沒有',
        glow.count ? (blooms ? `超過 ${GRAPHICS.bloomThreshold}（GRAPHICS.bloomThreshold）的會在畫面上暈開` : `沒有超過 ${GRAPHICS.bloomThreshold}，所以只是自己亮、不會暈開`) : ''],
      ['真正的燈光 lamps', lamps.length ? el('div', {}, lamps.map((lamp) => el('div', {}, chip(lamp.color), `　亮度 ${fmt(lamp.intensity, 0)} · 照射 ${fmt(lamp.distance, 0)} m · ${where(lamp.at)}`))) : '沒有',
        lamps.length ? '會照亮地面、車子和周圍的東西（遊戲同時只讓最近的 4 盞成為真燈，其餘用小光源代替）' : ''],
      ['霓虹光暈 neons', neons.length ? el('div', {}, neons.map((neon) => el('div', {}, chip(neon.color), `　強度 ${fmt(neon.power, 0)} · ${where(neon.at)}`))) : '沒有',
        neons.length ? '把附近的東西染上這個顏色，在路面上留下倒影（render/smallLights.js）' : ''],
    ]),
    el('p', { class: 'note' }, `招牌、燈板與路燈的亮度都已乘上 GRAPHICS.buildingLights（目前 ${GRAPHICS.buildingLights}）。`));
}

function solidCard(solids, interact, page) {
  const fuel = page.library.builtIn?.does?.[interact?.type];
  return card('碰撞與互動',
    facts([
      ['撞得到的實體 solids', solids.length ? el('div', {}, badge(`${solids.length} 個方塊`, 'bad'), el('div', { class: 'muted' }, solids.map(([, , across, along]) => `${fmt(across, 1)}×${fmt(along, 1)} m`).join('、'))) : '沒有',
        solids.length ? '車撞上去會被擋下來' : '車可以直接開過去'],
      ['按 E 的功能 interact', interact ? el('div', {}, badge(interact.label, 'good'), ` 類型 ${interact.type} · 半徑 ${fmt(interact.radius, 0)} m`) : '沒有', interact ? fuel || '' : ''],
    ]),
    el('p', { class: 'note' }, '按 3D 畫面右上角的「顯示範圍」可以看到：',
      el('span', { style: `color:${MARK_COLORS.solid}` }, '紅框 = 實體'), '、', el('span', { style: `color:${MARK_COLORS.interact}` }, '綠圈 = 按 E 的範圍'), '。'));
}

// ---- 植被 --------------------------------------------------------------------------------------
function openPlant(id, page) {
  const parts = library.plantParts(id);
  add(page.info, heading(id, page.library.builtIn?.plants?.[id], '植物'));
  if (!parts) {
    add(page.info, card('無法建立', el('p', {}, `library.js 的 plantParts("${id}") 沒有回傳東西。`)));
    page.showStage(false);
    return;
  }
  const plant = new THREE.Group();
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    plant.add(mesh);
  }
  const size = page.viewer.show(plant);
  const describePart = (part) => {
    const triangles = (part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count) / 3;
    return `${Math.round(triangles)} 個三角形 · ${part.material.alphaTest > 0 ? '鏤空卡片（貼圖透明的地方不畫）' : '實心'}`;
  };
  add(page.info,
    el('div', { class: 'cards' },
      sizeCard(size, '寬 × 深 × 高（地圖會再隨機縮放）'),
      card('做法', facts(parts.map((part, i) => [`零件 ${i + 1}`, describePart(part)])),
        el('p', { class: 'note' }, measureGlow(plant).count ? '有自發光的部分。' : '不發光、沒有碰撞：只是路邊的景物。遊戲用 InstancedMesh 一次畫出幾千棵（world/scenery.js）。'))),
    card('在地圖裡使用',
      el('p', { class: 'muted' }, '寫在 map.json 的 scenery 清單裡：每公里幾棵、大小倍率、離路邊多遠。'),
      el('pre', { class: 'raw' }, `"scenery": [\n  ${JSON.stringify({ prop: id, perKm: 200, minScale: 0.8, maxScale: 1.6, maxDist: 60 })}\n]`),
      usedBy(page, (info) => (info.scenery || []).filter((entry) => entry.prop === id),
        (entry) => `每公里 ${entry.perKm} 棵 · 大小 ×${entry.minScale}–${entry.maxScale}（高 ${fmt(size.size.y * entry.minScale, 1)}–${fmt(size.size.y * entry.maxScale, 1)} m）· 離路邊 ${entry.minDist ?? 1.5}–${entry.maxDist} m`)),
  );
}

// ---- 地表 --------------------------------------------------------------------------------------
function openGround(id, page) {
  const ground = GROUNDS[id];
  const css = (rgb) => '#' + new THREE.Color(...rgb).getHexString();           // the game's colour as the screen shows it
  const picture = makeGroundTexture();                                          // the tiling dirt-and-stones picture (render/materials.js)
  picture.image.className = 'ground-picture';
  add(page.info, heading(id, page.library.builtIn?.grounds?.[id], '地表'));
  if (!ground) {
    add(page.info, card('找不到', el('p', {}, `library.js 的 GROUNDS 裡沒有 "${id}"。`)));
    page.showStage(false);
    return;
  }
  add(page.info,
    el('div', { class: 'cards' },
      card('兩種顏色',
        facts([
          ['gentle 緩坡', chip(css(ground.gentle), ground.gentle.join(', ')), '平緩的地方：灌木、泥土'],
          ['steep 陡坡', chip(css(ground.steep), ground.steep.join(', ')), '陡峭的地方：岩壁'],
        ]),
        el('p', { class: 'note' }, '山的每一點依坡度在這兩色之間混合（world/terrain.js），再乘上右邊這張泥土碎石圖。3D 畫面是用遊戲的 buildTerrain() 做的一小塊示範山坡：一片平地、一道陡坡、上面一塊台地。')),
      card('細節貼圖', picture.image, el('p', { class: 'note' }, 'makeGroundTexture()：每 9 公尺重複一次，車燈照到時看得到石頭和枯葉。'))),
    card('在地圖裡使用',
      el('pre', { class: 'raw' }, `"ground": "${id}"`),
      usedBy(page, (info) => ((info.ground || 'chaparral') === id ? [info] : []), (info) => (info.ground ? '' : '（沒寫 ground，使用預設）'))),
  );
  showSampleHill(id, page);
  return () => picture.dispose();
}

// A 60 m square of made-up hillside, handed to the game's own terrain builder so the colours,
// the picture and the material are exactly the game's. Only the SHAPE of the hill is invented here.
async function showSampleHill(id, page) {
  const stillHere = page.visit();
  const cols = 41, rows = 41, cell = 1.5, x0 = -30, z0 = -30;
  const carved = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * cell, z = z0 + r * cell;
      const bank = smoothstep(4, -4, x + 3 * Math.sin(z * 0.12));          // 1 on the terrace (left), 0 on the flat (right)
      carved[r * cols + c] = 9 * bank + 0.5 * Math.sin(x * 0.3) * Math.cos(z * 0.25) + 0.6;
    }
  }
  try {
    const { buildTerrain } = await import('../world/terrain.js');
    const hill = buildTerrain({ info: { ground: id }, heightmap: { cols, rows, cell, x0, z0 }, carved, road: { count: 1, x: [0], z: [0] } });
    if (stillHere()) page.viewer.show(hill, { yaw: 0.7 });                              // (unless the user has already moved on)
  } catch (error) {
    console.warn('The sample hill could not be built:', error);
    page.showStage(false);
  }
}
