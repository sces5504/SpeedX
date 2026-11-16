// ---------------------------------------------------------------------------
// blacklist.js — the Blacklist screen.
//
// Laid out like the garage: the DRIVERS down the left (number one at the top),
// the chosen driver's CAR in the middle - standing on the black stage, outlined
// in their colour (world/stage.js; main.js puts it there) - and down the right
// what they ask for and what they give:
//   REPUTATION  how much the player has of what this driver asks for, as a meter
//   THE PRIZE   their car, money and reputation - the first time they are beaten
//   THE RACE    how long it is
// CHALLENGE is there once the player has the reputation, and only out on the road.
//
// It only shows and asks: who is on the list is data (public/content/career.json),
// what the player has is game/career.js, and the race itself is started by main.js.
//
//   actions: { canRace() -> true while the player is driving with nothing else going on,
//              onLook(entry)        stand this driver's car on the stage
//              onChallenge(entry), onClose() }
// ---------------------------------------------------------------------------
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { setupCar } from '../vehicles/carSetup.js';
import { renderStats } from './statBars.js';
import { renderWallet, dollars } from './wallet.js';
import { career } from '../game/career.js';

const $ = (id) => document.getElementById(id);

export function createBlacklistScreen(actions) {
  const root = $('blacklist'), list = $('blacklist-list');
  let chosen = null;                         // the driver being looked at (an entry of career.json)

  const rankOf = (entry) => career.blacklist.length - career.blacklist.indexOf(entry);      // (the last one listed is number 1)

  function render() {
    const entries = career.blacklist, colour = chosen.colour || '#57ff9a';
    renderWallet($('blacklist-wallet'));
    // ---- the drivers ----
    list.innerHTML = '';
    [...entries].reverse().forEach((entry) => {
      const beaten = career.hasBeaten(entry), ready = career.mayChallenge(entry);
      const row = document.createElement('div');
      row.className = 'car-card driver-card' + (entry === chosen ? ' selected' : '') + (beaten ? ' beaten' : ready ? '' : ' locked');
      row.innerHTML = `<b class="rating-chip">#${rankOf(entry)}</b><h3>${entry.name}</h3>${HERO_CARS[entry.car].name}`
        + `<div class="rep-bar"><i style="width:${(beaten || ready ? 1 : Math.min(1, career.reputation / entry.reputation)) * 100}%"></i></div>`
        + `<span class="tag">${beaten ? 'BEATEN' : ready ? 'READY TO CHALLENGE' : `ASKS FOR ${entry.reputation.toLocaleString()} REP`}</span>`;
      row.onclick = () => { chosen = entry; actions.onLook(entry); render(); };
      list.append(row);
    });
    // ---- the chosen one: name and car in the middle ----
    const setup = setupCar(HERO_CARS[chosen.car], chosen.build), beaten = career.hasBeaten(chosen), ready = career.mayChallenge(chosen);
    $('blacklist-name').innerHTML = `<em style="color:${colour}">BLACKLIST #${rankOf(chosen)}</em>${chosen.name}`
      + `<small>${chosen.line || ''}</small><small style="color:${colour}">${setup.name} · ${setup.engine.fullName}</small>`;
    renderStats($('blacklist-stats'), setup);
    // ---- reputation: the meter ----
    const missing = Math.max(0, chosen.reputation - career.reputation), meter = $('blacklist-rep');
    meter.className = 'rep-meter' + (ready ? ' ready' : '');
    meter.innerHTML = `<b>${career.reputation.toLocaleString()} <span>/ ${chosen.reputation.toLocaleString()}</span></b>`
      + `<div class="rep-bar"><i style="width:${Math.min(1, career.reputation / chosen.reputation) * 100}%"></i></div>`
      + `<p>${beaten ? 'BEATEN' : ready ? 'YOU HAVE THE REPUTATION' : `${missing.toLocaleString()} MORE TO CHALLENGE`}</p>`;
    // ---- the prize, the race ----
    $('blacklist-prize').innerHTML = beaten
      ? '<div class="car-card plain"><h3>ALREADY YOURS</h3>THEIR CAR IS IN YOUR GARAGE · A REMATCH PAYS LIKE A STREET RACE</div>'
      : `<div class="car-card plain"><h3>THEIR CAR</h3>${setup.name}</div>`
        + `<div class="car-card plain"><b>${dollars(chosen.prize.money)}</b><h3>MONEY</h3></div>`
        + `<div class="car-card plain"><b>+${chosen.prize.reputation.toLocaleString()}</b><h3>REPUTATION</h3></div>`;
    $('blacklist-race').innerHTML = `<h3>${(chosen.raceLength / 1000).toFixed(1)} KM · ROLLING START</h3>SIDE BY SIDE TO THE LINE, 3-2-1, FIRST TO THE GATE`;
    // ---- the button ----
    const go = $('btn-blacklist-go'), onRoad = actions.canRace();
    go.textContent = !ready ? 'NOT ENOUGH REPUTATION' : !onRoad ? 'DRIVE FIRST' : beaten ? 'RACE AGAIN' : 'CHALLENGE';
    go.disabled = !ready || !onRoad;
    $('blacklist-note').textContent = ready && !onRoad ? 'CHALLENGES ARE MADE OUT ON THE ROAD · DRIVE, THEN ESC' : '';
  }

  $('btn-blacklist-go').onclick = () => { root.classList.add('hidden'); actions.onChallenge(chosen); };
  $('btn-blacklist-back').onclick = () => { root.classList.add('hidden'); actions.onClose(); };
  return {
    get isOpen() { return !root.classList.contains('hidden'); },
    // entry = the driver to show first (left out: the next one the player has not beaten).
    open(entry) {
      chosen = entry || career.blacklist.find((e) => !career.hasBeaten(e)) || career.blacklist[career.blacklist.length - 1];
      root.classList.remove('hidden');
      actions.onLook(chosen);
      render();
    },
  };
}
