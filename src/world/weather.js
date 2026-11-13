// ---------------------------------------------------------------------------
// weather.js — the rain toggle. Turning rain on does four things over a few
// seconds: rain streaks appear, the road gets wet and shiny (materials.js),
// tyre grip drops, and the audio module is told to play rain.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { PHYSICS } from '../config.js';
import { lerp, approach } from '../core/mathUtils.js';
import { shared } from '../render/materials.js';

const DROP_COUNT = 11000;
const BOX = new THREE.Vector3(44, 22, 44);   // rain only exists in a box around the camera
const SPRAY_COUNT = 500;                     // mist kicked up by tyres on the wet road
const WIPER_PERIOD = 1.25;                   // seconds for one back-and-forth sweep

export function createWeather(scene) {
  // Each raindrop is a short line. Two vertices per drop: the head and the tail.
  const seeds = new Float32Array(DROP_COUNT * 2 * 3), ends = new Float32Array(DROP_COUNT * 2);
  for (let i = 0; i < DROP_COUNT; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    seeds.set([x, y, z, x, y, z], i * 6);
    ends[i * 2 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('end', new THREE.BufferAttribute(ends, 1));
  const uniforms = {
    uTime: { value: 0 }, uAmount: { value: 0 }, uBox: { value: BOX }, uCamera: { value: new THREE.Vector3() },
    uCarVelocity: { value: new THREE.Vector3() },
    uHeadPos: shared.headPos, uHeadDir: shared.headDir, uHeadPower: shared.headPower,
  };
  const streaks = new THREE.LineSegments(geometry, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float end;
      uniform float uTime, uAmount, uHeadPower; uniform vec3 uBox, uCamera, uCarVelocity, uHeadPos, uHeadDir;
      varying float vBright;
      void main() {
        vec3 fall = vec3(1.6, -13.0 - position.x * 6.0, 0.8);            // metres per second
        vec3 p = position * uBox + fall * uTime;
        p = mod(p - uCamera, uBox) - uBox * 0.5 + uCamera;              // wrap around the camera
        // The streak is the path the drop travels during one "exposure" (seen from the moving car).
        p += (fall - uCarVelocity) * (0.028 + position.y * 0.02) * end;   // longer streaks = closer, heavier drops
        // Drops light up when they fall through the headlight beams.
        vec3 toDrop = p - uHeadPos; float dist = length(toDrop);
        float cone = smoothstep(0.75, 0.97, dot(toDrop / dist, uHeadDir));
        vBright = (0.03 + uHeadPower * cone * 1.1 / (1.0 + dist * dist * 0.01)) * step(position.z, uAmount);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vBright; void main() { gl_FragColor = vec4(vec3(0.8, 0.85, 0.9) * vBright, 1.0); }`,
  }));
  streaks.frustumCulled = false;
  streaks.visible = false;
  scene.add(streaks);

  // ---- Tyre spray: soft puffs of mist that hang in the air and catch the headlights -----
  const sprayPos = new Float32Array(SPRAY_COUNT * 3), sprayLife = new Float32Array(SPRAY_COUNT), sprayVel = new Float32Array(SPRAY_COUNT * 3);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  sprayGeo.setAttribute('life', new THREE.BufferAttribute(sprayLife, 1));
  const spray = new THREE.Points(sprayGeo, new THREE.ShaderMaterial({
    uniforms: { uHeadPos: shared.headPos, uHeadDir: shared.headDir, uHeadPower: shared.headPower, uScale: { value: 600 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float life; uniform vec3 uHeadPos, uHeadDir; uniform float uHeadPower, uScale; varying float vAlpha;
      void main() {
        vec3 toPuff = position - uHeadPos; float dist = length(toPuff);
        float cone = smoothstep(0.7, 0.96, dot(toPuff / dist, uHeadDir));
        vAlpha = sin(clamp(life, 0.0, 1.0) * 3.14159) * (0.018 + uHeadPower * cone * 0.5 / (1.0 + dist * dist * 0.004));
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_PointSize = uScale * (1.6 - life) / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vAlpha; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.8, 0.85, 0.9) * vAlpha * smoothstep(1.0, 0.1, d), 1.0); }`,
  }));
  spray.frustumCulled = false;
  scene.add(spray);
  let nextSpray = 0;

  const weather = {
    raining: false,
    wiper: 0,            // 0..1 position in the wiper cycle (read by the cockpit wipers and postfx.js)
    // A car on the wet road throws mist from its back wheels. Call for every moving car.
    sprayFrom(x, y, z, vx, vz, speed, dt) {
      if (shared.wet.value < 0.3 || speed < 9) return;
      if (Math.random() > dt * speed * 1.4) return;
      const i = nextSpray; nextSpray = (nextSpray + 1) % SPRAY_COUNT;
      sprayPos.set([x + (Math.random() - 0.5) * 1.6, y + 0.25, z + (Math.random() - 0.5) * 1.6], i * 3);
      sprayVel.set([vx * 0.35 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, vz * 0.35 + (Math.random() - 0.5) * 2], i * 3);
      sprayLife[i] = 1;
    },
    amount: 0,           // 0..1 how hard it is raining right now
    grip: PHYSICS.dryGrip,
    toggle() { weather.raining = !weather.raining; },
    update(dt, camera, carVelocity) {
      weather.amount = approach(weather.amount, weather.raining ? 1 : 0, dt / 2.5);
      // The road takes a little longer to soak (and to dry) than the rain takes to start.
      shared.wet.value = approach(shared.wet.value, weather.raining ? 1 : 0, dt / (weather.raining ? 4 : 7));
      weather.grip = lerp(PHYSICS.dryGrip, PHYSICS.wetGrip, shared.wet.value);
      streaks.visible = weather.amount > 0.01;
      if (weather.amount > 0.05) weather.wiper = (weather.wiper + dt / WIPER_PERIOD) % 1;
      else if (weather.wiper > 0.001) weather.wiper = Math.min(1, weather.wiper + dt / WIPER_PERIOD) % 1;   // finish the sweep, then park
      for (let i = 0; i < SPRAY_COUNT; i++) {
        if (sprayLife[i] <= 0) continue;
        sprayLife[i] -= dt / 1.6;
        for (let a = 0; a < 3; a++) sprayPos[i * 3 + a] += sprayVel[i * 3 + a] * dt;
        sprayVel[i * 3] *= 0.97; sprayVel[i * 3 + 2] *= 0.97;
        if (sprayLife[i] <= 0) sprayPos[i * 3 + 1] = -9999;
      }
      sprayGeo.attributes.position.needsUpdate = true; sprayGeo.attributes.life.needsUpdate = true;
      uniforms.uTime.value += dt;
      uniforms.uAmount.value = weather.amount;
      uniforms.uCamera.value.copy(camera.position);
      uniforms.uCarVelocity.value.copy(carVelocity);
    },
  };
  return weather;
}
