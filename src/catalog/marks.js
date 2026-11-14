// ---------------------------------------------------------------------------
// marks.js — outlines drawn over the 3D view to show what cannot be seen:
//   red boxes      solid things you can crash into
//   green circles  where pressing E does something
//   yellow boxes   where parked cars stand
// libraryPage.js and placesPage.js fill a group with these and hand it to the
// viewer; the "顯示範圍" button switches the group on and off.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const MARK_COLORS = { solid: '#ff5148', interact: '#57ff9a', parking: '#ffd166' };
const line = (color) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });   // drawn through walls

// A box standing on the ground: centre (x, z), turned by `yaw`, `across` wide (its own X) and `along` deep (its own Z).
export function boxMark(x, z, yaw, across, along, height, color) {
  const mark = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(across, height, along)), line(color));
  mark.position.set(x, height / 2, z);
  mark.rotation.y = yaw;
  mark.renderOrder = 10;
  return mark;
}

// A circle on the ground around (x, z).
export function ringMark(x, z, radius, color) {
  const points = Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos(i / 64 * Math.PI * 2) * radius, 0, Math.sin(i / 64 * Math.PI * 2) * radius));
  const mark = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), line(color));
  mark.position.set(x, 0.05, z);
  mark.renderOrder = 10;
  return mark;
}
