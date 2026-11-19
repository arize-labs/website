// @ts-check
/**
 * Markdown for agents, following https://llmstxt.org, as the OpenInference
 * site does it.
 *
 * - `llms.txt`, the index, is drawn by `src/pages/llms.txt.ts` from the same
 *   data as the pages.
 * - Every page with an element marked `data-markdown` (a post, the mission,
 *   a team member, the credits) gets a markdown copy at its URL plus `.md`
 *   (`/blog/a-post` → `/blog/a-post.md`, `/` → `/index.html.md`), converted
 *   from that element's HTML, so it says exactly what the page says. Its
 *   links are absolute, and point at the markdown copy of any page that has
 *   one. What only works in a browser is marked `data-markdown-ignore`.
 * - Those pages link to their copy (`rel="alternate"`) and to `llms.txt`
 *   (`rel="describedby"`) from their <head>: see `BaseHead.astro`'s
 *   `markdown` prop. The build warns about a page that has one and not the
 *   other.
 * - `llms-full.txt` is every page `llms.txt` lists in `FULL_SECTIONS`, in
 *   full and in its order: the mission and the blog.
 *
 * After `astro build` the copies and `llms-full.txt` are files in the build.
 * Under `astro dev` a middleware draws them on request from the rendered
 * pages, and serves them and `llms.txt` with links to the dev server.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toText } from "hast-util-to-text";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

/**
 * The route of a page's markdown copy, by the page's route:
 * `/website/blog/a-post` → `/website/blog/a-post.md`,
 * `/website/` → `/website/index.html.md`.
 * @param {string} route
 */
export function markdownRouteOf(route) {
  const [pathname] = route.split("#");
  return `${pathname.endsWith("/") ? `${pathname}index.html` : pathname}.md`;
}

/**
 * The sections of `llms.txt` that `llms-full.txt` includes, by their
 * headings.
 */
export const FULL_SECTIONS = ["About", "Blog"];

/** The site's title suffix, `Mission · Arize Labs`, dropped from page titles. */
const TITLE_SUFFIX = /\s+·\s+Arize Labs$/;

/** Elements with nothing to say in markdown: scripts, controls and icons. */
const DROPPED = new Set([
  "button",
  "form",
  "input",
  "label",
  "noscript",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "track",
]);

/**
 * @typedef {import("hast").Root} Root
 * @typedef {import("hast").Element} Element
 * @typedef {import("hast").ElementContent} Content
 * @typedef {import("hast").RootContent} RootContent
 */

/**
 * A page is known by its path from the site's root, with no trailing slash:
 * `blog/a-post`, `mission`, and `""` for the home page.
 *
 * @typedef {object} Site
 * @property {URL} root the site's root URL, with its base:
 *   `https://arize-labs.github.io/website/`
 * @property {Set<string>} mirrored the pages with a markdown copy
 */

/** @param {Element} node */
const classesOf = (node) => {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : [];
};

/**
 * @param {string} tagName
 * @param {Content[]} children
 * @param {Element["properties"]} [properties]
 * @returns {Element}
 */
const element = (tagName, children, properties = {}) => ({
  type: "element",
  tagName,
  properties,
  children,
});

/** @param {string} value @returns {Content} */
const text = (value) => ({ type: "text", value });

/**
 * The first element in a tree that `test` accepts.
 * @param {Root | Element} node
 * @param {(node: Element) => boolean} test
 * @returns {Element | undefined}
 */
function find(node, test) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (test(child)) return child;
    const found = find(child, test);
    if (found) return found;
  }
  return undefined;
}

/**
 * A page's key (see `Site`) from a pathname under the site's root, or
 * undefined if it is outside it.
 * @param {{ pathname: string, root: URL }} options
 */
function pageOf({ pathname, root }) {
  const base = root.pathname;
  if (`${pathname}/` === base) return "";
  if (!pathname.startsWith(base)) return undefined;
  return decodeURI(pathname.slice(base.length)).replace(/(^|\/)index\.html$/, "").replace(/\/$/, "");
}

/** The route of a page, by its key: `blog/a-post` → `/website/blog/a-post`. */
const routeOf = (/** @type {string} */ page, /** @type {URL} */ root) => `${root.pathname}${page}`;

/**
 * A link from a page as an absolute URL: to the markdown copy of the page it
 * points at, if that page has one, else as it is.
 * @param {{ href: string, page: string, site: Site }} options
 */
function resolveHref({ href, page, site }) {
  let url;
  try {
    url = new URL(href, new URL(routeOf(page, site.root), site.root));
  } catch {
    return href;
  }
  if (url.origin !== site.root.origin) return url.href;
  const target = pageOf({ pathname: url.pathname, root: site.root });
  if (target === undefined || !site.mirrored.has(target)) return url.href;
  return new URL(`${markdownRouteOf(routeOf(target, site.root))}${url.hash}`, site.root).href;
}

/**
 * A code block as a fenced one: its text, and its language from Shiki's
 * `data-language`.
 * @param {Element} node
 */
function codeBlock(node) {
  const language = node.properties?.dataLanguage;
  const code = element("code", [text(toText(node, { whitespace: "pre" }).replace(/\n+$/, ""))], {
    className: language && language !== "plaintext" ? [`language-${language}`] : [],
  });
  return element("pre", [code]);
}

/**
 * Inline items side by side on one line: `a · b · c`.
 * @param {Content[][]} items
 * @returns {Content[]}
 */
const joined = (items) =>
  items.filter((item) => toText(element("span", item)).trim()).flatMap((item, index) => (index > 0 ? [text(" · "), ...item] : item));

/**
 * @param {{ node: Element, page: string, site: Site }} options
 * @returns {Content[]}
 */
function prepareChildren({ node, page, site }) {
  return node.children.flatMap((child) => prepare({ node: child, page, site }));
}

/**
 * A node of an article, readied for markdown: what doesn't read as text is
 * dropped, code blocks are plain, links are absolute, and figures, icon
 * links and the post's meta line are spelled out. Returns its replacement:
 * nothing, the node, or other nodes.
 * @param {{ node: RootContent, page: string, site: Site }} options
 * @returns {Content[]}
 */
function prepare({ node, page, site }) {
  if (node.type === "text") return [text(node.value)];
  if (node.type !== "element") return [];
  const { tagName, properties = {} } = node;
  const classes = classesOf(node);
  if (DROPPED.has(tagName) || properties.hidden || properties.ariaHidden === "true" || "dataMarkdownIgnore" in properties) {
    return [];
  }
  /** @param {Element} child */
  const inner = (child) => prepareChildren({ node: child, page, site });
  if (tagName === "pre") return [codeBlock(node)];
  if (tagName === "img") {
    const src = String(properties.src ?? "");
    const alt = String(properties.alt ?? "");
    // An image with no alt text is decoration (a cover, a headshot).
    if (!src || !alt || src.startsWith("data:")) return [];
    return [element("img", [], { src: new URL(src, new URL(routeOf(page, site.root), site.root)).href, alt })];
  }
  if (tagName === "iframe" || tagName === "video") {
    // An embedded figure or video, as a link to it.
    const source = tagName === "video" ? find(node, (child) => child.tagName === "source") : node;
    const src = String(source?.properties?.src ?? "");
    const title = String(properties.title ?? properties.ariaLabel ?? "");
    if (!src) return [];
    const href = resolveHref({ href: src, page, site });
    return [element("p", [text(tagName === "video" ? "Video: " : "Embedded: "), element("a", [text(title || href)], { href })])];
  }
  if (/^h[1-6]$/.test(tagName)) {
    // A heading's link to itself is for the page, not the text.
    const unwrapped = node.children.flatMap((child) =>
      child.type === "element" && child.tagName === "a" && String(child.properties?.href ?? "").startsWith("#")
        ? child.children
        : [child],
    );
    return [element(tagName, inner(element(tagName, unwrapped)))];
  }
  if (tagName === "header") {
    // A page's header may put a label over its heading; markdown starts
    // with the heading.
    const blocks = inner(node);
    const isTitle = (/** @type {Content} */ child) => child.type === "element" && child.tagName === "h1";
    return [...blocks.filter(isTitle), ...blocks.filter((child) => !isTitle(child))];
  }
  // A post's meta line (date, authors, reading time): one line.
  if (classes.includes("meta")) {
    const items = node.children.flatMap((child) => (child.type === "element" ? [prepare({ node: child, page, site })] : []));
    return [element("p", joined(items))];
  }
  // A row of icon links (a member's profiles): `Follow: [GitHub](…) · …`.
  if (classes.includes("social-links")) {
    const label = find(node, (child) => classesOf(child).includes("label"));
    const links = node.children.flatMap((child) =>
      child.type === "element" && child.tagName === "a" ? [prepare({ node: child, page, site })] : [],
    );
    return [element("p", [...(label ? [text(`${toText(label).trim()}: `)] : []), ...joined(links)])];
  }
  // A post's tags: `Tags: [evals](…), [agents](…)`.
  if (tagName === "ul" && classes.includes("tags")) {
    const links = node.children.flatMap((child) => (child.type === "element" ? [inner(child)] : []));
    return [element("p", [text("Tags: "), ...links.flatMap((link, index) => (index > 0 ? [text(", "), ...link] : link))])];
  }
  // A figure: its title and caption. What it draws is for the eye.
  if (tagName === "figure" && classes.includes("fig")) {
    const title = find(node, (child) => classesOf(child).includes("fig-title"));
    const caption = find(node, (child) => child.tagName === "figcaption");
    return [
      ...(title ? [element("p", [element("strong", [text(`Figure: ${toText(title).trim()}`)])])] : []),
      ...(caption ? [element("p", inner(caption))] : []),
    ];
  }
  if (tagName === "a") {
    const href = typeof properties.href === "string" ? properties.href : undefined;
    let children = inner(node);
    // An icon link reads as its accessible name.
    const name = properties.ariaLabel ?? properties.title;
    if (!toText(element("span", children)).trim() && name) children = [text(String(name))];
    return href ? [element("a", children, { href: resolveHref({ href, page, site }) })] : children;
  }
  const children = inner(node);
  // A label over a block (a callout's title).
  if (tagName === "p" && classes.includes("eyebrow")) return [element("p", [element("strong", children)])];
  if (tagName === "aside") return [element("blockquote", children)];
  return [{ ...node, children }];
}

const toMarkdown = unified()
  .use(rehypeRemark)
  .use(remarkGfm, { tablePipeAlign: false })
  .use(remarkStringify, { bullet: "-", emphasis: "_", fences: true, listItemIndent: "one", rule: "-" });

const parser = unified().use(rehypeParse);

/**
 * A page's markdown, from its HTML: its `data-markdown` element, converted.
 * If that element has no heading of its own (the mission's title block sits
 * above it), it is headed by the page's title and description. Undefined
 * if the page has no `data-markdown` element.
 * @param {{ html: string, page: string, site: Site }} options
 */
export async function pageMarkdown({ html, page, site }) {
  const tree = parser.parse(html);
  const article = find(tree, (node) => "dataMarkdown" in (node.properties ?? {}));
  if (!article) return undefined;
  const titleElement = find(tree, (node) => node.tagName === "title");
  const title = titleElement ? toText(titleElement).replace(TITLE_SUFFIX, "") : page;
  const meta = find(tree, (node) => node.tagName === "meta" && node.properties?.name === "description");
  const description = meta?.properties?.content ? String(meta.properties.content) : undefined;
  const hasAlternate = !!find(
    tree,
    (node) => node.tagName === "link" && String(node.properties?.rel) === "alternate" && node.properties?.type === "text/markdown",
  );

  const children = prepareChildren({ node: article, page, site });
  const hasTitle = find(element("div", children), (child) => child.tagName === "h1");
  const heading = [
    element("h1", [text(title)]),
    ...(description ? [element("blockquote", [element("p", [text(description)])])] : []),
  ];
  /** @type {Root} */
  const root = { type: "root", children: [...(hasTitle ? [] : heading), ...children] };
  const markdown = toMarkdown.stringify(/** @type {any} */ (await toMarkdown.run(root)));
  // Markdown may escape `&` in a URL (`?a=1\&b=2`); an agent copying the
  // link should get the URL.
  const body = markdown.replace(/\]\(([^)\s]+)\)/g, (link) => link.replace(/\\&/g, "&")).trim() + "\n";
  return { markdown: body, hasAlternate };
}

/**
 * What `llms.txt` says: its title and summary, and the pages it links to the
 * markdown copies of, by section, in order.
 * @param {{ index: string, root: URL }} options
 */
export function readIndex({ index, root }) {
  /** @type {string[]} */
  const head = [];
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  /** @type {string[] | undefined} */
  let pages;
  for (const line of index.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      pages = [];
      sections.set(heading[1].trim(), pages);
      continue;
    }
    if (!pages) {
      if (/^(#|>)\s/.test(line)) head.push(line);
      continue;
    }
    for (const [, href] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (!href.startsWith(root.href) || !href.endsWith(".md")) continue;
      const page = pageOf({ pathname: new URL(href).pathname.slice(0, -".md".length), root });
      if (page !== undefined) pages.push(page);
    }
  }
  return { head, sections };
}

/**
 * `llms-full.txt`: the summary of `llms.txt`, then the markdown of every
 * page in its `FULL_SECTIONS`, each headed by its URL.
 * @param {{ index: string, root: URL, markdownOf: (page: string) => Promise<string | undefined> }} options
 */
export async function fullText({ index, root, markdownOf }) {
  const { head, sections } = readIndex({ index, root });
  const pages = [...new Set(FULL_SECTIONS.flatMap((section) => sections.get(section) ?? []))];
  const parts = [
    head.join("\n\n"),
    `The ${FULL_SECTIONS.join(" and ")} pages of ${new URL("llms.txt", root).href}, in full. Each starts with its URL.`,
  ];
  for (const page of pages) {
    const markdown = await markdownOf(page);
    if (markdown === undefined) throw new Error(`llms.txt links to a page with no markdown copy: ${page || "/"}`);
    parts.push(`---\n\nSource: ${new URL(page, root).href}\n\n${markdown}`);
  }
  return { text: parts.join("\n\n").trim() + "\n", pages };
}

/**
 * @param {URL} dir
 * @returns {Promise<string[]>} every HTML file in the build, by its path in it
 */
async function htmlFiles(dir) {
  const root = fileURLToPath(dir);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/** Where a page's markdown copy goes in the build: `blog/a-post` → `blog/a-post.md`. */
const markdownFileOf = (/** @type {string} */ page) => (page === "" ? "index.html.md" : `${page}.md`);

/** A request the dev middleware makes of the dev server, which it passes on. */
const INTERNAL = "x-llms-txt-internal";

/** @returns {import("astro").AstroIntegration} */
export default function llmsTxt() {
  /** @type {URL | undefined} */
  let root;
  return {
    name: "llms-txt",
    hooks: {
      "astro:config:done": ({ config }) => {
        if (!config.site) throw new Error("llms-txt needs `site` set, for the absolute links it writes.");
        root = new URL(config.base.replace(/\/?$/, "/"), config.site);
      },

      "astro:server:setup": ({ server, logger }) => {
        server.middlewares.use(async (req, res, next) => {
          // Astro strips the base path from `req.url`; `originalUrl` keeps it.
          const url = /** @type {{ originalUrl?: string }} */ (req).originalUrl ?? req.url;
          if (!root || !url || req.headers[INTERNAL]) return next();
          const site = root;
          const origin = `http://${req.headers.host}`;
          const { pathname } = new URL(url, origin);
          const isIndex = pathname === `${site.pathname}llms.txt`;
          const isFull = pathname === `${site.pathname}llms-full.txt`;
          if (!isIndex && !isFull && !pathname.endsWith(".md")) return next();
          try {
            /** @param {string} route */
            const load = async (route) => {
              const response = await fetch(new URL(route, origin), { headers: { [INTERNAL]: "1" } });
              return response.ok ? response.text() : undefined;
            };
            const index = await load(`${site.pathname}llms.txt`);
            if (index === undefined) return next();
            const mirrored = new Set([...readIndex({ index, root: site }).sections.values()].flat());
            /** @param {string} page */
            const markdownOf = async (page) => {
              const html = await load(routeOf(page, site));
              const result = html && (await pageMarkdown({ html, page, site: { root: site, mirrored: new Set([...mirrored, page]) } }));
              return result ? result.markdown : undefined;
            };
            /** @type {string | undefined} */
            let body;
            if (isIndex) body = index;
            else if (isFull) body = (await fullText({ index, root: site, markdownOf })).text;
            else {
              const page = pageOf({ pathname: pathname.slice(0, -".md".length), root: site });
              body = page === undefined ? undefined : await markdownOf(page);
            }
            if (body === undefined) return next();
            // Links point at the deployed site; in dev, at the dev server.
            const local = body.replaceAll(site.href, new URL(site.pathname, origin).href);
            res.setHeader("Content-Type", `${isIndex || isFull ? "text/plain" : "text/markdown"}; charset=utf-8`);
            res.end(local);
          } catch (error) {
            logger.error(`Could not draw ${pathname}: ${error}`);
            next(error);
          }
        });
      },

      "astro:build:done": async ({ dir, logger }) => {
        if (!root) return;
        /** @type {Map<string, string>} */
        const htmls = new Map();
        for (const file of await htmlFiles(dir)) {
          const html = await readFile(new URL(file, dir), "utf8");
          // A page has a copy if it has a `data-markdown` element.
          if (!/\sdata-markdown[\s>=]/.test(html)) continue;
          const page = file === "index.html" ? "" : file.replace(/\/index\.html$/, "");
          htmls.set(page, html);
        }

        /** @type {Map<string, string>} */
        const markdown = new Map();
        /** @type {Site} */
        const site = { root, mirrored: new Set(htmls.keys()) };
        for (const [page, html] of htmls) {
          const result = await pageMarkdown({ html, page, site });
          if (!result) continue;
          if (!result.hasAlternate) logger.warn(`${page || "/"} has a markdown copy its <head> doesn't link to: pass \`markdown\` to its layout`);
          markdown.set(page, result.markdown);
          await writeFile(new URL(markdownFileOf(page), dir), result.markdown);
        }
        logger.info(`Wrote markdown copies of ${markdown.size} pages`);

        const index = await readFile(new URL("llms.txt", dir), "utf8").catch(() => undefined);
        if (index === undefined) {
          logger.warn("No llms.txt in the build, so no llms-full.txt");
          return;
        }
        const listed = [...readIndex({ index, root }).sections.values()].flat();
        const missing = listed.filter((page) => !markdown.has(page));
        if (missing.length) throw new Error(`llms.txt links to pages with no markdown copy: ${missing.join(", ")}`);
        const { text: full, pages } = await fullText({ index, root, markdownOf: async (page) => markdown.get(page) });
        await writeFile(new URL("llms-full.txt", dir), full);
        logger.info(`Wrote llms-full.txt: ${pages.length} pages, ${Math.round(full.length / 1024)} KB`);
      },
    },
  };
}
