import { describe, it, expect } from "vitest";
import { defaultEditState, toUniforms } from "./pipeline";
import type { EditState } from "./pipeline";

/** Build an EditState from defaults with a few overrides. */
function state(overrides: Partial<EditState>): EditState {
  return { ...defaultEditState, ...overrides };
}

describe("SLIDERS-derived state", () => {
  // defaultEditState and toUniforms are generated from the SLIDERS table and
  // cast to their interfaces, so a dropped/misnamed descriptor wouldn't be a
  // compile error — these guard completeness at runtime.
  const EDIT_KEYS: (keyof EditState)[] = [
    "exposureEv", "contrast", "highlights", "shadows", "whites", "blacks",
    "angleDeg", "rotation90",
    "temp", "tint", "saturation", "vibrance", "luminance",
    "mixRR", "mixRG", "mixRB", "mixGR", "mixGG", "mixGB", "mixBR", "mixBG", "mixBB",
    "hslHueRed", "hslSatRed", "hslLumRed", "hslHueOrange", "hslSatOrange", "hslLumOrange",
    "hslHueYellow", "hslSatYellow", "hslLumYellow", "hslHueGreen", "hslSatGreen", "hslLumGreen",
    "hslHueAqua", "hslSatAqua", "hslLumAqua", "hslHueBlue", "hslSatBlue", "hslLumBlue",
    "hslHuePurple", "hslSatPurple", "hslLumPurple", "hslHueMagenta", "hslSatMagenta", "hslLumMagenta",
    "denoiseFine", "denoiseCoarse", "denoiseChroma", "grainStrength", "grainSize",
  ];

  it("gives defaultEditState exactly the EditState fields", () => {
    expect(Object.keys(defaultEditState).sort()).toEqual([...EDIT_KEYS].sort());
  });

  it("maps every field to a finite uniform (no missing descriptor → no NaN)", () => {
    for (const value of Object.values(toUniforms(defaultEditState))) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("toUniforms", () => {
  it("maps the default (no-op) edit state to identity uniforms", () => {
    const u = toUniforms(defaultEditState);
    expect(u.u_exposure).toBe(1); // 2^0
    expect(u.u_contrast).toBe(1); // 2^0
    expect(u.u_highlights).toBe(0);
    expect(u.u_shadows).toBe(0);
    expect(u.u_angle).toBe(0);
    expect(u.u_rotation90).toBe(0);
    expect(u.u_temp).toBe(0);
    expect(u.u_tint).toBe(0);
    expect(u.u_saturation).toBe(0);
    expect(u.u_vibrance).toBe(0);
    expect(u.u_luminance).toBe(0);
    expect(u.u_denoiseFine).toBe(0);
    expect(u.u_denoiseCoarse).toBe(0);
    expect(u.u_denoiseChroma).toBe(0);
    expect(u.u_grainStrength).toBe(0);
    expect(u.u_grainSize).toBe(2); // default grain size, passed through
  });

  describe("exposure (2^EV linear multiply)", () => {
    it("+1 EV doubles linear light", () => {
      expect(toUniforms(state({ exposureEv: 1 })).u_exposure).toBeCloseTo(2);
    });
    it("-1 EV halves linear light", () => {
      expect(toUniforms(state({ exposureEv: -1 })).u_exposure).toBeCloseTo(0.5);
    });
  });

  describe("contrast (2^(c/100), symmetric in log space)", () => {
    it("+100 → factor 2", () => {
      expect(toUniforms(state({ contrast: 100 })).u_contrast).toBeCloseTo(2);
    });
    it("-100 → factor 0.5", () => {
      expect(toUniforms(state({ contrast: -100 })).u_contrast).toBeCloseTo(0.5);
    });
    it("equal-and-opposite moves are reciprocals (undo each other)", () => {
      const up = toUniforms(state({ contrast: 40 })).u_contrast;
      const down = toUniforms(state({ contrast: -40 })).u_contrast;
      expect(up * down).toBeCloseTo(1);
    });
  });

  describe("highlights / shadows (±100 → ±1.5 stops)", () => {
    it("maps the slider extremes to ±1.5", () => {
      expect(toUniforms(state({ highlights: 100 })).u_highlights).toBeCloseTo(1.5);
      expect(toUniforms(state({ highlights: -100 })).u_highlights).toBeCloseTo(-1.5);
      expect(toUniforms(state({ shadows: 100 })).u_shadows).toBeCloseTo(1.5);
      expect(toUniforms(state({ shadows: -100 })).u_shadows).toBeCloseTo(-1.5);
    });
  });

  describe("whites / blacks", () => {
    it("maps whites to ±1 stop and blacks to a ±0.05 linear offset", () => {
      expect(toUniforms(state({ whites: 100 })).u_whites).toBeCloseTo(1);
      expect(toUniforms(state({ whites: -100 })).u_whites).toBeCloseTo(-1);
      expect(toUniforms(state({ blacks: 100 })).u_blacks).toBeCloseTo(0.05);
      expect(toUniforms(state({ blacks: -100 })).u_blacks).toBeCloseTo(-0.05);
    });
  });

  describe("rotation", () => {
    it("converts straighten degrees to radians", () => {
      expect(toUniforms(state({ angleDeg: 45 })).u_angle).toBeCloseTo(Math.PI / 4);
      expect(toUniforms(state({ angleDeg: -45 })).u_angle).toBeCloseTo(-Math.PI / 4);
    });
    it("passes the discrete 90° step through unchanged", () => {
      expect(toUniforms(state({ rotation90: 3 })).u_rotation90).toBe(3);
    });
  });

  describe("colour and denoise ranges", () => {
    it("scales temp/tint/luminance to ±0.5", () => {
      expect(toUniforms(state({ temp: 100 })).u_temp).toBeCloseTo(0.5);
      expect(toUniforms(state({ tint: -100 })).u_tint).toBeCloseTo(-0.5);
      expect(toUniforms(state({ luminance: 100 })).u_luminance).toBeCloseTo(0.5);
    });
    it("scales saturation/vibrance to ±1.0", () => {
      expect(toUniforms(state({ saturation: 100 })).u_saturation).toBeCloseTo(1);
      expect(toUniforms(state({ vibrance: -100 })).u_vibrance).toBeCloseTo(-1);
    });
    it("scales denoise bands to their per-band ceilings", () => {
      expect(toUniforms(state({ denoiseFine: 100 })).u_denoiseFine).toBeCloseTo(0.15);
      expect(toUniforms(state({ denoiseCoarse: 100 })).u_denoiseCoarse).toBeCloseTo(0.2);
      expect(toUniforms(state({ denoiseChroma: 100 })).u_denoiseChroma).toBeCloseTo(0.25);
    });
    it("scales grain strength to 0..0.10 and passes grain size through", () => {
      expect(toUniforms(state({ grainStrength: 100 })).u_grainStrength).toBeCloseTo(0.1);
      expect(toUniforms(state({ grainSize: 7 })).u_grainSize).toBe(7);
    });
  });
});
