#version 300 es
precision highp float;

// DarkRaw Lab display pipeline.
//
// The texture holds the RAW decoded to LINEAR LIGHT (no gamma baked in). Edits
// are applied here in a fixed order (see CLAUDE.md "The processing pipeline").
// The order is a deliberate scene-referred → display → output-referred split:
//
//   Scene-referred (linear light):
//     1. geometry            (rotate + 90° + crop; UV math, no reprocessing)
//     2. denoise             (YCbCr NLM; before any tonal expansion of noise)
//     3. exposure            (linear multiply, 2^EV)
//     4. white balance       (temp/tint)
//     5. highlights/shadows  (luminance-weighted, around 0.18 middle grey)
//     6. saturation/vibrance (mix toward luminance)
//     7. contrast            (tone curve @ 0.18)
//   Display transform:
//     8. linear → sRGB
//   Output-referred (sRGB) — intentionally AFTER the display transform:
//     9. luminance           (perceptual HSL lightness)
//    10. film grain          (uniform in output space, regardless of exposure)
//
// Reordering the scene-referred steps, or moving luminance/grain before the
// sRGB encode, gives subtly wrong results. The UI-unit → uniform mapping for
// each control lives in toUniforms() (editor/pipeline.ts).

in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_exposure; // linear-light multiplier, 2^EV (1.0 = no change)
uniform float u_contrast; // contrast factor around middle grey (1.0 = no change)
uniform float u_highlights; // highlights adjustment, stops (0.0 = no change)
uniform float u_shadows;    // shadows adjustment, stops (0.0 = no change)
uniform float u_whites;     // whites gain on the brightest tones, stops (0.0 = no change)
uniform float u_blacks;     // blacks lift/crush of the darkest tones, linear offset (0.0 = no change)
uniform float u_angle;      // rotation angle in radians (0.0 = no change)
uniform float u_aspect;     // aspect ratio of the canvas (width / height)
uniform int u_rotation90;   // discrete 90-degree rotation step (0, 1, 2, 3)
uniform float u_temp;       // white balance temperature shift (-0.5..0.5)
uniform float u_tint;       // white balance tint shift (-0.5..0.5)
uniform float u_saturation; // saturation adjustment (-1.0..1.0)
uniform float u_vibrance;   // vibrance adjustment (-1.0..1.0)
uniform float u_luminance;  // luminance adjustment (-0.5..0.5)
uniform float u_mixRR; // channel mixer 3x3 (fractions); identity = diag 1, else 0
uniform float u_mixRG;
uniform float u_mixRB;
uniform float u_mixGR;
uniform float u_mixGG;
uniform float u_mixGB;
uniform float u_mixBR;
uniform float u_mixBG;
uniform float u_mixBB;
// Per-hue HSL mixer: 8 bands, each Hue (turns) / Saturation (fraction) / Luminance.
uniform float u_hslHueRed; uniform float u_hslSatRed; uniform float u_hslLumRed;
uniform float u_hslHueOrange; uniform float u_hslSatOrange; uniform float u_hslLumOrange;
uniform float u_hslHueYellow; uniform float u_hslSatYellow; uniform float u_hslLumYellow;
uniform float u_hslHueGreen; uniform float u_hslSatGreen; uniform float u_hslLumGreen;
uniform float u_hslHueAqua; uniform float u_hslSatAqua; uniform float u_hslLumAqua;
uniform float u_hslHueBlue; uniform float u_hslSatBlue; uniform float u_hslLumBlue;
uniform float u_hslHuePurple; uniform float u_hslSatPurple; uniform float u_hslLumPurple;
uniform float u_hslHueMagenta; uniform float u_hslSatMagenta; uniform float u_hslLumMagenta;
uniform float u_denoiseFine;   // fine luma denoise threshold (0.0..0.15)
uniform float u_denoiseCoarse; // coarse luma denoise threshold (0.0..0.20)
uniform float u_denoiseChroma; // chroma denoise threshold (0.0..0.25)
uniform float u_grainStrength; // film grain strength (0.0..0.10)
uniform float u_grainSize;     // film grain size (1.0..10.0)
uniform float u_peaking;   // focus-peaking view aid: 0 = off, 1 = on (never set at export)
uniform float u_filmic;    // filmic tone mapping as the display transform: 0 = plain sRGB, 1 = filmic
uniform vec2 u_cropOrigin; // top-left of the crop window in [0,1] texture space
uniform vec2 u_cropSize; // crop window size in [0,1]; (1,1) = whole image
out vec4 fragColor;

// Middle grey in linear light. Contrast pivots here so tonal expansion is
// anchored to a perceptual mid-tone rather than to black. ~0.18 is the standard
// linear middle-grey reflectance.
const float MIDDLE_GREY = 0.18;

// Focus-peaking overlay: colour, and the linear-luma gradient range over which
// the highlight ramps in (lower = more sensitive). Tune PEAK_LO/PEAK_HI to taste.
const vec3 PEAK_COLOR = vec3(1.0, 0.15, 0.15); // high-visibility red
const float PEAK_LO = 0.05;
const float PEAK_HI = 0.12;

// Per-hue HSL mixer: how far (in hue turns) each colour band reaches; larger =
// more overlap/cross-fade between adjacent bands.
const float HSL_BAND_WIDTH = 0.16;

// RGB to HSL conversion in GLSL
vec3 rgb2hsl(vec3 c) {
  float max_val = max(c.r, max(c.g, c.b));
  float min_val = min(c.r, min(c.g, c.b));
  float h = 0.0;
  float s = 0.0;
  float l = (max_val + min_val) * 0.5;

  if (max_val != min_val) {
    float d = max_val - min_val;
    s = l > 0.5 ? d / (2.0 - max_val - min_val) : d / (max_val + min_val);
    if (max_val == c.r) {
      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    } else if (max_val == c.g) {
      h = (c.b - c.r) / d + 2.0;
    } else {
      h = (c.r - c.g) / d + 4.0;
    }
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;
  if (s == 0.0) {
    return vec3(l);
  }
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0/3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0/3.0)
  );
}

// Accumulate one hue band's weighted contribution for the per-hue HSL mixer.
// The weight falls off smoothly with distance from the band centre (on the hue
// circle) so adjacent bands cross-fade. Kept array-free for maximum GLSL ES
// compatibility. `pixHue`/`center` are in turns [0,1).
void accumBand(float pixHue, float center, float hueA, float satA, float lumA,
               inout float wSum, inout float hueShift, inout float satAdj, inout float lumShift) {
  float d = abs(pixHue - center);
  d = min(d, 1.0 - d); // shortest distance around the hue circle
  float w = 1.0 - smoothstep(0.0, HSL_BAND_WIDTH, d);
  wSum += w;
  hueShift += w * hueA;
  satAdj += w * satA;
  lumShift += w * lumA;
}

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

// Filmic tone mapping (ACES fit, Narkowicz 2015) used as an OPTIONAL display
// transform in place of the plain sRGB curve. It maps scene-linear to a
// display-referred image with filmic highlight rolloff and added midtone
// contrast — closer to darktable's default look than a flat linear→sRGB.
// FILMIC_BIAS scales the input so middle grey (~0.18 linear) lands near where
// sRGB puts it (~0.46), i.e. it changes the contrast/rolloff, not the overall
// brightness. The fit already outputs a display-encoded value, so callers must
// NOT apply linearToSrgb afterwards.
const float FILMIC_BIAS = 1.8;
vec3 filmicDisplay(vec3 x) {
  x *= FILMIC_BIAS;
  const float a = 2.51;
  const float b = 0.03;
  const float d = 2.43;
  const float e = 0.59;
  const float f = 0.14;
  return clamp((x * (a * x + b)) / (x * (d * x + e) + f), 0.0, 1.0);
}

// Convert RGB to YCbCr (standard BT.601 weights)
vec3 rgb2ycbcr(vec3 c) {
  float y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  float cb = -0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b + 0.5;
  float cr = 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b + 0.5;
  return vec3(y, cb, cr);
}

// Convert YCbCr to RGB
vec3 ycbcr2rgb(vec3 c) {
  float y = c.x;
  float cb = c.y - 0.5;
  float cr = c.z - 0.5;
  float r = y + 1.402 * cr;
  float g = y - 0.34414 * cb - 0.71414 * cr;
  float b = y + 1.772 * cb;
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

// Optimized Multi-Scale NLM Denoising Filter
vec3 applyDenoise(vec2 uv, vec3 centerColor) {
  vec3 centerY = rgb2ycbcr(centerColor);
  
  float fineWeightSum = 0.0;
  float fineLumaSum = 0.0;
  
  float coarseWeightSum = 0.0;
  float coarseLumaSum = 0.0;
  
  float chromaWeightSum = 0.0;
  vec2 chromaSum = vec2(0.0);
  
  vec2 texelSize = 1.0 / vec2(textureSize(u_image, 0));
  
  // 5x5 search window for Fine Luma and Chroma
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 offset = vec2(dx, dy) * texelSize;
      vec3 neighbor = texture(u_image, uv + offset).rgb;
      vec3 neighborY = rgb2ycbcr(neighbor);
      
      float diffLuma = abs(neighborY.x - centerY.x);
      float diffChroma = length(neighborY.yz - centerY.yz);
      
      if (u_denoiseFine > 0.0) {
        float w = exp(-(diffLuma * diffLuma) / (u_denoiseFine * u_denoiseFine));
        fineLumaSum += neighborY.x * w;
        fineWeightSum += w;
      }
      
      if (u_denoiseChroma > 0.0) {
        float w = exp(-(diffChroma * diffChroma) / (u_denoiseChroma * u_denoiseChroma));
        chromaSum += neighborY.yz * w;
        chromaWeightSum += w;
      }
    }
  }
  
  // 5x5 wider search window for Coarse Luma (step size 2.5)
  if (u_denoiseCoarse > 0.0) {
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        vec2 offset = vec2(dx, dy) * texelSize * 2.5;
        vec3 neighbor = texture(u_image, uv + offset).rgb;
        vec3 neighborY = rgb2ycbcr(neighbor);
        
        float diffLuma = abs(neighborY.x - centerY.x);
        float w = exp(-(diffLuma * diffLuma) / (u_denoiseCoarse * u_denoiseCoarse));
        coarseLumaSum += neighborY.x * w;
        coarseWeightSum += w;
      }
    }
  }
  
  float finalLuma = centerY.x;
  if (u_denoiseFine > 0.0 && fineWeightSum > 0.0) {
    finalLuma = fineLumaSum / fineWeightSum;
  }
  if (u_denoiseCoarse > 0.0 && coarseWeightSum > 0.0) {
    if (u_denoiseFine > 0.0) {
      finalLuma = mix(finalLuma, coarseLumaSum / coarseWeightSum, 0.5);
    } else {
      finalLuma = coarseLumaSum / coarseWeightSum;
    }
  }
  
  vec2 finalChroma = centerY.yz;
  if (u_denoiseChroma > 0.0 && chromaWeightSum > 0.0) {
    finalChroma = chromaSum / chromaWeightSum;
  }
  
  return ycbcr2rgb(vec3(finalLuma, finalChroma));
}

// Simple hash function for pseudo-random noise [0, 1]
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

// Film grain generator
vec3 applyGrain(vec2 uv, vec3 color) {
  vec2 imgSize = vec2(textureSize(u_image, 0));
  vec2 grainUv = floor(uv * imgSize / u_grainSize) * u_grainSize / imgSize;
  
  float noise = rand(grainUv) - 0.5;
  
  // Perceptual luma scaling: grain peaks in midtones
  float luma = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  float lumaFactor = 4.0 * luma * (1.0 - luma);
  
  float grainAmount = noise * u_grainStrength * lumaFactor;
  return clamp(color + vec3(grainAmount), 0.0, 1.0);
}

void main() {
  // 1. Geometry (crop & rotate) — pure geometry. We rotate the coordinates around the
  //    viewport center (0.5, 0.5) in an aspect-corrected space to avoid stretching,
  //    then apply discrete 90-degree steps, and map the result to the crop window.
  vec2 v_uv_rot = v_uv;
  if (u_angle != 0.0) {
    vec2 uv_correct = vec2((v_uv.x - 0.5) * u_aspect, v_uv.y - 0.5);
    float cos_a = cos(u_angle);
    float sin_a = sin(u_angle);
    vec2 uv_rot = vec2(
      uv_correct.x * cos_a - uv_correct.y * sin_a,
      uv_correct.x * sin_a + uv_correct.y * cos_a
    );
    v_uv_rot = vec2(uv_rot.x / u_aspect, uv_rot.y) + 0.5;
  }

  // Apply discrete 90-degree rotation steps
  if (u_rotation90 == 1) {
    v_uv_rot = vec2(v_uv_rot.y, 1.0 - v_uv_rot.x);
  } else if (u_rotation90 == 2) {
    v_uv_rot = vec2(1.0 - v_uv_rot.x, 1.0 - v_uv_rot.y);
  } else if (u_rotation90 == 3) {
    v_uv_rot = vec2(1.0 - v_uv_rot.y, v_uv_rot.x);
  }

  vec2 uv = u_cropOrigin + v_uv_rot * u_cropSize;
  vec3 c = texture(u_image, uv).rgb;

  // 2. Denoise — YCbCr NLM, in linear light right after loading and before any
  //    tonal expansion, so we filter the noise floor instead of amplifying it.
  if (u_denoiseFine > 0.0 || u_denoiseCoarse > 0.0 || u_denoiseChroma > 0.0) {
    c = applyDenoise(uv, c);
  }

  // 3. Exposure — a plain multiply in linear light. Doing this BEFORE the
  //    display transform is what makes highlight/shadow recovery work: a bright
  //    value pulled down here re-enters the [0,1] range before sRGB encoding,
  //    instead of being clipped in a baked preview.
  c *= u_exposure;

  // 4. White Balance (Temperature and Tint) in linear space
  if (u_temp != 0.0) {
    c.r *= (1.0 + u_temp);
    c.b *= (1.0 - u_temp);
  }
  if (u_tint != 0.0) {
    c.g *= (1.0 - u_tint);
    c.r *= (1.0 + u_tint * 0.5);
    c.b *= (1.0 + u_tint * 0.5);
  }

  // Channel mixer — recombine linear RGB through a 3x3 matrix (identity = no-op),
  // after white balance so it works on white-balanced colour. Each output channel
  // is a weighted sum of the input R/G/B.
  c = vec3(
    u_mixRR * c.r + u_mixRG * c.g + u_mixRB * c.b,
    u_mixGR * c.r + u_mixGG * c.g + u_mixGB * c.b,
    u_mixBR * c.r + u_mixBG * c.g + u_mixBB * c.b
  );

  // 5. Highlights / Shadows / Whites / Blacks — luminance-weighted tonal shaping
  //    in linear light, after white balance and before contrast. All weights use
  //    the same pre-adjustment luminance so the four controls stay independent.
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Highlights/shadows work the BROAD upper/lower ranges as exposure-like
  // multipliers (in stops): highlights ramp from middle grey (0.18) up to 1.0,
  // shadows ramp from 0.35 down to 0.0.
  float hlWeight = smoothstep(0.18, 1.0, clamp(lum, 0.18, 1.0));
  float sdWeight = 1.0 - smoothstep(0.0, 0.35, clamp(lum, 0.0, 0.35));
  c *= pow(2.0, u_highlights * hlWeight + u_shadows * sdWeight);

  // Whites/blacks act on the EXTREME ends so they complement rather than
  // duplicate highlights/shadows. Their masks use a PERCEPTUAL lightness (approx
  // gamma) rather than raw linear luminance: in linear light almost all real
  // content sits below 0.5, so a linear "whites" mask caught nothing (no visible
  // effect) while a linear "blacks" mask reached up into the midtones (washing
  // the image grey). Perceptual thresholds map to what the eye calls whites/blacks.
  float pl = pow(clamp(lum, 0.0, 1.0), 1.0 / 2.2);

  // Whites: gain weighted to the upper tones (perceptual 0.45→1.0, strongest near
  // white), setting the white point. The band reaches down to the midtones so the
  // control is responsive on ordinary images, not just blown highlights.
  float whiteWeight = smoothstep(0.45, 1.0, pl);
  c *= pow(2.0, u_whites * whiteWeight);

  // Blacks: additive lift/crush weighted to the lower tones (perceptual 0.45→0.0,
  // strongest near black), setting the black point. It fades to zero by the
  // midtones so it doesn't wash the whole image grey. +blacks lifts blacks toward
  // grey, -blacks deepens them (the standard convention). Additive because a
  // multiply near zero barely moves a near-black value.
  float blackWeight = 1.0 - smoothstep(0.0, 0.45, pl);
  c += u_blacks * blackWeight;

  // 6. Color adjustments (Saturation and Vibrance) in linear space
  if (u_saturation != 0.0 || u_vibrance != 0.0) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float max_val = max(c.r, max(c.g, c.b));
    float min_val = min(c.r, min(c.g, c.b));
    float sat_val = max_val - min_val;
    
    float vibrance_factor = u_vibrance;
    if (vibrance_factor >= 0.0) {
      vibrance_factor *= (1.0 - sat_val);
    }
    
    float total_sat = u_saturation + vibrance_factor;
    c = mix(vec3(l), c, max(0.0, 1.0 + total_sat));
  }

  // 7. Contrast — expand/compress the tonal range around middle grey. Values
  //    above 0.18 stretch up, below stretch down; the display transform's clamp
  //    handles anything that lands outside [0,1] (crushed shadows / clipped
  //    highlights). Applied in linear light, after exposure.
  c = (c - MIDDLE_GREY) * u_contrast + MIDDLE_GREY;

  // 8. Display transform — scene-linear → display. Either a plain sRGB encode or,
  //    when u_filmic is on, an ACES filmic curve (adds contrast + highlight
  //    rolloff). The last SCENE-referred step; the ops below are output-referred
  //    and intentionally run after it.
  vec3 srgb = (u_filmic > 0.5) ? filmicDisplay(c) : linearToSrgb(c);

  // Per-hue HSL mixer — adjust Hue/Saturation/Luminance for 8 colour bands, on
  // the display value (like the global luminance below). Each pixel's hue is
  // weighted toward nearby band centres (smooth falloff) so adjacent bands
  // cross-fade; the weighted adjustment is normalised by total weight. No-op
  // (and skips the HSL round-trip) when all 24 adjustments are zero.
  {
    // Skip the HSL round-trip entirely unless some band is adjusted.
    // (`active` is a reserved word in GLSL ES, hence `hslActive`.)
    float hslActive =
        abs(u_hslHueRed) + abs(u_hslSatRed) + abs(u_hslLumRed)
      + abs(u_hslHueOrange) + abs(u_hslSatOrange) + abs(u_hslLumOrange)
      + abs(u_hslHueYellow) + abs(u_hslSatYellow) + abs(u_hslLumYellow)
      + abs(u_hslHueGreen) + abs(u_hslSatGreen) + abs(u_hslLumGreen)
      + abs(u_hslHueAqua) + abs(u_hslSatAqua) + abs(u_hslLumAqua)
      + abs(u_hslHueBlue) + abs(u_hslSatBlue) + abs(u_hslLumBlue)
      + abs(u_hslHuePurple) + abs(u_hslSatPurple) + abs(u_hslLumPurple)
      + abs(u_hslHueMagenta) + abs(u_hslSatMagenta) + abs(u_hslLumMagenta);
    if (hslActive > 0.0) {
      vec3 hsl = rgb2hsl(srgb);
      float h = hsl.x;
      float wSum = 0.0, hueShift = 0.0, satAdj = 0.0, lumShift = 0.0;
      // Band centres on the hue circle (turns): red, orange, yellow, green,
      // aqua, blue, purple, magenta.
      accumBand(h, 0.0,     u_hslHueRed,     u_hslSatRed,     u_hslLumRed,     wSum, hueShift, satAdj, lumShift);
      accumBand(h, 0.08333, u_hslHueOrange,  u_hslSatOrange,  u_hslLumOrange,  wSum, hueShift, satAdj, lumShift);
      accumBand(h, 0.16667, u_hslHueYellow,  u_hslSatYellow,  u_hslLumYellow,  wSum, hueShift, satAdj, lumShift);
      accumBand(h, 0.33333, u_hslHueGreen,   u_hslSatGreen,   u_hslLumGreen,   wSum, hueShift, satAdj, lumShift);
      accumBand(h, 0.5,     u_hslHueAqua,    u_hslSatAqua,    u_hslLumAqua,    wSum, hueShift, satAdj, lumShift);
      accumBand(h, 0.66667, u_hslHueBlue,    u_hslSatBlue,    u_hslLumBlue,    wSum, hueShift, satAdj, lumShift);
      accumBand(h, 0.79167, u_hslHuePurple,  u_hslSatPurple,  u_hslLumPurple,  wSum, hueShift, satAdj, lumShift);
      accumBand(h, 0.875,   u_hslHueMagenta, u_hslSatMagenta, u_hslLumMagenta, wSum, hueShift, satAdj, lumShift);
      if (wSum > 0.0) {
        hueShift /= wSum;
        satAdj /= wSum;
        lumShift /= wSum;
        hsl.x = fract(hsl.x + hueShift);
        hsl.y = clamp(hsl.y * (1.0 + satAdj), 0.0, 1.0);
        hsl.z = clamp(hsl.z + lumShift, 0.0, 1.0);
        srgb = hsl2rgb(hsl);
      }
    }
  }

  // 9. Luminance — perceptual HSL lightness shift, applied on display-encoded
  //    values (after sRGB) so it behaves perceptually rather than in linear.
  if (u_luminance != 0.0) {
    vec3 hsl = rgb2hsl(srgb);
    hsl.z = clamp(hsl.z + u_luminance, 0.0, 1.0);
    srgb = hsl2rgb(hsl);
  }

  // 10. Film grain — added in output space so it reads uniformly regardless of
  //     scene exposure.
  if (u_grainStrength > 0.0) {
    srgb = applyGrain(uv, srgb);
  }

  // Focus peaking — a VIEW aid, never baked into export (the export renderer
  // leaves u_peaking at 0). Overlays PEAK_COLOR where the local luminance
  // gradient (i.e. in-focus sharpness) is high. Central differences on the
  // source texture's luma: cheap (4 taps) and only when enabled.
  if (u_peaking > 0.0) {
    vec2 texel = 1.0 / vec2(textureSize(u_image, 0));
    vec3 lw = vec3(0.299, 0.587, 0.114);
    float lL = dot(texture(u_image, uv - vec2(texel.x, 0.0)).rgb, lw);
    float lR = dot(texture(u_image, uv + vec2(texel.x, 0.0)).rgb, lw);
    float lU = dot(texture(u_image, uv - vec2(0.0, texel.y)).rgb, lw);
    float lD = dot(texture(u_image, uv + vec2(0.0, texel.y)).rgb, lw);
    float edge = length(vec2(lR - lL, lD - lU));
    float m = smoothstep(PEAK_LO, PEAK_HI, edge);
    srgb = mix(srgb, PEAK_COLOR, m);
  }

  fragColor = vec4(srgb, 1.0);
}
