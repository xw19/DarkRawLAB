// Decode entry point for DarkRaw Lab.
//
// This wraps the `libraw-wasm` package. That package already runs the LibRaw
// WASM decode inside its *own* module Web Worker, so calling these functions
// from the main thread never blocks the UI — the heavy work happens off-thread
// and we only exchange messages. We deliberately do NOT nest this inside a
// second Worker of our own: worker-spawning-worker is historically flaky on
// mobile Safari, and it would buy us nothing here.
//
// Scope: decode one RAW to *linear light* and hand back RGBA float pixels the
// GPU pipeline can treat as a linear texture. Everything after this — exposure,
// contrast, crop, display transform — happens in the shader, never here. This
// is the whole reason we decode to linear instead of editing a baked preview:
// exposure has to be a multiply in linear light for highlight recovery to work.

import LibRaw from "libraw-wasm";

export interface DecodedImage {
  /** Width in pixels of the decoded (possibly downscaled) image. */
  width: number;
  /**
   * RGBA pixels in **linear light**, normalised to [0,1], alpha = 1. Uploaded
   * verbatim to a WebGL2 RGBA16F texture; the display transform (linear→sRGB)
   * is applied in the fragment shader, not here.
   */
  pixels: Float32Array<ArrayBuffer>;
  /** Height in pixels of the decoded image. */
  height: number;
}

export interface DecodeOptions {
  /**
   * Decode at half resolution (default). We edit the half-size image for speed
   * and memory (CLAUDE.md mobile notes) and only decode full-size at export.
   */
  halfSize?: boolean;
}

/** Curated EXIF shown on the start screen. */
export interface RawMeta {
  make: string;
  model: string;
  lens: string | null;
  isoSpeed: number;
  /** Exposure time in seconds. */
  shutter: number;
  /** Aperture f-number. */
  aperture: number;
  /** Focal length in mm. */
  focalLen: number;
  timestamp: Date | null;
  width: number;
  height: number;
}

/** Everything the start screen needs from one decode pass. */
export interface LoadedRaw {
  image: DecodedImage;
  meta: RawMeta;
  /** Object URL of the embedded JPEG thumbnail, or null if none/!JPEG. */
  thumbnailUrl: string | null;
}

/**
 * LibRaw open settings implementing CLAUDE.md's pipeline contract. The only knob
 * that varies is resolution (half for editing, full for export).
 */
function openSettings(halfSize: boolean) {
  return {
    useCameraWb: true, // camera WB so colours are neutral before our edits
    // Use the camera colour matrix (dcraw +M). The wrapper zero-inits the params
    // struct, which disables it (standalone LibRaw defaults it on); without it the
    // camera→sRGB conversion is uncalibrated and Nikon files skew green/yellow.
    useCameraMatrix: 3,
    halfSize, // downscaled for editing; full-size at export
    outputBps: 16, // 16-bit: keep decode precision for the linear pipeline
    outputColor: 1, // sRGB primaries (gamma handled separately, see gamm)
    noAutoBright: true, // -W: no histogram auto-stretch; preserve true levels
    gamm: [1, 1] as [number, number], // linear tone curve → decode to linear light
  };
}

/**
 * Decode a RAW file to linear-light RGBA float.
 *
 * LibRaw settings implement CLAUDE.md's pipeline contract: linear gamma, no
 * auto-brighten, 16-bit, sRGB primaries. The only knob that differs between
 * editing and export is resolution: half-size for the live preview, full-size
 * when baking the final image.
 */
export async function decodeRaw(
  bytes: ArrayBuffer,
  opts: DecodeOptions = {},
): Promise<DecodedImage> {
  const libraw = new LibRaw();
  try {
    await libraw.open(new Uint8Array(bytes), openSettings(opts.halfSize ?? true));
    return await readImage(libraw);
  } finally {
    // Free the WASM instance/worker promptly — mobile has hard memory caps.
    libraw.dispose();
  }
}

/**
 * Open a RAW once and extract everything the start screen needs: the half-size
 * linear image (reused by the editor — no second decode on "Enhance"), the
 * EXIF metadata, and the embedded JPEG thumbnail for a fast first paint.
 */
export async function loadRaw(bytes: ArrayBuffer): Promise<LoadedRaw> {
  const libraw = new LibRaw();
  try {
    await libraw.open(new Uint8Array(bytes), openSettings(true));

    const md = await libraw.metadata(true);
    let thumbnailUrl = await readThumbnailUrl(libraw);
    const image = await readImage(libraw);

    if (!thumbnailUrl) {
      thumbnailUrl = await generateFallbackThumbnail(image);
    }

    const meta = toMeta(md, image.width, image.height);
    return { image, meta, thumbnailUrl };
  } finally {
    libraw.dispose();
  }
}

async function generateFallbackThumbnail(image: DecodedImage): Promise<string | null> {
  if (typeof document === "undefined") return null;
  try {
    const { width, height, pixels } = image;
    // Downsample to a max dimension of 600px for speed and memory efficiency
    const maxDim = 600;
    let scale = 1;
    if (width > maxDim || height > maxDim) {
      scale = Math.min(maxDim / width, maxDim / height);
    }
    const thumbWidth = Math.round(width * scale);
    const thumbHeight = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const imgData = ctx.createImageData(thumbWidth, thumbHeight);
    const data = imgData.data;

    for (let y = 0; y < thumbHeight; y++) {
      const srcY = Math.floor(y / scale);
      for (let x = 0; x < thumbWidth; x++) {
        const srcX = Math.floor(x / scale);
        const srcIdx = (srcY * width + srcX) * 4;
        const destIdx = (y * thumbWidth + x) * 4;

        // Extract linear-light values from the half-size decoded pixels
        const rLinear = pixels[srcIdx] ?? 0;
        const gLinear = pixels[srcIdx + 1] ?? 0;
        const bLinear = pixels[srcIdx + 2] ?? 0;

        // Clamp to [0, 1] range
        const r = Math.max(0, Math.min(1, rLinear));
        const g = Math.max(0, Math.min(1, gLinear));
        const b = Math.max(0, Math.min(1, bLinear));

        // Apply a fast gamma 2.2 approximation (power of 1 / 2.2 = 0.4545) for display
        data[destIdx] = Math.round(Math.pow(r, 0.4545) * 255);
        data[destIdx + 1] = Math.round(Math.pow(g, 0.4545) * 255);
        data[destIdx + 2] = Math.round(Math.pow(b, 0.4545) * 255);
        data[destIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          resolve(null);
        }
      }, "image/jpeg", 0.85);
    });
  } catch (err) {
    console.error("Failed to generate fallback thumbnail", err);
    return null;
  }
}

async function readImage(libraw: LibRaw): Promise<DecodedImage> {
  const img = await libraw.imageData();
  if (!img) throw new Error("LibRaw returned no image data");
  const { width, height, colors, bits, data } = img;
  const pixels = toLinearRgbaF32(data, width, height, colors, bits);
  return { width, height, pixels };
}

async function readThumbnailUrl(libraw: LibRaw): Promise<string | null> {
  try {
    const thumb = await libraw.thumbnailData();
    // Only embedded JPEG thumbnails (start with the SOI marker FF D8) are usable
    // as-is in an <img>; other formats are rare and we simply skip them.
    if (thumb?.data && thumb.data[0] === 0xff && thumb.data[1] === 0xd8) {
      // Copy into a fresh ArrayBuffer-backed view so it's a valid BlobPart.
      const jpeg = new Uint8Array(thumb.data);
      return URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
    }
  } catch {
    // Thumbnail is optional — a missing one just means no fast preview.
  }
  return null;
}

type RawMetadata = Awaited<ReturnType<LibRaw["metadata"]>>;

function toMeta(md: RawMetadata, width: number, height: number): RawMeta {
  const lens = md?.lens?.Lens ? String(md.lens.Lens).trim() : "";
  return {
    make: (md?.camera_make ?? "").trim(),
    model: (md?.camera_model ?? "").trim(),
    lens: lens.length > 0 ? lens : null,
    isoSpeed: md?.iso_speed ?? 0,
    shutter: md?.shutter ?? 0,
    aperture: md?.aperture ?? 0,
    focalLen: md?.focal_len ?? 0,
    timestamp: md?.timestamp instanceof Date ? md.timestamp : null,
    width,
    height,
  };
}

/**
 * Normalise LibRaw's interleaved integer output (3- or 4-channel) into packed
 * RGBA float in [0,1]. The values stay linear — we only divide by the sample
 * maximum to map the integer range onto [0,1]; no gamma is applied.
 */
function toLinearRgbaF32(
  data: Uint8Array | Uint16Array,
  width: number,
  height: number,
  colors: number,
  bits: number,
): Float32Array<ArrayBuffer> {
  const count = width * height;
  const out = new Float32Array(count * 4);
  const inv = 1 / (2 ** bits - 1); // 1/65535 for 16-bit

  for (let i = 0; i < count; i++) {
    const si = i * colors;
    const di = i * 4;
    // colors is 3 (RGB) or 4 (RGBA); index defensively for the 1-channel case.
    const r = (data[si] ?? 0) * inv;
    const g = colors > 1 ? (data[si + 1] ?? 0) * inv : r;
    const b = colors > 2 ? (data[si + 2] ?? 0) * inv : r;
    out[di] = r;
    out[di + 1] = g;
    out[di + 2] = b;
    out[di + 3] = 1;
  }
  return out;
}
