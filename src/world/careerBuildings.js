// ---------------------------------------------------------------------------
// careerBuildings.js — the buildings of the career: the GARAGE, the DEALERSHIP
// and the SPEED CAMERA. Modelled after the two reference pictures in
// reference/buildings/ and made the same way as the gas station (buildings.js):
// by code, from boxes, lit with neon, each saying what glows, what is solid and
// what can be done there in its userData (see the top of buildings.js).
//
// As everywhere: +X points away from the road, Z runs along it, Y is up, the
// origin is on the ground in the middle of the building. The front faces the road (-X).
//
// THE GARAGE'S DOOR MOVES. Its right-hand roller door is the way in:
//     garage.userData.setDoor(open)     open = 0 (shut) .. 1 (rolled right up)
//     garage.userData.entry             { z, front }: where that door is, in the garage's own coordinates
// main.js plays the "drive in" scene with them (render/director.js).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { canvasTexture } from '../render/materials.js';
import { GRAPHICS } from '../config.js';
import { at, box, concrete, darkMetal, dimmed, emissive, facingRoad, haze, neon, shopGlass, signBoard, solid, tube, whitePanel, WARM } from './buildings.js';

const LEVEL = GRAPHICS.buildingLights;
const RED_LAMP = 0xff4a26;         // the garage's lamps: hot orange-red
const CYAN = 0x35d8ff;             // the dealership's neon

// A picture of stripes, for corrugated sheet (upright stripes) and roller doors (level slats).
function stripes(upright, light, dark, count) {
  return canvasTexture(upright ? 256 : 32, upright ? 32 : 256, (g, w, h) => {
    g.fillStyle = light; g.fillRect(0, 0, w, h);
    const step = (upright ? w : h) / count;
    for (let k = 0; k < count; k++) {
      g.fillStyle = dark;
      if (upright) g.fillRect(k * step + step * 0.55, 0, step * 0.45, h); else g.fillRect(0, k * step + step * 0.72, w, step * 0.28);
    }
  });
}
// A material with a picture that also glows faintly (a lit wall seen through a door or a window).
const lit = (picture, glow) => new THREE.MeshStandardMaterial({ map: picture, emissiveMap: picture, emissive: 0xffffff, emissiveIntensity: glow * LEVEL, roughness: 0.7 });

// ---- The garage: a sheet-metal shed with a gable roof and three roller doors, 10 m deep, 15 m long ----
export function buildGarage() {
  const g = new THREE.Group();
  const W = 15, D = 10, H = 4.0, RISE = 1.7;                   // length along the road, depth, wall height, how much higher the ridge is
  const DOOR_W = 3.9, DOOR_H = 3.1, BAYS = [-5, 0, 5], FRONT = -D / 2;
  const sheetPicture = stripes(true, '#7b7480', '#5d5763', 24);
  const sheet = (repeat) => { const picture = sheetPicture.clone(); picture.needsUpdate = true; picture.repeat.set(repeat, 1); return solid(0xffffff, 0.75, 0.25, { map: picture }); };
  const sheetLong = sheet(3), sheetSide = sheet(2), sheetSmall = sheet(0.25);
  const roofing = solid(0x2c3040, 0.6, 0.4);

  // Walls: the sides, the back, and the front as the strips left round the three doorways.
  for (const z of [-W / 2, W / 2]) g.add(box(D, H, 0.2, sheetSide, 0, H / 2, z));
  g.add(box(0.2, H, W, sheetLong, D / 2, H / 2, 0));
  g.add(box(0.2, H - DOOR_H, W, sheetLong, FRONT, DOOR_H + (H - DOOR_H) / 2, 0));
  for (const [z, width] of [[-W / 2 + 0.275, 0.55], [-2.5, 1.1], [2.5, 1.1], [W / 2 - 0.275, 0.55]]) {
    g.add(box(0.2, DOOR_H, width, sheetSmall, FRONT, DOOR_H / 2, z));
    g.add(box(0.5, 0.9, width + 0.15, concrete, FRONT - 0.05, 0.45, z));                 // a concrete foot to keep cars off the sheet
  }
  // The two gable ends (the triangles under the roof), front and back.
  const gable = new THREE.ExtrudeGeometry(new THREE.Shape([[-W / 2, 0], [W / 2, 0], [0, RISE]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.2, bevelEnabled: false });
  for (const x of [FRONT + 0.1, D / 2 + 0.1]) {
    const end = new THREE.Mesh(gable, sheetLong);
    end.rotation.y = -Math.PI / 2; end.position.set(x, H, 0);
    end.castShadow = true;
    g.add(end);
  }
  // The roof: two sloping sheets that overhang the walls a little, and a ridge cap.
  const slope = Math.atan2(RISE, W / 2), slab = Math.hypot(W / 2, RISE) + 0.5;
  for (const side of [-1, 1]) {
    const half = box(D + 1.0, 0.1, slab, roofing, 0, H + RISE / 2 + 0.03, side * (W / 4 + 0.1));
    half.rotation.x = side * slope;
    g.add(half);
  }
  g.add(box(D + 1.0, 0.1, 0.5, darkMetal, 0, H + RISE + 0.08, 0));

  // The roller doors, each under a housing with a red lamp. The right-hand one opens.
  const slats = stripes(false, '#3a3640', '#221f27', 18);
  const doorMaterial = () => { const picture = slats.clone(); picture.needsUpdate = true; return solid(0xffffff, 0.55, 0.5, { map: picture }); };
  const closed = doorMaterial();
  let moving = null;
  for (const z of BAYS) {
    // (Made hanging from its top edge, so that rolling it up is simply making it shorter.)
    const door = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H).translate(0, -DOOR_H / 2, 0), z === BAYS[2] ? doorMaterial() : closed);
    facingRoad(door, FRONT + 0.06, DOOR_H, z);
    g.add(door);
    if (z === BAYS[2]) moving = door;
    g.add(box(0.55, 0.42, DOOR_W + 0.5, darkMetal, FRONT - 0.2, DOOR_H + 0.3, z));       // the housing the door rolls up into
    g.add(neon(RED_LAMP, 0.22, 0.05, 0.85, FRONT - 0.32, DOOR_H + 0.07, z, 3.2));
    g.add(haze(RED_LAMP, 3.2, FRONT - 0.5, DOOR_H - 0.2, z, 0.16));
  }
  g.userData.setDoor = (open) => {
    const left = 1 - 0.94 * Math.min(1, Math.max(0, open));      // how much of the door still hangs down
    moving.scale.y = left;
    moving.material.map.repeat.y = left;                         // the slats keep their size: fewer of them show
  };

  // Behind that door: a lit workshop. (Walled off from the other two bays, which are never seen into.)
  const bay = BAYS[2], inside = new THREE.Group();
  inside.add(box(D - 0.5, 0.05, DOOR_W + 0.9, solid(0xb8ad98, 0.45), 0, 0.03, bay));                         // pale sealed floor
  inside.add(box(D - 0.4, H, 0.12, solid(0x8d8474, 0.9), 0, H / 2, bay - DOOR_W / 2 - 0.5));                 // the wall between the bays
  inside.add(box(D - 0.5, 0.1, DOOR_W + 0.9, solid(0x6f6a62, 0.9), 0, H - 0.05, bay));                        // ceiling
  const tools = canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#c9bea4'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e6e0cf'; c.fillRect(70, 10, 110, 60);                                                    // a pegboard...
    c.fillStyle = '#6b6457'; for (let x = 78; x < 176; x += 9) for (let y = 16; y < 66; y += 9) c.fillRect(x, y, 2, 2);
    c.fillStyle = '#f4e9c8'; c.fillRect(8, 14, 22, 26); c.fillRect(36, 14, 22, 26);                          // ...two bright windows...
    c.fillStyle = '#8a8478'; c.fillRect(190, 8, 58, 4); c.fillRect(190, 40, 58, 4); c.fillRect(190, 72, 58, 4);   // ...and shelves
    c.fillStyle = '#b08a5a'; for (const [x, y] of [[196, 22], [222, 20], [200, 54], [226, 52], [206, 86]]) c.fillRect(x, y, 18, 18);
  }, { repeat: false });
  inside.add(facingRoad(new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W + 0.8, H - 0.3), lit(tools, 0.9)), D / 2 - 0.2, H / 2, bay));
  inside.add(box(0.8, 0.95, 2.3, solid(0x9ea3a8, 0.4, 0.6), D / 2 - 0.75, 0.48, bay - 0.4));                  // steel workbench with drawers
  for (const y of [0.3, 0.55, 0.8]) inside.add(box(0.03, 0.03, 2.1, darkMetal, D / 2 - 1.16, y, bay - 0.4));
  for (const [x, z, size] of [[D / 2 - 0.7, bay + 1.5, 0.6], [D / 2 - 0.7, bay + 1.55, 0.45], [D / 2 - 1.5, bay - 1.9, 0.5]]) inside.add(box(size, size, size, solid(0xa98558, 0.9), x, size / 2 + (size === 0.45 ? 0.6 : 0), z));   // boxes
  for (const x of [-1.5, 2]) inside.add(neon(WARM, 1.6, 0.04, 0.5, x, H - 0.12, bay, 3.0));                    // strip lights
  g.add(inside);

  // On the right-hand side wall: a door with a lit window and a red lamp over it, a step, and an air-conditioning unit.
  const side = W / 2 + 0.11;
  g.add(box(1.0, 2.1, 0.08, darkMetal, 1.6, 1.25, side), box(0.3, 0.45, 0.04, emissive(0xffd9a0, 2.2), 1.6, 1.7, side + 0.04));
  g.add(box(1.3, 0.2, 0.7, concrete, 1.6, 0.1, side + 0.3), neon(RED_LAMP, 0.5, 0.06, 0.12, 1.6, 2.55, side + 0.12, 3.2));
  g.add(box(1.0, 0.85, 0.42, whitePanel, 3.4, 2.9, side + 0.3), box(0.6, 0.6, 0.04, darkMetal, 3.4, 2.9, side + 0.52));

  // (Kept low: the lamps should pool red under each door, not paint the whole shed. A faint cool light from the lot shows the grey sheet.)
  g.userData.lamps = [{ at: at(FRONT - 6, 5.5, 0), color: 0xaab4d8, intensity: 55, distance: 34 }];
  g.userData.neons = BAYS.map((z) => ({ at: at(FRONT - 0.7, 2.9, z), color: RED_LAMP, power: 9 }));
  g.userData.solids = [[0, 0, D, W]];
  g.userData.entry = { z: bay, front: FRONT };
  g.userData.interact = { type: 'garage', label: 'Enter the garage', at: at(FRONT - 6, 0, bay), radius: 6.5 };
  g.userData.setDoor(0);
  return dimmed(g);
}

// ---- The dealership: a flat-roofed showroom with a glass corner, 12 m deep, 24 m long -------------
export function buildDealership(name = 'DEALERSHIP') {
  const g = new THREE.Group();
  const W = 24, D = 12, H = 5.0, FRONT = -D / 2;
  const dark = solid(0x24262c, 0.6, 0.3), brick = solid(0x7c2c22, 0.85), floor = solid(0xd8c8a8, 0.3, 0.1);
  const warmWall = lit(canvasTexture(8, 8, (c, w, h) => { c.fillStyle = '#d9b98c'; c.fillRect(0, 0, w, h); }), 1.0);

  g.add(box(D + 3, 0.14, W + 2, concrete, -0.6, 0.07, 0));                                      // the pavement it stands on
  // The roof: one dark slab that overhangs the front, with a line of cyan neon along its edge
  // and warm lights let into its underside.
  g.add(box(D + 2.6, 0.5, W + 1.6, dark, -0.9, H + 0.25, 0));
  g.add(neon(CYAN, 0.05, 0.07, W + 1.6, FRONT - 2.2, H + 0.5, 0, 2.8), neon(CYAN, D + 2.6, 0.07, 0.05, -0.9, H + 0.5, W / 2 + 0.8, 2.8));
  for (let z = -10; z <= 10.01; z += 4) g.add(neon(WARM, 0.55, 0.04, 0.55, FRONT - 1.1, H - 0.02, z, 3.2));
  g.add(box(0.3, H, W, dark, D / 2, H / 2, 0), box(D, H, 0.3, dark, 0, H / 2, -W / 2));        // back wall, left-hand end

  // LEFT: the workshop block in dark red, lower than the rest, with a roller door, a door and a strip of windows.
  g.add(box(D - 0.5, 3.9, 6, brick, 0.2, 1.95, -9), box(D - 0.5, H - 3.9, 6, dark, 0.2, 3.9 + (H - 3.9) / 2, -9));
  g.add(facingRoad(new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.7), solid(0xffffff, 0.55, 0.5, { map: stripes(false, '#3a3640', '#221f27', 14) })), FRONT + 0.08, 1.35, -8.4));
  g.add(box(0.08, 2.0, 0.9, darkMetal, FRONT + 0.1, 1.0, -11.1), box(0.04, 0.4, 0.3, emissive(0xffd9a0, 2.2), FRONT + 0.06, 1.5, -11.1));
  for (const z of [-9.4, -8.4, -7.4]) g.add(box(0.04, 0.45, 0.8, emissive(0xffd9a0, 2.0), FRONT + 0.08, 3.2, z));

  // MIDDLE: the entrance. A dark wall with the neon sign, a canopy, glass doors.
  g.add(box(0.3, H - 2.9, 6, dark, FRONT + 0.15, 2.9 + (H - 2.9) / 2, -3));
  g.add(facingRoad(signBoard(name, '#3dffa8', 5.2, 0.95, { look: 'neon', glowAmount: 1.9 }), FRONT - 0.05, 4.0, -3));
  for (const [w, h, y, z] of [[5.6, 0.06, 4.6, -3], [5.6, 0.06, 3.4, -3], [0.06, 1.2, 4.0, -5.8], [0.06, 1.2, 4.0, -0.2]]) g.add(neon(CYAN, 0.05, h, w, FRONT - 0.08, y, z, 3.0));   // a frame of cyan tube round it
  g.add(haze(CYAN, 7, FRONT - 0.6, 4.0, -3, 0.3));
  g.add(box(1.7, 0.25, 4.6, dark, FRONT - 0.85, 2.95, -3));
  for (const z of [-4, -2]) g.add(neon(WARM, 0.4, 0.04, 0.4, FRONT - 0.9, 2.81, z, 3.2));
  g.add(box(0.06, 2.6, 5.6, shopGlass, FRONT + 0.05, 1.45, -3));
  for (const z of [-5.8, -4.2, -3, -1.8, -0.2]) g.add(box(0.12, 2.75, 0.1, darkMetal, FRONT + 0.05, 1.42, z));
  g.add(box(0.1, 0.5, 0.06, whitePanel, FRONT - 0.03, 1.1, -3.25), box(0.1, 0.5, 0.06, whitePanel, FRONT - 0.03, 1.1, -2.75));      // door handles

  // RIGHT: the showroom, glass from floor to roof on two sides, bright and warm inside.
  for (const z of [0, 2, 4, 6, 8, 10, 12]) g.add(box(0.14, H - 0.3, 0.12, darkMetal, FRONT + 0.05, H / 2 - 0.1, z - 0.03));
  for (const y of [0.15, 2.9, H - 0.25]) g.add(box(0.14, 0.12, 12, darkMetal, FRONT + 0.05, y, 6));
  g.add(box(0.05, H - 0.4, 12, shopGlass, FRONT + 0.05, H / 2, 6));
  for (const x of [-6, -3, 0, 3, 6]) g.add(box(0.12, H - 0.3, 0.14, darkMetal, x, H / 2 - 0.1, W / 2));
  g.add(box(D, H - 0.4, 0.05, shopGlass, 0, H / 2, W / 2), box(D, 0.12, 0.14, darkMetal, 0, 2.9, W / 2));
  // Inside (the entrance hall and the showroom are one room): floor, lit back wall, ceiling lights, columns, a desk.
  g.add(box(D - 0.4, 0.06, 17.6, floor, 0, 0.17, 3.1));
  g.add(facingRoad(new THREE.Mesh(new THREE.PlaneGeometry(17.6, H - 0.4), warmWall), D / 2 - 0.2, H / 2, 3.1));
  g.add(box(D - 0.4, 0.1, 17.6, solid(0xe8dcc4, 0.8), 0, H - 0.05, 3.1));
  for (const x of [-3, 1.5]) for (const z of [-3, 1.5, 6, 10]) g.add(neon(0xfff0d8, 1.5, 0.04, 0.8, x, H - 0.12, z, 3.0));
  for (const z of [3, 9]) g.add(box(0.5, H - 0.2, 0.5, solid(0xcdbfa6, 0.7), 3.6, H / 2, z));
  g.add(box(1.0, 1.0, 2.6, solid(0xb59a72, 0.5), 3.4, 0.68, -3));
  g.add(haze(WARM, 12, FRONT + 1, 2.4, 6, 0.22));

  g.userData.lamps = [{ at: at(FRONT - 2.5, 3.4, 6), color: WARM, intensity: 170, distance: 38 }];
  g.userData.neons = [{ at: at(FRONT - 0.8, 4.0, -3), color: CYAN, power: 30 }, { at: at(FRONT - 1, 2.0, 3), color: 0xffd9a0, power: 36 },
    { at: at(FRONT - 1, 2.0, 9), color: 0xffd9a0, power: 36 }, { at: at(FRONT - 2.4, H + 0.4, 0), color: CYAN, power: 16 }];
  g.userData.solids = [[0, 0, D, W]];
  g.userData.display = { x: -0.8, z: 6.2, turn: 0.55 };          // where the car in the window stands (pois.js parks one there)
  g.userData.interact = { type: 'dealer', label: 'Enter the dealership', at: at(FRONT - 5.5, 0, -3), radius: 7 };
  return dimmed(g);
}

// ---- Speed camera: a pole with a camera box and a flash, looking down the road (-Z = toward oncoming drivers) ----
export function buildSpeedCamera() {
  const g = new THREE.Group();
  g.add(tube(0.07, 0.09, 4.4, darkMetal, 0, 2.2, 0), box(0.3, 0.4, 0.3, darkMetal, 0, 0.2, 0));
  g.add(box(0.5, 0.36, 0.75, whitePanel, -0.2, 4.45, 0), box(0.3, 0.2, 0.06, darkMetal, -0.2, 4.45, 0.39));
  const flash = new THREE.MeshBasicMaterial({ color: 0x1a1408 });                   // dark until it fires (main.js brightens it for a moment)
  g.add(box(0.36, 0.14, 0.05, flash, -0.2, 4.72, 0.38));
  g.add(box(0.5, 0.12, 0.5, emissive(0xffb000, 1.6), -0.2, 4.2, 0));                 // a small amber light under it: "camera ahead"
  g.userData.flash = flash;
  g.userData.neons = [{ at: at(-0.2, 4.0, 0), color: 0xffb000, power: 6 }];
  g.userData.solids = [[0, 0, 0.35, 0.35]];
  return dimmed(g);
}
