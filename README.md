# Arize Labs website

The Arize Labs site, built with [Astro](https://docs.astro.build). See
[`ASTRO-PLAN.md`](./ASTRO-PLAN.md) for the plan this follows.

This is a structural scaffold: content, routes and responsive layout are in
place, and styling is kept to tokens and layout so the external design can be
applied on top. Art (the hero, project art, covers, headshots) is shown as
labelled placeholder frames.

## Commands

| Command | Does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Dev server at `localhost:4321` (drafts visible) |
| `pnpm check` | Type-check `.astro` and `.ts` files |
| `pnpm build` | Type-check, then build to `dist/` and `.vercel/output/` |
| `pnpm preview` | Serve the build locally |

## Layout

```
src/
  site.config.ts          name, description, nav, social links
  content.config.ts       `team` and `posts` collections and their schemas
  content/
    team/*.md             one file per person; the file name is the URL id
    posts/*.md(x)         one file per post; `authors` lists team ids
  styles/
    tokens.css            colors, type scale, spacing, breakpoints
    global.css            reset, page grid, shared primitives, prose
  layouts/
    BaseLayout.astro      html shell: head, header, main, footer
    PageLayout.astro      interior page with title and intro (width="prose" for reading pages)
    PostLayout.astro      blog post
  components/
    PageHeader.astro      the title block shared by pages and posts
    BaseHead.astro        SEO: title, canonical, Open Graph, Twitter, JSON-LD
    sections/             landing-page building blocks (Hero, Section, ...)
    heroes/               hero art; HeroPlaceholder until the Three.js hero lands
  lib/content.ts          collection queries and URL helpers
  pages/
    index.astro           landing
    team/index.astro, team/[id].astro
    blog/[...page].astro  paginated list
    blog/[id].astro       post
    blog/tags/[tag].astro
    rss.xml.ts
    404.astro
```

## Adding content

- **Team member:** add `src/content/team/<handle>.md` with `name`, `role` and
  optional `avatar` (a path to a local image), `links` and `order`. The body
  is the bio.
- **Post:** add `src/content/posts/<slug>.md` (or `.mdx` to use components)
  with `title`, `description`, `pubDate` and `authors`. Unknown author ids,
  bad dates and missing fields fail the build.

## Styling

[`DESIGN.md`](./DESIGN.md) has the design guidelines: page types and
widths, the title block, long-form content, type, colour and spacing, and a
checklist for new pages. Read it before adding or restyling a page.

Components read from the custom properties in `src/styles/tokens.css`, so
most of the external design should land there first. Layout uses a
three-track `.page-grid` (gutter, 1084px content column, gutter); add
`.bleed` to a child to span the full width. Breakpoints are 1100px, 840px
and 720px, documented at the top of `tokens.css`.

Theme: `data-theme="light" | "dark"` on `<html>`, set before first paint
from the saved choice or the system preference, and switched by the toggle
in the header.

## Not yet done

From the plan's suggested order: the Three.js hero, OG image generation,
Pagefind search, the section catalogue for agents, and CMS work. The
production domain in `astro.config.mjs` (`site`) is a placeholder.

`website-prototype/` is a separate clone used as a reference only; it is
gitignored and excluded from type checking.
