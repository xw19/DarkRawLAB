import { describe, it, expect } from "vitest";
import { formatShutter, formatDate } from "./exif";

describe("formatShutter", () => {
  it("returns null for missing or non-positive times", () => {
    expect(formatShutter(0)).toBeNull();
    expect(formatShutter(-1)).toBeNull();
  });

  it("formats sub-second exposures as a reciprocal", () => {
    expect(formatShutter(1 / 250)).toBe("1/250 s");
    expect(formatShutter(1 / 125)).toBe("1/125 s");
    expect(formatShutter(0.5)).toBe("1/2 s");
  });

  it("formats one-second-and-longer exposures in seconds", () => {
    expect(formatShutter(1)).toBe("1 s"); // trailing .0 is trimmed
    expect(formatShutter(2)).toBe("2 s");
    expect(formatShutter(1.5)).toBe("1.5 s");
  });
});

describe("formatDate", () => {
  it("returns null for null, the epoch, and invalid dates", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate(new Date(0))).toBeNull();
    expect(formatDate(new Date("not a date"))).toBeNull();
  });

  it("formats a real capture date to a non-empty string", () => {
    const out = formatDate(new Date("2021-06-15T12:00:00Z"));
    expect(out).not.toBeNull();
    expect(out).toContain("2021");
  });
});
