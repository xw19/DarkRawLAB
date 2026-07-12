import type { DecodedImage } from "../worker/decode";

declare const ort: any;

/** Sigmoid ramp width (in logit units) for feathering the mask edge in
 *  drawLogitsToMask. Larger softens the boundary; ~3 hides the decoder's 256px
 *  blockiness without visibly bleeding onto the background. */
const MASK_EDGE_SOFTNESS = 3.0;

/** Linear-light [0,1] → 8-bit sRGB (approx gamma 1/2.2), precomputed. Feeding
 *  SAM its expected sRGB input over a full-size image is millions of pixels; a
 *  lookup table avoids that many Math.pow calls so the encode prep doesn't stall
 *  the UI thread. 4096 entries is well beyond 8-bit output precision. */
const SRGB_LUT = (() => {
  const lut = new Uint8ClampedArray(4096);
  for (let i = 0; i < 4096; i++) lut[i] = Math.round(Math.pow(i / 4095, 1 / 2.2) * 255);
  return lut;
})();

export class SamController {
  private encoderSession: any = null;
  private decoderSession: any = null;
  // Retained copy of the encoder output (data + shape) rather than the tensor
  // object: in proxy mode run() may transfer an input buffer into the worker and
  // detach the main-thread copy, so we rebuild a fresh tensor from this on every
  // decode instead of reusing one across taps.
  private embeddingData: Float32Array | null = null;
  private embeddingDims: number[] | null = null;
  public isLoaded = false;
  public isAnalyzing = false;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private imageWidth = 0;
  private imageHeight = 0;

  constructor() {
    this.maskCanvas = document.createElement("canvas");
    this.maskCanvas.width = 256;
    this.maskCanvas.height = 256;
    this.maskCtx = this.maskCanvas.getContext("2d");
    this.clearMask();
  }

  getMaskCanvas(): HTMLCanvasElement | null {
    return this.maskCanvas;
  }

  clearMask(): void {
    if (this.maskCtx && this.maskCanvas) {
      this.maskCtx.fillStyle = "black";
      this.maskCtx.fillRect(0, 0, 256, 256);
    }
  }

  async loadModels(onStatusChange: (status: string) => void): Promise<void> {
    if (this.isLoaded) return;
    
    // Resolve relative paths based on the document base URI to support subdirectory deployments
    const base = document.baseURI || window.location.href;
    const scriptUrl = new URL("ort.min.js", base).href;
    const wasmFolderPath = new URL("./", base).href;

    onStatusChange("Loading AI engine...");
    try {
      await this.loadScript(scriptUrl);
    } catch (err) {
      console.error("Failed to load ONNX Runtime script:", err);
      onStatusChange("Failed to load AI engine. Check connection.");
      throw err;
    }

    onStatusChange("Downloading AI models (43MB)...");
    
    // Explicitly configure local paths and force single-threading for WASM modules
    if (typeof ort !== "undefined") {
      ort.env.wasm.numThreads = 1; // Force single-thread to bypass COOP/COEP SharedArrayBuffer restrictions
      ort.env.wasm.wasmPaths = wasmFolderPath;
      // Run the WASM backend in ORT's own worker so session creation and the
      // (heavy) MobileSAM encoder pass don't block the UI thread — without this
      // single-threaded WASM inference runs on the main thread and freezes the
      // page for the whole encode. Uses postMessage (no SharedArrayBuffer), so
      // it stays compatible with numThreads=1 and needs no COOP/COEP headers.
      ort.env.wasm.proxy = true;
    }
    
    const encoderUrl = new URL("mobile_sam_image_encoder.onnx", base).href;
    const decoderUrl = new URL("sam_mask_decoder_single.onnx", base).href;

    // Load sessions using WebAssembly execution provider
    this.encoderSession = await ort.InferenceSession.create(
      encoderUrl,
      { executionProviders: ["wasm"] }
    );
    this.decoderSession = await ort.InferenceSession.create(
      decoderUrl,
      { executionProviders: ["wasm"] }
    );
    this.isLoaded = true;
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof ort !== "undefined") {
        resolve();
        return;
      }
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", (err) => reject(err));
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = (err) => reject(err);
      document.head.appendChild(script);
    });
  }

  async analyzeImage(
    img: DecodedImage,
    onStatusChange: (status: string) => void
  ): Promise<void> {
    if (!this.isLoaded) {
      await this.loadModels(onStatusChange);
    }

    this.imageWidth = img.width;
    this.imageHeight = img.height;
    this.isAnalyzing = true;
    onStatusChange("Analyzing subject (one-time)...");

    try {
      // 1. Convert image to the encoder's input: raw sRGB 0-255 floats, shape
      //    [h, w, 3]. The encoder graph resizes/pads/normalises internally.
      const t = this.imageToSamTensor(img);
      const inputTensor = new ort.Tensor("float32", t.data, [t.height, t.width, 3]);

      // 2. Run Encoder
      const inputName = this.encoderSession.inputNames[0] || "x";
      const encoderInputs: Record<string, any> = {};
      encoderInputs[inputName] = inputTensor;
      
      const encoderOutputs = await this.encoderSession.run(encoderInputs);
      const emb = encoderOutputs.image_embeddings;
      // Copy out so repeated decodes can rebuild fresh input tensors (see field).
      this.embeddingData = new Float32Array(emb.data);
      this.embeddingDims = Array.from(emb.dims);

      this.isAnalyzing = false;
      onStatusChange("Subject analyzed! Tap image to select area.");
    } catch (err) {
      console.error("Failed to analyze image with SAM:", err);
      this.isAnalyzing = false;
      onStatusChange("Analysis failed. Try again.");
      throw err;
    }
  }

  async predictMask(
    xNorm: number, // Normalized x in [0, 1] relative to the image
    yNorm: number, // Normalized y in [0, 1] relative to the image
    isPositive = true
  ): Promise<void> {
    if (!this.embeddingData || !this.embeddingDims || !this.decoderSession || this.imageWidth === 0 || this.imageHeight === 0) {
      console.warn("SAM image not analyzed yet");
      return;
    }

    try {
      const longSide = Math.max(this.imageWidth, this.imageHeight);
      const scale = 1024 / longSide;
      const clickX = xNorm * this.imageWidth * scale;
      const clickY = yNorm * this.imageHeight * scale;

      // Standard SAM ONNX models require a second padding point with label -1 if no box is used
      const pointCoords = new Float32Array([clickX, clickY, 0.0, 0.0]);
      const pointLabels = new Float32Array([isPositive ? 1.0 : 0.0, -1.0]);

      // Zero-filled low-res mask input (256x256)
      const maskInput = new Float32Array(256 * 256);

      const decoderInputs = {
        // Fresh copy each call: proxy-mode run() may transfer/detach the buffer.
        image_embeddings: new ort.Tensor("float32", this.embeddingData.slice(), this.embeddingDims),
        point_coords: new ort.Tensor("float32", pointCoords, [1, 2, 2]),
        point_labels: new ort.Tensor("float32", pointLabels, [1, 2]),
        mask_input: new ort.Tensor("float32", maskInput, [1, 1, 256, 256]),
        has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
        orig_im_size: new ort.Tensor("float32", new Float32Array([this.imageHeight, this.imageWidth]), [2]),
      };

      const outputs = await this.decoderSession.run(decoderInputs);
      const masksOutput = outputs[this.decoderSession.outputNames[0] || "masks"];
      const logits = masksOutput.data as Float32Array;

      // Draw the output mask logits to our mask canvas dynamically matching dimensions
      this.drawLogitsToMask(logits, masksOutput.dims);
    } catch (err) {
      console.error("Failed to run SAM mask decoder:", err);
    }
  }

  private drawLogitsToMask(logits: Float32Array, dims: number[]): void {
    if (!this.maskCanvas) return;
    
    // Support dynamic model output shape (e.g. 256x256 or 1024x1024 depending on model export config)
    const h = dims[2] || 256;
    const w = dims[3] || 256;

    if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
      this.maskCanvas.width = w;
      this.maskCanvas.height = h;
      this.maskCtx = this.maskCanvas.getContext("2d");
    }

    if (!this.maskCtx) return;
    const imgData = this.maskCtx.createImageData(w, h);
    const data = imgData.data;
    const numPixels = w * h;

    // Feather the edge instead of a hard binary cut. The decoder upsamples a
    // coarse 256x256 mask, so thresholding the logits at 0 leaves stair-stepped,
    // blocky edges — and a hard seam where the local adjustment abruptly starts.
    // Mapping each logit through a sigmoid ramp spreads the boundary across a few
    // pixels for a soft, naturally-blending edge. logit 0 still maps to 0.5, so
    // the selected extent is unchanged; MASK_EDGE_SOFTNESS is the ramp width in
    // logit units (larger = softer). The value goes in R/G/B; the shader samples .r.
    for (let i = 0; i < numPixels; i++) {
      const alpha = 1 / (1 + Math.exp(-logits[i]! / MASK_EDGE_SOFTNESS));
      const val = Math.round(alpha * 255);
      const di = i * 4;
      data[di + 0] = val; // R
      data[di + 1] = val; // G
      data[di + 2] = val; // B
      data[di + 3] = 255; // A (fully opaque for texture binding)
    }

    this.maskCtx.putImageData(imgData, 0, 0);
  }

  private imageToSamTensor(img: DecodedImage): {
    data: Float32Array;
    width: number;
    height: number;
  } {
    const origCanvas = document.createElement("canvas");
    origCanvas.width = img.width;
    origCanvas.height = img.height;
    const origCtx = origCanvas.getContext("2d")!;
    const origImgData = origCtx.createImageData(img.width, img.height);
    
    const count = img.width * img.height;
    const data = origImgData.data;
    const pixels = img.pixels;
    for (let i = 0; i < count; i++) {
      const di = i * 4;
      // Convert linear light to sRGB (approx gamma 1/2.2) via LUT. Clamp the
      // [0,1] index into the table's range defensively (values are normalised
      // but guard against any stray out-of-range sample).
      data[di + 0] = SRGB_LUT[Math.min(4095, Math.max(0, (pixels[di + 0]! * 4095) | 0))]!;
      data[di + 1] = SRGB_LUT[Math.min(4095, Math.max(0, (pixels[di + 1]! * 4095) | 0))]!;
      data[di + 2] = SRGB_LUT[Math.min(4095, Math.max(0, (pixels[di + 2]! * 4095) | 0))]!;
      data[di + 3] = 255;
    }
    origCtx.putImageData(origImgData, 0, 0);

    // Scale so the long side is 1024 — SAM's native resolution, and the space
    // predictMask's point coordinates are expressed in. No square padding and
    // no mean/std normalisation here: the encoder graph (dynamic [h, w, 3]
    // input) does its own resize + normalisation and expects raw 0-255 RGB.
    // Pre-normalising would get normalised twice, collapsing the input to a
    // near-uniform image and producing garbage masks.
    const longSide = Math.max(img.width, img.height);
    const scale = 1024 / longSide;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(origCanvas, 0, 0, w, h);

    const rgba = ctx.getImageData(0, 0, w, h).data;
    const numPixels = w * h;
    const floatData = new Float32Array(3 * numPixels);

    for (let i = 0; i < numPixels; i++) {
      floatData[i * 3 + 0] = rgba[i * 4 + 0]!;
      floatData[i * 3 + 1] = rgba[i * 4 + 1]!;
      floatData[i * 3 + 2] = rgba[i * 4 + 2]!;
    }

    return { data: floatData, width: w, height: h };
  }
}
