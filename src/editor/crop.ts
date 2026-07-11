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

/** Rotate a CropRect by 90-degree increments (0 = 0, 1 = 90 CW, 2 = 180, 3 = 270 CW). */
export function rotateRect(c: CropRect, r: number): CropRect {
  r = (r % 4 + 4) % 4; // normalized to [0, 3]
  if (r === 1) { // 90 deg CW
    return { x: 1.0 - c.y - c.h, y: c.x, w: c.h, h: c.w };
  } else if (r === 2) { // 180 deg
    return { x: 1.0 - c.x - c.w, y: 1.0 - c.y - c.h, w: c.w, h: c.h };
  } else if (r === 3) { // 270 deg CW (90 CCW)
    return { x: c.y, y: 1.0 - c.x - c.w, w: c.h, h: c.w };
  }
  return c;
}

/** Unrotate a CropRect to undo 90-degree increments. */
export function unrotateRect(c: CropRect, r: number): CropRect {
  r = (r % 4 + 4) % 4;
  if (r === 1) return rotateRect(c, 3);
  if (r === 2) return rotateRect(c, 2);
  if (r === 3) return rotateRect(c, 1);
  return c;
}
