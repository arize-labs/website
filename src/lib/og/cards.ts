/**
 * Which social card each page gets, and what is on it. The cards themselves
 * are drawn by render.ts and served by src/pages/og/[...card].png.ts.
 *
 * - Posts: the title, date and byline, over the post's cover art, its cover
 *   image, or (video posts) the video's poster. A post's `ogImage` replaces
 *   the generated card.
 * - Team members: name and role, with their headshot.
 * - Pages listed in PAGES: their title and intro.
 * - Everything else (tag pages, 404): the site card.
 */
import { getEntries, getEntry } from "astro:content";
import { getPosts, getTeam, readingMinutes, type Member, type Post } from "../content";
import { site } from "../../site.config";
import { OG_HEIGHT, OG_WIDTH, cardFormat, type Card } from "./render";

const date = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** Interior pages with a card of their own, keyed by path. Keep the copy in step with the page's title block. */
const PAGES: Record<string, () => Promise<Omit<Card, "panel" | "alt"> & { art?: Card["panel"] }>> = {
  blog: async () => ({ eyebrow: ["Blog"], title: "Blog", subtitle: "News, writing and resources about the open-source projects." }),
  team: async () => ({ eyebrow: ["Team"], title: "Team", subtitle: "The engineers, researchers and designers behind Arize Labs." }),
  mission: async () => {
    const page = await getEntry("pages", "mission");
    return { eyebrow: ["Mission"], title: page?.data.title ?? "Mission", subtitle: page?.data.description };
  },
  credits: async () => ({ eyebrow: ["Credits"], title: "Credits", subtitle: "Work by others that this site is built with, and the licences it is used under." }),
  brand: async () => ({ eyebrow: ["Brand"], title: "Brand guidelines", subtitle: "The Arize Labs identity: a mark and a two-line wordmark." }),
};

const SITE_CARD = "site";

/** The card's file under /og/, for `key` (a path like `blog/my-post`). */
const cardFile = (key: string, format: "png" | "jpg" = "png") => `${key}.${format}`;
const MIME = { png: "image/png", jpg: "image/jpeg" } as const;

export interface SocialImage {
  /** Root-relative or absolute. */
  url: string;
  width: number;
  height: number;
  type: string;
  alt: string;
}

/** The generated card for a page that doesn't pass its own: its PAGES card, or the site card. */
export function defaultSocialImage(pathname: string, title?: string): SocialImage {
  const [first, second, ...more] = pathname.split("/").filter(Boolean);
  const own = first in PAGES && (second === undefined || (first === "blog" && /^\d+$/.test(second) && !more.length));
  return {
    url: `/og/${cardFile(own ? first : SITE_CARD)}`,
    width: OG_WIDTH,
    height: OG_HEIGHT,
    type: MIME.png,
    alt: title ? `${title} · ${site.name}` : site.name,
  };
}

/** The social image for a post: its own `ogImage`, or its generated card. */
export function postSocialImage(post: Post): SocialImage {
  const { ogImage, title } = post.data;
  if (ogImage) return { url: ogImage.src, width: ogImage.width, height: ogImage.height, type: `image/${ogImage.format === "jpg" ? "jpeg" : ogImage.format}`, alt: title };
  return generated(`blog/${post.id}`, postPanel(post), postAlt(post));
}

/** The social image for a team member's page. */
export function memberSocialImage(member: Member): SocialImage {
  const { name, role } = member.data;
  return generated(`team/${member.id}`, memberPanel(member), `${name}, ${role} at ${site.name}`);
}

function generated(key: string, panel: Card["panel"], alt: string): SocialImage {
  const format = cardFormat({ panel });
  return { url: `/og/${cardFile(key, format)}`, width: OG_WIDTH, height: OG_HEIGHT, type: MIME[format], alt };
}

function postPanel(post: Post): Card["panel"] {
  const { cover, art, video } = post.data;
  return video ? { image: video.poster, video: video.duration } : cover ? { image: cover } : { art, seed: post.id };
}

function memberPanel(member: Member): Card["panel"] {
  const { avatar } = member.data;
  return avatar ? { image: avatar, grayscale: true } : { art: "mark", seed: member.id };
}

function postAlt(post: Post) {
  return post.data.video ? `Video: ${post.data.title}` : post.data.title;
}

async function postCard(post: Post): Promise<Card> {
  const { title, pubDate, authors, video } = post.data;
  const members = await getEntries(authors);
  const names = members.map((m) => m.data.name);
  const byline = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  // A video's running time is on its poster, so the byline leaves it out.
  const length = `${readingMinutes(post)} min read`;
  return {
    eyebrow: video ? ["Video", date(pubDate)] : ["Blog", date(pubDate)],
    title,
    subtitle: video ? byline : `${byline} · ${length}`,
    panel: postPanel(post),
    alt: postAlt(post),
  };
}

/** Every card to draw, by its file under /og/. */
export async function getCards(): Promise<{ file: string; card: Card }[]> {
  const cards: { key: string; card: Card }[] = [];

  const [headline, ...rest] = site.description.split(/(?<=\.)\s+/);
  cards.push({
    key: SITE_CARD,
    card: { eyebrow: ["Open tooling", "Evals", "Research"], title: headline, subtitle: rest.join(" "), panel: { art: "mark", seed: "site" }, alt: site.name },
  });

  for (const [key, load] of Object.entries(PAGES)) {
    const { art, ...page } = await load();
    cards.push({ key, card: { ...page, panel: art ?? { art: undefined, seed: key }, alt: `${page.title} · ${site.name}` } });
  }

  for (const post of await getPosts()) {
    if (!post.data.ogImage) cards.push({ key: `blog/${post.id}`, card: await postCard(post) });
  }

  for (const member of await getTeam()) {
    const { name, role } = member.data;
    cards.push({
      key: `team/${member.id}`,
      card: { eyebrow: ["Team"], title: name, subtitle: role, panel: memberPanel(member), alt: `${name}, ${role} at ${site.name}` },
    });
  }
  return cards.map(({ key, card }) => ({ file: cardFile(key, cardFormat(card)), card }));
}
