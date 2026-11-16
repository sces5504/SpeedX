// ---------------------------------------------------------------------------
// garage.js — the garage screen: change car, paint, engine and parts.
//
// Laid out like the main menu: down the left WHAT you can change, down the right
// the CHOICES for the line you picked, and the car itself in the middle with its
// rating and ability bars (statBars.js).
//
// The lines on the left come in two TABS:
//   PERFORMANCE  engine swap, then one line per group of performance parts in content/upgrades.json
//   APPEARANCE   paint, then one line per group of body parts the car has in its kit.json
// The CAR itself is changed with the two arrows either side of its name: they go
// through the cars you own (your collection). Your money is at the top, written large (wallet.js).
//
// PREVIEW, APPLY, CANCEL
//   * Clicking a choice only TRIES it: the bars show what would change
//     (bright = gained, red = lost); paint and body parts show on the car.
//     Nothing is saved. (Body parts never change the bars: looks only.)
//   * APPLY fits it: it goes into the save file (game/save.js) and onto the car.
//   * CANCEL - or picking another line, or BACK - puts everything back.
//   * Picking another CAR is not a part: it switches at once.
// Each car keeps its own paint, engine and parts, and gets them back next time.
//
// What a part does is never worked out here: the choice is handed to
// setupCar() (vehicles/carSetup.js) and the bars are measured from the result,
// so the garage cannot show something the car will not do.
//
// MONEY. A part that is not the factory one has a price (game/shop.js). Trying it is
// free; APPLY buys it - once: after that it belongs to this car and shows as OWNED.
// mayFit() below is the one place that decides whether a choice may be applied.
// In the SANDBOX (game/save.js) everything is owned and nothing costs anything.
//
// LISTEN. Hold the REV button (or W) and the engine revs - the one being tried, if
// you are trying an engine, a turbo or a supercharger, so you hear it before you
// fit it. main.js does the revving (audio/revTest.js); this file only says which
// setup is on show (trialSpec) and whether the button is down (revHeld).
//
// The garage calls back into main.js through `actions` and never touches the
// game directly:  onSwitchCar(carId), onPaint(colorIndex), onLook(look, colorIndex), onApply(), onLights(), onClose(),
//                 onSection(sectionId) (the line picked on the left: the camera goes to that part of the car; 'car' = all of it),
//                 onTravel() (the TRAVEL button: only there when the car was driven in through a garage's door)
// ---------------------------------------------------------------------------
import { HERO_CARS, ENGINES, UPGRADES, nameOf } from '../vehicles/carSpecs.js';
import { setupCar, engineOf, enginesFor, fittedIn, fitPart, optionsFor, swapEngine } from '../vehicles/carSetup.js';
import { lookGroups, fittedLook, fitLook, takenOverBy } from '../vehicles/carLook.js';
import { peakPowerPs } from '../vehicles/carStats.js';
import { renderStats } from './statBars.js';
import { renderWallet, dollars } from './wallet.js';
import { save, SANDBOX } from '../game/save.js';
import { career } from '../game/career.js';
import { shop } from '../game/shop.js';

const $ = (id) => document.getElementById(id);
const percent = (factor) => `${factor >= 1 ? '+' : '−'}${Math.abs(Math.round((factor - 1) * 100))}%`;

// May this choice be fitted? The factory part and anything already paid for always may;
// anything else if the player can pay for it. (choice.price: see choices() below.)
const mayFit = (choice) => choice.factory || choice.owned || career.canAfford(choice.price || 0);

// What a part does, in a few words, read from the same fields setupCar() applies.
function effectText(option, engine) {
  const bits = [];
  if (option.torque) bits.push(`${percent(option.torque)} TORQUE`);
  if (option.boost) {
    const boost = option.boost * (engine.aspiration === 'turbo' ? UPGRADES.factoryTurboShare : 1);
    bits.push(`${percent(1 + boost)} TORQUE ${option.spool ? `ABOVE ${option.spool} RPM` : 'AT ALL REVS'}`);
  }
  if (option.redline) bits.push(`+${option.redline} RPM`);
  if (option.mass) bits.push(`${percent(option.mass)} WEIGHT`);
  if (option.grip) bits.push(`${percent(option.grip)} GRIP`);
  if (option.brakeG) bits.push(`${percent(option.brakeG)} BRAKING`);
  if (option.shiftTime) bits.push(`SHIFTS IN ${option.shiftTime.toFixed(2)} S`);
  if (option.extraGear) bits.push('+1 GEAR');
  if (option.efficiency) bits.push(`${Math.round(option.efficiency * 100)}% OF POWER REACHES THE WHEELS`);
  return bits.join(' · ');
}
const engineText = (engine) => `${Math.round(peakPowerPs({ engine }))} PS · ${engine.layout} · ${engine.litres} L · ${{ na: 'NATURALLY ASPIRATED', turbo: 'TURBO', supercharged: 'SUPERCHARGED', diesel: 'DIESEL' }[engine.aspiration] || engine.aspiration}`;

export function createGarage(actions) {
  const root = $('garage'), sectionList = $('garage-sections'), optionList = $('garage-options');
  let carId, stock, owned;                   // the car in the garage: its id, its factory spec, its saved entry { color, build, look }
  let trial;                                 // what is being tried on it: { color, build, look } (equal to `owned` when nothing is)
  let tried = null;                          // the choice that was clicked to get there (its price is paid on APPLY)
  let tab = 'performance';                   // which of the two tabs is open
  let sectionId = 'swap';                    // the line picked in it
  let revHeld = false;                       // the REV button is being held down

  const changed = () => trial.build !== owned.build || trial.color !== owned.color || trial.look !== owned.look;

  function useCar(id) {
    carId = id; stock = HERO_CARS[id]; owned = save.car(id);
    trial = { color: owned.color, build: owned.build, look: owned.look };
  }

  // ---- The lines down the left -------------------------------------------------------------
  function sections() {
    const engine = ENGINES[engineOf(stock, owned.build)];
    return [
      { tab: 'performance', id: 'swap', title: 'ENGINE SWAP', now: engine.fullName },
      ...UPGRADES.groups.map((group) => {
        const fitted = fittedIn(stock, owned.build, group);
        return { tab: 'performance', id: group.id, title: group.title, group, now: fitted ? nameOf('parts', fitted).full : 'FACTORY' };
      }),
      { tab: 'appearance', id: 'paint', title: 'PAINT', now: `COLOUR ${owned.color + 1} OF ${stock.colors.length}` },
      ...lookGroups(stock).map((group) => {
        const kit = takenOverBy(stock, owned.look, group), fitted = fittedLook(owned.look, group);
        return { tab: 'appearance', id: 'look-' + group.id, title: group.title, lookGroup: group, now: kit ? `PART OF ${nameOf('parts', kit.id).name}` : fitted ? nameOf('parts', fitted).full : 'FACTORY' };
      }),
    ];
  }

  // ---- The choices down the right ---------------------------------------------------------------
  // Each choice: { brand, name, text, factory, fitted, tried, pick() } (paint: also `color`).
  // A choice that costs money also has: key (what shop.js knows it by), price, owned (paid for already).
  function choices(section) {
    const priced = (choice, key, price) => (choice.factory ? choice : { ...choice, key, price, owned: shop.hasBought(carId, key) });
    if (section.id === 'paint') {
      return stock.colors.map((color, index) => ({ color, fitted: index === owned.color, tried: index === trial.color, factory: true,
        pick: () => { trial = { ...trial, color: index }; actions.onPaint(index); } }));
    }
    if (section.lookGroup) {
      // a group of body parts: the car's own part first, then the options in its kit.json
      const group = section.lookGroup;
      if (takenOverBy(stock, owned.look, group)) return [];        // a whole-body kit brings its own
      const fittedId = fittedLook(owned.look, group), triedId = fittedLook(trial.look, group);
      const part = (id, brand, name, text) => priced({ brand, name, text, factory: !id, fitted: id === fittedId, tried: id === triedId,
        pick: () => { trial = { ...trial, look: fitLook(owned.look, group, id) }; actions.onLook(trial.look, trial.color); } }, 'look:' + id, shop.bodyPartPrice());
      return [
        part('', '', 'FACTORY', 'THE PART THE CAR COMES WITH'),
        ...group.options.map((option) => { const label = nameOf('parts', option.id); return part(option.id, label.brand, label.name, (label.is || '').toUpperCase()); }),
      ];
    }
    if (section.id === 'swap') {
      const fittedId = engineOf(stock, owned.build), triedId = engineOf(stock, trial.build);
      return enginesFor(stock).map((id) => {
        const engine = ENGINES[id];
        return priced({ brand: engine.brand, name: engine.name, text: engineText(engine) + (id === stock.stockEngine ? ' · FACTORY ENGINE' : ''),
          factory: id === stock.stockEngine, fitted: id === fittedId, tried: id === triedId, pick: () => { trial = { ...trial, build: swapEngine(owned.build, id) }; } },
          'engine:' + id, shop.enginePrice(id));
      });
    }
    // a group of parts: the factory part first, then every option that fits the car as it is
    const group = section.group, engine = ENGINES[engineOf(stock, owned.build)];
    const fittedId = fittedIn(stock, owned.build, group), triedId = fittedIn(stock, trial.build, group);
    const part = (id, brand, name, text, price) => priced({ brand, name, text, factory: !id, fitted: id === fittedId, tried: id === triedId,
      pick: () => { trial = { ...trial, build: fitPart(stock, owned.build, group, id) }; } }, 'part:' + id, price);
    return [
      part('', '', 'FACTORY', 'AS IT LEFT THE FACTORY'),
      ...optionsFor(stock, owned.build, group).map((option) => {
        const label = nameOf('parts', option.id);
        return part(option.id, label.brand, label.name, [label.is?.toUpperCase(), effectText(option, engine)].filter(Boolean).join(' — '), shop.partPrice(group, option));
      }),
    ];
  }

  // ---- Drawing ----------------------------------------------------------------------------------------
  function render() {
    const all = sections().filter((s) => s.tab === tab), section = all.find((s) => s.id === sectionId) || all[0];
    for (const button of $('garage-tabs').children) button.classList.toggle('selected', button.dataset.tab === tab);
    sectionList.innerHTML = '';
    for (const line of all) {
      const row = document.createElement('div');
      row.className = 'car-card' + (line.id === section.id ? ' selected' : '');
      row.innerHTML = `<h3>${line.title}</h3>${line.now}`;
      row.onclick = () => { cancel(); sectionId = line.id; actions.onSection(line.id); render(); };
      sectionList.append(row);
    }

    $('garage-title').textContent = section.title;
    optionList.innerHTML = '';
    optionList.classList.toggle('swatch-grid', section.id === 'paint');
    for (const choice of choices(section)) {
      const card = document.createElement('div');
      if (choice.color !== undefined) {
        card.className = 'swatch' + (choice.tried ? ' selected' : '');
        card.style.background = '#' + choice.color.toString(16).padStart(6, '0');
      } else {
        const tag = choice.fitted ? 'FITTED' : choice.tried ? 'TRYING' : choice.factory || SANDBOX ? '' : choice.owned ? 'OWNED' : dollars(choice.price);
        card.className = 'car-card' + (choice.tried && !choice.fitted ? ' selected' : '') + (choice.fitted ? ' fitted' : '');
        card.innerHTML = (tag ? `<span class="tag">${tag}</span>` : '') + (choice.brand ? `<small>${choice.brand}</small>` : '') + `<h3>${choice.name}</h3>${choice.text}`;
      }
      card.onclick = () => { if (choice.pick() !== false) { tried = choice; blocked = !mayFit(choice); render(); } };
      optionList.append(card);
    }
    if (section.group?.id === 'induction' && optionList.children.length === 1) optionList.insertAdjacentHTML('beforeend', '<p class="preview-note">NO KIT FITS THIS ENGINE</p>');
    if (section.lookGroup && !optionList.children.length) optionList.insertAdjacentHTML('beforeend', `<p class="preview-note">${section.now}</p>`);

    // The car as it would be with what is being tried, compared with the car as it is saved.
    const now = setupCar(stock, trial.build), before = setupCar(stock, owned.build);
    const cars = myCars();
    $('btn-garage-prev').disabled = $('btn-garage-next').disabled = cars.length < 2;
    $('garage-car-name').innerHTML = `${now.name}<small class="count">CAR ${cars.indexOf(carId) + 1} OF ${cars.length}</small><small>${now.engine.fullName} · ${Math.round(peakPowerPs(now))} PS · ${now.mass} KG · ${now.gears.length} GEARS</small>`;
    renderStats($('garage-stats'), now, before);
    const toPay = changed() && tried && !tried.factory && !tried.owned && !SANDBOX ? tried.price : 0;       // what APPLY would cost
    $('garage-preview').textContent = !changed() ? '' : blocked ? `NOT ENOUGH MONEY · ${dollars(tried.price)}` : toPay ? `TRYING IT · ${dollars(toPay)} TO FIT` : 'TRYING IT · NOT FITTED YET';
    $('btn-garage-apply').textContent = toPay ? `BUY · ${dollars(toPay)}` : 'APPLY';
    renderWallet($('garage-wallet'));
    $('btn-garage-apply').disabled = !changed() || blocked;
    $('btn-garage-cancel').disabled = !changed();
  }
  let blocked = false;                       // the choice being tried may not be fitted (see mayFit)

  // ---- Apply / cancel / switch -------------------------------------------------------------------------
  function apply() {
    if (!changed() || blocked) return;
    // A part not paid for yet is bought first (money and part change hands in one go: game/shop.js).
    if (tried && !tried.factory && !tried.owned && !shop.buyPart(carId, tried.key, tried.price)) return;
    owned.color = trial.color; owned.build = trial.build; owned.look = trial.look;
    tried = null;
    save.write();
    actions.onApply();
    render();
  }
  function cancel() {
    if (!changed()) return;
    if (trial.look !== owned.look) actions.onLook(owned.look, owned.color);          // the car is built again with its own parts
    else if (trial.color !== owned.color) actions.onPaint(owned.color);
    trial = { color: owned.color, build: owned.build, look: owned.look };
    blocked = false; tried = null;
  }
  // The cars you own, and the arrows that go through them (step = +1 the next one, -1 the one before).
  const myCars = () => Object.keys(HERO_CARS).filter((id) => career.owns(id));
  function switchCar(step) {
    const cars = myCars(), id = cars[(cars.indexOf(carId) + step + cars.length) % cars.length];
    if (id === carId) return;
    cancel();
    save.data.garage.current = id;
    save.write();
    useCar(id);
    actions.onSwitchCar(id);
    render();
  }
  // Open one of the two tabs, at its first line.
  function openTab(name) {
    cancel();
    tab = name; sectionId = name === 'performance' ? 'swap' : 'paint';
    actions.onSection(name === 'performance' ? 'car' : sectionId);      // (performance: the whole car to begin with)
    render();
  }

  $('btn-garage-apply').onclick = apply;
  $('btn-garage-prev').onclick = () => switchCar(-1);
  $('btn-garage-next').onclick = () => switchCar(1);
  for (const button of $('garage-tabs').children) button.onclick = () => openTab(button.dataset.tab);
  $('btn-garage-cancel').onclick = () => { cancel(); render(); };
  $('btn-garage-back').onclick = () => { cancel(); root.classList.add('hidden'); actions.onClose(); };
  $('btn-garage-travel').onclick = () => { cancel(); root.classList.add('hidden'); actions.onTravel(); };
  const revButton = $('btn-garage-rev');
  revButton.onpointerdown = (event) => { revButton.setPointerCapture(event.pointerId); revHeld = true; };
  revButton.onpointerup = revButton.onpointercancel = () => { revHeld = false; };
  $('btn-garage-lights').onclick = () => actions.onLights();

  return {
    get isOpen() { return !root.classList.contains('hidden'); },
    get revHeld() { return revHeld; },
    get trialSpec() { return setupCar(stock, trial.build); },       // the car as it is on show: saved parts + whatever is being tried
    // The rev counter on the REV button (0 = engine off).
    showRpm(rpm) {
      revButton.textContent = rpm > 1 ? `${Math.round(rpm / 50) * 50} RPM` : 'HOLD TO REV';
      revButton.classList.toggle('on', rpm > 1);
    },
    // atAGarage = the car was driven in through a garage's door on the map (then it can also travel from here).
    open(atAGarage = false) {
      useCar(save.data.garage.current); blocked = false;
      $('btn-garage-travel').classList.toggle('hidden', !atAGarage);
      root.classList.remove('hidden'); openTab('performance');
    },
  };
}
