// ---------------------------------------------------------------------------
// drawDistance.js — only draw what is near.
//
// The world is built in pieces: a kilometre of road ribbon, a square of
// mountain, the guardrail posts of one area... Three.js already skips pieces
// that are behind the camera. This file also skips the ones that are simply
// too far away to be seen at night — the fog has swallowed them — so a long
// map costs no more to draw than a short one.
//
//   drawNear(piece)                 draw this piece only within GRAPHICS.drawDistance
//   drawNearOrFar(fine, rough)      two versions of the same piece: the detailed one
//                                   close up, the rough one from far away
//   updateDrawDistance(position)    once a frame, with where the camera is
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAPHICS } from '../config.js';

const pieces = [];            // { object, centre, radius, limit }
const pairs = [];             // { fine, rough, centre, radius, limit }
const box = new THREE.Box3();

// Where a piece is and how big: the ball that just holds it.
function ballAround(object) {
  const ball = new THREE.Sphere();
  box.setFromObject(object).getBoundingSphere(ball);
  return ball;
}

/** Draw `object` only while the camera is within `limit` metres of it. Returns the object. */
export function drawNear(object, limit = GRAPHICS.drawDistance) {
  const ball = ballAround(object);
  pieces.push({ object, centre: ball.center, radius: ball.radius, limit });
  return object;
}

/** Show `fine` while the camera is within `limit` metres, `rough` (same place, less detail) beyond. */
export function drawNearOrFar(fine, rough, limit = GRAPHICS.detailDistance) {
  const ball = ballAround(fine);
  pairs.push({ fine, rough, centre: ball.center, radius: ball.radius, limit });
  rough.visible = false;
}

export function updateDrawDistance(position) {
  for (const piece of pieces) piece.object.visible = position.distanceTo(piece.centre) - piece.radius < piece.limit;
  for (const pair of pairs) {
    const near = position.distanceTo(pair.centre) - pair.radius < pair.limit;
    pair.fine.visible = near; pair.rough.visible = !near;
  }
}
