/**
 * Social cards: the 1200 × 630 images that link previews show (og:image,
 * twitter:image). Drawn at build time, one per page, by /og/[...card].ts.
 *
 * A card is a poster with one job: make the title readable at the size a
 * phone shows it, about half size. So it carries little, and big:
 *  - Text, on the left: an eyebrow in mono caps at the top, the lockup at the
 *    bottom, and between them the title, bold and as large as fits, with one
 *    line under it (the byline, or a description). Nothing is under 20px.
 *    Previews print the domain themselves, so the card doesn't.
 *  - Art, on the right: the post's halftone cover art, printed large and
 *    bleeding off the edge, its dot ground fading into the card so there is
 *    no box; or a picture (cover image, video poster, headshot) run full
 *    bleed. Video posters get a play button and the running time.
 *
 * Satori lays out the text (with the site's typefaces, so no fonts are
 * needed at render time) and sharp rasterizes it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageMetadata } from "astro";
import satori from "satori";
import sharp from "sharp";
import { coverArt, ART_BOX, type ArtKind, type ViewBox } from "../../components/art/cover-art";
import { art as brandArt } from "../brand";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Card colours: the dark theme in tokens.css. Paper type and halftone on ink
 * is the boldest thing the brand has, and it stands out in feeds, which are
 * mostly light.
 */
const T = { bg: "#161314", fg: "#f6f5f2", soft: "#bdb8b0", dim: "#9b958d", dot: 0.2 };
const ACCENT = "#ff5a1f";

// Layout, in card pixels.
const PAD = 72;
/** Where the art starts; its first FADE pixels dissolve into the ground. */
const ART_X = 600;
const FADE = 140;
/** Where a full-bleed picture starts. */
const PICTURE_X = 700;
const TEXT_W = 548;

export type CardPicture = {
  image: ImageMetadata;
  /** Headshots are black and white on the site, so on cards too. */
  grayscale?: boolean;
  /** Seconds. Marks the picture as a video: a play button and the running time. */
  video?: number;
};

export interface Card {
  /** Mono caps parts, joined with a middle dot. */
  eyebrow: string[];
  title: string;
  /** One line under the title: the byline, or a description. */
  subtitle?: string;
  /** Generated cover art, or a picture. */
  panel: { art: ArtKind | undefined; seed: string } | CardPicture;
  /** Accessible description of the image, for og:image:alt. */
  alt: string;
}

// ---------------------------------------------------------------------------
// Assets

const root = process.cwd();
type Font = { name: string; data: Buffer; weight: 600 | 700; style: "normal" };
let fonts: Promise<Font[]> | undefined;
function loadFonts() {
  const file = (pkg: string, name: string, family: string, weight: Font["weight"]) =>
    readFile(join(root, "node_modules/@fontsource", pkg, "files", name)).then((data): Font => ({ name: family, data, weight, style: "normal" }));
  fonts ??= Promise.all([
    file("urbanist", "urbanist-latin-700-normal.woff", "Urbanist", 700),
    file("urbanist", "urbanist-latin-600-normal.woff", "Urbanist", 600),
    file("geist-mono", "geist-mono-latin-600-normal.woff", "Geist Mono", 600),
  ]);
  return fonts;
}

/**
 * The source file behind an image import. Astro keeps it on the image as a
 * non-enumerable `fsPath`; in dev the URL also carries it (/@fs/...).
 */
function imagePath(image: ImageMetadata): string {
  const fsPath = (image as ImageMetadata & { fsPath?: string }).fsPath;
  if (fsPath) return fsPath;
  const dev = image.src.match(/^\/@fs(\/[^?]+)/)?.[1];
  if (dev) return decodeURIComponent(dev);
  if (image.src.startsWith("file:")) return fileURLToPath(image.src);
  throw new Error(`Social card: can't find the file for image ${image.src}`);
}

const dataUri = (buf: Buffer, type = "image/png") => `data:${type};base64,${buf.toString("base64")}`;
const svgDoc = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;

export function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------------------
// Art and pictures, rasterized by sharp

/**
 * The cover art, printed large: the subject spans about 80% of the art's
 * width, and the left edge fades to transparent so the dots dissolve into
 * the card instead of stopping at a box.
 */
async function artLayer(seed: string, kind: ArtKind | undefined): Promise<Buffer> {
  const width = OG_WIDTH - ART_X;
  const { subject } = ART_BOX;
  // The subject sits in the art that's past the fade.
  const scale = (0.82 * (width - FADE / 2)) / (subject.x1 - subject.x0);
  const w = width / scale, h = OG_HEIGHT / scale;
  const cx = (subject.x0 + subject.x1) / 2 - FADE / 4 / scale, cy = (subject.y0 + subject.y1) / 2;
  const view: ViewBox = [cx - w / 2, cy - h / 2, w, h];
  const svg = coverArt(seed, kind, view)
    .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${OG_HEIGHT}" `)
    .replace(/fill-opacity:\.16/, `fill-opacity:${T.dot}`)
    .replaceAll("var(--fg)", T.fg)
    .replaceAll("var(--bg)", T.bg)
    .replaceAll("var(--accent)", ACCENT);
  const fade = svgDoc(
    width,
    OG_HEIGHT,
    `<defs><linearGradient id="f" x1="0" x2="${FADE}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/>`,
  );
  return sharp(Buffer.from(svg))
    .ensureAlpha()
    .composite([{ input: Buffer.from(fade), blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** The dot ground on its own, fading in from the left like the art's. */
function ground(width: number) {
  const p = 6.4;
  return svgDoc(
    width,
    OG_HEIGHT,
    `<defs><pattern id="g" width="${2 * p}" height="${2 * p}" patternUnits="userSpaceOnUse">` +
      `<circle cx="${p / 2}" cy="${p / 2}" r="1.1" fill="${T.fg}" fill-opacity="${T.dot}"/><circle cx="${1.5 * p}" cy="${1.5 * p}" r="1.1" fill="${T.fg}" fill-opacity="${T.dot}"/></pattern>` +
      `<linearGradient id="f" x1="0" x2="${FADE}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
      `<mask id="m"><rect width="100%" height="100%" fill="url(#f)"/></mask></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)" mask="url(#m)"/>`,
  );
}

/**
 * A cover image, framed on the dot ground like a figure: covers are often
 * screenshots, which don't survive a crop. Wide images are cropped to 8:5 at
 * most, as on the site's post cards.
 */
async function framedLayer({ image }: CardPicture): Promise<Buffer> {
  const width = OG_WIDTH - ART_X;
  const aspect = Math.min(8 / 5, Math.max(4 / 5, image.width / image.height));
  const maxW = width - FADE / 2 - 56, maxH = OG_HEIGHT - 2 * PAD;
  const w = Math.round(Math.min(maxW, maxH * aspect)), h = Math.round(w / aspect);
  const x = Math.round(FADE / 2 + (width - FADE / 2 - w) / 2), y = Math.round((OG_HEIGHT - h) / 2);
  const picture = await sharp(await readFile(imagePath(image))).rotate().resize(w, h, { fit: "cover" }).png().toBuffer();
  const frame = svgDoc(width, OG_HEIGHT, `<rect x="${x - 0.5}" y="${y - 0.5}" width="${w + 1}" height="${h + 1}" fill="none" stroke="${T.fg}" stroke-opacity=".22"/>`);
  return sharp(Buffer.from(ground(width)))
    .composite([{ input: picture, left: x, top: y }, { input: Buffer.from(frame) }])
    .png()
    .toBuffer();
}

/** A video poster or a headshot, run full bleed on the right; posters get a play button. */
async function bleedLayer({ image, grayscale = false, video }: CardPicture): Promise<Buffer> {
  const width = OG_WIDTH - PICTURE_X;
  let picture = sharp(await readFile(imagePath(image))).rotate().resize(width, OG_HEIGHT, { fit: "cover", position: "attention" });
  if (grayscale) picture = picture.grayscale();
  if (video === undefined) return picture.jpeg({ quality: 92 }).toBuffer();

  const cx = width / 2, cy = OG_HEIGHT / 2, r = 58;
  const play =
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ACCENT}"/>` +
    // A triangle nudged right, so it looks centred in the circle.
    `<path d="M${cx - r * 0.28} ${cy - r * 0.4}L${cx + r * 0.44} ${cy}L${cx - r * 0.28} ${cy + r * 0.4}Z" fill="#fff" stroke="#fff" stroke-width="${r * 0.1}" stroke-linejoin="round"/>`;
  return picture
    .composite([{ input: Buffer.from(svgDoc(width, OG_HEIGHT, play)) }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// The card, laid out by Satori

type El = { type: string; props: Record<string, unknown> };
type Child = El | string | null | undefined | false;
function el(type: string, props: Record<string, unknown>, ...children: Child[]): El {
  const kids = children.filter((c): c is El | string => !!c);
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
}
const div = (style: Record<string, unknown>, ...children: Child[]) => el("div", { style: { display: "flex", ...style } }, ...children);

const mono = (size: number, color: string) => ({
  fontFamily: "Geist Mono",
  fontWeight: 600,
  fontSize: size,
  letterSpacing: size * 0.08,
  textTransform: "uppercase" as const,
  color,
});

/** Rough advance widths for Urbanist 700, in ems, by character class. */
function charWidth(c: string) {
  if (c === " ") return 0.24;
  if (/[iljtfr.,:;'’!|()\-]/.test(c)) return 0.31;
  if (/[mwMW]/.test(c)) return 0.84;
  if (/[A-Z0-9]/.test(c)) return 0.66;
  return 0.55;
}

/** How many lines `text` takes at `size`, wrapping word by word (and after hyphens) as Satori does. */
function lineCount(text: string, size: number, width: number, tracking: number) {
  let lines = 1, line = 0;
  for (const word of text.split(/(?<=-)|\s+/)) {
    const w = [...word].reduce((sum, c) => sum + charWidth(c) + tracking, 0) * size;
    const gap = line > 0 ? charWidth(" ") * size : 0;
    if (line > 0 && line + gap + w > width) {
      lines++;
      line = w;
    } else line += gap + w;
  }
  return lines;
}

const TRACKING = -0.03;

/**
 * The largest title size that fits in three lines (four for long titles),
 * with a little room to spare, as the widths are estimates. Satori's line
 * clamp is the backstop.
 */
function titleSize(title: string, width: number): { size: number; lines: number } {
  for (const size of [92, 84, 76, 68, 62]) if (lineCount(title, size, width * 0.94, TRACKING) <= 3) return { size, lines: 3 };
  return { size: 56, lines: 4 };
}

export async function renderCard(card: Card): Promise<Buffer> {
  const picture = "image" in card.panel ? card.panel : undefined;
  const bleed = !!picture && (picture.video !== undefined || !!picture.grayscale);
  const layer = !picture
    ? await artLayer((card.panel as { seed: string }).seed, (card.panel as { art: ArtKind | undefined }).art)
    : bleed
      ? await bleedLayer(picture)
      : await framedLayer(picture);
  const layerX = bleed ? PICTURE_X : ART_X;
  const textW = bleed ? PICTURE_X - PAD - 56 : TEXT_W;

  const lockup = brandArt.lockup;
  const lockupH = 46;
  const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${lockup.viewBox.x} ${lockup.viewBox.y} ${lockup.viewBox.w} ${lockup.viewBox.h}">${lockup.body.replaceAll("#000000", T.fg)}</svg>`;

  const { size, lines } = titleSize(card.title, textW);

  const timestamp =
    picture?.video !== undefined &&
    div({ position: "absolute", right: 28, bottom: 28, padding: "7px 12px 6px", background: "rgba(22,19,20,.86)", borderRadius: 6, ...mono(22, "#fff") }, formatDuration(picture.video));

  const tree = div(
    { width: OG_WIDTH, height: OG_HEIGHT, background: T.bg, fontFamily: "Urbanist", color: T.fg },
    div(
      { position: "absolute", left: layerX, top: 0, width: OG_WIDTH - layerX, height: OG_HEIGHT },
      el("img", { src: dataUri(layer, bleed ? "image/jpeg" : "image/png"), width: OG_WIDTH - layerX, height: OG_HEIGHT }),
      timestamp,
    ),
    div(
      // Satori boxes are content-box: the padding sits outside width and height.
      { position: "absolute", left: 0, top: 0, flexDirection: "column", width: textW, height: OG_HEIGHT - 2 * PAD, padding: `${PAD}px 0 ${PAD}px ${PAD}px` },
      div({ ...mono(22, T.dim) }, card.eyebrow.join(" · ")),
      div(
        { flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 24 },
        div({ fontSize: size, fontWeight: 700, lineHeight: 1, letterSpacing: size * TRACKING, lineClamp: lines, display: "block" }, card.title),
        card.subtitle && div({ fontSize: 30, fontWeight: 600, lineHeight: 1.3, color: T.soft, lineClamp: 3, display: "block" }, card.subtitle),
      ),
      el("img", { src: dataUri(Buffer.from(lockupSvg), "image/svg+xml"), height: lockupH, width: Math.round((lockupH * lockup.viewBox.w) / lockup.viewBox.h) }),
    ),
  );

  const svg = await satori(tree as Parameters<typeof satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts: await loadFonts() });
  const out = sharp(Buffer.from(svg));
  return cardFormat(card) === "png" ? out.png({ palette: true, colours: 64, compressionLevel: 9 }).toBuffer() : out.jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

/**
 * Cards with cover art are flat colour: a 64-colour PNG keeps the type and
 * halftone crisp in under 100 KB. Photographs go out as JPEG, keeping cards
 * well under the 300 KB that some previews (WhatsApp) start to refuse.
 */
export const cardFormat = (card: Pick<Card, "panel">): "png" | "jpg" => ("image" in card.panel ? "jpg" : "png");
