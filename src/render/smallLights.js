// ---------------------------------------------------------------------------
// smallLights.js — coloured light from the many little lamps in the world:
// tail lamps, brake lamps, oncoming headlights, neon signs, vending machines.
//
// Real Three.js lights are expensive (every one is worked out for every pixel
// of every object, with shadows), so the game only has a handful. These "small
// lights" are the cheap kind: just a position and a colour. Every frame main.js
// lists the ones near the camera, and the materials upgraded by
// materials.js -> enhanceMaterial() add their glow and their shiny reflection.
// That is why a brake lamp paints the road red and a neon sign shows up as a
// long streak on wet asphalt.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const MAX_SMALL_LIGHTS = 24;

const found = [];     // everything offered this frame: { x, y, z, r, g, b, score }
const color = new THREE.Color();

export const smallLights = {
  // The three values the shaders read (see SMALL_LIGHTS_GLSL below).
  uniforms: {
    uSmallPos: { value: Array.from({ length: MAX_SMALL_LIGHTS }, () => new THREE.Vector3()) },
    uSmallColor: { value: Array.from({ length: MAX_SMALL_LIGHTS }, () => new THREE.Vector3()) },
    uSmallCount: { value: 0 },
  },

  // Call once at the start of a frame, then add() every lamp, then finish().
  begin() { found.length = 0; },

  // power is in the same unit as Three.js light intensity (a tail lamp ~8, a street lamp ~300).
  add(x, y, z, hex, power, camera) {
    if (power <= 0.01) return;
    color.set(hex);
    const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
    // Bright and close matters most; far and dim is dropped first when the list is full.
    found.push({ x, y, z, r: color.r * power, g: color.g * power, b: color.b * power, score: power / (dx * dx + dy * dy + dz * dz + 25) });
  },

  finish() {
    found.sort((a, b) => b.score - a.score);
    const count = Math.min(found.length, MAX_SMALL_LIGHTS), u = smallLights.uniforms;
    for (let i = 0; i < count; i++) {
      u.uSmallPos.value[i].set(found[i].x, found[i].y, found[i].z);
      u.uSmallColor.value[i].set(found[i].r, found[i].g, found[i].b);
    }
    u.uSmallCount.value = count;
  },
};

// Shader text: the list itself. Any shader that wants the small lights starts with this.
export const SMALL_LIGHTS_GLSL = `
  uniform vec3 uSmallPos[${MAX_SMALL_LIGHTS}];
  uniform vec3 uSmallColor[${MAX_SMALL_LIGHTS}];
  uniform int uSmallCount;`;

// Shader text for particles (rain, spray): how much coloured light reaches world point p.
export const SMALL_LIGHTS_GLOW_GLSL = `
  vec3 smallLightGlow(vec3 p) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${MAX_SMALL_LIGHTS}; i++) {
      if (i >= uSmallCount) break;
      vec3 to = uSmallPos[i] - p;
      sum += uSmallColor[i] / (4.0 + dot(to, to));
    }
    return sum;
  }`;
