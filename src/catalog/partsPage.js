// ---------------------------------------------------------------------------
// partsPage.js — the tuning sections of the catalogue.
//
//   引擎        every engine in content/engines.json: its figures, its torque and
//               power curves, and a rev button to LISTEN to it - bare, or with a
//               turbo or supercharger kit fitted (the whistle, blow-off or whine
//               you would get in the garage).
//   外觀套件    for every car that has a kit.json: the car in 3D with a row of
//               choices per group of body parts, so each bumper, lamp, wing and
//               livery can be looked at on the car it was made for.
//
// As everywhere in the catalogue nothing is described twice: the engine cards and
// the rev button are the cars page's own (carsPage.js), parts are fitted with the
// game's own setupCar / dressCar, and the car is built by the game's buildCar().
// ---------------------------------------------------------------------------
import { ENGINES, HERO_CARS, UPGRADES, nameOf } from '../vehicles/carSpecs.js';
import { engineWithParts } from '../vehicles/carSetup.js';
import { dressCar, fitLook, fittedLook, lookGroups, takenOverBy } from '../vehicles/carLook.js';
import { buildCar } from '../vehicles/carBuilder.js';
import { peakPowerPs } from '../vehicles/carStats.js';
import { createRev, engineCard } from './carsPage.js';
import { add, badge, card, choice, cssColor, el, facts, fmt } from './dom.js';

const FAMILY = { I4: '四缸', F4: '四缸', I6: '六缸', F6: '六缸', V6: '六缸', V8: 'V8', V10: 'V10 · V12 · W16', V12: 'V10 · V12 · W16', W16: 'V10 · V12 · W16', R2: '轉子', R3: '轉子' };
const ASPIRATION = { na: '自然進氣', turbo: '渦輪增壓', supercharged: '機械增壓', diesel: '柴油' };
const partName = (id) => nameOf('parts', id);

export function sections() {
  const engines = Object.values(ENGINES).sort((a, b) => Object.keys(FAMILY).indexOf(a.layout) - Object.keys(FAMILY).indexOf(b.layout));
  const kitted = Object.values(HERO_CARS).filter((car) => lookGroups(car).length);
  return [
    { id: 'engines', title: '引擎', open: openEngine,
      items: engines.map((engine) => ({ id: engine.id, name: engine.fullName, tag: `${Math.round(peakPowerPs({ engine }))} PS · ${engine.id}`, group: FAMILY[engine.layout] || engine.layout })) },
    { id: 'kits', title: '外觀套件', open: openKit,
      items: kitted.map((car) => ({ id: car.id, name: car.name, tag: `${lookGroups(car).reduce((n, group) => n + group.options.length, 0)} 個零件 · ${car.id}` })) },
  ];
}

// ---- 引擎: one engine, its curves and its sound -------------------------------------------------
function openEngine(id, page) {
  page.showStage(false);                                   // nothing to look at in 3D: the page is all text, chart and sound
  const engine = ENGINES[id];
  const induction = UPGRADES.groups.find((group) => group.id === 'induction');
  const kits = (induction?.options || []).filter((option) => (engine.fits || []).includes(option.kind));
  const heroes = Object.values(HERO_CARS);
  const stockIn = heroes.filter((car) => car.stockEngine === id), swapsInto = heroes.filter((car) => car.engineSwaps.includes(id));
  let rev = null;
  const body = el('div', {});

  // Show the engine bare ('') or with one forced-induction kit: the curves change, and so does what you hear.
  function show(kitId) {
    rev?.stop();
    const kit = kits.find((option) => option.id === kitId);
    const spec = { engine: engineWithParts(engine, kit ? [kit] : []), sound: engine.sound };
    rev = createRev(spec);
    body.replaceChildren(rev.card, engineCard(spec));
  }
  add(page.info,
    el('header', { class: 'title' },
      el('h2', {}, engine.fullName),
      el('p', {}, badge(`${engine.layout} · ${engine.litres} L`, 'good'), ` ${ASPIRATION[engine.aspiration] || engine.aspiration} · id: ${engine.id}`, engine.realName && ` · 現實對應：${engine.realName}`)),
    card('裝在哪些車上', facts([
      ['原廠搭載', stockIn.map((car) => car.name).join('、') || '沒有車原廠搭載（只能移植）'],
      ['可以移植到', swapsInto.map((car) => car.name).join('、') || '—', 'car.json 的 engineSwaps'],
      ['重量', `${engine.mass} kg`, '移植時，車重會加上和原廠引擎的重量差'],
      ['可加裝的增壓', kits.map((option) => partName(option.id).name).join('、') || '無', 'engines.json 的 fits'],
    ])),
    kits.length > 0 && el('p', {}, el('span', { class: 'tool-label' }, '加裝增壓後聽聽看　'), choice([['原廠', ''], ...kits.map((option) => [partName(option.id).name, option.id])], '', show)),
    body);
  show('');

  // The rev counter and the sound need a tick every frame (the 3D view, which normally gives one, is switched off here).
  let open = true, last = performance.now();
  const tick = (now) => {
    if (!open) return;
    rev.step(Math.min(0.05, (now - last) / 1000));
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { open = false; rev.stop(); };
}

// ---- 外觀套件: one car, every body part it can wear ------------------------------------------------
function openKit(id, page) {
  const stock = HERO_CARS[id], groups = lookGroups(stock);
  let look = {}, color = stock.colors[0], head = 1, car = null;

  function rebuild() {
    car = buildCar(dressCar(stock, look), color);
    page.viewer.show(car.group, { car, yaw: 2.45, keepView: true });
    car.setLights({ head, usePool: true });
    page.viewer.onFrame = (dt, camera) => car.updateLights(dt, camera.position);
    drawChoices();
  }
  // One card per group: the part the car comes with, then each option (its name, and what it is).
  function drawChoices() {
    const fitted = groups.filter((group) => fittedLook(look, group) && !takenOverBy(stock, look, group)).length;
    page.info.replaceChildren(
      el('header', { class: 'title' },
        el('h2', {}, `${stock.name} 的外觀套件`),
        el('p', {}, badge(`${groups.length} 個部位`, 'good'), ` 已裝 ${fitted} 個 · 資料在 ${stock.folder}kit.json（共用零件在 content/kits.json）`),
        el('p', { class: 'muted' }, '點選就會裝到上面的車上。外觀零件不影響性能；這裡只是試看，不會改到遊戲裡的存檔。')),
      ...groups.map((group) => {
        const kit = takenOverBy(stock, look, group), now = fittedLook(look, group);
        if (kit) return card(group.title, el('p', { class: 'muted' }, `由「${partName(kit.id).name}」整組包含。`));
        return card(group.title,
          choice([['原廠', ''], ...group.options.map((option) => [partName(option.id).name, option.id])], now, (optionId) => { look = fitLook(look, group, optionId); rebuild(); }),
          facts(group.options.map((option) => [partName(option.id).full, partName(option.id).is || '', option.id])));
      }));
  }
  add(page.tools,
    el('span', { class: 'swatches' }, stock.colors.map((paint) => el('button', { class: 'swatch', style: `background:${cssColor(paint)}`, title: cssColor(paint), onclick: () => { color = paint; car.setColor(paint); } }))),
    el('span', { class: 'tool-label' }, '大燈'), choice([['關', 0], ['近光', 1]], head, (value) => { head = value; car.setLights({ head, usePool: true }); }),
    el('button', { class: 'tool', onclick: () => { look = {}; rebuild(); } }, '全部還原'));
  rebuild();
}
