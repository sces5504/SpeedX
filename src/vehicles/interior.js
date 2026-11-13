// ---------------------------------------------------------------------------
// interior.js — the cockpit you see in first-person view: dashboard, gauge
// cluster with working needles, steering wheel with the driver's hands and
// forearms, windscreen wipers, pillars and a rear-view mirror.
// Only the four hero cars get one.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { canvasTexture } from '../render/materials.js';
import { MPH } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0), scratch = new THREE.Vector3();
const vinyl = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.85 });
const plastic = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.6 });
// A touch of "emissive" stands in for the glow of the instruments, so the wheel and hands
// can be made out in the dark cabin.
const leather = new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.5, emissive: 0x0b0b0c });
const glove = new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.6, emissive: 0x18181a });   // black driving gloves
const sleeve = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.9, emissive: 0x060709 });

export function buildInterior(car, mirrorTexture) {
  const { spec, dims } = car;
  const group = new THREE.Group();
  group.name = 'interior';
  const side = spec.driverSide;                               // +1 = driver sits on the right
  const cowl = spec.stations.find((s) => s[4] === 'ws');      // base of the windscreen
  const roofFront = spec.stations[spec.stations.indexOf(cowl) + 1];
  const cowlZ = dims.frontZ + cowl[0] * spec.length, cowlY = cowl[1];
  const roofZ = dims.frontZ + roofFront[0] * spec.length, roofY = roofFront[2];
  const halfW = dims.halfW;
  const driverX = side * halfW * 0.44;
  const box = (w, h, d, material, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };

  // ---- Dashboard ---------------------------------------------------------------
  box(spec.width - 0.08, 0.10, 0.62, vinyl, 0, cowlY - 0.03, cowlZ + 0.34);            // dash top
  box(spec.width - 0.08, 0.42, 0.10, vinyl, 0, cowlY - 0.26, cowlZ + 0.62);            // dash face
  box(0.34, 0.14, 0.20, vinyl, driverX, cowlY + 0.07, cowlZ + 0.52);                   // gauge hood
  box(0.30, 0.32, 0.5, plastic, 0, cowlY - 0.42, cowlZ + 0.85);                        // centre console
  for (const s of [-1, 1]) {
    box(0.10, 0.12, 2.0, vinyl, s * (halfW - 0.07), cowlY - 0.02, cowlZ + 1.3);        // door tops
    // A-pillars: thin bars from the dash corners up to the roof
    const bottom = new THREE.Vector3(s * (halfW - 0.05), cowlY, cowlZ), top = new THREE.Vector3(s * (halfW * spec.tumble - 0.03), roofY, roofZ);
    const pillar = box(0.07, bottom.distanceTo(top) + 0.06, 0.09, vinyl, 0, 0, 0);
    pillar.position.copy(bottom).add(top).multiplyScalar(0.5);
    pillar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
  }
  box(spec.width * spec.tumble, 0.06, 1.6, vinyl, 0, roofY - 0.035, roofZ + 0.75);     // roof lining

  // ---- Gauge cluster: a printed dial face plus two moving needles ----------------
  const gaugeZ = cowlZ + 0.625, gaugeY = cowlY + 0.065;
  const maxRpm = Math.ceil(spec.engine.redline / 1000) + 1;                             // e.g. 9 (x1000)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.105), new THREE.MeshStandardMaterial({
    map: dialTexture(spec, maxRpm), emissiveMap: dialTexture(spec, maxRpm), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6 }));
  face.position.set(driverX, gaugeY, gaugeZ);
  group.add(face);
  const needleMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3a18, emissiveIntensity: 2.2 });
  const makeNeedle = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(driverX + x, gaugeY - 0.012, gaugeZ + 0.004);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.002), needleMat);
    needle.position.y = 0.02;
    pivot.add(needle); group.add(pivot);
    return pivot;
  };
  const tachNeedle = makeNeedle(-0.072), speedNeedle = makeNeedle(0.072);

  // ---- Steering wheel, hands and forearms ---------------------------------------------
  const column = new THREE.Group();
  column.position.set(driverX, cowlY + 0.045, cowlZ + 0.74);
  column.rotation.x = -0.38;                                   // tilted toward the driver
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.178, 0.017, 10, 36), leather));
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI]) {  // three spokes: left, right, down
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.17, 0.012), plastic);
    spoke.rotation.z = angle; spoke.position.set(-Math.sin(angle) * 0.088, Math.cos(angle) * 0.088, -0.004);
    wheel.add(spoke);
  }
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.035, 16).rotateX(Math.PI / 2), plastic));
  column.add(wheel);
  group.add(column);
  // Gloved hands grip the rim at "ten to two" and turn with it; forearms reach from the elbows.
  // In a hand's own space: X runs along the rim, Y points outward from the wheel centre,
  // Z points at the driver. Fingers go over the far side of the rim, the thumb hooks the near side.
  const capsule = (radius, length, x, y, z, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), glove);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, 0, rz);
    return mesh;
  };
  const arms = [-1, 1].map((s) => {
    const hand = new THREE.Group();
    // back of the hand: a rounded shape lying over the rim on the driver's side
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), glove);
    back.scale.set(0.047, 0.03, 0.05); back.position.set(0, 0.02, 0.036); back.rotation.x = 0.5;
    hand.add(back);
    for (let f = 0; f < 4; f++) {                              // four fingers: knuckle, then two parts wrapping the rim
      const x = -0.031 + f * 0.0207, shorter = f === 0 || f === 3 ? 0.005 : 0;
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.0118, 8, 6), glove);
      knuckle.position.set(x, 0.036, 0.012);
      hand.add(knuckle);
      hand.add(capsule(0.0098, 0.028 - shorter, x, 0.03, -0.006, Math.PI / 2 - 0.35));   // over the top of the rim
      hand.add(capsule(0.0092, 0.022 - shorter, x, 0.008, -0.026, 0.25));                // down the far side
    }
    hand.add(capsule(0.0112, 0.034, s * -0.034, -0.004, 0.03, 0.5, s * 1.1));           // thumb rests along the near side
    hand.add(capsule(0.026, 0.035, 0, 0.012, 0.092, Math.PI / 2 + 0.25));               // wrist
    const angle = s * 0.72;                                    // radians from the top of the wheel ("ten to two")
    hand.position.set(Math.sin(angle) * 0.178, Math.cos(angle) * 0.178, 0);
    hand.rotation.z = -angle;
    wheel.add(hand);
    const wrist = new THREE.Object3D(); wrist.position.set(0, 0.008, 0.125); hand.add(wrist);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.043, 1, 12), sleeve);
    group.add(forearm);
    return { wrist, forearm, elbow: new THREE.Vector3(driverX + s * 0.24, cowlY - 0.27, cowlZ + 1.14) };
  });

  // ---- Windscreen wipers (they only move when it rains) ------------------------------------
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
  group.add(wipers);

  // ---- Rear-view mirror (shows a live picture from a small backwards camera) ---------
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.065), new THREE.MeshBasicMaterial({ map: mirrorTexture }));
  const uv = mirror.geometry.attributes.uv;                    // flip left/right like a real mirror
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  mirror.position.set(0, roofY - 0.11, roofZ + 0.05);
  mirror.rotation.y = side * 0.32;
  group.add(mirror);
  box(0.26, 0.085, 0.02, plastic, 0, roofY - 0.11, roofZ + 0.035).rotation.y = side * 0.32;

  let shownSteer = 0;
  group.visible = false;
  return {
    group,
    // Where the driver's eyes are, in car coordinates.
    eye: new THREE.Vector3(driverX, Math.min(roofY - 0.14, cowlY + 0.33), cowlZ + 1.0),
    mirrorPosition: new THREE.Vector3(0, roofY - 0.11, dims.rearZ - 0.4),
    update(vehicle, wiperCycle = 0, dt = 1 / 60) {
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
