/* types.ts — shared types for the three.js remake */
import type * as THREE from "three";

export type Mode = "district" | "zombies";
export type GameState = "menu" | "play" | "paused" | "shop" | "over";

export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  autofire: boolean;
  mag: number;
  reserve: number;
  dmg: number;
  fireRate: number;
  reloadTime: number;
  spread: number;
  speed: number;
  pellets: number;
  shake: number;
  pierce?: boolean;
  melee?: boolean;
  arc?: number;
  range?: number;
}

export interface WeaponState {
  def: WeaponDef;
  ammo: number;
  reserve: number;
  reloading: boolean;
  reloadT: number;
}

export interface EnemySpec {
  r: number;
  hp: number;
  speed: number;
  dmg: number;
  score: number;
  color: string;
  range?: number;
}

export interface Enemy {
  id: number;
  type: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
  hp: number;
  maxHp: number;
  dmg: number;
  speed: number;
  color: string;
  score: number;
  angle: number;
  seed: number;
  attackCd: number;
  spitCd: number;
  stun: number;
  kbx: number;
  kbz: number;
  hitFlash: number;
  boss: boolean;
  bossPhase: number;
  bossTimer: number;
  charge: { t: number; dx: number; dz: number } | null;
  group: THREE.Group;
  wobble: THREE.Object3D | null;
  range?: number;
  hpBar: THREE.Sprite | null;
  hpCanvas: HTMLCanvasElement | null;
  hpCtx: CanvasRenderingContext2D | null;
  dead: boolean;
}

export interface Bullet {
  x: number; z: number; vx: number; vz: number;
  angle: number; dmg: number; len: number; pierce: boolean; life: number;
  group: THREE.Group;
}

export interface EBullet {
  x: number; z: number; vx: number; vz: number;
  r: number; dmg: number; life: number; color: string;
  group: THREE.Group;
}

export interface Grenade {
  x: number; z: number; vx: number; vz: number;
  fuse: number; group: THREE.Group;
}

export interface Pickup {
  x: number; z: number;
  type: "coin" | "heart" | "ammo" | "medkit" | "flash";
  value: number;
  life: number;
  seed: number;
  group: THREE.Group;
}

export interface Particle {
  kind: "spark" | "blood" | "ink" | "splat" | "dust" | "muzzle" | "text" | "slash" | "ring";
  x: number; z: number; vx: number; vz: number;
  y: number; size: number; color: string;
  life: number; maxLife: number;
  sprite: THREE.Sprite | null;
  txt?: string;
  angle?: number;
  len?: number;
}

export interface PlayerState {
  x: number; z: number; vx: number; vz: number; r: number;
  hp: number; maxHp: number;
  angle: number; aimAngle: number; aimTouch: boolean;
  seed: number;
  invuln: number; hurtFlash: number;
  sprint: boolean; moving: boolean;
  dashCd: number; dashT: number; dashDir: { x: number; z: number };
  dashGauge: number; katanaGauge: number;
  katanaCd: number; quickSlashCd: number;
  dashSlashT: number;
  fireCd: number;
  grenades: number; grenadeHold: number;
  wIndex: number;
  combo: number; comboT: number;
  dmgMult: number; fireRateMult: number; speedMult: number; reloadMult: number;
  armor: number; vamp: number; double: number; grenadeMult: number;
  weapons: WeaponState[];
  group: THREE.Group;
  body: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  gunMount: THREE.Object3D;
  shadow: THREE.Mesh;
}

export interface UpgradeDef {
  id: string;
  ic: string;
  tt: string;
  ds: string;
}
