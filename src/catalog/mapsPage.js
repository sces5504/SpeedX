// ---------------------------------------------------------------------------
// mapsPage.js — the 地圖 (maps) section of the catalogue.
//
// A map is loaded with the game's own loadMap() (world/mapData.js) — the same
// call the game makes at start-up, so the road you see measured here is the
// road you drive: smoothed, resampled every ROAD.step metres, stops slid to
// their final places. Loading reads the height file and carves the terrain,
// which takes a moment, so it only happens when a map is opened.
//
// Shown: a top-down route map, the elevation profile, figures worked out from
// the road samples (roadStats below), and everything map.json asks for:
// stops, scenery, single objects, traffic, ground, city lights.
// ---------------------------------------------------------------------------
import { loadMap } from '../world/mapData.js';
import { GAMEPLAY, MPH, ROAD } from '../config.js';
import { add, badge, card, el, facts, fmt, svg } from './dom.js';
import { linePath, niceStep, plot } from './charts.js';
import { DEFAULT_RULES, DOES_NAMES } from './placesPage.js';

const STOP_COLORS = { gas: '#ff5a4a', mart: '#3ad68a', turnout: '#ffd166' };     // the same colours as the game's map screen
const BEND_RADIUS = 250;          // a piece of road tighter than this many metres counts as a bend
const HAIRPIN_ANGLE = 120;        // ...and a bend that turns the road round by more than this many degrees as a hairpin
const loaded = new Map();         // map id -> promise of the loaded map (each map is only loaded once)

export function sections(page) {
  return [{
    id: 'maps', title: '地圖',
    items: Object.entries(page.mapInfos).map(([id, info]) => ({ id, name: info.name || id, tag: id })),
    open: openMap,
  }];
}

function openMap(id, page) {
  const info = page.mapInfos[id], stillHere = page.visit();
  page.showStage(false);                                    // maps are drawn as 2D charts, not in the 3D studio
  const body = el('div', {}, el('p', { class: 'loading' }, '載入地圖中…（讀取高度檔、整理道路、挖出路基）'));
  add(page.info,
    el('header', { class: 'title' }, el('h2', {}, info.name || id), el('p', {}, badge('地圖'), ` id: ${id} `, page.mapList.default === id && badge('預設地圖', 'good')),
      el('p', { class: 'muted' }, info.source || '')),
    body);
  if (!loaded.has(id)) loaded.set(id, loadMap(id));
  loaded.get(id).then((map) => { if (stillHere()) body.replaceChildren(...describeMap(map, page)); })
    .catch((error) => { console.error(error); loaded.delete(id); body.replaceChildren(card('載入失敗', el('p', {}, String(error.message || error)))); });
}

// ---- Figures worked out from the road samples ---------------------------------------------------
function roadStats(map) {
  const { road } = map, n = road.count, step = ROAD.step;
  const stats = { low: 0, high: 0, climb: 0, descent: 0, steepest: 0, steepestAt: 0, tightestAt: 0, bends: [], railLeft: 0, railRight: 0 };
  let bend = null;
  for (let i = 0; i < n; i++) {
    if (road.y[i] < road.y[stats.low]) stats.low = i;
    if (road.y[i] > road.y[stats.high]) stats.high = i;
    if (i > 0) { const rise = road.y[i] - road.y[i - 1]; if (rise > 0) stats.climb += rise; else stats.descent -= rise; }
    // Slope measured over 20 m, so one bumpy sample does not count as a cliff.
    const a = Math.max(0, i - 5), b = Math.min(n - 1, i + 5), grade = (road.y[b] - road.y[a]) / ((b - a) * step);
    if (Math.abs(grade) > Math.abs(stats.steepest)) { stats.steepest = grade; stats.steepestAt = i; }
    if (Math.abs(road.curve[i]) > Math.abs(road.curve[stats.tightestAt])) stats.tightestAt = i;
    // Bends: a run of samples that all turn the same way, tighter than BEND_RADIUS.
    const turning = Math.abs(road.curve[i]) > 1 / BEND_RADIUS ? Math.sign(road.curve[i]) : 0;
    if (bend && turning !== bend.way) { stats.bends.push(bend); bend = null; }
    if (turning && !bend) bend = { way: turning, start: i, angle: 0 };
    if (bend) bend.angle += Math.abs(road.curve[i]) * step * (180 / Math.PI);      // curvature x distance = how far the heading has turned
    stats.railLeft += road.railL[i] === 1 ? 1 : 0;
    stats.railRight += road.railR[i] === 1 ? 1 : 0;
  }
  if (bend) stats.bends.push(bend);
  stats.radius = 1 / Math.abs(road.curve[stats.tightestAt]);
  stats.hairpins = stats.bends.filter((b) => b.angle > HAIRPIN_ANGLE).length;
  stats.left = stats.bends.filter((b) => b.way > 0).length;        // curve + = turning left
  stats.railLeft /= n; stats.railRight /= n;
  // Height above sea level of the road's start. map.json gives the height of the LOWEST point of
  // the height file; the terrain is stored relative to the start of the road, so the lowest
  // terrain value tells how far the start is above it. (Approximate: carving the road moves some cells.)
  let lowest = Infinity;
  for (const h of map.carved) if (h < lowest) lowest = h;
  stats.startElevation = (map.info.heightmap?.minHeight ?? 0) - lowest;
  return stats;
}

const km = (metres, digits = 2) => `${fmt(metres / 1000, digits)} km`;
const kmh = (metresPerSecond) => `${fmt(metresPerSecond * 3.6, 0)} km/h（${fmt(metresPerSecond * MPH, 0)} mph）`;

function describeMap(map, page) {
  const { info, road } = map, stats = roadStats(map), sea = stats.startElevation;
  const at = (i) => km(i * ROAD.step);
  const stops = map.pois.map((poi, k) => ({ ...poi, number: k + 1 }));
  const stopTexts = page.library.builtIn?.stops || {};
  const hm = info.heightmap || {};

  return [
    el('div', { class: 'map-top' },
      card('路線圖', routeMap(road, stops), el('p', { class: 'note' }, '俯視圖，上方是北。數字是停靠點（見下表），小刻度是每 1 公里。')),
      el('div', {},
        card('道路',
          facts([
            ['長度', `${km(road.length)}（${fmt(road.length / 1609.34, 2)} 英里）`, `${road.count} 個取樣點，每 ${ROAD.step} m 一個`],
            ['最低點', `${fmt(road.y[stats.low], 0)} m`, `在 ${at(stats.low)} · 海拔約 ${fmt(sea + road.y[stats.low], 0)} m`],
            ['最高點', `${fmt(road.y[stats.high], 0)} m`, `在 ${at(stats.high)} · 海拔約 ${fmt(sea + road.y[stats.high], 0)} m`],
            ['總爬升／總下降', `${fmt(stats.climb, 0)} m ／ ${fmt(stats.descent, 0)} m`, '從起點開到終點'],
            ['最陡坡度', `${fmt(Math.abs(stats.steepest) * 100, 1)}%（${stats.steepest > 0 ? '上坡' : '下坡'}）`, `在 ${at(stats.steepestAt)}`],
            ['最急的彎', `半徑 ${fmt(stats.radius, 0)} m（${road.curve[stats.tightestAt] > 0 ? '左彎' : '右彎'}）`, `在 ${at(stats.tightestAt)}`],
            ['彎道數', `${stats.bends.length} 個`, `左 ${stats.left}・右 ${stats.bends.length - stats.left}，其中髮夾彎 ${stats.hairpins} 個（半徑小於 ${BEND_RADIUS} m 算一個彎，一個彎轉超過 ${HAIRPIN_ANGLE}° 算髮夾彎）`],
            ['護欄路段', `左側 ${fmt(stats.railLeft * 100, 0)}%・右側 ${fmt(stats.railRight * 100, 0)}%`, '路邊是下坡懸崖的地方有護欄，其餘是山壁土堤'],
          ]),
          el('p', { class: 'note' }, '高度以道路起點為 0。左右是面向里程增加的方向。')),
        card('路寬', facts([
          ['車道', `${ROAD.laneWidth} m × 2`, '單線雙向'],
          ['柏油路面', `中線到邊緣 ${ROAD.paveHalfWidth} m`, '含路肩'],
          ['碎石路肩', `到 ${ROAD.gravelEdge} m`],
          ['護欄／土堤', `離中線 ${ROAD.barrierOffset} m`, `車身最遠只能到 ${ROAD.driveLimit} m`],
          ['路基', `每側 ${ROAD.bench} m 平地`, `再用 ${ROAD.blend} m 接回山坡`],
        ]), el('p', { class: 'note' }, '這些是所有地圖共用的設定（ROAD，在 src/config.js）。')))),
    card('高度剖面', elevationProfile(map, stops), el('p', { class: 'note' }, `橫軸是沿路距離（km），縱軸是相對起點的高度（m）；起點海拔約 ${fmt(sea, 0)} m。虛線是停靠點。`)),
    card('停靠點', stops.length ? el('table', { class: 'table' },
      el('tr', {}, ['#', '名稱', '類型', '位置', '哪一側', '空地', '可以做什麼'].map((text) => el('th', {}, text))),
      stops.map((poi) => el('tr', {},
        el('td', {}, el('span', { class: 'stop-dot', style: `background:${STOP_COLORS[poi.type] || '#fff'}` }, String(poi.number))),
        el('td', {}, poi.name, ' ', info.startPoi === poi.id && badge('出發點', 'good')),
        el('td', {}, el('a', { href: `#stops/${poi.type}` }, poi.type)),
        el('td', {}, km(poi.s), el('small', {}, `高 ${fmt(road.y[poi.index], 0)} m`)),
        el('td', {}, poi.side > 0 ? '右側' : '左側'),
        el('td', {}, `${poi.length} × ${poi.depth} m`),
        el('td', {}, (stopTexts[poi.type]?.does || []).map((id) => badge(DOES_NAMES[id] || id, 'good'))))))
      : el('p', { class: 'muted' }, '這張地圖沒有停靠點。'),
      el('p', { class: 'note' }, '位置是遊戲實際放的地方：map.json 寫的是「希望」的里程，載入時會挪到附近最直的一段，並自動選比較平的一側。')),
    el('div', { class: 'cards' },
      card('路邊植被 scenery', (info.scenery || []).length ? el('table', { class: 'table' },
        el('tr', {}, ['植物', '每公里', '整條路約', '大小倍率', '離路邊'].map((text) => el('th', {}, text))),
        info.scenery.map((entry) => el('tr', {},
          el('td', {}, el('a', { href: `#plants/${entry.prop}` }, entry.prop)),
          el('td', {}, String(entry.perKm)),
          el('td', {}, `${Math.round((entry.perKm * road.length) / 1000).toLocaleString()} 棵`),
          el('td', {}, `×${entry.minScale}–${entry.maxScale}`),
          el('td', {}, `${entry.minDist ?? 1.5}–${entry.maxDist} m`))))
        : el('p', { class: 'muted' }, '沒有。'),
        info.poles && el('p', { class: 'note' }, `電線桿：${info.poles.prop}，每 ${info.poles.spacing} m 一根。`)),
      card('單獨擺放的物件 objects', (info.objects || []).length ? el('table', { class: 'table' },
        el('tr', {}, ['物件', '位置', '哪一側', '離中線', '選項'].map((text) => el('th', {}, text))),
        info.objects.map(({ prop, s, side = 1, out, turn, ...options }) => el('tr', {},
          el('td', {}, el('a', { href: `#objects/${prop}` }, prop)),
          el('td', {}, km(s)),
          el('td', {}, side > 0 ? '右側' : '左側'),
          el('td', {}, out !== undefined ? `${out} m` : `${ROAD.barrierOffset + 2} m（預設）`),
          el('td', {}, [turn && `轉 ${turn}°`, ...Object.entries(options).map(([key, value]) => `${key}: ${value}`)].filter(Boolean).join(' · ') || '—'))))
        : el('p', { class: 'muted' }, '沒有：這張地圖的建築都在停靠點裡。')),
      card('交通 traffic', facts([
        ['規則', el('a', { href: `#traffic/${info.traffic?.rules ?? DEFAULT_RULES}` }, info.traffic?.rules ?? DEFAULT_RULES), info.traffic?.rules ? '' : 'map.json 沒寫，使用預設'],
        ['車流數量', `${info.traffic?.count ?? GAMEPLAY.trafficCount} 台`, info.traffic?.count !== undefined ? '' : '預設（GAMEPLAY.trafficCount）'],
        ['速限', kmh(info.traffic?.speedLimit ?? GAMEPLAY.speedLimit), info.traffic?.speedLimit !== undefined ? '' : '預設（GAMEPLAY.speedLimit）'],
      ])),
      card('地形與資料',
        facts([
          ['地表', el('a', { href: `#grounds/${info.ground || 'chaparral'}` }, info.ground || 'chaparral'), info.ground ? '' : 'map.json 沒寫，使用預設'],
          ['城市燈火', info.cityLights ? `方向 [${info.cityLights.direction}]・平原高度 ${info.cityLights.level} m` : '沒有', info.cityLights ? '方向 = [東, 南]；高度相對道路起點' : ''],
          ['原點座標', info.origin ? el('a', { href: `https://www.openstreetmap.org/?mlat=${info.origin.lat}&mlon=${info.origin.lon}#map=13/${info.origin.lat}/${info.origin.lon}`, target: '_blank', rel: 'noopener' }, `${info.origin.lat}°, ${info.origin.lon}° ↗`) : '—', '地圖座標 (0, 0) 在真實世界的緯度、經度'],
          ['高度檔', `${hm.file}：${hm.cols} × ${hm.rows} 格，每格 ${hm.cell} m`, `涵蓋 ${fmt((hm.cols * hm.cell) / 1000, 1)} × ${fmt((hm.rows * hm.cell) / 1000, 1)} km，高度精度 ${hm.step} m，最低點海拔 ${fmt(hm.minHeight, 0)} m`],
          ['道路原始資料', `${info.road?.length ?? 0} 個折線點`, '來自 OpenStreetMap，載入時平滑並重新取樣'],
        ]))),
    rawFileCard(map),
  ];
}

// ---- Top-down route map -------------------------------------------------------------------------------
function routeMap(road, stops) {
  // Fit the road into a drawing of at most 560 x 520 units, keeping its true proportions (x = east, z = south).
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < road.count; i++) {
    minX = Math.min(minX, road.x[i]); maxX = Math.max(maxX, road.x[i]);
    minZ = Math.min(minZ, road.z[i]); maxZ = Math.max(maxZ, road.z[i]);
  }
  const pad = 46, room = 120;       // room: space kept free on the right for the names of the stops
  const scale = Math.min(440 / (maxX - minX || 1), 520 / (maxZ - minZ || 1));
  const width = (maxX - minX) * scale + pad * 2 + room, height = (maxZ - minZ) * scale + pad * 2;
  const P = (i) => [pad + (road.x[i] - minX) * scale, pad + (road.z[i] - minZ) * scale];
  const line = [];
  for (let i = 0; i < road.count; i += 2) line.push(P(i));
  line.push(P(road.closed ? 0 : road.count - 1));      // a loop is drawn back to its start
  const node = svg('svg', { viewBox: `0 0 ${width.toFixed(0)} ${height.toFixed(0)}`, class: 'route' },
    svg('path', { d: linePath(line), class: 'road-edge' }), svg('path', { d: linePath(line), class: 'road' }));
  // A tick with its number every kilometre.
  for (let metres = 1000; metres < road.length; metres += 1000) {
    const [x, y] = P(Math.round(metres / ROAD.step));
    node.append(svg('circle', { cx: x, cy: y, r: 2.6, class: 'km' }), svg('text', { x: x + 6, y: y + 4, class: 'km-label' }, String(metres / 1000)));
  }
  const label = (i, text) => { const [x, y] = P(i); node.append(svg('circle', { cx: x, cy: y, r: 5, class: 'end' }), svg('text', { x: x - 10, y: y + 4, 'text-anchor': 'end', class: 'end-label' }, text)); };
  if (road.closed) label(0, `起點＝終點　一圈 ${fmt(road.length / 1000, 1)} km`);
  else { label(0, '起點 0 km'); label(road.count - 1, `終點 ${fmt(road.length / 1000, 1)} km`); }
  for (const poi of stops) {
    const [x, y] = P(poi.index);
    node.append(svg('circle', { cx: x, cy: y, r: 10, fill: STOP_COLORS[poi.type] || '#fff', class: 'stop' }),
      svg('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'stop-number' }, String(poi.number)),
      svg('text', { x: x + 15, y: y + 4, class: 'stop-label' }, poi.name));
  }
  // North arrow and a 1 km scale bar.
  const bar = 1000 * scale;
  node.append(svg('text', { x: 10, y: 18, class: 'km-label' }, 'N ↑'),
    svg('line', { x1: 10, x2: 10 + bar, y1: height - 12, y2: height - 12, class: 'scale' }), svg('text', { x: 14 + bar, y: height - 8, class: 'km-label' }, '1 km'));
  return node;
}

// ---- Elevation profile ------------------------------------------------------------------------------------
function elevationProfile(map, stops) {
  const { road } = map;
  let low = Infinity, high = -Infinity;
  for (const y of road.y) { low = Math.min(low, y); high = Math.max(high, y); }
  const yStep = niceStep(high - low || 1), xStep = niceStep(road.length / 1000, 8);
  const chart = plot({ width: 960, height: 230, xMin: 0, xMax: road.length / 1000, yMin: Math.floor(low / yStep) * yStep, yMax: Math.ceil(high / yStep) * yStep || yStep, xStep, yStep });
  const points = [];
  for (let i = 0; i < road.count; i += 4) points.push([chart.X((i * ROAD.step) / 1000), chart.Y(road.y[i])]);
  points.push([chart.X(road.length / 1000), chart.Y(road.y[road.count - 1])]);
  chart.add(
    svg('path', { d: `${linePath(points)} L${chart.right} ${chart.bottom} L${chart.left} ${chart.bottom} Z`, class: 'area' }),
    svg('path', { d: linePath(points), class: 'line torque' }),
    stops.map((poi) => {
      const x = chart.X(poi.s / 1000), y = chart.Y(road.y[poi.index]);
      return [svg('line', { x1: x, x2: x, y1: y, y2: chart.bottom, class: 'stop-line' }),
        svg('circle', { cx: x, cy: y, r: 9, fill: STOP_COLORS[poi.type] || '#fff', class: 'stop' }),
        svg('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'stop-number' }, String(poi.number))];
    }));
  return chart.node;
}

// map.json as it is on disk — without the two long lists of numbers.
function rawFileCard(map) {
  const short = { ...map.info, road: `[ ${map.info.road?.length} 個 [x, z] 點，此處省略 ]` };
  return el('details', { class: 'card' }, el('summary', {}, `原始資料 content/maps/${map.id}/map.json`), el('pre', { class: 'raw' }, JSON.stringify(short, null, 2)));
}
