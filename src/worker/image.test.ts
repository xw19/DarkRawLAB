import { describe, it, expect } from "vitest";
import { srgbToLinear, isRasterImageFile } from "./image";

describe("srgbToLinear", () => {
  it("maps the endpoints 0 and 255 to 0 and 1", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 6);
  });

  it("uses the linear segment below the sRGB breakpoint", () => {
    // 10/255 ≈ 0.0392 < 0.04045, so it divides by 12.92 (no pow()).
    expect(srgbToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 6);
  });

  it("puts sRGB mid-grey (~0.5) near linear 0.214", () => {
    // Standard sRGB: 0.5 encoded ≈ 0.214 linear — the check that this is the
    // real EOTF and not a plain gamma-2.2 approximation.
    expect(srgbToLinear(128)).toBeCloseTo(0.2158, 3);
  });

  it("is monotonic across the range", () => {
    let prev = -1;
    for (let i = 0; i <= 255; i++) {
      const v = srgbToLinear(i);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe("isRasterImageFile", () => {
  const asFile = (name: string, type = "") => new File([new Uint8Array(1)], name, { type });

  it("accepts JPEG/PNG by extension (any case)", () => {
    expect(isRasterImageFile(asFile("photo.jpg"))).toBe(true);
    expect(isRasterImageFile(asFile("photo.JPEG"))).toBe(true);
    expect(isRasterImageFile(asFile("shot.PNG"))).toBe(true);
  });

  it("accepts JPEG/PNG by MIME type even with an odd name", () => {
    expect(isRasterImageFile(asFile("noext", "image/jpeg"))).toBe(true);
    expect(isRasterImageFile(asFile("noext", "image/png"))).toBe(true);
  });

  it("routes camera RAW extensions to the LibRaw path", () => {
    for (const name of ["DSC1.ARW", "IMG.CR3", "pic.NEF", "x.dng", "y.rw2"]) {
      expect(isRasterImageFile(asFile(name))).toBe(false);
    }
  });
});
