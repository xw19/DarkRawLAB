# DarkRaw Lab

A **mobile-first, browser-based RAW photo editor** — free, open source, and **100% client-side**. Open a RAW on your phone in a browser, edit it, and export a finished image. No upload, no backend, no install.

Inspired by [darktable](https://www.darktable.org/)'s processing-pipeline model; the differentiator here is **mobile + web/WASM**, not feature parity.

> Your photos never leave your device. Decoding, editing, and export all run locally in the browser.

## Features

- **Open RAW files** — decoded in the browser via LibRaw compiled to WebAssembly, with instant EXIF and an embedded-thumbnail preview for a fast first paint.
- **Tone** — exposure, contrast, highlights, shadows, whites, blacks.
- **Colour** — white balance (temperature/tint), saturation, vibrance, luminance.
- **Detail** — multi-scale luma + chroma denoise, and film grain.
- **Geometry** — crop, free-angle straighten, and 90° rotation, with touch-friendly gestures.
- **View** — pinch/wheel zoom and pan, plus focus peaking and a translucent RGB histogram from the slide-in menu (all non-destructive; never baked into the image).
- **Export** — full-resolution JPEG (with a quality slider) or PNG.

## How it works

The core principle: **decode once in a WASM worker, then apply every interactive edit on the GPU.**

RAW decoding is expensive, so it happens once per image, off the main thread, into a **linear-light** buffer. Every adjustment above is then a [WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext) fragment-shader pass over that buffer — so sliders, crop, and zoom stay real-time and never trigger a re-decode. Full resolution is only decoded once, at export.

The pipeline is deliberately ordered as **scene-referred (linear light) → display transform (sRGB) → output-referred**, mirroring a real photo pipeline. See [`claude.md`](./claude.md) for the full architecture and the exact operation order.

## Tech stack

- **[Vite](https://vitejs.dev/) + TypeScript** (strict mode)
- **[libraw-wasm](https://www.npmjs.com/package/libraw-wasm)** — RAW decode in a Web Worker
- **[twgl.js](https://twgljs.org/)** — a thin helper over WebGL2
- **[Vitest](https://vitest.dev/)** — unit tests for the pure pipeline/geometry/formatting logic

No UI framework — it's a canvas app with a small, hand-wired DOM.

## Getting started

Requires **Node 20+**.

```bash
npm install     # install dependencies
npm run dev     # start the dev server (exposed on your LAN for phone testing)
```

Open the printed URL — on your computer, or on a phone on the same network — and pick a RAW file.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (hosted on the LAN so you can test on a real phone) |
| `npm run build` | Type-check (`tsc`) then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check without emitting |

## Deployment

The build output in `dist/` is a fully static site — host it anywhere.

Current deployment is **manual to [Netlify](https://www.netlify.com/)**:

```bash
npm run build
npx netlify deploy --prod --dir=dist
```

(If deploying under a sub-path rather than a domain root, set `BASE_PATH=/subpath/` before `npm run build` — see [`vite.config.ts`](./vite.config.ts).)

## Browser support

Requires a browser with **WebGL2** and **WebAssembly** — all current mobile and desktop browsers (iOS Safari, Android Chrome, Firefox, Edge). Large RAW files are memory-intensive; editing is done on a downscaled decode and only rendered at full resolution for export.

## Contributing

Start with [`claude.md`](./claude.md) — it documents the architecture, the correctness-critical pipeline order, the mobile constraints, and the conventions to follow. In short: keep decode/render/edit-state/UI separated, keep pipeline and geometry logic in pure (GPU-free) functions with tests, and never re-run the decoder on an interactive edit.

Adjustment controls are declared once in [`src/editor/sliders.ts`](./src/editor/sliders.ts); adding one is mostly a table entry (see "Adding an adjustment" in `claude.md`).

## License

Original code is licensed under the **[MIT License](./LICENSE)**.

RAW decoding uses **LibRaw**, which is **LGPL** (with other licensing options); its terms apply to its portion of any distribution. This project is *darktable-inspired* — it is **not** a fork or port of darktable's GPL source.
