import type { DecodedImage } from "../worker/decode";

declare const ort: any;

export class SamController {
  private encoderSession: any = null;
  private decoderSession: any = null;
  private imageEmbedding: any = null;
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
      this.imageEmbedding = encoderOutputs.image_embeddings;
      
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
    if (!this.imageEmbedding || !this.decoderSession || this.imageWidth === 0 || this.imageHeight === 0) {
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
        image_embeddings: this.imageEmbedding,
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

    for (let i = 0; i < numPixels; i++) {
      const logit = logits[i]!;
      // Threshold logits at 0.0 to create a binary mask
      const val = logit > 0.0 ? 255 : 0;
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
      // Convert linear light to sRGB gamma 2.2 approximation
      data[di + 0] = Math.min(255, Math.max(0, Math.round(Math.pow(pixels[di + 0]!, 1 / 2.2) * 255)));
      data[di + 1] = Math.min(255, Math.max(0, Math.round(Math.pow(pixels[di + 1]!, 1 / 2.2) * 255)));
      data[di + 2] = Math.min(255, Math.max(0, Math.round(Math.pow(pixels[di + 2]!, 1 / 2.2) * 255)));
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
