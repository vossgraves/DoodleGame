import * as THREE from "three";
import { World, raySphere, PEN_DAMAGE } from "./physics";
import { INK, makeInkMaterial } from "./renderer";
import { rand, randInt, clamp, damp, wrapAngle, choose, TAU } from "./math";
import type { Mode } from "./level";
import type { Player, WeaponKind } from "./player";
import type { AudioSys } from "./audio";
import type { NetTarget } from "./remote";

const _to = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _pd = new THREE.Vector3();

export type EnemyKind =
  | "grunt"
  | "rusher"
  | "heavy"
  | "sniper"
  | "bomber"
  | "flyer"
  | "shambler"
  | "runner"
  | "tank"
  | "spitter"
  | "crawler"
  | "boss"
  | "zboss";

export interface TypeDef {
  hp: number;
  speed: number;
  kind: EnemyKind;
  name: string;
  scale: number;
  score: number;
  dmg: number;
  ink: number;
  hat: "cap" | "band" | "helmet" | "hood" | "crown" | "none";
  zombie?: boolean;
  flying?: boolean;
  boss?: boolean;
  range: number;
  melee?: boolean;
  explode?: boolean;
  spit?: boolean;
}

export const TYPES: Record<EnemyKind, TypeDef> = {
  grunt: { hp: 100, speed: 5.0, kind: "grunt", name: "GRUNT", scale: 1, score: 100, dmg: 7, ink: INK.BLUE, hat: "cap", range: 26 },
  rusher: { hp: 70, speed: 7.4, kind: "rusher", name: "RUSHER", scale: 0.95, score: 120, dmg: 16, ink: INK.RED, hat: "band", range: 2.6, melee: true },
  heavy: { hp: 280, speed: 3.0, kind: "heavy", name: "HEAVY", scale: 1.28, score: 260, dmg: 8, ink: INK.BLACK, hat: "helmet", range: 16 },
  sniper: { hp: 60, speed: 3.2, kind: "sniper", name: "SNIPER", scale: 1.05, score: 180, dmg: 28, ink: INK.BLACK, hat: "hood", range: 70 },
  bomber: { hp: 28, speed: 6.4, kind: "bomber", name: "INK BOMB", scale: 0.88, score: 150, dmg: 32, ink: INK.BLACK, hat: "none", range: 3.2, explode: true },
  flyer: { hp: 40, speed: 6.0, kind: "flyer", name: "PAPER WASP", scale: 1.2, score: 140, dmg: 12, ink: INK.ORANGE, hat: "none", range: 2.4, flying: true, melee: true },
  shambler: { hp: 90, speed: 2.6, kind: "shambler", name: "SHAMBLER", scale: 1.05, score: 80, dmg: 14, ink: INK.GREEN, hat: "none", range: 1.7, melee: true, zombie: true },
  runner: { hp: 55, speed: 7.2, kind: "runner", name: "RUNNER", scale: 0.92, score: 110, dmg: 12, ink: INK.RED, hat: "none", range: 1.6, melee: true, zombie: true },
  tank: { hp: 520, speed: 2.2, kind: "tank", name: "TANK", scale: 1.55, score: 400, dmg: 28, ink: INK.BLACK, hat: "none", range: 2.1, melee: true, zombie: true },
  spitter: { hp: 80, speed: 3.4, kind: "spitter", name: "SPITTER", scale: 1.0, score: 160, dmg: 10, ink: INK.GREEN, hat: "none", range: 18, spit: true, zombie: true },
  crawler: { hp: 40, speed: 4.6, kind: "crawler", name: "CRAWLER", scale: 0.7, score: 90, dmg: 10, ink: INK.GREEN, hat: "none", range: 1.4, melee: true, zombie: true },
  boss: { hp: 2200, speed: 3.1, kind: "boss", name: "THE DOODLER", scale: 2.4, score: 2500, dmg: 22, ink: INK.BLACK, hat: "crown", range: 28, boss: true },
  zboss: { hp: 2800, speed: 2.8, kind: "zboss", name: "THE UNDEAD KING", scale: 2.6, score: 3000, dmg: 26, ink: INK.RED, hat: "crown", range: 3.2, melee: true, zombie: true, boss: true },
};

export interface BodyParts {
  root: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  larm: THREE.Object3D;
  rarm: THREE.Object3D;
  lleg: THREE.Object3D;
  rleg: THREE.Object3D;
  eyes: THREE.Object3D;
  xeyes: THREE.Object3D;
}

export function humanoid(def: TypeDef): BodyParts {
  const ink = makeInkMaterial({ ink: def.ink, shadeBias: -0.08 });
  const solid = makeInkMaterial({ ink: def.ink, fill: true });
  const black = makeInkMaterial({ ink: INK.BLACK, fill: true });
  const root = new THREE.Group();
  const s = def.scale;
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), ink);
  torso.scale.set(0.28 * s * (def.zombie ? 1.1 : 1), 0.42 * s, 0.2 * s);
  torso.position.y = 1.05 * s;
  root.add(torso);

  const headG = new THREE.Group();
  headG.position.y = 1.55 * s;
  root.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28 * s, 10, 8), ink);
  headG.add(head);
  if (def.zombie) head.rotation.z = 0.25;

  const eyes = new THREE.Group();
  headG.add(eyes);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045 * s, 6, 5), black);
    e.position.set(sx * 0.1 * s, 0.04 * s, 0.24 * s);
    e.scale.set(0.85, 1.15, 0.7);
    eyes.add(e);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.025 * s, 0.025 * s), black);
    brow.position.set(sx * 0.1 * s, 0.14 * s, 0.23 * s);
    brow.rotation.z = sx * (def.zombie ? 0.4 : -0.5);
    eyes.add(brow);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.08 * s, 0.016 * s, 4, 8, Math.PI * 0.9), black);
  mouth.position.set(0, -0.12 * s, 0.22 * s);
  mouth.rotation.z = def.zombie ? 0 : Math.PI;
  eyes.add(mouth);

  const xeyes = new THREE.Group();
  headG.add(xeyes);
  xeyes.visible = false;
  for (const sx of [-1, 1]) {
    for (const a of [0.8, -0.8]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.13 * s, 0.022 * s, 0.022 * s), black);
      c.position.set(sx * 0.1 * s, 0.04 * s, 0.24 * s);
      c.rotation.z = a;
      xeyes.add(c);
    }
  }

  const hat = def.hat;
  if (hat === "cap") {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.3 * s, 10, 5, 0, TAU, 0, Math.PI * 0.5), ink);
    c.position.y = 0.06 * s;
    c.scale.y = 0.6;
    headG.add(c);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.03 * s, 0.22 * s), ink);
    brim.position.set(0, 0.06 * s, 0.22 * s);
    headG.add(brim);
  } else if (hat === "helmet") {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.32 * s, 10, 6, 0, TAU, 0, Math.PI * 0.55), ink);
    c.scale.y = 0.85;
    headG.add(c);
  } else if (hat === "hood") {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.33 * s, 10, 7, 0, TAU, 0, Math.PI * 0.62), ink);
    c.position.y = -0.02 * s;
    c.scale.set(1.03, 1.15, 0.95);
    headG.add(c);
  } else if (hat === "band") {
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.28 * s, 0.028 * s, 5, 12), solid);
    b.rotation.x = Math.PI / 2;
    b.position.y = 0.1 * s;
    headG.add(b);
  } else if (hat === "crown") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.26 * s, 4), makeInkMaterial({ ink: INK.ORANGE, fill: true }));
      sp.position.set(Math.cos(a) * 0.22 * s, 0.32 * s, Math.sin(a) * 0.22 * s);
      headG.add(sp);
    }
  }

  const limb = (x: number, y: number, z: number, len: number, r: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    root.add(g);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 6), ink);
    c.position.y = -len / 2;
    g.add(c);
    return g;
  };
  const larm = limb(-0.32 * s, 1.28 * s, 0, 0.7 * s, 0.05 * s);
  const rarm = limb(0.32 * s, 1.28 * s, 0, 0.7 * s, 0.05 * s);
  const lleg = limb(-0.14 * s, 0.7 * s, 0, 0.7 * s, 0.055 * s);
  const rleg = limb(0.14 * s, 0.7 * s, 0, 0.7 * s, 0.055 * s);

  if (def.flying) {
    const wingM = makeInkMaterial({ ink: def.ink, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9 * s, 0.45 * s), wingM);
      w.position.set(sx * 0.5 * s, 1.2 * s, 0);
      w.rotation.y = sx * 0.4;
      root.add(w);
    }
  }

  if (def.kind === "bomber") {
    const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 8, 6), makeInkMaterial({ ink: INK.BLACK, fill: true }));
    bomb.position.set(0, 0.7 * s, 0.28 * s);
    root.add(bomb);
  }

  return { root, head: headG, torso, larm, rarm, lleg, rleg, eyes, xeyes };
}

export interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  mesh: THREE.Mesh;
  fromEnemy: boolean;
  radius: number;
}

export interface Pickup {
  kind: "ammo" | "hp" | "nade" | "gun";
  pos: THREE.Vector3;
  mesh: THREE.Group;
  t: number;
  alive: boolean;
  id: number;
  life: number;
  weapon?: WeaponKind;
}

const MAX_TIMED_DROPS = 10;

export class Enemy {
  def: TypeDef;
  hp: number;
  maxHp: number;
  pos: THREE.Vector3;
  vel = new THREE.Vector3();
  yaw = 0;
  alive = true;
  state: "spawn" | "hunt" | "attack" | "dead" = "spawn";
  spawnT = 0.45;
  attackCd = rand(0.4, 1.2);
  burstLeft = 0;
  hitFlash = 0;
  parts: BodyParts;
  walk = rand(0, TAU);
  hurtT = 0;
  fuse = 0;
  flyingY = 0;
  onGround = true;
  radius: number;
  height: number;
  seeT = rand(0, 0.2);
  canSee = false;
  wallT = rand(0, 0.15);
  wallBlocked = false;
  private _center = new THREE.Vector3();
  private _head = new THREE.Vector3();

  constructor(kind: EnemyKind, pos: THREE.Vector3) {
    this.def = TYPES[kind];
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.pos = pos.clone();
    this.parts = humanoid(this.def);
    this.radius = 0.32 * this.def.scale;
    this.height = 1.75 * this.def.scale * (this.def.kind === "crawler" ? 0.45 : 1);
    if (this.def.flying) this.flyingY = 3.2 + rand(0, 1.5);
    this.parts.root.scale.setScalar(0.01);
  }

  get center() {
    return this._center.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }
  get headPos() {
    return this._head.set(this.pos.x, this.pos.y + this.height * 0.92, this.pos.z);
  }

  takeDamage(amount: number, from: THREE.Vector3, knock: number) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hitFlash = 0.12;
    this.hurtT = 0.2;
    const dir = new THREE.Vector3().subVectors(this.pos, from);
    dir.y = 0;
    if (dir.lengthSq() > 0.01) dir.normalize();
    this.vel.addScaledVector(dir, knock);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.alive = false;
    this.state = "dead";
    this.parts.eyes.visible = false;
    this.parts.xeyes.visible = true;
  }
}

export class Combat {
  world: World;
  scene: THREE.Scene;
  audio: AudioSys;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  remotes: NetTarget[] = [];
  onRemoteHit: ((t: NetTarget, dmg: number, crit: boolean, point: THREE.Vector3) => void) | null = null;
  onRemoteExecute: ((t: NetTarget) => void) | null = null;
  private projGeo = new THREE.SphereGeometry(0.07, 6, 5);
  private projMat = makeInkMaterial({ ink: INK.RED, fill: true });
  private spitMat = makeInkMaterial({ ink: INK.GREEN, fill: true });
  private nadeMat = makeInkMaterial({ ink: INK.BLACK });
  private tracerMat = makeInkMaterial({ ink: INK.ORANGE, fill: true });
  private tracerGeo = (() => {
    const g = new THREE.CylinderGeometry(0.02, 0.012, 1, 4);
    g.rotateX(Math.PI / 2);
    return g;
  })();
  tracers: { mesh: THREE.Mesh; life: number }[] = [];
  particles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  private pGeo = new THREE.BoxGeometry(0.07, 0.07, 0.28);

  constructor(world: World, scene: THREE.Scene, audio: AudioSys) {
    this.world = world;
    this.scene = scene;
    this.audio = audio;
  }

  clear() {
    for (const e of this.enemies) this.scene.remove(e.parts.root);
    this.enemies.length = 0;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups.length = 0;
    for (const t of this.tracers) this.scene.remove(t.mesh);
    this.tracers.length = 0;
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles.length = 0;
  }

  spawn(kind: EnemyKind, pos: THREE.Vector3) {
    const e = new Enemy(kind, pos);
    this.scene.add(e.parts.root);
    this.enemies.push(e);
    return e;
  }

  hitInk: number = INK.RED;
  private _tracerInk: number = INK.ORANGE;
  get tracerInk() {
    return this._tracerInk;
  }
  set tracerInk(v: number) {
    this._tracerInk = v;
    this.tracerMat.uniforms.uInk.value = v;
  }

  private burstMats = new Map<number, THREE.ShaderMaterial>();
  private burstMat(ink: number) {
    let m = this.burstMats.get(ink);
    if (!m) {
      m = makeInkMaterial({ ink, fill: true });
      this.burstMats.set(ink, m);
    }
    return m;
  }

  fx = 1;

  burst(pos: THREE.Vector3, ink: number, n = 10, speed = 6) {
    const mat = this.burstMat(ink);
    const count = Math.max(1, Math.round(n * this.fx));
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.pGeo, mat);
      m.position.copy(pos);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.5, 1.2)),
        life: rand(0.25, 0.55),
      });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, ink?: number) {
    const dist = from.distanceTo(to);
    const m = new THREE.Mesh(this.tracerGeo, ink === undefined ? this.tracerMat : this.burstMat(ink));
    m.position.copy(from).lerp(to, 0.5);
    m.lookAt(to);
    m.scale.set(1, 1, dist);
    this.scene.add(m);
    this.tracers.push({ mesh: m, life: 0.07 });
  }

  private nextPickupId = 1;
  onPickupTaken: ((id: number) => void) | null = null;

  spawnPickup(
    kind: Pickup["kind"],
    pos: THREE.Vector3,
    opts: { id?: number; weapon?: WeaponKind; life?: number } = {},
  ) {
    const id = opts.id ?? this.nextPickupId++;
    if (opts.id !== undefined && opts.id >= this.nextPickupId) this.nextPickupId = opts.id + 1;
    if (this.pickups.some((p) => p.alive && p.id === id)) return;

    const g = new THREE.Group();
    const ink = kind === "hp" ? INK.RED : kind === "nade" ? INK.GREEN : INK.ORANGE;
    if (kind === "gun") {
      const mat = makeInkMaterial({ ink: INK.BLACK, fill: true });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.1), mat);
      g.add(body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.055, 0.055), mat);
      barrel.position.x = 0.44;
      g.add(barrel);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.09), mat);
      grip.position.set(-0.16, -0.16, 0);
      grip.rotation.z = 0.3;
      g.add(grip);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.07), makeInkMaterial({ ink: INK.ORANGE, fill: true }));
      mag.position.set(0.06, -0.17, 0);
      g.add(mag);
      g.rotation.z = 0.25;
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), makeInkMaterial({ ink, fill: true }));
      g.add(box);
      if (kind === "hp") {
        const plus = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), makeInkMaterial({ ink: INK.RED, fill: true }));
        plus.position.y = 0.5;
        g.add(plus);
      }
    }
    g.position.copy(pos);
    g.position.y += 0.4;
    this.scene.add(g);
    this.pickups.push({
      kind,
      pos: pos.clone(),
      mesh: g,
      t: 0,
      alive: true,
      id,
      weapon: opts.weapon,
      life: opts.life ?? Infinity,
    });

    if (opts.life !== undefined) {
      const timed = this.pickups.filter((p) => p.alive && p.life !== Infinity);
      for (let i = 0; i < timed.length - MAX_TIMED_DROPS; i++) this.killPickup(timed[i]);
    }
  }

  private pickupsDirty = false;

  private killPickup(p: Pickup) {
    p.alive = false;
    this.pickupsDirty = true;
    this.scene.remove(p.mesh);
    p.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  removePickup(id: number) {
    for (const p of this.pickups) {
      if (p.id === id && p.alive) this.killPickup(p);
    }
  }

  fireEnemyShot(e: Enemy, target: THREE.Vector3, speed: number, dmg: number, spit = false) {
    const origin = e.headPos;
    const dir = new THREE.Vector3().subVectors(target, origin);
    dir.y += 0.1;
    dir.normalize();
    dir.x += rand(-0.04, 0.04);
    dir.z += rand(-0.04, 0.04);
    dir.normalize();
    const mesh = new THREE.Mesh(this.projGeo, spit ? this.spitMat : this.projMat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      pos: origin.clone(),
      vel: dir.multiplyScalar(speed),
      life: 2.4,
      dmg,
      mesh,
      fromEnemy: true,
      radius: spit ? 0.14 : 0.08,
    });
    this.tracer(origin, origin.clone().addScaledVector(dir, 1.2), spit ? INK.GREEN : INK.RED);
  }

  throwNade(origin: THREE.Vector3, dir: THREE.Vector3, charge: number) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), this.nadeMat);
    const vel = dir.clone();
    vel.y += 0.35;
    vel.normalize().multiplyScalar(14 + charge * 10);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      pos: origin.clone(),
      vel,
      life: 1.35,
      dmg: 90,
      mesh,
      fromEnemy: false,
      radius: 0.16,
    });
  }

  explode(pos: THREE.Vector3, radius: number, dmg: number, player: Player) {
    this.audio.explode();
    this.burst(pos, INK.ORANGE, 18, 10);
    this.burst(pos, INK.RED, 8, 7);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.center.distanceTo(pos);
      if (d < radius) {
        const fall = 1 - d / radius;
        const killed = e.takeDamage(dmg * fall, pos, 8 * fall);
        if (killed) this.onEnemyKilled(e, player);
      }
    }
    for (const r of this.remotes) {
      if (!r.alive) continue;
      const d = r.center.distanceTo(pos);
      if (d >= radius) continue;
      this.onRemoteHit?.(r, dmg * (1 - d / radius), false, pos.clone());
    }
    const pd = player.center.distanceTo(pos);
    if (pd < radius && player.alive) {
      player.takeDamage(dmg * 0.45 * (1 - pd / radius), pos);
    }
  }

  onEnemyKilled(e: Enemy, _player: Player) {
    this.burst(e.center, e.def.ink, 14, 8);
    this.burst(e.center, INK.RED, 6, 5);
    if (Math.random() < 0.28) this.spawnPickup(choose(["ammo", "ammo", "hp", "nade"]), e.pos);
    if (e.def.zombie && Math.random() < 0.12) this.audio.groan();
  }

  hitscan(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    dmg: number,
    headMul: number,
    falloff: [number, number, number] | null,
    player: Player,
  ): { hit: boolean; kill: boolean; crit: boolean; point: THREE.Vector3; enemy?: Enemy; remote?: NetTarget } {
    const trace = this.world.penTrace(origin, dir, maxDist);
    let bestDist = trace.dist;
    const penMul = (t: number) => (trace.penAt !== null && t > trace.penAt ? PEN_DAMAGE : 1);
    let best: { e: Enemy; part: "head" | "body"; t: number } | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ht = raySphere(origin, dir, e.headPos, 0.26 * e.def.scale, bestDist);
      if (ht !== null && ht < bestDist) {
        bestDist = ht;
        best = { e, part: "head", t: ht };
      }
      const bt = raySphere(origin, dir, e.center, 0.42 * e.def.scale, bestDist);
      if (bt !== null && bt < bestDist) {
        bestDist = bt;
        best = { e, part: "body", t: bt };
      }
    }
    let bestR: { r: NetTarget; part: "head" | "body"; t: number } | null = null;
    for (const r of this.remotes) {
      if (!r.alive) continue;
      const ht = raySphere(origin, dir, r.headPos, 0.26 * r.scale, bestDist);
      if (ht !== null && ht < bestDist) {
        bestDist = ht;
        bestR = { r, part: "head", t: ht };
        best = null;
      }
      const bt = raySphere(origin, dir, r.center, 0.42 * r.scale, bestDist);
      if (bt !== null && bt < bestDist) {
        bestDist = bt;
        bestR = { r, part: "body", t: bt };
        best = null;
      }
    }
    const point = origin.clone().addScaledVector(dir, bestDist);
    this.tracer(origin, point);
    if (trace.entry) this.burst(trace.entry, INK.BLUE, 3, 3);
    if (bestR) {
      let d = dmg * penMul(bestR.t);
      if (falloff) {
        const [near, far, min] = falloff;
        if (bestR.t > near) d *= lerp(1, min, clamp((bestR.t - near) / (far - near), 0, 1));
      }
      const crit = bestR.part === "head";
      if (crit) d *= headMul;
      this.burst(point, this.hitInk, crit ? 10 : 5, 7);
      this.onRemoteHit?.(bestR.r, d, crit, point);
      return { hit: true, kill: false, crit, point, remote: bestR.r };
    }
    if (best) {
      let d = dmg * penMul(best.t);
      if (falloff) {
        const [near, far, min] = falloff;
        if (best.t > near) d *= lerp(1, min, clamp((best.t - near) / (far - near), 0, 1));
      }
      const crit = best.part === "head";
      if (crit) d *= headMul;
      const killed = best.e.takeDamage(d, player.eye, crit ? 4.5 : 2.2);
      this.burst(point, this.hitInk, crit ? 10 : 5, 7);
      if (killed) this.onEnemyKilled(best.e, player);
      return { hit: true, kill: killed, crit, point, enemy: best.e };
    }
    if (bestDist < maxDist) this.burst(point, INK.BLUE, 4, 3);
    return { hit: false, kill: false, crit: false, point };
  }

  slash(origin: THREE.Vector3, dir: THREE.Vector3, dmg: number, heavy: boolean, player: Player) {
    const range = heavy ? 4.2 : 2.8;
    const cosH = heavy ? 0.2 : 0.45;
    let any = false,
      kill = false,
      crit = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = new THREE.Vector3().subVectors(e.center, origin);
      const dist = to.length();
      if (dist > range + 0.4) continue;
      if (dist > 0.2 && to.normalize().dot(dir) < cosH) continue;
      if (!this.world.hasLineOfSight(origin, e.center)) continue;
      const headish = e.headPos.y - origin.y < 0.4 && Math.abs(e.headPos.y - origin.y) < 0.5;
      const d = dmg * (headish ? 1.3 : 1);
      const killed = e.takeDamage(d, origin, heavy ? 10 : 5);
      this.burst(e.center, this.hitInk, 8, 8);
      any = true;
      if (killed) {
        kill = true;
        this.onEnemyKilled(e, player);
      }
      if (headish) crit = true;
    }
    for (const r of this.remotes) {
      if (!r.alive) continue;
      const to = new THREE.Vector3().subVectors(r.center, origin);
      const dist = to.length();
      if (dist > range + 0.4) continue;
      const toDir = to.clone().normalize();
      if (dist > 0.2 && toDir.dot(dir) < cosH) continue;
      if (!this.world.hasLineOfSight(origin, r.center)) continue;
      const fromBehind = dist < 2.4 && r.forward && toDir.dot(r.forward) > 0.45;
      this.burst(r.center, this.hitInk, fromBehind ? 16 : 8, fromBehind ? 11 : 8);
      if (fromBehind) {
        this.onRemoteExecute?.(r);
        kill = true;
        crit = true;
      } else {
        this.onRemoteHit?.(r, dmg, false, r.center.clone());
      }
      any = true;
    }
    return { hit: any, kill, crit };
  }

  update(dt: number, player: Player, time: number) {
    for (const e of this.enemies) {
      if (e.state === "dead") {
        e.parts.root.rotation.x = damp(e.parts.root.rotation.x, 1.4, 6, dt);
        e.parts.root.position.y = damp(e.parts.root.position.y, e.pos.y + 0.15, 4, dt);
        continue;
      }
      if (e.state === "spawn") {
        e.spawnT -= dt;
        const t = 1 - clamp(e.spawnT / 0.45, 0, 1);
        e.parts.root.scale.setScalar(t);
        e.parts.root.position.set(e.pos.x, e.pos.y, e.pos.z);
        if (e.spawnT <= 0) {
          e.state = "hunt";
          e.parts.root.scale.setScalar(1);
        }
        continue;
      }
      this.think(e, dt, player, time);
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) {
        e.hurtT += dt;
        if (e.hurtT > 2.4) {
          this.scene.remove(e.parts.root);
          this.enemies.splice(i, 1);
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (!p.fromEnemy) p.vel.y -= 18 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      const sp = p.vel.length();
      _pv.copy(p.pos).addScaledVector(p.vel, -dt);
      _pd.copy(p.vel).divideScalar(sp || 1);
      const hitW = this.world.raycast(_pv, _pd, sp * dt + 0.1);
      let boom = p.life <= 0;
      if (hitW) {
        p.pos.copy(hitW.point);
        boom = true;
      }
      if (p.fromEnemy && player.alive) {
        if (p.pos.distanceTo(player.center) < 0.55 + p.radius) {
          player.takeDamage(p.dmg, p.pos);
          boom = true;
        }
      }
      if (!p.fromEnemy && (boom || p.life <= 0)) {
        this.explode(p.pos, 5.2, p.dmg, player);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (p.fromEnemy && boom) {
        this.burst(p.pos, INK.RED, 5, 4);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    for (const pk of this.pickups) {
      if (!pk.alive) continue;
      pk.t += dt;
      if (pk.life !== Infinity) {
        pk.life -= dt;
        if (pk.life <= 0) {
          this.killPickup(pk);
          continue;
        }
        if (pk.life < 4) pk.mesh.visible = Math.floor(pk.life * 6) % 2 === 0;
      }
      pk.mesh.position.y = pk.pos.y + 0.45 + Math.sin(pk.t * 3) * 0.12;
      pk.mesh.rotation.y += dt * 1.8;
      if (player.alive && player.pos.distanceTo(pk.pos) < 1.4) {
        if (pk.kind === "gun" && pk.weapon) {
          if (!player.pickUpWeapon(pk.weapon)) continue;
        } else if (pk.kind === "hp") {
          if (player.hp >= player.maxHp) continue;
          player.addHp(40);
        } else if (pk.kind === "nade") {
          player.grenades = Math.min(5, player.grenades + 1);
        } else {
          for (const w of player.weapons) if (w.def.isGun) w.addAmmo(Math.round(w.def.magSize * 1.4));
        }
        this.killPickup(pk);
        this.audio.pickup();
        this.onPickupTaken?.(pk.id);
      }
    }
    if (this.pickupsDirty) {
      this.pickups = this.pickups.filter((p) => p.alive);
      this.pickupsDirty = false;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 8;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  private think(e: Enemy, dt: number, player: Player, time: number) {
    const target = player.center;
    const to = _to.subVectors(target, e.center);
    const dist = to.length();
    const flat = _flat.copy(to);
    flat.y = 0;
    const fd = flat.length() || 1;
    const nx = flat.x / fd,
      nz = flat.z / fd;
    const wantYaw = Math.atan2(-nx, -nz);
    e.yaw = e.yaw + wrapAngle(wantYaw - e.yaw) * Math.min(1, dt * 6);

    e.attackCd -= dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.walk += dt * (e.def.speed / 2.4);

    const ranged = !e.def.melee && !e.def.explode;
    if (ranged) {
      e.seeT -= dt;
      if (e.seeT <= 0) {
        e.seeT = 0.2;
        e.canSee = dist < 70 && this.world.hasLineOfSight(e.headPos, player.eye);
      }
    }
    const see = ranged && e.canSee;
    let mx = 0,
      mz = 0;
    if (e.def.explode) {
      mx = nx;
      mz = nz;
      if (dist < e.def.range) {
        e.fuse += dt;
        if (e.fuse > 0.7) {
          this.explode(e.center, 4.4, e.def.dmg, player);
          e.die();
          e.hurtT = 3;
          this.burst(e.center, INK.BLACK, 16, 9);
        }
      } else e.fuse = Math.max(0, e.fuse - dt);
    } else if (e.def.melee) {
      mx = nx;
      mz = nz;
      if (dist < e.def.range && e.attackCd <= 0 && player.alive) {
        e.attackCd = e.def.zombie ? 1.1 : 0.9;
        player.takeDamage(e.def.dmg, e.center);
        this.burst(player.center, INK.RED, 6, 4);
        if (e.def.zombie && Math.random() < 0.3) this.audio.groan();
      }
    } else if (e.def.spit) {
      if (dist > 10) {
        mx = nx;
        mz = nz;
      }
      if (see && dist < e.def.range && e.attackCd <= 0) {
        e.attackCd = rand(1.4, 2.2);
        this.fireEnemyShot(e, player.eye, 22, e.def.dmg, true);
      }
    } else {
      const stop = e.def.kind === "sniper" ? 40 : e.def.kind === "heavy" ? 9 : 14;
      if (dist > stop) {
        mx = nx;
        mz = nz;
      } else if (dist < stop * 0.45) {
        mx = -nx;
        mz = -nz;
      }
      if (see && dist < e.def.range && e.attackCd <= 0 && player.alive) {
        const shots = e.def.kind === "heavy" ? 5 : e.def.kind === "sniper" ? 1 : e.def.boss ? 6 : 3;
        const speed = e.def.kind === "sniper" ? 90 : 34;
        this.fireEnemyShot(e, player.eye, speed, e.def.dmg, false);
        e.burstLeft = shots - 1;
        e.attackCd = e.def.kind === "sniper" ? rand(2.4, 3.4) : 0.14;
        if (e.burstLeft <= 0) e.attackCd = rand(1.4, 2.4);
      } else if (e.burstLeft > 0 && e.attackCd <= 0) {
        this.fireEnemyShot(e, player.eye, 34, e.def.dmg, false);
        e.burstLeft -= 1;
        e.attackCd = e.burstLeft > 0 ? 0.14 : rand(1.5, 2.5);
      }
    }

    if (mx !== 0 || mz !== 0) {
      e.wallT -= dt;
      if (e.wallT <= 0) {
        e.wallT = 0.15;
        _look.copy(e.headPos);
        _look.x += nx * 1.4;
        _look.z += nz * 1.4;
        e.wallBlocked = !this.world.hasLineOfSight(e.headPos, _look);
      }
      if (e.wallBlocked) {
        mx += -nz * 0.8;
        mz += nx * 0.8;
      }
    }

    if (e.def.flying) {
      e.pos.x += mx * e.def.speed * dt;
      e.pos.z += mz * e.def.speed * dt;
      e.pos.y = damp(e.pos.y, e.flyingY + Math.sin(time * 2 + e.walk) * 0.4, 3, dt);
    } else {
      e.vel.x = mx * e.def.speed;
      e.vel.z = mz * e.def.speed;
      const col = this.world.moveAABB(e.pos, e.vel, e.radius, e.height, dt, 26);
      e.onGround = col.onGround;
    }

    const root = e.parts.root;
    root.position.set(e.pos.x, e.pos.y, e.pos.z);
    root.rotation.y = e.yaw;
    const swing = Math.sin(e.walk * 6) * 0.55;
    const zom = e.def.zombie ? 0.9 : 0;
    e.parts.larm.rotation.x = e.def.melee || e.def.zombie ? -1.1 - zom * 0.3 : swing;
    e.parts.rarm.rotation.x = e.def.melee || e.def.zombie ? -1.1 - zom * 0.3 : -swing;
    e.parts.lleg.rotation.x = swing * 0.8;
    e.parts.rleg.rotation.x = -swing * 0.8;
    if (e.def.kind === "crawler") {
      root.rotation.x = 0.7;
    }
    if (e.hitFlash > 0) root.position.x += Math.sin(time * 90) * 0.03;
  }

  aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n += 1;
    return n;
  }

  rayHitscan = this.hitscan.bind(this);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function wavePlan(mode: Mode, wave: number): EnemyKind[] {
  const list: EnemyKind[] = [];
  if (mode === "arena") return list;

  if (mode === "district") {
    const n = 4 + wave * 2;
    for (let i = 0; i < n; i++) {
      if (wave >= 3 && i % 5 === 0) list.push("rusher");
      else if (wave >= 4 && i % 7 === 0) list.push("heavy");
      else if (wave >= 5 && i % 8 === 0) list.push("sniper");
      else if (wave >= 6 && i % 9 === 0) list.push("bomber");
      else if (wave >= 7 && i % 11 === 0) list.push("flyer");
      else list.push("grunt");
    }
    if (wave === 5) list.push("heavy", "heavy");
    if (wave === 8) list.push("heavy", "sniper", "bomber");
    if (wave === 10 || (wave > 10 && wave % 5 === 0)) list.push("boss");
  } else {
    const n = 8 + wave * 3;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      if (wave >= 3 && r < 0.22) list.push("runner");
      else if (wave >= 4 && r < 0.32) list.push("crawler");
      else if (wave >= 5 && r < 0.4) list.push("spitter");
      else if (wave >= 6 && r < 0.48) list.push("tank");
      else list.push("shambler");
    }
    if (wave % 5 === 0) {
      for (let i = 0; i < 6 + wave; i++) list.push(choose(["shambler", "runner", "crawler"]));
      if (wave >= 5) list.push(wave % 10 === 0 ? "zboss" : "tank");
    }
    if (wave === 10 || (wave > 10 && wave % 10 === 0)) list.push("zboss");
  }
  return list;
}

export function pickSpawn(spawns: THREE.Vector3[], player: THREE.Vector3, snipers: THREE.Vector3[], kind: EnemyKind) {
  if ((kind === "sniper" || kind === "spitter") && snipers.length) {
    return snipers[randInt(0, snipers.length - 1)].clone();
  }
  let best = spawns[0];
  let bestD = 0;
  for (let k = 0; k < 6; k++) {
    const s = spawns[randInt(0, spawns.length - 1)];
    const d = s.distanceTo(player);
    if (d > 10 && d > bestD) {
      best = s;
      bestD = d;
    }
  }
  return best.clone();
}
