export interface HudSpot {
  x: number;
  y: number;
  scale: number;
}

export type HudLayout = Record<string, HudSpot>;

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
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
  }
}

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
