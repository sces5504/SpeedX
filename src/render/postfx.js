// ---------------------------------------------------------------------------
// postfx.js — the "camera" look. The 3D scene is drawn to an off-screen image,
// then processed like footage from a wide-angle dash cam:
//
//   scene -> bloom (lamps glow) -> tone mapping (HDR to screen) -> dash cam pass
//
// The dash cam pass adds, in order:
//   lens      barrel (fisheye) distortion and colour fringes
//   rain      drops and running streaks on the glass that bend the picture,
//             a misty film, and the arc the wiper has just cleared
//   speed     motion blur that streaks the edges of the picture
//   crash     after a big hit: white flash, blur, double vision, colour drains
//             away and the edges go dark, then it all slowly comes back
//   grade     greenish night-sensor tint, vignette, film grain
//
// Exposure: a real camera darkens the whole picture when bright headlights
// shine into it, then slowly recovers. The `glare` value drives that.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FEEL, GRAPHICS } from '../config.js';
import { damp } from '../core/mathUtils.js';

const DashCamShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1.7 },
    uDistortion: { value: GRAPHICS.lensDistortion }, uGrain: { value: GRAPHICS.grain },
    uRain: { value: 0 },        // 0..1 how wet the glass is
    uInside: { value: 0 },      // 1 in cockpit view (windscreen: wipers, drops pushed up by the wind)
    uWiper: { value: 0 },       // 0..1 position in the wiper's back-and-forth cycle
    uSpeed: { value: 0 },       // 0..1 for motion blur and wind on the drops
    uImpact: { value: 0 },      // 0..1 short blur right at a hit
    uTrauma: { value: 0 },      // 0..1 the long "dazed" effect after a big crash
    uFlash: { value: 0 },       // 0..1 white flash at the moment of a big crash
    uGlare: { value: 0 },       // 0..1 veiling haze from oncoming lights
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uDistortion, uGrain, uRain, uInside, uWiper, uSpeed, uImpact, uTrauma, uFlash, uGlare;
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

      // 5. glare haze: bright lamps in your face wash out the shadows
      col = mix(col, vec3(0.6, 0.66, 0.72), uGlare * 0.10 * (1.0 - r2));

      // 6. night-sensor colour: lifted green-teal shadows, slightly crushed colour
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, 0.88);
      col *= vec3(0.955, 1.03, 0.94);
      col += vec3(0.004, 0.016, 0.009) * (1.0 - smoothstep(0.0, 0.5, luma));
      col = (col - 0.5) * 1.06 + 0.5;

      // 7. vignette (tighter at speed: tunnel vision) and grain
      col *= 1.0 - (0.5 + uSpeed * 0.38) * smoothstep(0.08 - uSpeed * 0.04, 0.95 - uSpeed * 0.25, r2);
      float grain = hash4(vUv * 913.0 + fract(uTime) * 71.0).x - 0.5;
      col += grain * uGrain * (1.15 - luma);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPostFx(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: GRAPHICS.msaaSamples });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), GRAPHICS.bloomStrength, GRAPHICS.bloomRadius, GRAPHICS.bloomThreshold);
  const dashCam = new ShaderPass(DashCamShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(dashCam);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const u = dashCam.uniforms;
  let exposure = 1, glareNow = 0, impact = 0, trauma = 0, flash = 0;

  const fx = {
    composer, uniforms: u,
    get trauma() { return trauma; },      // audio.js muffles the sound with this
    resize(width, height) {
      composer.setSize(width, height);
      u.uAspect.value = width / height;
    },
    // Any hit: a short blur. strength 0..1
    punch(strength) { impact = Math.max(impact, strength); },
    // A BIG hit: flash, then the long dazed effect. strength 0..1
    crash(strength) {
      trauma = Math.max(trauma, strength * FEEL.crashFx);
      flash = Math.max(flash, strength * 0.9 * FEEL.crashFx);
    },
    /**
     * @param glare        0..1+ how much light oncoming lamps throw at the camera
     * @param baseExposure brightness of the current time-of-night preset
     * @param rain         0..1 wetness of the glass      @param wiper 0..1 wiper cycle position
     * @param speed        0..1 for motion blur
     */
    render(dt, { glare, baseExposure, rain, inside, wiper, speed }) {
      // Eyes/cameras close down fast when dazzled and open up slowly afterwards.
      glareNow = damp(glareNow, glare, glare > glareNow ? 9 : 1.4, dt);
      exposure = baseExposure / (1 + glareNow * 1.2);
      renderer.toneMappingExposure = exposure * (1 - trauma * 0.35);
      impact = damp(impact, 0, 4.5, dt);
      trauma = Math.max(0, trauma - dt / 3.2);            // about three seconds to recover fully
      flash = damp(flash, 0, 9, dt);
      u.uTime.value += dt;
      u.uGlare.value = Math.min(1, glareNow);
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
