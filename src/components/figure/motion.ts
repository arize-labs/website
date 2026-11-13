/**
 * Motion runtime for animated figures.
 *
 * A figure's markup is its finished state: what readers without JavaScript,
 * readers who prefer reduced motion, and printers see. An animated figure
 * registers a scene that, when the figure scrolls into view, puts it in its
 * first frame (`setup`) and plays a timeline (`play`) back to the finished
 * state. Elements are addressed by `data-key`, never by id, so a figure can
 * appear more than once on a page.
 *
 *   defineScene("tool-calling-loop", {
 *     setup(s) { s.hide(["out-1", "out-2"]); s.state(["call-1"], "dim"); },
 *     async play(s) {
 *       s.caption("The user asks a question.");
 *       await s.stream("w-ask", { kind: "call" });
 *       ...
 *     },
 *   });
 *
 * Time freezes while the figure is paused, scrolled away, or in a background
 * tab. After the timeline ends the figure goes back to its markup state and
 * the play button offers a replay.
 */

type El = SVGElement | HTMLElement;
type Keys = string | string[];

export interface SceneDef {
  /** Put the figure in its first frame. Runs before every play. */
  setup?: (s: Scene) => void;
  /** The timeline. Awaits Scene helpers; throws (and is caught) when cancelled. */
  play: (s: Scene) => Promise<void>;
  /** How long the last frame holds before the figure settles, in ms. */
  hold?: number;
}

export interface StreamOptions {
  /** call: one hollow block; result: one accent block; payload: a train of data blocks. */
  kind?: "call" | "payload" | "result";
  /** Number of blocks (payloads); a call or result is always one. */
  n?: number;
  /** How long the whole train takes to pass, in ms. */
  ms?: number;
  /** Travel the path end to start. */
  reverse?: boolean;
}

/** Block sizes in diagram units, along the wire (w) by across it (h). */
const TOKEN_SIZE = {
  call: { w: 14, h: 9, r: 2 },
  result: { w: 14, h: 9, r: 2 },
  payload: { w: 6, h: 6, r: 1 },
} as const;

class Cancelled extends Error {}

const SNAP_ATTRS = ["data-state", "data-off", "width", "height", "x", "y", "opacity", "transform", "stroke-dasharray", "stroke-dashoffset"];
const TEXT_TAGS = new Set(["text", "tspan", "span", "p", "b", "strong", "em", "code"]);
const SVG_NS = "http://www.w3.org/2000/svg";

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOutSine = (p: number) => -(Math.cos(Math.PI * p) - 1) / 2;

interface Snap {
  attrs: Map<string, string | null>;
  html?: string;
  /** Markup text of each line (direct tspan) of a text element, for type(). */
  lines?: string[];
}

export class Scene {
  readonly root: HTMLElement;
  private def: SceneDef;
  private run = 0;
  private snaps = new Map<Element, Snap>();
  private byKey = new Map<string, El>();
  private status: Element | null;
  private step: Element | null;
  private captionSnap: { step: string; text: string };
  /** Frames of tweens parked while time is frozen; run again on wake(). */
  private parked: (() => void)[] = [];
  /** Paused by the reader (sticky) or by scrolling away (automatic). */
  private userPaused = false;
  private offscreen = true;
  private playing = false;
  private started = false;

  constructor(root: HTMLElement, def: SceneDef) {
    this.root = root;
    this.def = def;
    this.status = root.querySelector("[data-fig-status]");
    this.step = root.querySelector("[data-fig-step]");
    this.captionSnap = { text: this.status?.textContent ?? "", step: this.step?.textContent ?? "" };
    this.snapshot();
  }

  // ---- lookup ----------------------------------------------------------

  $(key: string): El {
    const el = this.byKey.get(key);
    if (!el) throw new Error(`figure ${this.root.dataset.scene}: no element with data-key="${key}"`);
    return el;
  }
  private each(keys: Keys, fn: (el: El) => void) {
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => fn(this.$(k)));
  }
  /** The value an attribute has in the markup (finished) state. */
  final(key: string, attr: string): number {
    const v = this.snaps.get(this.$(key))?.attrs.get(attr);
    return v == null ? 0 : parseFloat(v);
  }

  // ---- instant changes -------------------------------------------------

  /** Set data-state (e.g. "active", "dim", "on", "accent"); null clears it. */
  state(keys: Keys, state: string | null) {
    this.each(keys, (el) => (state == null ? el.removeAttribute("data-state") : el.setAttribute("data-state", state)));
  }
  show(keys: Keys, on = true) {
    this.each(keys, (el) => (on ? el.removeAttribute("data-off") : el.setAttribute("data-off", "")));
  }
  hide(keys: Keys) {
    this.show(keys, false);
  }
  text(key: string, value: string) {
    this.$(key).textContent = value;
  }
  attr(keys: Keys, name: string, value: string | number) {
    this.each(keys, (el) => el.setAttribute(name, String(value)));
  }
  /** Write the figure's status line under the frame. */
  caption(text: string, step?: number, of?: number) {
    if (this.status) this.status.textContent = text;
    if (this.step) this.step.textContent = step != null ? `${String(step).padStart(2, "0")}${of ? ` / ${String(of).padStart(2, "0")}` : ""}` : "";
  }

  // ---- time ------------------------------------------------------------

  /** Run fn(eased, linear) every frame for ms of figure time. */
  tween(ms: number, fn: (p: number, linear: number) => void, ease = easeInOut): Promise<void> {
    const run = this.run;
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      let last = performance.now();
      const frame = (now: number) => {
        if (run !== this.run) return reject(new Cancelled());
        // Frozen: stop the loop and do no work until wake() runs it again.
        if (this.frozen) return void this.parked.push(() => requestAnimationFrame((t) => ((last = t), frame(t))));
        elapsed += Math.min(64, now - last);
        last = now;
        const p = Math.min(1, ms <= 0 ? 1 : elapsed / ms);
        fn(ease(p), p);
        if (p >= 1) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }
  wait(ms: number) {
    return this.tween(ms, () => {});
  }
  /**
   * Show elements one after another, each as a whole, `step` ms apart: the
   * build-in for diagrams, in the order a reader would read them. Pass a
   * state to set on each as it appears.
   */
  async reveal(keys: string[], step = 90, state?: string) {
    for (const k of keys) {
      if (state !== undefined) this.state(k, state);
      this.show(k);
      await this.wait(step);
    }
  }
  /** Change the state of elements one after another, `step` ms apart. */
  async sweep(keys: string[], state: string | null, step = 60) {
    for (const k of keys) {
      this.state(k, state);
      await this.wait(step);
    }
  }
  /** Animate a numeric attribute to `to` (default: its markup value). */
  grow(key: string, attr: string, ms: number, to?: number, from?: number) {
    const el = this.$(key);
    const a = from ?? parseFloat(el.getAttribute(attr) ?? "0");
    const b = to ?? this.final(key, attr);
    return this.tween(ms, (p) => el.setAttribute(attr, String(a + (b - a) * p)));
  }
  /** Draw a wire's line from nothing, then reveal its arrowhead. */
  async draw(key: string, ms = 600) {
    const g = this.$(key);
    const path = g.querySelector<SVGPathElement>("path.d-wire-line")!;
    const L = path.getTotalLength();
    this.show(key);
    g.setAttribute("data-drawing", "");
    path.style.strokeDasharray = `${L} ${L}`;
    try {
      await this.tween(ms, (p) => (path.style.strokeDashoffset = String(L * (1 - p))));
    } finally {
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "";
      g.removeAttribute("data-drawing");
    }
  }
  private lines(key: string) {
    return Array.from(this.$(key).querySelectorAll(":scope > tspan"));
  }
  /** Empty the lines of a <text data-key> code block, ready for type(). */
  blank(key: string) {
    this.lines(key).forEach((sp) => (sp.textContent = ""));
  }
  /** Type a <text data-key> code block's lines back in to their markup text. */
  type(key: string, ms: number) {
    const spans = this.lines(key);
    const lines = this.snaps.get(this.$(key))!.lines!;
    const total = lines.join("").length;
    const set = (chars: number) => {
      let left = chars;
      spans.forEach((sp, i) => {
        const full = lines[i] ?? "";
        const take = Math.max(0, Math.min(full.length, left));
        sp.textContent = full.slice(0, take) + (left > 0 && take < full.length ? "▍" : "");
        left -= full.length;
      });
    };
    return this.tween(ms, (_, lin) => set(Math.floor(lin * total)), (p) => p).then(() => set(total));
  }

  // ---- tokens --------------------------------------------------------

  /**
   * Send blocks along a wire (`<g data-key>` holding the wire's path).
   *
   * A call is one hollow block, a result one accent block, and a payload a
   * train of small data blocks packed in lanes, so a bigger payload reads as
   * a longer, wider train. Blocks turn with the wire, grow out of the box
   * they leave and shrink into the box they reach, and pass under the
   * wire's label. No randomness: the same stream looks the same every time.
   */
  async stream(key: string, o: StreamOptions = {}) {
    const g = this.$(key);
    const path = g.querySelector<SVGPathElement>("path.d-wire-line");
    const layer = this.root.querySelector("[data-tokens]");
    if (!path || !layer) return;
    const kind = o.kind ?? "call";
    const n = Math.max(1, o.n ?? (kind === "payload" ? 24 : 1));
    const size = TOKEN_SIZE[kind];
    const lanes = kind !== "payload" ? 1 : n >= 40 ? 3 : n >= 12 ? 2 : 1;
    const pitch = size.w + 3;
    const laneGap = size.h + 2;
    const cols = Math.ceil(n / lanes);
    const train = (cols - 1) * pitch;
    const L = path.getTotalLength();
    // Sample the wire once, a point per unit of length; blocks look up and interpolate.
    const N = Math.ceil(L);
    const pts = Array.from({ length: N + 1 }, (_, i) => path.getPointAtLength(Math.min(i, L)));
    const angles = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)], z = pts[Math.min(N, i + 1)];
      return Math.atan2(z.y - a.y, z.x - a.x);
    });
    const blocks = Array.from({ length: n }, (_, i) => {
      const r = document.createElementNS(SVG_NS, "rect");
      const col = Math.floor(i / lanes), lane = i % lanes;
      r.setAttribute("x", String(-size.w / 2));
      r.setAttribute("y", String(-size.h / 2));
      r.setAttribute("width", String(size.w));
      r.setAttribute("height", String(size.h));
      r.setAttribute("rx", String(size.r));
      r.setAttribute("class", `d-token d-token--${kind}`);
      // A fixed, repeating shade per block, so a train reads as data.
      if (kind === "payload") r.setAttribute("data-shade", String((col * 2 + lane) % 3));
      r.setAttribute("visibility", "hidden");
      layer.appendChild(r);
      return { r, col, off: lanes > 1 ? (lane - (lanes - 1) / 2) * laneGap : 0 };
    });
    // Grow and shrink over the first and last few units of the wire.
    const EDGE = Math.min(12, L / 3);
    // The wire's label mask: blocks tunnel under it rather than cover it.
    // Only when the label sits on the wire; a label beside it is left alone.
    const box = g.querySelector<SVGRectElement>(".d-wire-label rect")?.getBBox();
    const inBox = (q: DOMPoint, b: DOMRect) => q.x >= b.x && q.x <= b.x + b.width && q.y >= b.y && q.y <= b.y + b.height;
    const lb = box && pts.some((q) => inBox(q, box)) ? box : undefined;
    const pad = Math.max(size.w, size.h) / 2 + 1;
    const underLabel = (x: number, y: number) => !!lb && x > lb.x - pad && x < lb.x + lb.width + pad && y > lb.y - pad && y < lb.y + lb.height + pad;
    try {
      await this.tween(
        o.ms ?? (n > 1 ? 1200 : 650),
        (p) => {
          const head = p * (L + train);
          for (const b of blocks) {
            const d = head - b.col * pitch;
            if (d < 0 || d > L) {
              b.r.setAttribute("visibility", "hidden");
              continue;
            }
            const at = o.reverse ? L - d : d;
            const i = Math.min(N - 1, Math.floor(at)), f = at - i;
            const p0 = pts[i], p1 = pts[i + 1];
            const angle = angles[Math.round(at)];
            const x = p0.x + (p1.x - p0.x) * f - Math.sin(angle) * b.off;
            const y = p0.y + (p1.y - p0.y) * f + Math.cos(angle) * b.off;
            if (underLabel(x, y)) {
              b.r.setAttribute("visibility", "hidden");
              continue;
            }
            const scale = Math.max(0.2, Math.min(1, Math.min(d, L - d) / EDGE));
            b.r.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${((angle * 180) / Math.PI).toFixed(1)}) scale(${scale.toFixed(3)})`);
            b.r.setAttribute("visibility", "visible");
          }
        },
        n > 1 ? easeInOutSine : easeInOut,
      );
    } finally {
      blocks.forEach((b) => b.r.remove());
    }
  }

  /** Fly a copy of one element onto another (e.g. a tool chip into the sandbox). */
  async fly(fromKey: string, toKey: string, ms = 900) {
    const from = this.$(fromKey) as SVGGraphicsElement;
    const to = this.$(toKey) as SVGGraphicsElement;
    const layer = this.root.querySelector("[data-tokens]");
    if (!layer) return;
    const a = from.getBBox();
    const b = to.getBBox();
    const ghost = from.cloneNode(true) as SVGGElement;
    ghost.removeAttribute("data-key");
    ghost.querySelectorAll("[data-key]").forEach((e) => e.removeAttribute("data-key"));
    ghost.setAttribute("data-state", "hot");
    ghost.classList.add("d-flyer");
    layer.appendChild(ghost);
    const ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    const bx = b.x + b.width / 2, by = b.y + b.height / 2;
    const scale = Math.min(1, b.height / a.height);
    try {
      await this.tween(
        ms,
        (p) => {
          const s = 1 + (scale - 1) * p;
          const x = ax + (bx - ax) * p, y = ay + (by - ay) * p - Math.sin(p * Math.PI) * 24;
          ghost.setAttribute("transform", `translate(${x - s * ax} ${y - s * ay}) scale(${s})`);
          ghost.setAttribute("opacity", String(p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25));
        },
        easeOut,
      );
    } finally {
      ghost.remove();
    }
  }

  // ---- lifecycle -------------------------------------------------------

  private get frozen() {
    return this.userPaused || this.offscreen;
  }

  /** Re-run parked frames: they resume if time is running, or reject if cancelled. */
  private wake() {
    this.parked.splice(0).forEach((resume) => resume());
  }

  private snapshot() {
    this.root.querySelectorAll<El>("[data-key]").forEach((el) => {
      const key = el.dataset.key!;
      if (!this.byKey.has(key)) this.byKey.set(key, el);
      const attrs = new Map<string, string | null>();
      SNAP_ATTRS.forEach((a) => attrs.set(a, el.getAttribute(a)));
      const leaf = TEXT_TAGS.has(el.tagName.toLowerCase()) && !el.querySelector("[data-key]");
      const lines = leaf ? Array.from(el.querySelectorAll(":scope > tspan"), (sp) => sp.textContent ?? "") : undefined;
      this.snaps.set(el, { attrs, html: leaf ? el.innerHTML : undefined, lines });
    });
  }

  /** Back to the markup (finished) state. */
  restore() {
    this.snaps.forEach((snap, el) => {
      snap.attrs.forEach((v, a) => (v == null ? el.removeAttribute(a) : el.setAttribute(a, v)));
      if (snap.html !== undefined) el.innerHTML = snap.html;
    });
    this.root.querySelector("[data-tokens]")?.replaceChildren();
    if (this.status) this.status.textContent = this.captionSnap.text;
    if (this.step) this.step.textContent = this.captionSnap.step;
  }

  /** First frame, ready to play when it scrolls into view. */
  arm() {
    this.restore();
    this.def.setup?.(this);
    this.root.dataset.motion = "armed";
  }

  async start() {
    const run = ++this.run;
    this.started = true;
    this.playing = true;
    this.userPaused = false;
    this.wake();
    this.arm();
    this.root.dataset.motion = "playing";
    this.syncControls();
    try {
      await this.def.play(this);
      await this.wait(this.def.hold ?? 2400);
      if (run !== this.run) return;
      this.settle();
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    }
  }

  /** Stop and show the finished state. */
  settle() {
    this.run++;
    this.playing = false;
    this.wake();
    this.restore();
    this.root.dataset.motion = "done";
    this.syncControls();
  }

  setOffscreen(off: boolean) {
    this.offscreen = off;
    if (!off && !this.started) void this.start();
    else if (!this.frozen) this.wake();
  }

  toggle() {
    if (!this.playing) return void this.start();
    this.userPaused = !this.userPaused;
    if (!this.frozen) this.wake();
    this.root.dataset.motion = this.userPaused ? "paused" : "playing";
    this.syncControls();
  }

  syncControls() {
    const btn = this.root.querySelector<HTMLButtonElement>('[data-fig-action="toggle"]');
    if (!btn) return;
    const label = !this.playing ? "Play animation" : this.userPaused ? "Resume animation" : "Pause animation";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.dataset.icon = this.playing && !this.userPaused ? "pause" : "play";
  }
}

const reduceQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

/** One observer and one reduced-motion listener for every scene on the page. */
const scenes = new Map<Element, { scene: Scene; stop: () => void }>();
let observer: IntersectionObserver | null = null;
function watch(frame: Element, scene: Scene, stop: () => void) {
  if (!observer) {
    observer = new IntersectionObserver((entries) => entries.forEach((e) => scenes.get(e.target)?.scene.setOffscreen(!e.isIntersecting)), { threshold: 0.45 });
    reduceQuery().addEventListener("change", (e) => e.matches && scenes.forEach((s) => s.stop()));
  }
  scenes.set(frame, { scene, stop });
  observer.observe(frame);
}

/** Register the timeline for every figure on the page with data-scene={name}. */
export function defineScene(name: string, def: SceneDef) {
  const roots = document.querySelectorAll<HTMLElement>(`[data-scene="${name}"]`);
  roots.forEach((root) => {
    if (root.dataset.sceneReady) return;
    root.dataset.sceneReady = "";
    const scene = new Scene(root, def);
    const controls = root.querySelectorAll<HTMLButtonElement>("[data-fig-action]");
    const enable = (on: boolean) => controls.forEach((b) => (b.hidden = !on));

    if (reduceQuery().matches) {
      root.dataset.motion = "static";
      return;
    }
    enable(true);
    scene.syncControls();
    scene.arm();
    controls.forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.figAction === "replay") void scene.start();
        else scene.toggle();
      }),
    );
    watch(root.querySelector(".fig-frame") ?? root, scene, () => {
      scene.settle();
      root.dataset.motion = "static";
      enable(false);
    });
  });
}
