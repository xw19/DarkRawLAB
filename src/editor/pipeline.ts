// Edit state → shader uniforms.
//
// This is deliberately plain data and pure functions: the whole editable state
// of an image is a few numbers, and mapping them to GL uniforms has no GPU
// dependency, so it's unit-testable on its own. Keeping this separate from the
// renderer is what lets every edit stay real-time — a slider move is just a new
// uniform value, never a re-decode.

/** The user-facing edit state. Crop (a rect) joins this in Phase 3. */
export interface EditState {
  /** Exposure in EV stops. 0 = no change; +1 doubles linear light. */
  exposureEv: number;
  /** Contrast in UI units, -100..+100. 0 = no change. */
  contrast: number;
}

export const defaultEditState: EditState = {
  exposureEv: 0,
  contrast: 0,
};

/** Uniform values consumed by pipeline.frag. */
export interface PipelineUniforms {
  /** Linear-light exposure multiplier, 2^EV. */
  u_exposure: number;
  /** Contrast factor applied around middle grey (0.18 linear, see shader). */
  u_contrast: number;
}

/**
 * Map edit state to shader uniforms. Pure — no GL, no DOM.
 *
 * - Exposure is `2^EV`: a linear-light multiply, so +1 EV = one stop brighter.
 * - Contrast maps the -100..100 UI range onto a factor in [0.5, 2] via `2^(c/100)`,
 *   symmetric in log space so equal-and-opposite slider moves undo each other.
 *   The pivot (0.18 middle grey) lives in the shader.
 */
export function toUniforms(state: EditState): PipelineUniforms {
  return {
    u_exposure: Math.pow(2, state.exposureEv),
    u_contrast: Math.pow(2, state.contrast / 100),
  };
}
