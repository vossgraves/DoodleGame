/**
 * Where the HUD sits.
 *
 * The presets in settings pick a whole arrangement; this is the other half —
 * moving an individual piece to where your thumb actually is. Overrides are
 * stored as a percentage of the viewport so they survive a rotation or a
 * different phone, and nothing is written until the player moves something, so
 * a fresh install just gets the CSS.
 */

export interface HudSpot {
  /** centre of the element, as a percentage of the viewport */
  x: number;
  y: number;
  scale: number;
}

export type HudLayout = Record<string, HudSpot>;

/** Everything the editor offers, in the order it lists them. */
export const HUD_PIECES: { id: string; name: string; sel: string }[] = [
  { id: "stick", name: "stick", sel: ".joy-base" },
  { id: "fire", name: "fire", sel: ".tbtn.fire" },
  { id: "aim", name: "aim", sel: ".tbtn.aim" },
  { id: "jump", name: "jump", sel: ".tbtn.jump" },
  { id: "crouch", name: "crouch", sel: ".tbtn.crouch" },
  { id: "sprint", name: "sprint", sel: ".tbtn.sprint" },
  { id: "reload", name: "reload", sel: ".tbtn.reload" },
  { id: "nade", name: "grenade", sel: ".tbtn.nade" },
  { id: "grapple", name: "grapple", sel: ".tbtn.grapple" },
  { id: "wep", name: "weapon", sel: ".tbtn.wep" },
  { id: "emote", name: "emotes", sel: ".tbtn.emote" },
  { id: "minimap", name: "minimap", sel: ".minimap" },
  /* on a phone the health bar and the gun list share one strip */
  { id: "deck", name: "hp & guns", sel: ".m-deck" },
  { id: "health", name: "health", sel: ".hud-bl" },
  { id: "weapons", name: "weapon list", sel: ".hud-br" },
  { id: "score", name: "score", sel: ".hud-tl" },
  { id: "wave", name: "objective", sel: ".hud-tr" },
  { id: "streaks", name: "streaks", sel: ".streak-tray" },
  { id: "meter", name: "skill meter", sel: ".grapple-meter" },
];

const KEY = "doodle_hudpos";

export function load(): HudLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object") return {};
    const out: HudLayout = {};
    for (const p of HUD_PIECES) {
      const s = (raw as Record<string, unknown>)[p.id] as Partial<HudSpot> | undefined;
      if (!s) continue;
      const x = Number(s.x);
      const y = Number(s.y);
      const scale = Number(s.scale);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out[p.id] = {
        x: Math.min(98, Math.max(2, x)),
        y: Math.min(98, Math.max(2, y)),
        scale: Number.isFinite(scale) ? Math.min(1.8, Math.max(0.6, scale)) : 1,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function save(l: HudLayout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // no storage means the layout lasts the session; the game still plays
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

/**
 * The overrides as a stylesheet. Going through CSS rather than inline styles
 * means nothing has to be threaded down to every button and panel that might
 * move — each piece already has a stable selector. Anchoring from the centre
 * keeps a resized control under the same thumb instead of growing off an edge.
 */
export function css(l: HudLayout): string {
  const rules: string[] = [];
  for (const p of HUD_PIECES) {
    const s = l[p.id];
    if (!s) continue;
    rules.push(
      `${p.sel}{position:absolute;left:${s.x}%;top:${s.y}%;right:auto;bottom:auto;` +
        `margin:0;transform:translate(-50%,-50%) scale(${s.scale});transform-origin:center;}`,
    );
  }
  return rules.join("\n");
}
