// Format decoded EXIF into a definition list. Pure formatting — takes RawMeta,
// fills the given container. Rows with no data are skipped.

import type { RawMeta } from "../worker/decode";

/** Format a shutter time as camera-style "1/250 s" or "2 s". */
function formatShutter(seconds: number): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

function formatDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime()) || d.getTime() === 0) return null;
  return d.toLocaleString();
}

export function renderExif(container: HTMLElement, meta: RawMeta): void {
  const camera = [meta.make, meta.model].map((s) => s.trim()).filter(Boolean).join(" ");

  const rows: [string, string | null][] = [
    ["Camera", camera || null],
    ["Lens", meta.lens],
    ["ISO", meta.isoSpeed ? String(meta.isoSpeed) : null],
    ["Aperture", meta.aperture ? `f/${Number(meta.aperture.toFixed(1))}` : null],
    ["Shutter", formatShutter(meta.shutter)],
    ["Focal length", meta.focalLen ? `${Math.round(meta.focalLen)} mm` : null],
    ["Dimensions", `${meta.width} × ${meta.height}`],
    ["Taken", formatDate(meta.timestamp)],
  ];

  container.replaceChildren();
  for (const [label, value] of rows) {
    if (!value) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    container.append(dt, dd);
  }
}
