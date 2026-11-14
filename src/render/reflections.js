// ---------------------------------------------------------------------------
// reflections.js — what car paint and glass mirror.
//
// A shiny car shows its surroundings: street lamps slide over the bonnet, a
// neon sign glows in the windscreen, the car behind lights up your boot lid.
// To get that we keep a "probe": a tiny camera that sits where your car is and
// photographs the world in all six directions (a cube map). Car materials use
// that cube as their reflection.
//
// Six extra pictures every frame would be slow, so the probe takes ONE side per
// frame; the whole cube is fresh again every six frames.
//
// (Wet roads use a different trick — see materials.js.)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS } from '../config.js';

const SIZE = GRAPHICS.carReflections;
const target = new THREE.WebGLCubeRenderTarget(Math.max(SIZE, 1), { type: THREE.HalfFloatType });

// The reflection every car material should use:  material.envMap = carReflection
// (null when the feature is switched off, then cars just reflect the sky).
export const carReflection = SIZE > 0 ? target.texture : null;

export function createCarProbe(renderer, scene) {
  const probe = new THREE.CubeCamera(0.5, 500, target);
  probe.coordinateSystem = renderer.coordinateSystem;
  probe.updateCoordinateSystem();              // points the six cameras the right way
  let side = 0;

  return {
    /**
     * Photograph one more side of the cube. Call once per frame.
     * @param {THREE.Vector3} centre where the probe sits (the player's car)
     * @param {THREE.Object3D[]} hide things that must not be in the picture (the car itself)
     */
    update(centre, hide = []) {
      if (SIZE <= 0) return;
      probe.position.copy(centre);
      probe.updateMatrixWorld();
      const wasVisible = hide.map((object) => object.visible);
      for (const object of hide) object.visible = false;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target, side);
      renderer.render(scene, probe.children[side]);
      renderer.setRenderTarget(previous);
      hide.forEach((object, i) => { object.visible = wasVisible[i]; });
      side = (side + 1) % 6;
      if (side === 0) target.texture.needsPMREMUpdate = true;   // all six done: let materials blur it for rough surfaces
    },
  };
}
