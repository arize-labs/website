/**
 * `llms.txt` (https://llmstxt.org): what Arize Labs is, then a link to the
 * markdown copy of each page an agent would read, with a line on what it
 * covers. The copies and `llms-full.txt` are written after the build by
 * `src/integrations/llms-txt.mjs`, which reads this file for the pages
 * `llms-full.txt` includes.
 */
import type { APIContext } from "astro";
import { getEntry } from "astro:content";

import { FULL_SECTIONS, markdownRouteOf } from "../integrations/llms-txt.mjs";
import { getPosts, getTeam, memberUrl, postUrl } from "../lib/content";
import { withBase } from "../lib/url";
import { site } from "../site.config";

interface Link {
  title: string;
  /** The page's route, with the base path: `/website/mission`. */
  route: string;
  notes?: string;
  /** The link is to the page itself (a feed), not to a markdown copy. */
  raw?: boolean;
}

interface Section {
  title: string;
  links: Link[];
}

/** One line of the description: whitespace collapsed. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function getSections(): Promise<Section[]> {
  const mission = await getEntry("pages", "mission");
  if (!mission) throw new Error("Missing src/content/pages/mission.md");
  const posts = await getPosts();
  const team = await getTeam();
  return [
    {
      title: "About",
      links: [{ title: mission.data.title, route: withBase("/mission"), notes: mission.data.description }],
    },
    {
      title: "Blog",
      links: posts.map((post) => ({
        title: post.data.title,
        route: postUrl(post),
        notes: `${post.data.description} (${isoDate(post.data.pubDate)})`,
      })),
    },
    {
      title: "Team",
      links: team.map((member) => ({ title: member.data.name, route: memberUrl(member), notes: member.data.role })),
    },
    {
      title: "Optional",
      links: [
        { title: "Credits", route: withBase("/credits"), notes: "Photography and typefaces this site uses, and their licences" },
        { title: "Blog feed", route: withBase("/rss.xml"), notes: "RSS, every post newest first", raw: true },
      ],
    },
  ];
}

export async function GET(context: APIContext) {
  const absolute = (route: string) => new URL(route, context.site).href;
  const link = ({ title, route, notes, raw }: Link) =>
    `- [${title}](${absolute(raw ? route : markdownRouteOf(route))})${notes ? `: ${oneLine(notes)}` : ""}`;
  const sections = await getSections();
  const text = [
    `# ${site.name}`,
    `> Arize Labs is the open research and open-source group of ${site.parent.name}. It builds tooling for AI agents in the open, publishes evaluations with the harness and data behind them, and shares experiments while they are in progress.`,
    [
      `Its projects include Arize Phoenix (https://github.com/Arize-ai/phoenix), an open-source platform for tracing and evaluating AI agents, and OpenInference (https://github.com/Arize-ai/openinference), semantic conventions and instrumentation for tracing AI applications on OpenTelemetry. The blog has the write-ups: agent design, evaluation and LLM judges, benchmarking, prompt caching and observability.`,
      `Every page listed here is also markdown, at its URL plus \`.md\`; the links below are to those. ${absolute(withBase("/llms-full.txt"))} is the ${FULL_SECTIONS.join(" and ")} pages in one file.`,
    ].join("\n\n"),
    ...sections
      .filter((section) => section.links.length > 0)
      .map((section) => [`## ${section.title}`, ...section.links.map(link)].join("\n")),
  ].join("\n\n");
  return new Response(`${text}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
