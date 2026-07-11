// The single source of truth for every adjustment control.
//
// Each slider used to be spelled out in five places (EditState, defaultEditState,
// toUniforms, the controls wiring, and the reset code). This table replaces four
// of them: pipeline.ts derives `defaultEditState` and `toUniforms` from it, and
// ui/controls.ts drives all DOM wiring, formatting, and reset from it. The two
// places that still need a matching entry by hand are the language boundaries:
// the `uniform` declaration in gl/shaders/pipeline.frag and the markup in
// index.html.
//
// A spec fully describes one control: which EditState field it drives, its DOM
// input/label ids, the uniform it feeds, its default (no-op) value, the UI→uniform
// mapping, and how to format its label. This is the file to touch when tuning
// constants — the colour science lives here, next to the ranges it applies to.

import type { EditState, PipelineUniforms } from "./pipeline";

export interface SliderSpec {
  /** EditState field this control drives. */
  key: keyof EditState;
  /** id of the `<input>` in index.html. */
  inputId: string;
  /** id of the value label; omit for controls with no visible readout. */
  labelId?: string;
  /** Uniform this maps to in pipeline.frag. */
  uniform: keyof PipelineUniforms;
  /** Default (no-op) value. */
  default: number;
  /** UI value → shader uniform value. */
  toUniform: (v: number) => number;
  /** UI value → label text; omit if there's no label. */
  format?: (v: number) => string;
}

// --- UI → uniform mappings -------------------------------------------------
const identity = (v: number) => v;
/** Exposure/whitebalance: 2^EV is a linear-light multiply, so +1 = one stop. */
const pow2 = (v: number) => Math.pow(2, v);
/** Contrast: 2^(c/100) maps -100..100 onto [0.5, 2], symmetric in log space. */
const pow2pct = (v: number) => Math.pow(2, v / 100);
const deg2rad = (v: number) => (v * Math.PI) / 180;
/** Linear scale of the -100..100 (or 0..100) UI range onto ±k. */
const scale = (k: number) => (v: number) => (v / 100) * k;

// --- label formatters ------------------------------------------------------
// Signed, fixed formatting so numbers don't jitter in width as you drag.
const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;
const signedEv = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} EV`;
const signedDeg = (v: number) => `${v > 0 ? "+" : ""}${v}°`;
const fixed1 = (v: number) => v.toFixed(1);

export const SLIDERS: readonly SliderSpec[] = [
  // Tone
  { key: "exposureEv", inputId: "exposure", labelId: "exposure-val", uniform: "u_exposure", default: 0, toUniform: pow2, format: signedEv },
  { key: "contrast", inputId: "contrast", labelId: "contrast-val", uniform: "u_contrast", default: 0, toUniform: pow2pct, format: signed },
  // Highlights/shadows: -100..100 → ±1.5 stops of local exposure.
  { key: "highlights", inputId: "highlights", labelId: "highlights-val", uniform: "u_highlights", default: 0, toUniform: scale(1.5), format: signed },
  { key: "shadows", inputId: "shadows", labelId: "shadows-val", uniform: "u_shadows", default: 0, toUniform: scale(1.5), format: signed },

  // Geometry. rotation90 is button-driven and has no visible label.
  { key: "angleDeg", inputId: "rotate-slider", labelId: "rotate-val", uniform: "u_angle", default: 0, toUniform: deg2rad, format: signedDeg },
  { key: "rotation90", inputId: "rotation90", uniform: "u_rotation90", default: 0, toUniform: identity },

  // Colour. temp/tint/luminance → ±0.5; saturation/vibrance → ±1.0.
  { key: "temp", inputId: "temp", labelId: "temp-val", uniform: "u_temp", default: 0, toUniform: scale(0.5), format: signed },
  { key: "tint", inputId: "tint", labelId: "tint-val", uniform: "u_tint", default: 0, toUniform: scale(0.5), format: signed },
  { key: "saturation", inputId: "saturation", labelId: "saturation-val", uniform: "u_saturation", default: 0, toUniform: scale(1), format: signed },
  { key: "vibrance", inputId: "vibrance", labelId: "vibrance-val", uniform: "u_vibrance", default: 0, toUniform: scale(1), format: signed },
  { key: "luminance", inputId: "luminance", labelId: "luminance-val", uniform: "u_luminance", default: 0, toUniform: scale(0.5), format: signed },

  // Denoise thresholds (per-band ceilings) + film grain.
  { key: "denoiseFine", inputId: "denoise-fine", labelId: "denoise-fine-val", uniform: "u_denoiseFine", default: 0, toUniform: scale(0.15), format: signed },
  { key: "denoiseCoarse", inputId: "denoise-coarse", labelId: "denoise-coarse-val", uniform: "u_denoiseCoarse", default: 0, toUniform: scale(0.2), format: signed },
  { key: "denoiseChroma", inputId: "denoise-chroma", labelId: "denoise-chroma-val", uniform: "u_denoiseChroma", default: 0, toUniform: scale(0.25), format: signed },
  { key: "grainStrength", inputId: "grain-strength", labelId: "grain-strength-val", uniform: "u_grainStrength", default: 0, toUniform: scale(0.1), format: signed },
  { key: "grainSize", inputId: "grain-size", labelId: "grain-size-val", uniform: "u_grainSize", default: 2, toUniform: identity, format: fixed1 },
];
