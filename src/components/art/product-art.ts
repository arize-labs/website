/**
 * Product art: a model drawn in hidden line (feature edges solid, occluded
 * edges dashed, a section cut sweeping through in signal orange) over a faint
 * dithered glow of its own silhouette. Ported from the prototype's
 * content/scene3d.js and the playground's "hidden" style, trimmed to what the
 * product scenes use.
 *
 * One transparent WebGL renderer draws every scene in turn and each result is
 * copied into its own 2D canvas, so the page holds a single GL context. The
 * model sways gently about its resting angle rather than spinning, so it
 * always faces the reader rather than turning edge-on. Still under reduced
 * motion; paused offscreen.
 */
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { featureEdges, loadModel, type ModelId } from "./models";

THREE.ColorManagement.enabled = false;

export interface SceneConfig {
  model: ModelId;
  /** Resting pose, degrees: tilt toward the camera, then turn about the vertical. */
  tilt: number;
  yaw: number;
  /** Sway about the resting yaw: amplitude in degrees and period in seconds. */
  sway: number;
  period: number;
  /** 1 fits the model's bounding sphere to the frame's height. */
  zoom: number;
  /** Line weight in CSS pixels. */
  weight: number;
  /** Edge levels: dihedral angles (degrees) mapped from faint to full ink. */
  lo: number;
  hi: number;
}

// Framing as in the prototype; it spun the models through full turns, here
// they sway about the same resting angle instead.
const BASE = { sway: 15, period: 40, zoom: 1.1, weight: 0.8, lo: 10, hi: 14 } as const;
export const SCENES = {
  phoenix: { ...BASE, model: "phoenix", tilt: 12, yaw: -28, zoom: 1.05 },
  rack: { ...BASE, model: "rackShort", tilt: 16, yaw: -24, zoom: 0.95 },
} satisfies Record<string, SceneConfig>;
export type SceneId = keyof typeof SCENES;

const FOV = 28;
const DEG = Math.PI / 180;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Renderer

let renderer: THREE.WebGLRenderer | null = null;
let bufW = 0, bufH = 0;

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

const shared = {
  uBg: { value: new THREE.Color() },
  uSig: { value: new THREE.Color() },
  uDpr: { value: 1 },
};

// Faces paint the page ground so they hide what is behind them; the accent
// parts (the rack's LEDs) and the section cut paint signal orange.
const occluderMaterial = () =>
  new THREE.ShaderMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    side: THREE.DoubleSide,
    uniforms: { ...shared, uCut: { value: -2 }, uCutW: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float accent;
      varying float vA; varying vec3 vP; varying float vFlat;
      void main() {
        vP = position;
        vA = accent;
        vFlat = abs(normal.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying vec3 vP; varying float vFlat;
      uniform vec3 uBg, uSig; uniform float uCut, uCutW, uDpr;
      void main() {
        vec3 c = vA > .5 ? uSig : uBg;
        // The cut is a line across vertical faces. Horizontal faces have no
        // height gradient to measure it by, so they never take it.
        float d = abs(vP.y - uCut) / max(fwidth(vP.y), 1e-6);
        if (uCutW > 0. && vFlat < .98 && d < uCutW * uDpr) c = uSig;
        gl_FragColor = vec4(c, 1.);
      }`,
  });

// Photoshop-style levels on each edge's dihedral angle: below `lo` an edge is
// dropped, above `hi` it is full weight and ink.
type Levels = { uLo: { value: number }; uHi: { value: number } };
function edgeLevels(m: LineMaterial, uniforms: Levels) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace("void main() {", `attribute float instanceEdge;
        uniform float uLo, uHi;
        varying float vLevel;
        void main() {
          vLevel = clamp((instanceEdge - uLo) / max(uHi - uLo, 1e-3), 0., 1.);`)
      .replace("offset *= linewidth;", "offset *= linewidth * vLevel;");
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", "varying float vLevel;\nvoid main() {\nif (vLevel < .004) discard;")
      .replace("float alpha = opacity;", "float alpha = opacity * vLevel;");
  };
  m.customProgramCacheKey = () => "edge-levels";
  return m;
}

function buildHiddenLine(geometry: THREE.BufferGeometry) {
  const e = featureEdges(geometry, 1);
  const geo = new LineSegmentsGeometry().setPositions(e.positions);
  geo.setAttribute("instanceEdge", new THREE.InstancedBufferAttribute(e.angles, 1));
  const levels: Levels = { uLo: { value: 0 }, uHi: { value: 1 } };
  const front = new LineSegments2(geo, edgeLevels(new LineMaterial({ linewidth: 1, worldUnits: false, transparent: true }), levels));
  const back = new LineSegments2(
    geo,
    edgeLevels(new LineMaterial({ linewidth: 1, worldUnits: false, dashed: true, dashSize: 0.025, gapSize: 0.02, transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth }), levels),
  );
  back.computeLineDistances();
  const occ = new THREE.Mesh(geometry, occluderMaterial());
  front.renderOrder = 1;
  back.renderOrder = 2;
  return {
    root: new THREE.Group().add(occ, front, back),
    update(cfg: SceneConfig, ink: string, light: boolean, dpr: number, pw: number, ph: number, t: number) {
      // On paper full-ink outlines and the section cut read heavier than on
      // ink, so light mode softens the visible edges and halves the cut.
      for (const [l, opacity, k] of [[front, light ? 0.66 : 1, 1], [back, 0.4, 0.8]] as const) {
        l.material.color.set(ink);
        l.material.linewidth = cfg.weight * dpr * k;
        l.material.opacity = opacity;
        l.material.resolution.set(pw, ph);
      }
      levels.uLo.value = cfg.lo;
      levels.uHi.value = cfg.hi;
      const u = occ.material.uniforms;
      u.uCutW.value = light ? 0.7 : 1.4;
      const b = geometry.boundingBox!;
      u.uCut.value = b.min.y + (b.max.y - b.min.y) * (0.5 + 0.42 * Math.sin(t * 0.6));
    },
  };
}

// ---------------------------------------------------------------------------
// Glow: the model's silhouette, shrunk, blurred and set as an 8×8 ordered
// dither whose dots are the page's dot ground on a quarter of its 24px pitch,
// registered to it, so the glow reads as the ground thickening. Slow noise
// nudges the threshold so the pattern drifts.

const GLOW_SCALE = 8, GROUND = 24, PITCH = GROUND / 4;
const glowA = document.createElement("canvas"), glowB = document.createElement("canvas");
const mod = (a: number, n: number) => ((a % n) + n) % n;
const B8 = (function bayerMatrix(n: number): number[][] {
  if (n === 1) return [[0]];
  const m = bayerMatrix(n / 2), s = n / 2, q = [[0, 2], [3, 1]];
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => 4 * m[y % s][x % s] + q[(y / s) | 0][(x / s) | 0]));
})(8).flat().map((v) => (v + 0.5) / 64);
const bayer = (x: number, y: number) => B8[((y & 7) << 3) | (x & 7)];
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function hash3(x: number, y: number, z: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
  const a = lerp(lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v);
  const b = lerp(lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v);
  return lerp(a, b, w);
}

function glow(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, src: HTMLCanvasElement, sy: number, pw: number, ph: number, dpr: number, t: number, ink: string, light: boolean) {
  const gw = Math.max(1, Math.round(pw / GLOW_SCALE)), gh = Math.max(1, Math.round(ph / GLOW_SCALE));
  for (const c of [glowA, glowB]) if (c.width !== gw || c.height !== gh) Object.assign(c, { width: gw, height: gh });
  const a = glowA.getContext("2d")!, b = glowB.getContext("2d", { willReadFrequently: true })!;
  a.globalCompositeOperation = "copy";
  a.drawImage(src, 0, sy, pw, ph, 0, 0, gw, gh);
  b.globalCompositeOperation = "copy";
  b.filter = `blur(${Math.max(1, Math.round(gh * 0.05))}px)`;
  b.drawImage(glowA, 0, 0);
  b.globalCompositeOperation = "source-over";
  b.filter = `blur(${Math.max(1, Math.round(gh * 0.15))}px)`;
  b.drawImage(glowA, 0, 0);
  b.filter = "none";
  const alpha = b.getImageData(0, 0, gw, gh).data;

  // The ground's dots sit on the body's horizontal centre and 12px below its
  // top, every 24px (see PageMarkings).
  const r = canvas.getBoundingClientRect(), body = document.body.getBoundingClientRect();
  const ax = body.left + body.width / 2 - r.left, ay = body.top + GROUND / 2 - r.top;
  const ox = mod(ax, PITCH), oy = mod(ay, PITCH);
  const gi0 = Math.round((ox - ax) / PITCH), gj0 = Math.round((oy - ay) / PITCH);
  const w = pw / dpr, h = ph / dpr, edge = 0.1;
  const fade = (u: number) => Math.min(1, u / edge, (1 - u) / edge);
  const strength = light ? 1.1 : 1.05, tz = reduced ? 0 : t * 0.25, rad = dpr;
  const dots = new Path2D();
  for (let y = oy, j = gj0; y < h; y += PITCH, j++) {
    const gy = Math.min(gh - 1, ((y * dpr) / GLOW_SCALE) | 0), fy = fade(y / h);
    for (let x = ox, i = gi0; x < w; x += PITCH, i++) {
      const g = alpha[(gy * gw + Math.min(gw - 1, ((x * dpr) / GLOW_SCALE) | 0)) * 4 + 3] / 255;
      if (g < 0.02) continue;
      const v = Math.sqrt(g) * strength * fy * fade(x / w) + (noise3(i * 0.09, j * 0.09, tz) - 0.5) * 0.14;
      if (bayer(mod(i, 8), mod(j, 8)) >= v) continue;
      dots.moveTo(x * dpr + rad, y * dpr);
      dots.arc(x * dpr, y * dpr, rad, 0, Math.PI * 2);
    }
  }
  ctx.save();
  ctx.fillStyle = ink;
  ctx.globalAlpha = light ? 0.22 : 0.19;
  ctx.fill(dots);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Scenes

function pageColors() {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const light = root.dataset.theme ? root.dataset.theme !== "dark" : !matchMedia("(prefers-color-scheme: dark)").matches;
  return { light, bg: css.getPropertyValue("--bg").trim(), ink: css.getPropertyValue("--fg").trim(), sig: css.getPropertyValue("--color-signal").trim() };
}

interface Scene {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cfg: SceneConfig;
  camera: THREE.PerspectiveCamera;
  pivot: THREE.Group;
  scene: THREE.Scene;
  art: ReturnType<typeof buildHiddenLine>;
  visible: boolean;
  dirty: boolean;
}

function makeScene(canvas: HTMLCanvasElement): Scene | null {
  const cfg: SceneConfig | undefined = SCENES[canvas.dataset.scene as SceneId];
  if (!cfg) return null;
  const art = buildHiddenLine(loadModel(cfg.model));
  const pivot = new THREE.Group().add(art.root);
  return { canvas, ctx: canvas.getContext("2d")!, cfg, camera: new THREE.PerspectiveCamera(), pivot, scene: new THREE.Scene().add(pivot), art, visible: false, dirty: true };
}

function render(s: Scene, t: number) {
  const { width: w, height: h } = s.canvas.getBoundingClientRect();
  if (w < 2 || h < 2) return;
  const gl = getRenderer();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (s.canvas.width !== pw || s.canvas.height !== ph) Object.assign(s.canvas, { width: pw, height: ph });
  const { cfg, camera: cam, pivot } = s;
  const colors = pageColors();

  // Zoom 1 fits the unit bounding sphere to the frame's height.
  const dist = 1 / Math.sin((FOV * DEG) / 2) / cfg.zoom;
  cam.fov = FOV;
  cam.aspect = w / h;
  cam.near = Math.max(0.02, dist - 2);
  cam.far = dist + 2;
  cam.position.set(0, 0, dist);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const sway = reduced ? 0 : cfg.sway * Math.sin((t / cfg.period) * Math.PI * 2);
  pivot.rotation.set(cfg.tilt * DEG, (cfg.yaw + sway) * DEG, 0);
  pivot.updateMatrixWorld(true);

  shared.uBg.value.set(colors.bg);
  shared.uSig.value.set(colors.sig);
  shared.uDpr.value = dpr;
  s.art.update(cfg, colors.ink, colors.light, dpr, pw, ph, reduced ? 0 : t);

  if (pw > bufW || ph > bufH) {
    bufW = Math.max(bufW, pw);
    bufH = Math.max(bufH, ph);
    gl.setSize(bufW, bufH, false);
  }
  gl.setViewport(0, 0, pw, ph);
  gl.clear();
  gl.render(s.scene, cam);

  const src = gl.domElement, sy = bufH - ph;
  s.ctx.setTransform(1, 0, 0, 1, 0, 0);
  s.ctx.clearRect(0, 0, pw, ph);
  glow(s.ctx, s.canvas, src, sy, pw, ph, dpr, t, colors.ink, colors.light);
  s.ctx.drawImage(src, 0, sy, pw, ph, 0, 0, pw, ph);
  s.dirty = false;
}

function hasWebGL() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** Mounts every `canvas[data-scene]` under root. Returns false without WebGL2. */
export function mountProductArt(root: ParentNode = document): boolean {
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>("canvas[data-scene]")];
  if (!canvases.length) return true;
  if (!hasWebGL()) return false;
  const scenes = canvases.map(makeScene).filter((s): s is Scene => !!s);
  const byCanvas = new Map(scenes.map((s) => [s.canvas as Element, s]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) Object.assign(byCanvas.get(e.target)!, { visible: e.isIntersecting, dirty: true });
  }, { rootMargin: "120px" });
  const ro = new ResizeObserver((entries) => entries.forEach((e) => (byCanvas.get(e.target)!.dirty = true)));
  scenes.forEach((s) => { io.observe(s.canvas); ro.observe(s.canvas); });
  const redraw = () => scenes.forEach((s) => (s.dirty = true));
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  const t0 = performance.now();
  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    for (const s of scenes) {
      if (!s.visible || !(s.dirty || !reduced)) continue;
      try { render(s, t); } catch (e) { console.error(s.canvas.dataset.scene, e); s.dirty = false; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}
