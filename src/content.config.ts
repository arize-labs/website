import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const team = defineCollection({
  loader: glob({ pattern: "**/*.{md,yaml}", base: "./src/content/team" }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string(),
      avatar: image().optional(),
      links: z
        .object({
          github: z.url(),
          x: z.url(),
          linkedin: z.url(),
          website: z.url(),
        })
        .partial()
        .default({}),
      order: z.number().default(100),
    }),
});

const posts = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      authors: z.array(reference("team")).min(1),
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      draft: z.boolean().default(false),
    }),
});

/** Standalone pages whose copy lives in Markdown (mission, about, ...). */
const pages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    eyebrow: z.string().optional(),
    updatedDate: z.coerce.date().optional(),
  }),
});

export const collections = { team, posts, pages };
