# Design guidelines

How pages on the Arize Labs site are laid out, and the rules that keep them
consistent. Values live in [`src/styles/tokens.css`](./src/styles/tokens.css);
this document says which ones to use where. When code and this document
disagree, fix one of them in the same change.

## Principles

- **Centre the column, not the text.** Columns are centred in the page; text
  inside them is left-aligned, titles included. The one exception is the
  landing hero, which centres its lockup and lede over the art.
- **Two widths, no others.** Content sits in the 1084px content column or the
  720px reading column. Don't invent a third.
- **Tokens only.** Colours, type sizes, spacing and widths come from
  `tokens.css`. A literal pixel value in a component is a bug unless it is a
  breakpoint (CSS can't read custom properties in media queries).
- **One accent.** Signal orange (`--accent`) marks one thing at a time: a
  hover, a number, a rule. It is never a fill behind text.

## Page types

Every page is one of three types. Pick the type first; it decides the layout.

| Type | Width | Layout | Pages |
|---|---|---|---|
| Landing | Full bleed and content column | `BaseLayout` + `sections/*` | `/` |
| Index | Content column, 1084px | `PageLayout` | blog, tags, team, brand, 404 |
| Reading | Reading column, 720px, centred | `PostLayout`, or `PageLayout width="prose"` | posts, mission, credits |

A **reading page** is mostly running text. It looks like a blog post: the
title block and the body share one centred 720px column, both left-aligned.
New long-form pages (an about page, a policy) are reading pages: use
`<PageLayout width="prose">` and put the body in `<div class="prose">`.

An **index page** lists or shows things in grids (cards, artwork, people) and
needs the full content column.

## Title block

Every interior page and post opens with the same title block,
[`PageHeader`](./src/components/PageHeader.astro). Don't build a page title
by hand.

In order, top to bottom:

1. **Eyebrow** (optional, index pages only). A mono caps label naming what
   the page is a list of, such as `Tag` or `404`. Reading pages don't use
   one, and no page uses it to repeat its nav label.
2. **Title.** `h1`, `--text-h2`, weight 600, `--tracking-tight`, balanced
   wrapping. Left-aligned.
3. **Intro** (optional). One or two sentences, `--text-intro`, `--soft`. On
   index pages it is capped at 52ch; in the reading column it spans the
   column.
4. **Meta line** (optional, `meta` slot). One line of mono caps, `--dim`,
   items spaced by `--space-6` and wrapping on narrow screens. Posts show
   date (and "Updated" date), author, reading time and share links, in that
   order. Other pages leave it out unless they have the same kind of facts.
5. **Extras** (optional, default slot). Navigation that belongs to the
   header, such as the blog's tag list or a "← All posts" link.

Spacing is fixed by the component: `--space-9` above the title and
`--space-7` below the block (`--space-7` and `--space-6` under 720px).

## Long-form content (`.prose`)

Post bodies, the mission page and bios use `.prose`, styled in
[`global.css`](./src/styles/global.css). Write Markdown; don't restyle
elements inside a single post.

- **Headings.** `##` for sections, `###` for subsections. Don't bold a
  heading's text.
- **Body.** `--text-body-lg` (18px; 16px on phones), line height 1.65.
  Emphasis with `**bold**` and `_italic_` sparingly.
- **Tables.** Markdown tables span the reading column, with ruled rows and
  mono caps headers. Under 720px a wide table scrolls sideways inside itself;
  the page never scrolls sideways. Keep header labels short so they wrap
  cleanly.
- **Images.** Store them in `src/assets/` and render with `<Image>` from
  `astro:assets` with `widths` and `sizes`, so phones don't download desktop
  files. For the reading column: `widths={[720, 1440]}` and
  `sizes="(max-width: 720px) 100vw, 720px"`. Images get a 1px `--rule`
  border.
- **Captions.** Put the image in a `<figure>` with a `<figcaption>`. Captions
  are `--text-small`, `--soft`, `--space-2` below the figure.
- **Figures.** Diagrams and charts are Astro components built from the
  figure primitives (see [Figures](#figures)), not HTML pages in iframes.
  [`<Embed>`](./src/components/Embed.astro) is only for third-party pages we
  don't own.
- **Asides and summaries.** A TL;DR or a note goes in
  [`<Callout title="…">`](./src/components/Callout.astro) (MDX only).
- **Code.** Fenced blocks with a language, highlighted with the Pierre theme
  in both light and dark.
- **Quotes.** `>` blockquotes: an accent rule on the left, `--soft` text.

## Figures

Diagrams and charts in posts share one frame and one kit of primitives, in
[`src/components/figure/`](./src/components/figure/). Each figure is a
component in `src/components/figures/<post>/` that a post imports and drops
in with no props (`<ToolCallingLoop />`), so the figure's data and copy live
in one place.

**The frame.** [`<Figure>`](./src/components/figure/Figure.astro) gives every
figure the same parts, top to bottom:

1. **Header.** `Fig. 01` and the title in mono caps. Figures number
   themselves in the order they appear. Animated figures get pause and
   replay buttons on the right.
2. **Frame.** `--fig-ground` with a `--rule` border and registration crosses
   on the corners. Diagrams sit on a dot ground (`ground="dots"`), fainter
   than the page margins' (`--fig-dot`); charts sit on a plain ground. Zones
   and ghost nodes are opaque, so the dots stop at their edges and never sit
   behind text. Only zones nested inside one another use `fill="tint"`, so
   they darken as they nest.
3. **Status line** (animated figures). What the figure is showing right now,
   with the step number in accent. HTML, so it stays readable when a diagram
   is scrolled on a phone.
4. **Caption.** What to take away, and how to interact (hover, focus, pick a
   variant).

**Widths.** Charts are `width="prose"` (the reading column). Diagrams are
`width="wide"`: they leave the reading column for the content column, 1084px,
which is drawn 1032 units across so one diagram unit is one pixel. Under
820px a diagram stops shrinking and scrolls sideways inside its frame, like a
table, rather than shrinking its text below about 10px.

**Encoding.** The same meaning gets the same mark in every figure:

| Mark | Means |
|---|---|
| Accent (solid, or a tint with an accent edge) | The thing the figure is about: the result that reaches the model, Jev's series, the verification path |
| Ink | The user's input, the active step |
| Dot texture | Bulk data: payloads, tokens, other series in a chart |
| Hatch | Overhead, or what it would have cost: tool definitions, the preamble without code mode |
| Tinted zone with corner ticks | A part of the system (the user, the agent loop, a server) |
| Dashed edge | A sandbox or container boundary |
| Solid wire, chevron head | Flow; a dashed wire hasn't happened yet |
| Blocks moving along a wire | Something being sent: a hollow block is a call, an accent block the result, and a train of small shaded blocks a payload (a wider, longer train is a bigger payload) |

Still one accent at a time: don't add colours per series or per tool. If a
figure needs to tell more things apart, use texture, position and labels.

**Diagram primitives** (SVG, in `figure/diagram/`): `Diagram` (the canvas
and texture patterns), `Zone`, `Node`, `Wire`, `Chip`, `Code`, `Meter`, and
`Legend` (HTML, under the diagram). Text inside diagrams uses the `d-*`
classes: `d-tag` (mono caps label), `d-title`, `d-sub`, `d-mono`, `d-code`.
Give anything a scene will change a `k` (it becomes `data-key`).

**Chart primitives** (HTML, in `figure/chart/`): `BarList`, `IntervalPlot`,
`ColumnChart`, and `VariantControl` to switch between `[data-variant]`
panels. They reflow at any width, take `tip` text for the hover and focus
tooltip, and grow in when they scroll into view.

**Motion.** An animated figure's markup is its finished state, which is what
readers see without JavaScript, with reduced motion, and when the animation
ends. A `<script>` in the figure registers a scene with
[`defineScene`](./src/components/figure/motion.ts): `setup` puts it in its
first frame and `play` is the timeline, written with the scene's helpers
(`state`, `show`, `caption`, `wait`, `grow`, `draw`, `type`, `stream`,
`fly`). `stream` sends blocks along a wire: they turn with it, grow out of
the box they leave, shrink into the box they reach and pass under the wire's
label. Keep motion deterministic, with no random jitter, so a replay looks the
same every time. Scenes play once, when the figure is half in view; time stops while
they're paused or scrolled away. Number the steps in `caption` so readers
know how far along they are.

Checklist for a new figure:

- [ ] A component in `src/components/figures/<post>/`, wrapped in `<Figure>`.
- [ ] `aria-label` on the diagram says what it shows, not what it looks like.
- [ ] Only the encodings above; tokens for every colour.
- [ ] Checked at 1440px and 390px, light and dark, with motion and with
      reduced motion.

## Type

| Token | Size | Use |
|---|---|---|
| `--text-display` | 44 to 96px | Landing hero only |
| `--text-h2` | 36 to 56px | Page and post titles (`h1`), landing section headings |
| `--text-feature` | 32 to 48px | Landing feature rows (projects) |
| `--text-h3` | 22px | Prose `###`, post card titles, credit titles |
| `--text-h4` | 17px | Member names, compact post cards |
| `--text-intro` | 20px (18px on phones) | Title block intro |
| `--text-body-lg` | 18px | Prose |
| `--text-body` | 16px | UI text, prose on phones |
| `--text-small` | 14px | Captions, tables, card descriptions |
| `--text-micro` | 11px | Eyebrows, meta lines, table headers (mono caps) |

Urbanist (`--font-sans`) for everything people read; Geist Mono
(`--font-mono`) only in uppercase, tracked `--tracking-micro`, for labels
and metadata (the `.eyebrow` class).

## Colour

Use the semantic tokens, never the palette directly:

- `--fg` and `--bg` for text and page ground; `--surface` for frames that
  sit on the ground (embeds).
- `--soft` for secondary text (intros, captions); `--dim` for labels and
  metadata.
- `--rule` for every 1px line: table rows, image borders, section rules.
- `--accent` for the one highlighted thing.

Every token has a dark value. If something needs a colour that has no token,
add the token in both themes rather than hard-coding it.

## Spacing and breakpoints

The spacing scale runs from `--space-1` (4px) to `--space-9` (96px), plus
`--space-section` between landing sections. Use the scale; don't add
in-between values.

Breakpoints, as literals in media queries:

- **1100px:** gutters shrink and section spacing tightens.
- **840px:** side-by-side rows stack.
- **720px:** grids collapse, the nav collapses, prose drops to 16px and
  tables become scroll boxes.

## Checklist for a new page

- [ ] Picked the page type: index or reading.
- [ ] Used `PageLayout` (with `width="prose"` for reading) or `PostLayout`;
      no hand-built title.
- [ ] No eyebrow on a reading page, and no eyebrow repeating the nav label.
- [ ] Text left-aligned; only the column is centred.
- [ ] Only tokens for colour, type and spacing.
- [ ] Images through `<Image>` with `widths` and `sizes`.
- [ ] Checked at 1440px and 390px wide, in light and dark: no sideways
      scroll, and no table or figure wider than its column.
