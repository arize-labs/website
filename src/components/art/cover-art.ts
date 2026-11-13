/**
 * Generated cover art for posts without a `cover` image, drawn at build time
 * as inline SVG in the same print language as the hero and the product art.
 *
 * Every cover is two layers:
 *  - Light, printed as a 45° halftone: round dots on the hero's screen whose
 *    size carries the tone. Fills, glows and shading live here. Where there is
 *    no light the page's faint dot ground shows through, so dark areas are
 *    still dot matrix, as in the hero.
 *  - Structure, in crisp 1px rules: outlines, axes, edges. Lines never get
 *    printed as dots, so they stay sharp at thumbnail size.
 *
 * The rules, so new styles stay consistent:
 *  - One subject, centred in the figure box, with the margins left to the
 *    ground. No text, no frame (the card has its own border).
 *  - Light comes from the upper left. Ink for the subject; signal orange at
 *    most once, for the point of the figure.
 *  - The edges of the light fade out before the card edge, like the hero
 *    band fading into the page.
 *
 * Every drawing is deterministic in its seed (the post id), so a post keeps
 * its art between builds. Colors are CSS variables, so the art follows the
 * theme with no JavaScript.
 *
 * To add a style, write a function `(g, rand, seed) => void` that calls
 * `g.print()` once with its light and adds any rules, and register it in
 * KINDS below; posts can then ask for it with `art: <name>` in frontmatter.
 */
import { CENTER, DOT_R, HOLE, HOLE_R, OUTER, OUTER_R, VIEW, markDistance } from "../heroes/hero-mark";

export const ART_KINDS = ["mark", "pulse", "bloom", "trace", "graph", "signal", "sandbox"] as const;
export type ArtKind = (typeof ART_KINDS)[number];

const W = 400;
const H = 250;
// The figure's box, inside the margins. It is narrow enough to survive the
// square centre crop of phone thumbnails (x 75–325).
const X0 = 84, X1 = 316, Y0 = 56, Y1 = 194;

// The screen: dots on every other cell of a P grid (cells where i + j is
// even), which is a square screen turned 45° with P√2 between neighbours.
// At typical card widths that lands on the hero's 4.4px cell.
const P = 3.2;
const COLS = Math.round(W / P), ROWS = Math.round(H / P);
// Full tone: neighbours just touch, as in the hero's highlights.
const R_MAX = P * 0.74;
// Radius steps. Below MIN_LEVEL a dot is left to the ground.
const LEVELS = 12, MIN_LEVEL = 3;
const GROUND_R = 0.55;

// ---------------------------------------------------------------------------
// Randomness, noise and shape helpers

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (t: number) => t * t * (3 - 2 * t);

function makeNoise(seed: number) {
  const lattice = (x: number, y: number) => (hashString(`${seed}:${x}:${y}`) & 0xffff) / 0xffff;
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number) => 0.5 * noise(x, y) + 0.3 * noise(2 * x, 2 * y) + 0.2 * noise(4 * x, 4 * y);
}

type Pt = [number, number];

/** Signed distance to an axis-aligned box centred on (cx, cy), with corner radius r. */
function sdBox(x: number, y: number, cx: number, cy: number, hw: number, hh: number, r = 0) {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance to a polyline. */
function sdPolyline(x: number, y: number, pts: Pt[]) {
  let d = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1));
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
  }
  return d;
}

function inPolygon(x: number, y: number, poly: Pt[]) {
  let inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a], [xb, yb] = poly[b];
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

/** 1 inside a shape of signed distance d, 0 outside, over a one-dot edge. */
const solid = (d: number) => clamp(0.5 - d / P);
/** Light falling off with distance d outside a shape, over w. */
const glow = (d: number, w: number) => Math.exp(-Math.max(d, 0) / w);

function bezier(a: Pt, b: Pt, n = 24): Pt[] {
  const dx = (b[0] - a[0]) * 0.5;
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n, u = 1 - t;
    return [
      u ** 3 * a[0] + 3 * u * u * t * (a[0] + dx) + 3 * u * t * t * (b[0] - dx) + t ** 3 * b[0],
      u ** 3 * a[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * b[1],
    ] as Pt;
  });
}

const polyD = (pts: Pt[], closed = false) => "M" + pts.map(([x, y]) => `${num(x)} ${num(y)}`).join("L") + (closed ? "Z" : "");

/** A number with one decimal and no padding, for compact path data. */
function num(n: number) {
  const s = String(Math.round(n * 10) / 10);
  return s.replace(/^(-?)0\./, "$1.");
}

// ---------------------------------------------------------------------------
// Drawing surface

/** Light at a point: ink, and optionally signal orange. Both 0–1. */
type Light = (x: number, y: number) => number | [ink: number, accent: number];

type Stroke = "ink" | "soft" | "faint" | "sig";
const STROKES: Record<Stroke, string> = {
  ink: "stroke:var(--fg);stroke-opacity:.85",
  soft: "stroke:var(--fg);stroke-opacity:.45",
  faint: "stroke:var(--fg);stroke-opacity:.2",
  sig: "stroke:var(--accent)",
};

// Small dots read lighter than their size alone suggests against the
// ground, so the smallest steps are also a little transparent.
const levelOpacity = (k: number) => (k <= MIN_LEVEL ? 0.55 : k === MIN_LEVEL + 1 ? 0.75 : 0.92);

class Graphic {
  private dots = new Map<string, string[]>();
  private last = new Map<string, Pt>();
  private rules: string[] = [];
  private defs: string[] = [];
  private grain: (x: number, y: number) => number;
  private id: string;

  /** `id` keeps pattern ids unique when several covers share a page. */
  constructor(id: string, seed: number) {
    this.id = id;
    this.grain = makeNoise(seed + 101);
  }

  private dot(color: "ink" | "sig", k: number, i: number, j: number) {
    const key = `${color}${k}`;
    const prev = this.last.get(key);
    const d = this.dots.get(key) ?? [];
    // Cell indices keep the relative moves exact.
    d.push(prev ? `m${num((i - prev[0]) * P)} ${num((j - prev[1]) * P)}h0` : `M${num((i + 0.5) * P)} ${num((j + 0.5) * P)}h0`);
    this.dots.set(key, d);
    this.last.set(key, [i, j]);
  }

  /**
   * Prints `light` as halftone. Tone fades out toward the card edges, and a
   * little grain keeps flat areas from looking mechanical.
   */
  print(light: Light) {
    for (let j = 0; j < ROWS; j++) {
      for (let i = j & 1; i < COLS; i += 2) {
        const x = (i + 0.5) * P, y = (j + 0.5) * P;
        const v = light(x, y);
        let [ink, sig] = typeof v === "number" ? [v, 0] : v;
        const edge = smooth(clamp(Math.min(x, W - x) / 44)) * smooth(clamp(Math.min(y, H - y) / 30));
        const grain = (this.grain(x / 5, y / 5) - 0.5) * 0.08;
        ink = clamp(ink * edge + (ink > 0.02 ? grain : 0));
        sig = clamp(sig * edge);
        const [color, t] = sig > ink ? (["sig", sig] as const) : (["ink", ink] as const);
        // Dot area tracks tone, so radius goes with its square root.
        const k = Math.round(Math.sqrt(t) * LEVELS);
        if (k >= MIN_LEVEL) this.dot(color, k, i, j);
      }
    }
  }

  line(d: string, stroke: Stroke, { width = 1, dash = "", fill = false } = {}) {
    this.rules.push(
      `<path d="${d}" style="${fill ? "fill:var(--bg);" : ""}${STROKES[stroke]}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
    );
  }

  /**
   * A 1px rule in `color` at `opacity` down to y0 that fades out by y1, for
   * things that emerge from the ground.
   */
  fadeLine(d: string, color: string, opacity: number, y0: number, y1: number) {
    const gid = `fade-${this.id}-${this.defs.length}`;
    this.defs.push(
      `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="${num(y0)}" x2="0" y2="${num(y1)}">` +
        `<stop offset=".3" style="stop-color:${color};stop-opacity:${opacity}"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/>` +
        `</linearGradient>`,
    );
    this.rules.push(`<path d="${d}" stroke="url(#${gid})" stroke-width="1"/>`);
  }

  /** A 1px outlined box, on the half pixel so it is crisp. */
  box(x: number, y: number, w: number, h: number, stroke: Stroke = "ink") {
    const a = Math.round(x) + 0.5, b = Math.round(y) + 0.5;
    this.line(`M${a} ${b}h${Math.round(w) - 1}v${Math.round(h) - 1}h${1 - Math.round(w)}z`, stroke);
  }

  svg(kind: string) {
    const gid = `ground-${this.id}`;
    const ground =
      `<pattern id="${gid}" width="${2 * P}" height="${2 * P}" patternUnits="userSpaceOnUse" style="fill:var(--fg);fill-opacity:.16">` +
      `<circle cx="${P / 2}" cy="${P / 2}" r="${GROUND_R}"/><circle cx="${1.5 * P}" cy="${1.5 * P}" r="${GROUND_R}"/></pattern>`;
    const dots = [...this.dots]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => {
        const sig = key.startsWith("sig"), k = +key.slice(3);
        const style = sig ? "stroke:var(--accent)" : `stroke:var(--fg);stroke-opacity:${levelOpacity(k)}`;
        return `<path style="${style}" stroke-width="${num((2 * R_MAX * k) / LEVELS)}" d="${d.join("")}"/>`;
      })
      .join("");
    return (
      `<svg class="cover-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" data-art="${kind}">` +
      `<defs>${ground}${this.defs.join("")}</defs>` +
      `<rect width="${W}" height="${H}" fill="url(#${gid})"/>` +
      `<g fill="none" stroke-linecap="round">${dots}</g>` +
      `<g fill="none" stroke-linejoin="round">${this.rules.join("")}</g>` +
      `</svg>`
    );
  }
}

// ---------------------------------------------------------------------------
// Kinds

/**
 * Mark: the Arize Labs mark emerging from the dot ground. It prints solid at
 * the apex and dissolves toward its base, where it becomes the ground; its
 * rim is a crisp double rule fading the same way. The centre dot is the one
 * orange element.
 */
function mark(g: Graphic, _rand: Rand, seed: number) {
  const fbm = makeNoise(seed);
  const k = 176 / VIEW.h, cx = W / 2, cy = H / 2 - 4;
  const toMark = (x: number, y: number): Pt => [CENTER[0] + (x - cx) / k, CENTER[1] + (y - cy) / k];
  const toCard = ([x, y]: Pt): Pt => [cx + (x - CENTER[0]) * k, cy + (y - CENTER[1]) * k];
  const top = cy - (VIEW.h / 2) * k, bottom = cy + (VIEW.h / 2) * k;
  /** How far it has emerged at height y: 1 at the apex, nearly 0 at the base. */
  const emerged = (y: number) => 1 - 0.88 * smooth(clamp(((y - top) / (bottom - top)) * 1.3 - 0.3));

  g.print((x, y) => {
    const p = toMark(x, y);
    const d = markDistance(p) * k;
    const rd = (Math.hypot(p[0], p[1]) - DOT_R) * k;
    const e = emerged(y), n = fbm(x / 9, y / 9) - 0.5;
    if (rd < 0) return [0, 0.62 + 0.35 * Math.exp(rd / 3)];
    // The glass: full ink at the top, broken up by noise as it thins, so the
    // base dissolves into the matrix rather than fading evenly. Outside, a
    // halo that thins with it.
    const ink = d < 0
      ? clamp(1.25 * e + 0.9 * n * (1 - e) - 0.08) + 0.25 * Math.exp(d / 3) * e
      : 0.24 * glow(d, 12) * (0.25 + 0.75 * e) + 0.12 * glow(d, 4) * clamp(n + 0.5);
    return [ink, 0.4 * glow(rd, 5)];
  });

  // The double rim: each rounded shape at its edge and a little inside.
  const rounded = (centres: number[][], r: number) => {
    const n = centres.length, out: string[] = [];
    const normal = (a: number[], b: number[]): Pt => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      return [dy / l, -dx / l];
    };
    for (let i = 0; i < n; i++) {
      const a = centres[(i + n - 1) % n], c = centres[i], b = centres[(i + 1) % n];
      const n0 = normal(a, c), n1 = normal(c, b);
      const p0 = toCard([c[0] + r * n0[0], c[1] + r * n0[1]]), p1 = toCard([c[0] + r * n1[0], c[1] + r * n1[1]]);
      out.push(`${i ? "L" : "M"}${num(p0[0])} ${num(p0[1])}A${num(r * k)} ${num(r * k)} 0 0 1 ${num(p1[0])} ${num(p1[1])}`);
    }
    return out.join("") + "Z";
  };
  const circle = (r: number) => {
    const [x, y] = toCard([0, 0]), rr = num(r * k);
    return `M${num(x - r * k)} ${num(y)}a${rr} ${rr} 0 1 0 ${num(2 * r * k)} 0a${rr} ${rr} 0 1 0 ${num(-2 * r * k)} 0Z`;
  };
  const inset = 2.6 / k, fadeTo = bottom + 6;
  g.fadeLine(rounded(OUTER, OUTER_R) + rounded(HOLE, HOLE_R), "var(--fg)", 0.85, top, fadeTo);
  g.fadeLine(rounded(OUTER, OUTER_R - inset) + rounded(HOLE, HOLE_R + inset), "var(--fg)", 0.45, top, fadeTo);
  g.line(circle(DOT_R), "sig");
}

/**
 * Pulse: a heartbeat trace fading in from the left, its glow printed around
 * a crisp line. The latest beat's peak is the orange mark.
 */
function pulse(g: Graphic, rand: Rand, seed: number) {
  const fbm = makeNoise(seed + 3);
  const base = (Y0 + Y1) / 2 + 22;
  const beats = 3, period = (X1 - X0) / (beats + 0.6), first = X0 + period * (0.75 + rand() * 0.2);
  const bump = (x: number, c: number, w: number, a: number) => a * Math.exp(-(((x - c) / w) ** 2));
  const beat = (x: number, c: number) =>
    bump(x, c - 30, 5, 7) + bump(x, c - 4, 1.6, -8) + bump(x, c, 1.8, 82) + bump(x, c + 4, 2, -20) + bump(x, c + 26, 7, 16);
  const peaks = Array.from({ length: beats }, (_, k) => first + k * period);
  const pts: Pt[] = [];
  for (let x = X0; x <= X1; x += 0.75) {
    let y = 0;
    for (const c of peaks) y += beat(x, c);
    y += 3 * (fbm(x / 9, seed % 97) - 0.5);
    pts.push([x, base - y]);
  }
  const fade = (x: number) => smooth(clamp((x - X0) / (period * 1.1)));
  const last = peaks[peaks.length - 1], tip: Pt = [last, base - beat(last, last)];
  // Cull by x: only nearby segments can be close.
  g.print((x, y) => {
    const near = pts.filter(([px]) => Math.abs(px - x) < 16);
    const d = near.length > 1 ? sdPolyline(x, y, near) : Infinity;
    const ink = 0.4 * glow(d, 3.5) * fade(x);
    const td = Math.hypot(x - tip[0], y - tip[1]) - 3;
    return [ink, solid(td) + 0.4 * glow(td, 6)];
  });
  // The line in two passes, so it fades in on the left.
  const split = pts.findIndex(([x]) => x > X0 + period * 1.1);
  g.line(polyD(pts.slice(0, split + 1)), "faint", { width: 1.25 });
  g.line(polyD(pts.slice(split)), "ink", { width: 1.25 });
  // The baseline the trace rides on.
  g.line(`M${X0} ${num(base) + 0.5}H${X1}`, "faint", { dash: "1 3" });
}

/** Bloom: mirrored blobs of light around the card's centre. */
function bloom(g: Graphic, rand: Rand, seed: number) {
  const md = Math.min(W, H) * 1.1;
  const fbm = makeNoise(seed);
  const t = rand() * 20;
  const blobs = Array.from({ length: 4 }, (_, k) => {
    const p = rand() * Math.PI * 2, q = rand() * Math.PI * 2;
    return {
      x: 0.06 + 0.075 * k + 0.05 * Math.sin(t * 0.4 + p),
      y: -0.16 + 0.13 * k + 0.04 * Math.cos(t * 0.33 + q),
      r: 0.1 + 0.035 * Math.sin(t * 0.5 + p + k),
    };
  });
  g.print((x, y) => {
    const u = (x - W / 2) / md, v = (y - H / 2) / md, ax = Math.abs(u);
    let f = 0;
    for (const b of blobs) f += Math.exp(-((ax - b.x) ** 2 + (v - b.y) ** 2) / (b.r * b.r));
    f += 0.9 * (fbm(ax * 5 + 10, v * 5 + 10) - 0.5);
    return clamp(f * 1.2 * Math.exp(-(u * u + v * v) / 0.18) - 0.06);
  });
}

/**
 * Trace: a waterfall. A thin parent span carries the total; model calls are
 * solid, tool calls outlined; the slowest step is the one orange bar. A time
 * axis with dashed gridlines runs underneath.
 */
function trace(g: Graphic, rand: Rand) {
  const steps: { model: boolean; s: number; e: number }[] = [];
  const n = 4 + Math.floor(rand() * 2);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const model = i % 2 === 0;
    const d = model ? 0.8 + rand() * 1.6 : 0.4 + rand() * 1.4;
    steps.push({ model, s: t, e: t + d });
    t += d + 0.1 + rand() * 0.3;
  }
  t -= 0.1;
  const axisY = Y1;
  const xOf = (v: number) => X0 + ((X1 - X0) * v) / t;
  const top = Y0 + 14, rowH = (axisY - 10 - top) / n, barH = Math.min(16, rowH - 6);
  const slowest = steps.reduce((a, b) => (b.e - b.s > a.e - a.s ? b : a));
  const bars = steps.map((st, k) => {
    const x = Math.round(xOf(st.s)), y = Math.round(top + k * rowH + (rowH - barH) / 2);
    return { ...st, x, y, w: Math.max(6, Math.round(xOf(st.e)) - x), h: barH };
  });

  g.print((x, y) => {
    let ink = 0, sig = 0;
    // The parent span.
    const pd = sdBox(x, y, (X0 + xOf(t)) / 2, Y0 + 1.5, (xOf(t) - X0) / 2, 1.5);
    ink = Math.max(ink, 0.6 * solid(pd));
    for (const b of bars) {
      const d = sdBox(x, y, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2);
      // Lit from the left: each fill brightens toward its start.
      const shade = 1 - 0.25 * clamp((x - b.x) / Math.max(b.w, 1));
      if (b === slowest) sig = Math.max(sig, solid(d) * shade + 0.32 * glow(d, 7));
      else ink = Math.max(ink, solid(d) * (b.model ? 0.92 * shade : 0.22) + 0.2 * glow(d, 6));
    }
    return [ink, sig];
  });

  const tick = t > 6 ? 2 : 1;
  for (let s = 0; s <= t; s += tick) {
    const x = Math.round(xOf(s)) + 0.5;
    if (s > 0) g.line(`M${x} ${Y0 + 8}V${axisY}`, "faint", { dash: "1 3" });
    g.line(`M${x} ${axisY}v4`, "soft");
  }
  g.line(`M${X0} ${axisY + 0.5}H${X1}`, "soft");
  for (const b of bars) if (b !== slowest && !b.model) g.box(b.x, b.y, b.w, b.h, "ink");
}

/**
 * Graph: an agent's possible steps. The path it took is lit; the rest are
 * faint rules. One orange marker shows where the run is now.
 */
function graph(g: Graphic, rand: Rand) {
  const layers = 4;
  const cols = Array.from({ length: layers }, (_, l) => {
    const count = l === 0 || l === layers - 1 ? 1 : 2 + Math.floor(rand() * 2);
    const x = X0 + ((X1 - X0) * l) / (layers - 1);
    return Array.from({ length: count }, (_, k): Pt => [x, count === 1 ? (Y0 + Y1) / 2 : Y0 + ((Y1 - Y0) * (k + 0.5)) / count]);
  });
  const lit = cols.map((c) => (rand() * c.length) | 0);
  const path = cols.map((c, l) => c[lit[l]]);
  const litEdges = path.slice(1).map((b, l) => bezier(path[l], b));
  const s = 14;

  // The run's position: halfway along the edge into the last step.
  const lastEdge = litEdges[litEdges.length - 1], marker = lastEdge[lastEdge.length >> 1];

  g.print((x, y) => {
    let ink = 0;
    for (const e of litEdges) ink = Math.max(ink, 0.26 * glow(sdPolyline(x, y, e), 4));
    cols.forEach((c, l) =>
      c.forEach((p, k) => {
        const d = sdBox(x, y, p[0], p[1], s / 2, s / 2);
        ink = Math.max(ink, k === lit[l] ? solid(d) * 0.95 + 0.3 * glow(d, 8) : solid(d) * 0.16);
      }),
    );
    const md = Math.hypot(x - marker[0], y - marker[1]) - 4;
    return [ink, solid(md) + 0.4 * glow(md, 7)];
  });

  for (let l = 0; l < layers - 1; l++) {
    cols[l].forEach((a, i) =>
      cols[l + 1].forEach((b, k) => {
        if (!(i === lit[l] && k === lit[l + 1])) g.line(polyD(bezier(a, b)), "faint");
      }),
    );
  }
  for (const e of litEdges) g.line(polyD(e), "ink", { width: 1.25 });
  cols.forEach((c, l) => c.forEach((p, k) => k !== lit[l] && g.box(p[0] - s / 2, p[1] - s / 2, s, s, "soft")));
}

/**
 * Signal: a score over time with a dashed threshold. The light pools under
 * the curve; the point where it first falls below is the one orange mark.
 */
function signal(g: Graphic, rand: Rand, seed: number) {
  const fbm = makeNoise(seed + 7);
  const phase = rand() * 10, drift = 0.28 + rand() * 0.25;
  const score = (u: number) =>
    clamp(0.74 + 0.08 * Math.sin(u * 6 + phase) - drift * smooth(clamp((u - 0.4) / 0.55)) + 0.1 * (fbm(u * 7, phase) - 0.5), 0.08, 0.95);
  const xOf = (u: number) => X0 + (X1 - X0) * u;
  const yOf = (v: number) => Y1 - v * (Y1 - Y0);
  const N = 80;
  const pts = Array.from({ length: N + 1 }, (_, k): Pt => [xOf(k / N), yOf(score(k / N))]);
  const ty = yOf(0.5 + rand() * 0.08);
  const k = pts.findIndex(([, y], i) => i > 0 && y > ty && pts[i - 1][1] <= ty);
  const breach = k > 0 ? pts[k] : null;

  g.print((x, y) => {
    if (x < X0 || x > X1) return 0;
    const cy = yOf(score((x - X0) / (X1 - X0)));
    // Area under the curve, brightest at the line and falling to the axis.
    const area = y > cy ? 0.5 * Math.exp(-(y - cy) / 34) * clamp((Y1 - y) / 10) : 0;
    const near = pts.filter(([px]) => Math.abs(px - x) < 12);
    const line = 0.3 * glow(sdPolyline(x, y, near), 4);
    const bd = breach ? Math.hypot(x - breach[0], y - breach[1]) - 3.5 : Infinity;
    return [Math.max(area, line), solid(bd) + 0.45 * glow(bd, 7)];
  });
  g.line(polyD(pts), "ink", { width: 1.25 });
  g.line(`M${X0} ${num(ty) + 0.5}H${X1}`, "soft", { dash: "4 3" });
  g.line(`M${X0} ${Y1 + 0.5}H${X1}`, "faint");
}

/**
 * Sandbox: code mode in isometric. A grid of small tool cubes at the base, a
 * sandbox slab floating above them with lines of code on its top, and one
 * result cube on top of that: the only thing that comes back, in orange.
 * Faces are printed by their light (top, left, right); edges are rules.
 */
function sandbox(g: Graphic, rand: Rand) {
  const s = 16, cx = W / 2, cy = H / 2 + 2;
  const C = Math.cos(Math.PI / 6);
  const iso = (x: number, y: number, z: number): Pt => [cx + (x - y) * C * s, cy + ((x + y) * 0.5 - z) * s];

  type Face = { pts: Pt[]; ink: number; sig: number; stroke: Stroke };
  const faces: Face[] = [];
  /** A box from (x, y, z) with size (w, d, h); visible faces only, with their tones. */
  const cube = (x: number, y: number, z: number, w: number, d: number, h: number, stroke: Stroke, tones: [number, number, number], sig = false) => {
    const t = z + h;
    const add = (pts: Pt[], v: number) => faces.push({ pts, ink: sig ? 0 : v, sig: sig ? v : 0, stroke });
    add([iso(x, y, t), iso(x + w, y, t), iso(x + w, y + d, t), iso(x, y + d, t)], tones[0]); // top
    add([iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, t), iso(x, y + d, t)], tones[1]); // left
    add([iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, t), iso(x + w, y, t)], tones[2]); // right
  };

  // Tools: a 4×4 grid on the ground, back to front.
  const n = 4, pitch = 1.3, size = 0.95, half = (n * pitch - (pitch - size)) / 2;
  const tools: Pt[] = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) tools.push([a, b]);
  tools.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
  for (const [a, b] of tools) cube(a * pitch - half, b * pitch - half, -2.8, size, size, 0.55, "soft", [0.3, 0.17, 0.08]);

  // The sandbox slab, and the result cube above it.
  const sw = 3.6, sz = -0.6, sh = 0.9, top = sz + sh;
  cube(-sw / 2, -sw / 2, sz, sw, sw, sh, "ink", [0.5, 0.3, 0.14]);
  const rw = 1.1, rz = top + 1.4;
  cube(-rw / 2, -rw / 2, rz, rw, rw, rw, "sig", [0.95, 0.7, 0.45], true);
  const result = iso(0, 0, rz + rw / 2);

  const boxes = faces.map((f) => {
    const xs = f.pts.map((p) => p[0]), ys = f.pts.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  });
  g.print((x, y) => {
    // Painter's order: the last face drawn over a point is the one seen.
    for (let f = faces.length - 1; f >= 0; f--) {
      const [x0, x1, y0, y1] = boxes[f];
      if (x < x0 || x > x1 || y < y0 || y > y1 || !inPolygon(x, y, faces[f].pts)) continue;
      return [faces[f].ink, faces[f].sig];
    }
    // Nothing solid here: the result's light spills into the air around it.
    return [0, 0.3 * glow(Math.hypot(x - result[0], y - result[1]) - 14, 10)];
  });

  for (const f of faces) g.line(polyD(f.pts, true), f.stroke);
  // Code on the sandbox's top, and a dotted guide up to the result.
  let y = -sw / 2 + 0.55;
  for (let line = 0; line < 5; line++, y += 0.55) {
    const indent = line > 0 && line < 4 ? 0.3 : 0;
    const len = line === 4 ? 0.25 : 1.1 + rand() * 1.5 - indent;
    g.line(polyD([iso(-sw / 2 + 0.45 + indent, y, top), iso(-sw / 2 + 0.45 + indent + len, y, top)]), "ink", { width: 1.5 });
  }
  const [gx, gy0] = iso(0, 0, top), [, gy1] = iso(0, 0, rz);
  g.line(`M${num(gx)} ${num(gy0)}V${num(gy1)}`, "soft", { dash: "1 3" });
}

const KINDS: Record<ArtKind, (g: Graphic, rand: Rand, seed: number) => void> = { mark, pulse, bloom, trace, graph, signal, sandbox };

/**
 * The cover art for `seed` (a post id) as an SVG string. Without a `kind`,
 * the seed picks one, so a run of posts gets a mix.
 */
export function coverArt(seed: string, kind?: ArtKind): string {
  const h = hashString(seed);
  const k = kind ?? ART_KINDS[h % ART_KINDS.length];
  const g = new Graphic(h.toString(36), h);
  KINDS[k](g, rng(h), h);
  return g.svg(k);
}
