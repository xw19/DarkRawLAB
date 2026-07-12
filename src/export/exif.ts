// EXIF writer for exported JPEGs.
//
// `canvas.toBlob()` returns a clean JPEG with no metadata, so the camera EXIF we
// decoded from the RAW is lost on export. This module rebuilds a minimal but
// standards-valid EXIF block from `RawMeta` and splices it back into the JPEG.
//
// We hand-write the TIFF/EXIF bytes instead of pulling in a dependency (piexifjs
// et al.) — CLAUDE.md keeps the dep count low, and the encoding is small and
// bounded once you know the layout. Everything here is pure (bytes in, bytes
// out) so it's unit-testable without a canvas or GPU.
//
// Layout of the APP1 payload we emit (all offsets relative to the "II" byte):
//   TIFF header (8) → IFD0 → IFD0 external data → Exif SubIFD → Exif ext. data
// IFD0 holds camera/software/orientation/date; the Exif SubIFD (pointed to by
// tag 0x8769) holds exposure/aperture/ISO/focal-length/lens. Entries within an
// IFD are sorted by tag ascending, as the TIFF spec requires.

import type { RawMeta } from "../worker/decode";

// EXIF/TIFF field types.
const T_ASCII = 2;
const T_SHORT = 3;
const T_LONG = 4;
const T_RATIONAL = 5;
const T_UNDEFINED = 7;

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Little-endian bytes of the value payload. ≤4 bytes ⇒ stored inline. */
  payload: number[];
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

function ascii(tag: number, s: string): Entry {
  // ASCII values are NUL-terminated; count includes the terminator.
  const bytes = [...s].map((c) => c.charCodeAt(0) & 0xff);
  bytes.push(0);
  return { tag, type: T_ASCII, count: bytes.length, payload: bytes };
}
function short(tag: number, n: number): Entry {
  return { tag, type: T_SHORT, count: 1, payload: u16le(n) };
}
function long(tag: number, n: number): Entry {
  return { tag, type: T_LONG, count: 1, payload: u32le(n) };
}
function rational(tag: number, num: number, den: number): Entry {
  return { tag, type: T_RATIONAL, count: 1, payload: [...u32le(num), ...u32le(den)] };
}
function undef(tag: number, bytes: number[]): Entry {
  return { tag, type: T_UNDEFINED, count: bytes.length, payload: bytes };
}

/** Approximate a positive float as a small integer rational (numerator/denominator). */
function toRational(x: number): [number, number] {
  if (x <= 0) return [0, 1];
  // Fast shutter speeds read naturally as 1/N; everything else as N/10.
  if (x < 1) return [1, Math.round(1 / x)];
  return [Math.round(x * 10), 10];
}

/** EXIF datetime format: "YYYY:MM:DD HH:MM:SS" in the Date's local components. */
function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Serialize one IFD plus its external data at absolute offset `ifdStart`.
 * Entries are emitted sorted by tag; payloads longer than 4 bytes are written to
 * the external data area (word-aligned) and referenced by offset.
 */
function serializeIfd(entries: Entry[], ifdStart: number): number[] {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const bodySize = 2 + 12 * sorted.length + 4; // count + entries + next-IFD ptr
  const dataStart = ifdStart + bodySize;

  const body: number[] = [];
  const ext: number[] = [];
  body.push(...u16le(sorted.length));

  for (const e of sorted) {
    body.push(...u16le(e.tag), ...u16le(e.type), ...u32le(e.count));
    if (e.payload.length <= 4) {
      // Inline value, right-padded to the full 4-byte value field.
      const v = [...e.payload];
      while (v.length < 4) v.push(0);
      body.push(...v);
    } else {
      body.push(...u32le(dataStart + ext.length));
      ext.push(...e.payload);
      if (ext.length % 2 !== 0) ext.push(0); // keep the data area word-aligned
    }
  }
  body.push(...u32le(0)); // no next IFD
  return [...body, ...ext];
}

/** Byte length of an IFD + its external data (needed to place the next IFD). */
function ifdSize(entries: Entry[]): number {
  return serializeIfd(entries, 0).length;
}

const EXIF_IFD_POINTER = 0x8769;

/**
 * Build the TIFF/EXIF block (starting at the "II" byte order marker) for `meta`.
 * Returns the raw bytes to embed in a JPEG APP1 segment after the "Exif\0\0" id.
 */
export function buildExifTiff(meta: RawMeta): Uint8Array {
  const ifd0: Entry[] = [];
  if (meta.make) ifd0.push(ascii(0x010f, meta.make));
  if (meta.model) ifd0.push(ascii(0x0110, meta.model));
  ifd0.push(short(0x0112, 1)); // Orientation: edits (incl. rotation) are baked in
  ifd0.push(ascii(0x0131, "DarkRaw Lab")); // Software
  if (meta.timestamp) ifd0.push(ascii(0x0132, formatDateTime(meta.timestamp)));

  const exif: Entry[] = [];
  exif.push(undef(0x9000, [0x30, 0x32, 0x33, 0x30])); // ExifVersion "0230"
  if (meta.shutter > 0) {
    const [n, d] = toRational(meta.shutter);
    exif.push(rational(0x829a, n, d)); // ExposureTime
  }
  if (meta.aperture > 0) {
    const [n, d] = toRational(meta.aperture);
    exif.push(rational(0x829d, n, d)); // FNumber
  }
  if (meta.isoSpeed > 0) exif.push(short(0x8827, meta.isoSpeed)); // ISOSpeedRatings
  if (meta.timestamp) exif.push(ascii(0x9003, formatDateTime(meta.timestamp))); // DateTimeOriginal
  if (meta.focalLen > 0) {
    const [n, d] = toRational(meta.focalLen);
    exif.push(rational(0x920a, n, d)); // FocalLength
  }
  if (meta.lens) exif.push(ascii(0xa434, meta.lens)); // LensModel

  // IFD0 always carries the Exif SubIFD pointer; its target sits right after
  // IFD0 (and IFD0's external data) in the file.
  const ifd0WithPointer = [...ifd0, long(EXIF_IFD_POINTER, 0)];
  const exifOffset = 8 + ifdSize(ifd0WithPointer);
  const ifd0Final = [...ifd0, long(EXIF_IFD_POINTER, exifOffset)];

  const header = [0x49, 0x49, 0x2a, 0x00, ...u32le(8)]; // "II", magic 42, IFD0 @ 8
  const ifd0Bytes = serializeIfd(ifd0Final, 8);
  const exifBytes = serializeIfd(exif, exifOffset);

  return new Uint8Array([...header, ...ifd0Bytes, ...exifBytes]);
}

/**
 * Return a copy of `jpeg` with an EXIF APP1 segment inserted right after the SOI
 * marker. If the bytes aren't a JPEG (no FF D8 start), returns them unchanged.
 */
export function embedExifIntoJpeg(
  jpeg: Uint8Array<ArrayBuffer>,
  meta: RawMeta,
): Uint8Array<ArrayBuffer> {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;

  const tiff = buildExifTiff(meta);
  const id = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const segLen = 2 + id.length + tiff.length; // length field counts itself
  if (segLen > 0xffff) return jpeg; // APP1 too large — shouldn't happen for our fields

  const app1 = new Uint8Array(2 + segLen);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (segLen >> 8) & 0xff; // JPEG segment lengths are big-endian
  app1[3] = segLen & 0xff;
  app1.set(id, 4);
  app1.set(tiff, 4 + id.length);

  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0); // SOI
  out.set(app1, 2); // APP1 right after SOI
  out.set(jpeg.subarray(2), 2 + app1.length); // rest of the JPEG
  return out;
}
