// ---------------------------------------------------------------------------
// cameras.js — two views (press C):
//   chase    behind and above the car
//   cockpit  from the driver's eyes, with dashboard, hands and bonnet in view
// Hold the LEFT MOUSE BUTTON and move the mouse to look around in either view.
//
// Most of the feeling of speed is made here, not in the physics:
//   * the view gets wider the faster you go, and kicks wider when you floor it
//   * the camera trembles and sways more and more with speed
//   * "neck": the driver's head is thrown forward by braking, outward and
//     tilted in corners, nods on gear changes, and looks into the bend
//   * crashes slam the camera around
// All the strengths are in config.js -> FEEL.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FEEL, GRAPHICS } from '../config.js';
import { clamp, damp, lerp, noise1, angleDiff } from '../core/mathUtils.js';
import { input } from '../core/input.js';

const tmp = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

export function createCameras() {
  const camera = new THREE.PerspectiveCamera(GRAPHICS.fovChase, 16 / 9, 0.08, GRAPHICS.viewDistance);
  // Small backwards-looking camera for the rear-view mirror.
  const mirrorCamera = new THREE.PerspectiveCamera(24, 0.24 / 0.065, 0.5, 600);
  const mirrorTarget = new THREE.WebGLRenderTarget(384, 104);

  const rig = {
    camera, mirrorCamera, mirrorTarget,
    mode: 'chase',
    chaseYaw: 0,                 // direction the chase camera looks, lags behind the car
    chaseDistance: 5,
    time: 0,
    jolt: new THREE.Vector3(), joltSpeed: new THREE.Vector3(),   // crash shake (a damped spring)
    head: new THREE.Vector3(), headSpeed: new THREE.Vector3(),   // driver's head offset from g-forces (a spring)
    headTilt: 0, nod: 0, nodSpeed: 0, lastGear: 1,
    lookYaw: 0, lookPitch: 0,                                    // mouse look
    fovKick: 0,
    // Slow, smoothed copies of the car's motion. The camera follows THESE, not the raw values,
    // so tapping A/D on a keyboard does not jerk the view around.
    calmLat: 0, calmSteer: 0, calmYawRate: 0, calmLong: 0,
    speedFactor: 0,              // 0..1, read by postfx.js for motion blur

    toggle() { rig.mode = rig.mode === 'chase' ? 'cockpit' : 'chase'; },

    // strength 0..1, sideways -1 (hit on the left) .. +1 (right), forward +1 = hit at the front
    // A gust from something rushing past: a quick sideways shove, no forward slam.
    buffet(strength, sideways) { rig.joltSpeed.x += sideways * strength * 5 * FEEL.passBuffet; rig.joltSpeed.y += strength * 1.2 * FEEL.passBuffet; },

    kick(strength, sideways = 0, forward = 1) {
      const s = strength * FEEL.crashShake;
      rig.joltSpeed.x += -sideways * s * 14;
      rig.joltSpeed.y += s * 6 * (Math.random() - 0.3);
      rig.joltSpeed.z += -forward * s * 18;
    },

    snapTo(player) { rig.chaseYaw = player.vehicle.yaw; rig.lookYaw = rig.lookPitch = 0; },

    update(dt, player) {
      const v = player.vehicle, car = player.car;
      rig.time += dt;
      const speedFactor = rig.speedFactor = clamp(v.speed / 75, 0, 1);
      const shake = FEEL.cameraShake;
      rig.calmLat = damp(rig.calmLat, v.accelLat, 2.2, dt);
      rig.calmLong = damp(rig.calmLong, v.accelLong, 3.5, dt);
      rig.calmSteer = damp(rig.calmSteer, v.steerInput, 2.0, dt);
      rig.calmYawRate = damp(rig.calmYawRate, v.yawRate, 2.5, dt);

      // Mouse look: drag to look around, let go and the view swings back.
      if (input.mouse.down) {
        rig.lookYaw = clamp(rig.lookYaw - input.mouse.dx * 0.005, -Math.PI, Math.PI);
        rig.lookPitch = clamp(rig.lookPitch - input.mouse.dy * 0.004, -0.5, 0.6);
      } else {
        rig.lookYaw = damp(rig.lookYaw, 0, 6, dt);
        rig.lookPitch = damp(rig.lookPitch, 0, 6, dt);
      }

      // Crash jolt: a spring that snaps back to zero.
      rig.joltSpeed.addScaledVector(rig.jolt, -240 * dt).multiplyScalar(Math.exp(-10 * dt));
      rig.jolt.addScaledVector(rig.joltSpeed, dt);

      // Tremble (fast, small) and sway (slow, larger). Both grow with speed; gravel is rough.
      const fast = rig.time * (16 + speedFactor * 30), slow = rig.time * 2.3;
      // On asphalt it is a slow, gentle sway (sideways and a little roll) - NOT an up-and-down
      // judder, which just reads as the car bouncing. Gravel is allowed to rattle.
      const buzz = (player.onGravel ? 0.03 : speedFactor * speedFactor * 0.012) * shake * clamp(v.speed / 8, 0, 1);
      const rattle = player.onGravel ? 1 : 0;
      const shakeX = (noise1(slow) - 0.5) * buzz * 1.5 + (noise1(fast) - 0.5) * buzz * rattle;
      const shakeY = (noise1(fast + 37) - 0.5) * buzz * 1.2 * rattle;
      let shakeRoll = (noise1(slow * 1.3 + 91) - 0.5) * buzz * 0.8;
      // DANGER: above ~130 km/h the whole view starts to rattle - small, very fast twists of the
      // camera (not big bounces) that get rougher the faster you go, like a car at its limit.
      const danger = clamp((v.speed - 36) / 45, 0, 1) ** 1.5 * FEEL.dangerShake;
      const rattleT = rig.time * 55;
      const twistX = (noise1(rattleT) - 0.5) * 0.011 * danger;          // pitch, radians
      const twistY = (noise1(rattleT + 17) - 0.5) * 0.009 * danger;     // yaw
      shakeRoll += (noise1(rattleT + 43) - 0.5) * 0.014 * danger;
      // Flooring it shoves the view wider for a moment.
      rig.fovKick = damp(rig.fovKick, clamp(v.accelLong * 0.55, -3, 7) * FEEL.fovKick, 3.5, dt);

      if (rig.mode === 'chase') {
        // Look where the car is GOING more than where it is POINTING, so drifts read clearly.
        const travelYaw = v.speed > 4 ? Math.atan2(-v.vx, -v.vz) : v.yaw;
        const blend = v.forwardSpeed < -1 ? v.yaw : v.yaw + angleDiff(travelYaw, v.yaw) * 0.35;
        rig.chaseYaw += angleDiff(blend, rig.chaseYaw) * (1 - Math.exp(-dt * 4.2));
        // The car pulls away from the camera under power and comes back under braking.
        const wantDistance = lerp(4.6, 6.6, speedFactor) + clamp(rig.calmLong * 0.06, -0.6, 0.8);
        rig.chaseDistance = damp(rig.chaseDistance, wantDistance, 4, dt);
        const yaw = rig.chaseYaw + rig.lookYaw;
        const height = lerp(2.05, 1.6, speedFactor) + rig.lookPitch * 3;     // high enough to see the road over the roof
        const sx = Math.sin(yaw), cz = Math.cos(yaw);
        camera.position.set(v.x + sx * rig.chaseDistance, v.y + height, v.z + cz * rig.chaseDistance);
        camera.lookAt(v.x - sx * 9, v.y + 0.7, v.z - cz * 9);
        camera.position.x += shakeX; camera.position.y += shakeY;
        camera.position.add(tmp.copy(rig.jolt).multiplyScalar(0.8).applyQuaternion(camera.quaternion));
        // Lean with the corner, rock with the jolt.
        camera.rotateZ(clamp(-rig.calmLat * 0.0016, -0.03, 0.03) * FEEL.neck + rig.jolt.x * 0.08 + shakeRoll);
        camera.rotateX(rig.jolt.y * 0.05 + twistX);
        camera.rotateY(twistY);
        camera.fov = damp(camera.fov, GRAPHICS.fovChase + speedFactor * FEEL.speedFov + rig.fovKick, 5, dt);
      } else {
        // --- Neck: the head is a weight on a spring, pushed around by g-forces ---
        const g = FEEL.neck;
        const want = tmp.set(clamp(-rig.calmLat * 0.003, -0.045, 0.045) * g, -Math.abs(rig.calmLong) * 0.001 * g, clamp(rig.calmLong * 0.006, -0.09, 0.05) * g);
        rig.headSpeed.addScaledVector(want.sub(rig.head), 40 * dt).multiplyScalar(Math.exp(-11 * dt));
        rig.head.addScaledVector(rig.headSpeed, dt);
        rig.headTilt = damp(rig.headTilt, clamp(rig.calmLat * 0.0022, -0.04, 0.04) * g, 3, dt);
        // A gear change makes the head nod.
        if (v.gear !== rig.lastGear) { rig.nodSpeed += (v.gear > rig.lastGear ? 0.9 : -0.5) * g; rig.lastGear = v.gear; }
        rig.nodSpeed += (-rig.nod * 120 - rig.nodSpeed * 12) * dt;
        rig.nod += rig.nodSpeed * dt;
        // Engine buzz through the seat near the red line.
        const revs = clamp((v.rpm / v.spec.engine.redline - 0.6) / 0.4, 0, 1) * 0.0022 * shake;

        car.body.updateWorldMatrix(true, false);
        camera.position.copy(player.interior.eye).add(rig.head).add(tmp.copy(rig.jolt).multiplyScalar(0.45));
        camera.position.x += shakeX * 0.8 + (noise1(rig.time * 60) - 0.5) * revs;
        camera.position.y += shakeY * 0.8 + (noise1(rig.time * 60 + 5) - 0.5) * revs;
        camera.position.applyMatrix4(car.body.matrixWorld);
        car.body.getWorldQuaternion(camera.quaternion);
        // Eyes go to the apex: look into the corner, more the harder you turn.
        const lookIn = rig.calmSteer * 0.05 + clamp(rig.calmYawRate * 0.11, -0.16, 0.16);
        tmpE.set(-0.10 + rig.lookPitch + rig.jolt.y * 0.1 + rig.nod * 0.05 + clamp(-v.accelLong * 0.0016, -0.03, 0.03) * g + twistX * 1.3,
          lookIn * g + rig.lookYaw + shakeX * 0.3 + twistY * 1.3,
          rig.jolt.x * 0.14 - rig.headTilt + shakeRoll);
        camera.quaternion.multiply(tmpQ.setFromEuler(tmpE));
        camera.fov = damp(camera.fov, GRAPHICS.fovCockpit + speedFactor * FEEL.speedFov * 0.7 + rig.fovKick, 5, dt);
      }
      camera.updateProjectionMatrix();
      player.interior.group.visible = rig.mode === 'cockpit';

      // Rear-view mirror camera sits at the back window and looks backwards.
      mirrorCamera.position.copy(player.interior.mirrorPosition).applyMatrix4(car.body.matrixWorld);
      car.body.getWorldQuaternion(mirrorCamera.quaternion);
      mirrorCamera.rotateY(Math.PI);
    },
  };
  return rig;
}
