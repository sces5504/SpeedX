// ---------------------------------------------------------------------------
// carsPage.js — the 車輛 (cars) section of the catalogue.
//
// For the chosen car it shows, all taken from the game itself:
//   * the 3D car      buildCar() from vehicles/carBuilder.js, with its colours and its
//                     lamp switchboard; hero cars also get the cockpit (vehicles/interior.js)
//   * the data sheet  every field of public/content/cars/<id>/car.json
//   * the engine      torque and power curves, read with the game's engineTorque()
//   * performance     MEASURED by driving the car in the game's physics
//                     (vehicles/carStats.js — the same code as tools/physics-test.mjs)
//   * the sound       the game's audio.js, revved with a button
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { ALL_CARS } from '../vehicles/carSpecs.js';
import { buildCar } from '../vehicles/carBuilder.js';
import { getCarModel } from '../vehicles/carModel.js';
import { buildInterior } from '../vehicles/interior.js';
import { engineTorque } from '../vehicles/vehiclePhysics.js';
import { measureCar } from '../vehicles/carStats.js';
import { createAudio, ENGINE_PROFILES } from '../audio/audio.js';
import { KEYS, PHYSICS } from '../config.js';
import { add, badge, card, choice, cssColor, el, facts, fmt, svg, toggle } from './dom.js';
import { linePath, niceStep, plot } from './charts.js';

const PS = 735.5;                 // watts in one metric horsepower (the unit the game's menu uses)
let audio = null;                 // the game's sound system, created at the first press of the rev button

export function sections() {
  const cars = Object.values(ALL_CARS).sort((a, b) => (a.role === 'hero' ? 0 : 1) - (b.role === 'hero' ? 0 : 1));   // hero cars first
  return [{
    id: 'cars', title: '車輛',
    items: cars.map((spec) => ({ id: spec.id, name: spec.name, tag: spec.id, group: spec.role === 'hero' ? '主角車 · 可駕駛／對手' : '路人車 · AI 車流' })),
    open: openCar,
  }];
}

function openCar(id, page) {
  const spec = ALL_CARS[id], hero = !!spec.engine;
  const car = buildCar(spec, spec.colors[0]);
  const size = page.viewer.show(car.group, { car, yaw: 2.45 });          // start with a front three-quarter view
  const cockpit = hero ? addCockpit(car, page.viewer) : null;
  const rev = hero ? createRev(spec) : null;

  // ---- Buttons on the 3D view: paint, lamps, inside / outside -------------------------
  const lights = { head: 1, brake: false, left: false, right: false, reverse: false };
  let blink = 0, blinkOn = true;
  const applyLights = () => car.setLights({ ...lights, left: lights.left && blinkOn, right: lights.right && blinkOn, usePool: true });
  const set = (key) => (value) => { lights[key] = value; applyLights(); };
  applyLights();
  const swatches = el('span', { class: 'swatches' }, spec.colors.map((color, i) => el('button', {
    class: 'swatch' + (i === 0 ? ' on' : ''), style: `background:${cssColor(color)}`, title: cssColor(color),
    onclick: (event) => { car.setColor(color); for (const s of swatches.children) s.classList.toggle('on', s === event.currentTarget); },
  })));
  add(page.tools,
    swatches,
    el('span', { class: 'tool-label' }, '大燈'), choice([['關', 0], ['近光', 1], ['遠光', 2]], lights.head, set('head')),
    toggle('煞車', false, set('brake')), toggle('左方向燈', false, set('left')), toggle('右方向燈', false, set('right')), toggle('倒車燈', false, set('reverse')),
    cockpit && choice([['車外', false], ['車內', true]], false, cockpit.setInside),
  );

  // ---- Every frame: blink the indicators, raise pop-up lamps, move the rev needle --------
  page.viewer.onFrame = (dt, camera) => {
    blink += dt;
    const on = blink % 0.7 < 0.35;
    if (on !== blinkOn) { blinkOn = on; if (lights.left || lights.right) applyLights(); }
    car.updateLights(dt, camera.position);
    rev?.step(dt);
    cockpit?.update(rev, dt);
  };

  // ---- The text below the 3D view ------------------------------------------------------------
  add(page.info,
    el('header', { class: 'title' },
      el('h2', {}, spec.name),
      el('p', {}, badge(hero ? '主角車 hero' : '路人車 traffic', hero ? 'good' : ''), spec.year && ` ${spec.year} 年 · `, ` id: ${spec.id}`),
      el('p', { class: 'muted' }, hero ? '玩家可以駕駛，也會以街頭賽車手的身分出現在路上。' : '只由 AI 駕駛的一般車流；沒有引擎資料，也沒有駕駛艙。')),
    hero && performanceCard(spec),
    hero && engineCard(spec),
    hero && rev.card,
    !hero && card('引擎與聲音', el('p', { class: 'muted' }, '這台車的 car.json 沒有 engine / gears / sound：遊戲不模擬它的引擎，所以沒有扭力曲線、實測性能與引擎聲（路人車只有擦身而過的呼嘯聲）。')),
    el('div', { class: 'cards' }, bodyCard(spec, size), chassisCard(spec, hero), hero && gearboxCard(spec), looksCard(spec, cockpit), otherFieldsCard(spec)),
    rawFileCard(spec),
  );

  // Leaving this car: engine off, keys released.
  return () => { rev?.stop(); cockpit?.dispose(); };
}

// ---- Cockpit (hero cars): the driver's-eye view ---------------------------------------------
// Built by the game's buildInterior(). Its rear-view mirror needs a live picture, made here the
// same way render/cameras.js does it: a small camera at the back window, looking backwards.
function addCockpit(car, viewer) {
  let interior;
  const mirror = new THREE.WebGLRenderTarget(384, 104);
  try {
    interior = buildInterior(car, mirror.texture);
  } catch (error) {
    console.warn(`The cockpit of "${car.spec.id}" could not be built:`, error);
    mirror.dispose();
    return null;
  }
  car.body.add(interior.group);
  const mirrorCamera = new THREE.PerspectiveCamera(24, 0.24 / 0.065, 0.5, 600);
  let inside = false;
  return {
    setInside(on) {
      inside = on;
      interior.group.visible = on;
      if (on) viewer.lookFrom(car.body, interior.eye); else viewer.orbit();
    },
    update(rev, dt) {
      interior.update({ rpm: rev.rpm, speed: 0, steerInput: 0, engineOff: !rev.running }, 0, dt);     // the rev counter follows the rev button
      if (!inside) return;
      mirrorCamera.position.copy(interior.mirrorPosition).applyMatrix4(car.body.matrixWorld);
      car.body.getWorldQuaternion(mirrorCamera.quaternion);
      mirrorCamera.rotateY(Math.PI);
      viewer.renderer.setRenderTarget(mirror);
      viewer.renderer.render(viewer.scene, mirrorCamera);
      viewer.renderer.setRenderTarget(null);
    },
    dispose() { mirror.dispose(); },
  };
}

// ---- Measured performance ---------------------------------------------------------------------
function performanceCard(spec) {
  const m = measureCar(spec);
  const tile = (value, unit, label) => el('div', { class: 'tile' }, el('b', {}, value), el('span', {}, unit), el('small', {}, label));
  return card('實測性能',
    el('div', { class: 'tiles' },
      tile(fmt(m.t100, 1), '秒', '0–100 km/h'),
      tile(fmt(m.t160, 1), '秒', '0–160 km/h'),
      tile(fmt(m.top, 0), 'km/h', `極速（第 ${m.topGear} 檔）`),
      tile(fmt(m.brakeDist, 1), 'm', '100–0 km/h 煞車距離'),
      tile(fmt(m.latG, 2), 'g', '過彎橫向加速度')),
    facts([
      ['過彎滑移角', `${fmt(m.maxSlide, 0)}°${m.spun ? '（打轉了）' : ''}`, '第 3 檔約 90 km/h 方向盤打到底'],
      ['全油門出彎', `${fmt(m.powerSlide, 0)}°${m.spunPower ? '（打轉了）' : ''}`, '第 2 檔過彎中油門踩到底的甩尾角度'],
      ['彎中重煞', `${fmt(m.brakeSlideFast, 0)}°／${fmt(m.brakeSlide, 0)}°`, '130 km/h 彎中全力煞車：55 km/h 以上／整段的滑移角（越小越穩）'],
      ['手煞車甩尾', `${fmt(m.handSlide, 0)}°`, '90 km/h 拉一秒手煞車'],
      ['高速轉向', `${fmt(m.turn160, 0)}° ／ ${fmt(m.turn230, 0)}°`, '160／230 km/h 方向盤打到底，2 秒內車頭轉過的角度'],
    ]),
    el('p', { class: 'note' }, '這些不是公式算的：是把這台車放在平坦乾燥路面上，用遊戲真正的物理引擎（vehiclePhysics.js）實際跑出來的，和 ',
      el('code', {}, 'node tools/physics-test.mjs'), ' 用的是同一段程式（carStats.js）。已包含 config.js 的街機化設定：',
      el('code', {}, `powerBoost ×${PHYSICS.powerBoost}　gripBoost ×${PHYSICS.gripBoost}　speedGrip +${Math.round(PHYSICS.speedGrip * 100)}%　brakeBoost ×${PHYSICS.brakeBoost}　gearing ×${PHYSICS.gearing}`),
      '，所以比真車快。'));
}

// ---- Engine: numbers and the torque / power chart ------------------------------------------------
function engineCard(spec) {
  const { idle, redline, torque } = spec.engine;
  // Read the curve the way the physics does, every 50 rpm.
  const curve = [];
  for (let rpm = Math.min(idle, torque[0][0]); rpm <= redline; rpm += 50) curve.push({ rpm, nm: engineTorque(spec, rpm), watts: (engineTorque(spec, rpm) * rpm * 2 * Math.PI) / 60 });
  const peakTorque = curve.reduce((best, p) => (p.nm > best.nm ? p : best)), peakPower = curve.reduce((best, p) => (p.watts > best.watts ? p : best));
  const ps = peakPower.watts / PS;

  // Chart: torque against the left axis (Nm), power against the right axis (PS).
  const xMax = Math.ceil((redline + 300) / 1000) * 1000, nmMax = peakTorque.nm * 1.18, psMax = ps * 1.18;
  const chart = plot({ width: 640, height: 250, xMin: 0, xMax, yMin: 0, yMax: nmMax, xStep: 1000, yStep: niceStep(nmMax), xLabel: (rpm) => String(rpm / 1000), right: 46 });
  const psY = (value) => chart.Y((value / psMax) * nmMax);
  for (let value = 0, step = niceStep(psMax); value <= psMax; value += step) chart.add(svg('text', { x: chart.right + 6, y: psY(value) + 4, class: 'axis power' }, String(value)));
  chart.add(
    svg('rect', { x: chart.X(redline), y: chart.top, width: chart.right - chart.X(redline), height: chart.bottom - chart.top, class: 'redzone' }),
    svg('line', { x1: chart.X(redline), x2: chart.X(redline), y1: chart.top, y2: chart.bottom, class: 'redline' }),
    svg('path', { d: linePath(curve.map((p) => [chart.X(p.rpm), psY(p.watts / PS)])), class: 'line power' }),
    svg('path', { d: linePath(curve.map((p) => [chart.X(p.rpm), chart.Y(p.nm)])), class: 'line torque' }),
    torque.filter(([rpm]) => rpm <= xMax).map(([rpm, nm]) => svg('circle', { cx: chart.X(rpm), cy: chart.Y(nm), r: 3.5, class: 'dot torque' })),     // the points written in car.json
    svg('text', { x: chart.left + 6, y: chart.top + 12, class: 'axis torque', 'text-anchor': 'start' }, 'Nm'),
    svg('text', { x: chart.right + 6, y: chart.top + 8, class: 'axis power', 'text-anchor': 'start' }, 'PS'),
    svg('text', { x: chart.left + 6, y: chart.bottom - 7, class: 'axis', 'text-anchor': 'start' }, '轉速 ×1000 rpm →'),
  );
  return card('引擎',
    facts([
      ['最大扭力', `${fmt(peakTorque.nm, 0)} Nm @ ${peakTorque.rpm} rpm`],
      ['最大馬力', `${fmt(ps, 0)} PS（${fmt(peakPower.watts / 1000, 0)} kW）@ ${peakPower.rpm} rpm`],
      ['馬力重量比', `${fmt(spec.mass / ps, 1)} kg/PS`],
      ['怠速／紅線', `${idle} ／ ${redline} rpm`],
    ]),
    el('div', { class: 'chart-title' }, '原廠曲線：', el('b', { class: 'torque' }, '━ 扭力 Nm（左軸，圓點是 car.json 的 engine.torque 資料點）'), '　', el('b', { class: 'power' }, '━ 由它換算的馬力 PS（右軸）')),
    chart.node,
    el('p', { class: 'note' }, `圖上是真車的原廠數字。遊戲裡引擎扭力會再乘上 PHYSICS.powerBoost（目前 ×${PHYSICS.powerBoost}），`
      + `等於最大約 ${fmt(peakTorque.nm * PHYSICS.powerBoost, 0)} Nm／${fmt(ps * PHYSICS.powerBoost, 0)} PS——上面的「實測性能」就是用這個跑出來的。`));
}

// ---- Engine sound you can rev ------------------------------------------------------------------------
// The rpm is acted out here (up while the button is held, back to idle when released) and fed
// to the game's own audio.update(), which makes the sound exactly as it does while driving.
function createRev(spec) {
  const { idle, redline } = spec.engine, sweep = redline - idle;
  const profile = ENGINE_PROFILES[spec.sound] ? spec.sound : 'default';
  const rev = { rpm: 0, running: false, held: false, cut: 0 };

  const fill = el('div', { class: 'rev-fill' }), readout = el('b', { class: 'rev-number' }, '0'), status = el('span', { class: 'muted' }, '引擎未發動');
  const bar = el('div', { class: 'rev-bar' }, fill, el('div', { class: 'rev-red', style: `left:${(redline / (redline + 500)) * 100}%` }));
  async function press() {
    rev.held = true;
    if (rev.running) return;
    rev.running = true; rev.rpm = idle * 0.4;
    status.textContent = '載入聲音…';
    try {
      audio ??= createAudio();                    // browsers only allow sound after a click or key press, so it starts here
      window.catalog.audio = audio;               // (for the browser console: catalog.audio.level() = how loud it is right now)
      await audio.start(profile);
      audio.setPaused(false);
      status.textContent = '引擎運轉中';
    } catch (error) {
      console.warn('The sound could not be started:', error);
      status.textContent = '聲音無法啟動（指針仍會動）';
    }
  }
  const release = () => { rev.held = false; };
  const stopEngine = () => { rev.running = false; rev.held = false; status.textContent = '引擎未發動'; };
  const button = el('button', { class: 'rev-button', onpointerdown: (event) => { button.setPointerCapture(event.pointerId); press(); },
    onpointerup: release, onpointercancel: release, oncontextmenu: (event) => event.preventDefault() }, '按住轟油門');

  // The throttle key of the game (W or arrow up, from KEYS in config.js) works too.
  const typing = (event) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
  const keyDown = (event) => { if (KEYS.throttle.includes(event.code) && !typing(event)) { event.preventDefault(); if (!event.repeat) press(); } };
  const keyUp = (event) => { if (KEYS.throttle.includes(event.code)) release(); };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', release);

  const voice = ENGINE_PROFILES[profile];
  rev.card = card('引擎聲',
    el('div', { class: 'rev' }, button, el('button', { class: 'tool', onclick: stopEngine }, '熄火'), el('div', { class: 'rev-meter' }, bar, el('div', {}, readout, ' rpm　', status))),
    el('p', { class: 'note' }, '按住按鈕（或按住鍵盤 W／↑）轉速會衝向紅線並在斷油點彈跳，放開就落回怠速。聲音由遊戲的 audio.js 即時產生：四段真車錄音依轉速混合，再加上排氣失真、渦輪與回火。'),
    facts([
      ['聲音設定', spec.sound ? `${spec.sound}` : '（car.json 沒有指定，使用 default）', spec.sound && !ENGINE_PROFILES[spec.sound] ? 'audio.js 裡沒有這個名字，遊戲會改用 default' : 'ENGINE_PROFILES，在 src/audio/audio.js'],
      ['音高', `×${voice.pitch}`, '大於 1 = 聲音較高、像較小的引擎'],
      ['排氣', `亮度 ${voice.tone} Hz · 失真 ${voice.drive} · 諧波 ${voice.buzz}（第 ${voice.order} 階）`],
      ['渦輪', voice.turbo > 0 ? `有（哨音與洩壓聲 ×${voice.turbo}）` : '無'],
      ['機械增壓', voice.supercharger > 0 ? `有（×${voice.supercharger}）` : '無'],
      ['回火機率', `收油 ${Math.round(voice.backfire[0] * 100)}% · 全油門升檔 ${Math.round(voice.backfire[1] * 100)}%`],
      ['音量', `×${voice.volume}`],
    ]));

  // Called every frame.
  rev.step = (dt) => {
    if (!rev.running) rev.rpm = Math.max(0, rev.rpm - sweep * dt * 1.5);                    // switched off: the needle drops to zero
    else if (rev.cut > 0) { rev.cut -= dt; rev.rpm -= sweep * dt * 0.9; }                    // on the limiter: fuel cut for a moment
    else if (rev.held) { rev.rpm += (sweep * dt) / 1.1; if (rev.rpm >= redline) { rev.rpm = redline; rev.cut = 0.07; } }
    else rev.rpm = Math.max(idle, rev.rpm - (sweep * dt) / 1.6);
    fill.style.width = `${(rev.rpm / (redline + 500)) * 100}%`;
    fill.classList.toggle('hot', rev.rpm > redline * 0.93);
    readout.textContent = String(Math.round(rev.rpm / 10) * 10);
    // The same call main.js makes every frame, for a car standing still in dry weather.
    audio?.update({ rpm: Math.max(rev.rpm, idle * 0.5), throttle: rev.running && rev.held && rev.cut <= 0 ? 1 : 0, speed: 0, slip: 0, wheelSpin: 0, onGravel: false,
      wet: 0, rain: 0, inside: false, scrape: 0, horn: false, trauma: 0, engineOff: !rev.running, shifting: false, redline, rival: null });
  };
  // Called when the user leaves this car.
  rev.stop = () => {
    stopEngine();
    rev.step(0);                                  // tells the sound system the engine is off
    audio?.setPaused(true);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', release);
  };
  return rev;
}

// ---- Data-sheet cards ---------------------------------------------------------------------------------
const metres = (value, digits = 3) => `${fmt(value, digits)} m`;

function bodyCard(spec, size) {
  return card('車身尺寸',
    facts([
      ['長 × 寬 × 高', `${metres(spec.length)} × ${metres(spec.width)} × ${metres(spec.height)}`],
      ['軸距', metres(spec.wheelbase)],
      ['前懸', metres(spec.frontOverhang), `後懸 ${metres(spec.length - spec.frontOverhang - spec.wheelbase)}`],
      ['輪胎半徑', metres(spec.wheelRadius), `直徑 ${fmt(spec.wheelRadius * 200, 0)} cm`],
      ['離地高', metres(spec.clearance, 2)],
      ['車頂內縮 tumble', fmt(spec.tumble, 2), '車頂寬 ÷ 車身寬（0.72 跑車 … 0.95 廂型車）'],
      ['3D 模型實測', `${fmt(size.size.z, 2)} × ${fmt(size.size.x, 2)} × ${fmt(size.size.y, 2)} m`, `長 × 寬（含後視鏡）× 高 · ${size.triangles.toLocaleString()} 個三角形 · ${size.meshes} 個零件`],
      ['模型來源', getCarModel(spec.id) ? `模型檔 ${spec.model?.file}` : '程式生成', getCarModel(spec.id) ? '' : `由 car.json 的 ${spec.stations.length} 個側面輪廓點（stations）拉出車殼`],
    ]));
}

function chassisCard(spec, hero) {
  const front = Math.round(spec.frontWeight * 100);
  return card('重量與抓地',
    facts([
      ['車重', `${spec.mass} kg`],
      hero && ['前後配重', `${front} : ${100 - front}`, 'frontWeight'],
      hero && ['重心高度', metres(spec.cgHeight, 2), 'cgHeight：越高，加速煞車時重量轉移越多'],
      hero && ['風阻面積 CdA', `${fmt(spec.dragArea, 2)} m²`, 'dragArea：決定極速'],
      hero && ['輪胎抓地 grip', `×${fmt(spec.grip, 2)}`, `遊戲內再乘上 gripBoost ×${PHYSICS.gripBoost}`],
      hero && ['煞車力 brakeG', `${fmt(spec.brakeG, 2)} g`, `遊戲內再乘上 brakeBoost ×${PHYSICS.brakeBoost}`],
      !hero && ['物理', '路人車只用車重（碰撞時）', '配重、抓地、煞車等欄位只有主角車需要'],
    ]));
}

function gearboxCard(spec) {
  return card('變速箱',
    el('table', { class: 'table' },
      el('tr', {}, el('th', {}, '檔位'), spec.gears.map((_, i) => el('th', {}, String(i + 1))), el('th', {}, '終傳')),
      el('tr', {}, el('td', {}, '齒比'), spec.gears.map((ratio) => el('td', {}, fmt(ratio, 3))), el('td', {}, fmt(spec.finalDrive, 2)))),
    el('p', { class: 'note' }, `後輪驅動，自動排檔（接近紅線升檔，油門踩到底會降檔）。遊戲把總齒比乘上 PHYSICS.gearing（目前 ×${PHYSICS.gearing}，小於 1 = 每一檔都能跑得更快）。`));
}

function looksCard(spec, cockpit) {
  const H = spec.headlights || {}, T = spec.taillights || {}, cabin = spec.interior;
  const lamp = (l) => `${fmt(l.w, 2)} × ${fmt(l.h, 2)} m · 高度 ${fmt(l.y, 2)} m · 距中心 ${Math.round(l.x * 100)}% 半車寬`;
  return card('外觀與座艙',
    facts([
      ['車色', el('span', { class: 'chips' }, spec.colors.map((color) => el('span', { class: 'chip', style: `background:${cssColor(color)}`, title: cssColor(color) }))), `${spec.colors.length} 色，第一個是預設`],
      spec.twoTone !== undefined && ['雙色下半部', el('span', { class: 'chips' }, el('span', { class: 'chip', style: `background:${cssColor(spec.twoTone)}` })), cssColor(spec.twoTone)],
      ['頭燈', lamp(H), H.popup ? '跳燈（開燈時升起）' : '固定式'],
      ['尾燈', lamp(T), [T.style === 'round' ? '圓形三連燈' : T.h > T.w ? '直立式' : '橫條式', T.garnish && `中間飾板：${T.garnish}`].filter(Boolean).join(' · ')],
      ['車門', `${spec.doors ?? 2} 門`],
      ['配件', [spec.spoiler && `尾翼（高 ${spec.spoiler} m）`, spec.grille && '水箱護罩', spec.moulding && '車側防擦條', spec.exhausts && `排氣管 ×${spec.exhausts}`,
        spec.cargoBox && `貨廂（高 ${spec.cargoBox.bottom}–${spec.cargoBox.top} m）`].filter(Boolean).join('、') || '無'],
      ['駕駛座', spec.driverSide > 0 ? '右駕' : '左駕', cockpit ? `儀表顏色 ${spec.gaugeColor}` : '路人車沒有駕駛艙'],
      cabin && ['內裝配色', el('span', { class: 'chips' }, Object.entries(cabin).filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value)).map(([part, value]) => el('span', { class: 'chip', style: `background:${value}`, title: `${part} ${value}` }))),
        Object.keys(cabin).join(' · ')],
    ]));
}

// Anything in car.json this page has no card for yet (a field added to the game later) still shows up here.
const SHOWN = ['id', 'folder', 'role', 'name', 'year', 'length', 'width', 'height', 'wheelbase', 'frontOverhang', 'wheelRadius', 'clearance', 'tumble', 'mass', 'colors', 'twoTone',
  'stations', 'headlights', 'taillights', 'doors', 'moulding', 'exhausts', 'spoiler', 'grille', 'cargoBox', 'driverSide', 'gaugeColor', 'interior', 'frontWeight', 'cgHeight', 'dragArea',
  'engine', 'gears', 'finalDrive', 'sound', 'grip', 'brakeG', 'model'];
function otherFieldsCard(spec) {
  const others = Object.entries(spec).filter(([key]) => !SHOWN.includes(key));
  return others.length ? card('其他欄位', facts(others.map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]))) : null;
}

// The file itself, fetched again when the box is opened (so it is exactly what is on disk).
function rawFileCard(spec) {
  const text = el('pre', { class: 'raw' }, '載入中…');
  return el('details', { class: 'card', ontoggle: async (event) => {
    if (!event.target.open) return;
    try { text.textContent = await (await fetch(`${spec.folder}car.json`)).text(); } catch (error) { text.textContent = '讀取失敗：' + error.message; }
  } }, el('summary', {}, `原始資料 ${spec.folder}car.json`), text);
}
