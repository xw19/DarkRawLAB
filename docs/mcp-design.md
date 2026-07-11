# DarkRaw Lab — MCP / agent-automation design

Status: **design + Phase 1 landed** (the `window.darkraw` hook + preset format). The
MCP server itself is not built yet.

## Goal

Let an AI agent interact with DarkRaw Lab as a **local dev/automation tool** —
produce edit recipes, drive the editor, and (eventually) render/export — without
abandoning the app's 100% client-side design.

## The core constraint

The processing pipeline is **WebGL2 in the browser**. An MCP server is a Node
process and can't run those shaders directly. The naive fixes are bad:

- Reimplementing the pipeline in Node → a second source of truth that drifts from
  the real shaders.
- Headless GL (`gl` npm) → native build; it failed to compile in this environment.

**The move: drive the real app headlessly with Playwright.** Headless Chromium has
genuine WebGL2 + WASM, so the server just *controls the actual app* — real shaders,
pixel-identical to the browser, one source of truth.

## Architecture — two pieces

### 1. In-app automation hook: `window.darkraw` (Phase 1, done)

A small programmatic surface over the editor, defined in `src/main.ts`, reusing the
same code paths as the UI. It is client-side (just an API surface, no server):

```
window.darkraw.getState()        -> { editState, crop }
window.darkraw.getPreset()       -> JSON string
window.darkraw.applyEdits(state)  // validated by the range sliders on apply
window.darkraw.setCrop(rect)
window.darkraw.loadPreset(json)
window.darkraw.loadRaw(bytes, name) -> meta   // decode + enter editor
window.darkraw.getPreview(maxDim) -> PNG data URL
window.darkraw.export(options)   -> triggers a full-res export
```

Backed by `src/editor/preset.ts` (pure serialize/parse of `{ version, editState,
crop }`). This hook is independently useful: preset save/load, and the `verify`
skill can drive the app through it.

### 2. `darkraw-mcp` package (Phase 2+, not built)

A **separate** Node package (e.g. a `mcp/` folder), never shipped with the web app:

- `@modelcontextprotocol/sdk` (TypeScript), **stdio** transport — plugs into Claude
  Desktop / Code / Cursor via a config entry.
- **Playwright** launches headless Chromium, loads the built app (via `vite
  preview`), and calls `window.darkraw.*` through `page.evaluate`.

## Why the codebase already fits

- **`EditState` (51 fields) + crop rect is already a JSON edit recipe** — no new
  data model. It's exactly what the agent produces/consumes.
- **`SLIDERS` is a machine-readable control catalog** — the agent's vocabulary
  (names, defaults, mappings) falls out for free.
- The pure modules (`toUniforms`, `crop.ts`, `sliders.ts`, `preset.ts`) run in Node
  directly for validation/description without a browser.

## Proposed MCP surface

**Tools**
- `list_controls` — the `SLIDERS` catalog (the agent's vocabulary).
- `open_raw(path)` → EXIF + dimensions + thumbnail (wraps `loadRaw`).
- `apply_edits(editState)` — validate against ranges, apply.
- `get_preview()` → base64 PNG, and `get_histogram()` — **the feedback loop**: lets
  the agent see the result and iterate (adjust → look → adjust).
- `export(path, options)` — full-res render to a file.
- `describe_edit` / `validate_edit` — pure-logic helpers (no browser).

**Resources**: the control schema (from `SLIDERS`) and loaded-image metadata.

## Phases

1. **Preset layer + `window.darkraw` hook** — *done*. Save/load recipes; testing hook.
2. **`darkraw-mcp`**: Playwright + MCP SDK; tools `list_controls` / `open_raw` /
   `apply_edits` / `export`.
3. **Feedback loop**: `get_preview` + `get_histogram` → the agent edits *visually*,
   not blind. This is what turns "applies recipes" into "actually edits photos."

## Caveats

- Playwright bundles Chromium (~hundreds of MB); headless WebGL2 may fall back to
  SwiftShader (software — slower, fine for automation).
- Kept as a **separate package**, deliberately not shipped — preserves the
  no-backend design.
- One pipeline, always: the shaders stay the single source of truth.

**Lighter alternative** (no Playwright): a *recipe-only* MCP server (pure TS, no
rendering) where the agent produces presets and a human applies them in-browser.
Trivial, but no visual feedback loop.
