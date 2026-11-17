// car-studio.js — LOOK at a car before showing it: renders it from several angles in an evenly
// lit grey room (not the dark game scene) and sends the sheet to tools/shot-receiver.mjs, which
// saves it as previews/shots/<name>.jpg for you to open.
//   1. node tools/shot-receiver.mjs            (leave it running)
//   2. npm run dev, open the game, then in the browser console:
//        const { studio } = await import('/tools/car-studio.js');
//        await studio(['veyron', 'ccgt1'], 'compare', { labels: ['VEYRON', 'CCGT1'] });
// Options: color (one paint for every car), mono (second colour = paint, side panels off: shows the
// shape alone), plain (no nose / tail parts), lights (lamps on), fov, tx / ty / tz (the point looked
// at), labels, views: [[label, angle, height, distance], ...]  angle 0 = in front, PI/2 = its right side.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ALL_CARS } from '/src/vehicles/carSpecs.js';

export async function studio(ids, name, opts = {}) {
  const W = 480, H = 300, views = opts.views || [
    ['front', 0, 0.9, 5.2], ['front 3/4', 0.75, 1.6, 5.4], ['side', Math.PI / 2, 0.75, 6.2],
    ['rear 3/4', 2.4, 1.6, 5.4], ['rear', Math.PI, 0.9, 5.2], ['top', 0, 7, 0]];
  const cols = 3, rowsPer = Math.ceil(views.length / cols);
  const canvas = document.createElement('canvas'); canvas.width = W * cols; canvas.height = H * rowsPer * ids.length;
  const ctx = canvas.getContext('2d');
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(W, H, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xb9bcc2);
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.6));
  for (const [x, y, z, i] of [[4, 6, 3, 2.2], [-4, 5, -3, 1.4], [0, 8, 0, 1]]) { const d = new THREE.DirectionalLight(0xffffff, i); d.position.set(x, y, z); scene.add(d); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(opts.fov || 30, W / H, 0.05, 100);
  for (let c = 0; c < ids.length; c++) {
    let spec = ALL_CARS[ids[c]];
    if (opts.mono) spec = { ...spec, twoTone: opts.color, side: [] };
    if (opts.plain) spec = { ...spec, nose: [], tail: [], pods: undefined };
    const car = window.speedx.buildCar(spec, opts.color || spec.colors[0]);
    car.setLights?.(opts.lights ? { head: 1, tail: 1 } : { head: 0 });
    // Lamps off: also hide the beams of lit air and the light on the floor (they would haze the nose).
    if (!opts.lights) car.group.traverse((o) => { if (o.isMesh && o.material?.blending === THREE.AdditiveBlending) o.visible = false; });
    scene.add(car.group);
    const target = new THREE.Vector3(opts.tx ?? 0, opts.ty ?? 0.55, opts.tz ?? 0);
    views.forEach(([label, ang, h, d], v) => {
      // the car's nose points to -Z; ang 0 = in front, PI/2 = its right side, PI = behind
      cam.position.set(target.x + Math.sin(ang) * d, h, target.z - Math.cos(ang) * d + (label === 'top' ? 0.001 : 0));
      cam.lookAt(target); r.render(scene, cam);
      const x = (v % cols) * W, y = (c * rowsPer + Math.floor(v / cols)) * H;
      ctx.drawImage(r.domElement, x, y);
      ctx.fillStyle = '#000'; ctx.font = 'bold 15px monospace'; ctx.fillText(`${opts.labels?.[c] ?? ids[c]} — ${label}`, x + 8, y + 20);
    });
    scene.remove(car.group); car.dispose?.();
  }
  r.dispose();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  return (await fetch('http://localhost:5199/' + name, { method: 'POST', body: blob })).text();
}
