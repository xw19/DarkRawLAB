// Edit state → shader uniforms.
//
// This is deliberately plain data and pure functions: the whole editable state
// of an image is a few numbers, and mapping them to GL uniforms has no GPU
// dependency, so it's unit-testable on its own. Keeping this separate from the
// renderer is what lets every edit stay real-time — a slider move is just a new
// uniform value, never a re-decode.
//
// `defaultEditState` and `toUniforms` are DERIVED from the SLIDERS table in
// ./sliders.ts — that table is the single source of truth for each control's
// default and its UI→uniform mapping. The interfaces below are the compile-time
// contracts those two functions satisfy.

import { SLIDERS } from "./sliders";

/** The user-facing edit state. */
export interface EditState {
  /** Exposure in EV stops. 0 = no change; +1 doubles linear light. */
  exposureEv: number;
  /** Contrast in UI units, -100..+100. 0 = no change. */
  contrast: number;
  /** Highlights adjustment, -100..+100. 0 = no change. */
  highlights: number;
  /** Shadows adjustment, -100..+100. 0 = no change. */
  shadows: number;
  /** Whites adjustment (white point), -100..+100. 0 = no change. */
  whites: number;
  /** Blacks adjustment (black point), -100..+100. 0 = no change. */
  blacks: number;
  /** Rotation angle in degrees, -45..+45. 0 = no change. */
  angleDeg: number;
  /** Discrete 90-degree rotation step, 0 = 0, 1 = 90 CW, 2 = 180, 3 = 270 CW. */
  rotation90: number;
  /** Temperature shift, -100..+100. 0 = no change. */
  temp: number;
  /** Tint shift, -100..+100. 0 = no change. */
  tint: number;
  /** Saturation shift, -100..+100. 0 = no change. */
  saturation: number;
  /** Vibrance shift, -100..+100. 0 = no change. */
  vibrance: number;
  /** Luminance shift, -100..+100. 0 = no change. */
  luminance: number;
  // Channel mixer (%), a 3×3 matrix. Identity = diagonal 100, off-diagonal 0.
  mixRR: number;
  mixRG: number;
  mixRB: number;
  mixGR: number;
  mixGG: number;
  mixGB: number;
  mixBR: number;
  mixBG: number;
  mixBB: number;
  // Per-hue HSL mixer: Hue/Saturation/Luminance for 8 colour bands (-100..100).
  hslHueRed: number; hslSatRed: number; hslLumRed: number;
  hslHueOrange: number; hslSatOrange: number; hslLumOrange: number;
  hslHueYellow: number; hslSatYellow: number; hslLumYellow: number;
  hslHueGreen: number; hslSatGreen: number; hslLumGreen: number;
  hslHueAqua: number; hslSatAqua: number; hslLumAqua: number;
  hslHueBlue: number; hslSatBlue: number; hslLumBlue: number;
  hslHuePurple: number; hslSatPurple: number; hslLumPurple: number;
  hslHueMagenta: number; hslSatMagenta: number; hslLumMagenta: number;
  /** Fine luma denoise, 0..100. */
  denoiseFine: number;
  /** Coarse luma denoise, 0..100. */
  denoiseCoarse: number;
  /** Chroma denoise, 0..100. */
  denoiseChroma: number;
  /** Film grain strength, 0..100. */
  grainStrength: number;
  /** Film grain size, 1..10. */
  grainSize: number;
  /** Sharpen strength, 0..100. */
  sharpen: number;
}

/** No-op edit state, built from each slider's declared default. */
export const defaultEditState: EditState = (() => {
  const state = {} as Record<keyof EditState, number>;
  for (const s of SLIDERS) state[s.key] = s.default;
  return state as EditState;
})();

/** Uniform values consumed by pipeline.frag. */
export interface PipelineUniforms {
  /** Linear-light exposure multiplier, 2^EV. */
  u_exposure: number;
  /** Contrast factor applied around middle grey (0.18 linear, see shader). */
  u_contrast: number;
  /** Highlights adjustment in stops, e.g. -1.5..1.5 stops. */
  u_highlights: number;
  /** Shadows adjustment in stops, e.g. -1.5..1.5 stops. */
  u_shadows: number;
  /** Whites gain on the brightest tones, in stops. */
  u_whites: number;
  /** Blacks lift/crush of the darkest tones, linear offset. */
  u_blacks: number;
  /** Rotation angle in radians. */
  u_angle: number;
  /** Discrete 90-degree rotation step (0, 1, 2, 3). */
  u_rotation90: number;
  /** White balance temperature shift factor. */
  u_temp: number;
  /** White balance tint shift factor. */
  u_tint: number;
  /** Saturation adjustment factor. */
  u_saturation: number;
  /** Vibrance adjustment factor. */
  u_vibrance: number;
  /** Luminance adjustment factor. */
  u_luminance: number;
  // Channel-mixer matrix entries as fractions (100% -> 1.0).
  u_mixRR: number;
  u_mixRG: number;
  u_mixRB: number;
  u_mixGR: number;
  u_mixGG: number;
  u_mixGB: number;
  u_mixBR: number;
  u_mixBG: number;
  u_mixBB: number;
  // Per-hue HSL mixer (hue in turns, sat as fraction, lum as lightness offset).
  u_hslHueRed: number; u_hslSatRed: number; u_hslLumRed: number;
  u_hslHueOrange: number; u_hslSatOrange: number; u_hslLumOrange: number;
  u_hslHueYellow: number; u_hslSatYellow: number; u_hslLumYellow: number;
  u_hslHueGreen: number; u_hslSatGreen: number; u_hslLumGreen: number;
  u_hslHueAqua: number; u_hslSatAqua: number; u_hslLumAqua: number;
  u_hslHueBlue: number; u_hslSatBlue: number; u_hslLumBlue: number;
  u_hslHuePurple: number; u_hslSatPurple: number; u_hslLumPurple: number;
  u_hslHueMagenta: number; u_hslSatMagenta: number; u_hslLumMagenta: number;
  /** Fine luma denoise threshold factor. */
  u_denoiseFine: number;
  /** Coarse luma denoise threshold factor. */
  u_denoiseCoarse: number;
  /** Chroma denoise threshold factor. */
  u_denoiseChroma: number;
  /** Film grain strength multiplier. */
  u_grainStrength: number;
  /** Film grain pixel scale. */
  u_grainSize: number;
  /** Sharpen strength multiplier. */
  u_sharpen: number;
}

export function toUniforms(
  state: EditState,
  bypassedKeys?: Set<keyof EditState> | Set<string>,
): PipelineUniforms {
  const u = {} as Record<keyof PipelineUniforms, number>;
  for (const s of SLIDERS) {
    const isBypassed = bypassedKeys && bypassedKeys.has(s.key);
    u[s.uniform] = s.toUniform(isBypassed ? s.default : state[s.key]);
  }
  return u as PipelineUniforms;
}
