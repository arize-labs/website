/**
 * PNG copies of the brand artwork, for places that can't take an SVG. Drawn
 * at build time from the SVGs by /brand/[file].ts, so they can't drift from
 * the artwork.
 *
 * Each is cropped to the artwork, like the SVG, on a transparent ground. A
 * raster can't be recoloured, so each comes in ink (for light grounds) and
 * paper (for dark ones). There are no JPEGs: the format has no transparency.
 */
import sharp from "sharp";
import { art, colors, type ArtworkName } from "./brand";

export type Tone = "ink" | "paper";

export interface Raster {
  /** File name, and the last segment of its URL under /brand/. */
  file: string;
  name: ArtworkName;
  tone: Tone;
}

/** Pixels along the artwork's longer edge. */
const LONG_EDGE = 2000;
/** The fill the SVG artwork is drawn in. */
const ART_FILL = "#000000";

const names = Object.keys(art) as ArtworkName[];
const tones: Tone[] = ["ink", "paper"];

export const rasters: Raster[] = names.flatMap((name) =>
  tones.map((tone) => ({ file: art[name].file.replace(/\.svg$/, `-${tone}.png`), name, tone })),
);

export async function renderRaster({ file, name, tone }: Raster): Promise<Buffer> {
  const { viewBox: vb, body } = art[name];
  if (!body.includes(ART_FILL)) throw new Error(`${file}: expected the artwork to be filled with ${ART_FILL}`);

  const scale = LONG_EDGE / Math.max(vb.w, vb.h);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vb.w * scale)}" height="${Math.round(vb.h * scale)}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">` +
    `${body.replaceAll(ART_FILL, colors[tone])}</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
