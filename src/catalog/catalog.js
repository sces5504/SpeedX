// ---------------------------------------------------------------------------
// catalog.js — the catalogue page (catalog.html): everything in the game, to
// browse. Start reading here.
//
// The page has NO data of its own. It loads what the game loads and builds
// things with the game's own functions, so whatever you change in the game —
// a car.json, a building in world/buildings.js, a dial in config.js — is what
// you see here after a reload.
//
//   catalog.js       this file: loads the data, draws the three columns
//                    (sections | items | details) and switches between items
//   viewer.js        the 3D window (one for the whole page)
//   carsPage.js      車輛
//   libraryPage.js   建築與物件 · 植被 · 地表
//   placesPage.js    停靠點 · 交通規則
//   mapsPage.js      地圖
//   charts.js, dom.js, marks.js   small helpers
//
// Every *Page.js file exports  sections(page)  ->  a list of
//   { id, title, items: [{ id, name, tag?, group? }], open(itemId, page) }
// open() fills page.info (and the 3D view) for one item. It may return a
// function, which is called when the user leaves that item.
// The address bar remembers where you are:  catalog.html#cars/fd
// ---------------------------------------------------------------------------
import { ALL_CARS, loadCars } from '../vehicles/carSpecs.js';
import { preloadCarModels } from '../vehicles/carModel.js';
import { loadProps } from '../world/props.js';
import { listMaps } from '../world/mapData.js';
import { createViewer } from './viewer.js';
import { card, el, toggle } from './dom.js';

const $ = (id) => document.getElementById(id);
const fetchJson = async (url) => (await fetch(url)).json();

// ---- 1. Load what the game loads at start-up (see the top of main.js) -------------------
await loadCars();
await Promise.all([preloadCarModels(Object.values(ALL_CARS)), loadProps()]);
const library = await fetchJson('content/props/index.json');       // the texts: what each object, plant, stop and rule is
const mapList = await listMaps();
// Only each map's small map.json for now; the heavy loading happens when a map is opened (mapsPage.js).
const mapInfos = {};
for (const id of mapList.maps) {
  try { mapInfos[id] = await fetchJson(`content/maps/${id}/map.json`); } catch (error) { console.warn(`Map "${id}" could not be read and was skipped:`, error); }
}

// ---- 2. The page object every section works with -------------------------------------------
const viewer = createViewer($('view'));
let visits = 0;
const marksButton = toggle('顯示範圍', false, (on) => viewer.setMarks(on));
$('stage-common').append(toggle('夜間', false, (on) => viewer.setNight(on)), marksButton);
const page = {
  viewer, library, mapList, mapInfos,
  info: $('info'),            // the text below / beside the 3D view
  tools: $('stage-tools'),    // buttons drawn over the 3D view
  showStage(visible) { $('detail').classList.toggle('no-stage', !visible); },
  showMarksButton(visible) { marksButton.hidden = !visible; },
  // For work that takes time:  const stillHere = page.visit();  ...later...  if (stillHere()) show it.
  visit() { const mine = visits; return () => mine === visits; },
};

// ---- 3. The sections. A file that fails to load only loses its own sections. -------------------
const files = [() => import('./carsPage.js'), () => import('./libraryPage.js'), () => import('./placesPage.js'), () => import('./mapsPage.js')];
const sections = [];
for (const load of files) {
  try {
    sections.push(...(await load()).sections(page));
  } catch (error) {
    console.error('A part of the catalogue could not be loaded:', error);
    sections.push({ id: `broken-${sections.length}`, title: '（載入失敗）', items: [{ id: 'error', name: '錯誤訊息' }],
      open: () => { page.showStage(false); page.info.append(card('這個分類載入失敗', el('pre', { class: 'raw' }, String(error.stack || error)))); } });
  }
}

// ---- 4. Columns one and two: the sections and the items of the open section ---------------------
let leave = null;                 // what to call when the open item is left (engine off, timers stopped)

function drawSidebar(current) {
  $('sections').replaceChildren(...sections.map((section) => el('a', { class: section === current ? 'on' : '', href: `#${section.id}` },
    section.title, el('span', {}, String(section.items.length)))));
}
function drawList(section, current) {
  const rows = [];
  let group = null;
  for (const item of section.items) {
    if (item.group && item.group !== group) { group = item.group; rows.push(el('div', { class: 'group' }, group)); }
    rows.push(el('a', { class: item === current ? 'on' : '', href: `#${section.id}/${item.id}` }, el('b', {}, item.name), item.tag && el('small', {}, item.tag)));
  }
  $('list').replaceChildren(el('h2', {}, section.title), ...rows);
  $('list').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

// ---- 5. Open whatever the address bar names ---------------------------------------------------------
function open() {
  const [sectionId, itemId] = decodeURIComponent(location.hash.slice(1)).split('/');
  const section = sections.find((s) => s.id === sectionId) || sections[0];
  const item = section.items.find((i) => i.id === itemId) || section.items[0];
  // Tidy up after the previous item.
  visits++;
  if (leave) { try { leave(); } catch (error) { console.error(error); } leave = null; }
  viewer.clear();
  page.tools.replaceChildren();
  page.info.replaceChildren();
  page.info.scrollTop = 0;
  page.showStage(true);
  page.showMarksButton(false);
  drawSidebar(section);
  drawList(section, item);
  if (!item) { page.showStage(false); page.info.append(card(section.title, el('p', {}, '這個分類目前是空的。'))); return; }
  document.title = `${item.name} · SpeedX 圖鑑`;
  try {
    const result = section.open(item.id, page);
    if (typeof result === 'function') leave = result;
  } catch (error) {
    // The game's files may be half-edited while this page is open: say so instead of going blank.
    console.error(error);
    page.info.append(card('這個項目顯示失敗', el('p', {}, '遊戲的程式或資料可能正在修改中，稍後重新整理再試一次。'), el('pre', { class: 'raw' }, String(error.stack || error))));
  }
}
window.addEventListener('hashchange', open);
open();
$('loading').remove();
window.catalog = { viewer, page, sections };       // handy in the browser console
