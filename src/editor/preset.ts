// Preset (edit recipe) serialization — a portable JSON representation of an edit.
//
// Pure: no DOM, no GPU. EditState + crop already capture the full editable state,
// so a preset is just those two plus a version tag. serialize() round-trips
// losslessly; parse() is defensive — it merges onto defaults and clamps the crop —
// so hand-written or agent-produced presets can't drive the editor into an invalid
// state. (Out-of-range slider values are left as-is here; the range inputs clamp
// them when applied.) This is the data model the automation hook and a future MCP
// server exchange (see docs/mcp-design.md).

import { defaultEditState } from "./pipeline";
import type { EditState } from "./pipeline";
import { SLIDERS } from "./sliders";
import { fullCrop } from "./crop";
import type { CropRect } from "./crop";

export const PRESET_VERSION = 1;

export interface Preset {
  version: number;
  editState: EditState;
  crop: CropRect;
}

/** Serialize the current edit + crop to pretty JSON. */
export function serializePreset(editState: EditState, crop: CropRect): string {
  const preset: Preset = { version: PRESET_VERSION, editState, crop };
  return JSON.stringify(preset, null, 2);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Read a crop from unknown input, clamped to a valid rectangle inside [0,1]. */
function readCrop(raw: unknown): CropRect {
  const o = (raw ?? {}) as Record<string, unknown>;
  const x = clamp01(num(o.x, fullCrop.x));
  const y = clamp01(num(o.y, fullCrop.y));
  // Keep the rect inside the image from its origin, and never let it collapse.
  const w = Math.min(1 - x, Math.max(0.01, num(o.w, fullCrop.w)));
  const h = Math.min(1 - y, Math.max(0.01, num(o.h, fullCrop.h)));
  return { x, y, w, h };
}

/** Read an edit state: start from defaults, override known numeric keys only. */
function readEditState(raw: unknown): EditState {
  const o = (raw ?? {}) as Record<string, unknown>;
  const state = { ...defaultEditState } as Record<keyof EditState, number>;
  for (const spec of SLIDERS) {
    if (spec.key in o) state[spec.key] = num(o[spec.key], state[spec.key]);
  }
  return state as EditState;
}

/**
 * Parse + validate preset JSON. Throws only on malformed JSON; otherwise always
 * returns a usable Preset (missing fields → defaults, invalid crop → clamped,
 * unknown keys ignored).
 */
export function parsePreset(json: string): Preset {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return {
    version: num(raw.version, PRESET_VERSION),
    editState: readEditState(raw.editState),
    crop: readCrop(raw.crop),
  };
}
