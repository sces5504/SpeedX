// ---------------------------------------------------------------------------
// interior.js — the cabin you see in first-person view. Only the four hero
// cars get one. From front to back:
//
//   dashboard   with an instrument hood, working rev counter and speedometer,
//               vents, a radio and a glovebox
//   steering    wheel, column and stalks; the driver's gloved hands grip the
//               rim and turn with it, forearms reach from the elbows
//   console     gear lever and handbrake between the seats
//   seats       two bucket seats (driver and passenger) with head restraints
//   colours     seats, dashboard, carpet and an accent colour come from
//               "interior" in car.json, so every car has its own cabin
//   shell       door panels, pillars, roof lining, sun visors, floor, the
//               shelf behind the seats — a real car hides the road from you;
//               without these you would see it through the bodywork
//   mirror      rear-view mirror with a live picture; windscreen wipers
//
// Everything is placed from the car's own measurements (car.json), so the
// same code fits a low coupe and an upright saloon.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture, enhanceMaterial } from '../render/materials.js';
import { MPH } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0), scratch = new THREE.Vector3();
// The cabin is in the shade of its own roof, but the game's lights do not know that (only one
// headlight casts shadows). So cabin materials have a low brightness limit: the glow of the
// instruments, oncoming beams and street lamps can lift them a little, never flood them.
const cabin = (look) => enhanceMaterial(new THREE.MeshStandardMaterial(look), { limit: 0.025, lamps: false });
// The same in every car:
const plastic = cabin({ color: 0x1f1f22, roughness: 0.55 });       // switches, column, mirror
const leather = cabin({ color: 0x2a2724, roughness: 0.45 });       // steering wheel rim, gear knob
const glove = cabin({ color: 0x2c2d31, roughness: 0.55 });         // black driving gloves
const sleeve = cabin({ color: 0x2c3038, roughness: 0.9 });
const metal = cabin({ color: 0x8b8e93, roughness: 0.35, metalness: 0.8 });
const headlining = cabin({ color: 0x55544f, roughness: 1 });       // grey roof lining and pillars, as in most cars

// The colours of a cabin unless car.json says otherwise ("interior": { ... }).
const DEFAULT_TRIM = { seats: '#3a3c42', dash: '#26262a', carpet: '#141416', accent: '#b0282a' };

// Seat fabric: a woven cloth in the seat colour with thin stripes in the accent colour.
function fabricTexture(seats, accent) {
  const texture = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = seats; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(${y % 4 ? 0 : 255},${y % 4 ? 0 : 255},${y % 4 ? 0 : 255},0.07)`; g.fillRect(0, y, w, 1); }   // the weave
    for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, 0, 1, h); }
    g.fillStyle = accent; g.globalAlpha = 0.85;
    for (const x of [22, 30, 96, 104]) g.fillRect(x, 0, 3, h);                                // stripes
    g.globalAlpha = 1;
  });
  texture.repeat.set(5, 5);
  return texture;
}

// ---- Building blocks -----------------------------------------------------------------
const soft = (w, h, d, material, radius = 0.02) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2)), material);
// A shape drawn from the side — points are [z, y] — and stretched `width` across the car.
function sideProfile(points, width, material, round = 0.012) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(-z, y)));
  const depth = width - round * 2;
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: round, bevelThickness: round, bevelSegments: 2 });
  geometry.translate(0, 0, -depth / 2).rotateY(Math.PI / 2);
  return new THREE.Mesh(geometry, material);
}
// A rounded stick from point a to point b (a finger bone, a lever, a pillar).
function stick(a, b, radius, material) {
  const length = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return mesh;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildInterior(car, mirrorTexture) {
  const { spec, dims } = car;
  const group = new THREE.Group();
  group.name = 'interior';
  const put = (mesh, x, y, z) => { mesh.position.set(x, y, z); group.add(mesh); return mesh; };

  // ---- This car's colours ---------------------------------------------------------
  const trim = { ...DEFAULT_TRIM, ...spec.interior };
  const vinyl = cabin({ color: trim.dash, roughness: 0.8 });                                   // dashboard, door panels, console
  const carpet = cabin({ color: trim.carpet, roughness: 1 });
  const cloth = cabin({ color: trim.seats, roughness: 0.95 });                                 // seat bolsters, armrests
  const fabric = cabin({ map: fabricTexture(trim.seats, trim.accent), roughness: 0.95 });      // seat faces, door inserts
  const accent = cabin({ color: trim.accent, roughness: 0.5 });                                // stitching, badges, piping

  // ---- Measurements ------------------------------------------------------------
  const side = spec.driverSide;                               // +1 = driver sits on the right
  const st = spec.stations, L = spec.length, at = (t) => dims.frontZ + t * L;
  const cowl = st.find((s) => s[4] === 'ws');                 // base of the windscreen
  const roofFront = st[st.indexOf(cowl) + 1];
  const roofBack = st.find((s) => s[4] === 'rw') || roofFront;
  const deck = st[st.indexOf(roofBack) + 1] || roofBack;      // bottom of the rear window
  const cowlZ = at(cowl[0]), cowlY = cowl[1];
  const roofZ = at(roofFront[0]), roofY = roofFront[2];
  const roofEndZ = at(roofBack[0]), deckZ = at(deck[0]), deckY = Math.max(deck[1], deck[2]);
  const halfW = dims.halfW, roofHalf = halfW * spec.tumble;
  const driverX = side * halfW * 0.44;
  const floorY = spec.clearance + 0.07;
  const eye = V(driverX, Math.min(roofY - 0.14, cowlY + 0.33), cowlZ + 1.0);
  const seatY = eye.y - 0.72;                                 // top of the seat cushion
  const backZ = Math.min(eye.z + 0.85, deckZ - 0.1);          // the wall behind the seats

  // ---- Dashboard ---------------------------------------------------------------
  // Side view of the dash: flat top under the glass, a rounded edge, the face, tucked in below.
  const dash = sideProfile([[0, 0.0], [0.26, 0.025], [0.42, 0.0], [0.49, -0.07], [0.50, -0.30], [0.42, -0.45], [0, -0.45]]
    .map(([z, y]) => [cowlZ + z, cowlY + y]), spec.width - 0.1, vinyl, 0.02);
  group.add(dash);
  put(new THREE.Mesh(new THREE.BoxGeometry(spec.width - 0.12, cowlY - 0.44 - floorY, 0.06), carpet), 0, (cowlY - 0.44 + floorY) / 2, cowlZ + 0.2);   // footwell wall
  // Instrument hood in front of the driver, with the dials set into it.
  const hood = sideProfile([[0.12, 0.01], [0.20, 0.125], [0.38, 0.15], [0.45, 0.135], [0.38, 0.11], [0.38, -0.01], [0.12, -0.01]]
    .map(([z, y]) => [cowlZ + z, cowlY + y]), 0.39, vinyl, 0.014);
  hood.position.x = driverX;
  group.add(hood);
  // Air vents (dark slats) at both ends and in the middle; a radio and heater knobs below.
  const vent = canvasTexture(64, 32, (g, w, h) => { g.fillStyle = '#050505'; g.fillRect(0, 0, w, h); g.fillStyle = '#26262a'; for (let y = 3; y < h; y += 6) g.fillRect(2, y, w - 4, 2); }, { repeat: false });
  const ventMat = cabin({ map: vent, roughness: 0.6 });
  const onFace = (mesh, x, y) => put(mesh, x, cowlY + y, cowlZ + 0.522);
  for (const x of [-(halfW - 0.2), halfW - 0.2, -0.085, 0.085]) onFace(new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.06), ventMat), x, -0.115);
  const radio = canvasTexture(128, 48, (g, w, h) => {
    g.fillStyle = '#060606'; g.fillRect(0, 0, w, h);
    g.fillStyle = spec.gaugeColor; g.font = 'bold 20px "Courier New", monospace'; g.textBaseline = 'middle'; g.fillText('FM 98.7', 12, h / 2);
    g.fillStyle = '#222'; for (let k = 0; k < 4; k++) g.fillRect(92, 6 + k * 10, 28, 6);
  }, { repeat: false });
  onFace(new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.055), cabin({ map: radio, emissiveMap: radio, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.4 })), 0, -0.2);
  for (const x of [-0.065, 0, 0.065]) { const knob = onFace(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.02, 14).rotateX(Math.PI / 2), plastic), x, -0.27); knob.position.z += 0.008; }
  onFace(new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.004), carpet), -driverX, -0.16);        // glovebox: the gap round its lid
  onFace(new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.004), carpet), -driverX, -0.3);
  put(soft(0.05, 0.016, 0.012, metal, 0.004), -driverX, cowlY - 0.185, cowlZ + 0.525);         // ...and its latch
  // A coloured band across the dash face, and a row of lit switches under the radio.
  onFace(new THREE.Mesh(new THREE.PlaneGeometry(spec.width - 0.16, 0.012), accent), 0, -0.068);
  [0xff3b30, 0xffb020, 0x35d07f, 0xffb020].forEach((color, k) => {
    onFace(new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.012), cabin({ color: 0x050505, emissive: color, emissiveIntensity: 0.6 })), -0.05 + k * 0.033, -0.238);
  });

  // ---- Gauge cluster: a printed dial face plus two moving needles ----------------
  const gaugeZ = cowlZ + 0.402, gaugeY = cowlY + 0.065;
  const maxRpm = Math.ceil(spec.engine.redline / 1000) + 1;                             // e.g. 9 (x1000)
  const dials = dialTexture(spec, maxRpm);
  const cluster = new THREE.Group();
  cluster.position.set(driverX, gaugeY, gaugeZ);
  cluster.rotation.x = -0.2;                                   // leaning back to face the driver's eyes
  cluster.add(new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.108), new THREE.MeshStandardMaterial({ color: 0x000000, emissiveMap: dials, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 1 })));
  const needleMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3a18, emissiveIntensity: 2.2 });
  const makeNeedle = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.012, 0.004);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.002), needleMat);
    needle.position.y = 0.02;
    pivot.add(needle); cluster.add(pivot);
    return pivot;
  };
  const tachNeedle = makeNeedle(-0.0745), speedNeedle = makeNeedle(0.0745);
  group.add(cluster);
  // At night a real cabin is nearly black: the only light of its own is the glow of the
  // instruments, in their colour, which catches the top of the wheel, the edge of the dash and
  // your knuckles; everything else is a silhouette against the windscreen, lifted now and then
  // by a street lamp or an oncoming car. That glow is this one small light, just in front of
  // the dials. (It lives outside this group and is switched with its brightness, because
  // switching a light's visibility makes the game stop to rebuild its shaders.)
  const glow = new THREE.PointLight(spec.gaugeColor, 0, 1.6, 2);
  glow.position.set(driverX, cowlY + 0.11, cowlZ + 0.5);
  car.body.add(glow);

  // ---- Steering column, wheel and stalks ------------------------------------------
  const column = new THREE.Group();
  column.position.set(driverX, cowlY + 0.02, cowlZ + 0.58);
  column.rotation.x = -0.45;                                   // tilted toward the driver
  const RIM = 0.165, TUBE = 0.016;                             // a 330 mm sports wheel
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 16).rotateX(Math.PI / 2), plastic);
  shroud.position.z = -0.13;
  column.add(shroud);
  for (const s of [-1, 1]) column.add(stick(V(s * 0.05, 0.005, -0.075), V(s * 0.17, 0.02, -0.06), 0.008, plastic));   // indicator and wiper stalks
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(RIM, TUBE, 12, 44), leather));
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI]) {  // three spokes: left, right, down
    const spoke = soft(0.038, RIM - 0.03, 0.012, plastic, 0.005);
    spoke.rotation.z = angle; spoke.position.set(-Math.sin(angle) * (RIM + 0.03) / 2, Math.cos(angle) * (RIM + 0.03) / 2, -0.012);
    wheel.add(spoke);
  }
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.05, 20).rotateX(Math.PI / 2), plastic);
  boss.position.z = -0.022;
  wheel.add(boss, new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.006, 20).rotateX(Math.PI / 2), leather));
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16).rotateX(Math.PI / 2), accent);   // horn-push badge
  wheel.add(badge);
  const topMark = new THREE.Mesh(new THREE.TorusGeometry(TUBE + 0.0006, 0.004, 6, 16), accent);                    // "twelve o'clock" stripe on the rim
  topMark.position.y = RIM; topMark.rotation.y = Math.PI / 2;
  wheel.add(topMark);
  column.add(wheel);
  group.add(column);

  // ---- Hands and forearms --------------------------------------------------------------
  // A hand is built in its own space, with the rim of the wheel running through the origin
  // along X: Y points outward from the wheel centre, Z points at the driver. The four fingers
  // curl over the rim and round its far side; the thumb lies along the near side; the back
  // of the hand slopes away toward the wrist.
  const FINGER = 0.0088, GRIP = TUBE + FINGER + 0.001;
  const round = (degrees, radius = GRIP, x = 0) => V(x, Math.sin(degrees * Math.PI / 180) * radius, Math.cos(degrees * Math.PI / 180) * radius);
  const arms = [-1, 1].map((s) => {
    const hand = new THREE.Group();
    const thumbSide = -s;                                      // toward the top of the wheel
    for (let f = 0; f < 4; f++) {                              // index, middle, ring, little finger
      const x = thumbSide * (0.0293 - f * 0.0195), reach = f === 3 ? 0.78 : f === 0 ? 0.93 : 1;   // the little finger is shorter
      const knuckle = round(52, GRIP + 0.006, x), middle = round(52 + 72 * reach, GRIP, x), last = round(52 + 142 * reach, GRIP, x), tip = round(52 + 200 * reach, GRIP - 0.001, x);
      hand.add(stick(knuckle, middle, FINGER, glove), stick(middle, last, FINGER * 0.95, glove), stick(last, tip, FINGER * 0.88, glove));
      const bump = new THREE.Mesh(new THREE.SphereGeometry(FINGER * 1.18, 10, 8), glove);
      bump.position.copy(knuckle);
      hand.add(bump);
    }
    // back of the hand: from the knuckles down to the wrist
    const knuckles = round(52, GRIP + 0.004), wristAt = V(0, -0.012, 0.108);
    const back = soft(0.083, 0.03, knuckles.distanceTo(wristAt) + 0.012, glove, 0.014);
    back.position.copy(knuckles).add(wristAt).multiplyScalar(0.5);
    back.quaternion.setFromUnitVectors(V(0, 0, 1), wristAt.clone().sub(knuckles).normalize());
    hand.add(back);
    // thumb: out of the side of the hand, then along the near side of the rim
    const t0 = V(thumbSide * 0.034, -0.002, 0.068), t1 = V(thumbSide * 0.046, 0.012, 0.04), t2 = V(thumbSide * 0.06, 0.019, 0.026);
    hand.add(stick(t0, t1, 0.011, glove), stick(t1, t2, 0.0095, glove));
    // cuff of the glove
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.036, 0.045, 14), glove);
    cuff.position.copy(wristAt).add(V(0, -0.004, 0.018));
    cuff.rotation.x = Math.PI / 2 - 0.1;
    hand.add(cuff);
    const angle = s * 1.4;                                     // radians from the top of the wheel: "quarter to three", thumbs up
    hand.position.set(Math.sin(angle) * RIM, Math.cos(angle) * RIM, 0);
    hand.rotation.z = -angle;
    wheel.add(hand);
    const wrist = new THREE.Object3D(); wrist.position.copy(wristAt).add(V(0, -0.006, 0.03)); hand.add(wrist);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.047, 1, 28), sleeve);
    group.add(forearm);
    return { wrist, forearm, elbow: V(driverX + s * 0.26, eye.y - 0.5, eye.z + 0.06) };
  });

  // ---- Centre console: gear lever and handbrake ------------------------------------
  put(soft(0.3, 0.3, 0.16, vinyl, 0.03), 0, cowlY - 0.34, cowlZ + 0.48);                             // the stack under the radio
  const consoleTop = seatY + 0.05;
  put(soft(0.24, consoleTop - floorY, backZ - cowlZ - 0.5, vinyl, 0.03), 0, (consoleTop + floorY) / 2, (backZ + cowlZ + 0.5) / 2);
  const gearAt = V(0, consoleTop, eye.z - 0.3);
  put(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 12), leather), gearAt.x, gearAt.y + 0.03, gearAt.z);   // gaiter
  group.add(stick(gearAt, gearAt.clone().add(V(0, 0.17, -0.03)), 0.007, metal));
  put(new THREE.Mesh(new THREE.SphereGeometry(0.027, 14, 10), leather), gearAt.x, gearAt.y + 0.19, gearAt.z - 0.034);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12), accent), gearAt.x, gearAt.y + 0.217, gearAt.z - 0.038);   // shift pattern badge
  group.add(stick(V(side * 0.06, consoleTop + 0.015, eye.z + 0.02), V(side * 0.06, consoleTop + 0.075, eye.z - 0.2), 0.014, plastic));   // handbrake

  // ---- Seats ---------------------------------------------------------------------
  // Side view of a bucket seat (z measured from the driver's eyes): cushion, then the back.
  const seatShape = [[-0.46, -0.01], [0.07, -0.03], [0.14, 0.14], [0.24, 0.58], [0.33, 0.56], [0.22, -0.08], [0.10, -0.14], [-0.47, -0.12]]
    .map(([z, y]) => [eye.z + z, seatY + y]);
  for (const x of [driverX, -driverX]) {
    const seat = sideProfile(seatShape, 0.4, fabric, 0.035);
    seat.position.x = x;
    group.add(seat);
    for (const s of [-1, 1]) {                                 // bolsters that hold you in: along the cushion and up the back
      put(soft(0.075, 0.09, 0.5, cloth, 0.035), x + s * 0.225, seatY - 0.005, eye.z - 0.2);
      group.add(stick(V(x + s * 0.225, seatY + 0.08, eye.z + 0.15), V(x + s * 0.215, seatY + 0.5, eye.z + 0.26), 0.045, cloth));
    }
    put(soft(0.25, 0.19, 0.1, cloth, 0.04), x, seatY + 0.71, eye.z + 0.285);                          // head restraint
    put(soft(0.2, 0.012, 0.012, accent, 0.004), x, seatY + 0.585, eye.z + 0.235);                     // piping across the top of the back
    for (const s of [-1, 1]) group.add(stick(V(x + s * 0.06, seatY + 0.56, eye.z + 0.29), V(x + s * 0.06, seatY + 0.64, eye.z + 0.29), 0.006, metal));
    put(new THREE.Mesh(new THREE.BoxGeometry(0.42, seatY - 0.12 - floorY, 0.5), carpet), x, (seatY - 0.12 + floorY) / 2, eye.z - 0.15);   // seat base
  }

  // ---- The shell round you: floor, doors, pillars, roof, the wall behind -----------------
  put(new THREE.Mesh(new THREE.BoxGeometry(spec.width - 0.1, 0.03, backZ - cowlZ), carpet), 0, floorY, (backZ + cowlZ) / 2);
  put(new THREE.Mesh(new THREE.BoxGeometry(spec.width - 0.1, deckY - floorY, 0.08), cloth), 0, (deckY + floorY) / 2, backZ + 0.02);          // rear seat back / bulkhead
  put(new THREE.Mesh(new THREE.BoxGeometry(spec.width - 0.12, 0.03, Math.max(0.05, deckZ - backZ)), carpet), 0, deckY - 0.03, (deckZ + backZ) / 2);   // parcel shelf
  put(new THREE.Mesh(new THREE.BoxGeometry(roofHalf * 2, 0.04, roofEndZ - roofZ + 0.1), headlining), 0, roofY - 0.035, (roofEndZ + roofZ) / 2);   // roof lining
  const beltAt = (z) => THREE.MathUtils.lerp(cowlY, deckY, THREE.MathUtils.clamp((z - cowlZ) / (deckZ - cowlZ), 0, 1));    // height of the window sill
  const pillarB = at(THREE.MathUtils.lerp(roofFront[0], roofBack[0], 0.46));
  for (const s of [-1, 1]) {
    const wall = s * (halfW - 0.075);
    // door panel up to the window sill, with a padded top, an armrest and a pull handle
    const doorLength = backZ - cowlZ - 0.02, doorZ = (backZ + cowlZ) / 2 + 0.02, sill = beltAt(doorZ) - 0.015;
    put(new THREE.Mesh(new THREE.BoxGeometry(0.04, sill - floorY, doorLength), vinyl), wall, (sill + floorY) / 2, doorZ);
    const roll = put(soft(0.1, 0.07, doorLength, vinyl, 0.03), wall, sill - 0.01, doorZ);
    roll.rotation.x = -Math.atan2(deckY - cowlY, deckZ - cowlZ);
    put(soft(0.085, 0.05, 0.46, cloth, 0.022), wall - s * 0.05, seatY + 0.2, eye.z - 0.12);                    // armrest
    put(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, doorLength * 0.62), fabric), wall - s * 0.024, seatY + 0.36, doorZ - 0.05);   // cloth insert
    put(new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.01, doorLength * 0.62), accent), wall - s * 0.025, seatY + 0.47, doorZ - 0.05);  // coloured line above it
    put(soft(0.02, 0.018, 0.11, metal, 0.008), wall - s * 0.03, seatY + 0.33, eye.z - 0.38);                   // door pull
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 18).rotateZ(Math.PI / 2), plastic), wall - s * 0.022, floorY + 0.2, cowlZ + 0.45);   // speaker
    // pillars: A (beside the windscreen), B (behind your shoulder), C (beside the rear window)
    group.add(stick(V(s * (halfW - 0.06), cowlY, cowlZ + 0.02), V(s * (roofHalf - 0.03), roofY - 0.02, roofZ), 0.032, headlining));
    group.add(stick(V(s * (halfW - 0.06), beltAt(pillarB), pillarB), V(s * (roofHalf - 0.03), roofY - 0.03, pillarB), 0.035, headlining));
    group.add(stick(V(s * (halfW - 0.08), deckY, deckZ - 0.05), V(s * (roofHalf - 0.04), roofY - 0.03, roofEndZ), 0.05, headlining));
    // rail along the edge of the roof above the door, and a sun visor folded up
    group.add(stick(V(s * (roofHalf - 0.03), roofY - 0.025, roofZ), V(s * (roofHalf - 0.03), roofY - 0.025, roofEndZ), 0.028, headlining));
    put(soft(0.34, 0.014, 0.13, headlining, 0.006), s * halfW * 0.44, roofY - 0.05, roofZ + 0.1).rotation.x = 0.12;
  }
  put(soft(roofHalf * 2, 0.045, 0.06, headlining, 0.02), 0, roofY - 0.03, roofZ + 0.01);                        // header rail above the windscreen

  // ---- Windscreen wipers (they only move when it rains) ------------------------------------
  // They belong to the outside of the car, so they are added to the body, not to the cabin
  // group: you see them from the chase camera too. The fixed pair made by carDetails.js is hidden.
  car.body.traverse((part) => { if (part.name === 'wiper_parked') part.visible = false; });
  const wipers = new THREE.Group();
  wipers.position.set(0, cowlY + 0.035, cowlZ - 0.01);
  wipers.rotation.x = Math.atan2(roofZ - cowlZ, roofY - cowlY);  // lie in the plane of the glass
  const bladeLength = Math.min(0.52, halfW * 0.62);
  const blades = [-0.04, 0.5].map((offset) => {
    const pivot = new THREE.Group();
    pivot.position.set(offset * halfW + bladeLength * 0.45, 0, -0.012);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(bladeLength, 0.016, 0.012), plastic);
    blade.position.x = -bladeLength / 2;
    pivot.add(blade);
    wipers.add(pivot);
    return pivot;
  });
  car.body.add(wipers);

  // ---- Rear-view mirror (shows a live picture from a small backwards camera) ---------
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.065), new THREE.MeshBasicMaterial({ map: mirrorTexture }));
  const uv = mirror.geometry.attributes.uv;                    // flip left/right like a real mirror
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  mirror.position.set(0, roofY - 0.11, roofZ + 0.05);
  mirror.rotation.y = side * 0.32;
  group.add(mirror);
  put(soft(0.26, 0.085, 0.025, plastic, 0.012), 0, roofY - 0.11, roofZ + 0.035).rotation.y = side * 0.32;
  group.add(stick(V(0, roofY - 0.07, roofZ + 0.03), V(0, roofY - 0.03, roofZ - 0.02), 0.008, plastic));

  let shownSteer = 0;
  group.visible = false;
  return {
    group,
    eye,                                                       // where the driver's eyes are, in car coordinates
    mirrorPosition: V(0, roofY - 0.11, dims.rearZ - 0.4),
    update(vehicle, wiperCycle = 0, dt = 1 / 60) {
      glow.intensity = group.visible ? 0.05 : 0;
      const rpmFraction = (vehicle.engineOff ? 0 : vehicle.rpm) / (maxRpm * 1000);
      const speedFraction = Math.min(1, (vehicle.speed * MPH) / 160);
      tachNeedle.rotation.z = 2.1 - rpmFraction * 4.2;         // sweep from lower-left to lower-right
      speedNeedle.rotation.z = 2.1 - speedFraction * 4.2;
      // The wheel follows the steering smoothly (keyboard steering is all-or-nothing; real hands are not).
      shownSteer += (vehicle.steerInput - shownSteer) * Math.min(1, dt * 5);
      wheel.rotation.z = shownSteer * 1.5;                     // + steer = left = counter-clockwise
      // Stretch each forearm from its elbow to its hand.
      group.updateWorldMatrix(true, true);
      for (const arm of arms) {
        arm.wrist.getWorldPosition(scratch);
        group.worldToLocal(scratch);
        const reach = scratch.clone().sub(arm.elbow);
        arm.forearm.position.copy(arm.elbow).addScaledVector(reach, 0.5);
        arm.forearm.scale.y = reach.length();
        arm.forearm.quaternion.setFromUnitVectors(UP, reach.normalize());
      }
      // Wipers: 0 -> up and over -> back to rest, once per cycle.
      const sweep = (wiperCycle < 0.5 ? wiperCycle * 2 : 2 - wiperCycle * 2) * 2.2;
      for (const pivot of blades) pivot.rotation.z = -sweep;
    },
  };
}

// The printed part of the gauges: tachometer on the left, speedometer on the right.
function dialTexture(spec, maxRpm) {
  return canvasTexture(512, 180, (g, w, h) => {
    g.fillStyle = '#050505'; g.fillRect(0, 0, w, h);
    const dial = (cx, max, step, label, redFrom) => {
      const cy = h * 0.61, r = 78;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 17px Arial';
      for (let value = 0; value <= max; value += step / 2) {
        const angle = -Math.PI / 2 - 2.1 + (value / max) * 4.2;
        const major = Math.abs(value / step - Math.round(value / step)) < 0.01;
        g.strokeStyle = redFrom !== undefined && value >= redFrom ? '#ff3020' : spec.gaugeColor;
        g.lineWidth = major ? 4 : 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        g.lineTo(cx + Math.cos(angle) * (r - (major ? 13 : 7)), cy + Math.sin(angle) * (r - (major ? 13 : 7)));
        g.stroke();
        if (major) { g.fillStyle = g.strokeStyle; g.fillText(String(value), cx + Math.cos(angle) * (r - 27), cy + Math.sin(angle) * (r - 27)); }
      }
      g.fillStyle = spec.gaugeColor; g.font = '12px Arial'; g.fillText(label, cx, cy + 40);
    };
    dial(w / 2 - 123, maxRpm, 1, 'x1000 r/min', spec.engine.redline / 1000);
    dial(w / 2 + 123, 160, 20, 'mph');
  }, { repeat: false });
}
