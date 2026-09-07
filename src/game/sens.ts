/**
 * Look sensitivity.
 *
 * One slider cannot serve a mouse, a thumb and a sniper scope at once, so this
 * is five: a base per input device, and multipliers per magnification band. The
 * multipliers are percentages of the base, which is how every shooter that gets
 * this right presents it — "60% ADS" means something a player can reason about,
 * where a second raw radians-per-pixel number does not.
 */

export interface Sens {
  /** mouse, percent */
  look: number;
  /** finger drag, percent */
  touch: number;
  /** gamepad stick, percent */
  pad: number;
  /** percent of the base while down an unmagnified sight */
  ads: number;
  /** …a 2-3x optic */
  scope: number;
  /** …a sniper scope */
  sniper: number;
}

/** Radians per unit of raw input at 100%. */
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
    // a corrupt settings blob costs you the tuning, not the match
  }
  // carry over whatever the single old slider was set to
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
    // no storage means the tuning lasts the session
  }
}
