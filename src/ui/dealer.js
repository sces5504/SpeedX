// ---------------------------------------------------------------------------
// dealer.js — the dealership screen: the cars for sale down the left, the one
// being looked at standing in the showroom in the middle (world/showroom.js),
// its rating and ability bars under it, and BUY.
//
// It is what you see after walking into a dealership on the map - the only place cars
// are sold (game/shop.js). Your money is at the top, written large (wallet.js).
// The screen only shows and asks; main.js does the rest through `actions`:
//     onLook(carId)    stand this car in the showroom
//     onBought(carId)  it has just been bought: it is the player's car from now on
//     onClose()
// ---------------------------------------------------------------------------
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { rateCar } from '../vehicles/carRating.js';
import { peakPowerPs } from '../vehicles/carStats.js';
import { renderStats } from './statBars.js';
import { renderWallet, dollars } from './wallet.js';
import { career } from '../game/career.js';
import { shop } from '../game/shop.js';

const $ = (id) => document.getElementById(id);

export function createDealer(actions) {
  const root = $('dealer'), list = $('dealer-list');
  let looking = null;                        // the id of the car on show

  function render() {
    const forSale = Object.keys(HERO_CARS).filter((id) => shop.forSale(id));
    if (!forSale.includes(looking)) looking = forSale[0] || null;
    renderWallet($('dealer-wallet'));
    list.innerHTML = forSale.length ? '' : '<p class="preview-note">EVERY CAR HERE IS ALREADY YOURS</p>';
    for (const id of forSale) {
      const spec = HERO_CARS[id], row = document.createElement('div');
      row.className = 'car-card' + (id === looking ? ' selected' : '');
      row.innerHTML = `<span class="tag">${dollars(shop.carPrice(id))}</span><h3>${spec.name}</h3>RATING ${rateCar(spec).rating} · ${Math.round(peakPowerPs(spec))} PS · ${spec.mass} KG`;
      row.onclick = () => { looking = id; actions.onLook(id); render(); };
      list.append(row);
    }
    const spec = looking && HERO_CARS[looking];
    $('dealer-car-name').innerHTML = spec ? `${spec.name}<small>${spec.engine.fullName} · ${Math.round(peakPowerPs(spec))} PS · ${spec.mass} KG</small>` : '';
    if (spec) renderStats($('dealer-stats'), spec); else $('dealer-stats').innerHTML = '';
    const price = looking ? shop.carPrice(looking) : 0, buy = $('btn-dealer-buy');
    buy.textContent = looking ? `BUY · ${dollars(price)}` : 'BUY';
    buy.disabled = !looking || !career.canAfford(price);
    $('dealer-preview').textContent = looking && !career.canAfford(price) ? `NOT ENOUGH MONEY · ${dollars(price - career.money)} SHORT` : '';
  }

  $('btn-dealer-buy').onclick = () => {
    const id = looking;
    if (!id || !shop.buyCar(id)) return;
    actions.onBought(id);
    render();
    if (looking) actions.onLook(looking);                     // (the next car for sale takes its place in the showroom)
  };
  $('btn-dealer-back').onclick = () => { root.classList.add('hidden'); actions.onClose(); };

  return {
    get isOpen() { return !root.classList.contains('hidden'); },
    open() { looking = null; root.classList.remove('hidden'); render(); if (looking) actions.onLook(looking); },
  };
}
