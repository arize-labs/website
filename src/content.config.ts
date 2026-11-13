import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { ART_KINDS } from "./components/art/cover-art";

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
      /**
       * A video post: the video replaces the cover at the top of the post and
       * is announced to social platforms (og:video) and search (VideoObject).
       * Set `src` for a self-hosted MP4 or `youtube` for a YouTube id.
       */
      video: z
        .object({
          /** An MP4 file, root-relative (under public/) or an absolute https URL. */
          src: z.string().optional(),
          /** A YouTube video id, instead of `src`. */
          youtube: z.string().regex(/^[\w-]{11}$/, "a YouTube id is 11 characters").optional(),
          /** The frame shown before playback, and on the post's social card. */
          poster: image(),
          /** Length in seconds. */
          duration: z.number().int().positive(),
          width: z.number().int().positive().default(1920),
          height: z.number().int().positive().default(1080),
          /** WebVTT captions, root-relative (under public/). */
          captions: z.string().optional(),
        })
        .refine((v) => !!v.src !== !!v.youtube, "set exactly one of `video.src` and `video.youtube`")
        .optional(),
      /** A hand-made 1200 × 630 social image, instead of the generated card. */
      ogImage: image().optional(),
      /** Style of the generated cover art when there's no `cover` image; picked from the post id if omitted. */
      art: z.enum(ART_KINDS).optional(),
      draft: z.boolean().default(false),
    }),
});

/** Standalone pages whose copy lives in Markdown (mission, about, ...). */
const pages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { team, posts, pages };
