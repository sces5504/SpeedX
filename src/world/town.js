// ---------------------------------------------------------------------------
// town.js — the ordinary buildings of a Taiwanese roadside, for maps that list
// "buildings" in their map.json (tools/build-places.mjs writes a first draft of
// that list from the real map):
//   house        a narrow townhouse of 2-5 floors with balconies (透天厝)
//   shack        a single-storey sheet-metal building (鐵皮屋)
//   cafe         a shack with warm windows, a string of bulbs and a neon sign
//   eatery       a small restaurant under a bright yellow sign
//   seafood      a live-seafood restaurant: open front, blue fish tanks, big red sign (活海產)
//   police       a police station with its red lamp (派出所)
//   temple       a small roadside temple with red lanterns
//   hall         a plain public building (activity centre, visitor centre)
//   toilet       a public toilet block
//   bus-stop     a bus shelter with its sign     power-tower   a high-voltage pylon with a red light
//   median-lamp  the two-armed lamp on the wall of a divided highway ("side": 0)
//   road-lamp    a tall sodium-orange road lamp   utility-pole  a concrete pole, some with a transformer
// and LANDMARKS, each modelled on one real place (from photographs of it):
//   surf-base    Zhongjiao Bay surf centre: a white stepped building with a blue wave mural (中角灣衝浪基地)
//   shrine       the little stone temple by the sea wall at Caoli, with its swallowtail roof (草里水流公廟)
//   columbarium  the white domed memorial hall of the hillside cemetery above Jinshan (金寶山日光苑)
//   police-post  Zhongjiao police station: white cubes with blue trim, like a Greek island house (中角派出所)
//   harbour      Caoli fishing harbour: quay, breakwater with red and green beacons, lit boats (草里漁港)
// A landmark is built with more parts than an ordinary building, and its map.json entry may
// carry "scale" (about 1.15) so that it stands out a little.
// (the last two are usually put along a whole stretch of road at once: "roadside" in map.json)
//
// WHERE each one stands was worked out by mapData.js (map.buildings). This file
// decides what they look like. To keep a whole town cheap to draw, buildings are
// NOT separate objects: everything in one area is welded into a few meshes —
//   wall   tiled walls                  solid  everything else solid (sheet metal, roofs, frames)
//   lit    what glows: windows, shop fronts, signs, neon tubes, lanterns
//   glow   the soft light round a sign and the pool of colour it throws on the ground
//   wire   pylons, drawn as lines
// Colours are stored per corner point ("vertex colours"). Every sign, every lit room seen
// through a window and every soft glow is a rectangle cut out of ONE shared picture (the
// "atlas"), so they all share one material.
//
// Lighting follows the game's rule for buildings: coloured light, never white
// floodlight — red and yellow signs, aqua fish tanks, warm bulbs, cool tube light.
// A sign shows the KIND of business (活海產, 咖啡...), never a real shop's name.
//
// To add a kind: write its function below (it adds blocks and lit panels to
// `out`), add it to KINDS, give it a size in BUILDING_SIZES (config.js) and describe it in
// public/content/props/index.json ("builtIn" -> "buildings"). That is all: library.js lists
// every kind as an object of the shared library by itself, so the catalogue page shows it
// and a map can also place one with its "objects" list.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDING_SIZES, GRAPHICS } from '../config.js';
import { makeRandom } from '../core/mathUtils.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';
import { drawNear } from '../render/drawDistance.js';

const LEVEL = GRAPHICS.buildingLights;      // the same brightness dial as every other building
const AREA_SIZE = 600;                      // metres: buildings are welded together per square this big
const FLOOR = 3.2;                          // height of one storey
const FOOTING = 2.5;                        // walls carry on this far below the floor, so nothing floats on a slope
const TEXTURE_M = 2;                        // the wall and sheet-metal textures repeat every 2 m

// ---- Colours ----------------------------------------------------------------------------
const tint = (hex, strength = 1) => { const c = new THREE.Color(hex); return [c.r * strength, c.g * strength, c.b * strength]; };
const shade = (color, k) => color.map((v) => v * k);
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const TILES = [0xb9b2a4, 0xa89f93, 0xc4b8a8, 0x9aa3a6, 0xb8a79c, 0x8f979a, 0xa7b0a2].map((hex) => tint(hex));   // wall tiles: cream, grey, pink-beige, pale green
const SHEET_METAL = [0x4f7f86, 0x55708f, 0x6b7479, 0x7a8f6a, 0x8a5a4a, 0x3f6a5a].map((hex) => tint(hex));       // painted corrugated sheet
const AWNINGS = [0x2f6f5f, 0x8a2a22, 0x2c4f8a, 0x8a7a2a].map((hex) => tint(hex));
const CONCRETE = tint(0x8a8882), DARK = tint(0x1b1d20), SHUTTER = tint(0x6a7378), STEEL = tint(0xa9b0b4), GLASS = tint(0x0d1216);
// Light colours (how bright each one is drawn is given where it is used; about 1.2 = lit, 2+ = glowing).
const WARM = 0xffb46a, TUBE = 0xd6f2ff, AQUA = 0x35d8ff, RED = 0xff3020, AMBER = 0xffa030, PINK = 0xff5ac8, GREEN = 0x4dffa8;

// ---- The atlas: one picture holding every sign, lit room and glow -------------------------------
// SIGNS. A shop's sign shows a made-up English name and a little picture of its trade — never the
// name of a real business, and no Chinese (only a landmark that really has a name may carry it).
// Each kind has a few names and a few looks; every building picks one of each, so a street of cafés
// does not repeat itself. A map can still give a building its own text with "sign" in map.json.
//   icon: cup, fish, bowl, glass, shield, wave (drawn in drawIcon below)
//   look: background and ink colours, the colour the sign glows, neon = glowing tubes on black
const SHOP_SIGNS = {
  seafood: { names: ['HARBOR SEAFOOD', 'FRESH CATCH', 'CRAB HOUSE', 'LIVE SEAFOOD'], icon: 'fish',
    looks: [{ background: '#c8201a', ink: '#ffe23a', glow: RED }, { background: '#0e3f8a', ink: '#ffffff', glow: 0x4a90ff }] },
  eatery: { names: ['NOODLE HOUSE', 'RICE & GRILL', 'HOT POT', 'DUMPLINGS', 'KITCHEN 88'], icon: 'bowl',
    looks: [{ background: '#f0be1a', ink: '#a81010', glow: AMBER }, { background: '#f4f1e8', ink: '#b01818', glow: WARM }, { background: '#0f6a4a', ink: '#fff3c8', glow: GREEN }] },
  cafe: { names: ['CORAL CAFE', 'SLOW TIDE COFFEE', 'NORTH SHORE COFFEE', 'DRIFT CAFE', 'SEAGLASS COFFEE', 'LIGHTHOUSE CAFE'], icon: 'cup',
    looks: [{ background: '#07080a', ink: '#ffb060', glow: AMBER, neon: true }, { background: '#07080a', ink: '#ff6ad0', glow: PINK, neon: true }, { background: '#07080a', ink: '#5ce8ff', glow: AQUA, neon: true }] },
  police: { names: ['POLICE'], icon: 'shield', looks: [{ background: '#f2f2ee', ink: '#182f66', glow: TUBE }] },
  hall: { names: ['COMMUNITY HALL'], icon: null, looks: [{ background: '#1b5aa0', ink: '#ffffff', glow: 0x4a90ff }] },
  toilet: { names: ['WC'], icon: null, looks: [{ background: '#1b5aa0', ink: '#ffffff', glow: 0x4a90ff }] },
  'police-post': { names: ['POLICE'], icon: 'shield', looks: [{ background: '#f2f2ee', ink: '#182f66', glow: 0x4a90ff }] },
  'surf-base': { names: ['中角灣衝浪基地'], icon: 'wave', looks: [{ background: '#0b3f7a', ink: '#ffffff', glow: AQUA }] },   // a landmark with a real name
};
// Which sign does this building get? (number = its place in the map's list, so it is the same every time)
function signOf(b, number) {
  const entry = SHOP_SIGNS[b.kind];
  if (!entry) return null;
  const rnd = makeRandom(500 + number * 13);
  const text = b.sign || pick(rnd, entry.names), look = pick(rnd, entry.looks);
  const icon = /BAR|PUB/.test(text) ? 'glass' : /POT|NOODLE|KITCHEN|GRILL|DUMPLING/.test(text) ? 'bowl' : entry.icon;
  return { key: text + look.background + look.ink, text, icon, look };
}
// The little picture on a sign, drawn in the sign's ink inside a square `size` across at (x, y).
function drawIcon(g, icon, x, y, size) {
  const u = size / 10, at = (px, py) => [x + px * u, y + py * u];
  g.lineWidth = u * 0.9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (icon === 'cup') {                                      // a mug with a handle, steam rising
    g.moveTo(...at(2, 4.5)); g.lineTo(...at(2.6, 8.5)); g.lineTo(...at(6.4, 8.5)); g.lineTo(...at(7, 4.5)); g.closePath();
    g.moveTo(...at(7, 5.3)); g.quadraticCurveTo(...at(9.2, 5.6), ...at(6.7, 7.6));
    for (const sx of [3.4, 5.4]) { g.moveTo(...at(sx, 3.4)); g.quadraticCurveTo(...at(sx + 1, 2.4), ...at(sx, 1.2)); }
  } else if (icon === 'fish') {                              // body, tail, eye
    g.moveTo(...at(1, 5)); g.quadraticCurveTo(...at(4, 1.6), ...at(7, 5)); g.quadraticCurveTo(...at(4, 8.4), ...at(1, 5));
    g.moveTo(...at(7, 5)); g.lineTo(...at(9.3, 2.8)); g.lineTo(...at(9.3, 7.2)); g.closePath();
    g.moveTo(...at(2.8, 4.4)); g.lineTo(...at(2.9, 4.4));
  } else if (icon === 'bowl') {                              // a bowl, chopsticks across it, steam
    g.moveTo(...at(1.5, 5.2)); g.quadraticCurveTo(...at(5, 11), ...at(8.5, 5.2)); g.closePath();
    g.moveTo(...at(4.2, 5)); g.lineTo(...at(8.6, 1.4)); g.moveTo(...at(5.4, 5)); g.lineTo(...at(9.2, 2.2));
    for (const sx of [2.6, 4]) { g.moveTo(...at(sx, 4)); g.quadraticCurveTo(...at(sx - 0.9, 3), ...at(sx, 1.8)); }
  } else if (icon === 'glass') {                             // a cocktail glass
    g.moveTo(...at(1.8, 2)); g.lineTo(...at(8.2, 2)); g.lineTo(...at(5, 5.8)); g.closePath();
    g.moveTo(...at(5, 5.8)); g.lineTo(...at(5, 8.6)); g.moveTo(...at(3.2, 8.6)); g.lineTo(...at(6.8, 8.6));
  } else if (icon === 'shield') {                            // a badge
    g.moveTo(...at(5, 1.2)); g.lineTo(...at(8.4, 2.6)); g.quadraticCurveTo(...at(8.4, 7), ...at(5, 8.9)); g.quadraticCurveTo(...at(1.6, 7), ...at(1.6, 2.6)); g.closePath();
    g.moveTo(...at(3.6, 5)); g.lineTo(...at(4.7, 6.2)); g.lineTo(...at(6.6, 3.8));
  } else if (icon === 'wave') {                              // two rolling waves
    for (const wy of [4, 7]) { g.moveTo(...at(1, wy)); g.bezierCurveTo(...at(3, wy - 3.4), ...at(4.4, wy - 3.2), ...at(4.6, wy - 0.6)); g.bezierCurveTo(...at(5.6, wy + 0.8), ...at(7.4, wy + 0.6), ...at(9, wy - 1)); }
  }
  g.stroke();
}
const ATLAS_W = 2048, ATLAS_H = 1024, WIDE = [512, 96], TALL = [128, 512];      // room for 19 lying signs and 8 standing ones
const cellAt = (x, y, w, h, inset = 2) => [(x + inset) / ATLAS_W, 1 - (y + h - inset) / ATLAS_H, (x + w - inset) / ATLAS_W, 1 - (y + inset) / ATLAS_H];
// The pictures every map gets, on the right-hand side of the atlas:
const WHITE = cellAt(0, 0, 32, 32, 8);            // a plain white patch, for lights that are just a colour
const ROOM = cellAt(1536, 0, 512, 256);           // a lit dining room seen through a shop front: tables, chairs, ceiling lights
const SHOP = cellAt(1536, 256, 512, 256);         // a lit shop: counter and shelves
const WINDOWS = [cellAt(1536, 512, 256, 256), cellAt(1792, 512, 256, 256)];   // a lit window behind an iron grille; one with a blind
const GLOW = cellAt(1536, 768, 256, 256);         // a soft round glow

function drawPictures(g) {
  // ROOM: bright near the ceiling lights, furniture as dark shapes against the light.
  const room = (x, y, w, h, shelves) => {
    const light = g.createLinearGradient(0, y, 0, y + h);
    light.addColorStop(0, '#ffffff'); light.addColorStop(0.55, '#c9c9c9'); light.addColorStop(1, '#8a8a8a');
    g.fillStyle = light; g.fillRect(x, y, w, h);
    g.fillStyle = '#f4f4f4'; for (let k = 0; k < 4; k++) g.fillRect(x + 30 + k * 125, y + 14, 78, 7);          // tube lights
    g.fillStyle = 'rgba(40,40,40,0.55)';
    if (shelves) {
      for (let row = 0; row < 3; row++) g.fillRect(x + 16, y + 52 + row * 44, w - 32, 6);                        // shelves along the back wall
      for (let k = 0; k < 46; k++) g.fillRect(x + 22 + k * 10.3, y + 30 + (k % 3) * 44 + (k * 7) % 9, 7, 22 - (k * 7) % 9);   // bottles and boxes
      g.fillStyle = 'rgba(25,25,25,0.8)'; g.fillRect(x + 40, y + h - 70, w * 0.5, 70);                           // counter
    } else {
      for (let k = 0; k < 3; k++) g.fillRect(x + 20 + k * 165, y + 40, 130, 46);                                 // menu boards on the back wall
      g.fillStyle = 'rgba(22,22,22,0.85)';
      for (let k = 0; k < 4; k++) {                                                                              // round tables with stools
        const cx = x + 64 + k * 128, top = y + h - 62;
        g.fillRect(cx - 44, top, 88, 9); g.fillRect(cx - 5, top, 10, 62);
        for (const sx of [-60, 52]) { g.fillRect(cx + sx, top + 22, 14, 6); g.fillRect(cx + sx + 4, top + 22, 6, 40); }
      }
    }
  };
  room(1536, 0, 512, 256, false); room(1536, 256, 512, 256, true);
  // WINDOWS: a curtain glowing with the room light behind it, the window frame, and an iron grille in front.
  [0, 1].forEach((kind) => {
    const x = 1536 + kind * 256, y = 512;
    for (let k = 0; k < 16; k++) { g.fillStyle = `hsl(0,0%,${68 + ((k * 37) % 5) * 6}%)`; g.fillRect(x + k * 16, y, 16, 256); }   // curtain folds
    if (kind === 1) { g.fillStyle = 'rgba(30,30,30,0.55)'; g.fillRect(x, y, 256, 96); }                           // a blind pulled half down
    g.fillStyle = '#1c1c1c'; g.fillRect(x + 122, y, 12, 256); g.fillRect(x, y, 256, 8); g.fillRect(x, y + 248, 256, 8);   // frame
    g.fillStyle = 'rgba(20,20,20,0.9)';
    for (let k = 0; k <= 8; k++) g.fillRect(x + k * 31, y, 4, 256);                                               // grille bars
    g.fillRect(x, y + 84, 256, 4); g.fillRect(x, y + 168, 256, 4);
  });
  // GLOW: brightest in the middle, fading to nothing.
  const glow = g.createRadialGradient(1664, 896, 0, 1664, 896, 128);
  glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.35, '#6a6a6a'); glow.addColorStop(1, '#000000');
  g.fillStyle = glow; g.fillRect(1536, 768, 256, 256);
}

// Draws the atlas for the signs a map uses. Returns { texture, cell(key) -> [u0, v0, u1, v1] }.
function makeAtlas(signs) {
  const cells = new Map();
  const texture = canvasTexture(ATLAS_W, ATLAS_H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, ATLAS_W, ATLAS_H);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 32);
    drawPictures(g);
    g.textBaseline = 'middle';
    let wide = 1, tall = 0;                                  // (the first wide slot holds the white patch)
    for (const { key, text, icon, look, vertical } of signs) {
      const [w, h] = vertical ? TALL : WIDE;
      if (vertical ? tall >= 8 : wide >= 20) { cells.set(key + (vertical ? '|tall' : ''), cells.values().next().value); continue; }   // atlas full: share the first sign
      const x = vertical ? 1024 + (tall % 4) * w : (wide % 2) * w, y = vertical ? Math.floor(tall / 4) * h : Math.floor(wide / 2) * h;
      if (vertical) tall++; else wide++;
      g.fillStyle = look.background; g.fillRect(x, y, w, h);
      g.strokeStyle = g.fillStyle = look.ink;
      if (!look.neon) { g.lineWidth = 5; g.strokeRect(x + 7, y + 7, w - 14, h - 14); }     // a border, like a real light box
      if (look.neon) { g.shadowColor = look.ink; g.shadowBlur = 16; }
      g.save();
      g.translate(x, y);
      if (vertical) { g.translate(w, 0); g.rotate(Math.PI / 2); }                           // a standing sign reads top to bottom
      const long = vertical ? h : w, short = vertical ? w : h;                              // (now we always draw left to right)
      const iconSize = icon ? short * 0.7 : 0, left = 16 + (icon ? iconSize + 10 : 0), room = long - left - 16;
      if (icon) drawIcon(g, icon, 16, short * 0.15, iconSize);
      let size = short * 0.5;
      const font = () => `bold ${size}px "Helvetica Neue", "PingFang TC", Arial, sans-serif`;
      g.font = font();
      while (g.measureText(text).width > room && size > 12) { size -= 2; g.font = font(); }
      g.textAlign = 'center';
      g.fillText(text, left + room / 2, short / 2 + 2);
      g.restore();
      g.shadowBlur = 0;
      cells.set(key + (vertical ? '|tall' : ''), cellAt(x, y, w, h));
    }
  }, { repeat: false });
  return { texture, cell: (key) => cells.get(key) || WHITE };
}

// The picture on tiled walls: rows of small tiles, each a slightly different shade, with dirt streaks.
function wallTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = makeRandom(91);
    g.fillStyle = '#9c9c9c'; g.fillRect(0, 0, w, h);                                   // grout
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? -14 : 0; x < w; x += 28) {
      const v = 205 + rnd() * 40; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x + 1, y + 1, 26, 6);
    }
    for (let k = 0; k < 26; k++) {                                                     // rain streaks running down
      const x = rnd() * w, wide = 3 + rnd() * 10, streak = g.createLinearGradient(0, 0, 0, h);
      streak.addColorStop(0, 'rgba(40,40,36,0.28)'); streak.addColorStop(1, 'rgba(40,40,36,0)');
      g.fillStyle = streak; g.fillRect(x, 0, wide, h * (0.4 + rnd() * 0.6));
    }
  });
}
// The bumps of corrugated sheet metal: upright ribs every 20 cm (a "normal map": colour = which way the surface leans).
function ribTexture() {
  return canvasTexture(256, 8, (g, w, h) => {
    for (let x = 0; x < w; x++) { g.fillStyle = `rgb(${Math.round(128 + 100 * Math.sin((x / w) * Math.PI * 2 * 10))},128,225)`; g.fillRect(x, 0, 1, h); }
  }, { srgb: false });
}

// ---- Building blocks ------------------------------------------------------------------------
// Everything is made in the building's own coordinates:
//   x = metres behind the front wall (the road is toward -x), z = along the road, y = up from the floor.
function paint(geometry, [r, g, b]) {
  const count = geometry.attributes.position.count, colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
// Lay the wall texture over a shape by where each point is (so tiles are the same size on every wall).
function wrapTexture(geometry) {
  const { position, normal, uv } = geometry.attributes;
  for (let i = 0; i < uv.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (Math.abs(normal.getX(i)) > 0.5) uv.setXY(i, z / TEXTURE_M, y / TEXTURE_M);
    else if (Math.abs(normal.getZ(i)) > 0.5) uv.setXY(i, x / TEXTURE_M, y / TEXTURE_M);
    else uv.setXY(i, z / TEXTURE_M, x / TEXTURE_M);
  }
  return geometry;
}
const showCell = (geometry, cell) => {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cell[0] + uv.getX(i) * (cell[2] - cell[0]), cell[1] + uv.getY(i) * (cell[3] - cell[1]));
  return geometry;
};
// A solid box: `deep` x `high` x `wide`, its centre at (x, z), standing on height y.
const block = (deep, high, wide, x, y, z, color) => paint(wrapTexture(new THREE.BoxGeometry(deep, high, wide).translate(x, y + high / 2, z)), color);
// A pitched roof: a long triangle `deep` x `high` x `wide` with its ridge running along the road.
function gable(deep, high, wide, x, y, z, color) {
  const prism = new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(Math.PI / 2).rotateZ(Math.PI);   // lying along the road, its sharp edge up
  return paint(wrapTexture(prism.scale(deep / 1.732, high / 1.5, wide).translate(x, y + high / 3, z)), color);
}
// An upright round tank (the stainless water tank on every Taiwanese roof).
const tank = (radius, high, x, y, z) => paint(wrapTexture(new THREE.CylinderGeometry(radius, radius, high, 10).translate(x, y + high / 2, z)), STEEL);
// A flat rectangle that glows, facing the road (turn = radians to face another way: PI/2 faces up the road).
// cell = which part of the atlas it shows (default: plain white, so it is just its colour).
const panel = (wide, high, x, y, z, color, cell = WHITE, turn = 0) =>
  paint(showCell(new THREE.PlaneGeometry(wide, high), cell).rotateY(-Math.PI / 2 + turn).translate(x, y + high / 2, z), color);
// A glowing tube or bulb: a thin box of light (neon along an eave, a lantern).
const tube = (deep, high, wide, x, y, z, color) => paint(showCell(new THREE.BoxGeometry(deep, high, wide), [WHITE[0], WHITE[1], WHITE[0], WHITE[1]]).translate(x, y + high / 2, z), color);
// Soft light: a halo standing in front of a sign, or (flat = true) a pool of colour lying on the ground.
function halo(wide, high, x, y, z, color, flat = false, turn = 0) {
  if (flat && !GRAPHICS.lightPools) return null;            // pools on the ground are off: real lamps light the ground instead
  const geometry = showCell(new THREE.PlaneGeometry(wide, high), GLOW);
  if (flat) geometry.rotateX(-Math.PI / 2).translate(x, y, z); else geometry.rotateY(-Math.PI / 2 + turn).translate(x, y, z);
  return paint(geometry, color);
}
// Neon tubes round a rectangle on the front wall (a shop window, a doorway).
function outline(out, wide, high, x, y, z, color) {
  const c = tint(color, 2.7 * LEVEL);
  out.lit.push(tube(0.05, 0.05, wide, x, y, z, c), tube(0.05, 0.05, wide, x, y + high, z, c), tube(0.05, high, 0.05, x, y, z - wide / 2, c), tube(0.05, high, 0.05, x, y, z + wide / 2, c));
}

// ---- Parts several kinds share -------------------------------------------------------------------
// Each kind gets  out = { wall: [], solid: [], lit: [], glow: [], wire: [], neons: [], lamps: [] }  to add to.

// A row of windows on a wall facing the road: dark glass, some of them lit behind their grilles,
// each under a little sheet-metal rain cover.
function windows(out, rnd, count, wide, high, x, y, zFrom, zTo, litChance, lightColor) {
  for (let k = 0; k < count; k++) {
    const z = zFrom + ((k + 0.5) / count) * (zTo - zFrom);
    if (rnd() < litChance) out.lit.push(panel(wide, high, x - 0.03, y, z, tint(lightColor, (0.75 + rnd() * 0.45) * LEVEL), pick(rnd, WINDOWS)));
    else out.solid.push(block(0.06, high, wide, x, y, z, GLASS));
    out.solid.push(block(0.45, 0.05, wide + 0.3, x - 0.22, y + high + 0.08, z, DARK));
    if (rnd() < 0.4) out.solid.push(block(0.32, 0.5, 0.8, x - 0.16, y - 0.6, z + wide * 0.2, STEEL));       // air conditioner
  }
}
// A lit sign over the door with the light it throws: a halo round it, a pool on the ground, and a tint on what is near.
function signOver(out, b, y, wide, high, strength) {
  const color = b.look.glow;
  out.lit.push(panel(wide, high, -0.3, y, 0, tint(0xffffff, strength * LEVEL), b.cell(false)));
  out.glow.push(halo(wide * 1.6, high * 3.6, -0.36, y + high / 2, 0, tint(color, 0.4 * LEVEL)));
  out.glow.push(halo(wide * 1.4, 8, -4, 0.06, 0, tint(color, 0.3 * LEVEL), true));
  out.neons.push({ at: [-1.5, y, 0], color, power: 12 });
}
// A dome on a short drum (the columbarium's roofs).
function dome(radius, x, y, z, color) {
  const half = new THREE.SphereGeometry(radius, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y, z);
  return paint(wrapTexture(half), color);
}
// A tall sign sticking out from the corner of a building (招牌), readable from both directions.
function sideSign(out, b, y, z) {
  out.solid.push(block(1.0, 0.08, 0.08, -0.5, y + 2.9, z, DARK));
  for (const turn of [Math.PI / 2, -Math.PI / 2]) out.lit.push(panel(0.8, 3.0, -0.75, y, z + (turn > 0 ? 0.06 : -0.06), tint(0xffffff, 1.9 * LEVEL), b.cell(true), turn));
}
// The plain single-storey box under a pitched sheet-metal roof that cafés, eateries and shacks are made from.
function shed(out, { width, depth }, rnd, wall, tiled, high = 3.1) {
  (tiled ? out.wall : out.solid).push(block(depth, high + FOOTING, width, depth / 2, -FOOTING, 0, wall));
  out.solid.push(gable(depth + 1.4, 1.5, width + 0.8, depth / 2 - 0.2, high, 0, pick(rnd, SHEET_METAL)));
  out.solid.push(block(1.5, 0.07, width + 0.4, -0.75, high - 0.25, 0, pick(rnd, AWNINGS)));                // awning over the front
  return high;
}

// ---- The kinds of building --------------------------------------------------------------------

// A townhouse — or, when the plot is wide, several side by side as a terrace, each its own colour and height.
function house(out, { width, depth, levels = 3 }, rnd) {
  const units = Math.max(1, Math.round(width / 5.2)), wide = width / units;
  for (let u = 0; u < units; u++) {
    const z = -width / 2 + wide * (u + 0.5), floors = Math.max(2, levels + (units > 1 && rnd() < 0.3 ? -1 : 0)), high = floors * FLOOR;
    const tile = pick(rnd, TILES);
    out.wall.push(block(depth, high + FOOTING, wide - 0.06, depth / 2, -FOOTING, z, tile));
    out.solid.push(block(0.12, high, 0.12, -0.06, 0, z + wide / 2 - 0.2, STEEL));                          // drain pipe
    // Ground floor: a roll-up shutter; now and then it is up, with the light on in the room behind.
    if (rnd() < 0.28) {
      const light = rnd() < 0.5 ? WARM : TUBE;
      out.lit.push(panel(wide - 1.4, 2.5, -0.04, 0.1, z, tint(light, 0.95 * LEVEL), SHOP));
      out.glow.push(halo(wide, 5, -3, 0.06, z, tint(light, 0.16 * LEVEL), true));
    } else out.solid.push(block(0.08, 2.7, wide - 1.3, -0.03, 0, z, SHUTTER));
    for (let f = 1; f < floors; f++) {
      const y = f * FLOOR;
      out.wall.push(block(1.1, 0.14, wide - 0.06, -0.55, y - 0.14, z, shade(tile, 0.8)));               // balcony floor
      out.solid.push(block(0.05, 0.95, wide - 0.2, -1.08, y, z, DARK));                                 // railing
      windows(out, rnd, 2, wide * 0.3, 1.5, -0.02, y + 0.9, z - wide / 2, z + wide / 2, 0.3, rnd() < 0.5 ? TUBE : WARM);
    }
    // On the roof: often a sheet-metal extra floor under a pitched roof, and the stainless water tank on its stand.
    let top = high;
    if (rnd() < 0.65) {
      const metal = pick(rnd, SHEET_METAL);
      out.solid.push(block(depth * 0.7, 1.6, wide - 0.1, depth * 0.45, high, z, metal), gable(depth * 0.8, 1.1, wide + 0.3, depth * 0.45, high + 1.6, z, shade(metal, 0.8)));
      top = high + 1.6;
    } else out.wall.push(block(depth, 0.9, 0.15, depth / 2, high, z - wide / 2 + 0.1, tile), block(0.15, 0.9, wide - 0.06, 0.08, high, z, tile));   // parapet
    const tankX = top > high ? depth * 0.08 : depth * 0.8, tankZ = z + (rnd() - 0.5) * (wide - 2.2);
    out.solid.push(block(1.3, 0.9, 1.3, tankX, high, tankZ, DARK), tank(0.55, 1.4, tankX, high + 0.9, tankZ));
  }
}

function shack(out, b, rnd) {
  shed(out, b, rnd, pick(rnd, SHEET_METAL), false);
  out.solid.push(block(0.08, 2.1, 1.0, -0.03, 0, -b.width * 0.2, DARK));                                 // door
  windows(out, rnd, 2, 1.3, 1.1, -0.02, 1.0, 0, b.width / 2, 0.4, WARM);
}

function cafe(out, b, rnd) {
  const high = shed(out, b, rnd, pick(rnd, SHEET_METAL), false), w = b.width, neon = b.look.glow;
  out.solid.push(block(0.08, 2.1, 1.0, -0.03, 0, -w * 0.32, DARK));
  out.lit.push(panel(w * 0.52, 1.7, -0.04, 0.8, w * 0.16, tint(WARM, 1.1 * LEVEL), SHOP));              // one long warm window
  for (let z = -w / 2 + 0.4; z < w / 2; z += 0.8) out.lit.push(tube(0.12, 0.12, 0.12, -1.45, high - 0.45, z, tint(WARM, 2.4 * LEVEL)));   // a string of bulbs
  out.lit.push(tube(0.05, 0.05, w + 0.4, -1.5, high - 0.22, 0, tint(neon, 2.8 * LEVEL)));               // neon along the awning
  outline(out, w * 0.56, 1.9, -0.07, 0.7, w * 0.16, neon === PINK ? AQUA : PINK);                        // ...and round the window, in a second colour
  for (const z of [-w / 2 + 0.05, w / 2 - 0.05]) out.lit.push(tube(0.05, high - 0.4, 0.05, -0.06, 0.1, z, tint(neon, 2.6 * LEVEL)));   // up both corners
  signOver(out, b, high + 0.35, Math.min(w * 0.6, 4.2), 1.0, 2.2);
  out.glow.push(halo(w, 6, -3.2, 0.06, w * 0.16, tint(WARM, 0.2 * LEVEL), true));
  out.neons.push({ at: [-2, 1.4, 0], color: WARM, power: 9 });
}

function eatery(out, b, rnd) {
  const high = shed(out, b, rnd, pick(rnd, TILES), true, 3.5), w = b.width;
  out.lit.push(panel(w * 0.74, 2.4, -0.04, 0.15, 0, tint(TUBE, 1.15 * LEVEL), ROOM));                   // glass front, tube light inside
  for (const z of [-w * 0.37, -w * 0.12, w * 0.12, w * 0.37]) out.solid.push(block(0.1, 2.6, 0.1, -0.08, 0.1, z, DARK));   // window frames
  out.lit.push(tube(0.05, 0.05, w + 0.4, -1.5, high - 0.22, 0, tint(GREEN, 2.6 * LEVEL)));              // green tube along the awning
  outline(out, w * 0.78, 2.6, -0.07, 0.1, 0, RED);                                                       // red tubes round the glass front
  signOver(out, b, high + 0.3, w * 0.85, 1.1, 1.9);
  sideSign(out, b, 1.3, w / 2 - 0.3);
  out.glow.push(halo(w, 6, -3.2, 0.06, 0, tint(TUBE, 0.2 * LEVEL), true));
  out.neons.push({ at: [-2, 1.4, 0], color: TUBE, power: 9 });
}

function seafood(out, b, rnd) {
  const high = (b.levels || 1) * 4.2, w = b.width, tile = pick(rnd, TILES);
  out.wall.push(block(b.depth, high + FOOTING, w, b.depth / 2, -FOOTING, 0, tile));
  out.solid.push(gable(b.depth + 1.2, 1.4, w + 0.6, b.depth / 2, high, 0, pick(rnd, SHEET_METAL)));
  // The whole front is open: a bright tube-lit dining room behind a row of columns.
  for (const half of [-1, 1]) out.lit.push(panel(w / 2 - 0.5, 3.0, -0.04, 0.1, (half * w) / 4, tint(TUBE, 1.35 * LEVEL), ROOM));
  for (let z = -w / 2 + 0.3; z <= w / 2; z += (w - 0.6) / 4) out.wall.push(block(0.4, 3.2, 0.4, -0.25, 0, z, tile));
  out.solid.push(block(2.6, 0.12, w + 0.6, -1.3, 3.2, 0, tint(0x9a2018)));                               // red awning...
  out.lit.push(tube(0.06, 0.06, w + 0.6, -2.6, 3.17, 0, tint(RED, 2.8 * LEVEL)));                        // ...edged with a red tube
  for (let z = -w / 2 + 0.5; z < w / 2; z += 0.85) out.lit.push(tube(0.12, 0.12, 0.12, -2.45, 2.95, z, tint(WARM, 2.4 * LEVEL)));   // and a string of bulbs
  for (const z of [-w / 2 + 0.05, w / 2 - 0.05]) out.lit.push(tube(0.06, high, 0.06, -0.08, 0.1, z, tint(RED, 2.7 * LEVEL)));   // red tubes up both corners
  out.lit.push(tube(0.05, 0.05, w - 1.6, -2.0, 1.78, 0, tint(AQUA, 2.8 * LEVEL)));                       // an aqua tube over the tanks
  // Fish tanks stacked along the front, glowing aqua.
  for (let z = -w / 2 + 1.2; z < w / 2 - 0.8; z += 1.9) {
    out.solid.push(block(0.9, 0.45, 1.75, -1.5, 0, z, DARK), block(0.9, 0.08, 1.75, -1.5, 1.05, z, DARK));
    for (const y of [0.47, 1.14]) out.lit.push(panel(1.65, 0.56, -1.96, y, z, tint(AQUA, 1.9 * LEVEL)));
  }
  out.glow.push(halo(w * 1.1, 5, -4.2, 0.06, 0, tint(AQUA, 0.32 * LEVEL), true), halo(w * 1.4, 10, -8, 0.07, 0, tint(TUBE, 0.14 * LEVEL), true));
  // The big sign on the roof edge, and a tall one on a post by the road, readable from both directions.
  out.lit.push(panel(w * 0.8, 1.7, -0.5, high + 0.5, 0, tint(0xffffff, 2.0 * LEVEL), b.cell(false)));
  out.glow.push(halo(w * 1.2, 5, -0.56, high + 1.35, 0, tint(RED, 0.3 * LEVEL)));
  const postX = -(b.front - b.kerb) + 0.8, postZ = w / 2 - 0.5;
  out.solid.push(block(0.25, 7.4, 0.25, postX, 0, postZ, DARK));
  for (const turn of [Math.PI / 2, -Math.PI / 2]) out.lit.push(panel(1.15, 4.4, postX, 2.9, postZ + (turn > 0 ? 0.14 : -0.14), tint(0xffffff, 2.2 * LEVEL), b.cell(true), turn));
  out.glow.push(halo(6, 6, postX, 0.06, postZ, tint(RED, 0.26 * LEVEL), true));
  out.neons.push({ at: [-2.5, 1.0, 0], color: AQUA, power: 14 }, { at: [-1.5, high + 1, 0], color: RED, power: 16 }, { at: [postX, 4.5, postZ], color: RED, power: 14 });
  out.lamps.push({ at: [-3.5, 3.0, 0], color: TUBE, intensity: 140, distance: 36 });
}

function police(out, b, rnd) {
  const high = (b.levels || 2) * FLOOR, w = b.width, tile = tint(0xc9c9c4);
  out.wall.push(block(b.depth, high + FOOTING, w, b.depth / 2, -FOOTING, 0, tile), block(b.depth, 0.8, 0.15, b.depth / 2, high, -w / 2 + 0.08, tile), block(0.15, 0.8, w, 0.08, high, 0, tile));
  out.solid.push(block(2.6, 0.2, w * 0.5, -1.3, 3.0, 0, CONCRETE));                                      // porch roof
  for (const z of [-w * 0.24, w * 0.24]) out.solid.push(block(0.3, 3.0, 0.3, -2.4, 0, z, CONCRETE));
  out.lit.push(panel(w * 0.34, 2.3, -0.04, 0.1, 0, tint(TUBE, 1.15 * LEVEL), SHOP));                    // the duty desk is always lit
  windows(out, rnd, 2, 1.4, 1.4, -0.02, 0.9, -w / 2, -w * 0.2, 0.3, TUBE);
  windows(out, rnd, 2, 1.4, 1.4, -0.02, 0.9, w * 0.2, w / 2, 0.3, TUBE);
  windows(out, rnd, 4, 1.4, 1.4, -0.02, FLOOR + 0.9, -w / 2, w / 2, 0.35, TUBE);
  out.lit.push(panel(w * 0.4, 0.8, -2.62, 3.25, 0, tint(0xffffff, 1.5 * LEVEL), b.cell(false)));
  out.lit.push(tube(0.4, 0.4, 0.4, -2.75, 2.45, w * 0.24, tint(RED, 2.6 * LEVEL)));                      // the red lamp
  out.glow.push(halo(2.6, 2.6, -2.98, 2.65, w * 0.24, tint(RED, 0.35 * LEVEL)), halo(6, 6, -3.5, 0.06, w * 0.2, tint(RED, 0.2 * LEVEL), true), halo(w * 0.7, 6, -4, 0.06, 0, tint(TUBE, 0.16 * LEVEL), true));
  out.neons.push({ at: [-3.0, 2.6, w * 0.24], color: RED, power: 12 }, { at: [-2.5, 1.5, 0], color: TUBE, power: 8 });
}

function temple(out, b, rnd) {
  const w = b.width, d = b.depth, red = tint(0x7e2418), roof = tint(0x8a4a22);
  out.solid.push(block(d + 2.4, 0.4 + FOOTING, w + 2.4, d / 2 - 0.6, -FOOTING, 0, CONCRETE));              // platform
  out.solid.push(block(d, 3.2, w, d / 2, 0.4, 0, red));
  for (const z of [-w / 2 + 0.2, -w * 0.2, w * 0.2, w / 2 - 0.2]) out.solid.push(block(0.3, 3.2, 0.3, -0.9, 0.4, z, red));   // red columns holding the porch
  out.solid.push(gable(d + 3.2, 1.5, w + 2.8, d / 2 - 0.5, 3.6, 0, roof), gable(d * 0.7, 1.1, w + 1.2, d / 2, 4.6, 0, shade(roof, 1.15)));   // the roof, in two tiers
  for (const z of [-w / 2 - 1.5, w / 2 + 1.5]) out.solid.push(block(0.3, 0.9, 0.3, d / 2 - 0.5, 4.5, z, roof));   // the upturned ridge ends
  out.lit.push(panel(w * 0.5, 2.3, -0.04, 0.5, 0, tint(AMBER, 1.3 * LEVEL), SHOP));                      // the lit altar seen through the door
  for (let z = -w / 2 - 0.4; z <= w / 2 + 0.41; z += (w + 0.8) / 5) out.lit.push(tube(0.45, 0.6, 0.45, -1.4, 2.7, z, tint(RED, 2.3 * LEVEL)));   // a row of lanterns
  out.lit.push(tube(0.06, 0.06, w + 2.8, -2.1, 3.62, 0, tint(AMBER, 2.8 * LEVEL)));                      // a gold tube along the eave
  out.glow.push(halo(w + 4, 3.8, -1.7, 3.0, 0, tint(RED, 0.4 * LEVEL)), halo(w + 2, 8, -4, 0.06, 0, tint(AMBER, 0.3 * LEVEL), true));
  out.neons.push({ at: [-2, 2.8, 0], color: RED, power: 14 }, { at: [-1.5, 1.2, 0], color: AMBER, power: 9 });
}

function hall(out, b, rnd) {
  const floors = b.levels || 2, high = floors * FLOOR, w = b.width, tile = pick(rnd, TILES);
  out.wall.push(block(b.depth, high + FOOTING, w, b.depth / 2, -FOOTING, 0, tile), block(0.15, 0.8, w, 0.08, high, 0, tile));
  out.solid.push(block(1.8, 0.16, 4.5, -0.9, 2.9, 0, CONCRETE), block(0.08, 2.4, 2.2, -0.03, 0, 0, GLASS));
  for (let f = 0; f < floors; f++) {
    windows(out, rnd, Math.max(1, Math.round(w / 8)), 1.6, 1.4, -0.02, f * FLOOR + 1.0, -w / 2, -1.6, 0.25, TUBE);
    windows(out, rnd, Math.max(1, Math.round(w / 8)), 1.6, 1.4, -0.02, f * FLOOR + 1.0, 1.6, w / 2, 0.25, TUBE);
  }
  if (b.look) signOver(out, b, 3.15, Math.min(w * 0.45, 4.6), 0.85, 1.4);
  out.solid.push(tank(0.6, 1.5, b.depth * 0.7, high, w * 0.3));
}

function toilet(out, b, rnd) {
  const high = shed(out, b, rnd, CONCRETE, true, 2.9);
  out.lit.push(tube(0.06, 0.08, b.width * 0.6, -0.1, 2.45, 0, tint(TUBE, 2.2 * LEVEL)));                // one tube light over the doors
  for (const z of [-b.width * 0.25, b.width * 0.25]) out.solid.push(block(0.08, 2.1, 0.9, -0.03, 0, z, DARK));
  out.lit.push(panel(1.6, 0.6, -0.05, high - 0.35, 0, tint(0xffffff, 1.3 * LEVEL), b.cell(false)));
  out.glow.push(halo(b.width, 5, -2.5, 0.06, 0, tint(TUBE, 0.2 * LEVEL), true));
  out.neons.push({ at: [-1.5, 2.2, 0], color: TUBE, power: 7 });
}

// A bus shelter: a roof on two posts with a bench, one tube light, and the stop sign on its own post.
function busStop(out) {
  out.solid.push(block(1.4, 0.1, 3.6, 0.7, 2.5, 0, tint(0x2c6a5c)), block(0.06, 2.0, 3.4, 1.35, 0.4, 0, DARK), block(0.4, 0.06, 2.6, 1.0, 0.5, 0, STEEL));
  for (const z of [-1.6, 1.6]) out.solid.push(block(0.1, 2.5, 0.1, 0.15, 0, z, STEEL));
  out.solid.push(block(0.08, 2.7, 0.08, 0, 0, 2.6, STEEL), block(0.05, 0.55, 0.55, 0, 2.2, 2.6, tint(0xd8d8d2)), block(0.05, 0.9, 0.45, 0, 1.1, 2.6, tint(0x2d6aa8)));
  out.lit.push(tube(0.08, 0.05, 1.6, 0.8, 2.42, 0, tint(TUBE, 2.0 * LEVEL)));
  out.glow.push(halo(5, 5, 0.3, 0.06, 0, tint(TUBE, 0.16 * LEVEL), true));
  out.neons.push({ at: [0.3, 2.2, 0], color: TUBE, power: 6 });
}

// A road lamp: a tall grey pole with an arm over the road and a sodium-orange head ("color" changes it).
function streetLamp(out, b) {
  const color = b.color ? new THREE.Color(b.color).getHex() : 0xffa040;
  out.solid.push(block(0.18, 9, 0.18, 0, 0, 0, STEEL), block(2.6, 0.12, 0.12, -1.3, 8.9, 0, STEEL), block(0.75, 0.14, 0.3, -2.5, 8.78, 0, DARK));
  out.lit.push(tube(0.6, 0.06, 0.24, -2.5, 8.7, 0, tint(color, 3.0 * LEVEL)));
  for (const turn of [0, Math.PI / 2]) out.glow.push(halo(3.4, 3.4, -2.5, 8.7, 0, tint(color, 0.45 * LEVEL), false, turn));   // the glare round the head, seen from any side
  out.glow.push(halo(20, 20, -3.2, 0.06, 0, tint(color, 0.3 * LEVEL), true));                             // its pool of light on the road
  out.lamps.push({ at: [-2.5, 8.3, 0], color, intensity: 260, distance: 46 });
}

// The lamp of a divided highway: one pole standing on the median wall with an arm and a lamp over each side.
function medianLamp(out, b) {
  const color = b.color ? new THREE.Color(b.color).getHex() : 0xffa040;
  out.solid.push(block(0.2, 9.2, 0.2, 0, 0.85, 0, STEEL));
  for (const x of [-1, 1]) {
    out.solid.push(block(2.4, 0.12, 0.12, x * 1.2, 9.9, 0, STEEL), block(0.75, 0.14, 0.3, x * 2.3, 9.78, 0, DARK));
    out.lit.push(tube(0.6, 0.06, 0.24, x * 2.3, 9.7, 0, tint(color, 3.0 * LEVEL)));
    for (const turn of [0, Math.PI / 2]) out.glow.push(halo(3.2, 3.2, x * 2.3, 9.7, 0, tint(color, 0.45 * LEVEL), false, turn));
  }
  out.lamps.push({ at: [0, 9.2, 0], color, intensity: 300, distance: 50 });
}

// A concrete utility pole with a cross-arm; every few poles carry a grey transformer drum.
function utilityPole(out, b, rnd) {
  out.solid.push(block(0.26, 10, 0.26, 0, 0, 0, CONCRETE), block(0.1, 0.1, 2.0, 0, 9.3, 0, DARK), block(0.1, 0.1, 1.4, 0, 8.5, 0, DARK));
  if (rnd() < 0.3) out.solid.push(tank(0.32, 0.9, 0.45, 7.0, 0));
}

// A lattice pylon: drawn as thin lines (which is all you see of one at night) with a red light on top.
function powerTower(out) {
  const HIGH = 42, line = (a, b) => out.wire.push(...a, ...b);
  const ring = (y, half) => [[-half, y, -half], [half, y, -half], [half, y, half], [-half, y, half]];
  const levels = [[0, 4.5], [10, 3.2], [20, 2.1], [30, 1.3], [HIGH, 0.6]].map(([y, half]) => ring(y, half));
  for (let k = 0; k < levels.length; k++) {
    for (let c = 0; c < 4; c++) {
      line(levels[k][c], levels[k][(c + 1) % 4]);                                  // the ring at this height
      if (k + 1 < levels.length) { line(levels[k][c], levels[k + 1][c]); line(levels[k][c], levels[k + 1][(c + 1) % 4]); }   // leg and diagonal brace
    }
  }
  for (const y of [26, 32, 38]) { line([0, y, -9], [0, y, 9]); line([0, y - 2.5, 0], [0, y, -9]); line([0, y - 2.5, 0], [0, y, 9]); }   // the arms that carry the cables
  out.lit.push(tube(0.7, 0.7, 0.7, 0, HIGH, 0, tint(RED, 3.0 * LEVEL)));
}

// ---- Landmarks: each one a real place --------------------------------------------------------------

// Zhongjiao Bay surf centre. Real: a white building of three stepped floors with terraces, and a
// mural of blue waves rolling across the whole front. Here the crest of the wave is also a neon tube.
function surfBase(out, b, rnd) {
  const w = b.width, d = b.depth, white = tint(0xe6edf0), blues = [0x1f6fb5, 0x3d9bd6, 0x0f4f8f].map((hex) => tint(hex));
  for (let f = 0; f < 3; f++) {                                              // each floor shorter than the one below: terraces
    const wide = w * (1 - f * 0.2), z = -(w - wide) / 2;
    out.wall.push(block(d - f * 1.5, FLOOR + (f ? 0 : FOOTING), wide, (d - f * 1.5) / 2 + f * 1.5, f * FLOOR - (f ? 0 : FOOTING), z, white));
    out.solid.push(block(0.05, 0.95, wide, f * 1.5 - 0.02, (f + 1) * FLOOR, z, GLASS));        // glass rail round the terrace above
    out.lit.push(panel(wide * 0.5, 1.5, f * 1.5 - 0.05, f * FLOOR + 0.9, z + wide * 0.18, tint(TUBE, (f ? 0.8 : 1.15) * LEVEL), f ? pick(rnd, WINDOWS) : SHOP));
  }
  // The mural: three bands of blue whose tops rise and fall like waves, and an aqua tube along the top crest.
  const columns = 28, step = w / columns;
  for (let k = 0; k < columns; k++) {
    const z = -w / 2 + step * (k + 0.5);
    blues.forEach((blue, band) => {
      const crest = 1.1 + band * 1.7 + Math.sin(k * 0.55 + band * 1.9) * 0.55;
      out.solid.push(block(0.05, crest - band * 1.2, step + 0.02, -0.03 - band * 0.01, band * 1.2, z, blue));
      if (band === 2) out.lit.push(tube(0.06, 0.06, step + 0.02, -0.09, crest + band * 1.2 - 1.2, z, tint(AQUA, 2.7 * LEVEL)));
    });
  }
  out.lit.push(tube(0.06, 0.06, w, -0.06, 3 * FLOOR + 0.9, 0, tint(PINK, 2.6 * LEVEL)));                    // a pink line round the top terrace
  // Beside it: the round visitor pavilion with its ring of windows, and a rack of surfboards under a lamp.
  const round = new THREE.CylinderGeometry(4.2, 4.2, 4.2, 20).translate(4.5, 2.1, w / 2 + 6);
  out.wall.push(paint(wrapTexture(round), white), paint(wrapTexture(new THREE.CylinderGeometry(4.8, 4.8, 0.3, 20).translate(4.5, 4.35, w / 2 + 6)), tint(0x2a4f7a)));
  for (let k = 0; k < 7; k++) { const a = Math.PI * (0.6 + k * 0.13); out.lit.push(panel(1.3, 1.5, 4.5 + Math.cos(a) * 4.25, 1.3, w / 2 + 6 + Math.sin(a) * 4.25, tint(WARM, 1.0 * LEVEL), WINDOWS[1], a - Math.PI)); }
  out.lit.push(tube(0.08, 0.08, 9.6, 4.5, 4.6, w / 2 + 6, tint(AQUA, 2.6 * LEVEL)), tube(9.6, 0.08, 0.08, 4.5, 4.6, w / 2 + 6, tint(AQUA, 2.6 * LEVEL)));
  [0xff5a3c, 0xffd23c, 0x3cd2ff, 0xff6ad0, 0x6aff9a, 0xffffff].forEach((board, k) => out.solid.push(block(0.08, 2.3, 0.5, -2.2, 0.1, -w / 2 + 1 + k * 0.7, tint(board))));
  out.lit.push(tube(0.06, 0.06, 4.6, -2.2, 2.75, -w / 2 + 2.7, tint(TUBE, 2.2 * LEVEL)));
  out.glow.push(halo(7, 5, -2.6, 0.07, -w / 2 + 2.7, tint(TUBE, 0.22 * LEVEL), true));
  if (b.look) signOver(out, b, FLOOR - 0.1, 7, 1.1, 1.7);
  out.glow.push(halo(w * 1.2, 9, -5, 0.06, 0, tint(AQUA, 0.32 * LEVEL), true), halo(w, 7, -0.2, 4, 0, tint(AQUA, 0.22 * LEVEL)));
  out.neons.push({ at: [-2, 3, -w * 0.25], color: AQUA, power: 16 }, { at: [-2, 3, w * 0.25], color: AQUA, power: 16 }, { at: [-1, 9, 0], color: PINK, power: 8 });
}

// The Caoli sea-wall temple. Real: a small hall of grey stone with red doors, under a roof whose
// ridge sweeps up at both ends (a "swallowtail") and is crowded with coloured ornaments.
function shrine(out, b, rnd) {
  const w = b.width, d = b.depth, stone = tint(0x8d8a84), roof = tint(0x8a3a22), red = tint(0x9a2018);
  out.solid.push(block(d + 3, 0.5 + FOOTING, w + 3, d / 2 - 1, -FOOTING, 0, CONCRETE));                  // forecourt platform
  out.wall.push(block(d, 3.0, w, d / 2, 0.5, 0, stone));
  for (const z of [-1.0, 1.0]) out.solid.push(block(0.08, 2.3, 0.95, -0.03, 0.5, z * 0.5, red));         // the red doors, ajar...
  out.lit.push(panel(0.5, 2.2, -0.06, 0.55, 0, tint(AMBER, 1.6 * LEVEL)));                               // ...on the lit altar
  for (const z of [-w * 0.33, w * 0.33]) out.lit.push(panel(1.0, 1.0, -0.04, 1.4, z, tint(WARM, 0.9 * LEVEL), WINDOWS[0]));   // round-ish side windows
  out.solid.push(gable(d + 2.6, 1.3, w + 1.8, d / 2, 3.5, 0, roof));
  // The swallowtail ridge: it climbs in steps toward both ends, with ornaments in bright glazes along it.
  const glazes = [0x2f9a6a, 0xe0b020, 0x2a6ad0, 0xd03a2a].map((hex) => tint(hex));
  for (let k = -4; k <= 4; k++) {
    const z = (k / 4) * (w / 2 + 0.9), rise = Math.abs(k) ** 1.6 * 0.09;
    out.solid.push(block(0.3, 0.3 + rise, (w + 1.8) / 8.2, d / 2, 4.6, z, roof), block(0.18, 0.28, 0.3, d / 2, 4.9 + rise, z, glazes[(k + 4) % 4]));
  }
  for (let z = -w / 2 - 0.3; z <= w / 2 + 0.31; z += (w + 0.6) / 4) out.lit.push(tube(0.45, 0.6, 0.45, -1.2, 2.55, z, tint(RED, 2.4 * LEVEL)));   // lanterns under the eave
  out.lit.push(tube(0.06, 0.06, w + 1.8, -1.35, 3.5, 0, tint(AMBER, 2.8 * LEVEL)), tube(0.06, 0.06, w + 2.6, d / 2, 4.62, 0, tint(GREEN, 2.4 * LEVEL)));   // gold along the eave, green along the ridge
  for (const z of [-w / 2 - 0.6, w / 2 + 0.6]) {                                                           // a stone lion each side, and red gate posts with a lamp on top
    out.solid.push(block(0.7, 0.5, 0.7, -2.0, 0.5, z, stone), block(0.5, 0.75, 0.6, -2.0, 1.0, z, shade(stone, 0.85)));
    out.solid.push(block(0.35, 3.0, 0.35, -4.6, 0.5, z * 1.5, red));
    out.lit.push(tube(0.4, 0.4, 0.4, -4.6, 3.5, z * 1.5, tint(AMBER, 2.4 * LEVEL)));
  }
  out.solid.push(block(0.25, 0.3, w * 1.5 + 1.8, -4.6, 3.2, 0, red));                                      // the beam of the gate
  out.solid.push(gable(d * 0.5, 0.8, w * 0.7, d / 2, 4.75, 0, shade(roof, 1.2)));                          // a second, smaller roof on top
  out.solid.push(block(0.9, 1.0, 0.9, -3.2, 0.5, 0, DARK));                                              // the incense burner out front
  out.lit.push(tube(0.5, 0.12, 0.5, -3.2, 1.5, 0, tint(AMBER, 2.0 * LEVEL)));
  out.glow.push(halo(w + 5, 4.5, -1.5, 3.0, 0, tint(RED, 0.45 * LEVEL)), halo(w + 4, 9, -4, 0.56, 0, tint(AMBER, 0.34 * LEVEL), true));
  out.neons.push({ at: [-2, 2.8, 0], color: RED, power: 16 }, { at: [-3, 1.6, 0], color: AMBER, power: 10 });
}

// The memorial hall of the hillside cemetery. Real: a long white palace with a great dome in the
// middle and smaller ones beside it, arcades of tall arched windows, and broad steps. Lit here the way
// such places are at night — warm light washing up the white walls — with a cold rim on the domes.
function columbarium(out, b, rnd) {
  const w = b.width, d = b.depth, white = tint(0xdfe1e0), cap = tint(0x6f8792), high = 2 * 4.2;
  out.wall.push(block(d, high + FOOTING, w, d / 2, -FOOTING, 0, white), block(d * 0.5, 3.4, w * 0.36, d / 2, high, 0, white));
  out.solid.push(block(3.5, 0.5, w * 0.5, -1.75, 0, 0, CONCRETE), block(1.8, 0.5, w * 0.42, -4.2, -0.25, 0, CONCRETE));   // the steps
  out.solid.push(block(1.4, 0.3, w + 0.6, -0.5, high, 0, white));                                          // cornice
  for (let k = 0; k < 11; k++) {                                                                           // arcade: columns with tall lit windows between
    const z = -w / 2 + (w / 10) * k;
    out.solid.push(block(0.5, high, 0.5, -0.6, 0, z, white));
    if (k < 10) for (const y of [0.9, 5.1]) out.lit.push(panel(w / 10 - 1.3, 2.6, -0.04, y, z + w / 20, tint(WARM, (0.55 + rnd() * 0.35) * LEVEL), WINDOWS[1]));
  }
  out.solid.push(dome(w * 0.15, d / 2, high + 3.4, 0, cap));                                               // the great dome on its drum...
  for (const z of [-w * 0.36, w * 0.36]) out.solid.push(block(4, 1.4, 4, d / 2, high, z, white), dome(2.4, d / 2, high + 1.4, z, cap));   // ...and the two beside it
  out.lit.push(tube(w * 0.15 * 2 + 0.2, 0.08, 0.08, d / 2, high + 3.4, w * 0.15, tint(AQUA, 2.5 * LEVEL)), tube(0.08, 0.08, w * 0.3, d / 2 - w * 0.15, high + 3.4, 0, tint(AQUA, 2.5 * LEVEL)));   // cold light round the drum
  out.lit.push(tube(0.3, 0.9, 0.3, d / 2, high + 3.4 + w * 0.15, 0, tint(AMBER, 2.6 * LEVEL)));           // a gold finial on top
  for (const z of [-w * 0.18, w * 0.18]) out.solid.push(block(3, 1.0, 3, d * 0.3, high, z, white), dome(1.7, d * 0.3, high + 1.0, z, cap));   // two more small domes in front
  for (let z = -w * 0.24; z <= w * 0.241; z += w * 0.06) out.solid.push(block(0.25, 0.9, 0.25, -3.4, 0.5, z, white));   // balustrade along the steps
  out.solid.push(block(3.6, 0.12, w * 0.5, -3.4, 1.35, 0, white));
  for (const z of [-w * 0.3, w * 0.3]) { out.solid.push(block(0.12, 9, 0.12, -6, 0, z, STEEL)); out.lit.push(tube(0.3, 0.3, 0.3, -6, 9, z, tint(TUBE, 2.2 * LEVEL))); }   // two flagpoles with a light on top
  // A round pool before the steps, lit from under the water.
  out.solid.push(paint(wrapTexture(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 20).translate(-9.5, 0.25, 0)), white));
  out.lit.push(paint(showCell(new THREE.CircleGeometry(3.0, 20), [WHITE[0], WHITE[1], WHITE[0], WHITE[1]]).rotateX(-Math.PI / 2).translate(-9.5, 0.52, 0), tint(AQUA, 1.6 * LEVEL)));
  out.glow.push(halo(11, 11, -9.5, 0.56, 0, tint(AQUA, 0.3 * LEVEL), true));
  out.lit.push(tube(0.08, 0.08, w + 0.6, -1.2, high + 0.3, 0, tint(AMBER, 2.4 * LEVEL)));                 // a warm line along the cornice
  for (let z = -w / 2 + w / 20; z < w / 2; z += w / 5) out.glow.push(halo(w / 4, high * 1.5, -0.7, high * 0.45, z, tint(AMBER, 0.34 * LEVEL)));   // light washing up the wall
  out.glow.push(halo(w * 1.1, 12, -6, 0.3, 0, tint(AMBER, 0.26 * LEVEL), true));
  out.neons.push({ at: [-3, 3, -w * 0.25], color: AMBER, power: 16 }, { at: [-3, 3, w * 0.25], color: AMBER, power: 16 }, { at: [0, high + 5, 0], color: AQUA, power: 10 });
  out.lamps.push({ at: [-5, 4, 0], color: WARM, intensity: 150, distance: 40 });
}

// Zhongjiao police station. Real: not a tiled box like most stations but white cubes of different
// heights with blue trim, arched openings and a little tower — a Greek-island house by the coast road.
function policePost(out, b, rnd) {
  const w = b.width, d = b.depth, white = tint(0xe9ecec), blue = tint(0x1f5fa8);
  const cubes = [[0, w * 0.44, 2 * FLOOR], [-w * 0.34, w * 0.28, FLOOR + 1.2], [w * 0.36, w * 0.24, 3 * FLOOR + 0.6]];   // [centre z, width, height]: middle, low wing, tower
  for (const [z, wide, high] of cubes) {
    out.wall.push(block(d, high + FOOTING, wide, d / 2, -FOOTING, z, white));
    out.solid.push(block(d + 0.3, 0.35, wide + 0.3, d / 2, high, z, blue));                               // blue band round every roof
    out.lit.push(tube(0.06, 0.06, wide + 0.3, -0.18, high + 0.36, z, tint(0x4a90ff, 2.6 * LEVEL)));        // ...traced with a blue tube
    for (let y = 0.9; y + 1.6 < high; y += FLOOR) {
      out.solid.push(block(0.08, 1.9, wide * 0.5 + 0.3, -0.03, y - 0.15, z, blue));                        // blue frame
      out.lit.push(panel(wide * 0.5, 1.6, -0.08, y, z, tint(TUBE, (0.8 + rnd() * 0.4) * LEVEL), y < 2 && z === 0 ? SHOP : pick(rnd, WINDOWS)));
    }
  }
  out.solid.push(dome(w * 0.1, d / 2, 3 * FLOOR + 0.95, w * 0.36, blue));                                 // a small blue dome on the tower
  out.solid.push(block(2.8, 0.2, w * 0.4, -1.4, 3.0, 0, white));                                          // porch
  for (const z of [-w * 0.18, w * 0.18]) out.solid.push(block(0.35, 3.0, 0.35, -2.6, 0, z, white));
  out.lit.push(panel(w * 0.36, 0.85, -2.82, 3.25, 0, tint(0xffffff, 1.6 * LEVEL), b.cell(false)));
  out.lit.push(tube(0.42, 0.42, 0.42, -2.9, 2.4, w * 0.18, tint(RED, 2.7 * LEVEL)));                      // the red lamp every station has
  out.solid.push(block(0.12, 10, 0.12, -4.5, 0, -w * 0.3, STEEL));                                        // flagpole
  out.glow.push(halo(2.8, 2.8, -3.15, 2.6, w * 0.18, tint(RED, 0.4 * LEVEL)), halo(7, 7, -3.8, 0.06, w * 0.18, tint(RED, 0.24 * LEVEL), true), halo(w, 8, -4.5, 0.07, 0, tint(0x4a90ff, 0.24 * LEVEL), true));
  out.neons.push({ at: [-3.2, 2.6, w * 0.18], color: RED, power: 12 }, { at: [-2, 5, 0], color: 0x4a90ff, power: 12 });
}

// Caoli fishing harbour. Real: a small basin behind a concrete breakwater, a quay with white railings
// and a pavilion, a few small boats. At night what you see from the coast road is its lights: the boats'
// work lamps, and the red and green beacons at the harbour mouth.
function harbour(out, b, rnd) {
  const w = b.width, d = b.depth;
  out.solid.push(block(d * 0.35, 1.2 + FOOTING, w, d * 0.18, -FOOTING, 0, CONCRETE));                     // the quay along the shore (the land side)
  out.solid.push(block(d * 0.7, 2.2 + FOOTING, 3, d * 0.65, -FOOTING, -w / 2 + 1.5, CONCRETE), block(3, 2.2 + FOOTING, w * 0.55, d - 1.5, -FOOTING, -w * 0.22, CONCRETE));   // the breakwater: out to sea, then across the mouth
  for (let z = -w / 2 + 2; z < w / 2; z += 2.5) out.solid.push(block(0.1, 1.0, 0.1, d * 0.34, 1.2, z, tint(0xe8e8e8)));   // white railing posts
  out.solid.push(block(0.08, 0.08, w - 3, d * 0.34, 2.15, 0, tint(0xe8e8e8)));
  // The pavilion on the quay: a dark roof on four posts, one warm lamp inside.
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) out.solid.push(block(0.2, 2.6, 0.2, d * 0.15 + x, 1.2, w * 0.28 + z, tint(0xe8e8e8)));
  out.solid.push(gable(4.6, 1.2, 4.6, d * 0.15, 3.8, w * 0.28, tint(0x2b3238)));
  out.lit.push(tube(0.3, 0.2, 0.3, d * 0.15, 3.5, w * 0.28, tint(WARM, 2.4 * LEVEL)));
  // Beacons at the harbour mouth: green on one arm, red on the other.
  for (const [x, z, color] of [[d - 1.5, w * 0.06, GREEN], [d * 0.4, w / 2 - 1.5, RED]]) {
    out.solid.push(block(0.5, 3.5, 0.5, x, 2.2, z, tint(0xe8e8e8)));
    out.lit.push(tube(0.6, 0.6, 0.6, x, 5.7, z, tint(color, 3.0 * LEVEL)));
    for (const turn of [0, Math.PI / 2]) out.glow.push(halo(4, 4, x, 6, z, tint(color, 0.5 * LEVEL), false, turn));
    out.neons.push({ at: [x, 5.5, z], color, power: 10 });
  }
  // Boats moored inside: a hull, a little wheelhouse, and a string of bright work lamps over the deck.
  const hulls = [0x2a5a8a, 0x8a2a2a, 0xe0e0d8, 0x2a7a5a, 0x35506a].map((hex) => tint(hex));
  for (let k = 0; k < 5; k++) {
    const x = d * 0.5 + (k % 2) * d * 0.18, z = -w * 0.3 + k * w * 0.15, length = 7 + rnd() * 3, lamp = k % 2 ? GREEN : TUBE;
    out.solid.push(block(2.6, 1.3, length, x, -0.4, z, hulls[k]), block(1.8, 1.5, length * 0.3, x, 0.9, z - length * 0.2, tint(0xe8e8e8)), block(0.1, 3.4, 0.1, x, 0.9, z + length * 0.15, DARK));
    for (let n = 0; n < 4; n++) out.lit.push(tube(0.28, 0.28, 0.28, x, 3.4, z - length * 0.3 + n * length * 0.2, tint(lamp, 3.0 * LEVEL)));
    out.glow.push(halo(length * 1.6, 5, x, 3.5, z, tint(lamp, 0.42 * LEVEL), false, Math.PI / 2), halo(length * 1.6, 5, x, 3.5, z, tint(lamp, 0.42 * LEVEL)), halo(12, 12, x, 0.2, z, tint(lamp, 0.24 * LEVEL), true));
    out.neons.push({ at: [x, 3.2, z], color: lamp, power: 14 });
  }
}

const KINDS = { 'surf-base': surfBase, shrine, columbarium, 'police-post': policePost, harbour, house, shack, cafe, eatery, seafood, police, temple, hall, toilet, 'bus-stop': busStop, 'power-tower': powerTower, 'road-lamp': streetLamp, 'median-lamp': medianLamp, 'utility-pole': utilityPole };
export const BUILDING_KINDS = Object.keys(KINDS);

// ---- Materials -----------------------------------------------------------------------------------
// One set for a whole town: `signs` = the signs to draw into its atlas (see signOf).
function townMaterials(signs) {
  const atlas = makeAtlas(signs);
  return {
    atlas,
    wall: enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: wallTexture(), roughness: 0.55 }), { limit: 0.5 }),      // glazed tile: a little shiny
    solid: enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: ribTexture(), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.6, metalness: 0.25 }), { limit: 0.5 }),
    lit: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    wire: new THREE.LineBasicMaterial({ color: 0x23272b }),
  };
}
// The REAL light each kind of lit building throws on the ground in front of it: [colour, strength, reach in metres].
// (main.js turns the nearest GRAPHICS.realLamps of all lamps into real lights; the rest become "small lights".)
const FRONT_LAMP = {
  cafe: [WARM, 90, 26], eatery: [TUBE, 110, 28], police: [TUBE, 90, 26], 'police-post': [TUBE, 100, 28], temple: [AMBER, 90, 24], shrine: [AMBER, 100, 26],
  toilet: [TUBE, 60, 18], hall: [TUBE, 55, 22], 'bus-stop': [TUBE, 45, 14], 'surf-base': [AQUA, 120, 34], harbour: [TUBE, 150, 46],
};
// The pieces of ONE building, made by its kind's function.
function piecesOf(b, number, atlas, sign) {
  const out = { wall: [], solid: [], lit: [], glow: [], wire: [], neons: [], lamps: [] };
  KINDS[b.kind](out, { ...b, look: sign?.look, cell: (tall) => atlas.cell(sign ? sign.key + (tall ? '|tall' : '') : '') }, makeRandom(1000 + number * 7));
  out.glow = out.glow.filter(Boolean);                       // (a pool that is switched off comes back as nothing)
  const lamp = FRONT_LAMP[b.kind];
  if (lamp && !out.lamps.length) out.lamps.push({ at: [-3, 3, 0], color: sign?.look.glow && b.kind === 'cafe' ? sign.look.glow : lamp[0], intensity: lamp[1], distance: lamp[2] });
  return out;
}

// ---- One building on its own ---------------------------------------------------------------------
// The same building as a single object of the shared library (library.js registers every kind):
// the catalogue page shows it, and a map may place one through its "objects" list.
// options: width, depth, levels, sign, scale — as in a map's "buildings" list.
export function buildOne(kind, options = {}) {
  const usual = BUILDING_SIZES[kind] || [8, 8];
  const b = { kind, width: usual[0], depth: usual[1], front: 14, kerb: 10.7, ...options };
  const sign = signOf(b, 3);
  const materials = townMaterials(sign ? [{ ...sign, vertical: false }, { ...sign, key: sign.key + '|tall', vertical: true }] : []);
  const out = piecesOf(b, 3, materials.atlas, sign);
  const group = new THREE.Group();
  for (const layer of ['wall', 'solid', 'lit', 'glow']) {
    if (!out[layer].length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(out[layer]), materials[layer]);
    if (layer === 'wall' || layer === 'solid') { mesh.castShadow = true; mesh.receiveShadow = true; }
    group.add(mesh);
  }
  if (out.wire.length) {
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(out.wire, 3));
    group.add(new THREE.LineSegments(lines, materials.wire));
  }
  group.scale.setScalar(b.scale || 1);
  group.userData.neons = out.neons.map((neon) => ({ at: new THREE.Vector3(...neon.at), color: neon.color, power: neon.power * LEVEL }));
  group.userData.lamps = out.lamps.map((lamp) => ({ at: new THREE.Vector3(...lamp.at), color: lamp.color, intensity: lamp.intensity * LEVEL, distance: lamp.distance }));
  return group;
}

// ---- Putting the town together -------------------------------------------------------------------
/** @returns { group, neons, lamps } — the same kinds of list pois.js gives (coloured glow, strong lights) */
export function buildTown(map) {
  const group = new THREE.Group();
  group.name = 'town';
  const neons = [], lamps = [];
  // "roadside" in map.json: one thing repeated along a stretch of road —
  //   { "kind": "road-lamp", "from": 0, "to": 5000, "spacing": 45, "side": -1, "out": 0.7, "color": "#ffa040" }
  // (from / to in metres, out = metres behind the guardrail line). Nothing is put in a lot or a forecourt.
  const everything = [...map.buildings];
  for (const run of map.info.roadside || []) {
    for (let s = run.from ?? 0; s < Math.min(run.to ?? Infinity, map.road.length); s += run.spacing) {
      const index = map.indexAt(s), side = run.side ?? 1;
      if (side === 0) { if (map.road.wall[index] === 1) everything.push({ kind: run.kind, color: run.color, s, index, side: 1, front: 0, far: false }); continue; }   // "side": 0 = on the median wall
      if ((side > 0 ? map.road.railR : map.road.railL)[index] === 2) continue;
      everything.push({ kind: run.kind, color: run.color, s, index, side, front: map.road.barrier[index] + (run.out ?? 0.7), far: false });
    }
  }
  if (!everything.length) return { group, neons, lamps };

  // Every building's sign goes into the atlas (a standing copy too, for the kinds that hang one out).
  const signs = new Map(), signOfBuilding = new Map();
  everything.forEach((b, number) => {
    const sign = signOf(b, number);
    if (!sign) return;
    signOfBuilding.set(b, sign);
    signs.set(sign.key, { ...sign, vertical: false });
    if (b.kind === 'seafood' || b.kind === 'eatery') signs.set(sign.key + '|tall', { ...sign, vertical: true });
  });
  const materials = townMaterials([...signs.values()]), atlas = materials.atlas, wireMaterial = materials.wire;

  const areas = new Map();      // "x,z" of an area -> the pieces standing in it, in world coordinates
  const place = new THREE.Matrix4(), turn = new THREE.Matrix4(), spot = new THREE.Vector3(), p = {};
  everything.forEach((b, number) => {
    const make = KINDS[b.kind];
    if (!make) { console.warn(`map.json asks for a building of kind "${b.kind}", which does not exist (see src/world/town.js)`); return; }
    const out = piecesOf({ ...b, kerb: map.road.barrier[b.index] }, number, atlas, signOfBuilding.get(b));
    // Where it stands: its front wall b.front metres from the centre line, facing the road.
    map.pointAt(b.s, b.front * b.side, p);
    let y = b.far ? map.terrainHeight(p.x, p.z) : p.y;
    if (map.seaLevel !== null) y = Math.max(y, map.seaLevel + 0.4);                 // (a harbour stands in the water, not on the sea bed)
    place.makeTranslation(p.x, y, p.z).multiply(turn.makeRotationY(p.yaw + (b.side > 0 ? 0 : Math.PI)));
    if (b.scale && b.scale !== 1) place.multiply(turn.makeScale(b.scale, b.scale, b.scale));   // a landmark drawn a little larger than life
    const key = Math.floor(p.x / AREA_SIZE) + ',' + Math.floor(p.z / AREA_SIZE);
    if (!areas.has(key)) areas.set(key, { wall: [], solid: [], lit: [], glow: [], wire: [] });
    const area = areas.get(key);
    for (const layer of ['wall', 'solid', 'lit', 'glow']) for (const geometry of out[layer]) area[layer].push(geometry.applyMatrix4(place));
    for (let i = 0; i < out.wire.length; i += 3) { spot.set(out.wire[i], out.wire[i + 1], out.wire[i + 2]).applyMatrix4(place); area.wire.push(spot.x, spot.y, spot.z); }
    for (const neon of out.neons) neons.push({ position: new THREE.Vector3(...neon.at).applyMatrix4(place), color: neon.color, power: neon.power * LEVEL });
    for (const lamp of out.lamps) lamps.push({ position: new THREE.Vector3(...lamp.at).applyMatrix4(place), color: lamp.color, intensity: lamp.intensity * LEVEL, distance: lamp.distance });
  });

  for (const area of areas.values()) {
    for (const layer of ['wall', 'solid', 'lit', 'glow']) {
      if (!area[layer].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(area[layer]), materials[layer]);
      if (layer === 'wall' || layer === 'solid') { mesh.castShadow = true; mesh.receiveShadow = true; }
      if (layer === 'glow') mesh.renderOrder = 2;            // soft light is drawn last, over everything behind it
      group.add(drawNear(mesh));
    }
    if (area.wire.length) {
      const lines = new THREE.BufferGeometry();
      lines.setAttribute('position', new THREE.Float32BufferAttribute(area.wire, 3));
      group.add(drawNear(new THREE.LineSegments(lines, wireMaterial)));
    }
  }
  return { group, neons, lamps };
}
