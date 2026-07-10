// DarkRaw Lab — main thread entry and screen orchestration.
//
// Three screens: Start (pick RAW → progress → thumbnail + EXIF → Enhance),
// Editor (exposure/contrast/crop), Export (format + quality → download). The
// heavy decode runs on Start and its result is reused by the Editor — the only
// re-decode is the full-resolution one at export.

import { Renderer } from "./gl/renderer";
import { defaultEditState, toUniforms } from "./editor/pipeline";
import type { EditState } from "./editor/pipeline";
import { fullCrop } from "./editor/crop";
import type { CropRect } from "./editor/crop";
import { initControls } from "./ui/controls";
import { CropOverlay } from "./ui/cropOverlay";
import { initStartScreen } from "./ui/startScreen";
import { initExportScreen } from "./ui/exportScreen";
import { showScreen } from "./ui/screens";
import { exportImage } from "./export/export";
import type { ExportOptions } from "./export/export";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const cropToggle = document.querySelector<HTMLButtonElement>("#crop-toggle")!;
const resetCrop = document.querySelector<HTMLButtonElement>("#reset-crop")!;
const exportBtn = document.querySelector<HTMLButtonElement>("#export")!;
const exposureInput = document.querySelector<HTMLInputElement>("#exposure")!;
const contrastInput = document.querySelector<HTMLInputElement>("#contrast")!;
const exportStatus = document.querySelector<HTMLParagraphElement>("#export-status")!;
const exportRun = document.querySelector<HTMLButtonElement>("#export-run")!;

// One WebGL2 context for the app's lifetime; images are swapped as textures.
const renderer = new Renderer(canvas);

// Latest edit state, tracked so export can re-apply it to the full-res decode.
let currentEdits: EditState = defaultEditState;
initControls((state) => {
  currentEdits = state;
  renderer.setEdits(toUniforms(state));
});

// Crop state: `committedCrop` is what's shown normally; the overlay edits a
// working copy that only takes effect when the user leaves crop mode.
let committedCrop: CropRect = fullCrop;
let cropMode = false;
let currentFile: File | null = null;
const overlay = new CropOverlay(stage, canvas, () => {});

function enterCropMode(): void {
  cropMode = true;
  renderer.setCrop(fullCrop); // show the full frame while cropping
  overlay.show(committedCrop);
  cropToggle.textContent = "Done";
  cropToggle.classList.add("active");
  resetCrop.hidden = false;
}

function exitCropMode(): void {
  cropMode = false;
  committedCrop = overlay.crop;
  overlay.hide();
  renderer.setCrop(committedCrop);
  cropToggle.textContent = "Crop";
  cropToggle.classList.remove("active");
  resetCrop.hidden = true;
}

cropToggle.addEventListener("click", () => {
  if (cropMode) exitCropMode();
  else enterCropMode();
});
resetCrop.addEventListener("click", () => overlay.show(fullCrop));

// ---- Start screen → Editor -------------------------------------------------
initStartScreen({
  onEnhance: (file, image) => {
    currentFile = file;
    committedCrop = fullCrop;
    resetEditControls();
    renderer.setImage(image); // reuses the start-screen decode; no re-decode
    statusEl.textContent = `${file.name} — ${image.width}×${image.height}`;
    showScreen("editor");
  },
});

// ---- Editor → Export screen ------------------------------------------------
exportBtn.addEventListener("click", () => {
  if (cropMode) exitCropMode();
  exportStatus.textContent = "";
  showScreen("export");
});

// ---- Export screen ---------------------------------------------------------
initExportScreen({
  onDownload: runExport,
  onBack: () => showScreen("editor"),
});

async function runExport(options: ExportOptions): Promise<void> {
  if (!currentFile) return;
  exportRun.disabled = true;
  exportStatus.textContent = "Exporting at full resolution…";
  try {
    await exportImage(currentFile, currentEdits, committedCrop, options);
    exportStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    exportStatus.textContent = `Export failed: ${(err as Error).message}`;
  } finally {
    exportRun.disabled = false;
  }
}

/** Reset sliders (and the derived edit state) to defaults for a fresh image. */
function resetEditControls(): void {
  exposureInput.value = String(defaultEditState.exposureEv);
  contrastInput.value = String(defaultEditState.contrast);
  // Fire input so labels, `currentEdits`, and the renderer all resync.
  exposureInput.dispatchEvent(new Event("input", { bubbles: true }));
}
