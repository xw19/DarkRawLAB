// Native JPEG/PNG (raster) decode path.
//
// The RAW path (decode.ts) decodes a camera RAW to *scene-linear* light via
// LibRaw. Ordinary photos — JPEG/PNG a non-savvy user already has on their
// phone — are already display-rendered: the camera's tone curve is baked in and
// the pixels are sRGB-gamma-encoded 8-bit. To feed them through the *same* GPU
// pipeline (which assumes linear light), we decode natively in the browser and
// convert sRGB → linear here. With the Filmic display transform OFF (the app
// defaults it off for these sources — see main.ts), the shader's linear → sRGB
// display transform is the exact inverse of this step, so an unedited photo
// renders pixel-for-pixel like the original, and exposure/contrast/WB still
// operate in linear light as the pipeline expects.
//
// Unlike LibRaw, this runs on the main thread — browser image decoding is fast
// and createImageBitmap does the heavy lifting off-thread internally.

import { loadRaw } from "./decode";
import type { DecodedImage, LoadedRaw, RawMeta } from "./decode";

/** Raster formats we decode natively (everything else goes to the RAW path). */
const RASTER_EXTENSIONS = ["jpg", "jpeg", "png"] as const;
const RASTER_MIME = ["image/jpeg", "image/png"];

/**
 * Above this long-edge size we halve a raster image for editing (full-res is
 * still used at export). Mirrors the RAW pipeline's half-size rule: a 24MP photo
 * at 16-bit-equivalent float is hundreds of MB and strains phone memory. Normal
 * web-sized photos stay full-res and crisp.
 */
const EDIT_DOWNSCALE_THRESHOLD = 2560;

/** True if this file should decode via the native raster path, not LibRaw. */
export function isRasterImageFile(file: File): boolean {
  if (RASTER_MIME.includes(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (RASTER_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * sRGB (8-bit, 0..255) → linear light [0,1]. The standard sRGB EOTF; the exact
 * inverse of the shader's `linearToSrgb`, so decode → edit-nothing → display is
 * lossless. Exported for tests.
 */
export function srgbToLinear(u8: number): number {
  const c = u8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Precomputed sRGB→linear ramp: one lookup per sample instead of a pow() over
 *  millions of pixels (keeps the decode off the UI's critical path). */
const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i);
  return lut;
})();

interface RasterDecodeOptions {
  /** Halve large images for the editing preview (default). False = full-res. */
  halfSize?: boolean;
}

/** Decode a JPEG/PNG file to linear-light RGBA float, honouring EXIF orientation. */
export async function decodeRasterImage(
  file: Blob,
  opts: RasterDecodeOptions = {},
): Promise<DecodedImage> {
  // `from-image` applies the EXIF orientation tag so phone photos shot in
  // portrait come out upright instead of sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const maxDim = Math.max(bitmap.width, bitmap.height);
    const scale = opts.halfSize && maxDim > EDIT_DOWNSCALE_THRESHOLD ? 0.5 : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not get a 2D canvas context to decode the image");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    const count = width * height;
    const pixels = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const di = i * 4;
      pixels[di] = SRGB_TO_LINEAR[data[di]!]!;
      pixels[di + 1] = SRGB_TO_LINEAR[data[di + 1]!]!;
      pixels[di + 2] = SRGB_TO_LINEAR[data[di + 2]!]!;
      pixels[di + 3] = 1; // ignore source alpha; the pipeline is opaque
    }
    return { width, height, pixels };
  } finally {
    bitmap.close();
  }
}

/** Minimal metadata for a raster file. JPEG/PNG carry little of the camera EXIF
 *  the RAW panel shows; renderExif skips empty rows, so this shows dimensions. */
function rasterMeta(width: number, height: number): RawMeta {
  return {
    make: "",
    model: "",
    lens: null,
    isoSpeed: 0,
    shutter: 0,
    aperture: 0,
    focalLen: 0,
    timestamp: null,
    width,
    height,
  };
}

/**
 * Load a JPEG/PNG for the start screen: a (possibly half-size) linear image the
 * editor reuses, minimal metadata, and the original file as its own thumbnail.
 */
export async function loadRasterImage(file: File): Promise<LoadedRaw> {
  const image = await decodeRasterImage(file, { halfSize: true });
  // The browser renders JPEG/PNG in an <img> directly, so the file itself is the
  // fast-paint thumbnail — no separate embedded preview to extract.
  const thumbnailUrl = URL.createObjectURL(file);
  return { image, meta: rasterMeta(image.width, image.height), thumbnailUrl };
}

/**
 * One entry point for any supported file: routes JPEG/PNG to the native decoder
 * and everything else (camera RAW) to LibRaw. Both return the same LoadedRaw
 * shape, so the UI doesn't branch.
 */
export async function loadAnyImage(file: File): Promise<LoadedRaw> {
  if (isRasterImageFile(file)) return loadRasterImage(file);
  return loadRaw(await file.arrayBuffer());
}
