// Start screen: pick a RAW, show a loading bar while it decodes, then present
// the embedded thumbnail + EXIF and an Enhance button. The decode done here (a
// half-size linear decode) is reused by the editor — "Enhance" does NOT re-run
// the decoder.

import { loadAnyImage } from "../worker/image";
import type { DecodedImage, RawMeta } from "../worker/decode";
import { renderExif } from "./exif";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing start-screen element #${id}`);
  return node as T;
}

export interface StartScreenCallbacks {
  /** Fired when the user taps Enhance, with the already-decoded image and metadata. */
  onEnhance: (file: File, image: DecodedImage, meta: RawMeta) => void;
}

export function initStartScreen({ onEnhance }: StartScreenCallbacks): void {
  const fileInput = el<HTMLInputElement>("file");
  const loading = el("loading");
  const progressFill = el("progress-fill");
  const progressLabel = el("progress-label");
  const result = el("load-result");
  const thumb = el<HTMLImageElement>("thumb");
  const exif = el("exif");
  const enhance = el<HTMLButtonElement>("enhance");
  const errorEl = el("start-error");

  let pending: { file: File; image: DecodedImage; meta: RawMeta } | null = null;
  let lastThumbUrl: string | null = null;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    result.hidden = true;
    errorEl.hidden = true;
    loading.hidden = false;
    const processingIndicator = document.getElementById("processing-indicator");
    if (processingIndicator) processingIndicator.classList.remove("hidden");
    const finish = animateProgress(progressFill, progressLabel);

    try {
      const loaded = await loadAnyImage(file);
      finish(true);

      if (lastThumbUrl) URL.revokeObjectURL(lastThumbUrl);
      lastThumbUrl = loaded.thumbnailUrl;
      if (loaded.thumbnailUrl) {
        thumb.src = loaded.thumbnailUrl;
        thumb.hidden = false;
      } else {
        thumb.hidden = true;
      }

      renderExif(exif, loaded.meta);
      pending = { file, image: loaded.image, meta: loaded.meta };

      loading.hidden = true;
      result.hidden = false;
    } catch (err) {
      finish(false);
      loading.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent = `Could not read this file: ${(err as Error).message}`;
      console.error(err);
    } finally {
      if (processingIndicator) processingIndicator.classList.add("hidden");
    }
  });

  enhance.addEventListener("click", () => {
    if (pending) onEnhance(pending.file, pending.image, pending.meta);
  });
}

/**
 * Animate the progress bar while a decode runs. LibRaw gives no progress
 * callback, so we ramp toward 90% on a timer and snap to 100% on completion —
 * enough to feel responsive without faking precision.
 */
function animateProgress(
  fill: HTMLElement,
  label: HTMLElement,
): (success: boolean) => void {
  fill.style.width = "8%";
  label.textContent = "Reading file…";
  let width = 8;
  const timer = window.setInterval(() => {
    width = Math.min(90, width + 7);
    fill.style.width = `${width}%`;
    if (width > 35) label.textContent = "Processing image…";
  }, 180);

  return (success: boolean) => {
    clearInterval(timer);
    fill.style.width = success ? "100%" : `${width}%`;
    label.textContent = success ? "Done" : "Failed";
  };
}
