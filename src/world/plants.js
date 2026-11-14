// ---------------------------------------------------------------------------
// plants.js — the built-in plants and rocks of the shared library:
//   pine   a trunk with tiers of drooping boughs
//   bush   a clump of chaparral scrub         grass  a tuft of dry grass
//   rock   a lumpy boulder
// and the plants of Taiwan's north coast:
//   casuarina    the tall wispy windbreak tree of the shore (木麻黃)
//   broadleaf    a round-crowned evergreen of the wet hills (相思樹, 榕)
//   pandanus     a clump of long sword leaves by the sea (林投)
//   silvergrass  tall grass with pale plumes that catch the headlights (芒草)
// They are made of flat "cards" — upright sheets with a picture of a bough or
// a clump of twigs on them, see-through between the needles. A few dozen cards
// at different angles read as a full plant from any side, and are cheap enough
// to draw thousands of times (scenery.js does the planting).
//
// Each entry of PLANTS is a function that returns the plant as a list of parts:
//   [{ geometry, material }, ...]      sizes in metres, standing on y = 0
// To add a plant: write its shape and picture below, add one line to PLANTS,
// and list it in public/content/props/index.json ("builtIn").
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from '../core/mathUtils.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';

const plain = (color, flat = false) => enhanceMaterial(new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: flat }));
// A card: only the painted parts of the picture are drawn (alphaTest), both sides.
const cardMaterial = (texture) => enhanceMaterial(new THREE.MeshStandardMaterial({
  map: texture, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 1 }));

export const PLANTS = {
  pine: () => [{ geometry: pineBoughs(), material: cardMaterial(boughTexture()) }, { geometry: pineTrunk(), material: plain(0x3a2c22) }],
  bush: () => [{ geometry: crossedCards(5, 2.2, 1.5, 21), material: cardMaterial(scrubTexture()) }],
  grass: () => [{ geometry: crossedCards(3, 1.1, 0.75, 5), material: cardMaterial(grassTexture()) }],
  rock: () => [{ geometry: rockGeometry(), material: plain(0x77706a, true) }],
  casuarina: () => [{ geometry: casuarinaBoughs(), material: cardMaterial(wispTexture()) }, { geometry: trunk(0.05, 0.2, 12.5), material: plain(0x40362c) }],
  broadleaf: () => [{ geometry: canopy(61), material: cardMaterial(leafTexture()) }, { geometry: limbs(67), material: plain(0x2c2620) }],
  pandanus: () => [{ geometry: crossedCards(5, 3.4, 2.7, 71), material: cardMaterial(swordLeafTexture()) }],
  silvergrass: () => [{ geometry: crossedCards(4, 2.3, 2.4, 81), material: cardMaterial(plumeTexture()) }],
};

// ---- Shapes ------------------------------------------------------------------------

// One upright card: `reach` wide, `height` tall, its bottom-left corner on the Y axis at
// height y, turned to face `yaw` and tipped outward-and-down by `droop`.
function card(reach, height, y, yaw, droop = 0) {
  const g = new THREE.PlaneGeometry(reach, height).translate(reach / 2, -height / 2, 0);   // hangs from its top-left corner
  return g.rotateZ(-droop).translate(0, y, 0).rotateY(yaw);
}

// A pine: eight tiers of boughs, long and drooping at the bottom, short at the top.
function pineBoughs() {
  const rnd = makeRandom(31), cards = [];
  const TIERS = 8;
  for (let tier = 0; tier < TIERS; tier++) {
    const up = tier / (TIERS - 1);
    const y = 2.6 + up * 6.6, reach = 2.7 * (1 - up) ** 0.8 + 0.55;
    const around = tier < 5 ? 5 : 4;
    for (let k = 0; k < around; k++) cards.push(card(reach, reach * 0.78, y + rnd() * 0.3, ((k + rnd() * 0.5) / around) * Math.PI * 2 + tier, 0.12 + rnd() * 0.2));
  }
  return mergeGeometries(cards);
}
const pineTrunk = () => new THREE.CylinderGeometry(0.05, 0.22, 9.0, 6).translate(0, 4.5, 0);
// A plain trunk: `top` and `bottom` are its radius at each end, standing on the ground.
const trunk = (top, bottom, height) => new THREE.CylinderGeometry(top, bottom, height, 6).translate(0, height / 2, 0);

// A casuarina: a tall narrow tree. Many thin boughs leave the trunk at uneven heights, each
// trailing wisps; they get shorter toward the top, so the tree tapers to a point.
function casuarinaBoughs() {
  const rnd = makeRandom(47), cards = [];
  for (let k = 0; k < 46; k++) {
    const up = k / 45, y = 2.6 + up * 9.6 + rnd() * 0.5;
    const reach = (0.9 + rnd() * 1.7) * (1 - up * 0.72);
    cards.push(card(reach, reach * 1.5, y, rnd() * Math.PI * 2, 0.02 + rnd() * 0.3));
  }
  return mergeGeometries(cards);
}

// The crown of a broadleaf tree: two dozen clumps of leaves at different heights and angles,
// filling a rounded shape that is fuller on top than underneath. Because every clump is a
// separate card with a ragged edge, the outline is lumpy from any side — like a real crown,
// not a ball on a stick.
function canopy(seed) {
  const rnd = makeRandom(seed), cards = [];
  for (let k = 0; k < 24; k++) {
    const around = rnd() * Math.PI * 2, out = Math.sqrt(rnd()) * 3.1, up = (rnd() - 0.3) * 3.6;
    const size = 2.4 + rnd() * 2.0;
    cards.push(new THREE.PlaneGeometry(size, size * 0.85).rotateX((rnd() - 0.5) * 1.5).rotateY(rnd() * Math.PI)
      .translate(Math.cos(around) * out * (1 - Math.max(0, up) * 0.12), 6.3 + up, Math.sin(around) * out * (1 - Math.max(0, up) * 0.12)));
  }
  return mergeGeometries(cards);
}
// Its wood: a short thick trunk that splits into a few limbs reaching up into the crown.
function limbs(seed) {
  const rnd = makeRandom(seed), parts = [new THREE.CylinderGeometry(0.2, 0.36, 4.4, 7).translate(0, 2.2, 0)];
  for (let k = 0; k < 5; k++) {
    parts.push(new THREE.CylinderGeometry(0.05, 0.15, 3.6, 5).translate(0, 1.8, 0).rotateZ(0.45 + rnd() * 0.5).rotateY((k / 5) * Math.PI * 2 + rnd()).translate(0, 3.4 + rnd() * 0.8, 0));
  }
  return mergeGeometries(parts);
}

// A clump: `count` cards crossing each other through the middle, standing on the ground.
function crossedCards(count, width, height, seed) {
  const rnd = makeRandom(seed), cards = [];
  for (let k = 0; k < count; k++) {
    const lean = (rnd() - 0.5) * 0.35;
    cards.push(new THREE.PlaneGeometry(width, height).translate(0, height / 2 - 0.05, 0).rotateX(lean).rotateY((k / count) * Math.PI + rnd() * 0.3));
  }
  return mergeGeometries(cards);
}

// A boulder: a ball pushed in and out by a few overlapping waves, then squashed.
function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(0.75, 2);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const bump = Math.sin(v.x * 4.1 + 1.3) * Math.sin(v.y * 3.3 + 0.4) * 0.16 + Math.sin(v.z * 7.7 + v.x * 5.1) * 0.07 + Math.sin(v.y * 9.3 + v.z * 3.9) * 0.05;
    v.multiplyScalar(1 + bump);
    pos.setXYZ(i, v.x * 1.25, Math.max(-0.15, v.y * 0.72) + 0.25, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---- Pictures on the cards (drawn once, with a see-through background) -------------------

// A pine bough seen from the side: it leaves the trunk at the top-left and droops to the right.
function boughTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = makeRandom(5);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let k = 0; k < 150; k++) {
      const along = rnd();                                         // 0 at the trunk, 1 at the tip
      const x = along * w * 0.96, y = h * (0.08 + along * along * 0.32);
      const length = h * (0.16 + rnd() * 0.34) * (1 - along * 0.5);  // twigs hang down from the limb
      const sway = (rnd() - 0.35) * 0.9;
      for (let n = 0; n < 16; n++) {                               // needles all along each twig
        const t = n / 16, tx = x + sway * length * t, ty = y + length * t;
        g.strokeStyle = `hsl(${105 + rnd() * 30}, ${14 + rnd() * 14}%, ${7 + rnd() * 11}%)`;
        g.lineWidth = 2 + rnd() * 2.5;
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + (rnd() - 0.5) * 20, ty + 4 + rnd() * 13); g.stroke();
      }
    }
    g.strokeStyle = '#2b2118'; g.lineWidth = 5;                    // the limb itself
    g.beginPath(); g.moveTo(0, h * 0.07); g.quadraticCurveTo(w * 0.5, h * 0.12, w * 0.96, h * 0.4); g.stroke();
  }, { repeat: false });
}

// Chaparral scrub: grey-green twigs fanning up from one root, dotted with small leaves.
function scrubTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = makeRandom(9);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let k = 0; k < 44; k++) {
      const angle = -Math.PI / 2 + (rnd() - 0.5) * 2.5;
      const length = h * (0.3 + rnd() * 0.5) * (0.55 + 0.45 * Math.cos(angle + Math.PI / 2));   // shorter at the sides: a dome, not a box
      const bend = (rnd() - 0.5) * 70;
      const ex = w / 2 + Math.cos(angle) * length, ey = h + Math.sin(angle) * length;
      g.strokeStyle = `hsl(${40 + rnd() * 30}, 18%, ${14 + rnd() * 10}%)`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(w / 2 + (rnd() - 0.5) * 30, h); g.quadraticCurveTo(w / 2 + bend, h * 0.6, ex, ey); g.stroke();
      for (let n = 0; n < 14; n++) {                              // leaves gather toward the tips
        const t = 0.3 + rnd() * 0.7, lx = w / 2 + (ex - w / 2) * t + (rnd() - 0.5) * 22, ly = h + (ey - h) * t + (rnd() - 0.5) * 22;
        g.fillStyle = `hsl(${62 + rnd() * 30}, ${8 + rnd() * 12}%, ${14 + rnd() * 16}%)`;
        g.beginPath(); g.ellipse(lx, ly, 3 + rnd() * 4, 2 + rnd() * 2.5, rnd() * 3, 0, 7); g.fill();
      }
    }
  }, { repeat: false });
}

// Dry summer grass: straw-coloured blades fanning up from the ground.
function grassTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const rnd = makeRandom(13);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let k = 0; k < 110; k++) {
      const x = w * (0.1 + rnd() * 0.8), lean = (rnd() - 0.5) * 60, tall = h * (0.35 + rnd() * 0.6);
      g.strokeStyle = `hsl(${38 + rnd() * 16}, ${28 + rnd() * 22}%, ${30 + rnd() * 28}%)`; g.lineWidth = 1.5 + rnd() * 1.5;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * 0.2, h - tall * 0.6, x + lean, h - tall); g.stroke();
    }
  }, { repeat: false });
}

// ---- Taiwan's north coast --------------------------------------------------------------

// Casuarina wisps: a thin limb leaving the trunk at the top-left, with long fine strands hanging from it.
function wispTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = makeRandom(49);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let k = 0; k < 760; k++) {
      const along = rnd(), x = along * w * 0.94, y = h * (0.05 + along * along * 0.2);
      const length = h * (0.25 + rnd() * 0.55) * (1 - along * 0.4), sway = (rnd() - 0.4) * 46;
      g.strokeStyle = `hsl(${88 + rnd() * 30}, ${12 + rnd() * 16}%, ${8 + rnd() * 14}%)`; g.lineWidth = 1 + rnd() * 1.2;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + sway * 0.3, y + length * 0.5, x + sway, y + length); g.stroke();
    }
    g.strokeStyle = '#30281f'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, h * 0.05); g.quadraticCurveTo(w * 0.5, h * 0.08, w * 0.94, h * 0.25); g.stroke();
  }, { repeat: false });
}

// One clump of broadleaf foliage: several overlapping tufts of small leaves with gaps between
// them. Leaves on the upper side are lighter (they catch what light there is), the undersides dark.
function leafTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = makeRandom(63);
    g.clearRect(0, 0, w, h);
    for (let tuft = 0; tuft < 9; tuft++) {
      const cx = w * (0.22 + rnd() * 0.56), cy = h * (0.25 + rnd() * 0.5), reach = w * (0.14 + rnd() * 0.12);
      for (let k = 0; k < 230; k++) {
        const angle = rnd() * Math.PI * 2, far = Math.pow(rnd(), 0.7) * reach;
        const x = cx + Math.cos(angle) * far * 1.25, y = cy + Math.sin(angle) * far * 0.85;
        const top = 1 - (y - (cy - reach)) / (reach * 2);            // 1 at the top of the tuft, 0 at the bottom
        g.fillStyle = `hsl(${92 + rnd() * 40}, ${24 + rnd() * 22}%, ${5 + top * 13 + rnd() * 7}%)`;
        g.beginPath(); g.ellipse(x, y, 4 + rnd() * 5, 2.2 + rnd() * 2.6, rnd() * 3, 0, 7); g.fill();
      }
    }
  }, { repeat: false });
}

// Pandanus: rosettes of long, arching sword leaves on short stilt roots.
function swordLeafTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = makeRandom(73);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    for (const [cx, cy] of [[0.28, 0.62], [0.55, 0.5], [0.76, 0.66], [0.42, 0.78]]) {
      g.strokeStyle = '#3a3226'; g.lineWidth = 5;                  // stilt roots and stem
      for (let r = -1; r <= 1; r++) { g.beginPath(); g.moveTo(cx * w, cy * h); g.lineTo(cx * w + r * 12, h); g.stroke(); }
      for (let k = 0; k < 34; k++) {
        const angle = -Math.PI / 2 + (rnd() - 0.5) * 3.4, length = h * (0.2 + rnd() * 0.22);
        const ex = cx * w + Math.cos(angle) * length, ey = cy * h + Math.sin(angle) * length + length * 0.35;   // tips droop
        g.strokeStyle = `hsl(${82 + rnd() * 22}, ${28 + rnd() * 18}%, ${12 + rnd() * 14}%)`; g.lineWidth = 3 + rnd() * 2.5;
        g.beginPath(); g.moveTo(cx * w, cy * h); g.quadraticCurveTo(cx * w + Math.cos(angle) * length * 0.6, cy * h + Math.sin(angle) * length * 0.8, ex, ey); g.stroke();
      }
    }
  }, { repeat: false });
}

// Silvergrass: green blades arching up from the ground, topped with pale feathery plumes.
function plumeTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = makeRandom(83);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let k = 0; k < 150; k++) {
      const x = w * (0.12 + rnd() * 0.76), lean = (rnd() - 0.5) * 90, tall = h * (0.4 + rnd() * 0.42);
      g.strokeStyle = `hsl(${70 + rnd() * 30}, ${22 + rnd() * 20}%, ${14 + rnd() * 16}%)`; g.lineWidth = 1.5 + rnd() * 1.8;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * 0.15, h - tall * 0.7, x + lean, h - tall); g.stroke();
    }
    for (let k = 0; k < 16; k++) {                                 // the plumes: a stalk with a soft pale brush on top
      const x = w * (0.18 + rnd() * 0.64), lean = (rnd() - 0.5) * 50, tall = h * (0.7 + rnd() * 0.25), tx = x + lean, ty = h - tall;
      g.strokeStyle = 'hsl(60, 20%, 30%)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x, h - tall * 0.6, tx, ty + 30); g.stroke();
      for (let n = 0; n < 26; n++) {
        g.strokeStyle = `hsla(${38 + rnd() * 14}, ${12 + rnd() * 12}%, ${36 + rnd() * 18}%, 0.85)`; g.lineWidth = 1.2 + rnd();
        const t = rnd(), sx = tx + lean * 0.004 * n, sy = ty + 34 * t;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + (rnd() - 0.5) * 20 * (0.4 + t), sy - 6 - rnd() * 16); g.stroke();
      }
    }
  }, { repeat: false });
}
