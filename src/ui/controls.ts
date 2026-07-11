// Slider UI. Wires every adjustment control declared in the SLIDERS table and
// hands a fresh EditState to the caller on each input event. It owns no state
// beyond the DOM elements — the source of truth is the inputs' values, and which
// controls exist is the source of truth in editor/sliders.ts.

import type { EditState } from "../editor/pipeline";
import { SLIDERS } from "../editor/sliders";

export interface ControlsApi {
  /** Re-read the inputs, refresh labels, and fire onChange. Call after setting
   *  input values programmatically instead of dispatching a synthetic event. */
  refresh(): void;
  /** Reset every control to its default value, then refresh. */
  reset(): void;
  /** Set every control from an EditState, then refresh (presets / automation). */
  setState(state: EditState): void;
}

function requireInput(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`Missing slider input #${id}`);
  }
  return el;
}

function requireLabel(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing label #${id}`);
  return el;
}

/**
 * Wire every adjustment slider. `onChange` fires on each move with the current
 * full EditState; it also fires once at init so labels and the initial render
 * agree with the slider positions. Returns an API for programmatic refresh/reset.
 */
export function initControls(onChange: (state: EditState) => void): ControlsApi {
  // Resolve each slider's input (and label, if it has a readout) exactly once.
  const bound = SLIDERS.map((spec) => ({
    spec,
    input: requireInput(spec.inputId),
    label: spec.labelId ? requireLabel(spec.labelId) : null,
  }));

  function read(): EditState {
    const state = {} as Record<keyof EditState, number>;
    for (const { spec, input } of bound) {
      state[spec.key] = Number(input.value);
    }
    return state as EditState;
  }

  function update(): void {
    const state = read();
    for (const { spec, label } of bound) {
      if (label && spec.format) label.textContent = spec.format(state[spec.key]);
    }
    onChange(state);
  }

  for (const { input } of bound) {
    input.addEventListener("input", update);
  }
  update();

  return {
    refresh: update,
    reset() {
      for (const { spec, input } of bound) {
        input.value = String(spec.default);
      }
      update();
    },
    setState(state) {
      // Range inputs clamp out-of-bounds values, so read-back stays valid.
      for (const { spec, input } of bound) {
        input.value = String(state[spec.key]);
      }
      update();
    },
  };
}
