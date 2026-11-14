// ---------------------------------------------------------------------------
// collisions.js — what happens when the car hits something.
//
// Two kinds of obstacle:
//   1. the edges of the road (guardrail on the valley side, dirt bank on the
//      hill side, concrete blocks around parking lots)
//   2. other cars
//
// Both use the same idea, an IMPULSE: an instant change of speed applied at
// the point of contact. Because it is applied at the corner that touched, it
// also spins the car — so a glancing hit on the front-left kicks the nose
// right, a tap on the rear spins you, and a square hit just stops you.
//
// A "body" here is any object with:
//   x, z, yaw, vx, vz, yawRate, mass, yawInertia, halfWidth, front, rear
//   (front/rear = distance from the centre to the bumpers)
// ---------------------------------------------------------------------------
import { ROAD } from '../config.js';

const WALL_BOUNCE = 0.18;      // how springy a guardrail is (0 = dead stop, 1 = pinball)
const WALL_FRICTION = 0.32;    // how much scraping along a wall slows you
const CAR_BOUNCE = 0.12;
const CAR_FRICTION = 0.25;

const proj = {};

// Corners of a body in world space: front-left, front-right, rear-left, rear-right.
function corners(body) {
  const fx = -Math.sin(body.yaw), fz = -Math.cos(body.yaw), rx = Math.cos(body.yaw), rz = -Math.sin(body.yaw);
  const list = [];
  for (const [along, side] of [[body.front, -1], [body.front, 1], [-body.rear, -1], [-body.rear, 1]]) {
    list.push({ x: body.x + fx * along + rx * side * body.halfWidth, z: body.z + fz * along + rz * side * body.halfWidth });
  }
  return list;
}

// Apply an impulse (strength j along direction nx,nz) at point (px,pz) of a body.
function applyImpulse(body, j, nx, nz, px, pz) {
  const rxp = px - body.x, rzp = pz - body.z;
  body.vx += (j * nx) / body.mass;
  body.vz += (j * nz) / body.mass;
  body.yawRate += (j * (rzp * nx - rxp * nz)) / body.yawInertia;
}
// How much a body "resists" being pushed at a point along a direction.
function inverseMassAt(body, nx, nz, px, pz) {
  const lever = (pz - body.z) * nx - (px - body.x) * nz;
  return 1 / body.mass + (lever * lever) / body.yawInertia;
}
function pointVelocity(body, px, pz) {
  return { x: body.vx + body.yawRate * (pz - body.z), z: body.vz - body.yawRate * (px - body.x) };
}

/**
 * Keep a body inside the road corridor. Returns null, or a description of the hit:
 * { speed: how hard (m/s into the wall), scrape: sliding speed along it,
 *   side: -1 left / +1 right of the car, x, z }
 */
export function collideWithRoadEdges(body, map) {
  const { road } = map;
  let hit = null;
  let hint = body.roadIndex ?? -1;
  for (const c of corners(body)) {
    map.project(c.x, c.z, hint, proj);
    hint = proj.index;
    const i = proj.index;
    let depth = 0, nx = 0, nz = 0;
    const limit = proj.d > 0 ? map.at(road.limitR, proj.s) : map.at(road.limitL, proj.s);
    if (Math.abs(proj.d) > limit) {                         // through the side barrier
      depth = Math.abs(proj.d) - limit;
      const sign = proj.d > 0 ? -1 : 1;                     // push back toward the centre line
      nx = -road.tz[i] * sign; nz = road.tx[i] * sign;
    }
    const endMargin = 9;                                    // "road closed" barriers at both ends (a loop has none)
    if (!road.closed && proj.s < endMargin && endMargin - proj.s > depth) { depth = endMargin - proj.s; nx = road.tx[i]; nz = road.tz[i]; }
    if (!road.closed && proj.s > road.length - endMargin && proj.s - (road.length - endMargin) > depth) {
      depth = proj.s - (road.length - endMargin); nx = -road.tx[i]; nz = -road.tz[i];
    }
    if (depth > (hit ? hit.depth : 0)) hit = { depth, nx, nz, x: c.x, z: c.z };
  }
  if (!hit) return null;

  // Push the car out of the wall, then bounce + scrape.
  body.x += hit.nx * hit.depth;
  body.z += hit.nz * hit.depth;
  const vel = pointVelocity(body, hit.x, hit.z);
  const into = vel.x * hit.nx + vel.z * hit.nz;             // negative = moving into the wall
  const tx = -hit.nz, tz = hit.nx;
  const along = vel.x * tx + vel.z * tz;
  if (into < 0) {
    const j = (-(1 + WALL_BOUNCE) * into) / inverseMassAt(body, hit.nx, hit.nz, hit.x, hit.z);
    applyImpulse(body, j, hit.nx, hit.nz, hit.x, hit.z);
    const maxFriction = WALL_FRICTION * j;
    const jt = Math.max(-maxFriction, Math.min(maxFriction, -along / inverseMassAt(body, tx, tz, hit.x, hit.z)));
    applyImpulse(body, jt, tx, tz, hit.x, hit.z);
    body.yawRate *= 0.85;                                   // rails damp the spin a little
  }
  const rightX = Math.cos(body.yaw), rightZ = -Math.sin(body.yaw);
  return {
    speed: Math.max(0, -into), scrape: Math.abs(along), x: hit.x, z: hit.z,
    side: (hit.x - body.x) * rightX + (hit.z - body.z) * rightZ > 0 ? 1 : -1,
  };
}

/**
 * Collide two car bodies (rotated rectangles). Returns null or { speed, x, z, nx, nz }.
 * Uses the "separating axis" test: if the rectangles overlap on all four of
 * their edge directions they are touching, and the smallest overlap tells us
 * which way to push them apart.
 */
export function collideCars(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const reach = Math.max(a.front, a.rear) + Math.max(b.front, b.rear) + 1.5;
  if (dx * dx + dz * dz > reach * reach) return null;       // quick reject: too far apart

  const ca = corners(a), cb = corners(b);
  let best = Infinity, nx = 0, nz = 0;
  for (const body of [a, b]) {
    for (const [ax, az] of [[-Math.sin(body.yaw), -Math.cos(body.yaw)], [Math.cos(body.yaw), -Math.sin(body.yaw)]]) {
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const c of ca) { const p = c.x * ax + c.z * az; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
      for (const c of cb) { const p = c.x * ax + c.z * az; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) return null;                        // found a gap: no collision
      if (overlap < best) {
        best = overlap;
        const sign = dx * ax + dz * az > 0 ? 1 : -1;        // normal points from a to b
        nx = ax * sign; nz = az * sign;
      }
    }
  }
  // Contact point: average of the corners that poke into the other car.
  let px = 0, pz = 0, count = 0;
  const inside = (c, body) => {
    const lx = (c.x - body.x) * Math.cos(body.yaw) + (c.z - body.z) * -Math.sin(body.yaw);
    const lf = (c.x - body.x) * -Math.sin(body.yaw) + (c.z - body.z) * -Math.cos(body.yaw);
    return Math.abs(lx) <= body.halfWidth + 0.05 && lf <= body.front + 0.05 && lf >= -body.rear - 0.05;
  };
  for (const c of ca) if (inside(c, b)) { px += c.x; pz += c.z; count++; }
  for (const c of cb) if (inside(c, a)) { px += c.x; pz += c.z; count++; }
  if (count) { px /= count; pz /= count; } else { px = (a.x + b.x) / 2; pz = (a.z + b.z) / 2; }

  // Separate them (the lighter car moves more).
  const total = a.mass + b.mass;
  a.x -= nx * best * (b.mass / total); a.z -= nz * best * (b.mass / total);
  b.x += nx * best * (a.mass / total); b.z += nz * best * (a.mass / total);

  const va = pointVelocity(a, px, pz), vb = pointVelocity(b, px, pz);
  const closing = (vb.x - va.x) * nx + (vb.z - va.z) * nz;  // negative = approaching
  if (closing >= 0) return { speed: 0, x: px, z: pz, nx, nz };
  const j = (-(1 + CAR_BOUNCE) * closing) / (inverseMassAt(a, nx, nz, px, pz) + inverseMassAt(b, nx, nz, px, pz));
  applyImpulse(a, -j, nx, nz, px, pz);
  applyImpulse(b, j, nx, nz, px, pz);
  // Rubbing paint: friction along the contact
  const tx = -nz, tz = nx;
  const sliding = (vb.x - va.x) * tx + (vb.z - va.z) * tz;
  const maxFriction = CAR_FRICTION * j;
  const jt = Math.max(-maxFriction, Math.min(maxFriction, -sliding / (inverseMassAt(a, tx, tz, px, pz) + inverseMassAt(b, tx, tz, px, pz))));
  applyImpulse(a, -jt, tx, tz, px, pz);
  applyImpulse(b, jt, tx, tz, px, pz);
  return { speed: -closing, x: px, z: pz, nx, nz };
}
