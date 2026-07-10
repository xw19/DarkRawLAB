#version 300 es
precision highp float;

// DarkRaw Lab display pipeline.
//
// The texture holds the RAW decoded to LINEAR LIGHT (no gamma baked in). Edits
// are applied here, in linear light, in this exact order (CLAUDE.md):
//
//   1. exposure   (linear multiply)      — Phase 2
//   2. contrast   (tone curve @ 0.18)    — Phase 2
//   3. crop       (geometry / UV window) — Phase 3
//   4. display transform (linear→sRGB)   — this shader, last, always
//
// Phase 2 implements steps 1–2 and 4. Crop (step 3) is geometry and lands in
// Phase 3; keeping them ordered here is what makes the results correct.

in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_exposure; // linear-light multiplier, 2^EV (1.0 = no change)
uniform float u_contrast; // contrast factor around middle grey (1.0 = no change)
uniform vec2 u_cropOrigin; // top-left of the crop window in [0,1] texture space
uniform vec2 u_cropSize; // crop window size in [0,1]; (1,1) = whole image
out vec4 fragColor;

// Middle grey in linear light. Contrast pivots here so tonal expansion is
// anchored to a perceptual mid-tone rather than to black. ~0.18 is the standard
// linear middle-grey reflectance.
const float MIDDLE_GREY = 0.18;

// sRGB opto-electronic transfer function (linear → sRGB-encoded), the standard
// piecewise curve: a linear toe below 0.0031308, a gamma ~1/2.4 segment above.
// This is the "display transform" — it must be applied last so what we edit in
// linear light lands correctly on an sRGB screen.
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}

void main() {
  // 3. Crop — pure geometry. We map the full [0,1] quad onto the crop window,
  //    so we simply sample a sub-rectangle of the texture. No pixel is
  //    reprocessed; the canvas is sized to the crop's aspect on the CPU side.
  vec2 uv = u_cropOrigin + v_uv * u_cropSize;
  vec3 c = texture(u_image, uv).rgb;

  // 1. Exposure — a plain multiply in linear light. Doing this BEFORE the
  //    display transform is what makes highlight/shadow recovery work: a bright
  //    value pulled down here re-enters the [0,1] range before sRGB encoding,
  //    instead of being clipped in a baked preview.
  c *= u_exposure;

  // 2. Contrast — expand/compress the tonal range around middle grey. Values
  //    above 0.18 stretch up, below stretch down; the display transform's clamp
  //    handles anything that lands outside [0,1] (crushed shadows / clipped
  //    highlights). Applied in linear light, after exposure.
  c = (c - MIDDLE_GREY) * u_contrast + MIDDLE_GREY;

  // 4. Display transform — linear → sRGB, always last.
  fragColor = vec4(linearToSrgb(c), 1.0);
}
