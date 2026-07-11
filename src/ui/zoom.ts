function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class ZoomController {
  private readonly stage: HTMLElement;
  private readonly container: HTMLElement;
  private readonly onZoomChange: ((scale: number) => void) | undefined;
  private readonly activePointers = new Map<number, PointerEvent>();
  
  private scale = 1.0;
  private translateX = 0;
  private translateY = 0;
  
  private initialDistance = 0;
  private initialScale = 1.0;
  private initialMidpoint = { x: 0, y: 0 };
  
  private lastPanX = 0;
  private lastPanY = 0;

  constructor(
    stage: HTMLElement,
    container: HTMLElement,
    onZoomChange?: (scale: number) => void,
  ) {
    this.stage = stage;
    this.container = container;
    this.onZoomChange = onZoomChange;
    this.initEvents();
  }

  reset(): void {
    this.scale = 1.0;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  private initEvents(): void {
    const stage = this.stage;

    stage.addEventListener("pointerdown", (e) => {
      // Ignore if pointer is captured by crop handles
      if ((e.target as HTMLElement).closest(".crop-handle")) {
        return;
      }
      
      this.activePointers.set(e.pointerId, e);
      
      if (this.activePointers.size === 1) {
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
      } else if (this.activePointers.size === 2) {
        const [p1, p2] = Array.from(this.activePointers.values());
        if (p1 && p2) {
          this.initialDistance = this.getDistance(p1, p2);
          this.initialMidpoint = this.getMidpoint(p1, p2);
          this.initialScale = this.scale;
        }
      }
    });

    stage.addEventListener("pointermove", (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, e);

      if (this.activePointers.size === 1) {
        // Only pan if we are zoomed in
        if (this.scale > 1.0) {
          const dx = e.clientX - this.lastPanX;
          const dy = e.clientY - this.lastPanY;
          this.translateX += dx;
          this.translateY += dy;
          this.lastPanX = e.clientX;
          this.lastPanY = e.clientY;
          this.applyTransform();
        }
      } else if (this.activePointers.size === 2) {
        const [p1, p2] = Array.from(this.activePointers.values());
        if (p1 && p2) {
          const dist = this.getDistance(p1, p2);
          if (this.initialDistance > 0) {
            const newScale = clamp(this.initialScale * (dist / this.initialDistance), 1.0, 5.0);
            
            // Zoom and pan midpoint tracking
            const mid = this.getMidpoint(p1, p2);
            const dx = mid.x - this.initialMidpoint.x;
            const dy = mid.y - this.initialMidpoint.y;
            
            this.scale = newScale;
            this.translateX += dx;
            this.translateY += dy;
            this.initialMidpoint = mid;
            this.applyTransform();
          }
        }
      }
    });

    const endPointer = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) {
        this.initialDistance = 0;
      }
      if (this.activePointers.size === 1) {
        const remaining = this.activePointers.values().next().value as PointerEvent;
        this.lastPanX = remaining.clientX;
        this.lastPanY = remaining.clientY;
      }
    };

    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);

    // Mouse wheel support
    stage.addEventListener("wheel", (e) => {
      // Prevent default page scroll
      e.preventDefault();
      const zoomFactor = 0.08;
      const dir = e.deltaY < 0 ? 1 : -1;
      const newScale = clamp(this.scale * (1 + dir * zoomFactor), 1.0, 5.0);
      
      this.scale = newScale;
      this.applyTransform();
    }, { passive: false });
  }

  private getDistance(p1: PointerEvent, p2: PointerEvent): number {
    const dx = p1.clientX - p2.clientX;
    const dy = p1.clientY - p2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getMidpoint(p1: PointerEvent, p2: PointerEvent): { x: number; y: number } {
    return {
      x: (p1.clientX + p2.clientX) / 2,
      y: (p1.clientY + p2.clientY) / 2,
    };
  }

  private applyTransform(): void {
    if (this.scale <= 1.0) {
      this.scale = 1.0;
      this.translateX = 0;
      this.translateY = 0;
    }
    this.container.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    if (this.onZoomChange) {
      this.onZoomChange(this.scale);
    }
  }
}
