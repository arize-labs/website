/**
 * Layout for <Strip>: a prompt or context window drawn as a row of
 * segments, left to right in the order the model reads them. Figures that
 * need to place markers against a strip call this too, so they agree with
 * what Strip draws.
 */
export type SegState = "plain" | "cached" | "full" | "ghost";

export interface Seg {
  /** data-key for scenes; also used to address the segment's label. */
  k?: string;
  label?: string;
  /** Width in diagram units. */
  w: number;
  state?: SegState;
}

export interface PlacedSeg extends Seg {
  x: number;
}

/** Mono at 11px runs about 6.7 units a character. */
export const labelFits = (label: string, w: number) => label.length * 6.7 + 10 <= w;

export function layoutStrip(segs: Seg[], x = 0, gap = 6): PlacedSeg[] {
  let at = x;
  return segs.map((s) => {
    const placed = { ...s, x: at };
    at += s.w + gap;
    return placed;
  });
}

/** Right edge of a laid-out strip. */
export const stripEnd = (segs: PlacedSeg[]) => (segs.length ? segs[segs.length - 1].x + segs[segs.length - 1].w : 0);
