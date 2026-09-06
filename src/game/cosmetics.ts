import type { WeaponKind } from "./player";
import { INK } from "./renderer";

/**
 * Cosmetics. The art style is ink on paper, so a "skin" here is which pens the
 * gun was drawn with — the outline ink, the ink its dark parts get, and an
 * accent used for bands and fills. Camos unlock progressively off kills with
 * that specific weapon, the way they should: the gun earns its own paint.
 */

export interface Camo {
  id: string;
  name: string;
  blurb: string;
  /** kills with that weapon needed to unlock */
  need: number;
  /** outline ink for the body */
  ink: number;
  /** ink for the grip, stock and other dark parts */
  dark: number;
  /** ink for muzzle flash, dots and bands */
  accent: number;
  /** draw the body as a solid fill instead of hatching */
  fill?: boolean;
  shadeScale?: number;
  shadeBias?: number;
  /** wrap bands down the barrel, in the accent ink */
  bands?: number;
}

export const CAMOS: Camo[] = [
  {
    id: "issue",
    name: "STANDARD ISSUE",
    blurb: "blue biro, straight out of the pencil case",
    need: 0,
    ink: INK.BLUE,
    dark: INK.BLACK,
    accent: INK.ORANGE,
    shadeBias: -0.15,
  },
  {
    id: "inked",
    name: "INKED",
    blurb: "gone over twice with a heavier nib",
    need: 10,
    ink: INK.BLACK,
    dark: INK.BLACK,
    accent: INK.BLUE,
    shadeBias: -0.42,
  },
  {
    id: "crosshatch",
    name: "CROSSHATCH",
    blurb: "shaded in until the paper gave up",
    need: 25,
    ink: INK.BLUE,
    dark: INK.BLACK,
    accent: INK.BLUE,
    shadeScale: 0.45,
    shadeBias: -0.34,
  },
  {
    id: "banded",
    name: "MARGIN STRIPE",
    blurb: "red pen, the kind that means trouble",
    need: 50,
    ink: INK.RED,
    dark: INK.BLACK,
    accent: INK.BLACK,
    shadeBias: -0.2,
    bands: 3,
  },
  {
    id: "highlight",
    name: "HIGHLIGHTER",
    blurb: "green, laid on far too thick",
    need: 100,
    ink: INK.GREEN,
    dark: INK.BLACK,
    accent: INK.PINK,
    shadeScale: 0.35,
    shadeBias: -0.5,
    bands: 2,
  },
  {
    id: "spill",
    name: "INK SPILL",
    blurb: "pink all the way through, no survivors",
    need: 175,
    ink: INK.PINK,
    dark: INK.RED,
    accent: INK.BLACK,
    shadeScale: 0.3,
    shadeBias: -0.55,
    bands: 4,
  },
  {
    id: "gold",
    name: "GOLD LEAF",
    blurb: "the one people actually notice",
    need: 300,
    ink: INK.ORANGE,
    dark: INK.ORANGE,
    accent: INK.BLACK,
    fill: true,
    bands: 5,
  },
];

export type CharmShape = "clip" | "star" | "die" | "blot" | "tag";

export interface Charm {
  id: string;
  name: string;
  blurb: string;
  need: number;
  shape: CharmShape;
  ink: number;
}

export const CHARMS: Charm[] = [
  { id: "clip", name: "PAPERCLIP", blurb: "borrowed, never returned", need: 5, shape: "clip", ink: INK.BLACK },
  { id: "star", name: "GOLD STAR", blurb: "for effort", need: 20, shape: "star", ink: INK.ORANGE },
  { id: "die", name: "LOADED DIE", blurb: "always lands the same way up", need: 40, shape: "die", ink: INK.RED },
  { id: "blot", name: "INK BLOT", blurb: "it got everywhere", need: 75, shape: "blot", ink: INK.BLUE },
  { id: "tag", name: "NAME TAG", blurb: "someone else's, probably", need: 130, shape: "tag", ink: INK.GREEN },
];

export type StickerGlyph = "star" | "cross" | "ring" | "bolt" | "blot";

export interface Sticker {
  id: string;
  name: string;
  blurb: string;
  need: number;
  glyph: StickerGlyph;
  ink: number;
}

export const STICKERS: Sticker[] = [
  { id: "star", name: "STAR", blurb: "stuck on the receiver", need: 0, glyph: "star", ink: INK.ORANGE },
  { id: "cross", name: "CROSSED OUT", blurb: "one per victim, in theory", need: 15, glyph: "cross", ink: INK.RED },
  { id: "ring", name: "RING BINDER", blurb: "punched clean through", need: 35, glyph: "ring", ink: INK.BLUE },
  { id: "bolt", name: "BOLT", blurb: "borrowed from a different notebook", need: 60, glyph: "bolt", ink: INK.GREEN },
  { id: "blot", name: "SPLAT", blurb: "the pen leaked", need: 110, glyph: "blot", ink: INK.PINK },
];

/** What a single weapon is wearing. */
export interface WeaponSkin {
  camo?: string;
  charm?: string;
  sticker?: string;
}
export type Wardrobe = Partial<Record<WeaponKind, WeaponSkin>>;
/** Confirmed kills per weapon — what unlocks everything above. */
export type KillLog = Partial<Record<WeaponKind, number>>;

const CAMO_BY_ID = new Map(CAMOS.map((c) => [c.id, c]));
const CHARM_BY_ID = new Map(CHARMS.map((c) => [c.id, c]));
const STICKER_BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export const DEFAULT_CAMO = CAMOS[0];
export const camoById = (id: string | undefined) => (id && CAMO_BY_ID.get(id)) || DEFAULT_CAMO;
export const charmById = (id: string | undefined) => (id ? CHARM_BY_ID.get(id) : undefined);
export const stickerById = (id: string | undefined) => (id ? STICKER_BY_ID.get(id) : undefined);

export function sanitizeWardrobe(raw: unknown): Wardrobe {
  const out: Wardrobe = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [kind, worn] of Object.entries(raw as Record<string, unknown>)) {
    if (!worn || typeof worn !== "object") continue;
    const w = worn as Record<string, unknown>;
    const skin: WeaponSkin = {};
    if (typeof w.camo === "string" && CAMO_BY_ID.has(w.camo)) skin.camo = w.camo;
    if (typeof w.charm === "string" && CHARM_BY_ID.has(w.charm)) skin.charm = w.charm;
    if (typeof w.sticker === "string" && STICKER_BY_ID.has(w.sticker)) skin.sticker = w.sticker;
    if (Object.keys(skin).length) out[kind as WeaponKind] = skin;
  }
  return out;
}

export function sanitizeKills(raw: unknown): KillLog {
  const out: KillLog = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [kind, n] of Object.entries(raw as Record<string, unknown>)) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) out[kind as WeaponKind] = Math.floor(v);
  }
  return out;
}

/**
 * Strip anything the player has not earned yet. Called whenever a wardrobe
 * arrives from storage, so an edited localStorage entry cannot dress a gun in
 * paint it never unlocked.
 */
export function enforceUnlocks(w: Wardrobe, kills: KillLog): Wardrobe {
  const out: Wardrobe = {};
  for (const [kind, skin] of Object.entries(w) as [WeaponKind, WeaponSkin][]) {
    const got = kills[kind] ?? 0;
    const kept: WeaponSkin = {};
    const camo = camoById(skin.camo);
    if (skin.camo && camo.need <= got) kept.camo = skin.camo;
    const charm = charmById(skin.charm);
    if (charm && charm.need <= got) kept.charm = skin.charm;
    const sticker = stickerById(skin.sticker);
    if (sticker && sticker.need <= got) kept.sticker = skin.sticker;
    if (Object.keys(kept).length) out[kind] = kept;
  }
  return out;
}

/** The next thing this weapon is working towards, for the progress line. */
export function nextCamo(kills: number): { camo: Camo; left: number } | null {
  const next = CAMOS.find((c) => c.need > kills);
  return next ? { camo: next, left: next.need - kills } : null;
}
