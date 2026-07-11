import { describe, it, expect } from "vitest";
import {
  fullCrop,
  moveCrop,
  resizeCrop,
  resizeCropLocked,
  getCenteredCrop,
  rotateRect,
  unrotateRect,
} from "./crop";
import type { CropRect } from "./crop";

const MIN_SIZE = 0.05; // must match crop.ts

function expectRect(actual: CropRect, expected: CropRect): void {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.w).toBeCloseTo(expected.w);
  expect(actual.h).toBeCloseTo(expected.h);
}

describe("moveCrop", () => {
  const half: CropRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  it("translates within the image without changing size", () => {
    expectRect(moveCrop(half, 0.1, -0.1), { x: 0.35, y: 0.15, w: 0.5, h: 0.5 });
  });

  it("clamps so the rect stays inside the right/bottom edges", () => {
    // Pushing far past the edge pins x/y at 1 - w and 1 - h.
    expectRect(moveCrop(half, 1, 1), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("clamps so the rect stays inside the left/top edges", () => {
    expectRect(moveCrop(half, -1, -1), { x: 0, y: 0, w: 0.5, h: 0.5 });
  });
});

describe("resizeCrop", () => {
  it("drags the SE corner, holding NW fixed", () => {
    expectRect(resizeCrop(fullCrop, "se", 0.5, 0.6), { x: 0, y: 0, w: 0.5, h: 0.6 });
  });

  it("drags the NW corner, holding SE fixed", () => {
    expectRect(resizeCrop(fullCrop, "nw", 0.4, 0.3), { x: 0.4, y: 0.3, w: 0.6, h: 0.7 });
  });

  it("clamps the pointer to the image bounds", () => {
    // px/py outside [0,1] are clamped, so dragging SE past the corner is a no-op.
    expectRect(resizeCrop(fullCrop, "se", 2, 2), fullCrop);
  });

  it("never lets an edge collapse below MIN_SIZE", () => {
    const r = resizeCrop(fullCrop, "se", 0.01, 0.01);
    expect(r.w).toBeCloseTo(MIN_SIZE);
    expect(r.h).toBeCloseTo(MIN_SIZE);
  });
});

describe("rotateRect", () => {
  const r: CropRect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

  it("is the identity at r = 0", () => {
    expectRect(rotateRect(r, 0), r);
  });

  it("swaps width/height for the 90° and 270° steps", () => {
    expect(rotateRect(r, 1).w).toBeCloseTo(r.h);
    expect(rotateRect(r, 1).h).toBeCloseTo(r.w);
    expect(rotateRect(r, 3).w).toBeCloseTo(r.h);
    expect(rotateRect(r, 3).h).toBeCloseTo(r.w);
  });

  it("keeps width/height for the 180° step", () => {
    expectRect(rotateRect(r, 2), { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h });
  });

  it("normalises out-of-range steps modulo 4", () => {
    expectRect(rotateRect(r, 5), rotateRect(r, 1));
    expectRect(rotateRect(r, -1), rotateRect(r, 3));
  });

  it("four 90° rotations return to the original", () => {
    let c = r;
    for (let i = 0; i < 4; i++) c = rotateRect(c, 1);
    expectRect(c, r);
  });
});

describe("unrotateRect", () => {
  const rects: CropRect[] = [
    { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0.5, y: 0.1, w: 0.4, h: 0.6 },
  ];

  it("inverts rotateRect for every 90° step", () => {
    for (const rect of rects) {
      for (let step = 0; step < 4; step++) {
        expectRect(unrotateRect(rotateRect(rect, step), step), rect);
      }
    }
  });
});

describe("resizeCropLocked", () => {
  it("maintains aspect ratio when resizing SE corner", () => {
    // 1:1 aspect ratio on a 1.5 aspect ratio image -> R = 1 / 1.5 = 2/3
    const c: CropRect = { x: 0.1, y: 0.1, w: 0.4, h: 0.6 }; // w/h = 0.4 / 0.6 = 2/3
    const resized = resizeCropLocked(c, "se", 0.7, 0.7, 2/3);
    
    // R is locked to 2/3, so w must be h * 2/3
    expect(resized.w / resized.h).toBeCloseTo(2/3);
    expect(resized.x).toBe(0.1);
    expect(resized.y).toBe(0.1);
  });

  it("maintains aspect ratio when resizing NW corner", () => {
    const c: CropRect = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }; // R = 1
    const resized = resizeCropLocked(c, "nw", 0.1, 0.15, 1.0);
    expect(resized.w).toBeCloseTo(resized.h);
    expect(resized.x + resized.w).toBeCloseTo(0.6);
    expect(resized.y + resized.h).toBeCloseTo(0.6);
  });
});

describe("getCenteredCrop", () => {
  it("centers landscape target on landscape image correctly", () => {
    const crop = getCenteredCrop(1.5, 1.5); // same aspect
    expectRect(crop, { x: 0, y: 0, w: 1, h: 1 });
  });

  it("centers square target on landscape image correctly", () => {
    const crop = getCenteredCrop(1.5, 1.0); // 1:1 on 3:2 image
    expectRect(crop, { x: 0.166666666, y: 0.0, w: 0.666666666, h: 1.0 });
  });

  it("centers wider target on landscape image correctly", () => {
    const crop = getCenteredCrop(1.5, 2.0); // 2:1 on 3:2 image
    expectRect(crop, { x: 0.0, y: 0.125, w: 1.0, h: 0.75 });
  });
});
