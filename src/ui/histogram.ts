// Translucent RGB histogram overlay.
//
// Draws the tonal distribution of the currently displayed (edited, cropped)
// image as three additive R/G/B curves on a small translucent canvas in the
// corner of the stage. It's a pure view aid — it owns no image data; the caller
// feeds it RGBA8 pixels sampled from the renderer (see Renderer.sampleSmall) and
// calls update() whenever the render changes.

const BINS = 256;

export class Histogram {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly r = new Float32Array(BINS);
  private readonly g = new Float32Array(BINS);
  private readonly b = new Float32Array(BINS);
  private visible = false;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "histogram hidden";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable for histogram");
    this.ctx = ctx;
    host.append(this.canvas);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.canvas.classList.remove("hidden");
  }

  hide(): void {
    this.visible = false;
    this.canvas.classList.add("hidden");
  }

  /** Recompute and redraw from RGBA8 pixels (4 bytes/pixel). */
  update(pixels: Uint8Array): void {
    if (!this.visible) return;
    const { r, g, b } = this;
    r.fill(0);
    g.fill(0);
    b.fill(0);
    for (let i = 0; i < pixels.length; i += 4) {
      const ri = pixels[i] ?? 0;
      const gi = pixels[i + 1] ?? 0;
      const bi = pixels[i + 2] ?? 0;
      r[ri] = (r[ri] ?? 0) + 1;
      g[gi] = (g[gi] ?? 0) + 1;
      b[bi] = (b[bi] ?? 0) + 1;
    }
    this.draw();
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || 160;
    const cssH = this.canvas.clientHeight || 90;
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // Normalise to the tallest bin so all three channels share a scale.
    let max = 1;
    for (let i = 0; i < BINS; i++) {
      max = Math.max(max, this.r[i] ?? 0, this.g[i] ?? 0, this.b[i] ?? 0);
    }

    // Additive blending so overlapping channels read as brighter/white, like a
    // camera RGB histogram.
    ctx.globalCompositeOperation = "lighter";
    this.drawChannel(this.r, max, "rgba(255, 70, 70, 0.85)", W, H);
    this.drawChannel(this.g, max, "rgba(70, 220, 90, 0.85)", W, H);
    this.drawChannel(this.b, max, "rgba(90, 130, 255, 0.85)", W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  private drawChannel(data: Float32Array, max: number, color: string, W: number, H: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < BINS; i++) {
      const x = (i / (BINS - 1)) * W;
      // sqrt keeps small counts visible without a huge spike flattening the rest.
      const y = H - Math.sqrt((data[i] ?? 0) / max) * H;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
