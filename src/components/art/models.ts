/**
 * Geometry for the product art, ported from the prototype's 3D playground
 * (website-prototype/prototypes/playground/3d/models.js). Each model is
 * centred and scaled to a unit bounding sphere, and carries an `accent`
 * attribute (1 on parts drawn in signal orange, such as the rack's LEDs).
 */
import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { phoenixGlyph } from "./phoenix-glyph";

export type ModelId = "phoenix" | "rackShort";

const BUILDERS: Record<ModelId, () => THREE.BufferGeometry> = {
  phoenix: buildPhoenix,
  rackShort: () => buildRack(1, 0.8),
};

const cache = new Map<ModelId, THREE.BufferGeometry>();

export function loadModel(id: ModelId): THREE.BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    g = normalise(BUILDERS[id]());
    cache.set(id, g);
  }
  return g;
}

function normalise(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingSphere();
  const s = 1 / g.boundingSphere!.radius;
  g.scale(s, s, s);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Like THREE.EdgesGeometry, but keeps every edge at or above minAngle together
 * with its dihedral angle in degrees (open boundaries count as 180).
 */
export function featureEdges(g: THREE.BufferGeometry, minAngle: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index?.array;
  const tris = (idx ? idx.length : pos.count) / 3;
  const vi = (t: number, k: number) => (idx ? idx[t * 3 + k] : t * 3 + k);
  const prec = 1e4;
  const keyOf = (i: number) => `${Math.round(pos.getX(i) * prec)},${Math.round(pos.getY(i) * prec)},${Math.round(pos.getZ(i) * prec)}`;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const normals = new Float32Array(tris * 3);
  const edges = new Map<string, { v0: number; v1: number; f1: number; f2?: number }>();
  for (let t = 0; t < tris; t++) {
    A.fromBufferAttribute(pos, vi(t, 0));
    B.fromBufferAttribute(pos, vi(t, 1));
    C.fromBufferAttribute(pos, vi(t, 2));
    C.sub(B);
    B.sub(A);
    B.cross(C);
    if (B.lengthSq() < 1e-20) continue;
    B.normalize();
    normals.set([B.x, B.y, B.z], t * 3);
    const keys = [keyOf(vi(t, 0)), keyOf(vi(t, 1)), keyOf(vi(t, 2))];
    for (let k = 0; k < 3; k++) {
      const a = keys[k], b = keys[(k + 1) % 3];
      if (a === b) continue;
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      const e = edges.get(ek);
      if (e) e.f2 ??= t;
      else edges.set(ek, { v0: vi(t, k), v1: vi(t, (k + 1) % 3), f1: t });
    }
  }
  const p: number[] = [], ang: number[] = [];
  for (const e of edges.values()) {
    let deg = 180;
    if (e.f2 !== undefined) {
      const d = normals[e.f1 * 3] * normals[e.f2 * 3] + normals[e.f1 * 3 + 1] * normals[e.f2 * 3 + 1] + normals[e.f1 * 3 + 2] * normals[e.f2 * 3 + 2];
      deg = (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
    }
    if (deg < minAngle) continue;
    p.push(pos.getX(e.v0), pos.getY(e.v0), pos.getZ(e.v0), pos.getX(e.v1), pos.getY(e.v1), pos.getZ(e.v1));
    ang.push(deg);
  }
  return { positions: new Float32Array(p), angles: new Float32Array(ang) };
}

interface Placement { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number }

function kit() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, accent = 0, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 }: Placement = {}) => {
    geo.deleteAttribute("uv");
    geo.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
    geo.setAttribute("accent", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(accent), 1));
    parts.push(geo);
  };
  const box = (w: number, h: number, d: number, at?: Placement, accent = 0) => add(new THREE.BoxGeometry(w, h, d), accent, at);
  return { add, box, done: () => mergeGeometries(parts) };
}

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Metres. A rack unit stays 1U (about 44.5mm) whatever the height, so a short
 * rack holds fewer servers rather than squashed ones. The short one is about
 * 20U by 800mm deep, a common size.
 */
function buildRack(H = 2, D = 0.9) {
  const { box, done } = kit();
  const W = 0.6, U = 2 / 44, rand = rng(42);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, H, 0.035, { x: sx * (W / 2 - 0.0175), z: sz * (D / 2 - 0.0175) });
  for (const sy of [-1, 1]) {
    box(W, 0.04, D, { y: sy * (H / 2 - 0.02) });
    for (const sx of [-1, 1]) box(0.035, 0.035, D, { x: sx * (W / 2 - 0.0175), y: sy * (H / 2 - 0.06) });
  }
  box(W - 0.07, 0.03, 0.02, { y: H / 2 - 0.08, z: D / 2 - 0.01 });
  const plan = [2, 1, 1, 4, 1, 2, 2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 1, 2, 3, 1];
  let y = -H / 2 + 0.1;
  const iw = W - 0.09, front = D / 2 - 0.04;
  for (const u of plan) {
    const h = u * U, cy = y + h / 2;
    if (cy + h / 2 > H / 2 - 0.12) continue;
    box(iw, h * 0.94, D - 0.14, { y: cy, z: -0.02 });
    box(iw + 0.03, h * 0.94, 0.018, { y: cy, z: front });
    for (const sx of [-1, 1]) box(0.018, h * 0.6, 0.03, { x: sx * (iw / 2 - 0.01), y: cy, z: front + 0.02 });
    if (u >= 2) {
      const bays = u >= 3 ? 6 : 4, rows = u >= 4 ? 2 : 1, bw = (iw * 0.62) / bays;
      for (let r = 0; r < rows; r++) for (let b = 0; b < bays; b++) box(bw * 0.86, (h * 0.8) / rows - 0.008, 0.012, { x: -iw * 0.36 + bw * (b + 0.5), y: cy - h * 0.4 + ((r + 0.5) * h * 0.8) / rows, z: front + 0.012 });
    } else {
      for (let v = 0; v < 9; v++) box(0.022, h * 0.45, 0.01, { x: -iw * 0.38 + v * 0.032, y: cy, z: front + 0.01 });
    }
    const leds = 1 + Math.floor(rand() * 3);
    for (let l = 0; l < leds; l++) box(0.014, 0.014, 0.012, { x: iw * 0.36 - l * 0.026, y: cy + h * 0.18, z: front + 0.014 }, rand() < 0.75 ? 1 : 0);
    box(0.06, h * 0.34, 0.008, { x: iw * 0.25, y: cy - h * 0.12, z: front + 0.012 });
    y += h + 0.004;
  }
  return done();
}

/**
 * The Phoenix glyph extruded from its SVG paths. The translucent paths of the
 * flat mark are extruded shallower and set back.
 */
function buildPhoenix() {
  const { add, done } = kit();
  const { paths } = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg">${phoenixGlyph}</svg>`);
  for (const path of paths) {
    const style = path.userData?.style as { opacity?: number } | undefined;
    const soft = (style?.opacity ?? 1) < 1;
    const depth = soft ? 4 : 7;
    for (const shape of path.toShapes()) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 10, bevelEnabled: false });
      add(geo, 0, { rx: Math.PI, z: soft ? -1.5 : 0 });
    }
  }
  return done();
}
