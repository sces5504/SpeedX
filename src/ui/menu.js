// ---------------------------------------------------------------------------
// menu.js — the main menu (pick a car and colour) and the pause menu.
// It calls back into main.js through the `actions` object and never touches
// the game directly.
// ---------------------------------------------------------------------------
import { HERO_CARS } from '../vehicles/carSpecs.js';

const $ = (id) => document.getElementById(id);

/**
 * @param actions { maps: {maps: [ids]}, currentMap, onPickMap(id),
 *                  onPreview(carId, colorIndex), onStart(carId, colorIndex), onResume(),
 *                  onToggleRain() -> bool, onNextNight() -> name, onGarage() }
 */
export function createMenu(actions) {
  const main = $('menu-main'), pause = $('menu-pause');
  const carList = $('car-list'), colorList = $('car-colors');
  let carId = localStorage.getItem('speedx-car') || 'ae86';
  if (!HERO_CARS[carId]) carId = 'ae86';
  let colorIndex = parseInt(localStorage.getItem('speedx-color') || '0', 10) || 0;

  function peakPower(spec) {       // metric horsepower (PS)
    return Math.round(Math.max(...spec.engine.torque.map(([rpm, nm]) => (nm * rpm * 2 * Math.PI) / 60)) / 735.5);
  }
  function renderCars() {
    carList.innerHTML = '';
    for (const [id, spec] of Object.entries(HERO_CARS)) {
      const card = document.createElement('div');
      card.className = 'car-card' + (id === carId ? ' selected' : '');
      card.innerHTML = `<h3>${spec.name}</h3>${spec.year} · rear-wheel drive<br>${peakPower(spec)} PS · ${spec.mass} kg<br>`
        + `${(spec.mass / peakPower(spec)).toFixed(1)} kg/PS · redline ${spec.engine.redline}`;
      card.onclick = () => { carId = id; colorIndex = 0; renderCars(); actions.onPreview(carId, colorIndex); };
      carList.append(card);
    }
    colorList.innerHTML = '';
    HERO_CARS[carId].colors.forEach((color, index) => {
      const swatch = document.createElement('div');
      swatch.className = 'swatch' + (index === colorIndex ? ' selected' : '');
      swatch.style.background = '#' + color.toString(16).padStart(6, '0');
      swatch.onclick = () => { colorIndex = index; renderCars(); actions.onPreview(carId, colorIndex); };
      colorList.append(swatch);
    });
  }

  // Map picker: only shown when more than one map is installed.
  if (actions.maps.maps.length > 1) {
    const select = document.createElement('select');
    for (const id of actions.maps.maps) select.add(new Option(id.replace(/-/g, ' ').toUpperCase(), id, false, id === actions.currentMap));
    select.onchange = () => actions.onPickMap(select.value);
    $('map-picker').append('MAP', select);
  }

  $('btn-start').onclick = () => {
    localStorage.setItem('speedx-car', carId); localStorage.setItem('speedx-color', String(colorIndex));
    main.classList.add('hidden');
    actions.onStart(carId, colorIndex);
  };
  $('btn-resume').onclick = () => actions.onResume();
  $('btn-rain').onclick = () => { $('btn-rain').textContent = 'RAIN: ' + (actions.onToggleRain() ? 'ON' : 'OFF'); };
  $('btn-night').onclick = () => { $('btn-night').textContent = 'NIGHT: ' + actions.onNextNight().toUpperCase(); };
  $('btn-garage').onclick = () => actions.onGarage();

  return {
    get selection() { return { carId, colorIndex }; },
    showMain() { renderCars(); main.classList.remove('hidden'); pause.classList.add('hidden'); },
    showPause(visible, rainOn, nightName) {
      pause.classList.toggle('hidden', !visible);
      $('btn-rain').textContent = 'RAIN: ' + (rainOn ? 'ON' : 'OFF');
      $('btn-night').textContent = 'NIGHT: ' + nightName.toUpperCase();
    },
  };
}
