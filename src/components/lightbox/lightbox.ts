/**
 * Full screen viewer for the images and figures on a page.
 *
 * What it enrols on its own:
 *
 * - Every image in long-form content (`.prose img`) and the post cover,
 *   except images inside a link (they keep their link) or under
 *   `[data-lightbox-off]`.
 * - Every figure (`.fig`). Its "View full screen" button lives in the figure
 *   header (Figure.astro); the script reveals it.
 *
 * Anything else opts in with attributes, no script needed:
 *
 *   <img data-lightbox ...>                         an image
 *   <div data-lightbox data-lightbox-title="…">     any element, shown live
 *   data-lightbox-group="name"                      on the item or an ancestor: its own sequence
 *   data-lightbox-caption="…"                       caption text (else the item's figcaption)
 *   data-lightbox-src="…"                           a larger file to show full screen (images)
 *   data-lightbox-off                               on the item or an ancestor: don't enrol
 *
 * Items in the same group form one sequence in document order; without a
 * group, everything on the page is one sequence. Images are shown as a new
 * <img> at the largest size that fits, upgraded to the biggest srcset
 * candidate. Figures and other elements are moved into the viewer live (and
 * back on close), so animations, tooltips and controls keep working; a
 * placeholder holds their place and their figure number.
 *
 * Keys: ← → step, Home / End jump, Esc closes. Touch: swipe sideways.
 * Trackpad: swipe sideways. Focus is trapped in the viewer and returns to
 * the item's button on close.
 *
 * From script: openLightbox(element) or openLightbox([{ src, alt, caption }], 0).
 */

export interface ImageSpec {
  src: string;
  srcset?: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

interface Item {
  kind: "image" | "live";
  /** The element on the page this item comes from (absent for script-only images). */
  source?: HTMLElement;
  /** The button that opens it, where focus returns on close. */
  button?: HTMLElement;
  image?: ImageSpec;
  title: string;
  caption: () => Node[];
  /** Figure number, for figures: kept while the figure is out of the page. */
  figNum?: number;
}

interface Slide {
  item: Item;
  el: HTMLElement;
  /** The image or moved element: what the open and close animations move. */
  content: HTMLElement;
  /** Live items: puts the element back, and the placeholder holding its place. */
  restore?: () => void;
  ph?: HTMLElement;
}

const DEFAULT_GROUP = "page";
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const OPEN_MS = 380;
const STEP_MS = 280;
const SWIPE_PX = 64;
const SWIPE_VELOCITY = 0.35;

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Move a node without tearing it down (keeps video playing, iframes loaded) where supported. */
function move(node: Node, parent: Node, before: Node | null = null) {
  const p = parent as ParentNode & { moveBefore?: (n: Node, c: Node | null) => void };
  if (typeof p.moveBefore === "function" && node.isConnected && (parent as Node).isConnected) {
    try {
      p.moveBefore(node, before);
      return;
    } catch {
      /* fall through: not movable atomically */
    }
  }
  parent.insertBefore(node, before);
}

const ICONS = {
  expand: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  prev: '<path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;

/* ---- Items ------------------------------------------------------------ */

const groupOf = (el: HTMLElement) => el.closest<HTMLElement>("[data-lightbox-group]")?.dataset.lightboxGroup || DEFAULT_GROUP;

/** The "View full screen" button enrol() put in the item's box. */
const buttonOf = (el: HTMLElement) => el.closest(".lb-frame")?.querySelector<HTMLElement>(":scope > .lb-expand") ?? undefined;

function captionOf(el: HTMLElement, own?: HTMLElement | null): () => Node[] {
  return () => {
    const text = el.dataset.lightboxCaption;
    if (text) return [document.createTextNode(text)];
    return own ? Array.from(own.childNodes, (n) => n.cloneNode(true)) : [];
  };
}

function figNumber(fig: HTMLElement) {
  const scope = fig.closest(".prose") ?? document;
  return Array.from(scope.querySelectorAll(".fig, .lb-placeholder[data-fig]")).indexOf(fig) + 1;
}

function itemFor(el: HTMLElement): Item {
  if (el instanceof HTMLImageElement) {
    const figure = el.closest("figure");
    // Both sides from the attributes or both from the file, never one of each,
    // so the image keeps its shape.
    const aw = Number(el.getAttribute("width"));
    const ah = Number(el.getAttribute("height"));
    const [width, height] = aw && ah ? [aw, ah] : [el.naturalWidth, el.naturalHeight];
    return {
      kind: "image",
      source: el,
      button: buttonOf(el),
      image: {
        src: el.dataset.lightboxSrc || el.currentSrc || el.src,
        srcset: el.dataset.lightboxSrc ? undefined : el.srcset || undefined,
        alt: el.alt,
        width: width || undefined,
        height: height || undefined,
      },
      title: el.dataset.lightboxTitle || el.alt || "Image",
      caption: captionOf(el, figure?.querySelector<HTMLElement>(":scope > figcaption")),
    };
  }
  if (el.classList.contains("fig")) {
    const n = figNumber(el);
    const name = el.querySelector(".fig-title")?.textContent?.trim() ?? "";
    return {
      kind: "live",
      source: el,
      button: el.querySelector<HTMLElement>("[data-fig-expand]") ?? undefined,
      title: `Fig. ${pad2(n)}${name ? `: ${name}` : ""}`,
      caption: captionOf(el, el.querySelector<HTMLElement>(":scope > figcaption")),
      figNum: n,
    };
  }
  return {
    kind: "live",
    source: el,
    button: buttonOf(el),
    title: el.dataset.lightboxTitle || el.getAttribute("aria-label") || "Item",
    caption: captionOf(el, el.querySelector<HTMLElement>(":scope > figcaption")),
  };
}

/** Every enrolled item in el's group, in document order. */
function sequenceFor(el: HTMLElement) {
  const group = groupOf(el);
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-lb-ready]")).filter((e) => groupOf(e) === group);
  return { items: els.map(itemFor), index: Math.max(0, els.indexOf(el)) };
}

/* ---- Enrolment -------------------------------------------------------- */

function expandButton(label: string) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lb-expand";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = icon("expand");
  return b;
}

/** Items whose button can't go inside them. */
const BOXED = "img, picture, video, audio, iframe, canvas, embed, object, svg, table";

function enroll(el: HTMLElement) {
  if (el.dataset.lbReady !== undefined || el.closest(".lb, [data-lightbox-off]")) return;
  // Images keep their link, and images inside a figure or another item go with it.
  if (el instanceof HTMLImageElement && el.closest("a, .fig, [data-lightbox]:not(img)")) return;

  if (el.classList.contains("fig")) {
    const btn = el.querySelector<HTMLButtonElement>("[data-fig-expand]");
    if (!btn) return;
    el.dataset.lbReady = "";
    btn.hidden = false;
    btn.addEventListener("click", () => openLightbox(el));
    return;
  }

  el.dataset.lbReady = "";
  const isImage = el instanceof HTMLImageElement;
  // The button needs a positioned box around the item to sit in its corner.
  // Images, media and tables can't hold it (their children aren't drawn, or
  // break the table), so they get a box of their own; an image in a <picture>
  // is boxed with its <picture>, so it keeps its sources.
  let frame = el;
  if (el.matches(BOXED)) {
    const box = isImage && el.parentElement instanceof HTMLPictureElement ? el.parentElement : el;
    frame = document.createElement("span");
    frame.className = isImage ? "lb-frame lb-frame-img" : "lb-frame";
    box.replaceWith(frame);
    frame.append(box);
  } else {
    el.classList.add("lb-frame");
  }
  if (isImage) el.addEventListener("click", () => openLightbox(el));
  const title = el.dataset.lightboxTitle || (isImage ? (el as HTMLImageElement).alt : "");
  const button = expandButton(title ? `View full screen: ${title}` : "View full screen");
  button.addEventListener("click", () => openLightbox(el));
  frame.append(button);
}

/** Enrol everything under root. Safe to call again after adding content. */
export function initLightbox(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLElement>(".prose img, .cover img, img[data-lightbox], .fig, [data-lightbox]")
    .forEach(enroll);
}

/* ---- Viewer ----------------------------------------------------------- */

class Viewer {
  dialog!: HTMLDialogElement;
  stage!: HTMLElement;
  veil!: HTMLElement;
  chrome!: HTMLElement[];
  count!: HTMLElement;
  cap!: HTMLElement;
  capInner!: HTMLElement;
  thumbs!: HTMLElement;
  prev!: HTMLButtonElement;
  next!: HTMLButtonElement;
  announcer!: HTMLElement;

  items: Item[] = [];
  index = 0;
  current: Slide | null = null;
  /** The slide on its way out, and its animations; finished early by settle(). */
  leaving: { slide: Slide; anims: Animation[] } | null = null;
  /** Closing: input is ignored until the viewer is gone. */
  busy = false;
  isOpen = false;
  /** The open animation, finished early if the reader acts before it ends. */
  opening: Animation[] | null = null;

  private built = false;
  private fitFrame = 0;

  build() {
    if (this.built) return;
    this.built = true;
    const d = document.createElement("dialog");
    d.className = "lb";
    d.tabIndex = -1;
    d.innerHTML = `
      <div class="lb-veil" aria-hidden="true"></div>
      <div class="lb-top lb-chrome">
        <p class="lb-count" aria-hidden="true"></p>
        <p class="lb-hint" aria-hidden="true"><span class="lb-hint-browse"><kbd>←</kbd><kbd>→</kbd>Browse</span><span><kbd>Esc</kbd>Close</span></p>
        <button type="button" class="lb-btn lb-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button>
      </div>
      <button type="button" class="lb-btn lb-prev lb-chrome" aria-label="Previous" title="Previous (←)">${icon("prev")}</button>
      <div class="lb-stage"></div>
      <button type="button" class="lb-btn lb-next lb-chrome" aria-label="Next" title="Next (→)">${icon("next")}</button>
      <div class="lb-cap lb-chrome"><div class="lb-cap-inner"></div></div>
      <div class="lb-thumbs lb-chrome" role="group" aria-label="All items"></div>
      <p class="visually-hidden" role="status"></p>`;
    document.body.append(d);

    this.dialog = d;
    this.veil = d.querySelector(".lb-veil")!;
    this.stage = d.querySelector(".lb-stage")!;
    this.chrome = Array.from(d.querySelectorAll<HTMLElement>(".lb-chrome"));
    this.count = d.querySelector(".lb-count")!;
    this.cap = d.querySelector(".lb-cap")!;
    this.capInner = d.querySelector(".lb-cap-inner")!;
    this.thumbs = d.querySelector(".lb-thumbs")!;
    this.prev = d.querySelector(".lb-prev")!;
    this.next = d.querySelector(".lb-next")!;
    this.announcer = d.querySelector('[role="status"]')!;

    d.querySelector(".lb-close")!.addEventListener("click", () => this.close());
    this.prev.addEventListener("click", () => this.step(-1));
    this.next.addEventListener("click", () => this.step(1));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      void this.close();
    });
    d.addEventListener("keydown", (e) => this.onKey(e));
    d.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    d.addEventListener("click", (e) => {
      // A click on the empty ground around the item closes, as on a backdrop.
      if (this.swiped) return void (this.swiped = false);
      const t = e.target as HTMLElement;
      if (t === d || t.matches(".lb-veil, .lb-stage, .lb-slide, .lb-top, .lb-cap, .lb-thumbs")) void this.close();
    });
    this.wireSwipe();
    new ResizeObserver(() => {
      cancelAnimationFrame(this.fitFrame);
      this.fitFrame = requestAnimationFrame(() => this.current && this.fit(this.current));
    }).observe(this.stage);
    window.visualViewport?.addEventListener("resize", () => {
      d.toggleAttribute("data-zoomed", (window.visualViewport?.scale ?? 1) > 1.01);
    });
  }

  /* -- Open and close -- */

  open(items: Item[], index: number) {
    if (this.isOpen || this.busy || !items.length) return;
    this.build();
    this.items = items;
    this.index = index;
    this.isOpen = true;

    const item = items[index];
    const from = item.source?.getBoundingClientRect();
    document.documentElement.dataset.lbOpen = "";
    this.dialog.showModal();
    this.dialog.toggleAttribute("data-single", items.length < 2);
    this.renderThumbs();
    const slide = this.mount(item);
    this.current = slide;
    this.sync(true);
    this.dialog.focus({ preventScroll: true });

    const anims = [
      this.veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.8, easing: "ease-out" }),
      ...this.chrome.map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.7, delay: OPEN_MS * 0.35, easing: "ease-out", fill: "backwards" })),
      this.flip(slide.content, from, "in"),
    ];
    this.opening = anims;
    Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
      if (this.opening === anims) this.opening = null;
    });
  }

  private finishOpening() {
    const anims = this.opening;
    this.opening = null;
    anims?.forEach((a) => a.finish());
  }

  async close() {
    if (!this.isOpen || this.busy) return;
    this.busy = true;
    this.finishOpening();
    this.settle();
    const slide = this.current!;
    const item = slide.item;

    // Land the page on the item being viewed, so the reader is where they browsed to.
    const target = slide.ph ?? item.source;
    if (target) {
      const r = target.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) target.scrollIntoView({ block: "center", behavior: "instant" });
    }
    const to = target?.getBoundingClientRect();
    const anims = [
      this.veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OPEN_MS * 0.8, easing: "ease-in", fill: "forwards" }),
      ...this.chrome.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OPEN_MS * 0.4, easing: "ease-in", fill: "forwards" })),
      this.flip(slide.content, to, "out"),
    ];
    await Promise.all(anims.map((a) => a.finished.catch(() => {})));

    this.unmount(slide);
    this.current = null;
    this.dialog.close();
    anims.forEach((a) => a.cancel());
    delete document.documentElement.dataset.lbOpen;
    this.isOpen = false;
    this.busy = false;
    (item.button ?? item.source)?.focus({ preventScroll: true });
  }

  /** Animate el between its place on the page (rect) and its place in the viewer. */
  private flip(el: HTMLElement, rect: DOMRect | undefined, dir: "in" | "out") {
    const here = el.getBoundingClientRect();
    let frames: Keyframe[];
    if (rect && rect.width > 0 && here.width > 0 && !reduced()) {
      const s = rect.width / here.width;
      const away = { transformOrigin: "0 0", transform: `translate(${rect.left - here.left}px, ${rect.top - here.top}px) scale(${s})` };
      const home = { transformOrigin: "0 0", transform: "none" };
      frames = dir === "in" ? [away, home] : [home, away];
    } else {
      frames = dir === "in" ? [{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }] : [{ opacity: 1 }, { opacity: 0 }];
    }
    return el.animate(frames, { duration: reduced() ? 160 : OPEN_MS, easing: EASE, fill: dir === "out" ? "forwards" : "none" });
  }

  /* -- Slides -- */

  private mount(item: Item): Slide {
    const el = document.createElement("div");
    el.className = "lb-slide";
    el.dataset.kind = item.kind;
    this.stage.append(el);

    if (item.kind === "image") {
      const spec = item.image!;
      const media = document.createElement("div");
      media.className = "lb-media";
      const img = document.createElement("img");
      img.alt = spec.alt ?? "";
      img.decoding = "async";
      img.src = spec.src;
      if (spec.width && spec.height) {
        img.width = spec.width;
        img.height = spec.height;
      }
      media.append(img);
      el.append(media);
      // Show the file the page already has at once, then swap in the largest one.
      if (spec.srcset) {
        const hi = new Image();
        hi.sizes = "100vw";
        hi.srcset = spec.srcset;
        hi.src = spec.src;
        hi.decode().then(() => (img.src = hi.currentSrc || hi.src), () => {});
      }
      img.addEventListener("load", () => {
        // The attributes give the page's size; the file shown can be bigger
        // (data-lightbox-src), and is only capped at its own size.
        if (!spec.srcset && img.naturalWidth > (spec.width ?? 0)) {
          spec.width = img.naturalWidth;
          spec.height = img.naturalHeight;
        }
        if (this.current?.content === media) this.fit(this.current);
      });
      item.source?.setAttribute("data-lb-active", "");
      const slide: Slide = { item, el, content: media };
      this.fit(slide);
      return slide;
    }

    // Live: move the element in, leaving a placeholder that keeps its size, place and figure number.
    const src = item.source!;
    const r = src.getBoundingClientRect();
    const cs = getComputedStyle(src);
    const ph = document.createElement("div");
    ph.className = "lb-placeholder";
    ph.setAttribute("aria-hidden", "true");
    if (item.figNum) ph.dataset.fig = "";
    ph.style.cssText = `width:${r.width}px;height:${r.height}px;margin:${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`;
    const style = src.getAttribute("style");
    src.before(ph);
    move(src, el);
    if (item.figNum) src.style.counterReset = `fig ${item.figNum - 1}`;
    src.classList.add("lb-live");

    const slide: Slide = {
      item,
      el,
      content: src,
      ph,
      restore: () => {
        src.classList.remove("lb-live");
        if (style === null) src.removeAttribute("style");
        else src.setAttribute("style", style);
        move(src, ph.parentNode!, ph);
        ph.remove();
      },
    };
    this.fit(slide);
    return slide;
  }

  private unmount(slide: Slide) {
    if (slide.el.contains(document.activeElement) && this.isOpen) this.dialog.focus({ preventScroll: true });
    slide.item.source?.removeAttribute("data-lb-active");
    slide.restore?.();
    slide.el.remove();
  }

  /** Size the slide's content to the largest that fits the stage. */
  private fit(slide: Slide) {
    const cs = getComputedStyle(slide.el);
    const w = slide.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = slide.el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return;

    if (slide.item.kind === "image") {
      const media = slide.content;
      const img = media.querySelector("img")!;
      const iw = slide.item.image!.width || img.naturalWidth;
      const ih = slide.item.image!.height || img.naturalHeight;
      if (!iw || !ih) return;
      // The frame's border is outside the image, so leave room for it.
      const bw = media.offsetWidth - media.clientWidth;
      const bh = media.offsetHeight - media.clientHeight;
      // Never past the file's own size, so screenshots stay crisp.
      const s = Math.min((w - bw) / iw, (h - bh) / ih, 1);
      img.style.width = `${Math.floor(iw * s)}px`;
      img.style.height = `${Math.floor(ih * s)}px`;
      return;
    }

    // Live content: height grows with width for diagrams (SVG) and barely for
    // charts (HTML). Measure at two widths, solve for the width that fills the
    // stage's height, and cap prose-width figures at the content column.
    const el = slide.content;
    const capRaw = el.dataset.width === "prose" ? getComputedStyle(document.documentElement).getPropertyValue("--content-max") : "";
    const cap = Math.min(w, parseFloat(capRaw) || Infinity);
    el.style.width = `${cap}px`;
    const h1 = el.offsetHeight;
    if (h1 <= h) return;
    el.style.width = `${cap / 2}px`;
    const h2 = el.offsetHeight;
    const slope = (h1 - h2) / (cap / 2);
    const fixed = h1 - slope * cap;
    const fitted = slope > 0.05 ? (h - fixed) / slope : cap;
    el.style.width = `${Math.max(Math.min(cap, 320), Math.min(cap, fitted))}px`;
  }

  /* -- Navigation -- */

  step(by: number, fromX = 0) {
    this.go(this.index + by, fromX);
  }

  go(i: number, fromX = 0) {
    if (!this.isOpen || this.busy) return;
    if (i < 0 || i >= this.items.length) return this.bounce(i < 0 ? -1 : 1, fromX);
    if (i === this.index) return;
    this.finishOpening();
    this.settle();
    const dir = i > this.index ? 1 : -1;
    const out = this.current!;
    const inn = this.mount(this.items[i]);
    this.current = inn;
    this.index = i;
    this.sync();

    const shift = reduced() ? 0 : Math.min(this.stage.clientWidth * 0.3, 200);
    const opts: KeyframeAnimationOptions = { duration: reduced() ? 140 : STEP_MS, easing: EASE, fill: "forwards" };
    const anims = [
      out.el.animate([{ transform: `translateX(${fromX}px)`, opacity: 1 }, { transform: `translateX(${fromX - dir * shift}px)`, opacity: 0 }], opts),
      inn.el.animate([{ transform: `translateX(${dir * shift + fromX * 0.3}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], opts),
    ];
    out.el.style.pointerEvents = "none";
    this.leaving = { slide: out, anims };
    anims[0].finished.then(() => this.leaving?.slide === out && this.settle(), () => {});
    anims[1].finished.then(() => anims[1].cancel(), () => {});
  }

  /** Finish a step in progress now: put the outgoing item back. */
  private settle() {
    if (!this.leaving) return;
    const { slide, anims } = this.leaving;
    this.leaving = null;
    anims.forEach((a) => a.cancel());
    this.unmount(slide);
  }

  private bounce(dir: number, fromX: number) {
    if (!this.current || reduced()) return;
    this.current.el.animate(
      [{ transform: `translateX(${fromX}px)` }, { transform: `translateX(${-dir * 14 + fromX * 0.2}px)` }, { transform: "none" }],
      { duration: 320, easing: EASE },
    );
  }

  /** Update the counter, buttons, caption, thumbnails and announcement for the current item. */
  private sync(opening = false) {
    const n = this.items.length;
    const item = this.items[this.index];
    this.count.innerHTML = `<b>${pad2(this.index + 1)}</b> / ${pad2(n)}`;
    this.prev.disabled = this.index === 0;
    this.next.disabled = this.index === n - 1;
    const caption = item.caption();
    this.capInner.replaceChildren(...caption);
    this.cap.toggleAttribute("data-empty", caption.length === 0);
    this.dialog.setAttribute("aria-label", item.title);
    this.announcer.textContent = n > 1 ? `${this.index + 1} of ${n}: ${item.title}` : item.title;

    this.thumbs.querySelectorAll<HTMLElement>(".lb-thumb").forEach((t, i) => {
      if (i === this.index) {
        t.setAttribute("aria-current", "true");
        const left = t.offsetLeft - (this.thumbs.clientWidth - t.offsetWidth) / 2;
        this.thumbs.scrollTo({ left, behavior: opening || reduced() ? "instant" : "smooth" });
      } else t.removeAttribute("aria-current");
    });
  }

  private renderThumbs() {
    this.thumbs.replaceChildren(
      ...(this.items.length < 2 ? [] : this.items.map((item, i) => this.thumb(item, i))),
    );
  }

  private thumb(item: Item, i: number) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lb-thumb";
    b.setAttribute("aria-label", `${i + 1}: ${item.title}`);
    b.title = item.title;
    b.addEventListener("click", () => this.go(i));

    if (item.kind === "image") {
      const img = document.createElement("img");
      img.alt = "";
      // Lazy before src, or it loads at once; and the srcset, so an image the
      // page hasn't loaded yet comes in at thumbnail size, not full size.
      img.loading = "lazy";
      const own = (item.source as HTMLImageElement | undefined)?.currentSrc;
      if (!own && item.image!.srcset) {
        img.sizes = "72px";
        img.srcset = item.image!.srcset;
      }
      img.src = own || item.image!.src;
      b.append(img);
      return b;
    }
    b.dataset.kind = "live";
    // Diagrams get a miniature: a static copy of the SVG, without ids or
    // keys so nothing on the page addresses it, and in its finished state.
    const svg = item.source?.querySelector("svg.d-svg");
    if (svg) {
      const copy = svg.cloneNode(true) as SVGSVGElement;
      copy.querySelectorAll("[data-tokens]").forEach((g) => g.replaceChildren());
      [copy, ...copy.querySelectorAll("*")].forEach((e) => {
        ["id", "data-key", "data-off", "data-state", "role", "aria-label"].forEach((a) => e.removeAttribute(a));
      });
      copy.setAttribute("aria-hidden", "true");
      b.append(copy);
    }
    if (item.figNum) {
      const tag = document.createElement("span");
      tag.className = "lb-thumb-num";
      tag.textContent = pad2(item.figNum);
      b.append(tag);
    }
    return b;
  }

  /* -- Input -- */

  private onKey(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea, [contenteditable], [role='slider']")) return;
    const to = { ArrowLeft: this.index - 1, ArrowRight: this.index + 1, PageUp: this.index - 1, PageDown: this.index + 1, Home: 0, End: this.items.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    this.go(to);
  }

  private wheelX = 0;
  private wheelLocked = false;
  private wheelTimer = 0;

  /** Sideways trackpad swipes step through the sequence, once per gesture. */
  private onWheel(e: WheelEvent) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || scrollsSideways(e.target as Element, this.stage)) return;
    e.preventDefault();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.wheelLocked = false;
      this.wheelX = 0;
    }, 180);
    if (this.wheelLocked) return;
    this.wheelX += e.deltaX;
    if (Math.abs(this.wheelX) > 60) {
      this.wheelLocked = true;
      this.step(Math.sign(this.wheelX));
    }
  }

  private swiped = false;

  /** Touch: the item follows the finger sideways; let go past a threshold (or flick) to step. */
  private wireSwipe() {
    let id: number | null = null;
    let x0 = 0, y0 = 0, dx = 0, t0 = 0, lastX = 0, lastT = 0, v = 0;
    let mode: "idle" | "pending" | "drag" = "idle";
    const reset = () => {
      id = null;
      mode = "idle";
    };

    this.stage.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" || this.busy || this.dialog.hasAttribute("data-zoomed")) return;
      if (id !== null) {
        // A second finger: a pinch, not a swipe.
        if (mode === "drag") this.snapBack(dx);
        return reset();
      }
      if (scrollsSideways(e.target as Element, this.stage)) return;
      id = e.pointerId;
      x0 = lastX = e.clientX;
      y0 = e.clientY;
      t0 = lastT = e.timeStamp;
      dx = v = 0;
      mode = "pending";
    });
    this.stage.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id || !this.current) return;
      dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (mode === "pending") {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) return reset();
        mode = "drag";
        this.finishOpening();
        this.settle();
        this.stage.setPointerCapture(e.pointerId);
      }
      const dt = e.timeStamp - lastT;
      if (dt > 0) v = 0.8 * ((e.clientX - lastX) / dt) + 0.2 * v;
      lastX = e.clientX;
      lastT = e.timeStamp;
      const atEnd = (dx > 0 && this.index === 0) || (dx < 0 && this.index === this.items.length - 1);
      this.current.el.style.transform = `translateX(${atEnd ? dx / 3 : dx}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const wasDrag = mode === "drag";
      reset();
      if (!wasDrag || !this.current) return;
      this.swiped = true;
      setTimeout(() => (this.swiped = false), 50);
      const el = this.current.el;
      const x = parseFloat(el.style.transform.replace(/[^-\d.]/g, "")) || 0;
      el.style.transform = "";
      const flick = Math.abs(v) > SWIPE_VELOCITY && e.timeStamp - t0 < 500;
      if (e.type === "pointerup" && (Math.abs(dx) > SWIPE_PX || flick)) this.step(dx < 0 ? 1 : -1, x);
      else this.snapBack(x);
    };
    this.stage.addEventListener("pointerup", end);
    this.stage.addEventListener("pointercancel", end);
  }

  private snapBack(x: number) {
    if (!this.current) return;
    this.current.el.style.transform = "";
    this.current.el.animate([{ transform: `translateX(${x}px)` }, { transform: "none" }], { duration: 260, easing: EASE });
  }
}

/** Whether a gesture on el belongs to something inside the viewer that scrolls sideways (code, a wide table). */
function scrollsSideways(el: Element | null, stop: Element) {
  for (let e = el; e && e !== stop; e = e.parentElement) {
    if (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowX)) return true;
  }
  return false;
}

let viewer: Viewer | null = null;

/**
 * Open the viewer on an enrolled element (its group becomes the sequence), or
 * on a list of images that aren't on the page.
 */
export function openLightbox(target: HTMLElement | ImageSpec[], index = 0) {
  viewer ??= new Viewer();
  if (Array.isArray(target)) {
    const items: Item[] = target.map((spec) => ({
      kind: "image",
      // A copy: the viewer fills in sizes once the file loads.
      image: { ...spec },
      title: spec.alt || "Image",
      caption: () => (spec.caption ? [document.createTextNode(spec.caption)] : []),
    }));
    viewer.open(items, Math.min(Math.max(0, index), items.length - 1));
    return;
  }
  if (target.dataset.lbReady === undefined) enroll(target);
  // Something that can't be enrolled (in a link, under data-lightbox-off)
  // opens on its own, rather than as whatever comes first in its group.
  if (target.dataset.lbReady === undefined) return viewer.open([itemFor(target)], 0);
  const { items, index: at } = sequenceFor(target);
  viewer.open(items, at);
}

export function closeLightbox() {
  return viewer?.close();
}
