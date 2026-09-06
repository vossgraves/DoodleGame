import * as THREE from "three";
import { clamp, damp, rand, Spring } from "./math";
import { World } from "./physics";
import { INK, makeInkMaterial } from "./renderer";
import type { Input } from "./input";
import type { AudioSys } from "./audio";

export type WeaponKind =
  | "rifle"
  | "carbine"
  | "smg"
  | "lmg"
  | "shotgun"
  | "sniper"
  | "revolver"
  | "pistol"
  | "knife";

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
  /** rounds committed per trigger pull; 0 or absent means not a burst weapon */
  burst?: number;
  burstDelay?: number;
}

const DEFS: Record<WeaponKind, WeaponDef> = {
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
    falloff: null,
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
    falloff: null,
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
    falloff: null,
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
    falloff: null,
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
    falloff: null,
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

/** Every weapon, for loadout UIs. Guns first, melee last. */
export const WEAPONS: { kind: WeaponKind; name: string; hint: string; isGun: boolean }[] = (
  ["rifle", "carbine", "smg", "lmg", "shotgun", "sniper", "revolver", "pistol", "knife"] as WeaponKind[]
).map((k) => ({ kind: k, name: DEFS[k].name, hint: DEFS[k].hint, isGun: DEFS[k].isGun }));

export const GUN_KINDS = WEAPONS.filter((w) => w.isGun).map((w) => w.kind);
export const MELEE_KINDS = WEAPONS.filter((w) => !w.isGun).map((w) => w.kind);
export const DEFAULT_LOADOUT: WeaponKind[] = ["rifle", "shotgun", "sniper", "knife"];

/** Names that used to exist, so an old saved loadout still works. */
const LEGACY_KINDS: Record<string, WeaponKind> = { katana: "knife" };

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
  burstLeft = 0;
  burstT = 0;
  /** counts down while the gun is being swung up into view */
  equipT = 0;
  private ink: THREE.ShaderMaterial;
  private solid: THREE.ShaderMaterial;
  private orange: THREE.ShaderMaterial;
  private black: THREE.ShaderMaterial;

  constructor(kind: WeaponKind) {
    this.def = { ...DEFS[kind] };
    this.mag = this.def.magSize;
    this.reserve = this.def.reserve;
    this.spreadCur = this.def.spread;
    this.ink = makeInkMaterial({ ink: INK.BLUE, shadeBias: -0.15 });
    this.solid = makeInkMaterial({ ink: INK.BLUE, fill: true });
    this.orange = makeInkMaterial({ ink: INK.ORANGE, fill: true, side: THREE.DoubleSide });
    this.black = makeInkMaterial({ ink: INK.BLACK, shadeBias: -0.1 });
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
    this.root.visible = false;
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
    if (this.blade) {
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
  onNade: (origin: THREE.Vector3, dir: THREE.Vector3, charge: number) => void;
  onHurt: (amount: number, from: THREE.Vector3 | null) => void;
  onDeath: () => void;
  /** weapons to carry; defaults to DEFAULT_LOADOUT */
  loadout?: WeaponKind[];
}

const G = 26;
const WALK = 6.6;
const SPRINT = 10.4;
const CROUCH = 3.5;
const ACCEL = 42;
const AIR_ACCEL = 18;
const JUMP = 9.4;
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
  private lastGround = true;

  constructor(hooks: PlayerHooks) {
    this.hooks = hooks;
    this.weapons = sanitizeLoadout(hooks.loadout ?? DEFAULT_LOADOUT).map((k) => new Weapon(k));
    this.weapon = this.weapons[0];
    this.weapon.equip();
    hooks.camera.add(this.rig);
    for (const w of this.weapons) this.rig.add(w.root);
    hooks.scene.add(hooks.camera);
  }

  reset(p: THREE.Vector3) {
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
    this.weaponIndex = i;
    this.weapon = this.weapons[i];
    this.weapon.equip();
    if (!silent) this.hooks.audio.switchWeapon();
  }

  nextWeapon(dir: number) {
    this.switchTo((this.weaponIndex + dir + this.weapons.length) % this.weapons.length);
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
    });

    const fresh = new Weapon(kind);
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
        amount *= 0.35;
        this.hooks.audio.parry();
        this.flashFx = 0.4;
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

  update(dt: number) {
    const i = this.hooks.input;
    if (!this.alive) {
      this.deathT += dt;
      this.pitch = damp(this.pitch, 0.5, 3, dt);
      this.syncCamera(dt);
      return;
    }

    this.lookDelta.set(i.look.x, i.look.y);
    this.yaw += i.look.x;
    this.pitch = clamp(this.pitch + i.look.y, -1.45, 1.45);

    this.aiming = i.down("aim") && this.weapon.def.isGun;
    this.weapon.blocking = !this.weapon.def.isGun && i.down("aim");

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

    const wantCrouch = i.down("crouch");
    this.sprinting = i.down("sprint") && !this.aiming && !wantCrouch && i.move.y > 0.3;
    if (this.sprinting && wantCrouch && this.onGround && !this.sliding) {
      this.sliding = true;
      this.slideT = 0.7;
      const f = this.forward.clone();
      f.y = 0;
      f.normalize();
      this.vel.addScaledVector(f, 6);
    }
    if (this.sliding) {
      this.slideT -= dt;
      if (this.slideT <= 0 || !this.onGround) this.sliding = false;
    }
    this.crouching = wantCrouch || this.sliding;
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    this.height = damp(this.height, targetH, 14, dt);
    this.eyeH = damp(this.eyeH, this.crouching ? EYE_CROUCH : EYE_STAND, 14, dt);

    if (i.pressed("jump")) this.jumpBuf = 0.12;
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.coyote = this.onGround ? 0.12 : Math.max(0, this.coyote - dt);
    const grounded = this.coyote > 0;
    if (this.jumpBuf > 0 && (grounded || this.airJumps > 0)) {
      this.vel.y = JUMP;
      this.onGround = false;
      this.jumpBuf = 0;
      this.coyote = 0;
      if (!grounded) this.airJumps -= 1;
      this.hooks.audio.jump();
      this.sliding = false;
    }
    if (i.pressed("dash") && this.dashCd <= 0) {
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

    const wish = this.wishDir();
    const speed = this.sliding ? SPRINT * 1.15 : this.crouching ? CROUCH : this.sprinting ? SPRINT : WALK;
    if (this.onGround) {
      this.vel.x *= Math.pow(0.0008, dt);
      this.vel.z *= Math.pow(0.0008, dt);
      this.vel.x += wish.x * speed * ACCEL * dt * 0.12;
      this.vel.z += wish.z * speed * ACCEL * dt * 0.12;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const cap = speed;
      if (hs > cap) {
        this.vel.x *= cap / hs;
        this.vel.z *= cap / hs;
      }
    } else {
      this.vel.x += wish.x * AIR_ACCEL * dt;
      this.vel.z += wish.z * AIR_ACCEL * dt;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > SPRINT * 1.15) {
        this.vel.x *= (SPRINT * 1.15) / hs;
        this.vel.z *= (SPRINT * 1.15) / hs;
      }
    }

    const col = this.hooks.world.moveAABB(this.pos, this.vel, 0.34, this.height, dt, G);
    if (col.onGround && !this.lastGround) {
      this.landDip.kick(-this.vel.y * 4);
      this.hooks.audio.land();
      this.airJumps = 1;
    }
    this.lastGround = this.onGround;
    this.onGround = col.onGround;

    this.eye.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
    this.center.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
    this.forward.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.bobAmt = damp(this.bobAmt, this.onGround && spd > 1.5 ? Math.min(1, spd / SPRINT) : 0, 8, dt);
    this.bobPhase += dt * (8 + spd * 1.2) * this.bobAmt;

    this.lastDamageT += dt;
    if (this.lastDamageT > 4.2 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 12 * dt);
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
      if (firePress && canFire && !this.weapon.blocking) {
        this.weapon.fireT = this.weapon.def.interval;
        this.weapon.slashT = 0.22;
        this.hooks.audio.blade();
        this.recoilP.kick(this.weapon.def.camKick[0] * 20);
        const heavy = this.meleeStreak >= 3;
        this.hooks.onSlash(this.eye.clone(), this.forward.clone(), this.weapon.def.damage * (heavy ? 1.8 : 1), heavy);
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
    if (w.def.kind === "shotgun") this.hooks.audio.shotgun();
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
    cam.fov = damp(cam.fov, lerpFov(baseFov, adsFov, ads) + this.fovKick.value * 0.04, 12, dt);
    cam.updateProjectionMatrix();
  }

  private animateGun(dt: number) {
    const w = this.weapon;
    const ads = this.aiming ? 1 : 0;
    const sprint = this.sprinting && !this.aiming ? 1 : 0;
    const base = new THREE.Vector3(0.22, -0.18, -0.38);
    const aim = new THREE.Vector3(0.0, -0.14, -0.32);
    const p = w.root.position;
    p.lerpVectors(base, aim, ads);
    p.x += Math.sin(this.bobPhase) * 0.012 * this.bobAmt * (1 - ads) + sprint * 0.08;
    p.y += Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobAmt * (1 - ads) - sprint * 0.1 + this.landDip.value * 0.004;
    p.z += sprint * 0.04;
    w.root.rotation.set(
      0.04 * (1 - ads) + sprint * 0.45 + this.recoilP.value * 0.015,
      -sprint * 0.5 + this.lookDelta.x * 0.4,
      this.lookDelta.x * -0.5 + this.recoilY.value * 0.02 + this.slideT * 0.1,
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
    if (w.def.kind === "sniper" && ads > 0.8) w.root.visible = false;
    else w.root.visible = this.alive;
    void dt;
  }
}

function lerpFov(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
