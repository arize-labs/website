import { withBase } from "./lib/url";

export const site = {
  name: "Arize Labs",
  description:
    "Where ambition meets creativity. We chase early ideas and build in the open, with a mission to make AI work for humanity.",
  locale: "en",
  /** og:locale wants language_TERRITORY. */
  ogLocale: "en_US",
  /** The company behind Labs: footer logo, link and copyright holder. */
  parent: { name: "Arize AI", url: "https://arize.com" },
  nav: [
    { label: "Mission", href: withBase("/mission") },
    { label: "Projects", href: withBase("/#projects") },
    { label: "Blog", href: withBase("/blog") },
    { label: "Team", href: withBase("/team") },
  ],
  social: {
    github: "https://github.com/Arize-ai",
    x: "https://x.com/arizeai",
    linkedin: "https://www.linkedin.com/company/arizeai",
  },
  postsPerPage: 10,
} as const;

export type NavItem = (typeof site.nav)[number];
