// Interactive crop overlay.
//
// Draws a draggable crop rectangle over the displayed canvas: a dimmed mask
// outside it, a rule-of-thirds grid inside, and four corner handles. Uses
// Pointer Events so mouse and touch share one code path (touch-first, per
// CLAUDE.md). It only edits the CropRect — the actual crop is applied by the
// renderer when the caller commits. All geometry math lives in editor/crop.ts.

import { fullCrop, moveCrop, resizeCrop, rotateRect, unrotateRect } from "../editor/crop";
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
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange: (c: CropRect) => void;
  private readonly windowEl: HTMLDivElement;
  private cropRect: CropRect = fullCrop;
  private drag: Drag | null = null;
  private visible = false;
  private rotation90 = 0;

  constructor(
    canvas: HTMLCanvasElement,
    onChange: (c: CropRect) => void,
  ) {
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
    this.canvas.parentElement!.appendChild(this.windowEl);
    window.addEventListener("resize", () => {
      if (this.visible) this.layout();
    });
  }

  get crop(): CropRect {
    return this.cropRect;
  }

  show(crop: CropRect, rotation90 = 0): void {
    this.cropRect = crop;
    this.rotation90 = rotation90;
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
    
    // 1. Convert start crop to rotated space
    const startCropRotated = rotateRect(drag.startCrop, this.rotation90);
    
    // 2. Perform crop operation on rotated space (aligned with screen canvas)
    const cropRotated =
      drag.mode === "move"
        ? moveCrop(startCropRotated, nx - drag.startNx, ny - drag.startNy)
        : resizeCrop(startCropRotated, drag.mode, nx, ny);
        
    // 3. Convert back to original coordinates using inverse rotation
    this.cropRect = unrotateRect(cropRotated, this.rotation90);
    
    this.layout();
    this.onChange(this.cropRect);
  }

  private endDrag(e: PointerEvent): void {
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.drag.target.releasePointerCapture(e.pointerId);
      this.drag = null;
    }
  }

  /** Position the crop window over the canvas using percentage values. */
  private layout(): void {
    const c = rotateRect(this.cropRect, this.rotation90);
    this.windowEl.style.left = `${c.x * 100}%`;
    this.windowEl.style.top = `${c.y * 100}%`;
    this.windowEl.style.width = `${c.w * 100}%`;
    this.windowEl.style.height = `${c.h * 100}%`;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
