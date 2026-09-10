import * as THREE from "three";
import { World } from "./physics";
import { clamp, rand } from "./math";
import type { LocalSnapshotSource } from "./remote";
import type { WeaponKind } from "./player";

export type BotSkill = "recruit" | "regular" | "veteran" | "elite";

interface SkillProfile {
  turn: number;
  error: number;
  reaction: number;
  fireGap: [number, number];
  damage: number;
  range: number;
  hp: number;
  speed: number;
}

export const BOT_SKILLS: Record<BotSkill, SkillProfile> = {
  recruit: { turn: 2.6, error: 0.085, reaction: 0.62, fireGap: [0.5, 1.1], damage: 9, range: 18, hp: 100, speed: 5.2 },
  regular: { turn: 4.4, error: 0.05, reaction: 0.42, fireGap: [0.32, 0.7], damage: 13, range: 24, hp: 110, speed: 6.0 },
  veteran: { turn: 7.0, error: 0.026, reaction: 0.28, fireGap: [0.22, 0.48], damage: 17, range: 30, hp: 120, speed: 6.6 },
  elite: { turn: 10.5, error: 0.014, reaction: 0.18, fireGap: [0.15, 0.34], damage: 21, range: 36, hp: 130, speed: 7.2 },
};

const SPREAD_PER_METRE = 1 / 14;
const HUNT_MULTIPLIER = 2.8;
const CROWD_PENALTY = 0.55;
const REVENGE = 0.75;

export const BOT_NAMES = [
  "Scribble", "Inkling", "Smudge", "Blot", "Doodle", "Sketch", "Crosshatch", "Margin",
  "Eraser", "Graphite", "Stipple", "Squiggle", "Biro", "Nib", "Foolscap", "Ledger",
];

export interface BotCandidate {
  id: string;
  team: number;
  alive: boolean;
  pos: THREE.Vector3;
  center: THREE.Vector3;
  headPos: THREE.Vector3;
}

export interface BotHooks {
  world: World;
  candidates: () => BotCandidate[];
  shoot: (bot: Bot, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, targetId: string) => void;
  spawnPoints: () => THREE.Vector3[];
  teamPlay: () => boolean;
  crowd: (id: string) => number;
}

const G = 26;
const HALF_W = 0.34;
const HEIGHT = 1.72;
const EYE = 1.58;
const RESPAWN = 4;

export class Bot implements LocalSnapshotSource {
  id: string;
  name: string;
  team: number;
  skill: BotSkill;
  private p: SkillProfile;
  private hooks: BotHooks;

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  hp = 120;
  maxHp = 120;
  alive = true;
  onGround = false;
  firing = false;

  readonly crouching = false;
  readonly sliding = false;
  readonly aiming = false;
  readonly weapon = { blocking: false };

  kills = 0;
  deaths = 0;
  lastHitBy: string | null = null;
  respawns = true;
  weaponKind: WeaponKind = "rifle";

  targetId: string | null = null;
  private seenT = 0;
  private fireT = 0;
  private repickT = 0;
  private deadT = 0;
  private strafe = 1;
  private strafeT = 0;
  private jumpT = 0;
  private stuckT = 0;
  private avoidT = 0;
  private avoidDir = 1;
  private lastPos = new THREE.Vector3();
  private wedgedT = 0;
  private waypoint: THREE.Vector3 | null = null;
  private aimErr = new THREE.Vector2();
  private seeT = rand(0, 0.15);
  private canSee = false;
  private _eye = new THREE.Vector3();
  private _to = new THREE.Vector3();
  private _flat = new THREE.Vector3();
  private _side = new THREE.Vector3();
  private _want = new THREE.Vector3();
  private _cone = new THREE.Vector3();
  private _aim = new THREE.Vector3();

  constructor(id: string, name: string, team: number, skill: BotSkill, hooks: BotHooks) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.skill = skill;
    this.p = BOT_SKILLS[skill];
    this.hooks = hooks;
    this.maxHp = this.p.hp;
    this.hp = this.p.hp;
    this.rerollAim();
  }

  eye = new THREE.Vector3();
  center = new THREE.Vector3();
  headPos = new THREE.Vector3();

  private syncBody() {
    this.eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.center.set(this.pos.x, this.pos.y + HEIGHT * 0.55, this.pos.z);
    this.headPos.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
  }

  private rerollAim() {
    this.aimErr.set(rand(-this.p.error, this.p.error), rand(-this.p.error, this.p.error) * 0.5);
  }

  spawn(at: THREE.Vector3) {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.deadT = 0;
    this.targetId = null;
    this.waypoint = null;
    this.lastHitBy = null;
    this.syncBody();
  }

  takeDamage(amount: number, by: string): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.lastHitBy = by;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths += 1;
      this.deadT = 0;
      return true;
    }
    return false;
  }

  private farSpawn() {
    const pts = this.hooks.spawnPoints();
    if (!pts.length) return new THREE.Vector3();
    const others = this.hooks.candidates().filter((c) => c.alive);
    let best = pts[Math.floor(Math.random() * pts.length)];
    let bestD = -1;
    for (const pt of pts) {
      let nearest = Infinity;
      for (const o of others) nearest = Math.min(nearest, pt.distanceToSquared(o.pos));
      if (nearest > bestD) {
        bestD = nearest;
        best = pt;
      }
    }
    return best.clone();
  }

  update(dt: number) {
    this.firing = false;

    if (!this.alive) {
      this.deadT += dt;
      if (this.respawns && this.deadT >= RESPAWN) this.spawn(this.farSpawn());
      return;
    }

    this.repickT -= dt;
    if (this.repickT <= 0) {
      this.repickT = 0.35;
      this.pickTarget();
    }

    const target = this.currentTarget();
    if (target) this.fight(dt, target);
    else this.wander(dt);

    this.integrate(dt);
    this.watchdog(dt, !!target);
  }

  private watchdog(dt: number, hasTarget: boolean) {
    const trying = hasTarget || !!this.waypoint;
    const moved = this.pos.distanceToSquared(this.lastPos);
    this.lastPos.copy(this.pos);
    if (trying && moved < 0.0004) this.wedgedT += dt;
    else this.wedgedT = 0;
    if (this.wedgedT > 3.5) {
      this.wedgedT = 0;
      this.pos.copy(this.farSpawn());
      this.vel.set(0, 0, 0);
      this.waypoint = null;
      this.targetId = null;
      this.lastPos.copy(this.pos);
      this.syncBody();
    }
  }

  private currentTarget(): BotCandidate | null {
    if (!this.targetId) return null;
    const t = this.hooks.candidates().find((c) => c.id === this.targetId);
    return t && t.alive ? t : null;
  }

  private pickTarget() {
    const eye = this.eye;
    let best: BotCandidate | null = null;
    let bestScore = Infinity;
    for (const c of this.hooks.candidates()) {
      if (!c.alive || c.id === this.id) continue;
      if (this.hooks.teamPlay() && c.team === this.team) continue;
      const d = eye.distanceTo(c.center);
      if (d > this.p.range * HUNT_MULTIPLIER) continue;
      const visible = this.hooks.world.hasLineOfSight(eye, c.center);
      let score = d * (visible ? 1 : 4);
      score *= 1 + CROWD_PENALTY * this.hooks.crowd(c.id);
      if (c.id === this.lastHitBy) score *= REVENGE;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best?.id !== this.targetId) {
      this.seenT = 0;
      this.rerollAim();
    }
    this.targetId = best?.id ?? null;
  }

  private fight(dt: number, t: BotCandidate) {
    const eye = this._eye.copy(this.eye);
    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.15;
      this.canSee = this.hooks.world.hasLineOfSight(eye, t.center);
    }
    const visible = this.canSee;
    if (visible) this.seenT += dt;
    else this.seenT = Math.max(0, this.seenT - dt * 0.5);

    const to = this._to.subVectors(t.center, eye);
    const dist = to.length();
    const spread = 1 + dist * SPREAD_PER_METRE;
    const wantYaw = Math.atan2(-to.x, -to.z) + this.aimErr.x * spread;
    const wantPitch = Math.asin(clamp(to.y / Math.max(0.001, dist), -1, 1)) + this.aimErr.y * spread;
    this.yaw = slew(this.yaw, wantYaw, this.p.turn * dt);
    this.pitch = clamp(this.pitch + clamp(wantPitch - this.pitch, -this.p.turn * dt, this.p.turn * dt), -1.2, 1.2);

    const flat = this._flat.set(to.x, 0, to.z);
    const flatLen = flat.length() || 1;
    flat.divideScalar(flatLen);
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = rand(0.8, 2.0);
      this.strafe = Math.random() < 0.5 ? -1 : 1;
    }
    const side = this._side.set(-flat.z, 0, flat.x).multiplyScalar(this.strafe);
    const want = this._want.set(0, 0, 0);
    if (flatLen > 14) want.copy(flat);
    else if (flatLen < 6) want.copy(flat).multiplyScalar(-0.6).addScaledVector(side, 0.8);
    else want.addScaledVector(flat, 0.25).addScaledVector(side, 1);
    this.drive(want, dt);

    this.fireT -= dt;
    if (!visible || dist > this.p.range || this.seenT < this.p.reaction || this.fireT > 0) return;
    const aimDir = this.forwardVec();
    const cone = this._cone.copy(to).divideScalar(dist);
    if (aimDir.dot(cone) < 0.985) return;
    this.fireT = rand(this.p.fireGap[0], this.p.fireGap[1]);
    this.firing = true;
    this.rerollAim();
    this.hooks.shoot(this, eye, aimDir, this.p.damage, t.id);
  }

  private wander(dt: number) {
    if (!this.waypoint || this.pos.distanceToSquared(this.waypoint) < 9) {
      const pts = this.hooks.spawnPoints();
      this.waypoint = pts.length ? pts[Math.floor(Math.random() * pts.length)].clone() : null;
    }
    if (!this.waypoint) return;
    const to = this._to.subVectors(this.waypoint, this.pos);
    to.y = 0;
    if (to.lengthSq() > 0.01) {
      to.normalize();
      this.yaw = slew(this.yaw, Math.atan2(-to.x, -to.z), this.p.turn * 0.6 * dt);
      this.drive(to, dt);
    }
    this.pitch = slew(this.pitch, 0, dt);
  }

  private forwardVec() {
    return this._aim
      .set(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch),
      )
      .normalize();
  }

  private drive(want: THREE.Vector3, dt: number) {
    if (this.avoidT > 0) {
      this.avoidT -= dt;
      const sx = -want.z * this.avoidDir;
      const sz = want.x * this.avoidDir;
      want.set(want.x * 0.3 + sx, 0, want.z * 0.3 + sz);
    }
    if (want.lengthSq() > 1) want.normalize();
    const speed = this.p.speed;
    if (this.onGround) {
      this.vel.x += want.x * speed * 5 * dt;
      this.vel.z += want.z * speed * 5 * dt;
      this.vel.x *= Math.pow(0.0015, dt);
      this.vel.z *= Math.pow(0.0015, dt);
    } else {
      this.vel.x += want.x * 14 * dt;
      this.vel.z += want.z * 14 * dt;
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > speed) {
      this.vel.x *= speed / hs;
      this.vel.z *= speed / hs;
    }
    const pinned = want.lengthSq() > 0.2 && hs < speed * 0.35;
    this.stuckT = pinned ? this.stuckT + dt : Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.3 && this.avoidT <= 0) {
      this.avoidT = 0.8;
      this.avoidDir = Math.random() < 0.5 ? -1 : 1;
      this.stuckT = 0;
    }
    this.jumpT -= dt;
    if (this.onGround && this.jumpT <= 0 && pinned) {
      this.vel.y = 9.4;
      this.jumpT = 1.2;
    }
  }

  private integrate(dt: number) {
    const col = this.hooks.world.moveAABB(this.pos, this.vel, HALF_W, HEIGHT, dt, G);
    this.onGround = col.onGround;
    this.syncBody();
  }
}

function slew(from: number, to: number, max: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + clamp(d, -max, max);
}
