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
import { renderExif } from "./ui/exif";
import { ZoomController } from "./ui/zoom";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const viewContainer = document.querySelector<HTMLDivElement>("#view-container")!;
const resetZoomBtn = document.querySelector<HTMLButtonElement>("#reset-zoom")!;
const zoomController = new ZoomController(stage, viewContainer, (scale) => {
  resetZoomBtn.classList.toggle("hidden", scale <= 1.0);
});
resetZoomBtn.addEventListener("click", () => zoomController.reset());

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const tabTune = document.querySelector<HTMLButtonElement>("#tab-tune")!;
const tabCrop = document.querySelector<HTMLButtonElement>("#tab-crop")!;
const tabColor = document.querySelector<HTMLButtonElement>("#tab-color")!;
const tabDenoise = document.querySelector<HTMLButtonElement>("#tab-denoise")!;
const tabInfo = document.querySelector<HTMLButtonElement>("#tab-info")!;
const controlsContainer = document.querySelector<HTMLDivElement>("#controls")!;
const resetCrop = document.querySelector<HTMLButtonElement>("#reset-crop")!;
const exportBtn = document.querySelector<HTMLButtonElement>("#export")!;
// The adjustment sliders are wired entirely from the SLIDERS table via
// initControls(); main only needs the rotate controls it drives directly.
const rotateSliderInput = document.querySelector<HTMLInputElement>("#rotate-slider")!;
const rotateLeftInput = document.querySelector<HTMLButtonElement>("#rotate-left")!;
const rotateRightInput = document.querySelector<HTMLButtonElement>("#rotate-right")!;
const rotation90Input = document.querySelector<HTMLInputElement>("#rotation90")!;
const exportStatus = document.querySelector<HTMLParagraphElement>("#export-status")!;
const exportRun = document.querySelector<HTMLButtonElement>("#export-run")!;

// One WebGL2 context for the app's lifetime; images are swapped as textures.
const renderer = new Renderer(canvas);

// Latest edit state, tracked so export can re-apply it to the full-res decode.
let currentEdits: EditState = defaultEditState;
const controls = initControls((state) => {
  currentEdits = state;
  renderer.setEdits(toUniforms(state));
});

// Crop state: `committedCrop` is what's shown normally; the overlay edits a
// working copy that only takes effect when the user leaves crop mode.
let committedCrop: CropRect = fullCrop;
let cropMode = false;
let currentFile: File | null = null;
const overlay = new CropOverlay(canvas, () => {});

function enterCropMode(): void {
  cropMode = true;
  renderer.setCrop(fullCrop); // show the full frame while cropping
  overlay.show(committedCrop, currentEdits.rotation90);
}

function exitCropMode(): void {
  cropMode = false;
  committedCrop = overlay.crop;
  overlay.hide();
  renderer.setCrop(committedCrop);
}

function switchTab(tab: "tune" | "crop" | "color" | "denoise" | "info"): void {
  controlsContainer.dataset.activeTab = tab;
  for (const btn of [tabTune, tabCrop, tabColor, tabDenoise, tabInfo]) {
    btn.classList.toggle("active", btn.id === `tab-${tab}`);
  }
  // Auto crop toggle: enter crop mode only when selecting Crop tab; commit & exit
  // crop mode as soon as you toggle away to another tab.
  if (tab === "crop" && !cropMode) {
    enterCropMode();
  } else if (tab !== "crop" && cropMode) {
    exitCropMode();
  }
}

const tuneSubmenuItems = document.querySelectorAll<HTMLButtonElement>("#panel-tune .submenu-item");
const colorSubmenuItems = document.querySelectorAll<HTMLButtonElement>("#panel-color .submenu-item");
const denoiseSubmenuItems = document.querySelectorAll<HTMLButtonElement>("#panel-denoise .submenu-item");
const panelTune = document.querySelector<HTMLDivElement>("#panel-tune")!;
const panelColor = document.querySelector<HTMLDivElement>("#panel-color")!;
const panelDenoise = document.querySelector<HTMLDivElement>("#panel-denoise")!;

function switchTuneParam(param: "exposure" | "contrast" | "highlights" | "shadows"): void {
  panelTune.dataset.activeParam = param;
  tuneSubmenuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.param === param);
  });
}

function switchColorParam(param: "temp" | "tint" | "saturation" | "vibrance" | "luminance"): void {
  panelColor.dataset.activeParam = param;
  colorSubmenuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.param === param);
  });
}

function switchDenoiseParam(param: "fine" | "coarse" | "chroma" | "grain-strength" | "grain-size"): void {
  panelDenoise.dataset.activeParam = param;
  denoiseSubmenuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.param === param);
  });
}

tuneSubmenuItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const param = btn.dataset.param as "exposure" | "contrast" | "highlights" | "shadows";
    if (param) switchTuneParam(param);
  });
});

colorSubmenuItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const param = btn.dataset.param as "temp" | "tint" | "saturation" | "vibrance" | "luminance";
    if (param) switchColorParam(param);
  });
});

denoiseSubmenuItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const param = btn.dataset.param as "fine" | "coarse" | "chroma" | "grain-strength" | "grain-size";
    if (param) switchDenoiseParam(param);
  });
});

function stepRotation(dir: number): void {
  const current = Number(rotation90Input.value);
  const next = (current + dir + 4) % 4;
  rotation90Input.value = String(next);
  controls.refresh(); // re-read inputs → currentEdits + renderer resync

  if (cropMode) {
    overlay.show(committedCrop, next);
  }
}

rotateLeftInput.addEventListener("click", () => stepRotation(-1));
rotateRightInput.addEventListener("click", () => stepRotation(1));

tabTune.addEventListener("click", () => switchTab("tune"));
tabCrop.addEventListener("click", () => switchTab("crop"));
tabColor.addEventListener("click", () => switchTab("color"));
tabDenoise.addEventListener("click", () => switchTab("denoise"));
tabInfo.addEventListener("click", () => switchTab("info"));
resetCrop.addEventListener("click", () => {
  overlay.show(fullCrop, 0);
  rotateSliderInput.value = "0";
  rotation90Input.value = "0";
  controls.refresh(); // re-read the rotate inputs → currentEdits + renderer resync
  zoomController.reset();
});

// ---- Start screen → Editor -------------------------------------------------
initStartScreen({
  onEnhance: (file, image, meta) => {
    currentFile = file;
    committedCrop = fullCrop;
    controls.reset(); // sliders → defaults; also resyncs currentEdits + renderer
    zoomController.reset();
    renderer.setImage(image); // reuses the start-screen decode; no re-decode
    statusEl.textContent = file.name;
    
    // Render metadata to the editor EXIF pane
    const editorExif = document.querySelector<HTMLElement>("#editor-exif");
    if (editorExif) {
      renderExif(editorExif, meta);
    }
    
    switchTuneParam("exposure");
    switchColorParam("temp");
    switchDenoiseParam("fine");
    switchTab("tune");
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
  const processingIndicator = document.getElementById("processing-indicator");
  if (processingIndicator) processingIndicator.classList.remove("hidden");
  try {
    await exportImage(currentFile, currentEdits, committedCrop, options);
    exportStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    exportStatus.textContent = `Export failed: ${(err as Error).message}`;
  } finally {
    exportRun.disabled = false;
    if (processingIndicator) processingIndicator.classList.add("hidden");
  }
}
