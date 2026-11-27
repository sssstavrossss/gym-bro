import type { DialId } from "../lib/dial";

// The step each person last kept on the number wheel, per kind of number (lib/dial.ts presets), on this device.
// A private window or blocked storage just means the wheel starts on our step each time.

const key = (id: DialId) => `gymbro-dial-step:${id}`;

export function rememberedStep(id: DialId): number | null {
  try {
    const raw = localStorage.getItem(key(id));
    const step = raw == null ? NaN : Number(raw);
    return Number.isFinite(step) && step > 0 ? step : null;
  } catch {
    return null;
  }
}

export function rememberStep(id: DialId, step: number): void {
  try {
    localStorage.setItem(key(id), String(step));
  } catch {
    /* the step just isn't kept */
  }
}
