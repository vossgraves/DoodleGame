import * as THREE from "three";
import { clamp, damp, rand, Spring } from "./math";
import { World } from "./physics";
import { INK, makeInkMaterial } from "./renderer";
import type { Input } from "./input";
import type { AudioSys } from "./audio";
import { applyBuild, type GunBuild, type Gunsmith } from "./attachments";
import { camoById, charmById, stickerById, type Wardrobe, type WeaponSkin } from "./cosmetics";
import { Grapple, type GrappleTarget } from "./grapple";

export type WeaponKind =
  | "rifle"
  | "carbine"
  | "smg"
  | "lmg"
  | "shotgun"
  | "sniper"
  | "revolver"
  | "pistol"
  | "knife"
  | "katana";

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  hint: string;
  magSize: number;
  reserve: number;
  maxReserve: number;
  interval: number;
  damage: number;
  headMul: number;
  pellets: number;
  spread: number;
  adsSpread: number;
  spreadKick: number;
  spreadMax: number;
  adsFov: number;
  auto: boolean;
  reloadDur: number;
  reloadType: "mag" | "shells";
  falloff: [number, number, number] | null;
  camKick: [number, number];
  fovKick: number;
  cycleDur: number;
  isGun: boolean;
  /** how briskly the sights come up — higher is snappier */
  adsSpeed: number;
  /** multiplier on walk speed while this is the weapon in hand */
  moveMul: number;
  /** suppressed: no bang, no flash to speak of */
  quiet: boolean;
  /** rounds committed per trigger pull; 0 or absent means not a burst weapon */
  burst?: number;
  burstDelay?: number;
}

/** How the base weapons are written: handling is filled in below. */
type BaseDef = Omit<WeaponDef, "adsSpeed" | "moveMul" | "quiet">;

const RAW_DEFS: Record<WeaponKind, BaseDef> = {
  rifle: {
    kind: "rifle",
    name: "RIFLE",
    hint: "auto · put the red dot on them",
    magSize: 35,
    reserve: 140,
    maxReserve: 280,
    interval: 1 / 11,
    damage: 24,
    headMul: 2.5,
    pellets: 1,
    spread: 0.016,
    adsSpread: 0.004,
    spreadKick: 0.01,
    spreadMax: 0.085,
    adsFov: 58,
    auto: true,
    reloadDur: 1.4,
    reloadType: "mag",
    falloff: [30, 55, 0.7],
    camKick: [0.012, 0.004],
    fovKick: 1.2,
    cycleDur: 0,
    isGun: true,
  },
  shotgun: {
    kind: "shotgun",
    name: "SHOTGUN",
    hint: "pump · devastating up close",
    magSize: 6,
    reserve: 30,
    maxReserve: 60,
    interval: 0.72,
    damage: 18,
    headMul: 1.7,
    pellets: 9,
    spread: 0.06,
    adsSpread: 0.032,
    spreadKick: 0,
    spreadMax: 0.1,
    adsFov: 68,
    auto: false,
    reloadDur: 0.42,
    reloadType: "shells",
    falloff: [10, 28, 0.22],
    camKick: [0.05, 0.012],
    fovKick: 4,
    cycleDur: 0.42,
    isGun: true,
  },
  sniper: {
    kind: "sniper",
    name: "SNIPER",
    hint: "scoped bolt · one shot, one erasure",
    magSize: 5,
    reserve: 20,
    maxReserve: 40,
    interval: 0.18,
    damage: 140,
    headMul: 2.8,
    pellets: 1,
    spread: 0.07,
    adsSpread: 0.0005,
    spreadKick: 0.04,
    spreadMax: 0.13,
    adsFov: 22,
    auto: false,
    reloadDur: 2.0,
    reloadType: "mag",
    falloff: [55, 92, 0.85],
    camKick: [0.055, 0.008],
    fovKick: 4.2,
    cycleDur: 0.8,
    isGun: true,
  },
  knife: {
    kind: "knife",
    name: "SWITCHBLADE",
    hint: "slash · hold aim to guard",
    magSize: 0,
    reserve: 0,
    maxReserve: 0,
    interval: 0.42,
    damage: 55,
    headMul: 1.4,
    pellets: 1,
    spread: 0,
    adsSpread: 0,
    spreadKick: 0,
    spreadMax: 0,
    adsFov: 78,
    auto: false,
    reloadDur: 0,
    reloadType: "mag",
    falloff: null,
    camKick: [0.02, 0.01],
    fovKick: 2,
    cycleDur: 0,
    isGun: false,
  },
  katana: {
    kind: "katana",
    name: "KATANA",
    hint: "combo slash · hold aim to guard and return fire",
    magSize: 0,
    reserve: 0,
    maxReserve: 0,
    interval: 0.34,
    damage: 75,
    headMul: 1.5,
    pellets: 1,
    spread: 0,
    adsSpread: 0,
    spreadKick: 0,
    spreadMax: 0,
    adsFov: 80,
    auto: false,
    reloadDur: 0,
    reloadType: "mag",
    falloff: null,
    camKick: [0.024, 0.012],
    fovKick: 2.4,
    cycleDur: 0,
    isGun: false,
  },
  carbine: {
    kind: "carbine",
    name: "CARBINE",
    hint: "three-round burst · tap and re-tap",
    magSize: 30,
    reserve: 150,
    maxReserve: 300,
    interval: 0.38,
    damage: 26,
    headMul: 2.4,
    pellets: 1,
    spread: 0.012,
    adsSpread: 0.003,
    spreadKick: 0.012,
    spreadMax: 0.075,
    adsFov: 56,
    auto: false,
    reloadDur: 1.5,
    reloadType: "mag",
    falloff: [24, 46, 0.62],
    camKick: [0.016, 0.005],
    fovKick: 1.5,
    cycleDur: 0,
    isGun: true,
    burst: 3,
    burstDelay: 0.07,
  },
  smg: {
    kind: "smg",
    name: "SMG",
    hint: "spray · fast and loose up close",
    magSize: 40,
    reserve: 200,
    maxReserve: 400,
    interval: 1 / 16,
    damage: 15,
    headMul: 2.0,
    pellets: 1,
    spread: 0.028,
    adsSpread: 0.012,
    spreadKick: 0.012,
    spreadMax: 0.11,
    adsFov: 66,
    auto: true,
    reloadDur: 1.15,
    reloadType: "mag",
    falloff: [8, 24, 0.35],
    camKick: [0.009, 0.005],
    fovKick: 1.0,
    cycleDur: 0,
    isGun: true,
  },
  lmg: {
    kind: "lmg",
    name: "LMG",
    hint: "belt-fed · hold it down, reload forever",
    magSize: 90,
    reserve: 270,
    maxReserve: 540,
    interval: 1 / 9,
    damage: 22,
    headMul: 2.0,
    pellets: 1,
    spread: 0.03,
    adsSpread: 0.01,
    spreadKick: 0.008,
    spreadMax: 0.12,
    adsFov: 64,
    auto: true,
    reloadDur: 3.2,
    reloadType: "mag",
    falloff: [28, 52, 0.7],
    camKick: [0.014, 0.006],
    fovKick: 1.4,
    cycleDur: 0,
    isGun: true,
  },
  revolver: {
    kind: "revolver",
    name: "REVOLVER",
    hint: "six shots · make every one count",
    magSize: 6,
    reserve: 36,
    maxReserve: 72,
    interval: 0.34,
    damage: 72,
    headMul: 2.6,
    pellets: 1,
    spread: 0.014,
    adsSpread: 0.002,
    spreadKick: 0.05,
    spreadMax: 0.12,
    adsFov: 54,
    auto: false,
    reloadDur: 2.2,
    reloadType: "mag",
    falloff: [16, 34, 0.5],
    camKick: [0.06, 0.014],
    fovKick: 4.5,
    cycleDur: 0.2,
    isGun: true,
  },
  pistol: {
    kind: "pistol",
    name: "PISTOL",
    hint: "semi · light, quick to reload",
    magSize: 14,
    reserve: 84,
    maxReserve: 168,
    interval: 0.14,
    damage: 26,
    headMul: 2.4,
    pellets: 1,
    spread: 0.012,
    adsSpread: 0.004,
    spreadKick: 0.014,
    spreadMax: 0.07,
    adsFov: 62,
    auto: false,
    reloadDur: 1.0,
    reloadType: "mag",
    falloff: [14, 34, 0.4],
    camKick: [0.02, 0.006],
    fovKick: 1.6,
    cycleDur: 0,
    isGun: true,
  },
};

/**
 * Handling, kept apart from the ballistics above so the difference between a
 * light SMG and an LMG you have to heave around reads at a glance. Anything
 * left out is an average gun.
 */
const HANDLING: Partial<Record<WeaponKind, { adsSpeed?: number; moveMul?: number }>> = {
  lmg: { adsSpeed: 8.0, moveMul: 0.9 },
  sniper: { adsSpeed: 7.5, moveMul: 0.94 },
  shotgun: { adsSpeed: 11, moveMul: 0.98 },
  smg: { adsSpeed: 14.5, moveMul: 1.05 },
  carbine: { adsSpeed: 13, moveMul: 1.02 },
  revolver: { adsSpeed: 13.5, moveMul: 1.04 },
  pistol: { adsSpeed: 15.5, moveMul: 1.07 },
  knife: { adsSpeed: 16, moveMul: 1.1 },
  katana: { adsSpeed: 15, moveMul: 1.12 },
};

const DEFS = Object.fromEntries(
  Object.entries(RAW_DEFS).map(([k, d]) => [
    k,
    { adsSpeed: 12, moveMul: 1, quiet: false, ...HANDLING[k as WeaponKind], ...d },
  ]),
) as Record<WeaponKind, WeaponDef>;

/** Every weapon, for loadout UIs. Guns first, melee last. */
export const WEAPONS: { kind: WeaponKind; name: string; hint: string; isGun: boolean }[] = (
  ["rifle", "carbine", "smg", "lmg", "shotgun", "sniper", "revolver", "pistol", "knife", "katana"] as WeaponKind[]
).map((k) => ({ kind: k, name: DEFS[k].name, hint: DEFS[k].hint, isGun: DEFS[k].isGun }));

export const GUN_KINDS = WEAPONS.filter((w) => w.isGun).map((w) => w.kind);
export const MELEE_KINDS = WEAPONS.filter((w) => !w.isGun).map((w) => w.kind);
export const DEFAULT_LOADOUT: WeaponKind[] = ["rifle", "shotgun", "sniper", "knife"];

/** The bare definition for a weapon, before any gunsmith work. */
export function weaponDef(kind: WeaponKind): WeaponDef {
  return { ...DEFS[kind] };
}

/** Names that used to exist, so an old saved loadout still works. */
const LEGACY_KINDS: Record<string, WeaponKind> = {};

/** Drop anything unknown and guarantee a usable set of slots. */
export function sanitizeLoadout(raw: unknown): WeaponKind[] {
  const all = new Set(WEAPONS.map((w) => w.kind));
  const list = (Array.isArray(raw) ? raw : [])
    .map((k) => (typeof k === "string" && LEGACY_KINDS[k] ? LEGACY_KINDS[k] : k))
    .filter((k): k is WeaponKind => all.has(k as WeaponKind));
  const guns = list.filter((k) => DEFS[k].isGun).slice(0, 3);
  if (!guns.length) return [...DEFAULT_LOADOUT];
  const melee = list.find((k) => !DEFS[k].isGun) ?? "knife";
  return [...guns, melee];
}

/** How long a weapon takes to swing up after a switch. */
export const EQUIP_DUR = 0.34;
/** How far back the blade sits when folded into the handle. */
const BLADE_RETRACT = 0.47;
/** How long a katana swing takes from draw to follow-through. */
const SLASH_DUR = 0.27;
/** The flick after turning a shot away with the guard. */
const PARRY_FLICK = 0.22;
/** How long after raising the guard a block still counts as a clean parry. */
const PARRY_WINDOW = 0.55;

function bx(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(r: number, h: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D, axis: "x" | "y" | "z" = "z") {
  const g = new THREE.CylinderGeometry(r, r, h, 7);
  if (axis === "z") g.rotateX(Math.PI / 2);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

type V3 = readonly [number, number, number];
/** Where each gun's bolt-on parts hang. Melee has none, so it is absent. */
const ANCHORS: Partial<Record<WeaponKind, { muzzle: V3; sight: V3; mag: V3; stock: V3 }>> = {
  rifle: { muzzle: [0, 0.08, -1.0], sight: [0, 0.22, -0.12], mag: [0, -0.2, -0.06], stock: [0, 0.04, 0.3] },
  carbine: { muzzle: [0, 0.08, -0.84], sight: [0, 0.22, -0.12], mag: [0, -0.2, -0.06], stock: [0, 0.04, 0.26] },
  smg: { muzzle: [0, 0.07, -0.66], sight: [0, 0.18, -0.1], mag: [0, -0.26, -0.02], stock: [0, 0.03, 0.2] },
  lmg: { muzzle: [0, 0.1, -1.14], sight: [0, 0.26, -0.1], mag: [0, -0.24, -0.02], stock: [0, 0.03, 0.32] },
  shotgun: { muzzle: [0, 0.06, -0.92], sight: [0, 0.16, -0.1], mag: [0, -0.14, -0.32], stock: [0, 0.02, 0.3] },
  sniper: { muzzle: [0, 0.1, -1.3], sight: [0, 0.26, -0.5], mag: [0, -0.16, -0.06], stock: [0, 0.06, 0.3] },
  revolver: { muzzle: [0, 0.06, -0.54], sight: [0, 0.14, -0.16], mag: [0, 0.0, -0.04], stock: [0, -0.14, 0.16] },
  pistol: { muzzle: [0, 0.05, -0.42], sight: [0, 0.14, -0.1], mag: [0, -0.24, 0.02], stock: [0, 0.06, 0.1] },
  // the knife takes no rails, but it still hangs a charm and wears a sticker
  knife: { muzzle: [0, 0.02, -0.5], sight: [0, 0.1, -0.1], mag: [0, -0.1, 0.1], stock: [0, -0.02, 0.2] },
  katana: { muzzle: [0, 0.0, -1.05], sight: [0, 0.08, -0.2], mag: [0, -0.08, 0.1], stock: [0, 0.0, 0.24] },
};

/** Flat sticker shapes, drawn once and stuck on the side of the receiver. */
function glyphGeo(glyph: "star" | "cross" | "ring" | "bolt" | "blot") {
  if (glyph === "star") return starGeo(5, 0.16, 0.07);
  if (glyph === "blot") return new THREE.CircleGeometry(0.13, 9);
  if (glyph === "ring") return new THREE.RingGeometry(0.08, 0.14, 12);
  const s = new THREE.Shape();
  if (glyph === "cross") {
    const a = 0.045;
    const b = 0.15;
    const pts: [number, number][] = [
      [-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a],
      [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a],
    ];
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1)) s.lineTo(...p);
  } else {
    // lightning bolt
    const pts: [number, number][] = [
      [0.02, 0.16], [-0.11, 0.0], [-0.02, 0.0], [-0.05, -0.16], [0.1, 0.02], [0.01, 0.02],
    ];
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1)) s.lineTo(...p);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function starGeo(n = 7, r1 = 0.16, r2 = 0.06) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? r1 : r2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export class Weapon {
  def: WeaponDef;
  mag: number;
  reserve: number;
  fireT = 0;
  reloading = false;
  reloadT = 0;
  spreadCur = 0;
  cycleT = 0;
  root: THREE.Group;
  flash: THREE.Group;
  blade: THREE.Object3D | null = null;
  /** the sliding part of a switchblade; null for everything else */
  edge: THREE.Object3D | null = null;
  blocking = false;
  blockT = 0;
  slashT = 0;
  /** which way the next katana swing travels: alternates through a combo */
  comboStep = 0;
  private comboT = 0;
  /** a parry flick, counted down after a shot is turned away */
  parryT = 0;
  parryDir = 1;
  /** how bloody the blade is, 0..1, which is how many smears show */
  private bloodLevel = 0;
  private smears: THREE.Mesh[] = [];
  burstLeft = 0;
  burstT = 0;
  /** counts down while the gun is being swung up into view */
  equipT = 0;
  private build_: GunBuild | undefined;
  private skin: WeaponSkin | undefined;
  private camo!: ReturnType<typeof camoById>;
  /** the dangling charm, if one is fitted — swings on its own */
  private charmPivot: THREE.Object3D | null = null;
  private charmT = 0;
  private ink: THREE.ShaderMaterial;
  private solid: THREE.ShaderMaterial;
  private orange: THREE.ShaderMaterial;
  private black: THREE.ShaderMaterial;

  constructor(kind: WeaponKind, build?: GunBuild, skin?: WeaponSkin) {
    this.build_ = DEFS[kind].isGun ? build : undefined;
    this.skin = skin;
    this.def = applyBuild(DEFS[kind], this.build_);
    this.mag = this.def.magSize;
    this.reserve = this.def.reserve;
    this.spreadCur = this.def.spread;
    // the camo decides which pens the whole gun is drawn with
    const camo = camoById(skin?.camo);
    this.camo = camo;
    this.ink = makeInkMaterial({
      ink: camo.ink,
      fill: camo.fill,
      shadeScale: camo.shadeScale,
      shadeBias: camo.shadeBias ?? -0.15,
    });
    this.solid = makeInkMaterial({ ink: camo.accent, fill: true });
    this.orange = makeInkMaterial({ ink: INK.ORANGE, fill: true, side: THREE.DoubleSide });
    this.black = makeInkMaterial({ ink: camo.dark, shadeBias: -0.1 });
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.48);
    this.flash = new THREE.Group();
    this.build();
  }

  private build() {
    const k = this.def.kind;
    const m = this.ink;
    const b = this.black;
    if (k === "rifle") {
      cyl(0.045, 0.85, 0, 0.08, -0.55, m, this.root);
      bx(0.12, 0.16, 0.55, 0, 0.04, -0.1, m, this.root);
      bx(0.07, 0.22, 0.14, 0.0, -0.12, 0.08, b, this.root);
      bx(0.04, 0.08, 0.22, 0, 0.16, -0.2, m, this.root);
      bx(0.09, 0.09, 0.09, 0, 0.14, -0.05, this.solid, this.root); // red dot
      this.placeFlash(0, 0.08, -1.0, 0.9);
      this.hand(0.16, -0.12, 0.05);
      this.hand(-0.05, -0.02, -0.28);
    } else if (k === "shotgun") {
      cyl(0.055, 0.7, 0.04, 0.06, -0.5, m, this.root);
      cyl(0.055, 0.7, -0.04, 0.06, -0.5, m, this.root);
      bx(0.16, 0.14, 0.5, 0, 0.02, -0.05, m, this.root);
      bx(0.08, 0.2, 0.18, 0, -0.12, 0.12, b, this.root);
      this.placeFlash(0, 0.06, -0.92, 1.5);
      this.hand(0.14, -0.1, 0.08);
      this.hand(-0.08, -0.02, -0.32);
    } else if (k === "sniper") {
      cyl(0.04, 1.15, 0, 0.1, -0.7, m, this.root);
      bx(0.11, 0.12, 0.55, 0, 0.06, -0.05, m, this.root);
      cyl(0.07, 0.28, 0, 0.2, -0.18, b, this.root);
      bx(0.07, 0.18, 0.14, 0, -0.1, 0.12, b, this.root);
      this.placeFlash(0, 0.1, -1.3, 1.4);
      this.hand(0.14, -0.1, 0.05);
      this.hand(-0.06, 0.0, -0.4);
    } else if (k === "carbine") {
      cyl(0.042, 0.7, 0, 0.08, -0.46, m, this.root);
      bx(0.12, 0.16, 0.5, 0, 0.04, -0.08, m, this.root);
      bx(0.07, 0.22, 0.14, 0, -0.12, 0.08, b, this.root);
      cyl(0.055, 0.22, 0, 0.18, -0.14, b, this.root);
      this.placeFlash(0, 0.08, -0.84, 0.85);
      this.hand(0.15, -0.12, 0.04);
      this.hand(-0.05, -0.02, -0.24);
    } else if (k === "smg") {
      cyl(0.04, 0.5, 0, 0.07, -0.36, m, this.root);
      bx(0.11, 0.15, 0.42, 0, 0.03, -0.05, m, this.root);
      bx(0.07, 0.26, 0.1, 0, -0.14, 0.02, b, this.root);
      bx(0.05, 0.2, 0.1, 0, -0.06, -0.16, b, this.root);
      this.placeFlash(0, 0.07, -0.66, 0.8);
      this.hand(0.15, -0.12, 0.02);
      this.hand(-0.04, -0.06, -0.2);
    } else if (k === "lmg") {
      cyl(0.05, 1.0, 0, 0.1, -0.62, m, this.root);
      bx(0.16, 0.2, 0.62, 0, 0.03, -0.05, m, this.root);
      bx(0.09, 0.26, 0.16, 0, -0.14, 0.1, b, this.root);
      cyl(0.14, 0.12, 0, -0.08, -0.06, b, this.root, "x");
      bx(0.05, 0.1, 0.3, 0, 0.2, -0.35, b, this.root);
      this.placeFlash(0, 0.1, -1.14, 1.2);
      this.hand(0.16, -0.14, 0.08);
      this.hand(-0.06, -0.02, -0.4);
    } else if (k === "revolver") {
      cyl(0.038, 0.44, 0, 0.06, -0.3, m, this.root);
      cyl(0.09, 0.18, 0, 0.03, -0.04, b, this.root);
      bx(0.07, 0.26, 0.13, 0, -0.12, 0.06, b, this.root);
      this.placeFlash(0, 0.06, -0.54, 1.0);
      this.hand(0.12, -0.1, 0.04);
    } else if (k === "pistol") {
      bx(0.09, 0.13, 0.42, 0, 0.05, -0.16, m, this.root);
      bx(0.08, 0.24, 0.12, 0, -0.1, 0.02, b, this.root);
      bx(0.05, 0.05, 0.1, 0, 0.02, -0.34, m, this.root);
      this.placeFlash(0, 0.05, -0.42, 0.7);
      this.hand(0.12, -0.08, 0.02);
    } else if (k === "katana") {
      // A long single edge, a squared tsuba and a wrapped grip. It carries the
      // blood it earns on the flat of the blade, laid on one streak per kill.
      const sword = new THREE.Group();
      const steel = makeInkMaterial({ ink: this.camo.ink, fill: true });
      bx(0.014, 0.038, 1.0, 0, 0, -0.55, steel, sword); // blade
      bx(0.014, 0.022, 0.09, 0, 0.008, -1.07, steel, sword); // kissaki
      bx(0.02, 0.05, 0.9, 0, 0.026, -0.52, m, sword); // the shinogi ridge, in outline
      bx(0.1, 0.1, 0.022, 0, 0, -0.05, b, sword); // tsuba
      bx(0.034, 0.04, 0.32, 0, 0, 0.13, b, sword); // grip core
      for (let i = 0; i < 6; i++) bx(0.04, 0.045, 0.022, 0, 0, 0.02 + i * 0.048, m, sword); // wrap
      this.root.add(sword);
      this.blade = sword;
      this.buildSmears(sword);
      this.hand(0.0, -0.01, 0.06);
      this.hand(0.0, -0.01, 0.21);
    } else {
      // Switchblade: a fixed casing plus a blade that lives inside it and snaps
      // forward when the knife is drawn.
      const knife = new THREE.Group();
      const steel = makeInkMaterial({ ink: INK.BLACK, fill: true });
      bx(0.085, 0.1, 0.42, 0, 0.02, 0.05, b, knife); // casing
      bx(0.095, 0.02, 0.34, 0, 0.065, 0.03, m, knife); // seam down the side
      bx(0.105, 0.04, 0.04, 0, 0.0, -0.12, m, knife); // pivot rivet

      const edge = new THREE.Group();
      bx(0.028, 0.062, 0.52, 0, 0.02, -0.42, steel, edge);
      bx(0.034, 0.016, 0.44, 0, 0.048, -0.4, m, edge); // bevel
      bx(0.062, 0.035, 0.035, 0, 0.055, -0.2, m, edge); // thumb stud
      knife.add(edge);

      this.root.add(knife);
      this.blade = knife;
      this.edge = edge;
      edge.position.z = BLADE_RETRACT;
      this.hand(0.05, -0.08, 0.12);
    }
    this.fitAttachments();
    this.dress();
    this.root.visible = false;
  }

  /**
   * Blood that clings to the flat of the blade. Each streak is a ragged sliver
   * built in the plane of the steel and inset inside its silhouette, so nothing
   * ever hangs off an edge no matter how many are showing.
   */
  private buildSmears(sword: THREE.Group) {
    const blood = makeInkMaterial({ ink: INK.RED, fill: true, side: THREE.DoubleSide });
    const BH = 0.017; // half the blade's height
    const BX = 0.0075; // sit just proud of the face
    const spec: [number, number, number][] = [
      [-0.34, 0.3, 1],
      [-0.7, 0.26, -1],
      [-0.95, 0.17, 1],
      [-0.52, 0.22, -1],
      [-0.2, 0.2, 1],
      [-0.84, 0.2, -1],
    ];
    for (let i = 0; i < spec.length; i++) {
      const [zc, len, side] = spec[i];
      const sh = new THREE.Shape();
      const n = 10;
      sh.moveTo(-len / 2, -BH * 0.92);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const taper = Math.sin(Math.PI * Math.min(1, t * 1.15));
        const ragged = 0.55 + 0.45 * Math.abs(Math.sin(t * 7 + i * 2.1));
        sh.lineTo(-len / 2 + len * t, -BH * 0.92 + BH * 1.84 * (0.3 + 0.7 * taper * ragged));
      }
      sh.lineTo(len / 2, -BH * 0.92);
      sh.closePath();
      const geo = new THREE.ShapeGeometry(sh, 2);
      geo.rotateY(Math.PI / 2); // lay it into the plane of the blade
      const mesh = new THREE.Mesh(geo, blood);
      mesh.position.set(side * BX, 0, zc);
      mesh.visible = false;
      sword.add(mesh);
      this.smears.push(mesh);
    }
  }

  /** Camo bands, a hanging charm and a stuck-on sticker. */
  private dress() {
    const anchor = ANCHORS[this.def.kind];
    if (!anchor) return;

    if (this.camo.bands) {
      const band = makeInkMaterial({ ink: this.camo.accent, fill: true });
      const reach = anchor.muzzle[2];
      for (let i = 0; i < this.camo.bands; i++) {
        const t = (i + 1) / (this.camo.bands + 1);
        bx(0.115, 0.115, 0.028, anchor.muzzle[0], anchor.muzzle[1], reach * t, band, this.root);
      }
    }

    const charm = charmById(this.skin?.charm);
    if (charm) {
      const [sx, sy, sz] = anchor.stock;
      const pivot = new THREE.Group();
      pivot.position.set(sx + 0.09, sy - 0.02, sz);
      const mat = makeInkMaterial({ ink: charm.ink, fill: true });
      // the cord it hangs on, then the trinket at the bottom of it
      bx(0.012, 0.13, 0.012, 0, -0.065, 0, mat, pivot);
      if (charm.shape === "clip") {
        bx(0.015, 0.1, 0.015, 0, -0.18, 0, mat, pivot);
        bx(0.05, 0.015, 0.015, 0.018, -0.13, 0, mat, pivot);
        bx(0.05, 0.015, 0.015, 0.018, -0.23, 0, mat, pivot);
      } else if (charm.shape === "star") {
        const s = new THREE.Mesh(starGeo(5, 0.075, 0.032), mat);
        s.position.y = -0.19;
        pivot.add(s);
      } else if (charm.shape === "die") {
        bx(0.085, 0.085, 0.085, 0, -0.18, 0, mat, pivot);
      } else if (charm.shape === "blot") {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), mat);
        s.position.y = -0.18;
        pivot.add(s);
      } else {
        bx(0.07, 0.1, 0.012, 0, -0.185, 0, mat, pivot);
      }
      this.root.add(pivot);
      this.charmPivot = pivot;
    }

    const sticker = stickerById(this.skin?.sticker);
    if (sticker) {
      const mat = makeInkMaterial({ ink: sticker.ink, fill: true, side: THREE.DoubleSide });
      const decal = new THREE.Mesh(glyphGeo(sticker.glyph), mat);
      // flat against the left face of the receiver, facing outwards
      decal.position.set(-0.088, 0.04, -0.02);
      decal.rotation.y = -Math.PI / 2;
      decal.scale.setScalar(0.6);
      this.root.add(decal);
    }
  }

  /**
   * Bolt the gunsmith parts onto the model. Everything hangs off a per-weapon
   * anchor so one set of part shapes serves all eight guns, and anything that
   * lengthens the barrel drags the muzzle flash forward with it.
   */
  private fitAttachments() {
    const anchor = ANCHORS[this.def.kind];
    if (!anchor || !this.build_) return;
    const m = this.ink;
    const b = this.black;
    const at = (p: readonly [number, number, number]) => p;

    const sight = this.build_.sight;
    if (sight) {
      const [x, y, z] = at(anchor.sight);
      if (sight === "reddot") {
        bx(0.08, 0.06, 0.14, x, y - 0.02, z, b, this.root);
        bx(0.05, 0.05, 0.02, x, y + 0.02, z - 0.05, this.solid, this.root);
      } else if (sight === "holo") {
        bx(0.13, 0.03, 0.16, x, y - 0.05, z, b, this.root);
        bx(0.02, 0.1, 0.02, x - 0.055, y, z - 0.06, b, this.root);
        bx(0.02, 0.1, 0.02, x + 0.055, y, z - 0.06, b, this.root);
        bx(0.1, 0.02, 0.02, x, y + 0.04, z - 0.06, this.solid, this.root);
      } else if (sight === "scope4x") {
        cyl(0.075, 0.42, x, y + 0.02, z - 0.04, b, this.root);
        cyl(0.095, 0.06, x, y + 0.02, z - 0.24, b, this.root);
        bx(0.05, 0.09, 0.06, x, y - 0.06, z + 0.1, b, this.root);
        bx(0.05, 0.09, 0.06, x, y - 0.06, z - 0.16, b, this.root);
      } else {
        // canted irons: a folded post off to one side, nothing to look through
        bx(0.02, 0.09, 0.02, x + 0.06, y - 0.03, z - 0.1, b, this.root);
        bx(0.02, 0.07, 0.02, x + 0.06, y - 0.04, z + 0.1, b, this.root);
      }
    }

    const muzzle = this.build_.muzzle;
    if (muzzle) {
      const [x, y, z] = at(anchor.muzzle);
      if (muzzle === "suppressor") {
        cyl(0.062, 0.42, x, y, z - 0.19, b, this.root);
        this.flash.position.z = z - 0.4;
        this.flash.scale.multiplyScalar(0.3);
      } else if (muzzle === "compensator") {
        cyl(0.062, 0.14, x, y, z - 0.06, b, this.root);
        bx(0.14, 0.02, 0.09, x, y + 0.05, z - 0.06, b, this.root);
        this.flash.position.z = z - 0.13;
      } else if (muzzle === "brake") {
        cyl(0.058, 0.12, x, y, z - 0.05, b, this.root);
        bx(0.02, 0.05, 0.13, x - 0.07, y, z - 0.05, b, this.root);
        bx(0.02, 0.05, 0.13, x + 0.07, y, z - 0.05, b, this.root);
        this.flash.position.z = z - 0.11;
      } else if (muzzle === "longbarrel") {
        cyl(0.038, 0.34, x, y, z - 0.16, m, this.root);
        this.flash.position.z = z - 0.33;
      }
    }

    const mag = this.build_.mag;
    if (mag) {
      const [x, y, z] = at(anchor.mag);
      if (mag === "extmag") bx(0.09, 0.34, 0.13, x, y - 0.13, z, b, this.root);
      else if (mag === "fastmag") {
        bx(0.09, 0.16, 0.13, x, y - 0.04, z, b, this.root);
        bx(0.13, 0.03, 0.05, x, y - 0.12, z, m, this.root);
      } else if (mag === "heavymag") bx(0.13, 0.2, 0.17, x, y - 0.06, z, b, this.root);
      else bx(0.06, 0.16, 0.1, x, y - 0.04, z, m, this.root);
    }

    const stock = this.build_.stock;
    if (stock) {
      const [x, y, z] = at(anchor.stock);
      if (stock === "tacstock") {
        bx(0.09, 0.15, 0.3, x, y, z + 0.1, b, this.root);
        bx(0.07, 0.05, 0.2, x, y + 0.1, z + 0.06, m, this.root);
      } else if (stock === "lightstock") {
        bx(0.03, 0.03, 0.3, x, y + 0.07, z + 0.1, m, this.root);
        bx(0.03, 0.03, 0.3, x, y - 0.07, z + 0.1, m, this.root);
        bx(0.07, 0.17, 0.03, x, y, z + 0.25, m, this.root);
      }
      // nostock deliberately adds nothing
    }
  }

  private placeFlash(x: number, y: number, z: number, scale: number) {
    this.flash.add(new THREE.Mesh(starGeo(7, 0.16, 0.05), this.orange));
    const s2 = new THREE.Mesh(starGeo(5, 0.1, 0.04), this.orange);
    s2.rotation.y = Math.PI / 2;
    this.flash.add(s2);
    this.flash.position.set(x, y, z);
    this.flash.scale.setScalar(scale);
    this.flash.visible = false;
    this.root.add(this.flash);
  }

  private hand(x: number, y: number, z: number) {
    const hm = makeInkMaterial({ ink: INK.BLUE, shadeBias: -0.2 });
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), hm);
    s.position.set(x, y, z);
    this.root.add(s);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.45, 6), hm);
    arm.position.set(x + 0.12, y - 0.12, z + 0.18);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.4, -0.5, 0.7).normalize());
    this.root.add(arm);
  }

  /**
   * The sword's own pose. It blends to an absolute guard rather than adding an
   * offset, because the shared animator already scales the base rotation by how
   * far into the aim you are — the same offset would land differently depending
   * on how far the guard had come up.
   */
  private animateKatana(dt: number) {
    const g = this.blade;
    if (!g) return;
    const guard = damp(g.userData.guard ?? 0, this.blocking ? 1 : 0, 16, dt);
    g.userData.guard = guard;
    const s = this.comboStep % 2 === 0 ? 1 : -1;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    if (guard > 0.001) {
      // the sword comes in close and upright, between you and whatever is coming
      rx += 1.15 * guard;
      ry += 0.28 * guard;
      rz += 1.2 * guard;
    }
    if (this.slashT > 0) {
      const t = clamp(1 - this.slashT / SLASH_DUR, 0, 1);
      const e = t * t * (3 - 2 * t);
      rz += s * (1.3 - 2.7 * e);
      rx += 0.7 - 1.5 * e;
      ry += s * (-0.35 + 0.8 * e);
      g.position.x = s * (0.2 - 0.45 * e);
      g.position.y = 0.14 - 0.24 * e;
      g.position.z = -0.12 * Math.sin(t * Math.PI);
    } else {
      g.position.set(0, 0, 0);
    }
    if (this.parryT > 0) {
      // a flick of the wrist, not something that throws the whole pose around
      const e = Math.sin(clamp(this.parryT / PARRY_FLICK, 0, 1) * Math.PI);
      rz += this.parryDir * e * 0.42;
      ry += this.parryDir * e * 0.16;
      g.position.x += this.parryDir * e * 0.035;
    }
    g.rotation.set(rx, ry, rz);
    this.showBlood(dt);
  }

  /** Mark the blade — one more streak shows, and they dry off slowly. */
  bloody(amount = 0.34) {
    this.bloodLevel = clamp(this.bloodLevel + amount, 0, 1);
  }

  private showBlood(dt: number) {
    if (!this.smears.length) return;
    // it dries off slowly, so a bloody blade is a record of the last minute
    this.bloodLevel = Math.max(0, this.bloodLevel - 0.02 * dt);
    const showing = Math.round(this.bloodLevel * this.smears.length);
    for (let i = 0; i < this.smears.length; i++) this.smears[i].visible = i < showing;
  }

  /** Start a swing. Returns the direction it travels, for the arc effect. */
  startSlash() {
    this.slashT = SLASH_DUR;
    if (this.def.kind === "katana") {
      this.comboStep += 1;
      this.comboT = 0.9;
      return this.comboStep % 2 === 0 ? 1 : -1;
    }
    return 1;
  }

  /** A shot turned away by the guard. */
  parried(dir: number) {
    this.parryT = PARRY_FLICK;
    this.parryDir = dir;
  }

  equip() {
    this.root.visible = true;
    this.reloading = false;
    this.reloadT = 0;
    this.equipT = EQUIP_DUR;
  }
  unequip() {
    this.root.visible = false;
    this.reloading = false;
    this.blocking = false;
    this.burstLeft = 0;
  }

  addAmmo(n: number) {
    this.reserve = Math.min(this.def.maxReserve, this.reserve + n);
  }

  beginReload() {
    if (!this.def.isGun || this.reloading) return false;
    if (this.mag >= this.def.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = this.def.reloadDur;
    return true;
  }

  update(dt: number) {
    this.fireT = Math.max(0, this.fireT - dt);
    this.cycleT = Math.max(0, this.cycleT - dt);
    this.slashT = Math.max(0, this.slashT - dt);
    this.burstT = Math.max(0, this.burstT - dt);
    this.equipT = Math.max(0, this.equipT - dt);
    this.spreadCur = damp(this.spreadCur, this.def.spread, 6, dt);
    if (this.flash.visible) {
      this.flash.rotateZ(dt * 18);
      if (this.fireT < this.def.interval - 0.05) this.flash.visible = false;
    }
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        if (this.def.reloadType === "shells") {
          this.mag += 1;
          this.reserve -= 1;
          if (this.mag >= this.def.magSize || this.reserve <= 0) this.reloading = false;
          else this.reloadT = this.def.reloadDur;
        } else {
          const need = this.def.magSize - this.mag;
          const take = Math.min(need, this.reserve);
          this.mag += take;
          this.reserve -= take;
          this.reloading = false;
        }
      }
    }
    if (this.def.kind === "katana") this.animateKatana(dt);
    else if (this.blade) {
      const guard = this.blocking ? 1 : 0;
      this.blade.rotation.x = damp(this.blade.rotation.x, guard * -0.9 + (this.slashT > 0 ? 1.2 : 0), 16, dt);
      this.blade.rotation.z = damp(this.blade.rotation.z, this.slashT > 0 ? 0.8 : guard * -0.3, 18, dt);
    }
    if (this.edge) {
      // hold folded while the knife comes up, then snap out over the last third
      const p = clamp(1 - this.equipT / (EQUIP_DUR * 0.62), 0, 1);
      const out = 1 - (1 - p) ** 3;
      this.edge.position.z = BLADE_RETRACT * (1 - out);
    }
    if (this.def.kind === "katana") {
      this.comboT = Math.max(0, this.comboT - dt);
      if (this.comboT <= 0) this.comboStep = 0;
      this.parryT = Math.max(0, this.parryT - dt);
    }
    if (this.charmPivot) {
      // a slow idle sway, with a jolt every time the gun goes off
      this.charmT += dt;
      const jolt = this.fireT > 0 ? this.fireT / Math.max(0.05, this.def.interval) : 0;
      this.charmPivot.rotation.z = Math.sin(this.charmT * 2.3) * 0.16 + jolt * 0.5;
      this.charmPivot.rotation.x = Math.sin(this.charmT * 1.7 + 1) * 0.1;
    }
    if (this.blocking) this.blockT += dt;
    else this.blockT = 0;
  }
}

export interface PlayerHooks {
  world: World;
  input: Input;
  audio: AudioSys;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  onFire: (w: Weapon, origin: THREE.Vector3, dir: THREE.Vector3, ads: boolean) => void;
  onSlash: (origin: THREE.Vector3, dir: THREE.Vector3, dmg: number, heavy: boolean) => void;
  /** a shot turned away by a clean parry, sent back where it came from */
  onDeflect: (origin: THREE.Vector3, dir: THREE.Vector3, dmg: number) => void;
  /** things the grapple may hook and yank */
  grappleTargets?: () => GrappleTarget[];
  /** short line of advice for the HUD */
  tip?: (s: string) => void;
  onNade: (origin: THREE.Vector3, dir: THREE.Vector3, charge: number) => void;
  onHurt: (amount: number, from: THREE.Vector3 | null) => void;
  onDeath: () => void;
  /** weapons to carry; defaults to DEFAULT_LOADOUT */
  loadout?: WeaponKind[];
  /** per-weapon gunsmith builds */
  gunsmith?: Gunsmith;
  /** per-weapon camo, charm and sticker */
  wardrobe?: Wardrobe;
}

const G = 26;
const WALK = 6.6;
const SPRINT = 10.4;
const CROUCH = 3.5;
const ACCEL = 140;
const FRICTION = 8;
const AIR_ACCEL = 36;
/** air control tops out well below run speed: you steer, you do not accelerate */
const AIR_CAP = 7.5;
const JUMP = 9.4;
/** how fast you have to be going before a crouch turns into a slide */
const SLIDE_ENTRY = 6.3;
/** a slide is boosted up to this, never past it */
const SLIDE_CAP = 12.8;
const SLIDE_DRAG = 6.5;
const DOWN = new THREE.Vector3(0, -1, 0);
const STAND_H = 1.72;
const CROUCH_H = 1.08;
const EYE_STAND = 1.58;
const EYE_CROUCH = 0.9;

export class Player {
  hooks: PlayerHooks;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  hp = 120;
  maxHp = 120;
  alive = true;
  onGround = false;
  crouching = false;
  sliding = false;
  slideT = 0;
  height = STAND_H;
  eyeH = EYE_STAND;
  eye = new THREE.Vector3();
  center = new THREE.Vector3();
  forward = new THREE.Vector3(0, 0, -1);
  right = new THREE.Vector3(1, 0, 0);
  weapons: Weapon[];
  weaponIndex = 0;
  weapon: Weapon;
  grenades = 3;
  nadeCharge = 0;
  nadeHeld = false;
  nadeCd = 0;
  lastDamageT = 10;
  hurtFx = 0;
  flashFx = 0;
  bobPhase = 0;
  bobAmt = 0;
  coyote = 0;
  jumpBuf = 0;
  /** seconds since the feet left the ground */
  airT = 0;
  /** seconds since the last wall contact, for the wall-jump window */
  private wallTouch = 9;
  private wallN: THREE.Vector3 | null = null;
  private hitWall = false;
  private wallJumpCd = 0;
  private mantleCd = 0;
  /** brief low-friction window after a fast landing */
  private landGraceT = 0;
  /** metres walked since the last footstep */
  private stepDist = 0;
  grapple!: Grapple;
  /** false when the operator skill in this loadout is not the grappler */
  grappleEnabled = true;
  /** true while a skill has replaced the gun in your hands */
  weaponHidden = false;
  /** which skill model to hold instead, if any */
  private skillModels = new Map<string, THREE.Group>();
  private skillShown = "";
  dashCd = 0;
  airJumps = 1;
  sprinting = false;
  aiming = false;
  recoilP = new Spring(190, 17);
  recoilY = new Spring(190, 17);
  fovKick = new Spring(220, 14);
  landDip = new Spring(170, 15);
  shake = 0;
  deathT = 0;
  rig = new THREE.Group();
  lookDelta = new THREE.Vector2();
  meleeStreak = 0;
  /** which way the last swing travelled, for the arc the engine draws */
  slashDir = 1;
  /** true once this life has fired, thrown or swung — closes the loadout window */
  spentResource = false;
  /** aim-down-sights as a toggle rather than hold; a settings choice */
  adsToggle = false;
  private adsOn = false;
  private adsBlend = 0;
  private gunsmith: Gunsmith = {};
  private wardrobe: Wardrobe = {};
  private lastGround = true;

  constructor(hooks: PlayerHooks) {
    this.hooks = hooks;
    this.gunsmith = hooks.gunsmith ?? {};
    this.wardrobe = hooks.wardrobe ?? {};
    this.weapons = sanitizeLoadout(hooks.loadout ?? DEFAULT_LOADOUT).map(
      (k) => new Weapon(k, this.gunsmith[k], this.wardrobe[k]),
    );
    this.weapon = this.weapons[0];
    this.weapon.equip();
    hooks.camera.add(this.rig);
    for (const w of this.weapons) this.rig.add(w.root);
    hooks.scene.add(hooks.camera);
    this.buildSkillModels();
    this.grapple = new Grapple({
      world: hooks.world,
      scene: hooks.scene,
      audio: hooks.audio,
      input: hooks.input,
      eye: () => this.eye,
      center: () => this.center,
      right: () => this.right,
      forward: () => this.forward,
      pos: () => this.pos,
      vel: () => this.vel,
      height: () => this.height,
      onGround: () => this.onGround,
      leaveGround: () => {
        this.onGround = false;
      },
      moveY: () => this.hooks.input.move.y,
      targets: () => this.hooks.grappleTargets?.() ?? [],
      kickFov: (v) => this.fovKick.kick(v),
      tip: (s) => this.hooks.tip?.(s),
    });
  }

  reset(p: THREE.Vector3) {
    this.grapple.reset();
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.hurtFx = 0;
    this.flashFx = 0;
    this.crouching = false;
    this.sliding = false;
    this.height = STAND_H;
    this.eyeH = EYE_STAND;
    this.grenades = 3;
    this.nadeCharge = 0;
    this.nadeHeld = false;
    this.deathT = 0;
    this.lastDamageT = 10;
    this.dashCd = 0;
    this.airJumps = 1;
    this.meleeStreak = 0;
    this.spentResource = false;
    for (const w of this.weapons) {
      if (w.def.isGun) {
        w.mag = w.def.magSize;
        w.reserve = w.def.reserve;
        w.reloading = false;
        w.burstLeft = 0;
      }
    }
    this.switchTo(0, true);
    this.rig.visible = true;
  }

  switchTo(i: number, silent = false) {
    if (i < 0 || i >= this.weapons.length) return;
    if (i === this.weaponIndex && !silent) return;
    this.weapon.unequip();
    this.adsOn = false; // a toggled scope must not survive a weapon change
    this.weaponIndex = i;
    this.weapon = this.weapons[i];
    this.weapon.equip();
    if (!silent) this.hooks.audio.switchWeapon();
  }

  nextWeapon(dir: number) {
    this.switchTo((this.weaponIndex + dir + this.weapons.length) % this.weapons.length);
  }

  private clearWeapons() {
    for (const w of this.weapons) {
      w.unequip();
      this.rig.remove(w.root);
      w.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        // each weapon builds its own materials off its camo, so those go too
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
    }
  }

  /** Swap the whole kit — used by the brief window after a respawn. */
  setLoadout(kinds: WeaponKind[], gunsmith?: Gunsmith, wardrobe?: Wardrobe) {
    this.clearWeapons();
    if (gunsmith) this.gunsmith = gunsmith;
    if (wardrobe) this.wardrobe = wardrobe;
    this.weapons = sanitizeLoadout(kinds).map((k) => new Weapon(k, this.gunsmith[k], this.wardrobe[k]));
    for (const w of this.weapons) this.rig.add(w.root);
    this.weaponIndex = 0;
    this.weapon = this.weapons[0];
    this.weapon.equip();
    this.hooks.audio.switchWeapon();
  }

  /**
   * Take a gun off the ground. Already carrying it? Top up the ammo instead of
   * pointlessly swapping the same weapon in.
   */
  pickUpWeapon(kind: WeaponKind): boolean {
    const def = DEFS[kind];
    if (!def || !def.isGun) return false;

    const have = this.weapons.findIndex((w) => w.def.kind === kind);
    if (have >= 0) {
      this.weapons[have].addAmmo(Math.round(def.magSize * 2));
      return true;
    }
    // replace what is in your hands if that is a gun, else the first gun slot
    let slot = this.weapon.def.isGun ? this.weaponIndex : this.weapons.findIndex((w) => w.def.isGun);
    if (slot < 0) slot = 0;

    const old = this.weapons[slot];
    old.unequip();
    this.rig.remove(old.root);
    old.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      // each weapon builds its own materials off its camo, so those go too
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
    });

    // a gun off the ground still gets your build for it — the parts are yours
    const fresh = new Weapon(kind, this.gunsmith[kind], this.wardrobe[kind]);
    this.weapons[slot] = fresh;
    this.rig.add(fresh.root);
    if (this.weaponIndex === slot) {
      this.weapon = fresh;
      fresh.equip();
    }
    this.hooks.audio.switchWeapon();
    return true;
  }

  takeDamage(amount: number, from: THREE.Vector3 | null) {
    if (!this.alive) return;
    if (!this.weapon.def.isGun && this.weapon.blocking && from) {
      const to = new THREE.Vector3().subVectors(from, this.eye).normalize();
      if (to.dot(this.forward) > 0.45) {
        // A guard raised in the last moment is a clean parry: it turns the shot
        // away entirely and sends it back the way it came. Hold the guard up
        // indefinitely and it is only a block, which still costs you.
        const clean = this.weapon.def.kind === "katana" && this.weapon.blockT < PARRY_WINDOW;
        if (clean) {
          this.weapon.parried(to.dot(this.right) > 0 ? 1 : -1);
          this.hooks.onDeflect(this.eye.clone(), to, amount);
          amount = 0;
        } else amount *= 0.35;
        this.hooks.audio.parry();
        this.flashFx = 0.4;
        if (amount <= 0) {
          this.hooks.input.rumble(0.5, 0.4, 90);
          return;
        }
      }
    }
    this.hp -= amount;
    this.lastDamageT = 0;
    this.hurtFx = Math.min(1, this.hurtFx + amount / 38);
    this.shake += 0.18 + amount / 80;
    this.hooks.audio.hurt();
    this.hooks.input.rumble(0.8, 0.5, 140);
    this.hooks.onHurt(amount, from);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.deathT = 0;
    this.rig.visible = false;
    this.hooks.audio.die();
    this.hooks.onDeath();
  }

  addHp(n: number) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  /**
   * The things a skill puts in your hands instead of a gun. Built once and
   * hidden, since a skill can come up several times in a match.
   */
  private buildSkillModels() {
    const ink = () => makeInkMaterial({ ink: INK.BLUE, shadeBias: -0.15 });
    const dark = () => makeInkMaterial({ ink: INK.BLACK, shadeBias: -0.1 });

    const flame = new THREE.Group();
    flame.scale.setScalar(0.48);
    cyl(0.075, 0.7, 0, 0.02, -0.42, ink(), flame); // barrel
    cyl(0.11, 0.16, 0, 0.02, -0.78, dark(), flame); // flared nozzle
    bx(0.1, 0.2, 0.16, 0, -0.14, 0.06, dark(), flame); // grip
    cyl(0.13, 0.42, 0.16, 0.06, 0.34, ink(), flame, "z"); // fuel bottle slung back
    bx(0.03, 0.03, 0.34, 0.1, 0.04, 0.06, dark(), flame); // hose
    flame.visible = false;
    this.rig.add(flame);
    this.skillModels.set("flamethrower", flame);

    const bow = new THREE.Group();
    bow.scale.setScalar(0.48);
    // two limbs and a string, held out to the left the way a bow is
    bx(0.03, 0.5, 0.03, -0.1, 0.34, -0.3, ink(), bow).rotation.x = 0.35;
    bx(0.03, 0.5, 0.03, -0.1, -0.3, -0.3, ink(), bow).rotation.x = -0.35;
    bx(0.05, 0.24, 0.06, -0.1, 0.02, -0.3, dark(), bow);
    bx(0.012, 0.012, 1.0, -0.1, 0.02, -0.18, dark(), bow); // the string, drawn back
    bx(0.03, 0.03, 0.6, -0.02, 0.02, -0.34, ink(), bow); // nocked bolt
    bow.visible = false;
    this.rig.add(bow);
    this.skillModels.set("sparrow", bow);
  }

  /** Show the model a skill puts in your hands, or none. */
  setSkillModel(name: string) {
    if (name === this.skillShown) return;
    const prev = this.skillModels.get(this.skillShown);
    if (prev) prev.visible = false;
    this.skillShown = name;
    const next = this.skillModels.get(name);
    if (next) next.visible = true;
  }

  /**
   * Ledge grab. Look for a wall just in front of your chest, then a walkable top
   * within reach above it with room to stand, and if both are there give
   * yourself exactly the upward velocity needed to clear it.
   */
  private tryMantle() {
    const world = this.hooks.world;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const fwd = new THREE.Vector3(fx, 0, fz);
    const chest = new THREE.Vector3(this.pos.x, this.pos.y + 1.0, this.pos.z);
    if (!world.raycast(chest, fwd, 0.95)) return;

    const over = new THREE.Vector3(this.pos.x + fx * 0.95, this.pos.y + 2.75, this.pos.z + fz * 0.95);
    const top = world.raycast(over, DOWN, 2.25);
    if (!top || top.ny < 0.5) return;
    const dy = top.point.y - this.pos.y;
    if (dy < 0.5 || dy > 2.4) return;
    // no point pulling up into something solid
    const stand = new THREE.Vector3(over.x, top.point.y + 0.08, over.z);
    if (world.blocked(stand, 0.34, CROUCH_H)) return;

    this.vel.y = Math.min(11, Math.sqrt(2 * G * (dy + 0.45)));
    this.vel.x = fx * 3.2;
    this.vel.z = fz * 3.2;
    this.mantleCd = 0.7;
    this.hooks.audio.mantle();
    this.landDip.kick(-2.5);
    this.fovKick.kick(45);
  }

  private wishDir() {
    const i = this.hooks.input;
    const f = this.forward.clone();
    f.y = 0;
    f.normalize();
    const r = this.right.clone();
    r.y = 0;
    r.normalize();
    const w = new THREE.Vector3();
    w.addScaledVector(f, i.move.y);
    w.addScaledVector(r, i.move.x);
    if (w.lengthSq() > 1) w.normalize();
    return w;
  }

  /** Piloting a scorestreak: the body stays put and ignores input. */
  frozen = false;

  update(dt: number) {
    const i = this.hooks.input;
    if (this.frozen && this.alive) {
      this.vel.x = 0;
      this.vel.z = 0;
      this.hooks.world.moveAABB(this.pos, this.vel, 0.34, this.height, dt, G);
      this.eye.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
      this.center.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
      return;
    }
    if (!this.alive) {
      this.deathT += dt;
      this.pitch = damp(this.pitch, 0.5, 3, dt);
      this.syncCamera(dt);
      return;
    }

    this.lookDelta.set(i.look.x, i.look.y);
    this.yaw += i.look.x;
    this.pitch = clamp(this.pitch + i.look.y, -1.45, 1.45);

    if (this.adsToggle) {
      if (i.pressed("aim")) this.adsOn = !this.adsOn;
    } else {
      this.adsOn = i.down("aim");
    }
    this.aiming = this.adsOn && this.weapon.def.isGun;
    this.weapon.blocking = !this.weapon.def.isGun && this.adsOn;

    if (i.pressed("slot1")) this.switchTo(0);
    if (i.pressed("slot2")) this.switchTo(1);
    if (i.pressed("slot3")) this.switchTo(2);
    if (i.pressed("slot4")) this.switchTo(3);
    if (i.pressed("nextWeapon")) this.nextWeapon(1);
    if (i.pressed("prevWeapon")) this.nextWeapon(-1);
    if (i.pressed("melee") && this.weapon.def.isGun) {
      const mi = this.weapons.findIndex((w) => !w.def.isGun);
      if (mi >= 0) this.switchTo(mi);
    }

    const crouchDown = i.down("crouch");
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    // A slide is a speed thing, not a timer: you have to be moving to start one,
    // it bleeds off, and it ends the moment you stand up or run out of momentum.
    if (i.pressed("crouch") && this.onGround && hspeed > SLIDE_ENTRY && !this.sliding) {
      this.sliding = true;
      this.slideT = 0;
      const boost = clamp(SLIDE_CAP - hspeed, 0, 4.5);
      this.vel.x += (this.vel.x / hspeed) * boost;
      this.vel.z += (this.vel.z / hspeed) * boost;
      this.hooks.audio.slide();
      this.fovKick.kick(75);
      this.landDip.kick(-2.5);
    }
    if (this.sliding) {
      this.slideT += dt;
      if (!crouchDown || hspeed < 3.5 || this.airT > 0.35 || this.grapple.attached) this.sliding = false;
    }
    this.sprinting = i.down("sprint") && !this.aiming && !crouchDown && i.move.y > 0.3;
    this.crouching = (crouchDown && this.onGround) || this.sliding;
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    this.height = damp(this.height, targetH, 14, dt);
    this.eyeH = damp(this.eyeH, this.crouching ? EYE_CROUCH : EYE_STAND, 14, dt);

    if (i.pressed("jump")) this.jumpBuf = 0.15;
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.coyote = this.onGround ? 0.13 : Math.max(0, this.coyote - dt);
    this.airT = this.onGround ? 0 : this.airT + dt;
    this.wallJumpCd = Math.max(0, this.wallJumpCd - dt);
    this.mantleCd = Math.max(0, this.mantleCd - dt);
    this.landGraceT = Math.max(0, this.landGraceT - dt);
    // a wall only counts while you are off the ground, and only for a moment
    if (this.hitWall && !this.onGround) this.wallTouch = 0;
    else this.wallTouch += dt;

    const wish = this.wishDir();
    const wishLen = Math.hypot(wish.x, wish.z);
    if (this.jumpBuf > 0) {
      if (this.grapple.attached) {
        this.jumpBuf = 0;
        this.grapple.detach(true);
      } else if (this.onGround || this.coyote > 0) {
        this.jumpBuf = 0;
        this.coyote = 0;
        this.vel.y = JUMP;
        this.onGround = false;
        this.airJumps = 1;
        // jumping out of a slide keeps the speed you built up
        if (this.sliding) {
          this.vel.x *= 1.06;
          this.vel.z *= 1.06;
          this.sliding = false;
        }
        this.hooks.audio.jump();
        this.landDip.kick(-1.2);
      } else if (this.wallTouch < 0.12 && this.wallJumpCd <= 0 && this.vel.y < 7 && this.wallN) {
        // kick off the wall: away from it, plus a push in the direction you face
        this.jumpBuf = 0;
        this.wallJumpCd = 0.35;
        const n = this.wallN;
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        this.vel.x = n.x * 7.5 + this.vel.x * 0.35 + fx * 2.5;
        this.vel.z = n.z * 7.5 + this.vel.z * 0.35 + fz * 2.5;
        this.vel.y = 9.2;
        this.airJumps = 1;
        this.hooks.audio.wallJump();
        this.roll += n.dot(this.right) > 0 ? -0.1 : 0.1;
        this.fovKick.kick(60);
        this.landDip.kick(-1.5);
      } else if (this.airJumps > 0) {
        // second beat of height, redirected toward wherever you are steering
        this.jumpBuf = 0;
        this.airJumps -= 1;
        this.vel.y = JUMP * 0.92;
        if (wishLen > 0) {
          const cur = this.vel.x * wish.x + this.vel.z * wish.z;
          const add = Math.max(0, 7.5 * wishLen - cur);
          this.vel.x += wish.x * add;
          this.vel.z += wish.z * add;
        }
        this.hooks.audio.jump();
        this.fovKick.kick(48);
        this.landDip.kick(-1.4);
      }
    }
    // crouch in the air is the air dash, same as the dedicated key
    if ((i.pressed("dash") || (i.pressed("crouch") && !this.onGround)) && this.dashCd <= 0) {
      const f = this.forward.clone();
      f.y = clamp(f.y, -0.15, 0.35);
      f.normalize();
      this.vel.addScaledVector(f, 10);
      this.vel.y = Math.max(this.vel.y, 2);
      this.dashCd = 1.1;
      this.hooks.audio.dash();
      this.fovKick.kick(80);
    }
    this.dashCd = Math.max(0, this.dashCd - dt);
    // the rope pulls and constrains before the body is integrated
    if (this.grappleEnabled) this.grapple.update(dt);
    else if (this.grapple.state !== "idle") this.grapple.detach(false);
    // hauling yourself onto a ledge you ran into, rather than bouncing off it
    if (!this.onGround && this.mantleCd <= 0 && i.move.y > 0.3 && this.vel.y < 8 && !this.grapple.attached) {
      this.tryMantle();
    }

    const base = this.crouching && !this.sliding ? CROUCH : this.sprinting ? SPRINT : WALK;
    // what you are carrying sets the pace — an LMG is not an SMG
    const speed = base * this.weapon.def.moveMul;
    if (this.onGround) {
      this.airJumps = 1;
      if (this.sliding) {
        // a slide keeps whatever speed it started with and bleeds off slowly;
        // steering only turns it, it can never add speed
        const sp = Math.hypot(this.vel.x, this.vel.z);
        if (sp > 0) {
          const ns = Math.max(0, sp - SLIDE_DRAG * dt) / sp;
          this.vel.x *= ns;
          this.vel.z *= ns;
        }
        if (wishLen > 0) {
          this.vel.x += wish.x * 6 * dt;
          this.vel.z += wish.z * 6 * dt;
          const n2 = Math.hypot(this.vel.x, this.vel.z);
          if (n2 > sp && n2 > 0) {
            this.vel.x *= sp / n2;
            this.vel.z *= sp / n2;
          }
        }
      } else {
        // landing fast buys a moment of low friction, so a run doesn't die on touchdown
        const fr = FRICTION * (this.landGraceT > 0 ? 0.25 : 1);
        const sp = Math.hypot(this.vel.x, this.vel.z);
        if (sp > 0) {
          const ns = Math.max(0, sp - sp * fr * dt) / sp;
          this.vel.x *= ns;
          this.vel.z *= ns;
        }
        if (wishLen > 0) {
          const cur = this.vel.x * wish.x + this.vel.z * wish.z;
          const add = Math.min(speed * wishLen - cur, ACCEL * dt);
          if (add > 0) {
            this.vel.x += wish.x * add;
            this.vel.z += wish.z * add;
          }
        }
      }
    } else if (wishLen > 0) {
      // air control adds only up to a low cap, so you steer without accelerating
      const cur = this.vel.x * wish.x + this.vel.z * wish.z;
      const add = Math.min(AIR_CAP * wishLen - cur, AIR_ACCEL * dt);
      if (add > 0) {
        this.vel.x += wish.x * add;
        this.vel.z += wish.z * add;
      }
    }

    const fallVel = this.vel.y;
    // hanging on the rope takes a little of the weight off
    const col = this.hooks.world.moveAABB(this.pos, this.vel, 0.34, this.height, dt, G * (this.grapple.attached ? 0.88 : 1));
    this.hitWall = col.hitWall;
    if (col.wallNormal) this.wallN = col.wallNormal;
    if (col.onGround && !this.lastGround) {
      const impact = clamp(-fallVel / 14, 0, 1.5);
      this.landDip.kick(-impact * 6 - 0.5);
      this.hooks.audio.land();
      this.airJumps = 1;
      this.shake += impact * 0.15;
      if (Math.hypot(this.vel.x, this.vel.z) > 9) this.landGraceT = 0.4;
    }
    this.lastGround = this.onGround;
    this.onGround = col.onGround;

    this.eye.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
    this.center.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
    this.forward.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    const spd = Math.hypot(this.vel.x, this.vel.z);
    // footsteps land by distance covered, not on a timer, so they stay in step
    // with the legs whether you are walking, sprinting or being dragged along
    const moving = this.onGround && spd > 0.6 && !this.sliding;
    this.bobAmt = damp(this.bobAmt, moving ? Math.min(1, spd / SPRINT) : 0, 8, dt);
    if (moving) {
      this.bobPhase += dt * (8 + spd * 1.2);
      this.stepDist += spd * dt;
      if (this.stepDist > (this.sprinting ? 2.5 : 2.0)) {
        this.stepDist = 0;
        this.hooks.audio.step();
      }
    }

    this.lastDamageT += dt;
    if (this.lastDamageT > 4.2 && this.hp < this.maxHp && !this.sprinting && this.grapple.state === "idle") {
      this.hp = Math.min(this.maxHp, this.hp + 12 * dt);
    }
    this.hurtFx = Math.max(0, this.hurtFx - dt * 1.4);
    this.flashFx = Math.max(0, this.flashFx - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 2.5);

    // combat
    this.weapon.update(dt);
    if (i.pressed("reload")) {
      if (this.weapon.beginReload()) this.hooks.audio.reload();
    }
    const canFire = !this.weapon.reloading && this.weapon.fireT <= 0 && this.weapon.cycleT <= 0;
    const fireHeld = i.down("fire");
    const firePress = i.pressed("fire");
    if (!this.weapon.def.isGun) {
      const w = this.weapon;
      const katana = w.def.kind === "katana";
      // The katana chains: while a combo is live, holding the trigger keeps
      // swinging. The switchblade is one deliberate stab per press.
      const wantSlash = katana ? firePress || (fireHeld && w.comboStep > 0) : firePress;
      if (wantSlash && canFire && !w.blocking) {
        w.fireT = w.def.interval;
        this.spentResource = true;
        const dir = w.startSlash();
        this.hooks.audio.blade();
        this.recoilP.kick(w.def.camKick[0] * 20);
        const heavy = this.meleeStreak >= 3;
        this.hooks.onSlash(this.eye.clone(), this.forward.clone(), w.def.damage * (heavy ? 1.8 : 1), heavy);
        // a swing started at a sprint or in the air carries you into it
        if (katana && (this.sprinting || !this.onGround)) {
          this.vel.addScaledVector(this.forward, 5.5);
          this.fovKick.kick(45);
        }
        this.slashDir = dir;
        if (heavy) {
          this.meleeStreak = 0;
          this.vel.addScaledVector(this.forward, 8);
          this.fovKick.kick(90);
        }
      }
    } else {
      const w = this.weapon;
      const burst = w.def.burst ?? 0;
      if (burst > 0) {
        // a trigger pull commits the whole burst; the interval only applies once it is spent
        if (firePress && canFire && w.burstLeft <= 0) {
          if (w.mag <= 0) {
            if (w.beginReload()) this.hooks.audio.reload();
          } else w.burstLeft = burst;
        }
        if (w.burstLeft > 0 && w.burstT <= 0 && !w.reloading) {
          if (w.mag <= 0) w.burstLeft = 0;
          else {
            this.shoot();
            w.burstLeft -= 1;
            w.burstT = w.def.burstDelay ?? 0.07;
          }
        }
      } else if ((w.def.auto ? fireHeld : firePress) && canFire) {
        if (w.mag <= 0) {
          if (w.beginReload()) this.hooks.audio.reload();
        } else {
          this.shoot();
        }
      }
    }

    this.nadeCd = Math.max(0, this.nadeCd - dt);
    if (i.down("grenade") && this.grenades > 0 && this.nadeCd <= 0) {
      this.nadeHeld = true;
      this.nadeCharge = Math.min(1, this.nadeCharge + dt * 0.9);
    }
    if (this.nadeHeld && (i.released("grenade") || this.nadeCharge >= 1)) {
      this.throwNade();
    }

    this.syncCamera(dt);
    this.animateGun(dt);
  }

  private shoot() {
    const w = this.weapon;
    this.spentResource = true;
    w.mag -= 1;
    w.fireT = w.def.interval;
    if (w.def.cycleDur) w.cycleT = w.def.cycleDur;
    w.flash.visible = true;
    w.spreadCur = Math.min(w.def.spreadMax, w.spreadCur + w.def.spreadKick);
    this.pitch -= w.def.camKick[0] * 0.55;
    this.recoilP.kick(w.def.camKick[0] * 22);
    this.recoilY.kick((Math.random() - 0.5) * w.def.camKick[1] * 30);
    this.fovKick.kick(w.def.fovKick * 8);
    this.shake += 0.04;
    if (w.def.quiet) this.hooks.audio.suppressed();
    else if (w.def.kind === "shotgun") this.hooks.audio.shotgun();
    else if (w.def.kind === "sniper") this.hooks.audio.sniper();
    else this.hooks.audio.shot();
    this.hooks.input.rumble(0.35, 0.5, 50);
    const ads = this.aiming;
    const spread = (ads ? w.def.adsSpread : w.spreadCur) + Math.hypot(this.vel.x, this.vel.z) * 0.001;
    this.hooks.onFire(w, this.eye.clone(), this.forward.clone(), ads);
    void spread;
    if (w.mag <= 0) {
      if (w.beginReload()) this.hooks.audio.reload();
    }
  }

  aimDir(spread: number) {
    const d = this.forward.clone();
    if (spread > 0) {
      d.addScaledVector(this.right, rand(-spread, spread));
      d.y += rand(-spread, spread);
      d.normalize();
    }
    return d;
  }

  private throwNade() {
    this.nadeHeld = false;
    if (this.grenades <= 0) {
      this.nadeCharge = 0;
      return;
    }
    this.grenades -= 1;
    this.spentResource = true;
    this.nadeCd = 0.6;
    this.hooks.audio.nade();
    this.hooks.onNade(this.eye.clone(), this.forward.clone(), this.nadeCharge);
    this.nadeCharge = 0;
  }

  private syncCamera(dt: number) {
    this.recoilP.update(dt);
    this.recoilY.update(dt);
    this.fovKick.update(dt);
    this.landDip.update(dt);
    const cam = this.hooks.camera;
    const bobX = Math.sin(this.bobPhase) * 0.03 * this.bobAmt;
    const sx = (Math.random() - 0.5) * this.shake * 0.08;
    const sy = (Math.random() - 0.5) * this.shake * 0.08;
    cam.position.set(this.eye.x + bobX + sx, this.eye.y + this.landDip.value * 0.01 + sy, this.eye.z);
    cam.rotation.y = this.yaw + this.recoilY.value * 0.01;
    cam.rotation.x = this.pitch + this.recoilP.value * 0.01;
    const strafe = this.hooks.input.move.x;
    this.roll = damp(this.roll, -strafe * 0.045 - this.recoilY.value * 0.002, 10, dt);
    cam.rotation.z = this.roll;
    const ads = this.aiming ? 1 : 0;
    const baseFov = 82;
    const adsFov = this.weapon.def.adsFov;
    cam.fov = damp(cam.fov, lerpFov(baseFov, adsFov, ads) + this.fovKick.value * 0.04, this.weapon.def.adsSpeed, dt);
    cam.updateProjectionMatrix();
  }

  private animateGun(dt: number) {
    const w = this.weapon;
    // the gun eases into the shoulder at the weapon's own aim speed, so a 4x
    // scope visibly takes longer to settle than a red dot
    this.adsBlend = damp(this.adsBlend, this.aiming ? 1 : 0, w.def.adsSpeed, dt);
    const ads = this.adsBlend;
    const sprint = this.sprinting && !this.aiming ? 1 : 0;
    const base = new THREE.Vector3(0.22, -0.18, -0.38);
    const aim = new THREE.Vector3(0.0, -0.14, -0.32);
    const p = w.root.position;
    p.lerpVectors(base, aim, ads);
    // sprinting swings the gun down and across so it reads instantly as "running"
    p.x += Math.sin(this.bobPhase) * 0.012 * this.bobAmt * (1 - ads) + sprint * 0.17;
    p.y += Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobAmt * (1 - ads) - sprint * 0.2 + this.landDip.value * 0.004;
    p.z += sprint * 0.1;
    w.root.rotation.set(
      0.04 * (1 - ads) + sprint * 0.95 + this.recoilP.value * 0.015,
      -sprint * 0.85 + this.lookDelta.x * 0.4,
      this.lookDelta.x * -0.5 + this.recoilY.value * 0.02 + this.slideT * 0.1 + sprint * 0.35,
    );
    // swing the new weapon up from below rather than popping it into frame
    if (w.equipT > 0) {
      const e = (w.equipT / EQUIP_DUR) ** 2;
      p.x += e * 0.14;
      p.y -= e * 0.55;
      p.z += e * 0.18;
      w.root.rotation.x += e * 1.05;
      w.root.rotation.y += e * 0.35;
      w.root.rotation.z += e * 0.6;
    }
    if (this.weaponHidden) w.root.visible = false;
    else if (w.def.kind === "sniper" && ads > 0.8) w.root.visible = false;
    else w.root.visible = this.alive;
    void dt;
  }
}

function lerpFov(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
