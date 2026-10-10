// Greedy mesher: turns a voxel part into a BufferGeometry, merging same-coloured faces.
import * as THREE from 'three';
import { unkey, type Color } from '../art/kit';

const SHADE = [0.86, 0.78, 1.0, 0.55, 0.92, 0.72]; // +x, -x, +y, -y, +z, -z
const toLinear = (v: number) => Math.pow(v / 255, 2.2);

export function meshVoxels(voxels: Map<number, Color>, offset: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  if (!voxels.size) return new THREE.BufferGeometry();
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const pts: [number, number, number, Color][] = [];
  for (const [k, c] of voxels) {
    const [x, y, z] = unkey(k);
    pts.push([x, y, z, c]);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
  }
  const dims = [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1];
  const grid = new Int32Array(dims[0] * dims[1] * dims[2]).fill(-1);
  const at = (x: number, y: number, z: number) => (x * dims[1] + y) * dims[2] + z;
  for (const [x, y, z, c] of pts) grid[at(x - x0, y - y0, z - z0)] = c;
  const get = (p: number[]) => (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= dims[0] || p[1] >= dims[1] || p[2] >= dims[2] ? -1 : grid[at(p[0], p[1], p[2])]);

  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    for (const dir of [1, -1]) {
      const shadeF = SHADE[d * 2 + (dir > 0 ? 0 : 1)];
      const mask = new Int32Array(dims[u] * dims[v]);
      for (let s = 0; s < dims[d]; s++) {
        // build the face mask for this slice
        const p = [0, 0, 0], q = [0, 0, 0];
        for (let j = 0; j < dims[v]; j++) for (let i = 0; i < dims[u]; i++) {
          p[d] = s; p[u] = i; p[v] = j;
          q[d] = s + dir; q[u] = i; q[v] = j;
          const a = get(p);
          mask[j * dims[u] + i] = a >= 0 && get(q) < 0 ? a : -1;
        }
        // greedy rectangles
        for (let j = 0; j < dims[v]; j++) for (let i = 0; i < dims[u];) {
          const c = mask[j * dims[u] + i];
          if (c < 0) { i++; continue; }
          let w = 1;
          while (i + w < dims[u] && mask[j * dims[u] + i + w] === c) w++;
          let h = 1;
          outer: while (j + h < dims[v]) {
            for (let k = 0; k < w; k++) if (mask[(j + h) * dims[u] + i + k] !== c) break outer;
            h++;
          }
          for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) mask[(j + b) * dims[u] + i + a] = -1;
          // emit the quad
          const base = [0, 0, 0];
          base[d] = s + (dir > 0 ? 1 : 0); base[u] = i; base[v] = j;
          const du = [0, 0, 0], dv = [0, 0, 0];
          du[u] = w; dv[v] = h;
          const corners = [
            [base[0], base[1], base[2]],
            [base[0] + du[0], base[1] + du[1], base[2] + du[2]],
            [base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2]],
            [base[0] + dv[0], base[1] + dv[1], base[2] + dv[2]],
          ];
          const order = dir > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
          const n = [0, 0, 0]; n[d] = dir;
          const r = toLinear((c >> 16) & 255) * shadeF, g = toLinear((c >> 8) & 255) * shadeF, bl = toLinear(c & 255) * shadeF;
          for (const o of order) {
            const cn = corners[o];
            pos.push(cn[0] + x0 - offset[0], cn[1] + y0 - offset[1], cn[2] + z0 - offset[2]);
            nor.push(n[0], n[1], n[2]);
            col.push(r, g, bl);
          }
          i += w;
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
