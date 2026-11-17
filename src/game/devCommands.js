// ---------------------------------------------------------------------------
// devCommands.js — the commands of the developer console (ui/devConsole.js, the ~ key).
// Each one is a short way to put the game in a state you want to test:
// more reputation, more money, somewhere else on the map, another car...
//
// To add a command: one more  add(name, what to type after it, what it does, function)
// below. The function gets the typed words and returns the text to print.
// `game` is the handful of things main.js lends this file (see where it is called).
// ---------------------------------------------------------------------------
import { KMH } from '../config.js';
import { HERO_CARS } from '../vehicles/carSpecs.js';
import { NIGHT_PRESETS } from '../world/sky.js';
import { career } from './career.js';
import { save, SANDBOX } from './save.js';

export function addDevCommands(devConsole, game) {
  const add = devConsole.add;
  const { map, weather, sky, hud } = game;
  // A typed number, or a complaint that says what was expected.
  const number = (text, what) => {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`Give ${what} as a number, e.g. 500`);
    return value;
  };
  const mustBeDriving = () => { if (!game.driving()) throw new Error('Press DRIVE first: this needs the car on the road.'); };
  const wallet = () => `reputation ${career.reputation.toLocaleString()}   money $${career.money.toLocaleString()}`;

  // ---- Career ----------------------------------------------------------------
  add('rep', '<amount>', 'add reputation (a minus number takes it away)', ([amount]) => {
    if (amount !== undefined) career.addReputation(number(amount, 'the amount'));
    return wallet();
  });
  add('money', '<amount>', 'add money (a minus number takes it away)', ([amount]) => {
    if (amount !== undefined) career.addMoney(number(amount, 'the amount'));
    return wallet();
  });

  // ---- Where you are -----------------------------------------------------------
  add('tp', '<stop | metres | road metres>', 'go to a stop (tp caoli), so many metres along the main road (tp 5200) or along another road (tp avenue 300); tp alone lists them', ([where, metres]) => {
    mustBeDriving();
    const stops = map.pois.map((poi) => `${poi.id} (${poi.name}, ${Math.round(poi.s)} m)`).join('\n');
    const roads = map.ways.map((way) => `${way.id} (${Math.round(way.road.length)} m)`).join('   ');
    if (where === undefined) return `Stops on this map:\n${stops}\nRoads: ${roads}`;
    const stop = map.pois.find((poi) => poi.id.startsWith(where.toLowerCase()) || poi.name.toLowerCase().startsWith(where.toLowerCase()));
    if (stop) { game.travelTo(stop); return `At ${stop.name}.`; }
    const way = map.ways.find((w) => w.id === where.toLowerCase()) || map.ways[0];
    const s = way.wrap(number(way.id === where.toLowerCase() ? metres : where, 'a stop name, or the metres'));
    game.teleport(s, way.laneCentre(s, 1), `${way.id} ${Math.round(s)} m`, way);
    return `On ${way.id}, at ${Math.round(s)} m.`;
  });
  add('goto', '<road metres>', 'set the map destination (goto avenue 600); goto alone clears it', ([where, metres]) => {
    mustBeDriving();
    const way = map.ways.find((w) => w.id === (where || '').toLowerCase());
    if (!way) { if (game.nav.goal) game.setDestination(game.nav.goal.x, game.nav.goal.z); return 'No destination. Roads: ' + map.ways.map((w) => w.id).join(', '); }
    const at = way.pointAt(way.wrap(number(metres, 'the metres')), 0);
    if (game.nav.goal) game.setDestination(game.nav.goal.x, game.nav.goal.z);       // (clicking the same place twice clears it: clear the old one first)
    game.setDestination(at.x, at.z);
    return game.nav.route ? `${Math.round(game.nav.route.length)} m to go, by ${game.nav.route.legs.map((leg) => leg.way.id).join(' > ')}` : 'No road leads there.';
  });
  add('pos', '', 'where the car is', () => {
    mustBeDriving();
    const p = game.player(), v = p.vehicle;
    return `road ${p.way.id}   s ${p.s.toFixed(0)} m   d ${p.d.toFixed(1)} m   x ${v.x.toFixed(0)}  z ${v.z.toFixed(0)}   ${Math.round(v.speed * KMH)} km/h`;
  });

  // ---- The car -------------------------------------------------------------------
  add('car', '<id>', 'drive another car now; car alone lists them', ([id]) => {
    if (!id) return Object.keys(HERO_CARS).join('   ');
    if (!HERO_CARS[id]) throw new Error(`No car "${id}". Try: ${Object.keys(HERO_CARS).join(', ')}`);
    if (!career.owns(id)) career.giveCar(id);                    // (a developer's shortcut: it is simply yours now)
    save.data.garage.current = id; save.write();
    game.switchCar(id);
    return `Driving ${HERO_CARS[id].name}.`;
  });
  add('fuel', '', 'fill the tank', () => { mustBeDriving(); game.player().vehicle.fuel = 1; return 'Tank full.'; });

  // ---- The world -------------------------------------------------------------------
  add('rain', '<on | off>', 'switch the rain; rain alone flips it', ([wanted]) => {
    weather.raining = wanted === undefined ? !weather.raining : wanted === 'on';
    return weather.raining ? 'Raining.' : 'Dry.';
  });
  add('night', '<number>', `which night (0-${NIGHT_PRESETS.length - 1}); night alone moves on to the next`, ([index]) => {
    sky.setPreset(index === undefined ? sky.index + 1 : number(index, 'the night'));
    return sky.preset.name;
  });

  // ---- Street racers -----------------------------------------------------------------
  add('rival', '', 'bring a street racer up right behind you', () => {
    mustBeDriving();
    const rival = game.rivals().summon(game.playerInfo());
    return `${rival.spec.name} is behind you.`;
  });
  add('race', '', 'race the nearest street racer right now', () => {
    mustBeDriving();
    const rivals = game.rivals();
    return rivals.raceNow(game.playerInfo()) ? 'Countdown started.' : rivals.race.message || 'No racer could start a race here (one may be running already).';
  });

  // ---- The career -------------------------------------------------------------------
  add('blacklist', '<name>', 'be challenged by a Blacklist driver right now, whatever your reputation; blacklist alone lists them', ([name]) => {
    const entry = career.blacklist.find((e) => e.id === (name || '').toLowerCase());
    if (!entry) return career.blacklist.map((e) => `${e.id}: ${e.name}, asks for ${e.reputation} reputation${career.hasBeaten(e) ? ' (beaten)' : ''}`).join('\n');
    mustBeDriving();
    // (The whole of it, as from the Blacklist screen: their introduction, the rolling start, the race.)
    return game.challengeDriver(entry) ? `${entry.name} is coming. Close the console to watch.` : game.rivals().race.message || 'No race could start here.';
  });
  add('win', '', 'win the race you are in, now', () => {
    return game.rivals().winNow() ? 'You win.' : 'You are not in a race (wait for GO).';
  });
  add('intro', '', 'be a first-time player again: back to the main menu, and DRIVE plays the opening scene once more', () => {
    if (SANDBOX) return 'The opening scene belongs to the career. Type  sandbox off  first.';
    save.data.career.introSeen = false;
    save.write();
    if (game.driving()) game.toMainMenu();
    return 'Done. Press DRIVE: the opening scene plays again.';
  });
  add('sandbox', '<on | off>', 'switch between the career and the sandbox (every car and part free; its own save), then reload', ([wanted]) => {
    if (wanted !== 'on' && wanted !== 'off') return `You are in the ${SANDBOX ? 'sandbox' : 'career'}. Type  sandbox on  or  sandbox off.`;
    localStorage.setItem('speedx-sandbox', wanted);
    location.reload();
    return 'Reloading...';
  });

  // ---- The save file -----------------------------------------------------------------
  add('save', '<show | reset yes>', 'print the save file, or wipe it and start again', ([what, sure]) => {
    if (what === 'show') return JSON.stringify(save.data, null, 1);
    if (what === 'reset' && sure === 'yes') { save.erase(); hud.popup('SAVE WIPED', 'bad'); location.reload(); return 'Wiped.'; }
    if (what === 'reset') return 'This wipes every car, part, reputation and money. Type  save reset yes  to do it.';
    return 'save show  or  save reset yes';
  });
}
