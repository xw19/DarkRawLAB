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
const percent = (v: number) => `${v}%`;
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
  // Whites: gain on the extreme highlights (±1 stop). Blacks: linear lift/crush
  // of the extreme shadows (±0.05); small because a little goes a long way at the
  // bottom of the range.
  { key: "whites", inputId: "whites", labelId: "whites-val", uniform: "u_whites", default: 0, toUniform: scale(1), format: signed },
  { key: "blacks", inputId: "blacks", labelId: "blacks-val", uniform: "u_blacks", default: 0, toUniform: scale(0.05), format: signed },

  // Geometry. rotation90 is button-driven and has no visible label.
  { key: "angleDeg", inputId: "rotate-slider", labelId: "rotate-val", uniform: "u_angle", default: 0, toUniform: deg2rad, format: signedDeg },
  { key: "rotation90", inputId: "rotation90", uniform: "u_rotation90", default: 0, toUniform: identity },

  // Colour. temp/tint/luminance → ±0.5; saturation/vibrance → ±1.0.
  { key: "temp", inputId: "temp", labelId: "temp-val", uniform: "u_temp", default: 0, toUniform: scale(0.5), format: signed },
  { key: "tint", inputId: "tint", labelId: "tint-val", uniform: "u_tint", default: 0, toUniform: scale(0.5), format: signed },
  { key: "saturation", inputId: "saturation", labelId: "saturation-val", uniform: "u_saturation", default: 0, toUniform: scale(1), format: signed },
  { key: "vibrance", inputId: "vibrance", labelId: "vibrance-val", uniform: "u_vibrance", default: 0, toUniform: scale(1), format: signed },
  { key: "luminance", inputId: "luminance", labelId: "luminance-val", uniform: "u_luminance", default: 0, toUniform: scale(0.5), format: signed },

  // Channel mixer: a 3×3 matrix in %. scale(1) maps 100 → 1.0; the diagonal
  // defaults to 100 (identity), range -200..200 for strong creative/B&W mixes.
  { key: "mixRR", inputId: "mix-rr", labelId: "mix-rr-val", uniform: "u_mixRR", default: 100, toUniform: scale(1), format: percent },
  { key: "mixRG", inputId: "mix-rg", labelId: "mix-rg-val", uniform: "u_mixRG", default: 0, toUniform: scale(1), format: percent },
  { key: "mixRB", inputId: "mix-rb", labelId: "mix-rb-val", uniform: "u_mixRB", default: 0, toUniform: scale(1), format: percent },
  { key: "mixGR", inputId: "mix-gr", labelId: "mix-gr-val", uniform: "u_mixGR", default: 0, toUniform: scale(1), format: percent },
  { key: "mixGG", inputId: "mix-gg", labelId: "mix-gg-val", uniform: "u_mixGG", default: 100, toUniform: scale(1), format: percent },
  { key: "mixGB", inputId: "mix-gb", labelId: "mix-gb-val", uniform: "u_mixGB", default: 0, toUniform: scale(1), format: percent },
  { key: "mixBR", inputId: "mix-br", labelId: "mix-br-val", uniform: "u_mixBR", default: 0, toUniform: scale(1), format: percent },
  { key: "mixBG", inputId: "mix-bg", labelId: "mix-bg-val", uniform: "u_mixBG", default: 0, toUniform: scale(1), format: percent },
  { key: "mixBB", inputId: "mix-bb", labelId: "mix-bb-val", uniform: "u_mixBB", default: 100, toUniform: scale(1), format: percent },

  // Per-hue HSL mixer: 8 colour bands × Hue/Saturation/Luminance. Hue → ±30°
  // (0.0833 turn), Sat → ±1.0, Lum → ±0.2 lightness. Band centres live in the
  // shader; this table just carries the 24 adjustment values.
  { key: "hslHueRed", inputId: "hsl-hue-red", labelId: "hsl-hue-red-val", uniform: "u_hslHueRed", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatRed", inputId: "hsl-sat-red", labelId: "hsl-sat-red-val", uniform: "u_hslSatRed", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumRed", inputId: "hsl-lum-red", labelId: "hsl-lum-red-val", uniform: "u_hslLumRed", default: 0, toUniform: scale(0.2), format: signed },
  { key: "hslHueOrange", inputId: "hsl-hue-orange", labelId: "hsl-hue-orange-val", uniform: "u_hslHueOrange", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatOrange", inputId: "hsl-sat-orange", labelId: "hsl-sat-orange-val", uniform: "u_hslSatOrange", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumOrange", inputId: "hsl-lum-orange", labelId: "hsl-lum-orange-val", uniform: "u_hslLumOrange", default: 0, toUniform: scale(0.2), format: signed },
  { key: "hslHueYellow", inputId: "hsl-hue-yellow", labelId: "hsl-hue-yellow-val", uniform: "u_hslHueYellow", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatYellow", inputId: "hsl-sat-yellow", labelId: "hsl-sat-yellow-val", uniform: "u_hslSatYellow", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumYellow", inputId: "hsl-lum-yellow", labelId: "hsl-lum-yellow-val", uniform: "u_hslLumYellow", default: 0, toUniform: scale(0.2), format: signed },
  { key: "hslHueGreen", inputId: "hsl-hue-green", labelId: "hsl-hue-green-val", uniform: "u_hslHueGreen", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatGreen", inputId: "hsl-sat-green", labelId: "hsl-sat-green-val", uniform: "u_hslSatGreen", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumGreen", inputId: "hsl-lum-green", labelId: "hsl-lum-green-val", uniform: "u_hslLumGreen", default: 0, toUniform: scale(0.2), format: signed },
  { key: "hslHueAqua", inputId: "hsl-hue-aqua", labelId: "hsl-hue-aqua-val", uniform: "u_hslHueAqua", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatAqua", inputId: "hsl-sat-aqua", labelId: "hsl-sat-aqua-val", uniform: "u_hslSatAqua", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumAqua", inputId: "hsl-lum-aqua", labelId: "hsl-lum-aqua-val", uniform: "u_hslLumAqua", default: 0, toUniform: scale(0.2), format: signed },
  { key: "hslHueBlue", inputId: "hsl-hue-blue", labelId: "hsl-hue-blue-val", uniform: "u_hslHueBlue", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatBlue", inputId: "hsl-sat-blue", labelId: "hsl-sat-blue-val", uniform: "u_hslSatBlue", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumBlue", inputId: "hsl-lum-blue", labelId: "hsl-lum-blue-val", uniform: "u_hslLumBlue", default: 0, toUniform: scale(0.2), format: signed },
  { key: "hslHuePurple", inputId: "hsl-hue-purple", labelId: "hsl-hue-purple-val", uniform: "u_hslHuePurple", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatPurple", inputId: "hsl-sat-purple", labelId: "hsl-sat-purple-val", uniform: "u_hslSatPurple", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumPurple", inputId: "hsl-lum-purple", labelId: "hsl-lum-purple-val", uniform: "u_hslLumPurple", default: 0, toUniform: scale(0.2), format: signed },
  { key: "hslHueMagenta", inputId: "hsl-hue-magenta", labelId: "hsl-hue-magenta-val", uniform: "u_hslHueMagenta", default: 0, toUniform: scale(0.08333), format: signed },
  { key: "hslSatMagenta", inputId: "hsl-sat-magenta", labelId: "hsl-sat-magenta-val", uniform: "u_hslSatMagenta", default: 0, toUniform: scale(1), format: signed },
  { key: "hslLumMagenta", inputId: "hsl-lum-magenta", labelId: "hsl-lum-magenta-val", uniform: "u_hslLumMagenta", default: 0, toUniform: scale(0.2), format: signed },

  // Denoise thresholds (per-band ceilings) + film grain.
  { key: "denoiseFine", inputId: "denoise-fine", labelId: "denoise-fine-val", uniform: "u_denoiseFine", default: 0, toUniform: scale(0.15), format: signed },
  { key: "denoiseCoarse", inputId: "denoise-coarse", labelId: "denoise-coarse-val", uniform: "u_denoiseCoarse", default: 0, toUniform: scale(0.2), format: signed },
  { key: "denoiseChroma", inputId: "denoise-chroma", labelId: "denoise-chroma-val", uniform: "u_denoiseChroma", default: 0, toUniform: scale(0.25), format: signed },
  { key: "grainStrength", inputId: "grain-strength", labelId: "grain-strength-val", uniform: "u_grainStrength", default: 0, toUniform: scale(0.1), format: signed },
  { key: "grainSize", inputId: "grain-size", labelId: "grain-size-val", uniform: "u_grainSize", default: 2, toUniform: identity, format: fixed1 },
];
