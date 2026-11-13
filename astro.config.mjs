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

// https://astro.build/config
export default defineConfig({
  // TODO: replace with the production domain once it is decided.
  // Vercel preview builds use their own branch URL, so canonical links and
  // social card images (og:image) resolve on the preview being tested.
  site:
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL
      ? `https://${process.env.VERCEL_BRANCH_URL}`
      : "https://labs.arize.com",
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
