# CLAUDE.md

Guidance for Claude Code working in this repo. Read this first, every session.

> Project name: **DarkRaw Lab** — a mobile-first, browser-based RAW editor.

---

## What we're building

A **mobile-first, browser-based RAW photo editor**, free and open source, inspired by darktable's processing-pipeline model. It runs **entirely client-side** — no backend, no upload, no server-side processing. The whole point is "open a RAW on your phone, in a browser, no install."

darktable itself is already FOSS; our differentiator is **mobile + web/WASM**, not feature parity. Keep scope small.

**Current scope — build only these, in order:**

1. Render a RAW file to screen
2. Adjust exposure
3. Adjust contrast
4. Crop

Do not add features outside this list without being asked. No filters, no presets, no layers, no cloud, no accounts.

---

## The core architectural principle (do not violate)

**Decode once in a WASM worker. Apply every interactive edit on the GPU.**

- RAW decoding is expensive and happens **once per image**, off the main thread, in a Web Worker.
- Exposure, contrast, and crop preview run **every frame in a WebGL2 fragment shader** on the already-decoded buffer.
- **NEVER re-run the WASM decoder in response to a slider move, zoom, or crop drag.** That is the single most important rule in this codebase. If you find yourself calling the decoder on a UI interaction, stop — the fix is a shader uniform, not a re-decode.

This mirrors darktable's pixelpipe: decode → stack of operations → display transform. WebGL shaders play the role darktable's OpenCL modules do.

---

## Tech stack

- **Build:** Vite + TypeScript (strict mode).
- **RAW decode:** LibRaw compiled to WASM (start with the `LibRaw-Wasm` npm package; we may build LibRaw ourselves later to control output format). Runs in a **Web Worker**.
- **Rendering:** **WebGL2** fragment shaders. Prefer a thin helper (`twgl` or `regl`) over raw boilerplate. Do **not** reach for WebGPU yet — verify mobile Safari support first and it's overkill for these operations.
- **App shell:** PWA (installable to home screen). Keep the UI layer light — this is a canvas app, so avoid heavy frameworks unless there's a clear reason.
- **State:** minimal; a small store or plain module state. No Redux-scale machinery.

Keep the dependency count low. Every dependency is a mobile bundle-size and maintenance cost. Justify additions.

---

## The processing pipeline (order is correctness-critical)

Decode the RAW to **linear light** — no tone curve, no gamma baked in (LibRaw: linear gamma, `no_auto_bright`, 16-bit output). Then, in the shader, apply operations in exactly this order:

1. **Exposure** — multiply in linear light: `rgb *= pow(2.0, ev)`. Doing this _before_ the display transform is why highlight/shadow recovery works. This is the reason we decode to linear instead of just editing the baked preview JPEG.
2. **Contrast** — tone curve pivoting around middle grey (~0.18 linear): `rgb = (rgb - pivot) * contrast + pivot`, or a smoother S-curve. Applied after exposure.
3. **Crop** — pure geometry. For preview it changes _which region of the texture we draw_ — **no pixel reprocessing**. Only bake it in at export.
4. **Display transform** — linear → sRGB gamma, last, so it looks right on screen.

If you change this order, you will get subtly wrong results. Don't.

---

## Mobile constraints (design around these from day one)

- **Memory:** a 24MP image at 16-bit RGB is ~140MB. That strains phone memory and WASM limits. **Decode a downscaled version for editing**; only decode/render full resolution at export time.
- **Fast first paint:** LibRaw can extract the **embedded preview JPEG** instantly. Show that first for a snappy UI, then swap in the real linear decode when the worker finishes.
- **Never block the main thread.** All decoding and heavy work goes in the worker. The UI thread only touches WebGL and DOM.
- **WASM memory:** configure `ALLOW_MEMORY_GROWTH`; free buffers promptly; assume hard caps on mobile.
- **Touch first:** crop, pan, and zoom must work with touch gestures, not just mouse.

---

## Suggested repo structure

```
src/
  worker/
    decode.worker.ts    # LibRaw-WASM decode, embedded-preview extraction
  gl/
    renderer.ts         # WebGL2 setup, texture upload, draw loop
    shaders/
      pipeline.frag      # exposure -> contrast -> crop -> display transform
      pipeline.vert
  editor/
    pipeline.ts         # edit state (ev, contrast, crop rect) -> uniforms
    crop.ts             # crop geometry + touch handling
  ui/                   # sliders, crop overlay, file input
  export/
    export.ts           # full-res render + encode + download
  main.ts
public/                 # PWA manifest, icons
```

Keep decode, render, edit-state, and UI in separate modules. The edit state is plain data (numbers + a crop rect) that maps to shader uniforms — that separation is what keeps edits real-time.

---

## Conventions

- TypeScript strict; no `any` without a comment explaining why.
- Comment the **shader math** — future readers won't know why the pivot is 0.18 or why exposure is a linear multiply. Explain the color science inline.
- Prefer pure functions for pipeline/edit-state logic so it's testable without a GPU.
- Small, focused commits per phase step below.
- No `localStorage` assumptions for image data (too big); keep working buffers in memory.

---

## Roadmap & current status

Build phase by phase. Don't jump ahead. **Update the status line below as you go.**

- **Phase 0 — Prove the decode.** Load one RAW, decode in the worker, draw to a canvas. Nothing else. De-risks everything.
- **Phase 1 — GPU pipeline.** Linear buffer → WebGL2 texture → display-transform shader. Confirm it looks correct.
- **Phase 2 — Exposure + contrast.** Add the two shader ops with sliders.
- **Phase 3 — Crop.** Touch-friendly overlay, applied as geometry.
- **Phase 4 — Export.** Full-res render + encode + download.
- **Phase 5 — Export controls.** Export options popover: 8-bit JPEG format + quality.

**CURRENT STATUS:** _Phase 5 complete — **all roadmap scope done.** Export (`src/export/export.ts`) re-decodes at **full resolution** (the one place we don't half-size), then reuses the display `Renderer` on an offscreen canvas so the baked image is pixel-identical to the preview — same shader, same uniforms — encoding an **8-bit JPEG** (the WebGL framebuffer is RGBA8) and downloading `<name>-darkraw.jpg`. The Export button opens an options popover (`src/ui/exportPanel.ts`): format (JPEG · 8-bit) + a quality slider (50–100), passed as `ExportOptions` to `exportImage`. Verified on the Sony ARW: full-res 6240×4168 output; quality 60 → 2.45 MB vs 100 → 38.85 MB (slider drives the encoder); +1EV/+40 contrast/0.6×0.6 crop bakes correctly. Export renderer uses `{preserveDrawingBuffer:true}` and `dispose()`s its context after each run._

**The defined scope (render → exposure → contrast → crop → export) is fully implemented and verified.** Possible next steps if desired: PWA install/offline shell (manifest + service worker), pan/zoom, or additional export formats (16-bit PNG/TIFF). MIT License created and GitHub Pages CI/CD workflow configured.

### App structure — three screens

The UI is a three-screen flow (`src/ui/screens.ts` toggles `[data-screen]` sections; `[hidden]{display:none!important}` so it beats class `display` rules):

1. **Start** (`src/ui/startScreen.ts`) — Nikon-style DarkRawLAB wordmark; pick a RAW → progress bar → `loadRaw()` (one `open`: half-size linear image **+** EXIF **+** embedded JPEG thumbnail) → thumbnail + EXIF panel (`src/ui/exif.ts`) → **Enhance**. The half-size decode is handed to the editor as-is — **Enhance does not re-decode**.
2. **Editor** — canvas + exposure/contrast + Crop; **Export** button → export screen.
3. **Export** — format (JPEG · 8-bit) + quality → Download / Back.

`loadRaw()` lives beside `decodeRaw()` in `src/worker/decode.ts` and shares one `openSettings()`. Verified end-to-end on the Sony ARW: real EXIF (ILME-FX30 / 18-135mm / ISO800 / f5 / 1-125s), thumbnail, screen transitions, export + back.

---

## Licensing

- We write fresh code — this is **not** a fork of darktable's GPL source. Call it "darktable-inspired," not a port.
- **LibRaw is LGPL** (with other license options). Respect its terms in bundling/distribution.
- Pick our own license for original code (MIT License selected and recorded in `LICENSE`).

---

## Do NOT

- Re-run the WASM decoder on slider/zoom/crop interactions.
- Bake exposure/contrast into pixels for preview (it's a shader; keep it live).
- Decode full-res for editing (downscale; full-res only at export).
- Apply pipeline operations out of order (exposure → contrast → crop → display transform).
- Add features beyond the current scope without being asked.
- Add heavy dependencies without justification.
