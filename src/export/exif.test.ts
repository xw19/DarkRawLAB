import { describe, it, expect } from "vitest";
import { buildExifTiff, embedExifIntoJpeg } from "./exif";
import type { RawMeta } from "../worker/decode";

const meta: RawMeta = {
  make: "SONY",
  model: "ILCE-7M3",
  lens: "FE 24-70mm F2.8 GM",
  isoSpeed: 400,
  shutter: 1 / 200,
  aperture: 2.8,
  focalLen: 50,
  timestamp: new Date(2026, 6, 11, 16, 25, 16),
  width: 6000,
  height: 4000,
};

// Minimal little-endian TIFF reader, enough to assert what we wrote.
function readTiff(tiff: Uint8Array) {
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  expect(String.fromCharCode(tiff[0]!, tiff[1]!)).toBe("II");
  expect(dv.getUint16(2, true)).toBe(0x2a);
  const entries: Record<number, { type: number; count: number; value: number; off: number }> = {};
  function readIfd(off: number) {
    const n = dv.getUint16(off, true);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = dv.getUint16(e, true);
      entries[tag] = {
        type: dv.getUint16(e + 2, true),
        count: dv.getUint32(e + 4, true),
        value: dv.getUint32(e + 8, true),
        off: e + 8,
      };
    }
  }
  readIfd(dv.getUint32(4, true));
  if (entries[0x8769]) readIfd(entries[0x8769]!.value); // Exif SubIFD
  return { dv, entries };
}

function asciiAt(dv: DataView, tiff: Uint8Array, off: number, count: number): string {
  const start = count <= 4 ? off : dv.getUint32(off, true);
  let s = "";
  for (let i = 0; i < count - 1; i++) s += String.fromCharCode(tiff[start + i]!);
  return s;
}

describe("buildExifTiff", () => {
  it("encodes the core camera fields into a valid TIFF structure", () => {
    const tiff = buildExifTiff(meta);
    const { dv, entries } = readTiff(tiff);

    expect(asciiAt(dv, tiff, entries[0x010f]!.off, entries[0x010f]!.count)).toBe("SONY");
    expect(asciiAt(dv, tiff, entries[0x0110]!.off, entries[0x0110]!.count)).toBe("ILCE-7M3");
    expect(asciiAt(dv, tiff, entries[0x0132]!.off, entries[0x0132]!.count)).toBe("2026:07:11 16:25:16");
    expect(entries[0x0112]!.value & 0xffff).toBe(1); // Orientation baked to 1
    expect(entries[0x8827]!.value & 0xffff).toBe(400); // ISO (SHORT, inline)
    expect(asciiAt(dv, tiff, entries[0xa434]!.off, entries[0xa434]!.count)).toBe("FE 24-70mm F2.8 GM");

    // ExposureTime 1/200 stored as a rational at its offset.
    const eOff = entries[0x829a]!.value;
    expect(dv.getUint32(eOff, true)).toBe(1);
    expect(dv.getUint32(eOff + 4, true)).toBe(200);
    // FNumber 2.8 → 28/10.
    const fOff = entries[0x829d]!.value;
    expect(dv.getUint32(fOff, true)).toBe(28);
    expect(dv.getUint32(fOff + 4, true)).toBe(10);
  });

  it("omits fields that are missing or zero", () => {
    const sparse: RawMeta = {
      ...meta,
      lens: null,
      isoSpeed: 0,
      shutter: 0,
      aperture: 0,
      focalLen: 0,
      timestamp: null,
    };
    const { entries } = readTiff(buildExifTiff(sparse));
    expect(entries[0xa434]).toBeUndefined(); // no lens
    expect(entries[0x8827]).toBeUndefined(); // no ISO
    expect(entries[0x829a]).toBeUndefined(); // no exposure time
    expect(entries[0x010f]).toBeDefined(); // make still present
  });
});

describe("embedExifIntoJpeg", () => {
  it("inserts an APP1 EXIF segment right after the SOI marker", () => {
    // Minimal fake JPEG: SOI + APP0 stub + EOI.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
    const out = embedExifIntoJpeg(jpeg, meta);

    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8); // SOI preserved
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe1); // APP1 immediately after SOI
    const segLen = (out[4]! << 8) | out[5]!; // big-endian
    expect(String.fromCharCode(out[6]!, out[7]!, out[8]!, out[9]!)).toBe("Exif");
    // Original body (APP0…EOI) still trails the inserted segment.
    expect([...out.subarray(2 + 2 + segLen)]).toEqual([0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
  });

  it("returns non-JPEG input unchanged", () => {
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG signature start
    expect(embedExifIntoJpeg(notJpeg, meta)).toBe(notJpeg);
  });
});
