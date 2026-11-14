// ---------------------------------------------------------------------------
// materials.js — shared textures and the shader upgrades that give the game
// its night look. enhanceMaterial() adds them to a normal Three.js material:
//
//  * small lights   (always) tail lamps, neon and oncoming headlights tint
//                   whatever is near them — see smallLights.js.
//  * retroreflection: road signs, lane paint and reflectors bounce your own
//                   headlights straight back at you, so they glow from far away.
//  * wetness:       asphalt gets darker and shiny, puddles form, rain makes
//                   rings on the water, and the surface MIRRORS the scene:
//                   for every wet pixel we follow the reflected ray through
//                   last frame's picture until it hits something
//                   ("screen-space reflection").
//  * limit:         (optional) the brightest the surface may get. Stops a car
//                   right in front of your headlights turning into a white
//                   blob, and keeps road reflections below the brightness at
//                   which lamps bloom and the streak filter kicks in.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeRandom } from '../core/mathUtils.js';
import { MAX_SMALL_LIGHTS, SMALL_LIGHTS_GLSL, smallLights } from './smallLights.js';

// One set of values shared by every enhanced material. Change them once here
// (e.g. shared.wet.value = 1) and every material follows.
export const shared = {
  wet: { value: 0 },                               // 0 = dry, 1 = soaked
  rain: { value: 0 },                              // 0..1 how hard it is raining right now (rings on puddles)
  haze: { value: 0.15 },                           // 0..1 how much the air shows up in light beams (mist, rain)
  time: { value: 0 },                              // seconds, for anything that animates
  headPos: { value: new THREE.Vector3() },         // player's headlights position
  headDir: { value: new THREE.Vector3(0, 0, -1) }, // ...and direction
  headPower: { value: 1 },                         // 0 off, 1 low beam, 2+ high beam
  // Last frame's picture (rgb = colour, a = distance from the camera in metres) and the
  // camera it was taken with. postfx.js keeps these up to date; wet surfaces mirror them.
  history: { value: emptyHistory() },
  prevViewProj: { value: new THREE.Matrix4() },
};
function emptyHistory() {
  const texture = new THREE.DataTexture(new Float32Array([0, 0, 0, 1e6]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

// ---- Shader pieces (GLSL) -----------------------------------------------------
const NOISE_GLSL = `
  float sxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sxHash(i), sxHash(i + vec2(1, 0)), f.x),
               mix(sxHash(i + vec2(0, 1)), sxHash(i + vec2(1, 1)), f.x), f.y);
  }`;

// Rain rings: the ground is split into cells; in each one a drop lands now and then
// and a ring spreads out from it. Returns how much the water surface tilts (x, z).
const RIPPLE_GLSL = `
  vec2 sxRipples(vec2 p) {
    vec2 tilt = vec2(0.0);
    for (int layer = 0; layer < 2; layer++) {
      vec2 q = p * (layer == 0 ? 2.3 : 3.9) + float(layer) * 17.3;
      vec2 cell = floor(q), f = fract(q);
      float h = sxHash(cell);
      float age = fract(uTime * (0.9 + h * 0.7) + h * 7.0);            // 0 = the drop lands, 1 = the ring is gone
      vec2 delta = f - 0.5 - (vec2(sxHash(cell + 3.1), sxHash(cell + 7.7)) - 0.5) * 0.4;
      float dist = length(delta), radius = age * 0.42;
      float ring = sin((dist - radius) * 70.0) * smoothstep(0.05, 0.0, abs(dist - radius)) * (1.0 - age);
      tilt += delta / max(dist, 0.001) * ring;
    }
    return tilt;
  }`;

// Tail lamps, neon... each one lights the surface a little and leaves a shiny highlight.
const SMALL_LIGHTS_SHADING_GLSL = `
  for (int i = 0; i < ${MAX_SMALL_LIGHTS}; i++) {
    if (i >= uSmallCount) break;
    vec3 sxL = (viewMatrix * vec4(uSmallPos[i], 1.0)).xyz - geometryPosition;
    float sxD2 = max(dot(sxL, sxL), 0.0001);
    sxL *= inversesqrt(sxD2);
    vec3 sxLight = uSmallColor[i] * saturate(dot(geometryNormal, sxL)) / (sxD2 + 1.0);
    reflectedLight.directDiffuse += sxLight * BRDF_Lambert(material.diffuseColor);
    reflectedLight.directSpecular += min(sxLight * BRDF_GGX(sxL, geometryViewDir, geometryNormal, material), vec3(6.0));
  }`;

// The mirror. Walk along the reflected ray in growing steps; at each step look up how far
// away last frame's picture was at that spot. When the ray has gone behind something, that
// is what the water reflects. Rough wet asphalt smears the reflection downwards (a streak);
// a puddle keeps it sharp. Glancing angles reflect far more than looking straight down.
const REFLECTION_GLSL = `
  if (uWet > 0.02) {
    vec3 sxUp = inverseTransformDirection(geometryNormal, viewMatrix);
    vec3 sxIn = normalize(vSxWorld - cameraPosition);
    vec3 sxOut = reflect(sxIn, sxUp);
    vec3 sxAt = vSxWorld + sxUp * 0.04, sxBefore = sxAt;
    // every pixel starts with a slightly different step length, which turns stripes into fine grain
    float sxStep = 0.4 * (0.7 + 0.6 * sxHash(gl_FragCoord.xy + fract(uTime) * 91.0));
    vec3 sxSeen = vec3(0.0);
    for (int i = 0; i < 20; i++) {
      sxBefore = sxAt;
      sxAt += sxOut * sxStep;
      vec4 sxClip = uPrevViewProj * vec4(sxAt, 1.0);
      if (sxClip.w < 0.2) break;
      vec2 sxUv = sxClip.xy / sxClip.w * 0.5 + 0.5;
      if (sxUv.x < 0.0 || sxUv.x > 1.0 || sxUv.y < 0.0 || sxUv.y > 1.0) break;
      float sxBehind = sxClip.w - textureLod(uHistory, sxUv, 0.0).a;
      if (sxBehind > 0.0 && sxBehind < sxStep * 1.5 + 0.6) {
        // gone behind something: step back and forth a few times to find where exactly
        for (int k = 0; k < 4; k++) {
          vec3 sxMiddle = (sxBefore + sxAt) * 0.5;
          vec4 sxMid = uPrevViewProj * vec4(sxMiddle, 1.0);
          sxUv = sxMid.xy / sxMid.w * 0.5 + 0.5;
          if (sxMid.w > textureLod(uHistory, sxUv, 0.0).a) sxAt = sxMiddle; else sxBefore = sxMiddle;
        }
        float sxSmear = mix(0.022, 0.003, sxPuddle), sxBlur = mix(3.2, 1.0, sxPuddle);
        for (int k = -2; k <= 2; k++) sxSeen += textureLod(uHistory, sxUv + vec2(0.0, float(k) * sxSmear), sxBlur).rgb;
        vec2 sxEdge = smoothstep(0.0, 0.07, sxUv) * smoothstep(1.0, 0.93, sxUv);     // fade out at the picture's border
        sxSeen *= 0.2 * sxEdge.x * sxEdge.y;
        break;
      }
      sxStep *= 1.3;
    }
    float sxGlance = 0.04 + 0.96 * pow(1.0 - saturate(dot(-sxIn, sxUp)), 5.0);
    reflectedLight.indirectSpecular += min(sxSeen, vec3(5.0)) * sxGlance * uWet * mix(0.55, 1.0, sxPuddle);
  }`;

// Brightness limit: up to half the limit nothing changes; above that the surface gets
// brighter more and more slowly and never passes the limit. The colour is kept. Only light
// that FALLS on the surface is limited - its own glow (a lit lamp, a reflective sign) is not.
const LIMIT_GLSL = `
  vec3 sxLit = outgoingLight - totalEmissiveRadiance;
  float sxMax = max(sxLit.r, max(sxLit.g, sxLit.b)), sxKnee = uLimit * 0.5;
  if (sxMax > sxKnee) outgoingLight = sxLit * (sxKnee + (sxMax - sxKnee) / (1.0 + (sxMax - sxKnee) / (uLimit - sxKnee))) / sxMax + totalEmissiveRadiance;`;

/**
 * @param {THREE.Material} material  a MeshStandardMaterial or MeshPhysicalMaterial
 * @param {{retro?: number, wet?: boolean, limit?: number, lamps?: boolean}} options
 *   retro: how strongly the surface returns headlight light (0 = not at all)
 *   wet:   true if the surface should react to rain (roads, lots, painted lines)
 *   limit: the brightest the surface may get (0 = no limit). For scale: the road in your
 *          own headlights is about 0.1, anything above 0.6 is nearly white on screen,
 *          lamps glow above 1.7 and streak above 5.
 *   lamps: false = the small lights do NOT reach this surface (the inside of your own car:
 *          small lights shine through walls, and your tail lamps must not light the cabin)
 */
export function enhanceMaterial(material, { retro = 0, wet = false, limit = 0, lamps = true } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, smallLights.uniforms, {
      uWet: shared.wet, uRain: shared.rain, uTime: shared.time,
      uHeadPos: shared.headPos, uHeadDir: shared.headDir, uHeadPower: shared.headPower,
      uHistory: shared.history, uPrevViewProj: shared.prevViewProj,
      uRetro: { value: retro }, uLimit: { value: limit },
    });
    material.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSxWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 sxWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sxWorld = instanceMatrix * sxWorld;
        #endif
        vSxWorld = (modelMatrix * sxWorld).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSxWorld;
        uniform float uWet, uRain, uTime, uHeadPower, uRetro, uLimit;
        uniform vec3 uHeadPos, uHeadDir;
        uniform sampler2D uHistory;
        uniform mat4 uPrevViewProj;
        ${SMALL_LIGHTS_GLSL}
        ${NOISE_GLSL}
        ${wet ? RIPPLE_GLSL : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${wet ? `
        // Puddles collect in the same low spots every time; they only fill once it is properly wet.
        float sxPuddle = smoothstep(0.35, 0.75, sxNoise(vSxWorld.xz * 0.22) * 0.7 + sxNoise(vSxWorld.xz * 1.3) * 0.3) * smoothstep(0.3, 0.8, uWet);
        roughnessFactor = mix(roughnessFactor, mix(0.30, 0.05, sxPuddle), uWet);
        diffuseColor.rgb *= mix(1.0, 0.45, uWet);` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${wet ? `
        normal = mix(normal, nonPerturbedNormal, clamp(uWet * 0.8 + sxPuddle, 0.0, 1.0));   // water fills the little bumps and lies flat
        vec2 sxTilt = sxRipples(vSxWorld.xz) * uRain * uWet * mix(0.12, 0.4, sxPuddle);
        normal = normalize(normal + (viewMatrix * vec4(sxTilt.x, 0.0, sxTilt.y, 0.0)).xyz);` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${retro > 0 ? `
        vec3 sxToFrag = vSxWorld - uHeadPos;
        float sxDist = length(sxToFrag);
        float sxCone = smoothstep(0.72, 0.98, dot(sxToFrag / sxDist, uHeadDir));
        float sxBack = uHeadPower * sxCone / (1.0 + sxDist * sxDist * 0.0009);
        totalEmissiveRadiance += diffuseColor.rgb * sxBack * uRetro;` : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        ${lamps ? SMALL_LIGHTS_SHADING_GLSL : ''}
        ${wet ? REFLECTION_GLSL : ''}`)
      .replace('#include <opaque_fragment>', `${limit > 0 ? LIMIT_GLSL : ''}
        #include <opaque_fragment>`);
  };
  // Materials with the same options can share one compiled shader (each keeps its own uRetro and uLimit values).
  material.customProgramCacheKey = () => `sx-${retro > 0}-${wet}-${limit > 0}-${lamps}`;
  return material;
}

// A cone of lit air: what you see of a light beam in mist or rain. Put it on an open
// CylinderGeometry whose TOP is at the lamp. It is brightest near the lamp and seen
// edge-on it fades out softly; shared.haze (set by the weather) decides how visible it is.
export function beamMaterial(color, strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uHaze: shared.haze },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying float vAlong; varying vec3 vNormal, vToEye;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * normal; vToEye = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength, uHaze; varying float vAlong; varying vec3 vNormal, vToEye;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vToEye)));          // 1 = looking through the middle of the beam
        // (max: a hair below zero would make pow() return an invalid number, which bloom smears into black blocks)
        gl_FragColor = vec4(uColor * facing * facing * pow(max(vAlong, 0.0), 1.6) * uHaze * uStrength, 1.0);
      }`,
  });
}

// ---- Procedural textures (so the game needs no image downloads) -------------

export function canvasTexture(width, height, draw, { repeat = true, srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Speckled asphalt: dark binder with lighter stones, plus a few tar patches.
export function makeAsphaltTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const rnd = makeRandom(7);
    g.fillStyle = '#4c4c4e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const v = 62 + rnd() * 34;
      g.fillStyle = `rgba(${v},${v},${v * 0.98},${0.25 + rnd() * 0.35})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    for (let i = 0; i < 40; i++) {                    // darker worn blotches
      const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(20,20,22,0.25)'); grad.addColorStop(1, 'rgba(20,20,22,0)');
      g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = 'rgba(15,15,16,0.55)'; g.lineWidth = 1.5;   // tar crack repairs
    for (let i = 0; i < 6; i++) {
      g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 60; y += rnd() * 50; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

// Bare mountain ground: dirt with stones, grit and dead leaves. Mid-grey on average,
// so the terrain's own colour (brush or rock) shows through. The stones are only a little
// lighter than the soil: pale ones turn a lit hillside, seen from across a car park, into a
// wall of floating white dots.
export function makeGroundTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const rnd = makeRandom(23);
    g.fillStyle = '#7d7566'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {                     // big soft patches of lighter and darker soil
      const x = rnd() * w, y = rnd() * h, r = 40 + rnd() * 110, light = rnd() < 0.5;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, light ? 'rgba(170,158,132,0.35)' : 'rgba(52,46,38,0.4)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 30000; i++) {                  // grit
      const v = 95 + rnd() * 55;
      g.fillStyle = `rgba(${v},${v * 0.94},${v * 0.8},${0.2 + rnd() * 0.3})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    for (let i = 0; i < 380; i++) {                    // stones, each with a dark side
      const x = rnd() * w, y = rnd() * h, r = 2 + rnd() * rnd() * 9, v = 112 + rnd() * 40;
      g.fillStyle = 'rgba(25,22,18,0.3)'; g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.35, r, r * 0.8, rnd() * 3, 0, 7); g.fill();
      g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.86})`; g.beginPath(); g.ellipse(x, y, r, r * 0.75, rnd() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 900; i++) {                    // dry leaves and twigs
      g.strokeStyle = `rgba(${60 + rnd() * 60},${45 + rnd() * 40},${25 + rnd() * 20},0.7)`; g.lineWidth = 1 + rnd() * 1.5;
      const x = rnd() * w, y = rnd() * h, a = rnd() * 6.28, len = 3 + rnd() * 9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
  });
}

// Diagonal warning stripes in two colours (road-closed barriers, the ends of a median wall).
export function makeStripeTexture(background, stripe) {
  return canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = background; g.fillRect(0, 0, w, h);
    g.fillStyle = stripe;
    for (let x = -h; x < w; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 16, 0); g.lineTo(x + 16, h); g.fill(); }
  });
}

// A bumpy normal map made from random noise (gives asphalt its sparkle).
export function makeNoiseNormalMap(size = 256, strength = 2.0, seed = 3) {
  const rnd = makeRandom(seed);
  const coarseSize = size / 4, coarse = new Float32Array(coarseSize * coarseSize);
  for (let i = 0; i < coarse.length; i++) coarse[i] = rnd();
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x / 4, cy = y / 4, x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
      const at = (ix, iy) => coarse[(iy % coarseSize) * coarseSize + (ix % coarseSize)];
      const smooth = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      height[y * size + x] = smooth * 0.25 + rnd() * 0.12;
    }
  }
  return canvasTexture(size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const hL = height[y * size + ((x + size - 1) % size)], hR = height[y * size + ((x + 1) % size)];
        const hU = height[((y + size - 1) % size) * size + x], hD = height[((y + 1) % size) * size + x];
        const nx = (hL - hR) * strength, ny = (hU - hD) * strength, len = Math.hypot(nx, ny, 1);
        const i = (y * size + x) * 4;
        img.data[i] = (nx / len * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
        img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

// Soft round glow used for every lamp flare in the game.
export function makeGlowTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.12, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    // faint horizontal streak, like a cheap dash-cam lens
    const streak = g.createLinearGradient(0, 0, w, 0);
    streak.addColorStop(0, 'rgba(255,255,255,0)'); streak.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = streak; g.fillRect(0, h / 2 - 1.5, w, 3);
  }, { repeat: false });
}

// The light pattern a headlight throws: bright centre, sharp cut-off at the top.
export function makeHeadlightCookie() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w / 2, h * 0.52, 0, w / 2, h * 0.52, w * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(0, h * 0.52); g.scale(1, 0.62); g.translate(0, -h * 0.52);
    g.fillStyle = grad; g.fillRect(0, -h, w, h * 3); g.restore();
    // low-beam cut-off: fade the upper part (texture top = up in the beam)
    const cut = g.createLinearGradient(0, h * 0.30, 0, h * 0.46);
    cut.addColorStop(0, 'rgba(0,0,0,0.82)'); cut.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cut; g.fillRect(0, 0, w, h * 0.46);
    g.fillStyle = 'rgba(0,0,0,0.82)'; g.fillRect(0, 0, w, h * 0.30);
  }, { repeat: false });
}
