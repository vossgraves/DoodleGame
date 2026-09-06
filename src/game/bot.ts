// Locally-simulated players.
//
// Only the host runs bots. It broadcasts their snapshots in exactly the shape a
// real player sends, so every other client draws and shoots them through the
// existing RemotePlayer path and needs no idea they are not people.
//
// A bot satisfies LocalSnapshotSource, which is what lets encodeLocal() serialise
// it without a second code path.

import * as THREE from "three";
import { World } from "./physics";
import { clamp, rand } from "./math";
import type { LocalSnapshotSource } from "./remote";

export type BotSkill = "recruit" | "regular" | "veteran" | "elite";

interface SkillProfile {
  /** how fast the aim can slew, radians/sec */
  turn: number;
  /** persistent aim offset, radians — the reason a recruit misses */
  error: number;
  /** delay before shooting at a target it has just noticed */
  reaction: number;
  fireGap: [number, number];
  damage: number;
  range: number;
  hp: number;
  speed: number;
}

export const BOT_SKILLS: Record<BotSkill, SkillProfile> = {
  recruit: { turn: 2.6, error: 0.085, reaction: 0.62, fireGap: [0.5, 1.1], damage: 9, range: 38, hp: 100, speed: 5.2 },
  regular: { turn: 4.4, error: 0.05, reaction: 0.42, fireGap: [0.32, 0.7], damage: 13, range: 48, hp: 110, speed: 6.0 },
  veteran: { turn: 7.0, error: 0.026, reaction: 0.28, fireGap: [0.22, 0.48], damage: 17, range: 60, hp: 120, speed: 6.6 },
  elite: { turn: 10.5, error: 0.014, reaction: 0.18, fireGap: [0.15, 0.34], damage: 21, range: 75, hp: 130, speed: 7.2 },
};

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
  /** everything a bot might shoot at, refreshed each frame */
  candidates: () => BotCandidate[];
  /** a bot pulled the trigger; the caller resolves the hit and applies damage */
  shoot: (bot: Bot, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, targetId: string) => void;
  spawnPoints: () => THREE.Vector3[];
  /** false in free-for-all, where everyone shares team 0 and is still a target */
  teamPlay: () => boolean;
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
  weaponIndex = 0;
  firing = false;

  // LocalSnapshotSource wants these; bots do not use them
  readonly crouching = false;
  readonly sliding = false;
  readonly aiming = false;
  readonly weapon = { blocking: false };

  kills = 0;
  deaths = 0;
  lastHitBy: string | null = null;
  /** battle royale switches this off: a dead bot stays out */
  respawns = true;

  private targetId: string | null = null;
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
  private waypoint: THREE.Vector3 | null = null;
  private aimErr = new THREE.Vector2();

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

  // kept as fields, not getters: every bot reads every other bot's body each frame
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

  /** Returns true if this shot killed it. */
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

  /** A far-away spawn, so it does not reappear in someone's face. */
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
      // in FFA everyone is nominally team 0, so only skip allies in team modes
      if (this.hooks.teamPlay() && c.team === this.team) continue;
      const d = eye.distanceTo(c.center);
      if (d > this.p.range) continue;
      // visible targets are hugely preferred over merely close ones
      const visible = this.hooks.world.hasLineOfSight(eye, c.center);
      const score = d * (visible ? 1 : 4);
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
    const eye = this.eye.clone();
    const visible = this.hooks.world.hasLineOfSight(eye, t.center);
    if (visible) this.seenT += dt;
    else this.seenT = Math.max(0, this.seenT - dt * 0.5);

    // aim
    const to = new THREE.Vector3().subVectors(t.center, eye);
    const dist = to.length();
    const wantYaw = Math.atan2(-to.x, -to.z) + this.aimErr.x;
    const wantPitch = Math.asin(clamp(to.y / Math.max(0.001, dist), -1, 1)) + this.aimErr.y;
    this.yaw = slew(this.yaw, wantYaw, this.p.turn * dt);
    this.pitch = clamp(this.pitch + clamp(wantPitch - this.pitch, -this.p.turn * dt, this.p.turn * dt), -1.2, 1.2);

    // movement: close the gap, then circle
    const flat = new THREE.Vector3(to.x, 0, to.z);
    const flatLen = flat.length() || 1;
    flat.divideScalar(flatLen);
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = rand(0.8, 2.0);
      this.strafe = Math.random() < 0.5 ? -1 : 1;
    }
    const side = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(this.strafe);
    const want = new THREE.Vector3();
    if (flatLen > 14) want.copy(flat);
    else if (flatLen < 6) want.copy(flat).multiplyScalar(-0.6).addScaledVector(side, 0.8);
    else want.addScaledVector(flat, 0.25).addScaledVector(side, 1);
    this.drive(want, dt);

    // fire
    this.fireT -= dt;
    if (!visible || this.seenT < this.p.reaction || this.fireT > 0) return;
    const aimDir = this.forwardVec();
    const cone = to.clone().divideScalar(dist);
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
    const to = new THREE.Vector3().subVectors(this.waypoint, this.pos);
    to.y = 0;
    if (to.lengthSq() > 0.01) {
      to.normalize();
      this.yaw = slew(this.yaw, Math.atan2(-to.x, -to.z), this.p.turn * 0.6 * dt);
      this.drive(to, dt);
    }
    this.pitch = slew(this.pitch, 0, dt);
  }

  private forwardVec() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
  }

  private drive(want: THREE.Vector3, dt: number) {
    // Sidestep when pinned. Jumping alone cannot get you around a lamp post,
    // which is exactly what they kept walking into.
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
    // track being pinned: sidestep first, and hop as well in case it is a ledge
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

/** Turn towards an angle by at most `max`, taking the short way round. */
function slew(from: number, to: number, max: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + clamp(d, -max, max);
}
