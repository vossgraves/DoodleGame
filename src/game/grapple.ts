import * as THREE from "three";
import { World } from "./physics";
import { INK, makeInkMaterial } from "./renderer";
import { clamp } from "./math";
import type { AudioSys } from "./audio";
import type { Input } from "./input";

/**
 * The swing grapple. Fire it at whatever the crosshair is on, and while it is
 * attached you are on a rope: the anchor pulls you in, the length constrains
 * you, and holding forward under the anchor pumps the swing the way a child
 * pumps a playground swing. Letting go with jump throws you off it.
 *
 * It runs on breath rather than a cooldown — hanging drains it, feet on the
 * ground bring it back — so it is a movement tool you spend, not a free ride.
 */

const STAM_FIRE = 0.09;
const STAM_DRAIN = 0.08;
const STAM_GROUND = 0.4;
const STAM_AIR = 0.2;
const STAM_MIN = 0.18;
const STAM_PAUSE = 0.5;
const MAX_RANGE = 75;

export type GrappleState = "idle" | "fly" | "on";

/** Something worth hooking that is not a wall — an enemy or another player. */
export interface GrappleTarget {
  center: THREE.Vector3;
  alive: boolean;
  /** drag it toward the player instead of dragging the player toward it */
  yank?: (toward: THREE.Vector3) => void;
}

export interface GrappleHooks {
  world: World;
  scene: THREE.Scene;
  audio: AudioSys;
  input: Input;
  eye: () => THREE.Vector3;
  center: () => THREE.Vector3;
  right: () => THREE.Vector3;
  forward: () => THREE.Vector3;
  pos: () => THREE.Vector3;
  vel: () => THREE.Vector3;
  height: () => number;
  onGround: () => boolean;
  leaveGround: () => void;
  moveY: () => number;
  targets: () => GrappleTarget[];
  kickFov: (v: number) => void;
  tip: (s: string) => void;
}

export class Grapple {
  state: GrappleState = "idle";
  /** 0..1 breath left; firing costs some and hanging drains it */
  stamina = 1;
  /** true when the crosshair is on something hookable */
  hasTarget = false;

  private hooks: GrappleHooks;
  private anchor = new THREE.Vector3();
  private from = new THREE.Vector3();
  private hookPos = new THREE.Vector3();
  private len = 0;
  private flyT = 0;
  private flyDur = 0.2;
  private swingT = 0;
  private blockedT = 0;
  private scanT = 0;
  private losT = 0;
  private cd = 0;
  private stamPause = 0;
  private enemy: GrappleTarget | null = null;

  private rope: THREE.Mesh;
  private hookMesh: THREE.Mesh;

  constructor(hooks: GrappleHooks) {
    this.hooks = hooks;
    const ink = makeInkMaterial({ ink: INK.BLACK, shadeBias: -0.3 });
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5);
    geo.translate(0, 0.5, 0); // grow from the hand end, so scaling stretches it
    this.rope = new THREE.Mesh(geo, ink);
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    hooks.scene.add(this.rope);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 5), ink);
    head.geometry.rotateX(Math.PI / 2);
    this.hookMesh = head;
    this.hookMesh.visible = false;
    hooks.scene.add(this.hookMesh);
  }

  get attached() {
    return this.state === "on";
  }

  /** Where the rope leaves your body. */
  private handPos(out: THREE.Vector3) {
    const h = this.hooks;
    out.copy(h.eye()).addScaledVector(h.right(), -0.55).addScaledVector(h.forward(), 0.9);
    out.y -= 0.42;
    return out;
  }

  /**
   * What the crosshair is on wins. Enemies get a small amount of assist and
   * only when they are genuinely near the aim line and in front of whatever you
   * are pointing at, so the hook never jumps to something you never aimed at.
   */
  private findTarget(): { point: THREE.Vector3; enemy: GrappleTarget | null; dist: number } | null {
    const h = this.hooks;
    const o = h.eye();
    const d = h.forward();
    const wall = h.world.raycast(o, d, MAX_RANGE);
    const wallDist = wall ? wall.dist : MAX_RANGE;

    let best: GrappleTarget | null = null;
    let bestLat = Infinity;
    let bestT = 0;
    const v = new THREE.Vector3();
    for (const t of h.targets()) {
      if (!t.alive) continue;
      v.subVectors(t.center, o);
      const along = v.dot(d);
      if (along < 1.5 || along > Math.min(45, wallDist + 1.5)) continue;
      const lat = Math.sqrt(Math.max(0, v.lengthSq() - along * along));
      const tol = 1.1 + along * 0.06; // a few degrees of help, no more
      if (lat > tol || lat >= bestLat) continue;
      if (!h.world.hasLineOfSight(o, t.center)) continue;
      best = t;
      bestLat = lat;
      bestT = along;
    }
    if (best) return { point: best.center.clone(), enemy: best, dist: bestT };
    if (wall) {
      return {
        point: new THREE.Vector3(o.x + d.x * wall.dist, o.y + d.y * wall.dist, o.z + d.z * wall.dist)
          .add(new THREE.Vector3(wall.nx, wall.ny, wall.nz).multiplyScalar(0.12)),
        enemy: null,
        dist: wall.dist,
      };
    }
    return null;
  }

  private fire() {
    const h = this.hooks;
    if (this.stamina < STAM_MIN) {
      h.tip("grapple needs a breather");
      return;
    }
    const t = this.findTarget();
    if (!t) return;
    this.stamina -= STAM_FIRE;
    this.stamPause = STAM_PAUSE;
    this.state = "fly";
    this.anchor.copy(t.point);
    this.handPos(this.from);
    this.hookPos.copy(this.from);
    this.flyT = 0;
    this.flyDur = clamp(t.dist / 110, 0.04, 0.6);
    this.enemy = t.enemy;
    h.audio.grappleFire();
    h.input.rumble(0.15, 0.4, 40);
  }

  /** Let go. `boost` is the throw you get for releasing with jump. */
  detach(boost: boolean) {
    if (this.state === "idle") return;
    const was = this.state;
    this.state = "idle";
    this.cd = 0.12;
    this.enemy = null;
    this.stamPause = STAM_PAUSE;
    this.rope.visible = false;
    this.hookMesh.visible = false;
    if (was === "on") {
      const vel = this.hooks.vel();
      if (boost) {
        vel.y = Math.max(vel.y, 0) + 8;
        vel.x *= 1.12;
        vel.z *= 1.12;
        this.hooks.audio.jump();
        this.hooks.kickFov(60);
      } else vel.y += 2.5;
    }
  }

  update(dt: number) {
    const h = this.hooks;
    const inp = h.input;
    this.cd -= dt;
    this.stamPause -= dt;

    if (this.state === "idle") {
      if (inp.pressed("grapple") && this.cd <= 0) this.fire();
      // only re-scan a few times a second: this is a raycast plus a target sweep
      this.scanT += dt;
      if (this.scanT > 0.08) {
        this.scanT = 0;
        this.hasTarget = !!this.findTarget();
      }
    } else if (this.state === "fly") {
      this.flyT += dt;
      const f = Math.min(1, this.flyT / this.flyDur);
      this.hookPos.lerpVectors(this.from, this.anchor, f);
      if (f >= 1) {
        if (this.enemy) {
          // hooking a body pulls it to you rather than you to it
          if (this.enemy.alive) {
            this.enemy.yank?.(h.center());
            h.audio.grappleHit();
            h.input.rumble(0.5, 0.5, 90);
          }
          this.detach(false);
        } else {
          this.state = "on";
          this.len = Math.max(1.5, h.center().distanceTo(this.anchor) * 0.94);
          this.blockedT = 0;
          this.losT = 0;
          this.swingT = 0;
          h.audio.grappleHit();
          h.input.rumble(0.3, 0.6, 60);
          if (h.onGround()) {
            h.vel().y = Math.max(h.vel().y, 5);
            h.leaveGround();
          }
        }
      }
    } else {
      this.swing(dt);
    }

    if (this.state !== "idle") this.drawRope();
    this.breathe(dt);
  }

  private swing(dt: number) {
    const h = this.hooks;
    const vel = h.vel();
    const c = h.center();
    this.hookPos.copy(this.anchor);
    this.swingT += dt;

    const d = new THREE.Vector3().subVectors(this.anchor, c);
    const dist = d.length();
    if (dist > 0.01) d.divideScalar(dist);

    const reeling = h.input.down("grapple");
    const vAlong = vel.dot(d);
    if (reeling) {
      this.len = Math.max(1.5, this.len - 14 * dt);
      if (vAlong < 22) vel.addScaledVector(d, 42 * dt);
    } else {
      if (vAlong < 6) vel.addScaledVector(d, 3 * dt);
      // pumping the swing: holding forward while below the anchor adds energy
      if (h.moveY() > 0.3 && c.y < this.anchor.y - 1) {
        const f = h.forward().clone();
        f.y = 0;
        if (f.lengthSq() > 0.01) vel.addScaledVector(f.normalize(), 10 * dt);
      }
    }

    // the rope is inextensible: kill outward velocity and pull the slack in
    if (dist > this.len) {
      const vn = vel.dot(d);
      if (vn < 0) vel.addScaledVector(d, -vn);
      const excess = Math.min(dist - this.len, 0.35) * 0.85;
      const pos = h.pos();
      pos.addScaledVector(d, excess);
      if (h.world.blocked(pos, 0.34, h.height())) pos.addScaledVector(d, -excess);
    }
    if (h.onGround() && reeling && d.y > 0.2) {
      vel.y = Math.max(vel.y, 4.5);
      h.leaveGround();
    }

    // a rope through a wall is not a rope; give it a moment before dropping you
    this.losT += dt;
    if (this.losT > 0.15) {
      this.losT = 0;
      if (!h.world.hasLineOfSight(h.eye(), this.anchor)) this.blockedT += 0.15;
      else this.blockedT = 0;
    }
    if (
      h.input.pressed("grapple") ||
      dist < 1.3 ||
      this.blockedT > 0.3 ||
      dist > 90 ||
      (h.onGround() && this.swingT > 0.6 && !reeling)
    ) {
      this.detach(dist < 1.3);
    }
  }

  private breathe(dt: number) {
    if (this.state !== "idle") this.stamina -= STAM_DRAIN * dt;
    else if (this.stamPause <= 0) this.stamina += (this.hooks.onGround() ? STAM_GROUND : STAM_AIR) * dt;
    this.stamina = clamp(this.stamina, 0, 1);
    if (this.state === "on" && this.stamina <= 0) {
      this.detach(false);
      this.hooks.tip("out of breath · land to recover");
    }
  }

  private drawRope() {
    const from = this.handPos(new THREE.Vector3());
    const to = this.hookPos;
    const span = new THREE.Vector3().subVectors(to, from);
    const len = span.length();
    this.rope.position.copy(from);
    this.rope.quaternion.setFromUnitVectors(UP, span.normalize());
    this.rope.scale.set(1, Math.max(0.001, len), 1);
    this.rope.visible = true;
    this.hookMesh.position.copy(to);
    this.hookMesh.quaternion.copy(this.rope.quaternion);
    this.hookMesh.visible = true;
  }

  reset() {
    this.state = "idle";
    this.enemy = null;
    this.stamina = 1;
    this.rope.visible = false;
    this.hookMesh.visible = false;
  }

  dispose() {
    this.hooks.scene.remove(this.rope, this.hookMesh);
    this.rope.geometry.dispose();
    this.hookMesh.geometry.dispose();
    (this.rope.material as THREE.Material).dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
