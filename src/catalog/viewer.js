// ---------------------------------------------------------------------------
// viewer.js — the one 3D window of the catalogue page: a small photo studio
// at night in which a car, a building or a plant is shown and can be turned.
//
// It reuses the game's own picture machinery, so things look the way they do
// in the game:
//   * materials        whatever the game's builders made (render/materials.js)
//   * small lights     neon and car lamps tint the floor (render/smallLights.js)
//   * reflections      car paint mirrors the studio (render/reflections.js)
//   * glow             the game's bloom dials (GRAPHICS in config.js)
// What it does NOT have is the game's film camera (render/postfx.js): no
// streaks, grain or lens distortion.
//
//   const viewer = createViewer(canvas);
//   viewer.show(object, { lamps, neons, car, marks, yaw })   put something on the floor
//   viewer.setNight(true)        studio lamps off: only the thing's own lights
//   viewer.lookFrom(parent, eye) sit at a point inside the object (the driver's seat)
//   viewer.orbit()               ...and back outside
//   viewer.onFrame = (dt, camera) => { ... }   called before every picture
//
// measureObject(object) (at the bottom) gives size and triangle count.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GRAPHICS } from '../config.js';
import { clamp, damp, lerp, smoothstep } from '../core/mathUtils.js';
import { canvasTexture, enhanceMaterial, makeAsphaltTexture, shared } from '../render/materials.js';
import { smallLights } from '../render/smallLights.js';
import { createCarProbe } from '../render/reflections.js';

const ORBIT_FOV = 34;            // a long lens: shapes are not distorted
const REAL_LAMPS = 4;            // like the game: only the first few lamps are real lights, the rest are "small lights"
// Brightness of the studio in its two moods: { sky light, main lamp, fill lamp, backdrop and reflections }.
// Kept modest on purpose — the game's surfaces are tuned for night and turn flat grey in bright light.
const STUDIO = { hemi: 1.3, key: 2.8, fill: 0.7, glow: 1 };
const NIGHT = { hemi: 0.1, key: 0.1, fill: 0, glow: 0.1 };

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;      // same film curve as the game
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.05, 2000);
  shared.headPower.value = 0;    // no player headlights here, so reflective paint and signs do not light up by themselves

  // ---- The studio: backdrop, floor, three lamps -------------------------------------
  // Backdrop: a big dome, dark overhead with a band of dim light at the horizon.
  const domeLevel = { value: 1 };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uLevel: domeLevel }, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uLevel; varying vec3 vDir;
      void main() {
        float up = normalize(vDir).y;
        vec3 horizon = vec3(0.09, 0.12, 0.18), zenith = vec3(0.008, 0.011, 0.02);
        vec3 colour = up > 0.0 ? mix(horizon, zenith, pow(up, 0.4)) : horizon * max(0.0, 1.0 + up * 10.0);   // black below the horizon
        gl_FragColor = vec4(colour * uLevel, 1.0);
      }`,
  }));
  // Floor: the game's asphalt. It fades to black toward its edge, so it has no visible end.
  const asphalt = makeAsphaltTexture();
  const floorGeometry = new THREE.PlaneGeometry(1, 1, 40, 40).rotateX(-Math.PI / 2);
  const fade = [];
  for (let i = 0; i < floorGeometry.attributes.position.count; i++) {
    const reach = Math.hypot(floorGeometry.attributes.position.getX(i), floorGeometry.attributes.position.getZ(i)) * 2;   // 0 centre, 1 edge
    const light = 1 - smoothstep(0.35, 0.95, reach);
    fade.push(light, light, light);
  }
  floorGeometry.setAttribute('color', new THREE.Float32BufferAttribute(fade, 3));
  const floor = new THREE.Mesh(floorGeometry, enhanceMaterial(new THREE.MeshStandardMaterial({ map: asphalt, color: 0xc8c8c8, roughness: 0.9, vertexColors: true }), { limit: 0.45 }));
  floor.receiveShadow = true;
  // Lamps: soft light from above, a main lamp that casts the shadow, a weaker one from the other side.
  const hemi = new THREE.HemisphereLight(0xc6d4ff, 0x202020, 1);
  const key = new THREE.DirectionalLight(0xfff3e0, 1), fill = new THREE.DirectionalLight(0x9db8ff, 1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
  // Soft boxes: big blurry lamps that exist only for the reflections in paint and glass.
  // They are switched on just while the reflection probe takes its picture (see frame()).
  const softTexture = canvasTexture(64, 64, (g, w, h) => {
    const blur = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    blur.addColorStop(0, '#fff'); blur.addColorStop(0.5, '#999'); blur.addColorStop(1, '#000');
    g.fillStyle = blur; g.fillRect(0, 0, w, h);
  }, { repeat: false });
  const softMaterial = new THREE.MeshBasicMaterial({ map: softTexture, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const softboxes = new THREE.Group();
  // Sizes and positions are for a subject of radius 1; show() scales the group to fit.
  for (const [x, y, z, w, h, turnX, turnY] of [[0, 2.6, 0, 4.5, 2.4, Math.PI / 2, 0], [-3.2, 1.3, 0, 6, 1.6, 0, Math.PI / 2], [3.2, 1.3, 0, 6, 1.6, 0, Math.PI / 2], [0, 1.5, 4, 5, 1.4, 0, 0]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), softMaterial);
    panel.position.set(x, y, z); panel.rotation.set(turnX, turnY, 0);
    softboxes.add(panel);
  }
  softboxes.visible = false;
  scene.add(dome, floor, hemi, key, key.target, fill, softboxes);

  // ---- Reflections and glow, with the game's own tools and dials ---------------------
  const probe = createCarProbe(renderer, scene);
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: GRAPHICS.msaaSamples });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(4, 4), GRAPHICS.bloomStrength, GRAPHICS.bloomRadius, GRAPHICS.bloomThreshold));
  composer.addPass(new OutputPass());

  // ---- What is on show ------------------------------------------------------------------
  let subject = null;            // { object, car, lamps, neons, marks, lights[] }
  const centre = new THREE.Vector3();
  const extent = new THREE.Vector3(2, 2, 2);   // its size: width (x), height (y), depth (z)
  let radius = 2;                // the subject fits in a ball of this size around `centre`
  let night = false, mood = 1;   // mood: 1 = studio lamps on, 0 = night (moves smoothly between the two)
  let marksOn = false;
  const view = { mode: 'orbit', yaw: 0, pitch: 0.3, distance: 8, target: new THREE.Vector3(), spin: true, eyeParent: null, eye: new THREE.Vector3() };

  const viewer = {
    renderer, scene, camera,
    onFrame: null,
    get night() { return night; },
    get marksOn() { return marksOn; },

    /**
     * Put `object` in the studio (it replaces what was there). Options, all optional:
     *   lamps  [{ at: Vector3, color, intensity, distance }]  its strong lamps (same shape as userData.lamps)
     *   neons  [{ at: Vector3, color, power }]                its coloured glow (userData.neons)
     *   car    a car from buildCar(): its lamps then tint the floor too
     *   marks  an Object3D of outlines (solid boxes, press-E circles) the user can switch on
     *   yaw    which side to look at first (radians; 0 = from +Z)
     *   keepView  true = leave the camera where it is (the same thing rebuilt with other options)
     */
    show(object, { lamps = [], neons = [], car = null, marks = null, yaw = -1.0, keepView = false } = {}) {
      keepView = keepView && !!subject;
      viewer.clear();
      subject = { object, car, lamps, neons, marks, lights: [] };
      scene.add(object);
      if (marks) { marks.visible = marksOn; scene.add(marks); }
      // The first few lamps become real lights, as in the game (main.js does the same with the nearest four).
      for (const lamp of lamps.slice(0, REAL_LAMPS)) {
        const light = new THREE.PointLight(lamp.color, lamp.intensity, lamp.distance, 1.8);
        light.position.copy(lamp.at);
        scene.add(light);
        subject.lights.push(light);
      }
      // Fit the studio and the camera to its size.
      const size = measureObject(object);
      centre.copy(size.centre);
      extent.copy(size.size);
      radius = Math.max(0.4, size.size.length() / 2);
      floor.scale.setScalar(Math.max(60, radius * 14));
      asphalt.repeat.setScalar(floor.scale.x / 5);            // the asphalt picture repeats every 5 m
      softboxes.scale.setScalar(radius);
      softboxes.position.set(centre.x, 0, centre.z);
      key.position.set(centre.x + radius * 1.4, centre.y + radius * 2.4, centre.z + radius * 1.8);
      key.target.position.copy(centre);
      fill.position.set(centre.x - radius * 2, centre.y + radius, centre.z - radius * 1.5);
      const shadow = key.shadow.camera;
      shadow.left = shadow.bottom = -radius * 1.5; shadow.right = shadow.top = radius * 1.5;
      shadow.near = radius * 0.2; shadow.far = radius * 8;
      shadow.updateProjectionMatrix();
      if (!keepView) Object.assign(view, { mode: 'orbit', yaw, pitch: 0.28, spin: true, distance: fitDistance() });
      view.target.copy(centre);
      viewer.onFrame = null;
      return size;
    },

    // Take the subject out and free what it kept on the graphics card.
    clear() {
      if (!subject) return;
      scene.remove(subject.object, ...subject.lights);
      if (subject.marks) scene.remove(subject.marks);
      disposeObject(subject.object);
      if (subject.marks) disposeObject(subject.marks);
      subject = null;
      viewer.onFrame = null;
    },

    setNight(on) { night = on; },
    setMarks(on) { marksOn = on; if (subject?.marks) subject.marks.visible = on; },

    // Sit at point `eye` (in `parent`'s own coordinates) and look around from there.
    lookFrom(parent, eye) { Object.assign(view, { mode: 'look', eyeParent: parent, yaw: 0, pitch: -0.06 }); view.eye.copy(eye); },
    orbit() { view.mode = 'orbit'; view.yaw = -1.0; view.pitch = 0.28; },
    // Set the camera by hand (used for screenshots): angles in radians, zoom 1 = the whole thing fits.
    pose(yaw, pitch = view.pitch, zoom = 1) { view.yaw = yaw; view.pitch = pitch; view.spin = false; if (view.mode === 'orbit') view.distance = fitDistance() / zoom; },
  };
  // How far back the camera must be for the whole subject to fit in the picture: far enough for
  // its height, and for its width (the diagonal of its footprint, since it can be turned any way).
  function fitDistance() {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(ORBIT_FOV) / 2), halfWidth = halfHeight * (canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const footprint = Math.hypot(extent.x, extent.z) / 2;
    return Math.max(extent.y / 2 / halfHeight, footprint / halfWidth) * 1.12 + footprint * 0.5;
  }

  // ---- Mouse: drag to turn, wheel to zoom ---------------------------------------------------
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (event) => { dragging = true; lastX = event.clientX; lastY = event.clientY; view.spin = false; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX, dy = event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY;
    if (view.mode === 'orbit') { view.yaw -= dx * 0.008; view.pitch = clamp(view.pitch + dy * 0.006, 0.02, 1.5); }
    else { view.yaw += dx * 0.004; view.pitch = clamp(view.pitch + dy * 0.004, -1.2, 1.2); }     // inside: drag the view like a photo
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (view.mode === 'orbit') view.distance = clamp(view.distance * Math.exp(event.deltaY * 0.001), radius * 0.4, radius * 9);
  }, { passive: false });

  function moveCamera(dt) {
    if (view.mode === 'look' && view.eyeParent) {
      view.eyeParent.updateWorldMatrix(true, false);
      camera.position.copy(view.eye).applyMatrix4(view.eyeParent.matrixWorld);
      camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
      camera.fov = GRAPHICS.fovCockpit; camera.near = 0.05;
    } else {
      if (view.spin) view.yaw += dt * 0.2;                   // turns slowly until you grab it
      const flat = Math.cos(view.pitch) * view.distance;
      camera.position.set(view.target.x + Math.sin(view.yaw) * flat, view.target.y + Math.sin(view.pitch) * view.distance, view.target.z + Math.cos(view.yaw) * flat);
      camera.lookAt(view.target);
      camera.fov = ORBIT_FOV; camera.near = Math.max(0.05, radius * 0.02);
    }
    camera.far = 1200;
    camera.updateProjectionMatrix();
  }

  // ---- One picture -----------------------------------------------------------------------------
  let width = 0, height = 0, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Follow the size of the canvas on the page. Hidden (a section without a 3D view): draw nothing.
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (w !== width || h !== height) {
      width = w; height = h;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
    }
    shared.time.value += dt;
    // Studio lamps fade between their two moods.
    mood = damp(mood, night ? 0 : 1, 6, dt);
    const level = (name) => lerp(NIGHT[name], STUDIO[name], mood);
    hemi.intensity = level('hemi'); key.intensity = level('key'); fill.intensity = level('fill');
    domeLevel.value = level('glow');
    softMaterial.color.setScalar(level('glow') * 7);

    moveCamera(dt);
    if (viewer.onFrame) viewer.onFrame(dt, camera);

    // Tell the game's "small lights" what glows here: they tint the floor and the thing itself.
    smallLights.begin();
    if (subject) {
      subject.lamps.forEach((lamp, i) => smallLights.add(lamp.at.x, lamp.at.y, lamp.at.z, lamp.color, lamp.intensity * (i < REAL_LAMPS ? 0.12 : 0.6), camera));
      for (const neon of subject.neons) smallLights.add(neon.at.x, neon.at.y, neon.at.z, neon.color, neon.power, camera);
      subject.car?.addSmallLights(camera, 1);
    }
    smallLights.finish();

    // Reflections: one side of the probe's cube per picture, with the soft boxes lit and the subject out of the way.
    softboxes.visible = true;
    probe.update(centre, subject ? [subject.object, subject.marks].filter(Boolean) : []);
    softboxes.visible = false;
    composer.render(dt);
  }
  requestAnimationFrame(frame);
  return viewer;
}

// ---------------------------------------------------------------------------
// Size and triangle count of anything the game built.
// Returns { size: Vector3 (x, y, z in metres), centre: Vector3, triangles, meshes }.
// Light effects — beams of lit air, flares, the dark blob under a car — are not
// part of the thing itself and are left out.
// ---------------------------------------------------------------------------
const isEffect = (material) => material.blending === THREE.AdditiveBlending || (material.transparent && material.depthWrite === false);

export function measureObject(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3(), point = new THREE.Vector3();
  let triangles = 0, meshes = 0;
  object.traverseVisible((node) => {
    if (!node.isMesh || [].concat(node.material).every(isEffect)) return;
    const positions = node.geometry.attributes.position;
    triangles += (node.geometry.index ? node.geometry.index.count : positions.count) / 3;
    meshes++;
    for (let i = 0; i < positions.count; i++) box.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld));
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  return { size: box.getSize(new THREE.Vector3()), centre: box.getCenter(new THREE.Vector3()), triangles: Math.round(triangles), meshes };
}

// What glows by itself? Looks at every material of the object.
// Returns { strongest: the highest emissive brightness found (0 = nothing glows), count: how many parts glow }.
export function measureGlow(object) {
  let strongest = 0, count = 0;
  object.traverse((node) => {
    for (const material of [].concat(node.material || [])) {
      const lit = material.emissive && material.emissive.getHex() !== 0 ? material.emissiveIntensity : 0;
      if (lit > 0) { count++; strongest = Math.max(strongest, lit); }
    }
  });
  return { strongest, count };
}

// Free the graphics-card memory of something that is no longer shown: its shapes and the
// pictures drawn for it (sign texts, number plates). Things the game shares between objects
// are simply sent to the graphics card again the next time they are needed.
function disposeObject(object) {
  object.traverse((node) => {
    node.geometry?.dispose();
    for (const material of [].concat(node.material || [])) {
      for (const texture of [material.map, material.emissiveMap]) if (texture?.isCanvasTexture) texture.dispose();
    }
  });
}
