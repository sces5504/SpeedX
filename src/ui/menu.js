// ---------------------------------------------------------------------------
// menu.js — the main menu and the pause menu.
//
// Main menu: a list of cars down the left, a list of maps down the right, and
// the middle of the screen left clear, because the car you pick is standing
// there in 3D (main.js circles the camera round it). Both lists are built from
// what is installed — add a car folder or a map folder and it shows up here.
//   * click a car: it is swapped in at once, with its colours under it
//   * each map card shows the route, its length, its stops and its traffic;
//     click another map and the game reloads on that map
// Pause menu (ESC): resume, rain, time of night, picture filter, change car.
//
// The menu calls back into main.js through the `actions` object and never
// touches the game directly.
// ---------------------------------------------------------------------------
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { drawRoutePreview, routeLength } from './mapView.js';

const $ = (id) => document.getElementById(id);

/**
 * @param actions { maps: [{ id, info }]  every installed map with its map.json,
 *                  currentMap (id), onPickMap(id),
 *                  onPreview(carId, colorIndex), onStart(carId, colorIndex), onResume(),
 *                  onToggleRain() -> bool, onNextNight() -> name, onNextFilter() -> name, filterName,
 *                  onGarage() }
 */
export function createMenu(actions) {
  const main = $('menu-main'), pause = $('menu-pause');
  const carList = $('car-list'), colorList = $('car-colors'), mapList = $('map-list');
  let carId = localStorage.getItem('speedx-car') || 'ae86';
  if (!HERO_CARS[carId]) carId = Object.keys(HERO_CARS)[0];
  let colorIndex = parseInt(localStorage.getItem('speedx-color') || '0', 10) || 0;

  function peakPower(spec) {       // metric horsepower (PS)
    return Math.round(Math.max(...spec.engine.torque.map(([rpm, nm]) => (nm * rpm * 2 * Math.PI) / 60)) / 735.5);
  }

  // ---- Cars ---------------------------------------------------------------------
  function renderCars() {
    carList.innerHTML = '';
    for (const [id, spec] of Object.entries(HERO_CARS)) {
      const card = document.createElement('div');
      card.className = 'car-card' + (id === carId ? ' selected' : '');
      card.innerHTML = `<h3>${spec.name}</h3>${spec.year} · ${peakPower(spec)} PS · ${spec.mass} kg`;
      card.onclick = () => { carId = id; colorIndex = 0; renderCars(); actions.onPreview(carId, colorIndex); };
      carList.append(card);
      if (id === carId) card.scrollIntoView({ block: 'nearest' });
    }
    // Under the car itself: its name, a line of figures, and its colours.
    const spec = HERO_CARS[carId];
    $('car-name').innerHTML = `${spec.name}<small>${(spec.mass / peakPower(spec)).toFixed(1)} kg/PS · REDLINE ${spec.engine.redline} · REAR-WHEEL DRIVE</small>`;
    colorList.innerHTML = '';
    spec.colors.forEach((color, index) => {
      const swatch = document.createElement('div');
      swatch.className = 'swatch' + (index === colorIndex ? ' selected' : '');
      swatch.style.background = '#' + color.toString(16).padStart(6, '0');
      swatch.onclick = () => { colorIndex = index; renderCars(); actions.onPreview(carId, colorIndex); };
      colorList.append(swatch);
    });
  }

  // ---- Maps -----------------------------------------------------------------------
  // One card per installed map: a picture of the route and what is on it.
  function renderMaps() {
    mapList.innerHTML = '';
    for (const { id, info } of actions.maps) {
      const here = id === actions.currentMap;
      const stops = {};                                      // e.g. { gas: 1, turnout: 2 }
      for (const poi of info.pois || []) stops[poi.type] = (stops[poi.type] || 0) + 1;
      const traffic = info.traffic || {};
      const card = document.createElement('div');
      card.className = 'map-card' + (here ? ' selected' : '');
      card.innerHTML = `<canvas></canvas><span class="tag">${here ? 'YOU ARE HERE' : 'CLICK TO LOAD'}</span><h3>${info.name}</h3>`
        + `${(routeLength(info.road, info.loop) / 1000).toFixed(1)} km · ${traffic.rules || 'two-lane'} road<br>`
        + `${Object.entries(stops).map(([type, count]) => `${count} ${type}`).join(' · ') || 'no stops'}`
        + (traffic.count !== undefined ? `<br>traffic: ${traffic.count} cars` : '');
      if (!here) card.onclick = () => actions.onPickMap(id, info.name);
      mapList.append(card);
      drawRoutePreview(card.querySelector('canvas'), info);    // (after append: the canvas needs its size on the page)
    }
  }
  document.querySelector('#menu-main .tagline').textContent = `${actions.mapName} · always night`;

  $('btn-start').onclick = () => {
    localStorage.setItem('speedx-car', carId); localStorage.setItem('speedx-color', String(colorIndex));
    main.classList.add('hidden');
    actions.onStart(carId, colorIndex);
  };
  $('btn-resume').onclick = () => actions.onResume();
  $('btn-rain').onclick = () => { $('btn-rain').textContent = 'RAIN: ' + (actions.onToggleRain() ? 'ON' : 'OFF'); };
  $('btn-night').onclick = () => { $('btn-night').textContent = 'NIGHT: ' + actions.onNextNight().toUpperCase(); };
  $('btn-filter').onclick = () => { $('btn-filter').textContent = 'FILTER: ' + actions.onNextFilter(); };   // steps through render/filters.js
  $('btn-garage').onclick = () => actions.onGarage();

  return {
    get selection() { return { carId, colorIndex }; },
    showMain() { main.classList.remove('hidden'); pause.classList.add('hidden'); renderCars(); renderMaps(); },
    showPause(visible, rainOn, nightName, filterName) {
      pause.classList.toggle('hidden', !visible);
      $('btn-rain').textContent = 'RAIN: ' + (rainOn ? 'ON' : 'OFF');
      $('btn-night').textContent = 'NIGHT: ' + nightName.toUpperCase();
      $('btn-filter').textContent = 'FILTER: ' + filterName;
    },
  };
}
