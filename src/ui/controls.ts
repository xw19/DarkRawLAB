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
let audioCtx: AudioContext | null = null;

function playTickSound(): void {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    // High frequency sine wave decay makes a clean "tick" sound
    osc.type = "sine";
    osc.frequency.setValueAtTime(1600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.012);

    gain.gain.setValueAtTime(0.02, audioCtx.currentTime); // Subtle and quiet
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.012);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.012);
  } catch (err) {
    // Ignore audio context errors
  }
}

function triggerFeedback(isReset = false): void {
  playTickSound();
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    // Android/Chrome supports vibrate. 15ms-30ms double tap for reset, 8ms single for tick.
    navigator.vibrate(isReset ? [15, 30, 15] : 8);
  }
}

function updateSliderBackground(input: HTMLInputElement, def: number): void {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value) || 0;
  const range = max - min;
  if (range <= 0) return;

  const defPct = ((def - min) / range) * 100;
  const valPct = ((val - min) / range) * 100;

  let gradient = "";
  if (valPct >= defPct) {
    gradient = `linear-gradient(to right, #2a2a2a 0%, #2a2a2a calc(${defPct}% - 1px), rgba(255,255,255,0.45) calc(${defPct}% - 1px), rgba(255,255,255,0.45) calc(${defPct}% + 1px), var(--yellow) calc(${defPct}% + 1px), var(--yellow) ${valPct}%, #2a2a2a ${valPct}%, #2a2a2a 100%)`;
  } else {
    gradient = `linear-gradient(to right, #2a2a2a 0%, #2a2a2a ${valPct}%, var(--yellow) ${valPct}%, var(--yellow) calc(${defPct}% - 1px), rgba(255,255,255,0.45) calc(${defPct}% - 1px), rgba(255,255,255,0.45) calc(${defPct}% + 1px), #2a2a2a calc(${defPct}% + 1px), #2a2a2a 100%)`;
  }

  input.style.background = gradient;
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

  const prevValues = new Map<string, number>();

  function read(): EditState {
    const state = {} as Record<keyof EditState, number>;
    for (const { spec, input } of bound) {
      state[spec.key] = Number(input.value);
    }
    return state as EditState;
  }

  function update(): void {
    const state = read();
    for (const { spec, label, input } of bound) {
      const val = state[spec.key];
      if (label && spec.format) {
        if (!label.querySelector("input")) {
          label.textContent = spec.format(val);
        }
      }
      if (input.type === "range") {
        updateSliderBackground(input, spec.default);
        
        // Trigger haptic reset feedback when user snaps directly to neutral/default during drag
        const prev = prevValues.get(spec.key);
        if (prev !== undefined && prev !== val && val === spec.default) {
          triggerFeedback(true);
        }
        prevValues.set(spec.key, val);
      }
    }
    onChange(state);
  }

  for (const { spec, input, label } of bound) {
    input.addEventListener("input", update);

    if (input.type === "range") {
      const resetToDefault = () => {
        const val = Number(input.value) || 0;
        if (val !== spec.default) {
          input.value = String(spec.default);
          update();
          triggerFeedback(true);
        }
      };

      // 1. Double click / double tap to reset
      input.addEventListener("dblclick", resetToDefault);

      let lastTap = 0;
      input.addEventListener("touchstart", (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < 300 && tapLength > 0) {
          e.preventDefault();
          resetToDefault();
        }
        lastTap = currentTime;
      });

      if (label) {
        label.addEventListener("dblclick", resetToDefault);

        let lastLabelTap = 0;
        label.addEventListener("touchstart", (e) => {
          const currentTime = new Date().getTime();
          const tapLength = currentTime - lastLabelTap;
          if (tapLength < 300 && tapLength > 0) {
            e.preventDefault();
            resetToDefault();
          }
          lastLabelTap = currentTime;
        });

        // 2. Click to edit value inline
        label.addEventListener("click", () => {
          if (label.querySelector("input")) return;

          const rawValue = Number(input.value) || 0;
          const editInput = document.createElement("input");
          editInput.type = "number";
          editInput.value = String(rawValue);
          editInput.step = input.step;
          editInput.min = input.min;
          editInput.max = input.max;
          editInput.className = "slider-value-edit";

          const originalText = label.textContent;
          label.textContent = "";
          label.appendChild(editInput);
          editInput.focus();
          editInput.select();

          let committed = false;
          function commit() {
            if (committed) return;
            committed = true;
            let newValue = Number(editInput.value);
            if (isNaN(newValue)) {
              newValue = rawValue;
            } else {
              const min = Number(input.min) || 0;
              const max = Number(input.max) || 100;
              newValue = Math.max(min, Math.min(max, newValue));
            }
            const step = Number(input.step) || 1;
            const decimals = (String(step).split(".")[1] || "").length;
            input.value = newValue.toFixed(decimals);
            update();
          }

          editInput.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              commit();
            } else if (ev.key === "Escape") {
              committed = true;
              label.textContent = originalText;
            }
          });

          editInput.addEventListener("blur", () => {
            commit();
          });
        });
      }

      // 3. Dynamic +/- buttons
      const decBtn = document.createElement("button");
      decBtn.className = "slider-btn slider-dec";
      decBtn.type = "button";
      decBtn.innerHTML = "&minus;";
      decBtn.tabIndex = -1;

      const incBtn = document.createElement("button");
      incBtn.className = "slider-btn slider-inc";
      incBtn.type = "button";
      incBtn.innerHTML = "+";
      incBtn.tabIndex = -1;

      let timeoutId: any = null;
      let intervalId: any = null;

      const adjust = (direction: number) => {
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        const step = Number(input.step) || 1;
        const val = Number(input.value) || 0;
        const newVal = Math.max(min, Math.min(max, val + direction * step));
        if (newVal !== val) {
          const decimals = (String(step).split(".")[1] || "").length;
          input.value = newVal.toFixed(decimals);
          update();
          triggerFeedback(newVal === spec.default);
        }
      };

      const startAdjusting = (direction: number) => {
        stopAdjusting();
        adjust(direction);
        timeoutId = setTimeout(() => {
          intervalId = setInterval(() => {
            adjust(direction);
          }, 80);
        }, 400);
      };

      const stopAdjusting = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (intervalId) clearInterval(intervalId);
        timeoutId = null;
        intervalId = null;
      };

      decBtn.addEventListener("pointerdown", (e) => {
        if (e.button === 0) {
          e.preventDefault();
          startAdjusting(-1);
        }
      });
      incBtn.addEventListener("pointerdown", (e) => {
        if (e.button === 0) {
          e.preventDefault();
          startAdjusting(1);
        }
      });

      const stopEvents = ["pointerup", "pointercancel", "pointerleave"];
      for (const evt of stopEvents) {
        decBtn.addEventListener(evt, stopAdjusting);
        incBtn.addEventListener(evt, stopAdjusting);
      }

      decBtn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
      incBtn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });

      // Insert buttons
      input.parentNode?.insertBefore(decBtn, input);
      input.parentNode?.insertBefore(incBtn, input.nextSibling);
    }
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
