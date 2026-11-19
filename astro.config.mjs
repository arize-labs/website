// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { satteri } from "@astrojs/markdown-satteri";
import { defineMdastPlugin } from "satteri";
import pierreLight from "@pierre/theme/pierre-light";
import pierreDark from "@pierre/theme/pierre-dark";

/**
 * Pierre's themes are typed as readonly objects, which Shiki's mutable theme
 * type doesn't accept; the data is a standard TextMate theme, so pass it as one.
 * @param {unknown} theme
 */
const shikiTheme = (theme) => /** @type {NonNullable<import("astro").ShikiConfig["theme"]>} */ (theme);

/**
 * Where the site is served. On GitHub Pages the deploy workflow passes the
 * Pages site's origin and base path (from actions/configure-pages), so adding
 * a custom domain later needs no change here. Local builds default to the
 * project site, https://arize-labs.github.io/website.
 */
const SITE = process.env.SITE_ORIGIN || "https://arize-labs.github.io";
const BASE = (process.env.SITE_BASE_PATH ?? "/website") || "/";

/**
 * Markdown and MDX links are written root-relative (`/blog/a-post`); prefix
 * them with the base path, as src/lib/url.ts does for links in components.
 */
const BASE_PREFIX = BASE.replace(/\/$/, "");
const isRootRelative = (/** @type {string} */ url) => url.startsWith("/") && !url.startsWith("//");
const baseLinks = defineMdastPlugin({
  name: "base-links",
  link(node, ctx) {
    if (isRootRelative(node.url)) ctx.setField(node, "url", BASE_PREFIX + node.url);
  },
  definition(node, ctx) {
    if (isRootRelative(node.url)) ctx.setField(node, "url", BASE_PREFIX + node.url);
  },
  image(node, ctx) {
    if (isRootRelative(node.url)) ctx.setField(node, "url", BASE_PREFIX + node.url);
  },
});

// https://astro.build/config
export default defineConfig({
  // Canonical links and social card URLs (og:image) are absolute, so `site`
  // must be the host that serves this site.
  site: SITE,
  base: BASE,
  // Fully static: GitHub Pages serves the built files and runs no server code.
  integrations: [mdx(), sitemap()],
  // Code blocks use the Pierre theme (https://diffs.com/theme). Shiki emits
  // the light colors inline and the dark ones as --shiki-dark variables;
  // global.css switches to them with the site's theme.
  markdown: {
    processor: satteri({ mdastPlugins: [baseLinks] }),
    shikiConfig: { themes: { light: shikiTheme(pierreLight), dark: shikiTheme(pierreDark) } },
  },
  redirects: {},
});
