// Interactive crop overlay.
//
// Draws a draggable crop rectangle over the displayed canvas: a dimmed mask
// outside it, a rule-of-thirds grid inside, and four corner handles. Uses
// Pointer Events so mouse and touch share one code path (touch-first, per
// CLAUDE.md). It only edits the CropRect — the actual crop is applied by the
// renderer when the caller commits. All geometry math lives in editor/crop.ts.

import { fullCrop, moveCrop, resizeCrop } from "../editor/crop";
import type { CropRect, Corner } from "../editor/crop";

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

interface Drag {
  mode: "move" | Corner;
  startCrop: CropRect;
  startNx: number;
  startNy: number;
  pointerId: number;
  target: HTMLElement;
}

export class CropOverlay {
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange: (c: CropRect) => void;
  private readonly windowEl: HTMLDivElement;
  private cropRect: CropRect = fullCrop;
  private drag: Drag | null = null;
  private visible = false;

  constructor(
    stage: HTMLElement,
    canvas: HTMLCanvasElement,
    onChange: (c: CropRect) => void,
  ) {
    this.stage = stage;
    this.canvas = canvas;
    this.onChange = onChange;

    this.windowEl = document.createElement("div");
    this.windowEl.className = "crop-window hidden";

    // Rule-of-thirds grid lines.
    for (const frac of [1 / 3, 2 / 3]) {
      const v = document.createElement("div");
      v.className = "crop-grid crop-grid-v";
      v.style.left = `${frac * 100}%`;
      const h = document.createElement("div");
      h.className = "crop-grid crop-grid-h";
      h.style.top = `${frac * 100}%`;
      this.windowEl.append(v, h);
    }

    // Corner handles.
    for (const corner of CORNERS) {
      const handle = document.createElement("div");
      handle.className = `crop-handle crop-${corner}`;
      handle.addEventListener("pointerdown", (e) => this.startDrag(corner, e));
      handle.addEventListener("pointermove", (e) => this.moveDrag(e));
      handle.addEventListener("pointerup", (e) => this.endDrag(e));
      handle.addEventListener("pointercancel", (e) => this.endDrag(e));
      this.windowEl.append(handle);
    }

    // Interior drag = move the whole crop.
    this.windowEl.addEventListener("pointerdown", (e) => this.startDrag("move", e));
    this.windowEl.addEventListener("pointermove", (e) => this.moveDrag(e));
    this.windowEl.addEventListener("pointerup", (e) => this.endDrag(e));
    this.windowEl.addEventListener("pointercancel", (e) => this.endDrag(e));

    // Keep aligned to the (letterboxed) canvas as the viewport changes.
    window.addEventListener("resize", () => {
      if (this.visible) this.layout();
    });

    stage.append(this.windowEl);
  }

  get crop(): CropRect {
    return this.cropRect;
  }

  show(crop: CropRect): void {
    this.cropRect = crop;
    this.visible = true;
    this.windowEl.classList.remove("hidden");
    this.layout();
  }

  hide(): void {
    this.visible = false;
    this.windowEl.classList.add("hidden");
  }

  /** Map a pointer position to normalised image coordinates in [0,1]. */
  private normalized(e: PointerEvent): { nx: number; ny: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      nx: clamp((e.clientX - r.left) / r.width, 0, 1),
      ny: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  }

  private startDrag(mode: "move" | Corner, e: PointerEvent): void {
    // Handles sit inside the window; stop the interior "move" from also firing.
    e.stopPropagation();
    e.preventDefault();
    const { nx, ny } = this.normalized(e);
    const target = e.currentTarget as HTMLElement;
    this.drag = { mode, startCrop: this.cropRect, startNx: nx, startNy: ny, pointerId: e.pointerId, target };
    target.setPointerCapture(e.pointerId);
  }

  private moveDrag(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    const { nx, ny } = this.normalized(e);
    this.cropRect =
      drag.mode === "move"
        ? moveCrop(drag.startCrop, nx - drag.startNx, ny - drag.startNy)
        : resizeCrop(drag.startCrop, drag.mode, nx, ny);
    this.layout();
    this.onChange(this.cropRect);
  }

  private endDrag(e: PointerEvent): void {
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.drag.target.releasePointerCapture(e.pointerId);
      this.drag = null;
    }
  }

  /** Position the crop window over the canvas's displayed (letterboxed) rect. */
  private layout(): void {
    const r = this.canvas.getBoundingClientRect();
    const s = this.stage.getBoundingClientRect();
    const c = this.cropRect;
    this.windowEl.style.left = `${r.left - s.left + c.x * r.width}px`;
    this.windowEl.style.top = `${r.top - s.top + c.y * r.height}px`;
    this.windowEl.style.width = `${c.w * r.width}px`;
    this.windowEl.style.height = `${c.h * r.height}px`;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
