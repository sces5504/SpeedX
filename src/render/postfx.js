// ---------------------------------------------------------------------------
// postfx.js — the "camera" look. The 3D scene is drawn to an off-screen image,
// then processed like footage from a film camera with a wide-angle lens:
//
//   scene -> remember -> streak -> bloom -> tone mapping -> lens pass (-> filter)
//
//   remember      keeps a copy of the picture and how far away every pixel is;
//                 next frame, wet roads mirror it (see materials.js)
//   streak        long horizontal lines of light from every lamp (streak.js)
//   bloom         bright things glow
//   tone mapping  squeezes the huge range of real light (HDR) onto a screen
//
// (filter: an optional extra look chosen in the pause menu - filters.js. Off = not there at all.)
//
// The lens pass then adds, in order:
//   lens      barrel (fisheye) distortion and colour fringes
//   rain      drops and running streaks on the glass that bend the picture,
//             a misty film, and the arc the wiper has just cleared
//   speed     motion blur that streaks the edges of the picture
//   crash     after a big hit: white flash, blur, double vision, colour drains
//             away and the edges go dark, then it all slowly comes back
//   grade     cinema colour: cool teal shadows, warm highlights, deeper
//             contrast, dark corners (vignette) and film grain
//
// Dazzle: when headlights shine into the camera a white-hot ball of light
// swamps the lens around each lamp, with a wide warm halo; everything blooms and
// streaks more, and the "eye" closes down so the rest of the picture goes dark,
// then slowly recovers. Up to three cars can dazzle at once, each with its own
// light on the screen that fades in and out where that car is (so the light
// never slides from one car to another); main.js lists them. GRAPHICS.glare
// scales the whole effect.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FEEL, GRAPHICS } from '../config.js';
import { damp } from '../core/mathUtils.js';
import { shared } from './materials.js';
import { StreakPass } from './streak.js';
import { FILTERS, filterShader, findFilter } from './filters.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const DAZZLERS = 3;      // how many cars can dazzle the camera at the same time

const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1.7 },
    uDistortion: { value: GRAPHICS.lensDistortion }, uGrain: { value: GRAPHICS.grain },
    uSaturation: { value: GRAPHICS.saturation }, uContrast: { value: GRAPHICS.contrast },
    uGrade: { value: 1 },       // 1 = apply the cinema colours (step 6), 0 = leave the colours to a filter
    uRain: { value: 0 },        // 0..1 how wet the glass is
    uInside: { value: 0 },      // 1 in cockpit view (windscreen: wipers, drops pushed up by the wind)
    uWiper: { value: 0 },       // 0..1 position in the wiper's back-and-forth cycle
    uSpeed: { value: 0 },       // 0..1 for motion blur and wind on the drops
    uImpact: { value: 0 },      // 0..1 short blur right at a hit
    uTrauma: { value: 0 },      // 0..1 the long "dazed" effect after a big crash
    uFlash: { value: 0 },       // 0..1 white flash at the moment of a big crash
    uGlare: { value: 0 },       // 0..2 how dazzled the camera is, all cars together
    uGlarePower: { value: new Array(DAZZLERS).fill(0) },                                             // ...and by each car
    uGlareAt: { value: Array.from({ length: DAZZLERS }, () => new THREE.Vector4(0.5, 0.5, 0.5, 0.5)) },   // where that car's two lamps are on the screen (x, y, x, y in 0..1)
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uDistortion, uGrain, uSaturation, uContrast, uRain, uInside, uWiper, uSpeed, uImpact, uTrauma, uFlash, uGlare, uGrade;
    #define DAZZLERS ${DAZZLERS}
    uniform float uGlarePower[DAZZLERS];
    uniform vec4 uGlareAt[DAZZLERS];
    varying vec2 vUv;

    vec4 hash4(vec2 p) {
      vec4 q = vec4(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)), dot(p, vec2(97.3, 157.1)));
      return fract(sin(q) * 43758.5453);
    }

    // Small drops that sit still, appear, and dry out. Returns xy = bend, z = mask.
    vec3 beadLayer(vec2 uv, float cells, float amount) {
      vec2 p = uv * vec2(uAspect, 1.0) * cells;
      vec2 id = floor(p), f = fract(p) - 0.5;
      vec4 rnd = hash4(id);
      float life = fract(uTime * (0.05 + rnd.y * 0.07) + rnd.z);
      float radius = (0.08 + 0.2 * rnd.y) * smoothstep(1.0, 0.7, life) * smoothstep(0.0, 0.04, life);
      vec2 delta = f - (rnd.zw - 0.5) * 0.6;
      float mask = smoothstep(radius, radius * 0.45, length(delta)) * step(rnd.x, amount);
      return vec3(delta * mask * 2.6, mask);
    }

    // Big drops that run across the glass leaving a wet trail behind them.
    // dir = +1 they run down (camera lens), -1 they are blown up the windscreen.
    vec3 runLayer(vec2 uv, float columns, float speed, float dir, float amount) {
      vec2 p = uv * vec2(uAspect, 1.0) * vec2(columns, columns * 0.22);      // tall, narrow cells
      float column = floor(p.x);
      float h = fract(sin(column * 91.7) * 4375.5);
      p.y += dir * uTime * speed * (0.5 + h) + h * 9.0;                      // every column at its own pace
      vec2 id = floor(p), f = fract(p);
      vec4 rnd = hash4(id + column);
      float alive = step(rnd.x, amount);
      float wobble = sin(p.y * 5.0 + rnd.z * 6.28) * 0.09;                   // drops never run straight
      vec2 head = vec2(0.5 + (rnd.y - 0.5) * 0.4 + wobble, 0.5);
      vec2 delta = (f - head) * vec2(1.0, 4.5);
      float drop = smoothstep(0.26, 0.08, length(delta));
      float behind = (f.y - head.y) * dir;                                   // > 0 on the side it came from
      float trail = smoothstep(0.07, 0.0, abs(f.x - head.x)) * smoothstep(0.0, 0.06, behind) * smoothstep(0.5, 0.08, behind);
      float mask = max(drop, trail * 0.6) * alive;
      return vec3(vec2(f.x - head.x, delta.y * 0.25) * mask * 3.0, mask);
    }

    void main() {
      // 1. wide-angle lens: push pixels outward more the further they are from the centre
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
      vec2 uv = 0.5 + c * (1.0 + uDistortion * r2) / (1.0 + uDistortion * 0.42);
      vec2 sceneUv = uv;                                       // which point of the 3D picture this pixel shows

      // 2. water on the glass
      float mist = 0.0, wet = 0.0;
      if (uRain > 0.001) {
        // Wiper: sweeps left to right in the first half of its cycle and back in the second.
        // "since" = how long ago (in cycles) the blade last passed this part of the glass.
        float since = min(fract(uWiper - uv.x * 0.5), fract(uWiper - 1.0 + uv.x * 0.5));
        float rebuilt = mix(1.0, smoothstep(0.0, 0.85, since), uInside);     // drops build up again behind the blade
        float amount = uRain * rebuilt;
        float dir = mix(1.0, -1.0, uInside * smoothstep(0.25, 0.6, uSpeed)); // fast: airflow pushes drops upward
        vec3 drops = beadLayer(uv, 26.0, amount * 0.75) * 0.7 + beadLayer(uv + 5.3, 12.0, amount * 0.5);
        drops += runLayer(uv, 9.0, 0.35 + uSpeed * 0.9, dir, amount * 0.55);
        drops += runLayer(uv + 2.7, 16.0, 0.5 + uSpeed * 1.2, dir, amount * 0.45) * 0.7;
        uv -= drops.xy * 0.05;                                               // each drop is a tiny lens
        wet = min(1.0, drops.z);
        mist = amount * 0.5 * (1.0 - wet);                                   // thin film of water between the drops
      }

      // 3. sample the picture: colour fringes + motion blur toward the centre
      vec2 dir2 = uv - 0.5;
      float edge = smoothstep(0.015, 0.4, r2);                              // only the very centre stays sharp
      float blur = (uSpeed * 0.05 + uSpeed * uSpeed * 0.11) * edge + uImpact * 0.07 + uTrauma * 0.035 + mist * 0.012;
      vec2 fringe = c * (0.0025 + uSpeed * uSpeed * 0.006 + uImpact * 0.02 + uTrauma * 0.012) * (0.4 + r2 * 2.0);   // colours split at speed
      vec3 col = vec3(0.0);
      for (int i = 0; i < 13; i++) {
        vec2 at = uv - dir2 * blur * (float(i) / 12.0);
        col += vec3(texture2D(tDiffuse, at + fringe).r, texture2D(tDiffuse, at).g, texture2D(tDiffuse, at - fringe).b);
      }
      col /= 13.0;
      col += wet * 0.03 + mist * 0.02;                                       // water catches a little light

      // 4. crash: double vision, then drain the colour and close in the edges
      if (uTrauma > 0.01) {
        vec2 sway = vec2(sin(uTime * 2.3), cos(uTime * 1.7)) * 0.022 * uTrauma;
        col = mix(col, texture2D(tDiffuse, uv + sway).rgb, 0.45 * uTrauma);
        float grey = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(grey) * vec3(0.9, 0.97, 1.05), uTrauma * 0.9);
        float pulse = 0.85 + 0.15 * sin(uTime * 7.0);                        // throbbing, like a heartbeat
        col *= 1.0 - uTrauma * pulse * smoothstep(0.02, 0.5, r2) * 1.25;
      }
      col += uFlash;

      // 5. dazzle: headlights aimed at you swamp the lens. Every car that dazzles has its own
      //    light, drawn where its two lamps are: round EACH lamp a white-hot core that fades out
      //    a long way (bigger the harder that car dazzles), a line of light sideways through
      //    them like the streak filter draws, and a wide warm halo. All of them together add a
      //    thin veil over everything. (sceneUv: the lamps are measured before the lens bends the picture.)
      if (uGlare > 0.003) {
        vec2 wide = vec2(uAspect * 0.75, 1.0);                                            // the glow is a little wider than tall
        vec3 light = vec3(1.0, 0.95, 0.86) * uGlare * 0.015;
        for (int i = 0; i < DAZZLERS; i++) {
          float power = uGlarePower[i];
          if (power < 0.003) continue;
          vec4 lamps = uGlareAt[i];
          vec2 fromA = (sceneUv - lamps.xy) * wide, fromB = (sceneUv - lamps.zw) * wide;
          vec2 fromMiddle = (sceneUv - (lamps.xy + lamps.zw) * 0.5) * vec2(uAspect, 1.0);
          float size = 0.0013 + 0.0038 * power;
          // (power 1.5: the core is small and the light falls away gradually, with no hard edge)
          float balls = 1.0 / pow(1.0 + dot(fromA, fromA) / size, 1.5) + 1.0 / pow(1.0 + dot(fromB, fromB) / size, 1.5);
          float halo = exp(-dot(fromMiddle, fromMiddle) / 0.16);
          float line = exp(-fromMiddle.y * fromMiddle.y / 0.0005) * exp(-fromMiddle.x * fromMiddle.x / 0.4);
          light += vec3(1.0, 0.94, 0.84) * power * (balls * 0.55 + halo * 0.16) + vec3(0.7, 0.82, 1.0) * power * line * 0.2;
        }
        light = min(light, vec3(1.0));
        col = 1.0 - (1.0 - min(col, vec3(1.0))) * (1.0 - light);     // added the way light adds on film: it can reach white, never go past it
      }

      // 6. cinema colour: richer colour, cool teal shadows, warm highlights, deeper contrast
      //    (skipped while a filter that brings its own colours is on - see filters.js)
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      if (uGrade > 0.5) {
        col = mix(vec3(luma), col, uSaturation);
        col *= mix(vec3(0.86, 1.0, 1.16), vec3(1.07, 1.0, 0.92), smoothstep(0.03, 0.6, luma));
        col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);                 // S-curve: darker darks, brighter brights
        col += vec3(0.002, 0.007, 0.012) * (1.0 - smoothstep(0.0, 0.35, luma));   // blacks are never quite black on film
      }

      // 7. vignette (tighter at speed: tunnel vision) and grain
      col *= 1.0 - (0.5 + uSpeed * 0.38) * smoothstep(0.08 - uSpeed * 0.04, 0.95 - uSpeed * 0.25, r2);
      float grain = hash4(vUv * 913.0 + fract(uTime) * 71.0).x - 0.5;
      col += grain * uGrain * (1.15 - luma);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// Keeps a half-size copy of the finished 3D picture for the wet-road mirror:
// rgb = colour, a = distance from the camera in metres. Blurry smaller versions
// (mipmaps) are made automatically; rough surfaces reflect those.
class RememberPass extends Pass {
  constructor(camera) {
    super();
    this.needsSwap = false;                    // the picture itself is passed on untouched
    this.camera = camera;
    this.history = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        #include <packing>
        uniform sampler2D tDiffuse, tDepth; uniform float uNear, uFar; varying vec2 vUv;
        void main() {
          float distance = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNear, uFar);
          gl_FragColor = vec4(min(texture2D(tDiffuse, vUv).rgb, vec3(60.0)), distance);
        }`,
    }));
  }
  setSize(width, height) { this.history.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1)); }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.quad.material.uniforms;
    u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.history);
    this.quad.render(renderer);
    shared.history.value = this.history.texture;
    shared.prevViewProj.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
  }
}

export function createPostFx(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: GRAPHICS.msaaSamples });
  target.depthTexture = new THREE.DepthTexture(target.width, target.height);       // the remember pass reads distances from this
  const composer = new EffectComposer(renderer, target);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), GRAPHICS.bloomStrength, GRAPHICS.bloomRadius, GRAPHICS.bloomThreshold);
  const streak = new StreakPass(GRAPHICS.streakTint);
  const lens = new ShaderPass(LensShader);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new RememberPass(camera));
  composer.addPass(streak);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(lens);
  // One more pass per filter, after everything else; all switched off until one is chosen.
  const filterPasses = new Map();
  for (const filter of FILTERS) {
    if (!filter.glsl) continue;
    const pass = new ShaderPass(filterShader(filter));
    pass.enabled = false;
    composer.addPass(pass);
    filterPasses.set(filter.id, pass);
  }
  let filter = FILTERS[0];
  // A camera dial (bloom, streak, grain...): the filter's own value if it has one, otherwise config.js.
  const dial = (name) => filter.camera?.[name] ?? GRAPHICS[name];

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const u = lens.uniforms;
  let exposure = 1, glareNow = 0, impact = 0, trauma = 0, flash = 0;
  // One slot per dazzling car: which car (id), and how strong its light is on the screen right now.
  const slots = Array.from({ length: DAZZLERS }, () => ({ id: null, power: 0 }));

  const fx = {
    composer, uniforms: u,
    get trauma() { return trauma; },      // audio.js muffles the sound with this
    resize(width, height) {
      composer.setSize(width, height);
      u.uAspect.value = width / height;
      for (const pass of filterPasses.values()) pass.uniforms.uAspect.value = width / height;
    },
    // The filter that is on ('off' = none). Choose one by its id in filters.js.
    get filter() { return filter; },
    setFilter(id) {
      filter = findFilter(id);
      for (const [filterId, pass] of filterPasses) pass.enabled = filterId === filter.id;
      u.uGrade.value = filter.ownColours ? 0 : 1;
    },
    // Any hit: a short blur. strength 0..1
    punch(strength) { impact = Math.max(impact, strength); },
    // A BIG hit: flash, then the long dazed effect. strength 0..1
    crash(strength) {
      trauma = Math.max(trauma, strength * FEEL.crashFx);
      flash = Math.max(flash, strength * 0.9 * FEEL.crashFx);
    },
    /**
     * @param dazzlers     the cars dazzling the camera right now, strongest first:
     *                     [{ id, power: 0..2, at: [x, y, x, y] }]  (id = anything that stays the same for
     *                     that car; at = where its two lamps are on the screen, 0..1)
     * @param baseExposure brightness of the current time-of-night preset
     * @param rain         0..1 wetness of the glass      @param wiper 0..1 wiper cycle position
     * @param speed        0..1 for motion blur
     */
    render(dt, { dazzlers = [], baseExposure, rain, inside, wiper, speed }) {
      // Dazzle arrives at once: everything blooms and streaks. The eye then closes down
      // (a little slower, so there is a moment of white-out) and opens up slowly afterwards.
      // Each dazzling car keeps its own slot for as long as it dazzles. Its light arrives at
      // once, follows the car, and when the car stops dazzling fades out WHERE IT IS - it is
      // never handed to another car. A new car takes an empty slot (or the faintest one).
      const wanted = slots.map(() => 0);
      for (const source of dazzlers) {
        let k = slots.findIndex((slot) => slot.id === source.id);
        if (k < 0) {
          k = slots.reduce((faintest, slot, i) => (slot.power < slots[faintest].power ? i : faintest), 0);
          if (slots[k].power > 0.05 && slots[k].power > source.power) continue;      // all slots busy with stronger lights
          slots[k].id = source.id; slots[k].power = Math.min(slots[k].power, 0.02);
        }
        wanted[k] = Math.min(source.power, 2) * GRAPHICS.glare;
        u.uGlareAt.value[k].fromArray(source.at);
      }
      let glare = 0, dazzle = 0;
      slots.forEach((slot, k) => {
        slot.power = damp(slot.power, wanted[k], wanted[k] > slot.power ? 14 : 2.5, dt);
        if (wanted[k] === 0 && slot.power < 0.005) slot.id = null;
        u.uGlarePower.value[k] = slot.power;
        glare += wanted[k]; dazzle += slot.power;
      });
      glare = Math.min(glare, 2); dazzle = Math.min(dazzle, 2);
      glareNow = damp(glareNow, glare, glare > glareNow ? 4 : 1.4, dt);
      exposure = baseExposure / (1 + glareNow * 0.9);
      bloom.strength = dial('bloomStrength') * (1 + dazzle * 0.15);
      bloom.radius = dial('bloomRadius'); bloom.threshold = dial('bloomThreshold');
      streak.strength = dial('streak') * (1 + dazzle * 0.4);
      streak.enabled = streak.strength > 0;
      u.uDistortion.value = dial('lensDistortion'); u.uGrain.value = dial('grain');
      const filterPass = filterPasses.get(filter.id);
      if (filterPass) filterPass.uniforms.uTime.value = u.uTime.value;
      renderer.toneMappingExposure = exposure * (1 - trauma * 0.35);
      impact = damp(impact, 0, 4.5, dt);
      trauma = Math.max(0, trauma - dt / 3.2);            // about three seconds to recover fully
      flash = damp(flash, 0, 9, dt);
      u.uTime.value += dt;
      u.uGlare.value = dazzle;
      u.uImpact.value = impact;
      u.uTrauma.value = trauma * trauma * (3 - 2 * trauma);
      u.uFlash.value = flash;
      u.uRain.value = rain;
      u.uInside.value = inside ? 1 : 0;
      u.uWiper.value = wiper;
      u.uSpeed.value = speed * FEEL.motionBlur;
      composer.render(dt);
    },
  };
  return fx;
}
