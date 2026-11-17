// ---------------------------------------------------------------------------
// carBuilder.js — builds a 3D car from a spec in carSpecs.js.
//
// The result is a "car object":
//   car.group        put this in the scene and move/rotate it
//   car.body         the shell; lean it for body roll and pitch
//   car.wheels[4]    FL, FR, RL, RR — each has .pivot (steer / suspension)
//                    and .spin (rolls). Every wheel is its own object.
//   car.lamps        the meshes that light up with each switch (each has its own material):
//                    head, tail, brake, reverse, signalL, signalR
//                    (lamps and grilles on the nose and tail: carEnds.js;
//                     body lines, mirrors and other fittings: carDetails.js)
//   car.setLights()  convenient switchboard for all of the above
//   car.dispose()    call when the car is thrown away: frees its 3D data (carResources.js)
//
// Local axes of a car: forward = -Z, right = +X, up = +Y. The origin is on the
// ground under the centre of gravity.
//
// If the car has a model.glb (see carModel.js) its body and wheels come from
// that model; otherwise a smooth shell (carShell.js) and wheels (carWheel.js)
// are generated from the measurements and side profile in car.json. Lamps, licence plates and the light switchboard are the same either way.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { lerp } from '../core/mathUtils.js';
import { beamMaterial, canvasTexture, enhanceMaterial, makeGlowTexture } from '../render/materials.js';
import { getCarModel } from './carModel.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { U, makeShell } from './carShell.js';
import { addBodyDetails, buildCargoBox, buildLamp, chrome, lensMaterial } from './carDetails.js';
import { LAMP_COLOURS, buildEndParts, buildSideParts, endParts, flat } from './carEnds.js';
import { buildPieces, isPiece } from './carPieces.js';
import { buildWheel } from './carWheel.js';
import { smallLights } from '../render/smallLights.js';
import { carReflection } from '../render/reflections.js';
import { claimResources, releaseResources } from './carResources.js';

// Bodywork lit by headlights from a few metres away would be far brighter than anything else
// in the picture and bloom into one huge white ball. This limit (see enhanceMaterial) lets it get
// just bright enough to glow a little (GRAPHICS.bloomThreshold is 1.25) and no further.
export const PAINT_LIMIT = 1.5;
const glowTexture = makeGlowTexture();
const lampSpot = new THREE.Vector3();
// Cone for the visible beam of ONE headlight: its narrow end is at the lamp (the origin) and
// it reaches 14 m forward (-Z).
const beamConeGeometry = new THREE.CylinderGeometry(0.07, 0.95, 14, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, -7);
const trimMat = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.7 }), { limit: PAINT_LIMIT });
const shellTrim = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.7, vertexColors: true }), { limit: PAINT_LIMIT });   // underside: shaded by the shell's vertex colours
const glassMat = enhanceMaterial(new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.06, metalness: 0.9, envMap: carReflection }), { limit: PAINT_LIMIT });
const archMat = new THREE.MeshBasicMaterial({ color: 0x020202 });
const poolTexture = makePoolTexture();
const shadowTexture = canvasTexture(64, 64, (g, w, h) => {
  const grad = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
}, { repeat: false });

export function buildCar(spec, colorHex) {
  const frontWeight = spec.frontWeight ?? 0.58;
  const a = spec.wheelbase * (1 - frontWeight);       // centre of gravity -> front axle
  const b = spec.wheelbase * frontWeight;             // centre of gravity -> rear axle
  const frontZ = -a - spec.frontOverhang;             // tip of the front bumper
  const rearZ = frontZ + spec.length;
  const model = getCarModel(spec.id);
  const halfW = model ? model.halfW : spec.width / 2;
  const dims = { a, b, frontZ, rearZ, halfW, halfTrack: halfW - 0.13 };

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // ---- Body: a real model if the car has one, otherwise the generated shell ----------
  let paint, partPaint, painted, shell, surface = null;      // surface: where the generated skin is (carShell.js); a model has none
  if (model) {
    // White-painted models are tinted with the chosen colour (texture x colour).
    paint = model.material.clone();
    paint.color.set(colorHex);
    shell = new THREE.Mesh(model.body, paint);
  } else {
    // Metallic paint under a glossy clear coat. vertexColors: the shell is darker underneath (carShell.js).
    const paintLook = { roughness: 0.42, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.07, envMap: carReflection, envMapIntensity: 1.25 };
    painted = (color, vertexColors) => enhanceMaterial(new THREE.MeshPhysicalMaterial({ color, ...paintLook, vertexColors }), { limit: PAINT_LIMIT });
    paint = painted(colorHex, true);
    partPaint = painted(colorHex, false);                    // for bolted-on parts (mirrors, wing, lamp pods), which have no shading of their own
    const lower = spec.twoTone !== undefined ? painted(spec.twoTone, true) : paint;
    const made = makeShell(spec, dims);
    surface = made.surface;
    shell = new THREE.Mesh(made.geometry, [paint, glassMat, shellTrim, lower]);
  }
  shell.castShadow = true;
  shell.name = 'body_shell';
  body.add(shell);
  const detailPaint = model ? new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.3 }) : partPaint;

  // Where is the surface of the nose (or tail) at a given spot? Lamps and plates sit there.
  // With the generated shell we know the shape; with a real model we shoot a ray at it (and if
  // the body is narrower than expected there, slide inward until the ray hits).
  const ray = new THREE.Raycaster();
  const where = (tail, x, y) => {
    if (surface) { const point = surface.onEnd(tail, Math.abs(x), y); point.x *= Math.sign(x) || 1; return point; }
    for (let tries = 0; tries < 8; tries++, x *= 0.93) {
      ray.set(new THREE.Vector3(x, y, tail ? rearZ + 2 : frontZ - 2), new THREE.Vector3(0, 0, tail ? -1 : 1));
      const hit = ray.intersectObject(shell)[0];
      if (hit) return hit.point;
    }
    return new THREE.Vector3(x, y, tail ? rearZ : frontZ);
  };
  const add = (mesh, x, y, z, parent = body) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
  // How high the top of the generated skin (bonnet, roof, boot) is at a spot: z along the car, x out from the centre line.
  const topSkin = (z, x) => {
    let best = null;
    for (let u = U.glassLow; u <= U.centre; u += 0.25) { const point = surface.at(surface.tOf(z), u); if (!best || Math.abs(point.x - Math.abs(x)) < Math.abs(best.x - Math.abs(x))) best = point; }
    return best.y;
  };
  const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);

  // ---- Lamps, grilles and the rest of the nose and tail ----------------------------------
  // lamps.<switch> = the meshes that light up with that switch.
  const lamps = { head: [], tail: [], brake: [], reverse: [], signalL: [], signalR: [], pods: [] };
  const glows = { head: [], tail: [] }, beams = [];
  const H = spec.headlights, T = spec.taillights;
  const thin = model ? 0.012 : 0.03;          // a real model has its lamps painted on: ours are then thin glowing covers
  const parts = endParts(spec, halfW);
  if (surface) {
    // Generated car: every part is laid on the skin (carEnds.js).
    // (finishes of this car's own: "paint2" = its second paint colour, for panels listed in nose / tail / side)
    const own = spec.twoTone !== undefined ? { paint2: flat(painted(spec.twoTone, false)) } : {};
    // (the flat parts are drawn on the skin; the real 3D "pieces" among them are built in carPieces.js)
    const flatOnly = (list) => (list || []).filter((p) => !isPiece(p));
    const ends = buildEndParts(surface, { nose: flatOnly(parts.nose), tail: flatOnly(parts.tail) }, own);
    body.add(...ends.meshes);
    if (spec.side) body.add(...buildSideParts(surface, flatOnly(spec.side), own));
    for (const name in ends.lamps) lamps[name].push(...ends.lamps[name]);
    const pieceLists = { nose: parts.nose.filter(isPiece), tail: parts.tail.filter(isPiece), side: (spec.side || []).filter(isPiece) };
    if (pieceLists.nose.length || pieceLists.tail.length || pieceLists.side.length) {
      const pieces = buildPieces(surface, pieceLists, { ...own, paint: detailPaint });
      body.add(...pieces.meshes);
      for (const name in pieces.lamps) lamps[name].push(...pieces.lamps[name]);
    }
  } else {
    // Real model: only the lamps, as flat plates stuck on its nose and tail.
    for (const [list, tail] of [[parts.nose, false], [parts.tail, true]]) {
      for (const part of list.filter((p) => LAMP_COLOURS[p.is] !== undefined && p.box && !isPiece(p))) {
        const [from, to, bottom, top] = part.box;
        for (const side of [-1, 1]) {
          const at = where(tail, side * (from + to) / 2, (bottom + top) / 2);
          const lamp = add(buildLamp(to - from, top - bottom, LAMP_COLOURS[part.is], { facing: tail ? 1 : -1, depth: thin }), at.x, at.y, at.z + (tail ? -0.008 : 0.008));
          lamps[part.is === 'signal' ? (side < 0 ? 'signalL' : 'signalR') : part.is].push(lamp);
        }
      }
    }
  }
  const beamMat = beamMaterial(0xfff0d8, 0.3);
  for (const side of [-1, 1]) {
    // The spot the light of this headlight comes from: the middle of the fixed lamp, or a
    // pop-up pod on the bonnet with its own lamp ("popup": true).
    let source;
    if (H.popup) {
      const pod = new THREE.Group();
      pod.add(new THREE.Mesh(new RoundedBoxGeometry(H.w + 0.07, H.h + 0.05, 0.3, 2, 0.02), detailPaint));
      source = buildLamp(H.w, H.h, LAMP_COLOURS.head, { facing: -1, depth: thin });
      source.position.set(0, 0, -0.145);
      pod.add(source);
      const podZ = frontZ + spec.length * (H.z ?? 0.085);       // ("z": how far back the pods are, as a fraction of the length)
      pod.userData.upY = H.y + H.h / 2 + 0.01;
      pod.userData.downY = H.y - H.h / 2 - 0.06;
      if (surface) {
        // Shut, the lid lies in the bonnet: its front and rear edges just proud of it, tilted
        // along its slope. (Open, the lamp looks straight ahead.)
        // (the height of the bonnet under THIS pod: the skin is lower out at the sides than on the centre line)
        const bonnet = (z) => topSkin(z, H.x * halfW);
        const front = bonnet(podZ - 0.15), rear = bonnet(podZ + 0.15);
        pod.userData.downY = (front + rear) / 2 + 0.008 - (H.h + 0.05) / 2;
        pod.userData.downTilt = -Math.atan2(rear - front, 0.3);
      }
      pod.position.set(side * H.x * halfW, pod.userData.downY, podZ);
      pod.rotation.x = pod.userData.downTilt ?? 0;
      body.add(pod);
      lamps.pods.push(pod);
      lamps.head.push(source);
    } else {
      source = new THREE.Object3D();
      source.position.copy(where(false, side * H.x * halfW, H.y));
      body.add(source);
    }
    // The beam as a cone of lit air, starting AT the lamp (so it follows a pop-up lamp too).
    const cone = new THREE.Mesh(beamConeGeometry, beamMat);
    cone.scale.set(1.5, 0.6, 1);                              // wide and flat
    cone.rotation.x = -0.035;                                 // dipped toward the road
    cone.position.z = -thin;
    source.add(cone);
    beams.push(cone);
    // Soft flares so lamps are visible from far away
    const headGlow = flare(0xfff0d0, 1); source.add(headGlow); headGlow.position.z = -0.12; glows.head.push(headGlow);
    const tailGlow = flare(0xff2010, 0.5); body.add(tailGlow); tailGlow.position.copy(where(true, side * T.x * halfW, T.y)).z += 0.1; glows.tail.push(tailGlow);
  }

  // ---- Licence plates (each car gets its own random number) -----------------------
  // "plates": [front, rear] in car.json = their heights; otherwise under the nose and under the tail lamps.
  const plate = makePlate();
  const [plateFrontY, plateRearY] = spec.plates ?? [spec.stations[0][1] - 0.12, T.y - T.h - 0.1];
  const plateGeo = new THREE.PlaneGeometry(0.31, 0.155);
  // ("plateSide": metres the front plate sits off the centre line, for a car whose grille takes the middle)
  for (const [tail, y, x] of [[false, plateFrontY, spec.plateSide ?? 0], [true, plateRearY, 0]]) {
    // A plate lies against the bodywork: tilted the way the nose or tail leans at that height.
    // (never flatter than about 35 degrees, or a plate on a low nose would sink into the bonnet)
    const upper = where(tail, x, y + 0.07), lower = where(tail, x, y - 0.07), out = tail ? 1 : -1;
    const lean = Math.min(0.1, Math.max(-0.1, upper.z - lower.z));
    const facing = new THREE.Vector3(0, lean * -out, 0.14 * out).normalize();
    if (x) {
      // Off the centre line the nose also turns away sideways: face the way the skin does there.
      const across = where(tail, x + 0.12, y).sub(where(tail, x - 0.12, y)), down = lower.clone().sub(upper);
      facing.crossVectors(across, down).normalize();
      if (facing.z * out < 0) facing.negate();
    }
    const mesh = add(new THREE.Mesh(plateGeo, plate.material), x, y, tail ? Math.max(upper.z, lower.z) - Math.abs(lean) / 2 : Math.min(upper.z, lower.z) + Math.abs(lean) / 2);
    mesh.position.addScaledVector(facing, 0.015);
    if (x) {
      // A flat plate on a curved corner of the nose: stand it off far enough that no part of the
      // skin behind it comes through (as a real plate on its bracket does).
      let clear = 0;
      for (let i = 0; i <= 6; i++) for (let k = 0; k <= 4; k++) clear = Math.max(clear, where(tail, x + (i / 6 - 0.5) * 0.32, y + (k / 4 - 0.5) * 0.16).sub(mesh.position).dot(facing));
      mesh.position.addScaledVector(facing, clear + 0.006);
    }
    mesh.lookAt(mesh.position.clone().add(facing));
  }

  // ---- The details that make the generated shell a car (a real model already has them) -------
  if (surface) {
    const { repeaters } = addBodyDetails(body, surface, spec, dims, detailPaint);
    lamps.signalL.push(...repeaters.L); lamps.signalR.push(...repeaters.R);
    if (spec.spoiler) {
      // Rear wing.  "spoiler": 1.0  = a body-colour blade at that height on two posts.
      // "spoiler": { "height": 1.2, "gt": true }  = a racing wing: a wide black blade with end
      // plates on two tall stays ("back": metres from the tail, default 0.2).
      // "spoiler": { "lip": true }  = a ducktail: a body-colour lip turned up along the edge of the boot.
      // "rise" instead of "height" = metres above the boot (a shared part that fits any car).
      // A wing made for one car may also set: "span" (share of the car's width), "chord" (metres
      // front to back), "angle" (radians, trailing edge up), "posts" (share of the half width out
      // from the centre where the two posts stand - they then stand on the skin itself) and
      // "color": "paint2" (the car's second colour) or "black".
      const wing = typeof spec.spoiler === 'number' ? { height: spec.spoiler } : { ...spec.spoiler };
      const own = wing.color === 'paint2' && spec.twoTone !== undefined ? painted(spec.twoTone, false) : wing.color === 'black' ? trimMat : null;
      const material = own || (wing.gt ? trimMat : detailPaint), z = rearZ - (wing.back ?? (wing.lip ? 0.07 : 0.2));
      const deckY = surface.at(surface.tOf(z), U.centre).y;
      wing.height ??= deckY + (wing.rise ?? 0.15);
      const span = spec.width * (wing.span ?? (wing.gt ? 0.98 : wing.lip ? 0.86 : 0.94));
      if (wing.lip) {
        add(new THREE.Mesh(new RoundedBoxGeometry(span, 0.022, 0.17, 2, 0.01), material), 0, deckY + 0.03, z).rotation.x = -0.42;      // (turned UP toward the back)
      } else if (wing.airfoil) {
        // "airfoil": true = a wing built like a real one (a GT car's): the main plane is a true wing
        // section (round leading edge, thin trailing edge) with a small lip along its trailing edge,
        // a shaped end plate at each tip, and two flat uprights with a cut-out in them standing on
        // the deck. "trim" = the finish of the end plates and uprights ("black", "paint2" or "paint");
        // "endplates": [above, below] their size; "light": true makes the lip a brake-light strip.
        const chord = wing.chord ?? 0.3, angle = wing.angle ?? 0.07;
        const trim = wing.trim === 'paint2' && spec.twoTone !== undefined ? painted(spec.twoTone, false) : wing.trim === 'paint' ? detailPaint : trimMat;
        const blade = new THREE.Group();                         // the main plane, its lip and end plates, tilted together
        blade.position.set(0, wing.height, z);
        blade.rotation.x = -angle;
        body.add(blade);
        blade.add(new THREE.Mesh(airfoilBlade(span, chord, 0.12), material));
        // ("light": true = the lip is a red light strip that glows with the tail / brake lamps)
        const lip = new THREE.Mesh(new RoundedBoxGeometry(span - 0.04, 0.014, 0.012, 1, 0.004), wing.light ? lensMaterial(LAMP_COLOURS.brake) : material);
        lip.position.set(0, 0.009, chord / 2 - 0.006);
        blade.add(lip);
        if (wing.light) lamps.brake.push(lip);
        const [above, below] = wing.endplates ?? [0.05, 0.12];          // (metres the end plates reach above and below the blade)
        for (const side of [-1, 1]) {
          const plate = new THREE.Mesh(endPlate(chord * 1.18, above, below), trim);
          plate.position.set(side * (span / 2 + 0.004), 0, 0.01);
          blade.add(plate);
          // Uprights: from the deck up to the underside of the blade, wide at the foot.
          const x = side * halfW * (wing.posts ?? 0.3), footY = topSkin(z, x) - 0.01;
          add(new THREE.Mesh(wingUpright(wing.height - footY - 0.012, chord * 0.85, chord * 0.42), trim), x, footY, z);
        }
      } else {
        add(new THREE.Mesh(new RoundedBoxGeometry(span, 0.03, wing.chord ?? (wing.gt ? 0.3 : 0.24), 2, 0.012), material), 0, wing.height, z).rotation.x = -(wing.angle ?? 0.07);     // (a wing's trailing edge is the high one)
        for (const side of [-1, 1]) {
          const x = side * halfW * (wing.posts ?? (wing.gt ? 0.4 : 0.72)), footY = wing.posts !== undefined ? topSkin(z, x) - 0.01 : deckY;
          add(box(wing.gt ? 0.02 : 0.035, wing.height - footY, wing.gt ? 0.2 : 0.16, material), x, (wing.height + footY) / 2, z);
          if (wing.gt) add(box(0.015, 0.17, 0.34, material), side * span / 2, wing.height - 0.02, z);
        }
      }
    }
    if (spec.skirts) {
      // Side skirts: a slim body-colour blade that carries the door skin down past the sill, from wheel
      // arch to wheel arch. It sits in the hollow under the door, so it does not stand out from the body.
      // "skirts": true, or { "drop": metres deeper than that, "out": metres further out } for a bigger one.
      const { drop = 0, out = 0 } = spec.skirts === true ? {} : spec.skirts;
      const reach = spec.wheelRadius + 0.07, length = spec.wheelbase - 2 * reach;
      for (const side of [-1, 1]) add(new THREE.Mesh(new RoundedBoxGeometry(0.028 + out, 0.06 + drop, length, 2, 0.012), detailPaint), side * (halfW - 0.034 + out / 2), spec.clearance + 0.035 - drop / 2, (b - a) / 2);
    }
    // Scoops and vents. They sit on the centre line of the car and follow the slope of the panel they are on.
    const onPanel = (mesh, t, x = 0, lift = 0) => {
      const here = surface.at(t, U.centre), ahead = surface.at(t - 0.02, U.centre);
      add(mesh, x, here.y + lift, here.z).rotation.x = Math.atan2(ahead.y - here.y, here.z - ahead.z);
      return mesh;
    };
    // (a scoop is painted like the panel under it: the second colour where a band or a carbon bonnet runs there)
    const banded = (zones) => (spec.twoTone !== undefined && zones.includes(spec.twoToneZone) ? painted(spec.twoTone, false) : detailPaint);
    const scoop = (width, height, length, t, material) => {       // a raised intake, open (dark) at the front
      onPanel(new THREE.Mesh(new RoundedBoxGeometry(width, height, length, 2, Math.min(0.025, height / 2.2)), material), t, 0, height * 0.3);
      onPanel(box(width - 0.05, height * 0.55, 0.012, archMat), t - (length / 2 - 0.004) / spec.length, 0, height * 0.42);
    };
    // "pods": two long raised ducts side by side on the bonnet, roof or engine cover (a mid-engined car's
    // intake snorkels). { "from", "to": t along the car, "x": metres from the centre line, "width", "height", "is": "chrome" | "paint" | "paint2" }
    if (spec.pods) {
      const { from, to, x, width, height, is = 'chrome' } = spec.pods;
      const zA = frontZ + from * spec.length, zB = frontZ + to * spec.length, length = zB - zA;
      const material = is === 'chrome' ? chrome : is === 'paint2' && spec.twoTone !== undefined ? painted(spec.twoTone, false) : detailPaint;
      for (const side of [-1, 1]) {
        const yA = topSkin(zA + 0.05, x), yB = topSkin(zB - 0.05, x);
        add(new THREE.Mesh(new RoundedBoxGeometry(width, height, length, 3, Math.min(width, height) * 0.45), material), side * x, (yA + yB) / 2 + height * 0.25, (zA + zB) / 2).rotation.x = -Math.atan2(yB - yA, length - 0.1);
      }
    }
    const cowlT = spec.stations.find((s) => s[4] === 'ws')[0];
    if (spec.hood?.scoop) scoop(0.42, 0.055, 0.5, cowlT * 0.62, banded(['top', 'hood']));
    if (spec.hood?.vents) for (const side of [-1, 1]) onPanel(box(0.26, 0.012, 0.34, trimMat), cowlT * 0.55, side * halfW * 0.4, 0.004);   // two black louvred panels
    if (spec.roofScoop) scoop(0.34, 0.055, 0.46, surface.cabin.from + (surface.cabin.middle - surface.cabin.from) * 0.55, banded(['top']));
    if (spec.cargoBox) {
      const c = spec.cargoBox, length = (c.to - c.from) * spec.length;
      add(buildCargoBox(spec.width + 0.1, c.top - c.bottom, length), 0, (c.top + c.bottom) / 2, frontZ + (c.from + c.to) / 2 * spec.length);
    }
  }
  // Dark blob under the car so it sits on the road even without real shadows
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.width * 1.25, spec.length * 1.12),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.9 }));
  blob.rotation.x = -Math.PI / 2;
  add(blob, 0, 0.03, (frontZ + rearZ) / 2, group);

  // ---- Wheels (each one its own object so it can spin and steer) ---------------------
  const r = spec.wheelRadius, tyreWidth = r * 0.62;
  const wheelStyle = spec.role === 'hero' ? { spokes: 8, dark: false, color: spec.rimColor } : { spokes: 5, dark: true };   // bright racing rims ("rimColor": painted) / plain dark ones
  const wheels = [];
  ['FL', 'FR', 'RL', 'RR'].forEach((name, k) => {
    const side = k % 2 === 0 ? -1 : 1;
    const fromModel = model?.wheels[k];
    const z = fromModel ? fromModel.z : (k < 2 ? -a : b);
    const x = fromModel ? fromModel.x : side * (dims.halfTrack - tyreWidth * 0.1 + (spec.wheelOut ?? 0));      // ("wheelOut": wide-body cars push the wheels out to fill the arches)
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.name = 'wheel_' + name;
    pivot.position.set(x, r, z);
    if (fromModel?.geometry) {
      const wheel = new THREE.Mesh(fromModel.geometry, model.wheelMaterial);   // cut out of the model
      wheel.castShadow = true;
      spin.add(wheel);
    } else {
      const wheel = buildWheel(r, tyreWidth, wheelStyle);
      wheel.scale.x = side;                                    // the pretty side faces outward
      spin.add(wheel);
    }
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ name, pivot, spin, side, z, restY: r });
    // black disc = the dark inner wall of the wheel arch
    const arch = new THREE.Mesh(new THREE.CircleGeometry(r + 0.075, 20), archMat);
    arch.rotation.y = side * Math.PI / 2;
    // (on a supercar body the bonnet sits low between the wings: the disc stands further out, under
    // the wing, or its top would show through the bonnet)
    add(arch, model ? side * (halfW - r * 0.98) : side * (halfW * (surface?.sculpted ? 0.74 : 0.5)), r + 0.01, z);
  });

  // ---- Fake pool of light on the road (for AI cars without a real spotlight) -------
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 26), new THREE.MeshBasicMaterial({
    map: poolTexture, color: 0xfff0d2, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  add(pool, 0, 0.05, frontZ - 13.5, group);
  pool.visible = false;

  // Where the lamps' glow lands (left, right): low and a little way off, so it spills over the
  // road and the things around the car instead of flooding the car's own bodywork.
  const lampSpots = {
    head: [-1, 1].map((side) => new THREE.Vector3(side * H.x * halfW, 0.3, frontZ - 1.5)),
    tail: [-1, 1].map((side) => new THREE.Vector3(side * T.x * halfW, 0.15, rearZ + 1.5)),
  };
  const car = { spec, group, body, shell, wheels, lamps, glows, pool, dims, paint, plate, lightState: {} };
  // Change the body colour (AI cars are repainted when they are recycled).
  car.setColor = (hex) => { paint.color.set(hex); detailPaint.color.set(hex); };

  // ---- Light switchboard ----------------------------------------------------------
  // head: 0 off, 1 low beam, 2 high beam.   usePool: draw the fake light on the road.
  car.setLights = ({ head = 0, brake = false, reverse = false, left = false, right = false, usePool = false, poolFade = 1 }) => {
    const set = (list, value) => { for (const m of list) m.material.emissiveIntensity = value; };
    set(lamps.head, head === 0 ? 0 : head === 1 ? 6 : 10);
    set(lamps.tail, head > 0 ? 1.6 : 0);
    set(lamps.brake, brake ? 7 : head > 0 ? 1.0 : 0);
    set(lamps.reverse, reverse ? 4 : 0);
    set(lamps.signalL, left ? 5 : 0);
    set(lamps.signalR, right ? 5 : 0);
    for (const g of glows.head) { g.visible = head > 0; g.material.opacity = head === 2 ? 1 : 0.75; g.userData.gain = head === 2 ? 1.4 : 1; }
    for (const g of glows.tail) { g.visible = head > 0 || brake; g.material.opacity = brake ? 0.9 : 0.45; }
    for (const beam of beams) beam.visible = head > 0;
    beamMat.uniforms.uStrength.value = head === 2 ? 0.55 : 0.3;
    pool.visible = usePool && head > 0;
    pool.material.opacity = (head === 2 ? 0.34 : 0.2) * poolFade;
    Object.assign(car.lightState, { head, brake, left, right });
  };
  // Call every frame: raises/lowers pop-up headlights and sizes the flares by distance.
  car.updateLights = (dt, cameraPosition) => {
    for (const pod of lamps.pods) {
      const target = car.lightState.head > 0 ? pod.userData.upY : pod.userData.downY;
      pod.position.y = lerp(pod.position.y, target, Math.min(1, dt * 6));
      pod.rotation.x = (pod.userData.downTilt ?? 0) * (pod.userData.upY - pod.position.y) / (pod.userData.upY - pod.userData.downY);
    }
    const dx = cameraPosition.x - group.position.x, dz = cameraPosition.z - group.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    // A lamp only dazzles when it points at you: +1 = camera straight ahead of the car, -1 = behind it.
    const yaw = group.rotation.y, facing = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / dist;
    const front = Math.min(1, Math.max(0, facing * 2.5)), back = Math.min(1, Math.max(0, -facing * 2.5));
    // Far lamps would shrink to nothing; real ones stay visible as bright points, so grow with distance.
    const size = 0.3 + dist * 0.011;
    for (const g of glows.head) { g.scale.setScalar(size * 1.2 * (g.userData.gain || 1) * (0.3 + 0.7 * front)); g.material.opacity = front * (car.lightState.head === 2 ? 0.8 : 0.55); }
    for (const g of glows.tail) { g.scale.setScalar(size * 0.8); g.material.opacity = back * (car.lightState.brake ? 0.9 : 0.4); }
  };
  // Tell smallLights.js about this car's lamps, so they tint the road and whatever is near.
  // headShare: 0..1 how much of the headlight glow to add (0 when real spotlights do that job).
  car.addSmallLights = (camera, headShare = 1) => {
    const state = car.lightState;
    const offer = (list, hex, power) => {
      for (const spot of list) { lampSpot.copy(spot).applyMatrix4(group.matrixWorld); smallLights.add(lampSpot.x, lampSpot.y, lampSpot.z, hex, power, camera); }
    };
    if (state.head > 0) offer(lampSpots.head, 0xfff0d8, (state.head === 2 ? 150 : 60) * headShare);
    offer(lampSpots.tail, 0xff1a08, state.brake ? 6 : state.head > 0 ? 2.5 : 0);
    if (state.left) offer([lampSpots.tail[0]], 0xff8a00, 14);
    if (state.right) offer([lampSpots.tail[1]], 0xff8a00, 14);
  };
  car.setLights({ head: 0 });
  claimResources(group);
  car.dispose = () => { group.removeFromParent(); releaseResources(group); };
  return car;
}

// ---------------------------------------------------------------------------
// Licence plate: a little canvas with a random California-style number.
// plate.setText() gives it a new number (used when an AI car is recycled).
// ---------------------------------------------------------------------------
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export function randomPlateText() {
  const letter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
  const digit = () => Math.floor(Math.random() * 10);
  return `${1 + Math.floor(Math.random() * 9)}${letter()}${letter()}${letter()}${digit()}${digit()}${digit()}`;
}
// A wing blade: a symmetrical wing section (NACA 00xx: "thickness" = share of the chord) swept
// along x over `span`, with its tips rounded off. Centred; the leading edge faces forward (-z).
function airfoilBlade(span, chord, thickness) {
  const shape = new THREE.Shape(), steps = 14, half = (x) => 5 * thickness * chord * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  for (let k = 0; k <= steps; k++) { const x = (1 - Math.cos((k / steps) * Math.PI)) / 2; (k ? shape.lineTo : shape.moveTo).call(shape, x * chord, half(x)); }
  for (let k = steps - 1; k > 0; k--) { const x = (1 - Math.cos((k / steps) * Math.PI)) / 2; shape.lineTo(x * chord, -half(x)); }
  const tip = Math.min(0.012, thickness * chord * 0.4);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: span - 2 * tip, bevelEnabled: true, bevelThickness: tip, bevelSize: tip * 0.6, bevelSegments: 3, curveSegments: 4 });
  // (shape drawn in x = chord, y = thickness; turn it so the chord runs along z and the span along x)
  return geometry.translate(-chord / 2, 0, -(span - 2 * tip) / 2).rotateY(-Math.PI / 2);
}

// An end plate for a wing tip: a thin plate, in the car's z-y plane, with rounded corners;
// `above` / `below` metres reach past the wing's top and bottom. Centred on the wing's chord.
function endPlate(length, above, below) {
  const shape = new THREE.Shape(), r = 0.03, x0 = -length / 2, x1 = length / 2, y0 = -below, y1 = above;
  shape.moveTo(x0 + r, y0); shape.lineTo(x1 - r * 2, y0); shape.quadraticCurveTo(x1, y0, x1, y0 + r * 2);
  shape.lineTo(x1, y1 - r); shape.quadraticCurveTo(x1, y1, x1 - r, y1); shape.lineTo(x0 + r * 3, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r * 2); shape.lineTo(x0, y0 + r); shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 6 })
    .translate(0, 0, -0.004).rotateY(-Math.PI / 2);
}

// A wing upright: a flat plate in the car's z-y plane, `foot` metres long at the bottom and `head`
// at the top, `tall` high, its back edge sloping, with a rounded cut-out to lighten it.
// Its origin is the middle of its foot.
function wingUpright(tall, foot, head) {
  const shape = new THREE.Shape();
  shape.moveTo(-foot / 2, 0); shape.lineTo(foot / 2, 0); shape.lineTo(head / 2, tall); shape.lineTo(-head / 2, tall); shape.closePath();
  if (tall > 0.08) {
    const hole = new THREE.Path(), inset = 0.025, top = tall - inset, low = inset + 0.01;
    const across = (y) => lerp(foot, head, y / tall) / 2 - inset;
    hole.moveTo(-across(low), low); hole.lineTo(across(low), low); hole.lineTo(across(top), top); hole.lineTo(-across(top), top); hole.closePath();
    shape.holes.push(hole);
  }
  return new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 })
    .translate(0, 0, -0.006).rotateY(-Math.PI / 2);
}

function makePlate() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const material = enhanceMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }), { retro: 1.2, limit: PAINT_LIMIT });
  const plate = {
    material, text: '',
    setText(text) {
      plate.text = text;
      const g = canvas.getContext('2d');
      g.fillStyle = '#f1f1ea'; g.fillRect(0, 0, 256, 128);
      g.strokeStyle = '#8a8a86'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 122);
      g.textAlign = 'center';
      g.fillStyle = '#c0282c'; g.font = 'italic bold 24px Georgia, serif'; g.fillText('California', 128, 30);
      g.fillStyle = '#1b2a6b'; g.font = 'bold 68px "Arial Narrow", Arial, sans-serif'; g.fillText(text, 128, 100);
      texture.needsUpdate = true;
    },
  };
  plate.setText(randomPlateText());
  return plate;
}

function flare(color, opacity) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.visible = false;
  return sprite;
}

function makePoolTexture() {
  return canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w / 2, h * 0.8, 0, w / 2, h * 0.8, h * 0.8);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(w / 2, 0); g.scale(0.5, 1); g.translate(-w / 2, 0);
    g.fillStyle = grad; g.fillRect(-w, 0, w * 3, h); g.restore();
  }, { repeat: false });
}
