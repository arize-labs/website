/**
 * Behaviour shared by every figure, wired once per page:
 *
 * - Tooltips. Any element with data-tip="Title\nline\nline" shows a tooltip
 *   on hover and on keyboard focus. The first line is the heading.
 * - Variants. A [data-variants] container holds [data-variant="id"] panels;
 *   a control inside the same figure ([data-variant-control], buttons with
 *   data-v or a <select>) picks which one shows.
 * - Entrances. [data-grow] elements (chart marks) start collapsed and grow
 *   when they scroll into view, and again when their variant is picked.
 *   Without JavaScript or with reduced motion they are simply drawn.
 */

let tip: HTMLDivElement | null = null;

function tipEl() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "fig-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  return tip;
}

/** The text the tooltip holds and its measured size; rebuilt only when the text changes. */
let shown: { text: string; w: number; h: number } | null = null;

function showTip(host: Element, text: string, x: number, y: number) {
  const t = tipEl();
  // A figure open full screen sits in a modal dialog, in the top layer above
  // the body, so the tip has to be inside that dialog to show over it.
  const layer = host.closest("dialog[open]") ?? document.body;
  if (t.parentElement !== layer) layer.append(t);
  if (shown?.text !== text) {
    t.replaceChildren(
      ...text.split("\n").map((line, i) => {
        const el = document.createElement(i === 0 ? "b" : "span");
        el.textContent = line;
        return el;
      }),
    );
    t.dataset.on = "";
    const r = t.getBoundingClientRect();
    shown = { text, w: r.width, h: r.height };
  }
  let left = x + 14;
  let top = y + 14;
  if (left + shown.w > innerWidth - 8) left = x - shown.w - 14;
  if (top + shown.h > innerHeight - 8) top = y - shown.h - 14;
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${Math.max(8, top)}px`;
}

function hideTip() {
  if (!shown || !tip) return;
  shown = null;
  delete tip.dataset.on;
}

function wireTooltips() {
  document.addEventListener("pointermove", (e) => {
    const host = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
    if (host && e.pointerType !== "touch") showTip(host, host.dataset.tip ?? "", e.clientX, e.clientY);
    else hideTip();
  });
  document.addEventListener("pointerdown", (e) => {
    const host = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
    if (host && e.pointerType === "touch") showTip(host, host.dataset.tip ?? "", e.clientX, e.clientY);
    else if (!host) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const host = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
    if (!host) return hideTip();
    const r = host.getBoundingClientRect();
    showTip(host, host.dataset.tip ?? "", r.left + Math.min(r.width, 240) / 2, r.bottom - 6);
  });
  document.addEventListener("focusout", hideTip);
  // Capture, so scrolling inside a box (a full screen figure's slide) hides it too.
  document.addEventListener("scroll", hideTip, { capture: true, passive: true });
}

function regrow(scope: Element) {
  scope.querySelectorAll<HTMLElement>("[data-grow]").forEach((el) => el.removeAttribute("data-in"));
  // Force a style flush so the collapsed state is painted before growing.
  void (scope as HTMLElement).offsetWidth;
  scope.querySelectorAll<HTMLElement>("[data-grow]").forEach((el) => el.setAttribute("data-in", ""));
}

function wireVariants(fig: HTMLElement) {
  const sets = fig.querySelectorAll<HTMLElement>("[data-variants]");
  const controls = fig.querySelectorAll<HTMLElement>("[data-variant-control]");
  if (!sets.length || !controls.length) return;
  const pick = (v: string) => {
    sets.forEach((set) =>
      set.querySelectorAll<HTMLElement>(":scope > [data-variant]").forEach((panel) => {
        const on = panel.dataset.variant === v;
        panel.hidden = !on;
        if (on && fig.dataset.inview !== undefined) regrow(panel);
      }),
    );
    controls.forEach((c) => {
      c.querySelectorAll<HTMLButtonElement>("button[data-v]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
      const sel = c.querySelector("select");
      if (sel) sel.value = v;
    });
  };
  controls.forEach((c) => {
    c.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button[data-v]");
      if (b?.dataset.v) pick(b.dataset.v);
    });
    c.querySelector("select")?.addEventListener("change", (e) => pick((e.target as HTMLSelectElement).value));
  });
}

function wireEntrances(figs: NodeListOf<HTMLElement>) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const fig = entry.target.closest<HTMLElement>(".fig");
        if (!fig) return;
        fig.dataset.inview = "";
        fig.querySelectorAll("[data-grow]").forEach((el) => el.setAttribute("data-in", ""));
        io.unobserve(entry.target);
      }),
    { threshold: 0.35 },
  );
  figs.forEach((fig) => {
    if (!fig.querySelector("[data-grow]")) return;
    fig.dataset.armed = "";
    io.observe(fig.querySelector(".fig-frame") ?? fig);
  });
}

let wired = false;

export function initFigures() {
  if (!wired) {
    wired = true;
    wireTooltips();
  }
  const figs = document.querySelectorAll<HTMLElement>(".fig:not([data-fig-ready])");
  figs.forEach((fig) => {
    fig.dataset.figReady = "";
    wireVariants(fig);
  });
  wireEntrances(figs);
}
