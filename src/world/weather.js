// ---------------------------------------------------------------------------
// weather.js — the rain. Turning rain on changes many things over a few seconds:
//
//   streaks    every drop is drawn the way a film camera sees it: a thin line
//              as long as the distance it falls while the shutter is open.
//              Driving fast makes the lines lean toward you (and fainter,
//              because the same glint is smeared over a longer line). Drops
//              are only visible where light hits them: the flat fan of your
//              low beams, street lamps, tail lamps, neon.
//   splashes   little crowns where drops hit the road around the car
//   spray      mist thrown up by tyres, glowing red behind tail lamps
//   road       soaks, darkens and mirrors the scene (render/materials.js)
//   air        turns hazy, so light beams and lamp halos show (shared.haze)
//   grip       tyre grip in the wet (PHYSICS.wetGrip; set equal to dry, so rain does not change the driving); the audio module is told to play rain
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS, PHYSICS } from '../config.js';
import { lerp, approach } from '../core/mathUtils.js';
import { shared } from '../render/materials.js';
import { smallLights, SMALL_LIGHTS_GLSL, SMALL_LIGHTS_GLOW_GLSL } from '../render/smallLights.js';

const DROP_COUNT = 16000;
const BOX = new THREE.Vector3(46, 24, 46);   // rain only exists in a box around the camera
const SPLASH_COUNT = 2600;
const SPLASH_AREA = new THREE.Vector2(80, 17);   // metres along and across the road, centred on your car
const SPRAY_COUNT = 700;                     // puffs of mist kicked up by tyres
const WIPER_PERIOD = 1.25;                   // seconds for one back-and-forth sweep
const SHUTTER = 1 / 48;                      // seconds the "film shutter" is open: sets how long the streaks are
const SPEED_SHARE = 0.45;                    // how much of the car's speed leans the streaks (1 = true to life: at speed the
                                             // rain would fly flat at the lens like a garden sprinkler; less = it still FALLS)

// Shader text shared by rain, splashes and spray: how much light reaches a point in the air.
// Your own headlights are a cone; everything else comes from the small lights list.
const LIGHT_GLSL = `
  uniform vec3 uHeadPos, uHeadDir; uniform float uHeadPower;
  ${SMALL_LIGHTS_GLSL}
  ${SMALL_LIGHTS_GLOW_GLSL}
  vec3 lightAt(vec3 p) {
    vec3 toPoint = p - uHeadPos; float dist = length(toPoint);
    float cone = smoothstep(0.80, 0.985, dot(toPoint / dist, uHeadDir));
    // Low beams are cut off flat on top (high beams are not), and the air right at the lamps
    // is left dark - otherwise the brightest rain is a little cloud sitting on the bonnet.
    float above = toPoint.y / dist - uHeadDir.y;
    cone *= mix(smoothstep(0.16, 0.0, above), 1.0, smoothstep(1.2, 2.0, uHeadPower)) * smoothstep(2.0, 7.0, dist);
    vec3 light = vec3(1.0, 0.95, 0.86) * uHeadPower * cone * 3.2 / (1.0 + dist * 0.05 + dist * dist * 0.0025)
      + smallLightGlow(p) * 0.4 + vec3(0.024, 0.027, 0.033);
    return min(light, vec3(2.0));                                       // a drop right next to a lamp must not turn into a spotlight
  }`;
const lightUniforms = () => ({ uHeadPos: shared.headPos, uHeadDir: shared.headDir, uHeadPower: shared.headPower, ...smallLights.uniforms });
const randomSeeds = (count) => {
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  return seeds;
};

export function createWeather(scene) {
  // ---- Rain streaks: one flat strip per drop, drawn 16000 times in a single call ------
  const dropGeometry = new THREE.InstancedBufferGeometry();
  // x = across the streak (-0.5..0.5), y = 0 at the drop, 1 at the end of its trail
  dropGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  dropGeometry.setIndex([0, 1, 2, 2, 1, 3]);
  dropGeometry.setAttribute('seed', new THREE.InstancedBufferAttribute(randomSeeds(DROP_COUNT), 3));
  dropGeometry.instanceCount = DROP_COUNT;
  const rainUniforms = {
    uTime: { value: 0 }, uAmount: { value: 0 }, uBox: { value: BOX }, uCamera: { value: new THREE.Vector3() },
    uCarVelocity: { value: new THREE.Vector3() }, ...lightUniforms(),
  };
  const streaks = new THREE.Mesh(dropGeometry, new THREE.ShaderMaterial({
    uniforms: rainUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 seed;
      uniform float uTime, uAmount; uniform vec3 uBox, uCamera, uCarVelocity;
      varying float vAcross; varying vec3 vLight;
      ${LIGHT_GLSL}
      void main() {
        // metres per second: heavier drops fall faster, and no two lean quite the same in the wind
        vec3 fall = vec3(1.0 + seed.z * 1.6, -(7.5 + seed.x * 4.5), 0.3 + seed.y * 1.2);
        vec3 drop = seed * uBox + fall * uTime;
        drop = mod(drop - uCamera, uBox) - uBox * 0.5 + uCamera;         // wrap around the camera
        vec3 trail = (fall - uCarVelocity * ${SPEED_SHARE.toFixed(2)}) * ${SHUTTER.toFixed(4)};   // how far it moves in the picture while the shutter is open
        float smeared = clamp(9.0 * ${SHUTTER.toFixed(4)} / length(trail), 0.55, 1.0);                   // a longer line shares out the same light
        vec3 at = drop - trail * position.y;
        vec3 toEye = cameraPosition - at; float dist = length(toEye);
        // A real drop is 2 mm wide: far too thin to draw. Keep every streak about a pixel wide
        // and make it fainter instead, the further away it is.
        float width = max(0.004, dist * 0.0011);
        at += normalize(cross(trail, toEye)) * position.x * width;
        float shown = step(seed.z, uAmount) * smoothstep(2.0, 6.0, dist) * (0.004 / width) * smeared;
        vLight = lightAt(drop) * shown;
        vAcross = position.x * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
      }`,
    fragmentShader: `
      varying float vAcross; varying vec3 vLight;
      void main() { gl_FragColor = vec4(vLight * (1.0 - vAcross * vAcross), 1.0); }`,
  }));
  streaks.frustumCulled = false;
  streaks.visible = false;
  scene.add(streaks);

  // ---- Splashes: each one is a point that pops up somewhere new on the road, grows and fades ----
  const splashGeometry = new THREE.BufferGeometry();
  splashGeometry.setAttribute('position', new THREE.BufferAttribute(randomSeeds(SPLASH_COUNT), 3));   // used as random numbers
  const splashUniforms = {
    uTime: rainUniforms.uTime, uAmount: rainUniforms.uAmount, uArea: { value: SPLASH_AREA }, uScale: { value: 600 },
    uGround: { value: new THREE.Vector3() },            // a point on the road under your car
    uRoadDir: { value: new THREE.Vector3(0, 0, -1) },   // x, z = direction of the road; y = how steeply it climbs
    ...lightUniforms(),
  };
  const splashes = new THREE.Points(splashGeometry, new THREE.ShaderMaterial({
    uniforms: splashUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime, uAmount, uScale; uniform vec2 uArea; uniform vec3 uGround, uRoadDir;
      varying vec3 vLight; varying float vAge;
      ${LIGHT_GLSL}
      void main() {
        float cycle = uTime * (2.5 + position.z * 2.0) + position.z * 31.0;
        float turn = floor(cycle);                                          // every turn, a new random place
        vAge = fract(cycle) * 4.0;                                          // visible for the first quarter of the turn
        vec2 place = fract(sin(vec2(turn * 12.9898 + position.x * 78.233, turn * 39.346 + position.y * 11.135)) * 43758.5453) - 0.5;
        vec3 along = vec3(uRoadDir.x, 0.0, uRoadDir.z), across = vec3(-uRoadDir.z, 0.0, uRoadDir.x);
        vec3 at = uGround + along * place.x * uArea.x + across * place.y * uArea.y;
        at.y += uRoadDir.y * place.x * uArea.x + 0.02 + vAge * 0.05;
        vLight = lightAt(at) * step(position.x, uAmount) * step(vAge, 1.0) * (1.0 - vAge);
        vec4 mv = viewMatrix * vec4(at, 1.0);
        gl_PointSize = uScale * (0.02 + vAge * 0.09) / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vLight; varying float vAge;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float crown = smoothstep(1.0, 0.75, d) * smoothstep(0.25 * vAge, 0.75, d + 0.45 * (1.0 - vAge));   // a dot that opens into a ring
        gl_FragColor = vec4(vLight * crown * 0.9, 1.0);
      }`,
  }));
  splashes.frustumCulled = false;
  splashes.visible = false;
  scene.add(splashes);

  // ---- Tyre spray: soft puffs of mist that hang in the air and catch whatever light is near -----
  const sprayPos = new Float32Array(SPRAY_COUNT * 3).fill(-9999), sprayLife = new Float32Array(SPRAY_COUNT), sprayVel = new Float32Array(SPRAY_COUNT * 3);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  sprayGeo.setAttribute('life', new THREE.BufferAttribute(sprayLife, 1));
  const spray = new THREE.Points(sprayGeo, new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, ...lightUniforms() },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float life; uniform float uScale; varying vec3 vLight;
      ${LIGHT_GLSL}
      void main() {
        vLight = lightAt(position) * sin(clamp(life, 0.0, 1.0) * 3.14159) * 0.022;
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_PointSize = uScale * (2.4 - life * 1.4) / max(1.0, -mv.z);     // puffs spread out as they age
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vLight; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vLight * smoothstep(1.0, 0.0, d), 1.0); }`,
  }));
  spray.frustumCulled = false;
  scene.add(spray);
  let nextSpray = 0;

  const weather = {
    raining: false,
    wiper: 0,            // 0..1 position in the wiper cycle (read by the cockpit wipers and postfx.js)
    amount: 0,           // 0..1 how hard it is raining right now
    soak: 0,             // 0..1 how soaked the road is (lags behind the rain)
    grip: PHYSICS.dryGrip,
    toggle() { weather.raining = !weather.raining; },
    // A car on the wet road throws mist from its back wheels. Call for every moving car.
    sprayFrom(x, y, z, vx, vz, speed, dt) {
      if (weather.soak < 0.3 || speed < 9) return;
      if (Math.random() > dt * speed * 1.8) return;
      const i = nextSpray; nextSpray = (nextSpray + 1) % SPRAY_COUNT;
      sprayPos.set([x + (Math.random() - 0.5) * 1.6, y + 0.25, z + (Math.random() - 0.5) * 1.6], i * 3);
      sprayVel.set([vx * 0.35 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, vz * 0.35 + (Math.random() - 0.5) * 2], i * 3);
      sprayLife[i] = 1;
    },
    // Tell the splashes where the road is: a point on it (under your car), its direction and slope.
    setGround(x, y, z, dirX, dirZ, slope) {
      splashUniforms.uGround.value.set(x, y, z);
      splashUniforms.uRoadDir.value.set(dirX, slope, dirZ);
    },
    update(dt, camera, carVelocity) {
      weather.amount = approach(weather.amount, weather.raining ? 1 : 0, dt / 2.5);
      // The road takes a little longer to soak (and to dry) than the rain takes to start.
      weather.soak = approach(weather.soak, weather.raining ? 1 : 0, dt / (weather.raining ? 4 : 7));
      shared.wet.value = lerp(GRAPHICS.dampRoad, 1, weather.soak);            // never fully dry: see GRAPHICS.dampRoad
      shared.rain.value = weather.amount;
      shared.haze.value = lerp(GRAPHICS.mist, 1, weather.amount);
      weather.grip = lerp(PHYSICS.dryGrip, PHYSICS.wetGrip, weather.soak);
      streaks.visible = splashes.visible = weather.amount > 0.01;
      if (weather.amount > 0.05) weather.wiper = (weather.wiper + dt / WIPER_PERIOD) % 1;
      else if (weather.wiper > 0.001) weather.wiper = Math.min(1, weather.wiper + dt / WIPER_PERIOD) % 1;   // finish the sweep, then park
      for (let i = 0; i < SPRAY_COUNT; i++) {
        if (sprayLife[i] <= 0) continue;
        sprayLife[i] -= dt / 1.8;
        for (let a = 0; a < 3; a++) sprayPos[i * 3 + a] += sprayVel[i * 3 + a] * dt;
        sprayVel[i * 3] *= 0.97; sprayVel[i * 3 + 2] *= 0.97;
        if (sprayLife[i] <= 0) sprayPos[i * 3 + 1] = -9999;
      }
      sprayGeo.attributes.position.needsUpdate = true; sprayGeo.attributes.life.needsUpdate = true;
      rainUniforms.uTime.value += dt;
      rainUniforms.uAmount.value = weather.amount;
      rainUniforms.uCamera.value.copy(camera.position);
      rainUniforms.uCarVelocity.value.copy(carVelocity);
    },
  };
  return weather;
}
