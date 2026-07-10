// Export screen: choose format (8-bit JPEG) and quality, then Download or go
// Back. It reads the controls and delegates the actual full-res export to the
// caller, which owns the busy/status handling.

import type { ExportOptions, ExportFormat } from "../export/export";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing export-screen element #${id}`);
  return node as T;
}

export interface ExportScreenCallbacks {
  onDownload: (options: ExportOptions) => void;
  onBack: () => void;
}

export function initExportScreen({ onDownload, onBack }: ExportScreenCallbacks): void {
  const format = el<HTMLSelectElement>("export-format");
  const quality = el<HTMLInputElement>("export-quality");
  const qualityVal = el("export-quality-val");
  const run = el<HTMLButtonElement>("export-run");
  const back = el<HTMLButtonElement>("export-back");

  quality.addEventListener("input", () => {
    qualityVal.textContent = quality.value;
  });

  run.addEventListener("click", () => {
    onDownload({
      format: format.value as ExportFormat,
      quality: Number(quality.value) / 100, // slider is 50..100; encode wants 0..1
    });
  });

  back.addEventListener("click", onBack);
}
