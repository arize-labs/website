/**
 * Social cards: the 1200 × 630 images that link previews show (og:image,
 * twitter:image). Drawn at build time, one per page, by /og/[...card].png.
 *
 * Every card has the same two halves, so a feed of our links reads as one
 * series:
 *  - Text, on the left: the lockup and the domain, an eyebrow in mono caps,
 *    the title, then a description or a byline. The title is the largest
 *    thing on the card and is sized to fit, so it survives the smallest
 *    previews.
 *  - A panel, on the right, on the site's dot ground: the post's halftone
 *    cover art, or a framed picture (a cover image, a video poster, a
 *    headshot) with registration crosses on its corners. Video posters get a
 *    play button and the running time, so a video reads as one before anyone
 *    clicks.
 *
 * The card is always the light theme: ink on paper. Feeds are both light
 * and dark, and paper stands out in either.
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

/** The card's colours: the light theme in tokens.css. */
const C = {
  ink: "#231f20",
  paper: "#f6f5f2",
  surface: "#ffffff",
  rule: "#d8d5ce",
  dim: "#6f6b66",
  soft: "#4b4745",
  accent: "#ff5a1f",
};

// Layout, in card pixels.
const PANEL_X = 640;
const PANEL_W = OG_WIDTH - PANEL_X;
const PAD_X = 64;
const PAD_Y = 56;
const TEXT_W = PANEL_X - PAD_X - 48;

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
  /** Shown under the title when there is no byline. */
  description?: string;
  /** The people behind it, with their headshots, and facts like the reading time. */
  byline?: { people: { name: string; avatar?: ImageMetadata }[]; meta: string[] };
  /** Generated cover art, or a picture to frame. */
  panel: { art: ArtKind | undefined; seed: string } | CardPicture;
  /** Accessible description of the image, for og:image:alt. */
  alt: string;
}

// ---------------------------------------------------------------------------
// Assets

const root = process.cwd();
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" }[]> | undefined;
function loadFonts() {
  const file = (pkg: string, name: string) => readFile(join(root, "node_modules/@fontsource", pkg, "files", name));
  fonts ??= Promise.all([
    file("urbanist", "urbanist-latin-600-normal.woff").then((data) => ({ name: "Urbanist", data, weight: 600 as const, style: "normal" as const })),
    file("urbanist", "urbanist-latin-500-normal.woff").then((data) => ({ name: "Urbanist", data, weight: 500 as const, style: "normal" as const })),
    file("geist-mono", "geist-mono-latin-500-normal.woff").then((data) => ({ name: "Geist Mono", data, weight: 500 as const, style: "normal" as const })),
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

const dataUri = (png: Buffer, type = "image/png") => `data:${type};base64,${png.toString("base64")}`;

// ---------------------------------------------------------------------------
// The panel (right half), rasterized by sharp

/** The site's faint dot ground, on the cover art's 45° screen. */
function ground(width: number, height: number, pitch = 5.8) {
  const r = 1;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><pattern id="g" width="${2 * pitch}" height="${2 * pitch}" patternUnits="userSpaceOnUse">` +
    `<circle cx="${pitch / 2}" cy="${pitch / 2}" r="${r}" fill="${C.ink}" fill-opacity=".16"/>` +
    `<circle cx="${1.5 * pitch}" cy="${1.5 * pitch}" r="${r}" fill="${C.ink}" fill-opacity=".16"/>` +
    `</pattern></defs><rect width="100%" height="100%" fill="${C.paper}"/><rect width="100%" height="100%" fill="url(#g)"/></svg>`
  );
}

/** The cover art, reframed to the panel: the subject fills about three quarters of its width. */
async function artPanel(seed: string, kind: ArtKind | undefined): Promise<Buffer> {
  const { subject } = ART_BOX;
  const scale = (0.76 * PANEL_W) / (subject.x1 - subject.x0);
  const w = PANEL_W / scale, h = OG_HEIGHT / scale;
  const cx = (subject.x0 + subject.x1) / 2, cy = (subject.y0 + subject.y1) / 2;
  const view: ViewBox = [cx - w / 2, cy - h / 2, w, h];
  const svg = coverArt(seed, kind, view)
    .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_W}" height="${OG_HEIGHT}" `)
    .replaceAll("var(--fg)", C.ink)
    .replaceAll("var(--bg)", C.paper)
    .replaceAll("var(--accent)", C.accent);
  return sharp(Buffer.from(svg)).flatten({ background: C.paper }).png().toBuffer();
}

const cross = (x: number, y: number, arm = 7) =>
  `<path d="M${x - arm} ${y + 0.5}h${2 * arm + 1}M${x + 0.5} ${y - arm}v${2 * arm + 1}" stroke="${C.ink}" stroke-opacity=".45"/>`;

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * A picture framed on the dot ground. Wide pictures are cropped to 8:5, as
 * cover images are on the site's post cards, and tall ones to 4:5, as
 * headshots are; anything in between keeps its own shape.
 */
async function picturePanel({ image, grayscale = false, video }: CardPicture): Promise<{ png: Buffer; frame: { x: number; y: number; w: number; h: number } }> {
  const maxW = PANEL_W - 2 * 32, maxH = OG_HEIGHT - 2 * 56;
  const aspect = Math.min(8 / 5, Math.max(4 / 5, image.width / image.height));
  const w = Math.round(Math.min(maxW, maxH * aspect)), h = Math.round(w / aspect);
  const x = Math.round((PANEL_W - w) / 2), y = Math.round((OG_HEIGHT - h) / 2);

  let picture = sharp(await readFile(imagePath(image))).rotate().resize(w, h, { fit: "cover" });
  if (grayscale) picture = picture.grayscale();
  const pictureBuf = await picture.png().toBuffer();

  // Drawn over the picture: its 1px frame, registration crosses on the
  // corners, and for video a play button and the running time.
  let overlay = `<rect x="${x - 0.5}" y="${y - 0.5}" width="${w + 1}" height="${h + 1}" fill="none" stroke="${C.rule}"/>`;
  overlay += cross(x - 1, y - 1) + cross(x + w, y - 1) + cross(x - 1, y + h) + cross(x + w, y + h);
  if (video !== undefined) {
    const cx = x + w / 2, cy = y + h / 2, r = Math.round(Math.min(44, h / 5));
    overlay +=
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.accent}"/>` +
      // A triangle nudged right, so it looks centred in the circle.
      `<path d="M${cx - r * 0.3} ${cy - r * 0.42}L${cx + r * 0.46} ${cy}L${cx - r * 0.3} ${cy + r * 0.42}Z" fill="${C.paper}" stroke="${C.paper}" stroke-width="${r * 0.08}" stroke-linejoin="round"/>`;
  }
  const png = await sharp(Buffer.from(ground(PANEL_W, OG_HEIGHT)))
    .composite([
      { input: pictureBuf, left: x, top: y },
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_W}" height="${OG_HEIGHT}">${overlay}</svg>`), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  return { png, frame: { x, y, w, h } };
}

async function avatar(image: ImageMetadata, size: number) {
  const png = await sharp(await readFile(imagePath(image)))
    .rotate()
    .resize(size * 2, size * 2, { fit: "cover", position: "attention" })
    .grayscale()
    .png()
    .toBuffer();
  return dataUri(png);
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

const mono = (size: number, color = C.dim) => ({
  fontFamily: "Geist Mono",
  fontWeight: 500,
  fontSize: size,
  letterSpacing: size * 0.08,
  textTransform: "uppercase" as const,
  color,
});

/** Rough advance widths for Urbanist 600, in ems, by character class. */
function charWidth(c: string) {
  if (c === " ") return 0.24;
  if (/[iljtfr.,:;'’!|()\-]/.test(c)) return 0.3;
  if (/[mwMW]/.test(c)) return 0.82;
  if (/[A-Z0-9]/.test(c)) return 0.64;
  return 0.53;
}

/** How many lines `text` takes at `size`, wrapping word by word (and after hyphens) as Satori does. */
function lineCount(text: string, size: number, width: number) {
  const words = text.split(/(?<=-)|\s+/);
  let lines = 1, line = 0;
  for (const word of words) {
    const w = [...word].reduce((sum, c) => sum + charWidth(c), 0) * size;
    const gap = line > 0 ? charWidth(" ") * size : 0;
    if (line > 0 && line + gap + w > width) {
      lines++;
      line = w;
    } else line += gap + w;
  }
  return lines;
}

/**
 * The largest title size that fits in three lines (four for long titles),
 * with a little room to spare, as the widths are estimates. Satori's line
 * clamp is the backstop.
 */
function titleSize(title: string): { size: number; lines: number } {
  for (const size of [64, 58, 52]) if (lineCount(title, size, TEXT_W * 0.92) <= 3) return { size, lines: 3 };
  return { size: 46, lines: 4 };
}

export async function renderCard(card: Card, host: string): Promise<Buffer> {
  const picture = "image" in card.panel ? card.panel : undefined;
  const panel = "image" in card.panel ? await picturePanel(card.panel) : { png: await artPanel(card.panel.seed, card.panel.art), frame: undefined };

  const lockup = brandArt.lockup;
  const lockupH = 40;
  const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${lockup.viewBox.x} ${lockup.viewBox.y} ${lockup.viewBox.w} ${lockup.viewBox.h}">${lockup.body.replaceAll("#000000", C.ink)}</svg>`;

  const { size, lines } = titleSize(card.title);
  const avatarSize = 44;
  const people = card.byline?.people ?? [];
  const avatars = await Promise.all(people.filter((p) => p.avatar).map((p) => avatar(p.avatar!, avatarSize)));

  const byline =
    card.byline &&
    div(
      { alignItems: "center", gap: 16 },
      avatars.length > 0 &&
        div(
          { paddingLeft: 10 },
          ...avatars.map((src) =>
            el("img", { src, width: avatarSize, height: avatarSize, style: { marginLeft: -10, borderRadius: avatarSize, border: `2px solid ${C.paper}` } }),
          ),
        ),
      div(
        { flexDirection: "column", gap: 6 },
        div({ ...mono(17, C.ink) }, people.map((p) => p.name).join(", ")),
        card.byline.meta.length > 0 && div({ ...mono(15) }, card.byline.meta.join("  ·  ")),
      ),
    );

  const timestamp =
    picture?.video !== undefined && panel.frame
      ? div(
          {
            position: "absolute",
            right: PANEL_W - (panel.frame.x + panel.frame.w) + 12,
            bottom: OG_HEIGHT - (panel.frame.y + panel.frame.h) + 12,
            padding: "5px 9px 4px",
            background: C.ink,
            ...mono(15, C.paper),
          },
          formatDuration(picture.video),
        )
      : null;

  const tree = div(
    { width: OG_WIDTH, height: OG_HEIGHT, background: C.paper, fontFamily: "Urbanist", color: C.ink },
    // Text
    div(
      // Satori boxes are content-box: the padding sits outside width and height.
      { flexDirection: "column", width: TEXT_W, height: OG_HEIGHT - 2 * PAD_Y, padding: `${PAD_Y}px ${PANEL_X - PAD_X - TEXT_W}px ${PAD_Y}px ${PAD_X}px` },
      div(
        { alignItems: "center", justifyContent: "space-between" },
        el("img", { src: dataUri(Buffer.from(lockupSvg), "image/svg+xml"), height: lockupH, width: Math.round((lockupH * lockup.viewBox.w) / lockup.viewBox.h) }),
        div({ ...mono(15) }, host),
      ),
      div(
        { flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 22, paddingTop: 8 },
        div({ ...mono(17), gap: 0 }, card.eyebrow.join("  ·  ")),
        div(
          {
            fontSize: size,
            fontWeight: 600,
            lineHeight: 1.04,
            letterSpacing: size * -0.025,
            maxWidth: TEXT_W,
            lineClamp: lines,
            display: "block",
          },
          card.title,
        ),
        card.description &&
          !card.byline &&
          div({ fontSize: 26, fontWeight: 500, lineHeight: 1.35, color: C.soft, maxWidth: TEXT_W, lineClamp: 2, display: "block" }, card.description),
      ),
      byline,
    ),
    // Panel
    div(
      { position: "absolute", left: PANEL_X, top: 0, width: PANEL_W, height: OG_HEIGHT, borderLeft: `1px solid ${C.rule}` },
      el("img", { src: dataUri(panel.png), width: PANEL_W, height: OG_HEIGHT }),
      timestamp,
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

export { formatDuration };
