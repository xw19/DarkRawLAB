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
}

/**
 * Map edit state to shader uniforms. Pure — no GL, no DOM. Each slider's
 * UI→uniform mapping is declared in the SLIDERS table (./sliders.ts); this just
 * applies them, so there's no per-field list to keep in sync here.
 */
export function toUniforms(state: EditState): PipelineUniforms {
  const u = {} as Record<keyof PipelineUniforms, number>;
  for (const s of SLIDERS) {
    u[s.uniform] = s.toUniform(state[s.key]);
  }
  return u as PipelineUniforms;
}
