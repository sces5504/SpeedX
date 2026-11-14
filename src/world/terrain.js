// ---------------------------------------------------------------------------
// terrain.js — builds the mountain from the (already carved) heightmap.
// Close to the road we use every heightmap cell (10 m). Far away we only use
// every 4th point (40 m) — at night you only see those hills as silhouettes.
// The colour (brush or rock) comes from how steep the ground is — which colours
// is the map's "ground" (see GROUNDS in library.js); a tiling picture of dirt
// and stones adds the fine detail your headlights pick out. Beside the sea the
// lowest few metres get the ground's "shore" colour (sand and wet rock).
//
// The mountain is made as square TILES, not one huge mesh, so that only the
// tiles in view are drawn. A tile the road passes through exists twice: "fine"
// (full detail near the road) for when you are near it and "rough" (40 m
// squares only) for when it is far away — render/drawDistance.js swaps them.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/mathUtils.js';
import { enhanceMaterial, makeGroundTexture, makeNoiseNormalMap } from '../render/materials.js';
import { drawNearOrFar } from '../render/drawDistance.js';
import { GROUNDS } from './library.js';

const BLOCK = 4;            // rough terrain uses 1 of every BLOCK points
const DETAIL_RANGE = 480;   // metres from the road that get full detail
const TILE_BLOCKS = 32;     // a tile is this many blocks across (32 x 40 m = 1280 m)

export function buildTerrain(map) {
  const { heightmap: hm, carved, road } = map;
  const ground = GROUNDS[map.info.ground] || GROUNDS.chaparral;
  const gentle = new THREE.Color(...ground.gentle), steepRock = new THREE.Color(...ground.steep);
  const shore = ground.shore && map.seaLevel !== null ? new THREE.Color(...ground.shore) : null;
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

  const bumps = makeNoiseNormalMap(256, 3.0, 17);
  const material = enhanceMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true, map: makeGroundTexture(), normalMap: bumps, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0 }));
  const group = new THREE.Group();
  group.name = 'terrain';
  for (let tileRow = 0; tileRow < blockRows; tileRow += TILE_BLOCKS) {
    for (let tileCol = 0; tileCol < blockCols; tileCol += TILE_BLOCKS) {
      const lastCol = Math.min(blockCols, tileCol + TILE_BLOCKS), lastRow = Math.min(blockRows, tileRow + TILE_BLOCKS);
      const rough = buildTile(tileCol, tileRow, lastCol, lastRow, false);
      group.add(rough);
      let nearRoad = false;
      for (let br = tileRow; br < lastRow && !nearRoad; br++) for (let bc = tileCol; bc < lastCol; bc++) if (detailed[br * blockCols + bc]) { nearRoad = true; break; }
      if (!nearRoad) continue;                      // far from the road: the rough version is all there is
      const fine = buildTile(tileCol, tileRow, lastCol, lastRow, true);
      group.add(fine);
      drawNearOrFar(fine, rough);
    }
  }
  return group;

  // One tile: the blocks from (firstCol, firstRow) up to (lastCol, lastRow), not included.
  // withDetail = blocks near the road are made of all their 10 m cells; otherwise every block is one 40 m square.
  function buildTile(firstCol, firstRow, lastCol, lastRow, withDetail) {
    const vertexId = new Map();
    const positions = [], normals = [], colors = [], uvs = [], indices = [];
    const color = new THREE.Color(), normal = new THREE.Vector3();
    const heightAt = (c, r) => carved[clamp(r, 0, hm.rows - 1) * hm.cols + clamp(c, 0, hm.cols - 1)];
    // A corner point of the mesh at heightmap column c, row r. `step` = how many cells apart its neighbours are.
    const vertex = (c, r, step) => {
      const g = r * hm.cols + c;
      if (vertexId.has(g)) return vertexId.get(g);
      const h = carved[g];
      positions.push(hm.x0 + c * hm.cell, h, hm.z0 + r * hm.cell);
      uvs.push((c * hm.cell) / 9, (r * hm.cell) / 9);                  // the ground picture repeats every 9 m
      // Which way the ground faces, worked out from the heights around it (not from the triangles),
      // so that neighbouring tiles agree and no seam shows between them.
      normal.set(-(heightAt(c + step, r) - heightAt(c - step, r)), 2 * step * hm.cell, -(heightAt(c, r + step) - heightAt(c, r - step))).normalize();
      normals.push(normal.x, normal.y, normal.z);
      // Colour by steepness: brush on gentle slopes, rock on steep ones.
      const hx = heightAt(c + 1, r) - heightAt(c - 1, r), hz = heightAt(c, r + 1) - heightAt(c, r - 1);
      const steep = clamp(Math.hypot(hx, hz) / (2 * hm.cell) - 0.35, 0, 1);
      const patch = 0.85 + 0.3 * Math.abs(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453 % 1);
      color.copy(gentle).lerp(steepRock, steep);
      if (shore) color.lerp(shore, 1 - smoothstep(1.0, 4.5, h - map.seaLevel));   // the beach: up to a few metres above the water
      color.multiplyScalar(patch);                                       // (the ground picture is dark, so these are light)
      colors.push(color.r, color.g, color.b);
      vertexId.set(g, positions.length / 3 - 1);
      return vertexId.get(g);
    };
    const square = (c, r, step) => {
      const a = vertex(c, r, step), b = vertex(c + step, r, step), d = vertex(c, r + step, step), e = vertex(c + step, r + step, step);
      indices.push(a, d, b, b, d, e);
    };
    for (let br = firstRow; br < lastRow; br++) {
      for (let bc = firstCol; bc < lastCol; bc++) {
        if (withDetail && detailed[br * blockCols + bc]) {
          for (let r = 0; r < BLOCK; r++) for (let c = 0; c < BLOCK; c++) square(bc * BLOCK + c, br * BLOCK + r, 1);
        } else square(bc * BLOCK, br * BLOCK, BLOCK);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}
