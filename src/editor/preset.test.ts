import { describe, it, expect } from "vitest";
import { serializePreset, parsePreset, PRESET_VERSION } from "./preset";
import { defaultEditState } from "./pipeline";
import { fullCrop } from "./crop";

describe("preset serialize/parse", () => {
  it("round-trips the default state and full crop", () => {
    const p = parsePreset(serializePreset(defaultEditState, fullCrop));
    expect(p.version).toBe(PRESET_VERSION);
    expect(p.editState).toEqual(defaultEditState);
    expect(p.crop).toEqual(fullCrop);
  });

  it("round-trips a non-trivial edit", () => {
    const edit = { ...defaultEditState, exposureEv: 1.5, hslSatBlue: -40, mixRG: 20 };
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    const p = parsePreset(serializePreset(edit, crop));
    expect(p.editState).toEqual(edit);
    expect(p.crop).toEqual(crop);
  });

  it("fills missing edit fields from defaults and ignores unknown keys", () => {
    const p = parsePreset(JSON.stringify({ editState: { exposureEv: 2, bogus: 9 } }));
    expect(p.editState.exposureEv).toBe(2);
    expect(p.editState.contrast).toBe(defaultEditState.contrast);
    expect("bogus" in p.editState).toBe(false);
  });

  it("clamps an out-of-bounds crop into the image", () => {
    const p = parsePreset(JSON.stringify({ crop: { x: -1, y: 0.5, w: 5, h: 5 } }));
    expect(p.crop.x).toBe(0);
    expect(p.crop.y).toBeCloseTo(0.5);
    expect(p.crop.w).toBeLessThanOrEqual(1);
    expect(p.crop.y + p.crop.h).toBeLessThanOrEqual(1.0001);
  });

  it("throws on malformed JSON", () => {
    expect(() => parsePreset("{not json")).toThrow();
  });
});
