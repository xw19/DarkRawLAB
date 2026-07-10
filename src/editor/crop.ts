// Crop geometry — pure, GPU-free, testable.
//
// A crop is a rectangle in NORMALISED image space: x/y are the top-left corner
// and w/h the size, all in [0,1] with y pointing down (image convention). It is
// pure geometry: the renderer turns it into a texture-coordinate window and a
// canvas aspect, so cropping never reprocesses a single pixel — it only changes
// which part of the already-decoded texture we draw.

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const fullCrop: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** Which corner is being dragged. */
export type Corner = "nw" | "ne" | "sw" | "se";

/** Smallest allowed crop edge, so the rectangle can't collapse to nothing. */
const MIN_SIZE = 0.05;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Translate the whole crop by (dx,dy), clamped so it stays inside the image. */
export function moveCrop(c: CropRect, dx: number, dy: number): CropRect {
  return {
    x: clamp(c.x + dx, 0, 1 - c.w),
    y: clamp(c.y + dy, 0, 1 - c.h),
    w: c.w,
    h: c.h,
  };
}

/**
 * Drag `corner` to normalised point (px,py), holding the opposite corner fixed.
 * The dragged edges are clamped to the image bounds and to MIN_SIZE so the crop
 * stays valid.
 */
export function resizeCrop(
  c: CropRect,
  corner: Corner,
  px: number,
  py: number,
): CropRect {
  px = clamp(px, 0, 1);
  py = clamp(py, 0, 1);

  // Current edges; the opposite corner's edges stay put.
  let left = c.x;
  let top = c.y;
  let right = c.x + c.w;
  let bottom = c.y + c.h;

  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";

  if (west) left = Math.min(px, right - MIN_SIZE);
  else right = Math.max(px, left + MIN_SIZE);
  if (north) top = Math.min(py, bottom - MIN_SIZE);
  else bottom = Math.max(py, top + MIN_SIZE);

  return { x: left, y: top, w: right - left, h: bottom - top };
}
