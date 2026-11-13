// sparks.js — orange sparks when metal scrapes a guardrail or another car.
// A fixed pool of points: each spark flies, falls with gravity, and fades.
import * as THREE from 'three';

const COUNT = 160;

export function createSparks(scene) {
  const positions = new Float32Array(COUNT * 3), colors = new Float32Array(COUNT * 3);
  const velocity = new Float32Array(COUNT * 3), life = new Float32Array(COUNT);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.022, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;

  return {
    // Throw `count` sparks from a point, roughly along (vx, vz).
    emit(x, y, z, vx, vz, count) {
      for (let k = 0; k < count; k++) {
        const i = next; next = (next + 1) % COUNT;
        positions.set([x, y + Math.random() * 0.3, z], i * 3);
        velocity.set([vx * (0.3 + Math.random() * 0.5) + (Math.random() - 0.5) * 4, 1 + Math.random() * 3.5,
          vz * (0.3 + Math.random() * 0.5) + (Math.random() - 0.5) * 4], i * 3);
        life[i] = 0.25 + Math.random() * 0.5;
      }
    },
    update(dt) {
      for (let i = 0; i < COUNT; i++) {
        if (life[i] <= 0) { colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0; continue; }
        life[i] -= dt;
        velocity[i * 3 + 1] -= 9.8 * dt;
        for (let a = 0; a < 3; a++) positions[i * 3 + a] += velocity[i * 3 + a] * dt;
        const glow = Math.min(1, life[i] * 4) * 6;            // values above 1 make them bloom
        colors[i * 3] = glow; colors[i * 3 + 1] = glow * 0.55; colors[i * 3 + 2] = glow * 0.15;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}
