// ---------------------------------------------------------------------------
// terrain.js — builds the mountain mesh from the (already carved) heightmap.
// Close to the road we use every heightmap cell (10 m). Far away we only use
// every 4th point (40 m) — at night you only see those hills as silhouettes.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp } from '../core/mathUtils.js';

const BLOCK = 4;            // far terrain uses 1 of every BLOCK points
const DETAIL_RANGE = 480;   // metres from the road that get full detail

export function buildTerrain(map) {
  const { heightmap: hm, carved, road } = map;
  const blockCols = Math.floor((hm.cols - 1) / BLOCK), blockRows = Math.floor((hm.rows - 1) / BLOCK);

  // Mark the blocks that are close to the road.
  const detailed = new Uint8Array(blockCols * blockRows);
  const reach = Math.ceil(DETAIL_RANGE / (hm.cell * BLOCK));
  for (let i = 0; i < road.count; i += 8) {
    const bc = Math.floor((road.x[i] - hm.x0) / (hm.cell * BLOCK));
    const br = Math.floor((road.z[i] - hm.z0) / (hm.cell * BLOCK));
    for (let r = Math.max(0, br - reach); r <= Math.min(blockRows - 1, br + reach); r++) {
      for (let c = Math.max(0, bc - reach); c <= Math.min(blockCols - 1, bc + reach); c++) {
        if ((c - bc) ** 2 + (r - br) ** 2 <= reach * reach) detailed[r * blockCols + c] = 1;
      }
    }
  }

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const group = new THREE.Group();
  group.name = 'terrain';
  group.add(buildGrid(1, (c, r) => detailed[Math.floor(r / BLOCK) * blockCols + Math.floor(c / BLOCK)] === 1));
  group.add(buildGrid(BLOCK, (c, r) => detailed[(r / BLOCK) * blockCols + c / BLOCK] === 0));
  return group;

  // Build one mesh from all grid squares of size `stride` that pass `wanted`.
  function buildGrid(stride, wanted) {
    const vertexId = new Int32Array(hm.cols * hm.rows).fill(-1);
    const positions = [], colors = [], indices = [];
    const color = new THREE.Color();
    const vertex = (c, r) => {
      const g = r * hm.cols + c;
      if (vertexId[g] >= 0) return vertexId[g];
      const h = carved[g];
      positions.push(hm.x0 + c * hm.cell, h, hm.z0 + r * hm.cell);
      // Colour by steepness: dry brush on gentle slopes, pale rock on steep ones.
      const hx = carved[r * hm.cols + Math.min(hm.cols - 1, c + 1)] - carved[r * hm.cols + Math.max(0, c - 1)];
      const hz = carved[Math.min(hm.rows - 1, r + 1) * hm.cols + c] - carved[Math.max(0, r - 1) * hm.cols + c];
      const steep = clamp(Math.hypot(hx, hz) / (2 * hm.cell) - 0.35, 0, 1);
      const patch = 0.85 + 0.3 * Math.abs(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453 % 1);
      color.setRGB(0.20, 0.19, 0.13).lerp(new THREE.Color(0.36, 0.32, 0.26), steep).multiplyScalar(patch);
      colors.push(color.r, color.g, color.b);
      vertexId[g] = positions.length / 3 - 1;
      return vertexId[g];
    };
    const blockColsMax = hm.cols - 1 - ((hm.cols - 1) % BLOCK), blockRowsMax = hm.rows - 1 - ((hm.rows - 1) % BLOCK);
    for (let r = 0; r + stride <= blockRowsMax; r += stride) {
      for (let c = 0; c + stride <= blockColsMax; c += stride) {
        if (!wanted(c, r)) continue;
        const a = vertex(c, r), b = vertex(c + stride, r), d = vertex(c, r + stride), e = vertex(c + stride, r + stride);
        indices.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}
