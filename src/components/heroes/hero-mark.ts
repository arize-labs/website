/**
 * The hero's glass mark: the Arize Labs mark drawn as halftone glass with a
 * double rim, a halo, a slow glint and a glow that follows the pointer.
 * Ported from the prototype's blossom-mark slice, without the photo: it
 * renders on a transparent canvas so any background art can sit beneath it.
 *
 * Kept light on purpose:
 * - Raw WebGL2, one shader, no textures and no Three.js.
 * - The mark's signed distance is computed analytically (rounded hexagon,
 *   minus a rounded hexagon, plus a circle), so there is no SVG rasterising
 *   or distance transform on the main thread, and edges stay sharp at any
 *   size.
 * - The canvas covers only the mark and its glow, not the whole band.
 * - It draws only while on screen; under reduced motion it draws one still
 *   frame and redraws only on resize or theme change.
 */

// Mark geometry in the mark SVG's units (src/assets/brand/arize-labs-mark.svg).
// Each rounded convex shape is its corner-arc centres plus the arc radius.
export const OUTER = [[-48.069, -444.1], [48.069, -444.1], [408.629, 180.42], [360.569, 263.68], [-360.569, 263.68], [-408.629, 180.42]];
export const OUTER_R = 25;
export const HOLE = [[155.119, 0], [77.559, 134.34], [-77.559, 134.34], [-155.119, 0], [-77.559, -134.34], [77.559, -134.34]];
export const HOLE_R = 50;
export const DOT_R = 80;
export const VIEW = { x: -433.63, y: -469.1, w: 867.26, h: 757.77 };
export const CENTER = [VIEW.x + VIEW.w / 2, VIEW.y + VIEW.h / 2];

// Layout within the band, as in the prototype: the band fades out from 55%
// down, so the mark sits above its centre.
const MARK_Y = 0.44;
const FIT_W = 0.75;
const FIT_H = 0.69;
// Room around the mark for the halo and glow, in mark units.
const PAD = 160;
const INTRO_MS = 1800;
const GLOW_HOME = [-210, 150];

type Vec = number[];

/** Exact signed distance to a polygon (Inigo Quilez). */
function sdPolygon(p: Vec, v: Vec[]) {
  let d = (p[0] - v[0][0]) ** 2 + (p[1] - v[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    const wx = p[0] - v[i][0], wy = p[1] - v[i][1];
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2);
    const a = p[1] >= v[i][1], b = p[1] < v[j][1], c = ex * wy > ey * wx;
    if ((a && b && c) || (!a && !b && !c)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** Signed distance to the mark, in mark units: negative inside the glass. */
export function markDistance(p: Vec) {
  const glass = Math.max(sdPolygon(p, OUTER) - OUTER_R, -(sdPolygon(p, HOLE) - HOLE_R));
  return Math.min(glass, Math.hypot(p[0], p[1]) - DOT_R);
}

const vec2s = (pts: Vec[]) => pts.map(([x, y]) => `vec2(${x.toFixed(3)}, ${y.toFixed(3)})`).join(", ");

/** The mark's signed distance in GLSL, shared with hero-photo.ts. */
export const MARK_GLSL = /* glsl */ `
const vec2 CENTER = vec2(${CENTER[0].toFixed(3)}, ${CENTER[1].toFixed(3)});
const vec2 OUTER[6] = vec2[6](${vec2s(OUTER)});
const vec2 HOLE[6] = vec2[6](${vec2s(HOLE)});

float sdPolygon(vec2 p, vec2 v[6]) {
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0; i < 6; i++) {
    int j = i == 0 ? 5 : i - 1;
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

float sdMark(vec2 p) {
  float glass = max(sdPolygon(p, OUTER) - ${OUTER_R.toFixed(1)}, -(sdPolygon(p, HOLE) - ${HOLE_R.toFixed(1)}));
  return min(glass, length(p) - ${DOT_R.toFixed(1)});
}
`;

/**
 * A 45° screen's dots repeat every cell/√2 px along each axis. Snapping that
 * to whole pixels renders every dot the same, with no beat (streaks).
 */
const snapCell = (cell: number) => Math.max(2, Math.round(cell / Math.SQRT2)) * Math.SQRT2;

/**
 * The band in device pixels, origin bottom-left. Every hero layer prints its
 * screen in this frame, so the dots align.
 */
export function bandFrame(band: { clientWidth: number; clientHeight: number }) {
  const w = band.clientWidth, h = band.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  return {
    w, h, dpr, W, H,
    /** Device px per mark unit. */
    scale: Math.min((w * FIT_W) / VIEW.w, (h * FIT_H) / VIEW.h) * dpr,
    /** The mark's centre in the frame. */
    mark: [W / 2, H * (1 - MARK_Y)] as [number, number],
    /** Halftone cells (open, and behind the glass), in device px. */
    cell: snapCell((w < 640 ? 3.4 : 4.4) * dpr),
    cellFine: snapCell((w < 640 ? 3.4 : 4.4) * dpr * 0.75),
  };
}

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uOrigin;
uniform vec2 uMark;
uniform float uScale;
uniform float uDpr;
uniform float uCell;
uniform float uCellFine;
uniform float uTime;
uniform float uIntro;
uniform vec2 uGlow;
uniform float uGlowBoost;
uniform float uPaper;
out vec4 outColor;

${MARK_GLSL}
const vec3 INK = vec3(0.039, 0.035, 0.031);
const vec3 CREAM = vec3(0.937, 0.914, 0.863);
const vec3 WHITE = vec3(1.0, 0.985, 0.955);

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// Premultiplied "over": lay colour c at alpha a on top of acc.
void over(inout vec4 acc, vec3 c, float a) { acc = vec4(c * a, a) + acc * (1.0 - a); }

void main() {
  // In the band frame, so the screen aligns with the art's.
  vec2 frag = gl_FragCoord.xy + uOrigin;
  // Mark coordinates (y down, like the SVG).
  vec2 p = vec2(frag.x - uMark.x, uMark.y - frag.y) / uScale + CENTER;

  float dMat = sdMark(p);
  float dPx = dMat * uScale;
  float inside = 1.0 - smoothstep(-1.0, 1.0, dPx);
  float deep = smoothstep(0.0, -70.0, dMat);

  // The glass: a quiet frosted tone, a little brighter toward its foot.
  vec2 q = (p - CENTER) / ${VIEW.h.toFixed(2)};
  float frost = 0.2 + 0.08 * q.y + 0.08 * (noise(p / 70.0) - 0.5);
  float level = frost * inside;

  vec2 gp = p - uGlow;
  float glowR = 150.0 * uGlowBoost;
  float bloom = exp(-dot(gp, gp) / (glowR * glowR));
  float breath = 0.9 + 0.1 * sin(uTime * 0.9);
  float glow = bloom * breath * (deep * 0.95 + (1.0 - inside) * 0.2 * exp(-max(dMat, 0.0) / 70.0)) * uIntro;

  float tone = clamp(level * uIntro + glow * 1.1, 0.0, 1.0);
  tone += (hash(floor(frag / uDpr)) - 0.5) * 0.06 * smoothstep(0.02, 0.2, tone);

  float cell = mix(uCell, uCellFine, inside);
  vec2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071) * frag / cell * 6.2832;
  float screen = 0.5 + 0.25 * (cos(r.x) + cos(r.y));
  float fw = fwidth(screen) * 0.75;

  float a = atan(p.y - CENTER.y, p.x - CENTER.x);
  float glint = pow(0.5 + 0.5 * cos(a - uTime * 0.45), 18.0);
  float bw = 5.0 * uDpr;
  float lw = 0.75 * uDpr;
  float band = 1.0 - smoothstep(-0.75, 0.75, abs(dPx + bw * 0.5) - bw * 0.5);
  float rims = max(
    1.0 - smoothstep(lw - 0.75, lw + 0.75, abs(dPx)),
    1.0 - smoothstep(lw - 0.75, lw + 0.75, abs(dPx + bw))
  );
  float halo = exp(-max(dPx, 0.0) / (12.0 * uDpr)) * (1.0 - inside) * 0.35;
  float draw = smoothstep(0.0, 1.0, uIntro * 1.7 - (0.5 + 0.5 * sin(a)) * 0.7);
  float lit = clamp(glow * 1.6 + glint * 0.35, 0.0, 1.0);
  float bandLevel = mix(0.62, 0.9, lit);

  vec4 col = vec4(0.0);
  if (uPaper < 0.5) {
    // Ink ground: light is printed as cream dots.
    // Gate on tone, so bare canvas stays fully transparent.
    float on = smoothstep(1.0 - tone - fw, 1.0 - tone + fw, screen) * smoothstep(0.0, 0.03, tone);
    over(col, CREAM, on * mix(0.55, 1.0, tone));
    over(col, mix(CREAM, WHITE, smoothstep(0.6, 1.0, glow)), smoothstep(0.2, 1.0, glow) * 0.85);
    over(col, CREAM, clamp(halo * mix(0.35, 1.0, lit) * draw, 0.0, 1.0));
    over(col, CREAM, band * draw * bandLevel);
    over(col, mix(CREAM, WHITE, lit), rims * draw);
  } else {
    // Paper ground: the same light is left unprinted, so ink marks the glass.
    float ink = level * 1.4 * uIntro + glow * 0.5;
    float on = smoothstep(1.0 - ink - fw, 1.0 - ink + fw, screen) * smoothstep(0.0, 0.03, ink);
    over(col, INK, on);
    over(col, INK, smoothstep(0.35, 1.0, glow) * 0.5);
    over(col, INK, halo * draw * 0.1);
    over(col, INK, band * draw * bandLevel);
    over(col, INK, rims * draw);
  }
  outColor = col;
}
`;

function compile(gl: WebGL2RenderingContext) {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram()!;
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(program) || "hero mark: link failed");
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.useProgram(program);
  // One triangle that covers the viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const names = ["uOrigin", "uMark", "uScale", "uDpr", "uCell", "uCellFine", "uTime", "uIntro", "uGlow", "uGlowBoost", "uPaper"] as const;
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)])) as Record<(typeof names)[number], WebGLUniformLocation | null>;
}

/**
 * Mounts the mark on `canvas`, laid out within `band`. Returns false when
 * WebGL2 is unavailable, so the caller can show its fallback; `onLost` runs
 * if the GPU context is lost later.
 */
export function mountHeroMark(band: HTMLElement, canvas: HTMLCanvasElement, onLost?: () => void): boolean {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return false;
  let u: ReturnType<typeof compile>;
  try {
    u = compile(gl);
  } catch (e) {
    console.error(e);
    return false;
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const paper = () => (root.dataset.theme === "light" ? 1 : 0);

  // Snap the canvas to whole device pixels so its screen sits on the band frame.
  let scale = 1, markX = 0, markY = 0;
  function layout() {
    const f = bandFrame(band);
    if (!f.w || !f.h) return;
    scale = f.scale / f.dpr;
    markX = f.mark[0] / f.dpr;
    markY = (f.H - f.mark[1]) / f.dpr;
    const dw = Math.round((VIEW.w + PAD * 2) * f.scale), dh = Math.round((VIEW.h + PAD * 2) * f.scale);
    const left = Math.round(f.mark[0] - dw / 2), top = Math.round(f.H - f.mark[1] - dh / 2);
    Object.assign(canvas.style, { width: `${dw / f.dpr}px`, height: `${dh / f.dpr}px`, left: `${left / f.dpr}px`, top: `${top / f.dpr}px` });
    canvas.width = dw;
    canvas.height = dh;
    gl!.viewport(0, 0, dw, dh);
    gl!.uniform2f(u.uOrigin, left, f.H - top - dh);
    gl!.uniform2f(u.uMark, f.mark[0], f.mark[1]);
    gl!.uniform1f(u.uScale, f.scale);
    gl!.uniform1f(u.uDpr, f.dpr);
    gl!.uniform1f(u.uCell, f.cell);
    gl!.uniform1f(u.uCellFine, f.cellFine);
  }

  // Pointer: the glow follows it while it is over (or near) the glass.
  const pointer = [0, 0], glow = [...GLOW_HOME], target = [...GLOW_HOME];
  let hasPointer = false, press = 0;
  const toMark = (e: PointerEvent) => {
    const r = band.getBoundingClientRect();
    pointer[0] = (e.clientX - r.left - markX) / scale + CENTER[0];
    pointer[1] = (e.clientY - r.top - markY) / scale + CENTER[1];
    hasPointer = true;
  };
  const leave = () => (hasPointer = false);
  if (!reduced) {
    canvas.addEventListener("pointermove", toMark);
    canvas.addEventListener("pointerdown", (e) => { toMark(e); press = 1; });
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointercancel", leave);
    canvas.addEventListener("pointerup", (e) => e.pointerType !== "mouse" && leave());
  }

  let time = 0, intro = reduced ? 1 : 0, introStart = -1, last = 0;
  function render() {
    gl!.uniform1f(u.uTime, time);
    gl!.uniform1f(u.uIntro, intro);
    gl!.uniform2f(u.uGlow, glow[0], glow[1]);
    gl!.uniform1f(u.uGlowBoost, 1 + press * 0.8);
    gl!.uniform1f(u.uPaper, paper());
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  // Animate only while the band is on screen.
  let raf = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
    last = now;
    time += dt;
    if (introStart < 0) introStart = now;
    intro = 1 - Math.pow(1 - Math.min((now - introStart) / INTRO_MS, 1), 3);
    if (hasPointer && markDistance(pointer) < 80) target.splice(0, 2, pointer[0], pointer[1]);
    else target.splice(0, 2, GLOW_HOME[0] + Math.sin(time * 0.23) * 120 + Math.sin(time * 0.61) * 40, GLOW_HOME[1] + Math.sin(time * 0.17 + 1.3) * 60);
    const k = 1 - Math.exp(-dt * (hasPointer ? 4 : 1.5));
    glow[0] += (target[0] - glow[0]) * k;
    glow[1] += (target[1] - glow[1]) * k;
    press *= Math.exp(-dt * 2.2);
    render();
  }
  const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  new ResizeObserver(() => { layout(); render(); }).observe(band);
  new MutationObserver(render).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (!reduced) new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(band);
  canvas.addEventListener("webglcontextlost", () => { stop(); onLost?.(); });

  layout();
  render();
  return true;
}
