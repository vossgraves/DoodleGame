import type { WeaponDef, WeaponKind } from "./player";

export type SlotId = "sight" | "muzzle" | "mag" | "stock";

export const SLOTS: { id: SlotId; name: string; blurb: string }[] = [
  { id: "sight", name: "OPTIC", blurb: "what you look through" },
  { id: "muzzle", name: "MUZZLE", blurb: "what comes out the front" },
  { id: "mag", name: "MAGAZINE", blurb: "how much you carry" },
  { id: "stock", name: "STOCK", blurb: "how it sits in your hands" },
];

export interface StatMods {
  damage?: number;
  magSize?: number;
  maxReserve?: number;
  reloadDur?: number;
  interval?: number;
  spread?: number;
  adsSpread?: number;
  spreadKick?: number;
  spreadMax?: number;
  camKick?: number;
  adsFov?: number;
  adsSpeed?: number;
  moveMul?: number;
  falloff?: number;
  quiet?: boolean;
}

export interface Attachment {
  id: string;
  slot: SlotId;
  name: string;
  blurb: string;
  mods: StatMods;
}

const STAT_LABELS: Record<keyof StatMods, { label: string; higherIsBetter: boolean }> = {
  damage: { label: "damage", higherIsBetter: true },
  magSize: { label: "mag size", higherIsBetter: true },
  maxReserve: { label: "ammo carried", higherIsBetter: true },
  reloadDur: { label: "reload time", higherIsBetter: false },
  interval: { label: "fire rate", higherIsBetter: false },
  spread: { label: "hip spread", higherIsBetter: false },
  adsSpread: { label: "aimed spread", higherIsBetter: false },
  spreadKick: { label: "spread climb", higherIsBetter: false },
  spreadMax: { label: "max spread", higherIsBetter: false },
  camKick: { label: "recoil", higherIsBetter: false },
  adsFov: { label: "zoom", higherIsBetter: false },
  adsSpeed: { label: "aim speed", higherIsBetter: true },
  moveMul: { label: "movement", higherIsBetter: true },
  falloff: { label: "range", higherIsBetter: true },
  quiet: { label: "suppressed", higherIsBetter: true },
};

export const ATTACHMENTS: Attachment[] = [
  {
    id: "reddot",
    slot: "sight",
    name: "RED DOT",
    blurb: "a clean dot; up fast, barely any glass",
    mods: { adsSpeed: 1.16, adsSpread: 0.84, adsFov: 1.03 },
  },
  {
    id: "holo",
    slot: "sight",
    name: "HOLO",
    blurb: "a wide ring — steadier, a touch slower",
    mods: { adsSpread: 0.7, adsFov: 0.93, adsSpeed: 0.95 },
  },
  {
    id: "scope4x",
    slot: "sight",
    name: "4X SCOPE",
    blurb: "reaches out; slow to shoulder",
    mods: { adsSpread: 0.5, adsFov: 0.62, adsSpeed: 0.72 },
  },
  {
    id: "canted",
    slot: "sight",
    name: "CANTED IRONS",
    blurb: "no glass at all — fastest thing on the rail",
    mods: { adsSpeed: 1.3, adsFov: 1.1, adsSpread: 1.15 },
  },

  {
    id: "suppressor",
    slot: "muzzle",
    name: "SUPPRESSOR",
    blurb: "no flash, no bang; costs you reach",
    mods: { quiet: true, camKick: 0.86, falloff: 0.82, adsSpeed: 0.94 },
  },
  {
    id: "compensator",
    slot: "muzzle",
    name: "COMPENSATOR",
    blurb: "flattens the climb, opens the hip",
    mods: { camKick: 0.72, spreadKick: 0.8, spread: 1.09 },
  },
  {
    id: "brake",
    slot: "muzzle",
    name: "MUZZLE BRAKE",
    blurb: "keeps a long burst from blooming",
    mods: { spreadMax: 0.72, camKick: 0.82, moveMul: 0.97 },
  },
  {
    id: "longbarrel",
    slot: "muzzle",
    name: "LONG BARREL",
    blurb: "hits harder further out; heavy to swing",
    mods: { falloff: 1.32, damage: 1.06, adsSpeed: 0.85, moveMul: 0.97 },
  },

  {
    id: "extmag",
    slot: "mag",
    name: "EXTENDED MAG",
    blurb: "more rounds before you have to think",
    mods: { magSize: 1.4, reloadDur: 1.12, moveMul: 0.98 },
  },
  {
    id: "fastmag",
    slot: "mag",
    name: "QUICKDRAW MAG",
    blurb: "back in the fight sooner, with less in it",
    mods: { reloadDur: 0.76, magSize: 0.86 },
  },
  {
    id: "heavymag",
    slot: "mag",
    name: "HEAVY ROUNDS",
    blurb: "bigger holes, more kick, fewer of them",
    mods: { damage: 1.13, magSize: 0.8, camKick: 1.18 },
  },
  {
    id: "lightmag",
    slot: "mag",
    name: "LIGHT ROUNDS",
    blurb: "quick to raise; you carry less spare",
    mods: { adsSpeed: 1.12, moveMul: 1.04, maxReserve: 0.85 },
  },

  {
    id: "tacstock",
    slot: "stock",
    name: "TACTICAL STOCK",
    blurb: "planted and controllable",
    mods: { spreadMax: 0.8, camKick: 0.85, moveMul: 0.97 },
  },
  {
    id: "lightstock",
    slot: "stock",
    name: "SKELETON STOCK",
    blurb: "quicker on your feet, looser under fire",
    mods: { moveMul: 1.05, adsSpeed: 1.12, spreadMax: 1.15 },
  },
  {
    id: "nostock",
    slot: "stock",
    name: "NO STOCK",
    blurb: "run-and-gun; nothing to steady it",
    mods: { moveMul: 1.09, adsSpeed: 1.2, spread: 1.2, camKick: 1.2 },
  },
];

const BY_ID = new Map(ATTACHMENTS.map((a) => [a.id, a]));

export function attachmentsFor(slot: SlotId) {
  return ATTACHMENTS.filter((a) => a.slot === slot);
}

export type GunBuild = Partial<Record<SlotId, string>>;
export type Gunsmith = Partial<Record<WeaponKind, GunBuild>>;

export function sanitizeGunsmith(raw: unknown): Gunsmith {
  const out: Gunsmith = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [kind, build] of Object.entries(raw as Record<string, unknown>)) {
    if (!build || typeof build !== "object") continue;
    const clean: GunBuild = {};
    for (const s of SLOTS) {
      const id = (build as Record<string, unknown>)[s.id];
      if (typeof id !== "string") continue;
      const att = BY_ID.get(id);
      if (att && att.slot === s.id) clean[s.id] = id;
    }
    if (Object.keys(clean).length) out[kind as WeaponKind] = clean;
  }
  return out;
}

export function buildAttachments(build: GunBuild | undefined): Attachment[] {
  if (!build) return [];
  return SLOTS.map((s) => (build[s.id] ? BY_ID.get(build[s.id]!) : undefined)).filter(
    (a): a is Attachment => !!a,
  );
}

export function applyBuild(base: WeaponDef, build: GunBuild | undefined): WeaponDef {
  const list = buildAttachments(build);
  if (!list.length) return { ...base };
  const d: WeaponDef = { ...base, camKick: [...base.camKick] as [number, number] };
  for (const a of list) {
    const m = a.mods;
    if (m.damage) d.damage *= m.damage;
    if (m.magSize) d.magSize = Math.max(1, Math.round(d.magSize * m.magSize));
    if (m.maxReserve) d.maxReserve = Math.max(d.magSize, Math.round(d.maxReserve * m.maxReserve));
    if (m.reloadDur) d.reloadDur *= m.reloadDur;
    if (m.interval) d.interval *= m.interval;
    if (m.spread) d.spread *= m.spread;
    if (m.adsSpread) d.adsSpread *= m.adsSpread;
    if (m.spreadKick) d.spreadKick *= m.spreadKick;
    if (m.spreadMax) d.spreadMax *= m.spreadMax;
    if (m.camKick) d.camKick = [d.camKick[0] * m.camKick, d.camKick[1] * m.camKick];
    if (m.adsFov) d.adsFov *= m.adsFov;
    if (m.adsSpeed) d.adsSpeed *= m.adsSpeed;
    if (m.moveMul) d.moveMul *= m.moveMul;
    if (m.falloff && d.falloff) d.falloff = [d.falloff[0] * m.falloff, d.falloff[1] * m.falloff, d.falloff[2]];
    if (m.quiet) d.quiet = true;
  }
  d.spreadMax = Math.max(d.spreadMax, d.spread * 1.05);
  d.reserve = Math.min(d.reserve, d.maxReserve);
  return d;
}

export function modLines(a: Attachment): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = [];
  for (const [key, val] of Object.entries(a.mods) as [keyof StatMods, number | boolean][]) {
    const meta = STAT_LABELS[key];
    if (!meta) continue;
    if (typeof val === "boolean") {
      if (val) out.push({ text: meta.label, good: meta.higherIsBetter });
      continue;
    }
    const pct = Math.round((val - 1) * 100);
    if (!pct) continue;
    const up = pct > 0;
    out.push({ text: `${up ? "+" : ""}${pct}% ${meta.label}`, good: up === meta.higherIsBetter });
  }
  return out;
}
