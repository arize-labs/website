import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;
export type Member = CollectionEntry<"team">;

/** Published posts, newest first. Drafts show in `astro dev` only. */
export async function getPosts(filter: (post: Post) => boolean = () => true): Promise<Post[]> {
  const posts = await getCollection("posts", (post) => (import.meta.env.PROD ? !post.data.draft : true) && filter(post));
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function getPostsByAuthor(memberId: string): Promise<Post[]> {
  return getPosts((post) => post.data.authors.some((author) => author.id === memberId));
}

export async function getTeam(): Promise<Member[]> {
  const team = await getCollection("team");
  return team.sort((a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name));
}

export const tagSlug = (tag: string) =>
  tag.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function getTags(): Promise<{ name: string; slug: string; count: number }[]> {
  const counts = new Map<string, { name: string; slug: string; count: number }>();
  for (const post of await getPosts()) {
    for (const name of post.data.tags) {
      const slug = tagSlug(name);
      const entry = counts.get(slug) ?? { name, slug, count: 0 };
      entry.count++;
      counts.set(slug, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Reading time at about 230 words a minute, from the raw Markdown body. */
export const readingMinutes = (post: Post) =>
  Math.max(1, Math.round((post.body ?? "").split(/\s+/).filter(Boolean).length / 230));

export const postUrl = (post: Post) => `/blog/${post.id}`;
export const memberUrl = (member: Member | { id: string }) => `/team/${member.id}`;
export const tagUrl = (tag: string) => `/blog/tags/${tagSlug(tag)}`;
