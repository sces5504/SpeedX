// ---------------------------------------------------------------------------
// menu.js — the main menu, the pause menu and the HOW TO PLAY page.
//
// Main menu: your cars and the Blacklist down the left, a list of maps down the
// right, and the middle of the screen left clear, because the car you pick is
// standing there in 3D (main.js circles the camera round it). The lists are
// built from what is installed — add a car folder or a map folder and it shows up.
//   * YOUR CARS: click one and it is swapped in at once, with its rating, ability
//     bars (statBars.js) and colours under it. (Cars are BOUGHT at a dealership on
//     the map: ui/dealer.js.)
//   * BLACKLIST: the drivers to beat and how far your reputation has got toward
//     each. Click one for the Blacklist screen (ui/blacklist.js).
//   * each map card shows the route, its length, its stops and its traffic;
//     click another map and the game reloads on that map
// Pause menu (ESC): resume, rain, time of night, picture filter, how loud the game
// is, the Blacklist, how to play, and back to the main menu.
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
import { renderWallet } from './wallet.js';
import { save } from '../game/save.js';
import { career } from '../game/career.js';
import { drawRoutePreview, routeLength } from './mapView.js';

const $ = (id) => document.getElementById(id);
const DRIVE_NAMES = { rwd: 'REAR-WHEEL DRIVE', fwd: 'FRONT-WHEEL DRIVE', awd: 'FOUR-WHEEL DRIVE' };

/**
 * @param actions { maps: [{ id, info }]  every installed map with its map.json,
 *                  currentMap (id), onPickMap(id),
 *                  onPreview(carId)  show that car,  onPaint(colorIndex)  repaint it,
 *                  onStart(carId), onResume(), onOpenGarage(), onOpenBlacklist(), onMainMenu(),
 *                  onToggleRain() -> bool, onNextNight() -> name, onNextFilter() -> name,
 *                  volume() -> 0..1, onVolume(0..1) }
 */
export function createMenu(actions) {
  const main = $('menu-main'), pause = $('menu-pause'), how = $('how-to-play');
  const carList = $('car-list'), colorList = $('car-colors'), mapList = $('map-list');
  const garage = save.data.garage;
  const mine = () => Object.keys(HERO_CARS).filter((id) => career.owns(id));
  if (!mine().includes(garage.current)) garage.current = mine()[0];

  // ---- Cars ---------------------------------------------------------------------
  function renderCars() {
    carList.innerHTML = '';
    const carId = garage.current;
    for (const id of mine()) {
      const spec = setupCar(HERO_CARS[id], save.data.garage.cars[id]?.build);     // the car as it will be driven, parts and all
      const row = document.createElement('div');
      row.className = 'car-card' + (id === carId ? ' selected' : '');
      row.innerHTML = `<b class="rating-chip">${rateCar(spec).rating}</b><h3>${spec.name}</h3>${Math.round(peakPowerPs(spec))} PS · ${spec.mass} kg`;
      row.onclick = () => { garage.current = id; save.write(); renderCars(); actions.onPreview(id); };
      carList.append(row);
      if (id === carId) row.scrollIntoView({ block: 'nearest' });
    }
    renderWallet($('career-line'));
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

  // ---- The Blacklist, in short -----------------------------------------------------
  // One card per driver, number one at the top: who, what they drive, and a bar showing how
  // much of the reputation they ask for the player has.
  function renderBlacklist() {
    const list = $('menu-blacklist'), entries = career.blacklist;
    list.innerHTML = '';
    [...entries].reverse().forEach((entry) => {
      const rank = entries.length - entries.indexOf(entry), beaten = career.hasBeaten(entry), ready = career.mayChallenge(entry);
      const share = Math.min(1, career.reputation / entry.reputation);
      const row = document.createElement('div');
      row.className = 'car-card driver-card' + (beaten ? ' beaten' : '');
      row.innerHTML = `<b class="rating-chip">#${rank}</b><h3>${entry.name}</h3>${HERO_CARS[entry.car].name}`
        + `<div class="rep-bar"><i style="width:${(beaten || ready ? 1 : share) * 100}%"></i></div>`
        + `<span class="tag">${beaten ? 'BEATEN' : ready ? 'READY TO CHALLENGE' : `${career.reputation.toLocaleString()} / ${entry.reputation.toLocaleString()} REP`}</span>`;
      row.onclick = () => actions.onOpenBlacklist(entry);
      list.append(row);
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
      const traffic = info.traffic || {}, cameras = (info.speedCameras || []).length;
      const card = document.createElement('div');
      card.className = 'map-card' + (here ? ' selected' : '');
      card.innerHTML = `<canvas></canvas><span class="tag">${here ? 'YOU ARE HERE' : 'CLICK TO LOAD'}</span><h3>${info.name}</h3>`
        + `${(routeLength(info.road, info.loop) / 1000).toFixed(1)} km · ${traffic.rules || 'two-lane'} road<br>`
        + `${Object.entries(stops).map(([type, count]) => `${count} ${type}`).join(' · ') || 'no stops'}`
        + (cameras ? `<br>${cameras} speed camera${cameras > 1 ? 's' : ''}` : '')
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
  $('btn-open-garage').onclick = () => actions.onOpenGarage();
  $('btn-blacklist').onclick = () => actions.onOpenBlacklist();
  $('btn-resume').onclick = () => actions.onResume();
  $('btn-main-menu').onclick = () => actions.onMainMenu();
  $('btn-rain').onclick = () => { $('btn-rain').textContent = 'RAIN: ' + (actions.onToggleRain() ? 'ON' : 'OFF'); };
  $('btn-night').onclick = () => { $('btn-night').textContent = 'NIGHT: ' + actions.onNextNight().toUpperCase(); };
  $('btn-filter').onclick = () => { $('btn-filter').textContent = 'FILTER: ' + actions.onNextFilter(); };   // steps through render/filters.js

  // The AUDIO bar: 0 to 100 %.
  const volume = $('volume');
  const showVolume = () => { $('volume-value').textContent = volume.value + '%'; };
  volume.oninput = () => { actions.onVolume(volume.value / 100); showVolume(); };
  volume.onchange = () => volume.blur();                     // (so the arrow keys go back to driving the car)

  // HOW TO PLAY: a page of its own over whichever menu it was opened from.
  for (const id of ['btn-open-how', 'btn-how']) $(id).onclick = () => how.classList.remove('hidden');
  $('btn-how-close').onclick = () => how.classList.add('hidden');

  return {
    hideMain() { main.classList.add('hidden'); },
    showMain() {
      main.classList.remove('hidden'); pause.classList.add('hidden');
      renderCars(); renderBlacklist(); renderMaps();
    },
    hidePause() { pause.classList.add('hidden'); },
    // The HOW TO PLAY page is up (ESC closes it first: see main.js).
    get howOpen() { return !how.classList.contains('hidden'); },
    closeHow() { how.classList.add('hidden'); },
    showPause(visible, rainOn, nightName, filterName) {
      pause.classList.toggle('hidden', !visible);
      $('btn-rain').textContent = 'RAIN: ' + (rainOn ? 'ON' : 'OFF');
      $('btn-night').textContent = 'NIGHT: ' + nightName.toUpperCase();
      $('btn-filter').textContent = 'FILTER: ' + filterName;
      volume.value = Math.round(actions.volume() * 100); showVolume();
    },
  };
}
