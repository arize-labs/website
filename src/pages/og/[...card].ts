/**
 * Social cards, one image per page: /og/site.png, /og/blog/<post>.png,
 * /og/team/<member>.jpg and so on. Drawn at build time; see src/lib/og.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getCards } from "../../lib/og/cards";
import { cardFormat, renderCard, type Card } from "../../lib/og/render";

export const getStaticPaths = (async () => {
  const cards = await getCards();
  return cards.map(({ file, card }) => ({ params: { card: file }, props: { card } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ card: Card }> = async ({ props }) => {
  const image = await renderCard(props.card);
  const type = cardFormat(props.card) === "png" ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(image), { headers: { "Content-Type": type } });
};
