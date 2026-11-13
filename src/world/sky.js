// ---------------------------------------------------------------------------
// sky.js — it is always night in SpeedX, but the night moves on: dusk afterglow
// -> midnight -> full moon -> before dawn -> and round again. Each stage
// ("preset") sets the sky colours, the stars, the fog and the faint light that
// lets you see the outline of the mountains; the sky blends slowly from one to
// the next while you drive. NIGHT.stageSeconds in config.js sets the pace.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS, NIGHT } from '../config.js';

// glowDir is where the bright part of the horizon is (x = east, z = south).
export const NIGHT_PRESETS = [
  { name: 'Dusk afterglow', zenith: 0x0a1026, horizon: 0x33243a, glow: 0xe0611e, glowDir: [-0.9, 0, 0.35], glowPower: 1.5,
    stars: 0.35, fog: 0x0a0b12, fogDensity: 0.0016, ambient: 0.20, ambientColor: 0x54608a, moon: 0.10, moonColor: 0xff9a66, exposure: 1.0 },
  { name: 'Midnight', zenith: 0x02040a, horizon: 0x0a0c14, glow: 0x7a4418, glowDir: [0.1, 0, 1], glowPower: 0.35,
    stars: 1.0, fog: 0x04050a, fogDensity: 0.0020, ambient: 0.07, ambientColor: 0x3a4666, moon: 0.03, moonColor: 0x8fa8ff, exposure: 1.1 },
  { name: 'Full moon', zenith: 0x08122a, horizon: 0x15233f, glow: 0x9db4e8, glowDir: [0.5, 0.75, -0.4], glowPower: 0.5,
    stars: 0.5, fog: 0x0a1222, fogDensity: 0.0013, ambient: 0.16, ambientColor: 0x5a78b8, moon: 0.42, moonColor: 0xa9c2ff, exposure: 1.0 },
  { name: 'Before dawn', zenith: 0x070c1c, horizon: 0x1c2a40, glow: 0x4f9bb0, glowDir: [0.95, 0, -0.2], glowPower: 0.85,
    stars: 0.25, fog: 0x0b111b, fogDensity: 0.0019, ambient: 0.22, ambientColor: 0x5c7c96, moon: 0.08, moonColor: 0x9fd0e0, exposure: 1.0 },
];

export function createSky(scene, renderer) {
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uGlowDir: { value: new THREE.Vector3() }, uGlowPower: { value: 1 }, uStars: { value: 1 }, uOvercast: { value: 0 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(GRAPHICS.viewDistance * 0.95, 32, 16), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uGlow, uGlowDir; uniform float uGlowPower, uStars, uOvercast; varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.45));
        // glow on one side of the horizon (afterglow, city lights, or the moon's halo)
        vec3 g = normalize(uGlowDir);
        float toward = max(dot(d, g), 0.0);
        float low = g.y > 0.3 ? 1.0 : exp(-up * 7.0);
        float wide = 0.5 + 0.5 * dot(d, g);                        // the whole sky leans toward the glow side
        col += uGlow * uGlowPower * ((pow(toward, 4.0) * 0.5 + wide * wide * 0.16) * low + pow(toward, 600.0) * (g.y > 0.3 ? 14.0 : 0.0));
        // stars: one random point per little cell of the sky
        vec3 cell = floor(d * 260.0);
        float star = step(0.9975, hash(cell)) * smoothstep(0.02, 0.3, d.y);
        col += vec3(0.85, 0.9, 1.0) * star * hash(cell + 1.0) * uStars * (1.0 - uOvercast);
        col = mix(col, uHorizon * 0.8 + 0.01, uOvercast * 0.75);    // rain clouds flatten everything
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x080808, 0.2);
  const moon = new THREE.DirectionalLight(0xffffff, 0.2);
  scene.add(ambient, moon, moon.target);
  scene.fog = new THREE.FogExp2(0x000000, 0.002);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const colorA = new THREE.Color(), colorB = new THREE.Color(), dirA = new THREE.Vector3(), dirB = new THREE.Vector3();
  const mix = (a, b, t) => a + (b - a) * t;
  const mixColor = (target, a, b, t) => target.copy(colorA.set(a)).lerp(colorB.set(b), t);
  let envAge = 99;

  // Show a blend of preset `a` and preset `b` (t = 0 all a, 1 all b).
  function apply(a, b, t) {
    mixColor(uniforms.uZenith.value, a.zenith, b.zenith, t);
    mixColor(uniforms.uHorizon.value, a.horizon, b.horizon, t);
    mixColor(uniforms.uGlow.value, a.glow, b.glow, t);
    // The bright side of the sky fades out in one place and in at the next (it does not sweep across).
    const glowA = a.glowPower * Math.max(0, 1 - t * 2), glowB = b.glowPower * Math.max(0, t * 2 - 1);
    uniforms.uGlowDir.value.copy(t < 0.5 ? dirA.set(...a.glowDir) : dirB.set(...b.glowDir));
    uniforms.uGlowPower.value = a === b ? a.glowPower : glowA + glowB;
    uniforms.uStars.value = mix(a.stars, b.stars, t);
    mixColor(ambient.color, a.ambientColor, b.ambientColor, t); ambient.intensity = mix(a.ambient, b.ambient, t) * 1.3;
    mixColor(moon.color, a.moonColor, b.moonColor, t); moon.intensity = mix(a.moon, b.moon, t) * 2;
    mixColor(scene.fog.color, a.fog, b.fog, t);
    sky.fogDensity = mix(a.fogDensity, b.fogDensity, t);
    sky.exposure = mix(a.exposure, b.exposure, t);
    sky.glowDir = t < 0.5 ? a.glowDir : b.glowDir;
  }
  // Shiny things (car paint, wet road) reflect a blurred copy of the sky. Re-making it is
  // slow, so while the sky is changing it is only refreshed every few seconds.
  function refreshReflections() {
    const envScene = new THREE.Scene();
    const copy = dome.clone(); copy.position.set(0, 0, 0);
    envScene.add(copy);
    scene.environment?.dispose();
    scene.environment = pmrem.fromScene(envScene, 0.04, 1, GRAPHICS.viewDistance * 2).texture;
    scene.environmentIntensity = 0.6;
    envAge = 0;
  }

  const sky = {
    index: 0, preset: NIGHT_PRESETS[0], dome, uniforms,
    clock: 0,              // seconds spent in the current stage
    fogDensity: 0.002, exposure: 1, glowDir: NIGHT_PRESETS[0].glowDir,
    // Jump straight to a stage (the pause menu's NIGHT button).
    setPreset(index) {
      const p = NIGHT_PRESETS[(index + NIGHT_PRESETS.length) % NIGHT_PRESETS.length];
      sky.index = NIGHT_PRESETS.indexOf(p); sky.preset = p; sky.clock = 0;
      apply(p, p, 0);
      refreshReflections();
    },
    // Keep the dome centred on the camera so you can never drive out of it, and let time pass.
    update(camera, rainAmount, dt = 0) {
      sky.clock += dt;
      const next = NIGHT_PRESETS[(sky.index + 1) % NIGHT_PRESETS.length];
      const blendStart = NIGHT.stageSeconds - NIGHT.blendSeconds;
      if (sky.clock >= NIGHT.stageSeconds) {                     // the next stage has fully arrived
        sky.index = NIGHT_PRESETS.indexOf(next); sky.preset = next; sky.clock = 0;
        apply(next, next, 0); refreshReflections();
      } else if (sky.clock > blendStart) {
        const t = (sky.clock - blendStart) / NIGHT.blendSeconds;
        apply(sky.preset, next, t * t * (3 - 2 * t));
        envAge += dt;
        if (envAge > 6) refreshReflections();
      }
      dome.position.copy(camera.position);
      uniforms.uOvercast.value = rainAmount;
      const g = sky.glowDir;
      moon.position.copy(camera.position).add(new THREE.Vector3(g[0], Math.max(g[1], 0.25), g[2]).multiplyScalar(500));
      moon.target.position.copy(camera.position);
      scene.fog.density = sky.fogDensity * (1 + rainAmount * 1.6);
    },
  };
  sky.setPreset(0);
  return sky;
}
