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
import { Drawer } from "./ui/drawer";
import { loadRaw } from "./worker/decode";
import type { DecodedImage, RawMeta } from "./worker/decode";
import { serializePreset, parsePreset } from "./editor/preset";
import { Histogram } from "./ui/histogram";

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
const tabMix = document.querySelector<HTMLButtonElement>("#tab-mix")!;
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

// ---- Slide-in menu drawer ---------------------------------------------------
// Reusable overlay drawer, mounted in the editor screen (so it hides with it).
// Swipe-to-open is scoped to the image stage, clear of the sliders.
const editorScreen = document.querySelector<HTMLElement>('[data-screen="editor"]')!;
const menuToggle = document.querySelector<HTMLButtonElement>("#menu-toggle")!;
const drawer = new Drawer(editorScreen, { title: "Menu", edgeHost: stage });
menuToggle.addEventListener("click", () => drawer.toggle());

// Filmic tone — an ACES filmic display transform for a darktable-like look.
// Unlike the view aids below, it's a rendering intent: on by default and baked
// into the export (see runExport). `filmicOn` is the source of truth for export.
let filmicOn = true;
const filmicRow = document.createElement("label");
filmicRow.className = "menu-row";
const filmicLabel = document.createElement("span");
filmicLabel.textContent = "Filmic tone";
const filmicToggle = document.createElement("input");
filmicToggle.type = "checkbox";
filmicToggle.checked = filmicOn;
filmicToggle.addEventListener("change", () => {
  filmicOn = filmicToggle.checked;
  renderer.setFilmic(filmicOn);
});
filmicRow.append(filmicLabel, filmicToggle);
drawer.content.append(filmicRow);

// Focus peaking — a view aid (highlights in-focus edges). Toggled here; it's a
// preview-only overlay in the renderer and is never baked into the export.
const peakRow = document.createElement("label");
peakRow.className = "menu-row";
const peakLabel = document.createElement("span");
peakLabel.textContent = "Focus peaking";
const peakToggle = document.createElement("input");
peakToggle.type = "checkbox";
peakToggle.addEventListener("change", () => renderer.setPeaking(peakToggle.checked));
peakRow.append(peakLabel, peakToggle);
drawer.content.append(peakRow);

// Histogram — a translucent RGB histogram over the stage's corner. It resamples
// on every render via renderer.onRender while enabled; the hook is cleared (and
// its cost avoided) when off.
const histogram = new Histogram(stage);
function refreshHistogram(): void {
  const s = renderer.sampleSmall();
  if (s) histogram.update(s.pixels);
}
const histRow = document.createElement("label");
histRow.className = "menu-row";
const histLabel = document.createElement("span");
histLabel.textContent = "Histogram";
const histToggle = document.createElement("input");
histToggle.type = "checkbox";
histToggle.addEventListener("change", () => {
  if (histToggle.checked) {
    histogram.show();
    renderer.onRender = refreshHistogram;
    refreshHistogram(); // populate immediately, without waiting for an edit
  } else {
    renderer.onRender = undefined;
    histogram.hide();
  }
});
histRow.append(histLabel, histToggle);
drawer.content.append(histRow);

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

function switchTab(tab: "tune" | "crop" | "color" | "denoise" | "mix"): void {
  controlsContainer.dataset.activeTab = tab;
  for (const btn of [tabTune, tabCrop, tabColor, tabDenoise, tabMix]) {
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
const mixSubmenuItems = document.querySelectorAll<HTMLButtonElement>("#panel-mix .submenu-item");
const denoiseSubmenuItems = document.querySelectorAll<HTMLButtonElement>("#panel-denoise .submenu-item");
const panelTune = document.querySelector<HTMLDivElement>("#panel-tune")!;
const panelColor = document.querySelector<HTMLDivElement>("#panel-color")!;
const panelMix = document.querySelector<HTMLDivElement>("#panel-mix")!;
const panelDenoise = document.querySelector<HTMLDivElement>("#panel-denoise")!;

function switchTuneParam(param: "exposure" | "contrast" | "highlights" | "shadows" | "whites" | "blacks"): void {
  panelTune.dataset.activeParam = param;
  tuneSubmenuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.param === param);
  });
}

type ColorParam = "temp" | "tint" | "saturation" | "vibrance" | "luminance";

type MixParam =
  | "mixR" | "mixG" | "mixB"
  | "hslRed" | "hslOrange" | "hslYellow" | "hslGreen"
  | "hslAqua" | "hslBlue" | "hslPurple" | "hslMagenta";

function switchColorParam(param: ColorParam): void {
  panelColor.dataset.activeParam = param;
  colorSubmenuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.param === param);
  });
}

function switchMixParam(param: MixParam): void {
  panelMix.dataset.activeParam = param;
  mixSubmenuItems.forEach((item) => {
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
    const param = btn.dataset.param as "exposure" | "contrast" | "highlights" | "shadows" | "whites" | "blacks";
    if (param) switchTuneParam(param);
  });
});

colorSubmenuItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const param = btn.dataset.param as ColorParam;
    if (param) switchColorParam(param);
  });
});

mixSubmenuItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const param = btn.dataset.param as MixParam;
    if (param) switchMixParam(param);
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
tabMix.addEventListener("click", () => switchTab("mix"));
resetCrop.addEventListener("click", () => {
  overlay.show(fullCrop, 0);
  rotateSliderInput.value = "0";
  rotation90Input.value = "0";
  controls.refresh(); // re-read the rotate inputs → currentEdits + renderer resync
  zoomController.reset();
});

// ---- Start screen → Editor -------------------------------------------------
/** Load a decoded image into the editor and show it. Shared by the Enhance
 *  button and the automation API (window.darkraw.loadRaw). */
function enterEditor(file: File, image: DecodedImage, meta: RawMeta): void {
  currentFile = file;
  committedCrop = fullCrop;
  controls.reset(); // sliders → defaults; also resyncs currentEdits + renderer
  zoomController.reset();
  renderer.setImage(image); // reuses the start-screen decode; no re-decode
  statusEl.textContent = file.name;

  const editorExif = document.querySelector<HTMLElement>("#editor-exif");
  if (editorExif) renderExif(editorExif, meta);

  switchTuneParam("exposure");
  switchColorParam("temp");
  switchMixParam("mixR");
  switchDenoiseParam("fine");
  switchTab("tune");
  showScreen("editor");
}

initStartScreen({ onEnhance: enterEditor });

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
    await exportImage(currentFile, currentEdits, committedCrop, options, filmicOn);
    exportStatus.textContent = "Saved ✓";
  } catch (err) {
    console.error(err);
    exportStatus.textContent = `Export failed: ${(err as Error).message}`;
  } finally {
    exportRun.disabled = false;
    if (processingIndicator) processingIndicator.classList.add("hidden");
  }
}

// ---- Automation API (window.darkraw) ---------------------------------------
// A small programmatic surface over the editor for presets and headless
// automation (see docs/mcp-design.md). It reuses the exact UI code paths, so
// there's no second pipeline. Also handy for the `verify` skill and preset
// save/load.

/** Build a PNG data URL of the current (edited, cropped) preview. */
function previewDataUrl(maxDim: number): string | null {
  const s = renderer.sampleSmall(maxDim);
  if (!s) return null;
  const c = document.createElement("canvas");
  c.width = s.width;
  c.height = s.height;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(s.width, s.height);
  // sampleSmall reads bottom-up (WebGL origin); flip rows to top-down.
  const row = s.width * 4;
  for (let y = 0; y < s.height; y++) {
    const src = (s.height - 1 - y) * row;
    img.data.set(s.pixels.subarray(src, src + row), y * row);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

interface DarkrawApi {
  getState(): { editState: EditState; crop: CropRect };
  getPreset(): string;
  applyEdits(editState: EditState): void;
  setCrop(crop: CropRect): void;
  loadPreset(json: string): void;
  loadRaw(bytes: ArrayBuffer, name?: string): Promise<RawMeta>;
  getPreview(maxDim?: number): string | null;
  export(options: ExportOptions): Promise<void>;
}

declare global {
  interface Window {
    darkraw: DarkrawApi;
  }
}

window.darkraw = {
  getState: () => ({ editState: currentEdits, crop: committedCrop }),
  getPreset: () => serializePreset(currentEdits, committedCrop),
  applyEdits: (editState) => controls.setState(editState),
  setCrop: (crop) => {
    committedCrop = crop;
    renderer.setCrop(crop);
  },
  loadPreset: (json) => {
    const p = parsePreset(json);
    controls.setState(p.editState);
    committedCrop = p.crop;
    renderer.setCrop(p.crop);
  },
  loadRaw: async (bytes, name = "image.raw") => {
    const loaded = await loadRaw(bytes);
    enterEditor(new File([bytes], name), loaded.image, loaded.meta);
    return loaded.meta;
  },
  getPreview: (maxDim = 256) => previewDataUrl(maxDim),
  export: async (options) => {
    if (!currentFile) throw new Error("No image loaded");
    await exportImage(currentFile, currentEdits, committedCrop, options, filmicOn);
  },
};
