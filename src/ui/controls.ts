// Slider UI. Reads the two range inputs, formats their value labels, and hands
// a fresh EditState to the caller on every input event. It owns no state beyond
// the DOM elements themselves — the source of truth is the inputs' values.

import type { EditState } from "../editor/pipeline";

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`Missing slider input #${id}`);
  }
  return el;
}

function label(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing label #${id}`);
  return el;
}

/**
 * Wire the exposure/contrast sliders. `onChange` fires on every move with the
 * current full EditState; it also fires once at init so labels and the initial
 * render agree with the slider positions.
 */
export function initControls(onChange: (state: EditState) => void): void {
  const exposure = input("exposure");
  const contrast = input("contrast");
  const exposureVal = label("exposure-val");
  const contrastVal = label("contrast-val");

  function read(): EditState {
    return {
      exposureEv: Number(exposure.value),
      contrast: Number(contrast.value),
    };
  }

  function update(): void {
    const state = read();
    // Signed, fixed formatting so the numbers don't jitter in width as you drag.
    exposureVal.textContent = `${state.exposureEv > 0 ? "+" : ""}${state.exposureEv.toFixed(1)} EV`;
    contrastVal.textContent = `${state.contrast > 0 ? "+" : ""}${state.contrast}`;
    onChange(state);
  }

  exposure.addEventListener("input", update);
  contrast.addEventListener("input", update);
  update();
}
