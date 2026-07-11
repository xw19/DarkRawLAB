// WebGL2 renderer for DarkRaw Lab.
//
// Owns the GL context, the decoded image as a linear-light float texture, and
// the draw loop. Uploading the texture happens ONCE per image (in `setImage`);
// drawing is cheap and re-runs the shader pipeline every frame. This is the
// core split from CLAUDE.md: decode once, re-render on the GPU — never re-decode
// for an interactive edit.

import * as twgl from "twgl.js";
import vertSrc from "./shaders/pipeline.vert?raw";
import fragSrc from "./shaders/pipeline.frag?raw";
import type { DecodedImage } from "../worker/decode";
import { defaultEditState, toUniforms } from "../editor/pipeline";
import type { PipelineUniforms } from "../editor/pipeline";
import { fullCrop } from "../editor/crop";
import type { CropRect } from "../editor/crop";

interface CropUniforms {
  u_cropOrigin: [number, number];
  u_cropSize: [number, number];
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly programInfo: twgl.ProgramInfo;
  private readonly quad: twgl.BufferInfo;
  private texture: WebGLTexture | null = null;
  private edits: PipelineUniforms = toUniforms(defaultEditState);
  private crop: CropUniforms = { u_cropOrigin: [0, 0], u_cropSize: [1, 1] };
  private imageWidth = 0;
  private imageHeight = 0;
  // Focus-peaking view aid. Off by default and never enabled by the export
  // renderer, so peaking is a preview-only overlay and is never baked into a file.
  private peaking = 0;
  // Filmic display transform. Unlike peaking this is a rendering intent, so it's
  // on by default and the export renderer applies it too (see setFilmic).
  private filmic = 1;

  /** Fired after each on-screen draw. Used by the histogram to resample. */
  onRender: (() => void) | undefined = undefined;

  // Small offscreen target for histogram sampling (lazily allocated).
  private sampleFbo: WebGLFramebuffer | null = null;
  private sampleTex: WebGLTexture | null = null;
  private sampleW = 0;
  private sampleH = 0;

  constructor(
    canvas: HTMLCanvasElement,
    contextOptions?: WebGLContextAttributes,
  ) {
    // Export passes { preserveDrawingBuffer: true } so the drawing buffer
    // survives until `canvas.toBlob` reads it; the on-screen renderer leaves it
    // false (the default) for performance.
    const gl = canvas.getContext("webgl2", contextOptions);
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.canvas = canvas;
    this.gl = gl;
    // Surface shader compile/link failures loudly instead of leaving a null
    // program that only blows up at the first draw.
    this.programInfo = twgl.createProgramInfo(gl, [vertSrc, fragSrc], {
      errorCallback: (msg: string) => {
        throw new Error(`DarkRaw Lab: shader failed to compile:\n${msg}`);
      },
    });
    // Single fullscreen triangle (cheaper than a quad; the parts outside the
    // [0,1] UV range are clipped away).
    this.quad = twgl.createBufferInfoFromArrays(gl, {
      position: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    });
  }

  /**
   * Upload a freshly decoded image as a linear RGBA16F texture. RGBA16F is
   * core-filterable in WebGL2, so we can LINEAR-sample it when zoomed without
   * an extension. Replaces any previous texture and frees it.
   */
  setImage(img: DecodedImage): void {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = twgl.createTexture(gl, {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.FLOAT,
      width: img.width,
      height: img.height,
      src: img.pixels,
      minMag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
    });
    this.imageWidth = img.width;
    this.imageHeight = img.height;
    // New image starts uncropped; setCrop sizes the canvas and renders.
    this.setCrop(fullCrop);
  }

  /**
   * Apply a crop. This is pure geometry: we size the canvas backing store to the
   * crop's pixel dimensions (so CSS scales it at the right aspect) and hand the
   * crop window to the shader as texture coordinates. The decoder and texture
   * are never touched — cropping is as cheap as a slider move.
   */
  setCrop(crop: CropRect): void {
    this.crop = {
      u_cropOrigin: [crop.x, crop.y],
      u_cropSize: [crop.w, crop.h],
    };
    const isSwapped = this.edits.u_rotation90 === 1 || this.edits.u_rotation90 === 3;
    this.canvas.width = Math.max(1, Math.round(isSwapped ? this.imageHeight * crop.h : this.imageWidth * crop.w));
    this.canvas.height = Math.max(1, Math.round(isSwapped ? this.imageWidth * crop.w : this.imageHeight * crop.h));
    this.render();
  }

  /**
   * Apply new edit uniforms and redraw. This is the hot path for slider moves —
   * it only swaps uniforms and re-runs the shader; it never touches the decoder
   * or re-uploads the texture.
   */
  setEdits(edits: PipelineUniforms): void {
    const rotChanged = this.edits.u_rotation90 !== edits.u_rotation90;
    this.edits = edits;
    if (rotChanged) {
      const isSwapped = edits.u_rotation90 === 1 || edits.u_rotation90 === 3;
      const cropW = this.crop.u_cropSize[0];
      const cropH = this.crop.u_cropSize[1];
      this.canvas.width = Math.max(1, Math.round(isSwapped ? this.imageHeight * cropH : this.imageWidth * cropW));
      this.canvas.height = Math.max(1, Math.round(isSwapped ? this.imageWidth * cropW : this.imageHeight * cropH));
    }
    this.render();
  }

  /**
   * Toggle the focus-peaking view overlay. Preview-only: the export renderer
   * never calls this, so peaking is never baked into an exported file.
   */
  setPeaking(on: boolean): void {
    this.peaking = on ? 1 : 0;
    this.render();
  }

  /**
   * Toggle the filmic display transform. A rendering intent, not a view overlay:
   * the export renderer calls this too so the saved file matches the preview.
   */
  setFilmic(on: boolean): void {
    this.filmic = on ? 1 : 0;
    this.render();
  }

  /** Run the shader pipeline over the current image and present it. */
  render(): void {
    const gl = this.gl;
    if (!this.texture) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.quad);
    twgl.setUniforms(this.programInfo, {
      u_image: this.texture,
      u_aspect: this.canvas.width / this.canvas.height,
      u_peaking: this.peaking,
      u_filmic: this.filmic,
      ...this.edits,
      ...this.crop,
    });
    twgl.drawBufferInfo(gl, this.quad, gl.TRIANGLES);
    this.onRender?.();
  }

  /**
   * Render the current pipeline (edits + crop, but never peaking) into a small
   * offscreen buffer and read it back as RGBA8. Used by the histogram so its cost
   * is independent of canvas size and it reflects the edited, displayed image.
   * Returns null when no image is loaded.
   */
  sampleSmall(maxDim = 256): { pixels: Uint8Array; width: number; height: number } | null {
    if (!this.texture) return null;
    const gl = this.gl;
    const scale = maxDim / Math.max(this.canvas.width, this.canvas.height);
    const w = Math.max(1, Math.round(this.canvas.width * scale));
    const h = Math.max(1, Math.round(this.canvas.height * scale));

    if (!this.sampleFbo || this.sampleW !== w || this.sampleH !== h) {
      if (this.sampleTex) gl.deleteTexture(this.sampleTex);
      if (!this.sampleFbo) this.sampleFbo = gl.createFramebuffer();
      this.sampleTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.sampleTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sampleFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sampleTex, 0);
      this.sampleW = w;
      this.sampleH = h;
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sampleFbo);
    }

    gl.viewport(0, 0, w, h);
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.quad);
    twgl.setUniforms(this.programInfo, {
      u_image: this.texture,
      u_aspect: w / h,
      u_peaking: 0, // histogram reflects the image, not the peaking overlay
      u_filmic: this.filmic, // ...but does reflect the filmic transform
      ...this.edits,
      ...this.crop,
    });
    twgl.drawBufferInfo(gl, this.quad, gl.TRIANGLES);

    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Restore the default framebuffer + viewport for the next on-screen draw.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    return { pixels, width: w, height: h };
  }

  /**
   * Release GPU resources and drop the WebGL context. Used by the one-shot
   * export renderer so repeated exports don't leak contexts (browsers cap how
   * many can be live at once).
   */
  dispose(): void {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.sampleTex) gl.deleteTexture(this.sampleTex);
    if (this.sampleFbo) gl.deleteFramebuffer(this.sampleFbo);
    this.texture = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
