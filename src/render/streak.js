// ---------------------------------------------------------------------------
// streak.js — the "streak filter" of a film camera, as a post-processing step.
//
// Anamorphic cinema lenses turn every bright lamp into a long horizontal line
// of light, usually blue. We copy that:
//
//   1. keep only the very bright parts of the picture (lamps), in a small image
//   2. smear that image sideways, three times, each time wider
//   3. add the smear back on top of the picture, tinted
//
// The strength is GRAPHICS.streak in config.js.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class StreakPass extends Pass {
  /** @param tint colour of the streaks (hex)   @param threshold only light brighter than this streaks */
  constructor(tint = 0x6fa8ff, threshold = 5) {
    super();
    this.strength = 0.5;      // set every frame by postfx.js
    const small = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.bright = small(); this.smearA = small(); this.smearB = small();

    this.brightMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: threshold } },
      vertexShader: VERTEX,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
        void main() {
          // average four neighbours, so a lamp one pixel wide does not flicker as it moves
          vec3 c = vec3(0.0);
          for (int x = -1; x <= 1; x += 2) for (int y = -1; y <= 1; y += 2) c += texture2D(tDiffuse, vUv + vec2(x, y) * uTexel).rgb;
          c = min(c * 0.25, vec3(40.0));
          float brightest = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold * 2.5, brightest), 1.0);
        }`,
    });
    this.smearMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uStep: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uStep; varying vec2 vUv;
        void main() {
          vec3 sum = vec3(0.0); float total = 0.0;
          for (int i = -6; i <= 6; i++) {
            float weight = exp(-float(i * i) / 14.0);
            sum += texture2D(tDiffuse, vUv + vec2(float(i) * uStep, 0.0)).rgb * weight;
            total += weight;
          }
          gl_FragColor = vec4(sum / total, 1.0);
        }`,
    });
    this.mixMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tSmear: { value: null }, uTint: { value: new THREE.Color(tint) }, uStrength: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: `
        uniform sampler2D tDiffuse, tSmear; uniform vec3 uTint; uniform float uStrength; varying vec2 vUv;
        void main() {
          vec3 col = texture2D(tDiffuse, vUv).rgb;
          vec3 smear = texture2D(tSmear, vUv).rgb;
          // the streak keeps a little of the lamp's own colour, the rest is the lens tint
          col += (smear * 0.35 + dot(smear, vec3(0.33)) * uTint) * uStrength;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.quad = new FullScreenQuad(this.brightMaterial);
  }

  setSize(width, height) {
    // Narrow sideways (the smear hides it), half height so the streak stays thin.
    const w = Math.max(1, Math.round(width / 4)), h = Math.max(1, Math.round(height / 2));
    this.bright.setSize(w, h); this.smearA.setSize(w, h); this.smearB.setSize(w, h);
    this.brightMaterial.uniforms.uTexel.value.set(1 / width, 1 / height);
    this.texel = 1 / w;
  }

  render(renderer, writeBuffer, readBuffer) {
    const draw = (material, target) => { this.quad.material = material; renderer.setRenderTarget(target); this.quad.render(renderer); };
    this.brightMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    draw(this.brightMaterial, this.bright);
    // Three sideways smears: 1, 4, then 16 pixels between samples.
    const smear = this.smearMaterial.uniforms;
    smear.tDiffuse.value = this.bright.texture; smear.uStep.value = this.texel; draw(this.smearMaterial, this.smearA);
    smear.tDiffuse.value = this.smearA.texture; smear.uStep.value = this.texel * 4; draw(this.smearMaterial, this.smearB);
    smear.tDiffuse.value = this.smearB.texture; smear.uStep.value = this.texel * 16; draw(this.smearMaterial, this.smearA);

    const mix = this.mixMaterial.uniforms;
    mix.tDiffuse.value = readBuffer.texture; mix.tSmear.value = this.smearA.texture;
    mix.uStrength.value = this.strength;
    draw(this.mixMaterial, this.renderToScreen ? null : writeBuffer);
  }

  dispose() {
    for (const item of [this.bright, this.smearA, this.smearB, this.brightMaterial, this.smearMaterial, this.mixMaterial, this.quad]) item.dispose();
  }
}
