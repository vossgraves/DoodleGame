export interface Sens {
  look: number;
  touch: number;
  pad: number;
  ads: number;
  scope: number;
  sniper: number;
}

export const BASE = { mouse: 0.0022, touch: 0.0045, padX: 3.4, padY: 2.6 };

export const DEFAULT_SENS: Sens = { look: 100, touch: 100, pad: 100, ads: 80, scope: 60, sniper: 42 };

const KEY = "doodle_sens2";

export function loadSens(): Sens {
  const out = { ...DEFAULT_SENS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") {
      for (const k of Object.keys(out) as (keyof Sens)[]) {
        const v = Number((raw as Record<string, unknown>)[k]);
        if (Number.isFinite(v)) out[k] = Math.min(300, Math.max(5, v));
      }
      return out;
    }
  } catch {
  }
  const old = Number(localStorage.getItem("doodle_sens"));
  if (Number.isFinite(old) && old > 0) {
    out.look = Math.min(300, Math.max(5, old));
    out.touch = out.look;
  }
  return out;
}

export function saveSens(s: Sens) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
  }
}
