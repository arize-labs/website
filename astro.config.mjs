// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import vercel from "@astrojs/vercel";
import pierreLight from "@pierre/theme/pierre-light";
import pierreDark from "@pierre/theme/pierre-dark";

/**
 * Pierre's themes are typed as readonly objects, which Shiki's mutable theme
 * type doesn't accept; the data is a standard TextMate theme, so pass it as one.
 * @param {unknown} theme
 */
const shikiTheme = (theme) => /** @type {NonNullable<import("astro").ShikiConfig["theme"]>} */ (theme);

/** The deployment's public origin. Local builds default to the intended production domain. */
function siteUrl() {
  const { VERCEL_ENV, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL } = process.env;
  if (VERCEL_ENV === "preview" && VERCEL_BRANCH_URL) return `https://${VERCEL_BRANCH_URL}`;
  if (VERCEL_ENV === "production" && VERCEL_PROJECT_PRODUCTION_URL) return `https://${VERCEL_PROJECT_PRODUCTION_URL}`;
  // TODO: replace with the production domain once it is decided.
  return "https://labs.arize.com";
}

// https://astro.build/config
export default defineConfig({
  // Canonical links and social card URLs (og:image) are absolute, so they
  // must point at a host that serves this site. On Vercel: previews use their
  // branch URL, and production uses the project's production domain (its
  // custom domain once one is added, *.vercel.app until then).
  site: siteUrl(),
  // Static by default. Individual routes can opt into on-demand rendering
  // with `export const prerender = false`.
  adapter: vercel(),
  integrations: [mdx(), sitemap()],
  // Code blocks use the Pierre theme (https://diffs.com/theme). Shiki emits
  // the light colors inline and the dark ones as --shiki-dark variables;
  // global.css switches to them with the site's theme.
  markdown: {
    shikiConfig: { themes: { light: shikiTheme(pierreLight), dark: shikiTheme(pierreDark) } },
  },
  redirects: {},
});
