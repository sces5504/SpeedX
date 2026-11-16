// ---------------------------------------------------------------------------
// menu.js — the main menu and the pause menu.
//
// Main menu: a list of cars down the left, a list of maps down the right, and
// the middle of the screen left clear, because the car you pick is standing
// there in 3D (main.js circles the camera round it). Both lists are built from
// what is installed — add a car folder or a map folder and it shows up here.
//   * click a car: it is swapped in at once, with its rating, ability bars
//     (statBars.js) and colours under it
//   * each map card shows the route, its length, its stops and its traffic;
//     click another map and the game reloads on that map
// Pause menu (ESC): resume, rain, time of night, picture filter, garage.
// The car and paint you pick are kept in the save file (game/save.js), where the
// garage (garage.js) keeps each car's parts too.
//
// The menu calls back into main.js through the `actions` object and never
// touches the game directly.
// ---------------------------------------------------------------------------
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { setupCar } from '../vehicles/carSetup.js';
import { rateCar } from '../vehicles/carRating.js';
import { peakPowerPs } from '../vehicles/carStats.js';
import { renderStats } from './statBars.js';
import { save } from '../game/save.js';
import { drawRoutePreview, routeLength } from './mapView.js';

const $ = (id) => document.getElementById(id);
const DRIVE_NAMES = { rwd: 'REAR-WHEEL DRIVE', fwd: 'FRONT-WHEEL DRIVE', awd: 'FOUR-WHEEL DRIVE' };

/**
 * @param actions { maps: [{ id, info }]  every installed map with its map.json,
 *                  currentMap (id), onPickMap(id),
 *                  onPreview(carId)  show that car,  onPaint(colorIndex)  repaint it,
 *                  onStart(carId), onResume(), onOpenGarage(),
 *                  onToggleRain() -> bool, onNextNight() -> name, onNextFilter() -> name, filterName,
 *                  onGarage() }
 */
export function createMenu(actions) {
  const main = $('menu-main'), pause = $('menu-pause');
  const carList = $('car-list'), colorList = $('car-colors'), mapList = $('map-list');
  const garage = save.data.garage;
  if (!HERO_CARS[garage.current]) garage.current = HERO_CARS.ae86 ? 'ae86' : Object.keys(HERO_CARS)[0];

  // ---- Cars ---------------------------------------------------------------------
  function renderCars() {
    carList.innerHTML = '';
    const carId = garage.current;
    for (const id of Object.keys(HERO_CARS)) {
      const spec = setupCar(HERO_CARS[id], save.car(id).build);     // the car as it will be driven, parts and all
      const card = document.createElement('div');
      card.className = 'car-card' + (id === carId ? ' selected' : '');
      card.innerHTML = `<b class="rating-chip">${rateCar(spec).rating}</b><h3>${spec.name}</h3>${Math.round(peakPowerPs(spec))} PS · ${spec.mass} kg`;
      card.onclick = () => { garage.current = id; save.write(); renderCars(); actions.onPreview(id); };
      carList.append(card);
      if (id === carId) card.scrollIntoView({ block: 'nearest' });
    }
    // Under the car itself: its name, its engine, its rating and ability bars, and its colours.
    const owned = save.car(carId), spec = setupCar(HERO_CARS[carId], owned.build);
    $('car-name').innerHTML = `${spec.name}<small>${spec.engine.fullName} · ${Math.round(peakPowerPs(spec))} PS · REDLINE ${spec.engine.redline} · ${DRIVE_NAMES[spec.drive]}</small>`;
    renderStats($('car-stats'), spec);
    colorList.innerHTML = '';
    spec.colors.forEach((color, index) => {
      const swatch = document.createElement('div');
      swatch.className = 'swatch' + (index === owned.color ? ' selected' : '');
      swatch.style.background = '#' + color.toString(16).padStart(6, '0');
      swatch.onclick = () => { owned.color = index; save.write(); renderCars(); actions.onPaint(index); };
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
    save.write();
    main.classList.add('hidden');
    actions.onStart(garage.current);
  };
  $('btn-resume').onclick = () => actions.onResume();
  $('btn-rain').onclick = () => { $('btn-rain').textContent = 'RAIN: ' + (actions.onToggleRain() ? 'ON' : 'OFF'); };
  $('btn-night').onclick = () => { $('btn-night').textContent = 'NIGHT: ' + actions.onNextNight().toUpperCase(); };
  $('btn-filter').onclick = () => { $('btn-filter').textContent = 'FILTER: ' + actions.onNextFilter(); };   // steps through render/filters.js
  $('btn-garage').onclick = () => actions.onOpenGarage();            // (pause menu)
  $('btn-open-garage').onclick = () => actions.onOpenGarage();       // (main menu)

  return {
    hideMain() { main.classList.add('hidden'); },
    showMain() { main.classList.remove('hidden'); pause.classList.add('hidden'); renderCars(); renderMaps(); },
    showPause(visible, rainOn, nightName, filterName) {
      pause.classList.toggle('hidden', !visible);
      $('btn-rain').textContent = 'RAIN: ' + (rainOn ? 'ON' : 'OFF');
      $('btn-night').textContent = 'NIGHT: ' + nightName.toUpperCase();
      $('btn-filter').textContent = 'FILTER: ' + filterName;
    },
  };
}
