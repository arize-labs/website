/**
 * PNG downloads of the brand artwork, on a transparent ground:
 * /brand/arize-labs-mark-ink.png, /brand/arize-labs-lockup-paper.png and so
 * on. Drawn at build time; see src/lib/brand-raster.ts.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { rasters, renderRaster, type Raster } from "../../lib/brand-raster";

export const getStaticPaths = (() =>
  rasters.map((raster) => ({ params: { file: raster.file }, props: { raster } }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ raster: Raster }> = async ({ props }) => {
  const image = await renderRaster(props.raster);
  return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png" } });
};
