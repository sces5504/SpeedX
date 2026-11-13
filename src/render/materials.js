// ---------------------------------------------------------------------------
// materials.js — shared textures and two small shader upgrades:
//
//  * retroreflection: road signs, lane paint and reflectors bounce your own
//    headlights straight back at you, so they glow from far away at night.
//  * wetness: when it rains, asphalt gets darker and mirror-like in patches.
//
// Both are added to normal Three.js materials with `enhanceMaterial()`.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeRandom } from '../core/mathUtils.js';

// One set of values shared by every enhanced material. Change them once here
// (e.g. shared.wet.value = 1) and every material follows.
export const shared = {
  wet: { value: 0 },                               // 0 = dry, 1 = soaked
  headPos: { value: new THREE.Vector3() },         // player's headlights position
  headDir: { value: new THREE.Vector3(0, 0, -1) }, // ...and direction
  headPower: { value: 1 },                         // 0 off, 1 low beam, 2+ high beam
};

/**
 * @param {THREE.Material} material
 * @param {{retro?: number, wet?: boolean}} options
 *   retro: how strongly the surface returns headlight light (0 = not at all)
 *   wet:   true if the surface should react to rain
 */
export function enhanceMaterial(material, { retro = 0, wet = false } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = shared.wet;
    shader.uniforms.uHeadPos = shared.headPos;
    shader.uniforms.uHeadDir = shared.headDir;
    shader.uniforms.uHeadPower = shared.headPower;
    shader.uniforms.uRetro = { value: retro };

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
        uniform float uWet, uHeadPower, uRetro;
        uniform vec3 uHeadPos, uHeadDir;
        float sxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sxNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sxHash(i), sxHash(i + vec2(1, 0)), f.x),
                     mix(sxHash(i + vec2(0, 1)), sxHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${wet ? `
        float sxPuddle = smoothstep(0.35, 0.75, sxNoise(vSxWorld.xz * 0.22) * 0.7 + sxNoise(vSxWorld.xz * 1.3) * 0.3);
        roughnessFactor = mix(roughnessFactor, mix(0.32, 0.06, sxPuddle), uWet);
        diffuseColor.rgb *= mix(1.0, 0.5, uWet);` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${retro > 0 ? `
        vec3 sxToFrag = vSxWorld - uHeadPos;
        float sxDist = length(sxToFrag);
        float sxCone = smoothstep(0.72, 0.98, dot(sxToFrag / sxDist, uHeadDir));
        float sxBack = uHeadPower * sxCone / (1.0 + sxDist * sxDist * 0.0009);
        totalEmissiveRadiance += diffuseColor.rgb * sxBack * uRetro;` : ''}`);
  };
  material.customProgramCacheKey = () => `sx-${retro > 0}-${wet}`;
  // Each material needs its own uRetro value even when the shader program is shared.
  const baseCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => { baseCompile(shader, renderer); material.userData.shader = shader; };
  return material;
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
