// ---------------------------------------------------------------------------
// navArrows.js — the way to go, drawn on the road: a line of glowing chevrons
// along the route for the next few hundred metres, with a pulse of light running
// forward along them. They follow the route round each junction, so where to
// turn is seen on the tarmac before it has to be read off the map.
//
// A route comes from world/roadNet.js (findRoute): a race's shortest way to its
// gate, or the way to the destination picked on the map screen. The chevrons
// stand at fixed places on the road (every SPACING metres of each stretch), so
// they stay put as you drive over them instead of sliding along with the car.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { curvePoint } from '../core/mathUtils.js';

const COUNT = 36;           // chevrons that can be on the road at once
const SPACING = 8;          // metres between them
const FROM = 8, TO = 280;   // how far ahead of the car they are drawn (metres of route)
const CORNER = 13;          // metres either side of a junction that the turn's own curve takes over

export function createNavArrows(scene) {
  // One chevron: a flat "^" lying on the road, pointing the way to drive (-Z).
  const shape = new THREE.Shape();
  [[0, 0.9], [1.0, -0.5], [1.0, -1.1], [0, 0.3], [-1.0, -1.1], [-1.0, -0.5]].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, fog: false });      // (no fog: they are a display, to be read from far off)
  material.polygonOffset = true; material.polygonOffsetFactor = -4; material.polygonOffsetUnits = -4;      // drawn just above the road paint
  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  mesh.frustumCulled = false; mesh.visible = false;
  scene.add(mesh);
  const dummy = new THREE.Object3D(), colour = new THREE.Color(), base = new THREE.Color();
  let places = [];            // where the chevrons are now: [{ x, y, z, yaw, ahead }]

  // The middle of the lanes going `dir` on a way at s: where a chevron sits.
  const laneMiddle = (way, s, dir) => { const i = way.indexAt(s), { road } = way; return dir * (road.median[i] + (road.lanes[i] * road.laneWidth[i]) / 2); };

  // Work out where the chevrons go for this route (called a few times a second: the route only
  // changes when the car moves on or the player picks another destination).
  function layOut(route, net) {
    places = [];
    let before = 0;                                             // metres of route before the stretch being laid out
    route.legs.forEach((leg, k) => {
      const { way, dir } = leg, length = net.distanceAlong(way, leg.from, dir, leg.to);
      const turnsIn = k > 0 && (route.legs[k - 1].way !== way || route.legs[k - 1].dir !== dir);
      const next = route.legs[k + 1], turnsOut = next && (next.way !== way || next.dir !== dir);
      // Along the stretch, at fixed places on the road, leaving the corners to the turns.
      const first = Math.ceil((dir > 0 ? leg.from : -leg.from) / SPACING) * SPACING;       // the first place on the grid, counted the way we drive
      for (let at = first; places.length < COUNT; at += SPACING) {
        const s = dir > 0 ? at : -at, gone = (s - leg.from) * dir, ahead = before + (way.road.closed ? ((gone % way.road.length) + way.road.length) % way.road.length : gone);
        if (ahead - before > length || ahead > TO) break;
        if (ahead < FROM || (turnsIn && ahead - before < CORNER) || (turnsOut && before + length - ahead < CORNER)) continue;
        const p = way.pointAt(way.wrap(s), laneMiddle(way, way.wrap(s), dir));
        places.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw + (dir > 0 ? 0 : Math.PI), ahead });
      }
      // Round the corner onto the next stretch: a smooth curve from this lane to that one.
      if (turnsOut && before + length < TO && length > CORNER) {
        const a = way.pointAt(leg.to - dir * CORNER, laneMiddle(way, leg.to - dir * CORNER, dir));
        const sOut = next.way.wrap(next.from + next.dir * CORNER), b = next.way.pointAt(sOut, laneMiddle(next.way, sOut, next.dir));
        const handle = Math.hypot(b.x - a.x, b.z - a.z) * 0.4;
        const curve = [[a.x, a.z], [a.x + a.tx * dir * handle, a.z + a.tz * dir * handle], [b.x - b.tx * next.dir * handle, b.z - b.tz * next.dir * handle], [b.x, b.z]];
        for (let step = 1; step <= 3 && places.length < COUNT; step++) {
          const t = step / 4, [x, z] = curvePoint(curve, t), [x2, z2] = curvePoint(curve, t + 0.02);
          places.push({ x, y: a.y + (b.y - a.y) * t, z, yaw: Math.atan2(-(x2 - x), -(z2 - z)), ahead: before + length - CORNER + t * 2 * CORNER });
        }
      }
      before += length;
    });
    places.forEach((place, i) => {
      dummy.position.set(place.x, place.y + 0.05, place.z);
      dummy.rotation.set(0, place.yaw, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = places.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    /**
     * Call every frame. route = the way to go (null = nothing to show), color = its colour,
     * time = seconds (for the pulse). `fresh` = the route has just been worked out again.
     */
    update(route, net, color, time, fresh) {
      mesh.visible = Boolean(route);
      if (!route) return;
      if (fresh) layOut(route, net);
      // A pulse of brightness runs away from the car along the chevrons, about once a second.
      base.set(color);
      places.forEach((place, i) => {
        const wave = 1 - (((place.ahead / 70 - time * 0.9) % 1) + 1) % 1;       // 1 at the crest, falling away behind it
        mesh.setColorAt(i, colour.copy(base).multiplyScalar(0.8 + 2.2 * wave ** 3));      // (over 1 = bright enough to glow a little)
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
