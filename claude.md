# CLAUDE.md

Guidance for Claude Code working in this repo. Read this first, every session.

> Project name: **DarkRaw Lab** — a mobile-first, browser-based RAW editor.

> **Two copies of this file exist** — the repo root and `DarkRawLAB/claude.md` — and
> they are kept byte-identical. If you edit one, edit the other in the same change.

---

## What we're building

A **mobile-first, browser-based RAW photo editor**, free and open source, inspired by darktable's processing-pipeline model. It runs **entirely client-side** — no backend, no upload, no server-side processing. The whole point is "open a RAW on your phone, in a browser, no install."

darktable itself is already FOSS; our differentiator is **mobile + web/WASM**, not feature parity. Keep scope small and deliberate.

**Implemented editing features** (all live on the GPU; see the pipeline below):

- **Tone:** exposure, contrast, highlights, shadows, whites, blacks, sharpen, and **local adjustments** (exposure, contrast, saturation) selectively applied using a subject mask.
- **Colour:** white balance (temperature, tint), saturation, vibrance, luminance, channel mixer (3×3, the `mix*` fields → `u_mix*` matrix in `pipeline.frag`), and a per-hue **HSL mixer** (8 bands × Hue/Sat/Lum, the `hsl*` fields; the shader blends bands by hue distance)
- **Denoise:** multi-scale luma (fine + coarse) and chroma NLM, plus film grain
- **Geometry:** crop, free-angle straighten, 90° rotation
- **Rendering:** optional **filmic** (ACES) display transform, on by default and **baked into export**, toggled from the menu (see the display-transform step below).
- **View:** pinch/wheel zoom and pan, focus peaking, a translucent RGB histogram, an interactive Segment Anything (SAM) AI subject mask generator (running on-device via ONNX Runtime Web), and a toggleable Edit History in the slide-in drawer (`src/ui/drawer.ts`). The histogram samples the edited image via `Renderer.sampleSmall()` (a small offscreen re-render), refreshed through `Renderer.onRender`.
- **Export:** full-resolution JPEG (quality slider) or PNG

This set is the current scope. **Do not add new adjustments, presets, layers, cloud, or accounts without being asked.** New features are welcome when requested, but each one costs mobile bundle size, shader complexity, and maintenance — justify it, and update this file, the pipeline section, and the slider wiring together (see "Adding an adjustment" below).

---

## The core architectural principle (do not violate)

**Decode once in a WASM worker. Apply every interactive edit on the GPU.**

- RAW decoding is expensive and happens **once per image**, off the main thread, in a Web Worker.
- Every adjustment above runs **every frame in a WebGL2 fragment shader** on the already-decoded buffer.
- **NEVER re-run the WASM decoder in response to a slider move, zoom, or crop drag.** That is the single most important rule in this codebase. If you find yourself calling the decoder on a UI interaction, stop — the fix is a shader uniform, not a re-decode. The only re-decode is the full-resolution one at export.

This mirrors darktable's pixelpipe: decode → stack of operations → display transform. WebGL shaders play the role darktable's OpenCL modules do.

---

## Tech stack

- **Build:** Vite + TypeScript (strict mode).
- **RAW decode:** LibRaw compiled to WASM (via the `libraw-wasm` npm package, which runs the decode in its *own* module worker — we do not nest a second worker). We may build LibRaw ourselves later to control output format.
- **Rendering:** **WebGL2** fragment shaders, with `twgl.js` as a thin helper over the boilerplate. Do **not** reach for WebGPU yet — verify mobile Safari support first and it's overkill for these operations.
- **App shell:** plain TypeScript modules driving one HTML file (`DarkRawLAB/index.html` holds all markup + CSS). No UI framework — this is a canvas app and the DOM surface is small.
- **State:** minimal; plain module state plus the slider inputs as the source of truth. No Redux-scale machinery.

Keep the dependency count low (currently just `libraw-wasm` + `twgl.js`). Every dependency is a mobile bundle-size and maintenance cost. Justify additions.

---

## The processing pipeline (order is correctness-critical)

Decode the RAW to **linear light** — no tone curve, no gamma baked in (LibRaw: `gamm:[1,1]`, `noAutoBright`, 16-bit output, camera WB, **camera colour matrix** (`useCameraMatrix:3` — the wrapper zero-inits this off, which skews colours green/yellow), sRGB primaries). See `openSettings()` in `src/worker/decode.ts`.

The shader (`src/gl/shaders/pipeline.frag`) then applies operations in exactly this order. The split is deliberate: **scene-referred** operations run in linear light *before* the display transform; **output-referred** operations run *after* it, in sRGB.

**Scene-referred (linear light):**

1. **Geometry** — free-angle rotation, then discrete 90° steps, then the crop window. Pure UV math; no pixel reprocessing. Only baked in at export.
2. **Denoise** — multi-scale NLM on the sampled neighbourhood (fine 5×5, coarse 5×5 @ 2.5× spacing, chroma), in YCbCr. Runs first because it operates on raw sensor noise before any tonal expansion.
3. **Sharpen** — Unsharp Mask (5-tap kernel) in linear space, applied right after denoise to amplify details without amplifying sensor noise.
4. **Exposure** — a linear multiply, `rgb *= pow(2, ev)`. Doing this before the display transform is why highlight/shadow recovery works, and the reason we decode to linear instead of editing the baked preview JPEG.
5. **White balance** — temperature scales R up / B down; tint pivots green against magenta.
6. **Highlights / shadows** — luminance-weighted exposure applied to the bright/dark ends (smoothstep masks around 0.18 middle grey).
7. **Saturation / vibrance** — mix toward luminance; vibrance is saturation weighted down for already-saturated pixels.
8. **Local Edits (Masking)** — blends local exposure, contrast, and saturation adjustments using the active single-channel mask texture (0..1 range) before global contrast.
9. **Contrast** — tone curve pivoting around middle grey (0.18 linear): `rgb = (rgb - 0.18) * contrast + 0.18`. After exposure.

**Display transform:**

10. **Display transform** — scene-linear → display. Either the standard piecewise sRGB OETF, or (when the **Filmic tone** toggle is on, the default) an **ACES filmic curve** (`filmicDisplay` in `pipeline.frag`) that adds contrast + highlight rolloff for a darktable-like look. Everything above is edited in linear light so it lands correctly here. Filmic is a rendering intent, not a view aid: it's baked into export (threaded through `exportImage(..., filmic)` / `Renderer.setFilmic`), unlike peaking/histogram.

**Output-referred (sRGB), applied after the display transform on purpose:**

11. **Luminance** — HSL lightness shift; perceptual, so it operates on display-encoded values.
12. **Film grain** — luma-weighted noise added in output space, so grain reads uniformly regardless of scene exposure.

If you change the scene-referred order (2→7) you will get subtly wrong results. The two output-referred steps (9–10) are intentionally *after* sRGB encoding — that is not a bug; document it if you touch it.

Every slider — its default, its UI-unit → uniform mapping (e.g. contrast `2^(c/100)`, highlights/shadows `±1.5` stops, denoise thresholds `0..0.15/0.20/0.25`), and its label formatter — is declared once in the **`SLIDERS` table in `src/editor/sliders.ts`**. `defaultEditState` and `toUniforms()` in `src/editor/pipeline.ts` are derived from that table, so it is the single place tuning constants live.

---

## Mobile constraints (design around these from day one)

- **Memory:** a 24MP image at 16-bit RGB is ~140MB. That strains phone memory and WASM limits. **Decode a downscaled (half-size) version for editing**; only decode/render full resolution at export time.
- **Fast first paint:** LibRaw can extract the **embedded preview JPEG** instantly. The start screen shows that thumbnail while the linear decode finishes.
- **Never block the main thread.** All decoding happens in `libraw-wasm`'s worker. The UI thread only touches WebGL and DOM.
- **WASM memory:** `libraw.dispose()` is called after every decode (`decode.ts`) to free the instance/worker promptly; assume hard caps on mobile.
- **Touch first:** crop, straighten, zoom, and pan all use Pointer Events so mouse and touch share one path.
- **Shader cost:** denoise is the expensive op (up to ~50 texture taps/pixel/frame across its two 5×5 windows) and it runs live during any slider drag. Keep this in mind before adding more neighbourhood-sampling effects to the live preview.

---

## Repo structure

```
DarkRawLAB/
  index.html              # all markup + CSS + the three screens
  src/
    worker/
      decode.ts           # libraw-wasm decode, EXIF, embedded-preview extraction; openSettings()
    gl/
      renderer.ts         # WebGL2 setup, texture upload, draw loop, dispose()
      shaders/
        pipeline.frag     # the full ordered pipeline above
        pipeline.vert     # fullscreen triangle
    editor/
      sliders.ts          # SLIDERS: single source of truth for every adjustment control
      pipeline.ts         # EditState + defaults + toUniforms(), derived from SLIDERS (pure, testable)
      crop.ts             # crop + 90° rotation geometry (pure, testable)
      preset.ts           # serialize/parse {editState, crop} JSON — the "edit recipe" (pure, testable)
      *.test.ts           # Vitest unit tests (pipeline, crop, exif, preset)
    ui/
      controls.ts         # wires the adjustment sliders → EditState
      cropOverlay.ts      # draggable crop rectangle (Pointer Events)
      zoom.ts             # ZoomController: pinch/wheel zoom + pan (view transform)
      drawer.ts           # reusable slide-in overlay drawer (hosts view toggles)
      histogram.ts        # translucent RGB histogram overlay (view-only)
      startScreen.ts      # file pick → progress → thumbnail + EXIF → Enhance
      exportScreen.ts     # format + quality controls
      screens.ts          # start/editor/export router
      exif.ts             # RawMeta → definition list (pure formatting)
    export/
      export.ts           # full-res re-decode + reuse Renderer + encode + download
    main.ts               # entry: element wiring, tab/submenu routing, screen flow
```

Keep decode, render, edit-state, and UI in separate modules. Edit state is plain data (`EditState` — numbers + a crop rect) that maps to shader uniforms; that separation is what keeps edits real-time and the pure modules testable without a GPU.

**Automation / agents:** `main.ts` exposes a `window.darkraw` hook (getState/applyEdits/setCrop/loadPreset/loadRaw/getPreview/export) reusing the UI code paths — the basis for presets and a future MCP server. See [`docs/mcp-design.md`](docs/mcp-design.md); `EditState`+crop is the serializable "edit recipe" (`preset.ts`), and `SLIDERS` is the machine-readable control catalog.

---

## Conventions

- TypeScript strict; no `any` without a comment explaining why.
- Comment the **shader math** — future readers won't know why the pivot is 0.18, why exposure is a linear multiply, or why luminance/grain sit after the display transform. Explain the colour science inline.
- Keep pipeline/edit-state/geometry logic in **pure functions** (`pipeline.ts`, `crop.ts`, `exif.ts`) so it's testable without a GPU. **Vitest is set up — run `npm test` (`npm run test:watch` while developing).** `pipeline.ts`, `crop.ts`, and `exif.ts` have coverage; add tests alongside any new pure logic. `export.ts`'s `exportName` is still uncovered (testing it means importing the GL/decoder stack; extract it to a pure helper first if you want a test).
- Small, focused commits.
- No `localStorage` assumptions for image data (too big); keep working buffers in memory.

### Adding an adjustment

The TypeScript side of a slider is now driven by one table — add an entry to `SLIDERS` in `src/editor/sliders.ts` (key, DOM ids, uniform, default, mapping, formatter) and `defaultEditState`, `toUniforms()`, all `controls.ts` wiring/labels, and reset pick it up automatically. Only two things still need a matching entry by hand, because they cross a language boundary:

1. the `uniform` declaration + its use in `src/gl/shaders/pipeline.frag` (GLSL), and
2. the `<input>` + label markup in `index.html`.

Add the field to the `EditState` interface (`pipeline.ts`) too, so the table entry typechecks. That's it — no more per-field lists in `controls.ts` or `main.ts`.

---

## Roadmap & current status

**CURRENT STATUS:** _All original roadmap phases (0–5) are complete **and** the editor has been extended well past the initial exposure/contrast/crop scope into a full tonal + colour + denoise + geometry tool — see "Implemented editing features" above. The scene-referred → display → output-referred pipeline is implemented in `pipeline.frag` and driven by `toUniforms()`. Responsive layout overflow and centering issues on mobile screens (like Samsung A54) are resolved. Aspect ratio presets (Free, 1:1, 4:3, 5:4, 3:2, 16:9) with orientation-adaptive fitting and locked corner dragging are implemented. GPU-accelerated Unsharp Mask sharpening is implemented in linear space under the Tune tab. An interactive toggleable Edit History panel is added to the menu drawer, allowing users to toggle individual adjustments on/off dynamically (bypassing them in the shader preview and during exports). Full PWA integration (webmanifest + dynamic offline Service Worker caching) has been implemented. An interactive Segment Anything (SAM) AI subject masking tool (running on-device via ONNX Runtime Web) has been added, allowing users to tap on the screen to segment subjects dynamically and apply local adjustments (exposure, contrast, saturation). Export re-decodes at full resolution (the one place we don't half-size), reuses the display `Renderer` on an offscreen canvas so the baked image is pixel-identical to the preview (same shader, same uniforms), and encodes JPEG (quality slider) or PNG. Verified end-to-end on a Sony ARW: real EXIF, thumbnail, screen transitions, full-res export + back._

**Delivered phases:**

- **Phase 0 — Decode.** Load a RAW, decode in the worker, draw to a canvas.
- **Phase 1 — GPU pipeline.** Linear buffer → WebGL2 texture → display transform.
- **Phase 2 — Exposure + contrast.** The two core shader ops with sliders.
- **Phase 3 — Crop.** Touch-friendly overlay, applied as geometry.
- **Phase 4 — Export.** Full-res render + encode + download.
- **Phase 5 — Export controls.** Format (JPEG/PNG) + quality slider.
- **Extended editing (post-roadmap).** Highlights/shadows, white balance, saturation/vibrance, luminance, multi-scale denoise + grain, straighten + 90° rotation, zoom/pan, crop aspect ratio presets, unsharp mask sharpening, interactive toggleable Edit History, PWA installation / offline caching support (manifest.json + Service Worker), and interactive Segment Anything (SAM) AI subject masking with local adjustments (exposure, contrast, saturation).

**Known gaps / good next steps** (do the ones that are asked for):

- **Tests cover the pure modules only.** Vitest runs `pipeline`, `crop`, and `exif` (44 tests via `npm test`); `export.ts`'s `exportName` and all GL/DOM code are still untested.
- Zoom uses a CSS transform on the view container; cropping while zoomed maps pointer coordinates through that transform, which needs verifying/fixing.
- Higher-bit-depth export (16-bit PNG/TIFF) remains unbuilt.

MIT License recorded in `LICENSE`. A GitHub Pages CI workflow exists (`.github/workflows/deploy.yml`); current deployment is **manual to Netlify** (`DarkRawLAB/dist` is the build output).

### App structure — three screens

The UI is a three-screen flow (`src/ui/screens.ts` toggles `[data-screen]` sections via the `hidden` attribute):

1. **Start** (`src/ui/startScreen.ts`) — DarkRawLAB wordmark; pick a RAW → progress bar → `loadRaw()` (one `open`: half-size linear image **+** EXIF **+** embedded JPEG thumbnail) → thumbnail + EXIF panel (`src/ui/exif.ts`) → **Enhance**. The half-size decode is handed to the editor as-is — **Enhance does not re-decode**.
2. **Editor** — canvas + a tabbed control bar (order: **Tune** exposure/contrast/highlights/shadows/whites/blacks · **Color** temp/tint/saturation/vibrance/luminance · **Mix** channel mixer + per-hue HSL bands · **Denoise** fine/coarse/chroma + grain · **Crop** straighten + 90° + crop overlay). Each tab is a `#panel-*` with a `data-active-param` submenu. Pinch/wheel zoom + pan on the canvas; the slide-in drawer holds view toggles (filmic, focus peaking, histogram). **Export** button → export screen. (EXIF shows on the start screen; there is no Info tab.)
3. **Export** — format (JPEG/PNG) + quality → Download / Back.

`loadRaw()` lives beside `decodeRaw()` in `src/worker/decode.ts` and shares one `openSettings()`.

---

## Licensing

- We write fresh code — this is **not** a fork of darktable's GPL source. Call it "darktable-inspired," not a port.
- **LibRaw is LGPL** (with other license options). Respect its terms in bundling/distribution.
- Original code is **MIT** (recorded in `LICENSE`).

---

## Do NOT

- Re-run the WASM decoder on slider/zoom/crop interactions.
- Bake any adjustment into pixels for preview (it's a shader; keep it live). Baking only happens at export.
- Decode full-res for editing (half-size; full-res only at export).
- Reorder the scene-referred pipeline steps (denoise → sharpen → exposure → WB → highlights/shadows → saturation/vibrance → contrast → display transform), or move luminance/grain *before* the display transform.
- Add adjustments/presets/layers/cloud/accounts beyond the current scope without being asked — and when you do add one, update every place listed in "Adding an adjustment," including this file.
- Add heavy dependencies without justification.
