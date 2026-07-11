// Full-resolution export.
//
// This is the ONE place we decode at full resolution (CLAUDE.md: editing runs
// on a half-size decode; full-res only at export). We then re-run the exact same
// GL pipeline the preview uses — same shader, same uniforms — so the exported
// JPEG is pixel-identical to what's on screen, just at full size. Reusing the
// display Renderer is what guarantees that; there's no second copy of the
// pipeline math to drift out of sync.

import { decodeRaw } from "../worker/decode";
import { Renderer } from "../gl/renderer";
import { toUniforms } from "../editor/pipeline";
import type { EditState } from "../editor/pipeline";
import type { CropRect } from "../editor/crop";

/** Chosen output format. JPEG and PNG are supported. */
export type ExportFormat = "jpeg" | "png";

export interface ExportOptions {
  format: ExportFormat;
  /** JPEG quality in [0,1]. Ignored for PNG. */
  quality: number;
}

export const defaultExportOptions: ExportOptions = {
  format: "jpeg",
  quality: 0.92,
};

/**
 * Decode `file` at full resolution, bake the current edits + crop into pixels,
 * encode an 8-bit JPEG or PNG, and trigger a download.
 */
export async function exportImage(
  file: File,
  edits: EditState,
  crop: CropRect,
  options: ExportOptions,
  filmic: boolean,
): Promise<void> {
  const bytes = await file.arrayBuffer();
  const image = await decodeRaw(bytes, { halfSize: false });

  // Offscreen canvas + a throwaway renderer with preserveDrawingBuffer so
  // toBlob can read the result. setImage/setEdits/setCrop drive the identical
  // pipeline the screen uses; the canvas ends up sized to the crop in full-res
  // pixels.
  const canvas = document.createElement("canvas");
  const renderer = new Renderer(canvas, { preserveDrawingBuffer: true });
  try {
    renderer.setImage(image);
    renderer.setEdits(toUniforms(edits));
    renderer.setCrop(crop);
    renderer.setFilmic(filmic); // match the preview's display transform
    const blob = await canvasToBlob(canvas, options);
    downloadBlob(blob, exportName(file.name, options.format));
  } finally {
    renderer.dispose();
  }
}

const MIME: Record<ExportFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  { format, quality }: ExportOptions,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const callback = (blob: Blob | null) =>
      blob ? resolve(blob) : reject(new Error("Image encoding failed"));
    if (format === "png") {
      canvas.toBlob(callback, MIME[format]);
    } else {
      canvas.toBlob(callback, MIME[format], quality);
    }
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EXTENSION: Record<ExportFormat, string> = {
  jpeg: "jpg",
  png: "png",
};

/** `DSC01234.ARW` → `DSC01234-darkraw.jpg`. */
function exportName(original: string, format: ExportFormat): string {
  const base = original.replace(/\.[^./\\]+$/, "");
  return `${base}-darkraw.${EXTENSION[format]}`;
}
