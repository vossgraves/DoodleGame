import * as THREE from "three";
import { World } from "./physics";
import { INK, makeInkMaterial } from "./renderer";
import { clamp, rand } from "./math";

/**
 * Operator skills. One per loadout, on a charge that fills as the match runs —
 * so a skill is something you get back rather than something you get once.
 *
 * The grappler is the odd one out: it is not timed, it just switches the rope
 * on, and its own breath meter is its recharge. The rest are a burst of
 * something you hold for a few seconds and then lose.
 */

export type SkillKind = "grappler" | "flamethrower" | "sparrow" | "trickster" | "poltergeist";

export interface SkillDef {
  kind: SkillKind;
  name: string;
  blurb: string;
  /** seconds to charge from empty; 0 means it is always simply available */
  charge: number;
  /** seconds it stays up once triggered; 0 means it is a passive */
  duration: number;
}

export const SKILLS: Record<SkillKind, SkillDef> = {
  grappler: {
    kind: "grappler",
    name: "GRAPPLER",
    blurb: "a rope on your wrist · runs on breath, not a timer",
    charge: 0,
    duration: 0,
  },
  flamethrower: {
    kind: "flamethrower",
    name: "FLAMETHROWER",
    blurb: "eight seconds of setting the page alight",
    charge: 62,
    duration: 8,
  },
  sparrow: {
    kind: "sparrow",
    name: "SPARROW",
    blurb: "a bow that puts explosive bolts through walls of people",
    charge: 74,
    duration: 12,
  },
  trickster: {
    kind: "trickster",
    name: "TRICKSTER",
    blurb: "three copies of you, running the wrong way",
    charge: 55,
    duration: 10,
  },
  poltergeist: {
    kind: "poltergeist",
    name: "POLTERGEIST",
    blurb: "nine seconds nobody can hold a bead on you",
    charge: 68,
    duration: 9,
  },
};

export const SKILL_ORDER: SkillKind[] = ["grappler", "flamethrower", "sparrow", "trickster", "poltergeist"];
export const DEFAULT_SKILL: SkillKind = "grappler";

export function sanitizeSkill(raw: unknown): SkillKind {
  return typeof raw === "string" && raw in SKILLS ? (raw as SkillKind) : DEFAULT_SKILL;
}

/** Anything the skills may hurt. Same shape the scorestreaks use. */
export interface SkillTarget {
  pos: THREE.Vector3;
  center: THREE.Vector3;
  alive: boolean;
  hit: (amount: number, crit: boolean) => void;
}

/** A decoy the trickster leaves behind, which bots will happily shoot at. */
export interface Decoy {
  id: string;
  pos: THREE.Vector3;
  center: THREE.Vector3;
  alive: boolean;
}

export interface SkillHooks {
  scene: THREE.Scene;
  world: World;
  hostiles: () => SkillTarget[];
  eye: () => THREE.Vector3;
  pos: () => THREE.Vector3;
  forward: () => THREE.Vector3;
  yaw: () => number;
  boom: (at: THREE.Vector3, radius: number, dmg: number) => void;
  tracer: (from: THREE.Vector3, to: THREE.Vector3) => void;
  announce: (main: string, sub?: string) => void;
}

const FLAME_REACH = 9;
const FLAME_CONE = 0.82; // cos of the half angle
const FLAME_TICK = 0.09;
const FLAME_DAMAGE = 13;
const BOLT_SPEED = 46;
const BOLT_RADIUS = 4.2;
const BOLT_DAMAGE = 95;
const BOLT_GAP = 0.85;
const DECOY_COUNT = 3;
const DECOY_SPEED = 7.2;

interface Bolt {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

interface DecoyUnit extends Decoy {
  mesh: THREE.Group;
  dir: THREE.Vector3;
  turnT: number;
}

export class Skills {
  hooks: SkillHooks;
  kind: SkillKind = DEFAULT_SKILL;
  /** 0..1 — full means it can be called in */
  charge = 0;
  /** seconds of the active window left; 0 when it is not up */
  activeT = 0;

  private flameTick = 0;
  private flames: THREE.Points | null = null;
  private flameGeo: THREE.BufferGeometry | null = null;
  private boltT = 0;
  /** in flight; public so a probe can watch them land */
  bolts: Bolt[] = [];
  private decoys: DecoyUnit[] = [];
  private decoyId = 0;

  constructor(hooks: SkillHooks) {
    this.hooks = hooks;
  }

  setKind(k: SkillKind) {
    if (k === this.kind) return;
    this.clearActive();
    this.kind = k;
    this.charge = 0;
    this.activeT = 0;
  }

  get def() {
    return SKILLS[this.kind];
  }
  get active() {
    return this.activeT > 0;
  }
  /** The grappler has no window to open, so it is never "ready" in this sense. */
  get ready() {
    return this.def.duration > 0 && this.charge >= 1 && !this.active;
  }
  /** While one of the weapon skills is up, the normal gun is put away. */
  get overridesWeapon() {
    return this.active && (this.kind === "flamethrower" || this.kind === "sparrow");
  }
  /** Bots cannot pick you as a target while this is up. */
  get untargetable() {
    return this.active && this.kind === "poltergeist";
  }
  /** Decoys the bots should treat as targets. */
  liveDecoys(): Decoy[] {
    return this.decoys.filter((d) => d.alive);
  }

  /** Call it in. Returns false when it is not charged. */
  use() {
    if (!this.ready) return false;
    this.charge = 0;
    this.activeT = this.def.duration;
    if (this.kind === "trickster") this.spawnDecoys();
    if (this.kind === "flamethrower") this.makeFlames();
    this.hooks.announce(this.def.name, this.def.blurb);
    return true;
  }

  update(dt: number, firing: boolean) {
    if (this.def.charge > 0 && !this.active) this.charge = clamp(this.charge + dt / this.def.charge, 0, 1);
    if (this.activeT > 0) {
      this.activeT = Math.max(0, this.activeT - dt);
      if (this.activeT === 0) this.clearActive();
    }
    if (this.active) {
      if (this.kind === "flamethrower") this.burn(dt, firing);
      else if (this.kind === "sparrow") this.shootBolts(dt, firing);
      else if (this.kind === "trickster") this.runDecoys(dt);
    }
    this.flyBolts(dt);
  }

  // ---- flamethrower --------------------------------------------------------

  private makeFlames() {
    const n = 90;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.42, sizeAttenuation: true });
    // reuse the ink shader's colour channel by tinting the point sprite directly
    mat.color.set("#eb8c14");
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.hooks.scene.add(pts);
    this.flames = pts;
    this.flameGeo = geo;
  }

  private burn(dt: number, firing: boolean) {
    const eye = this.hooks.eye();
    const fwd = this.hooks.forward();
    if (this.flames && this.flameGeo) {
      this.flames.visible = firing;
      if (firing) {
        // a spray of embers along the cone, redrawn every frame
        const p = this.flameGeo.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const t = Math.random();
          const spread = t * 1.5;
          p.setXYZ(
            i,
            eye.x + fwd.x * t * FLAME_REACH + rand(-spread, spread),
            eye.y + fwd.y * t * FLAME_REACH + rand(-spread, spread) * 0.6,
            eye.z + fwd.z * t * FLAME_REACH + rand(-spread, spread),
          );
        }
        p.needsUpdate = true;
      }
    }
    if (!firing) return;
    this.flameTick -= dt;
    if (this.flameTick > 0) return;
    this.flameTick = FLAME_TICK;
    const to = new THREE.Vector3();
    for (const t of this.hooks.hostiles()) {
      if (!t.alive) continue;
      to.subVectors(t.center, eye);
      const d = to.length();
      if (d > FLAME_REACH) continue;
      to.divideScalar(d);
      // close in, the cone opens right up; at reach it is narrow
      if (to.dot(fwd) < FLAME_CONE - (1 - d / FLAME_REACH) * 0.35) continue;
      if (!this.hooks.world.hasLineOfSight(eye, t.center)) continue;
      t.hit(FLAME_DAMAGE, false);
    }
  }

  // ---- sparrow -------------------------------------------------------------

  private shootBolts(dt: number, firing: boolean) {
    this.boltT -= dt;
    if (!firing || this.boltT > 0) return;
    this.boltT = BOLT_GAP;
    const eye = this.hooks.eye();
    const fwd = this.hooks.forward();
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.5, 5),
      makeInkMaterial({ ink: INK.ORANGE, fill: true }),
    );
    mesh.geometry.rotateX(Math.PI / 2);
    mesh.position.copy(eye).addScaledVector(fwd, 0.7);
    mesh.quaternion.setFromUnitVectors(FWD, fwd);
    this.hooks.scene.add(mesh);
    this.bolts.push({ mesh, vel: fwd.clone().multiplyScalar(BOLT_SPEED), life: 4 });
  }

  private flyBolts(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.vel.y -= 9 * dt;
      const step = b.vel.clone().multiplyScalar(dt);
      const dist = step.length();
      const dir = step.clone().divideScalar(dist || 1);
      const hitWall = this.hooks.world.raycast(b.mesh.position, dir, dist);
      let burst: THREE.Vector3 | null = null;
      if (hitWall) burst = hitWall.point;
      else {
        for (const t of this.hooks.hostiles()) {
          if (t.alive && t.center.distanceTo(b.mesh.position) < 1.2) {
            burst = t.center.clone();
            break;
          }
        }
      }
      if (burst || b.life <= 0) {
        this.hooks.boom(burst ?? b.mesh.position.clone(), BOLT_RADIUS, BOLT_DAMAGE);
        this.hooks.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      b.mesh.position.add(step);
      b.mesh.quaternion.setFromUnitVectors(FWD, dir);
    }
  }

  // ---- trickster -----------------------------------------------------------

  private spawnDecoys() {
    const pos = this.hooks.pos();
    const yaw = this.hooks.yaw();
    for (let i = 0; i < DECOY_COUNT; i++) {
      const a = yaw + Math.PI + ((i - 1) * Math.PI) / 4;
      const dir = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
      const g = this.makeDecoyMesh();
      g.position.copy(pos);
      this.hooks.scene.add(g);
      this.decoyId += 1;
      this.decoys.push({
        id: `decoy${this.decoyId}`,
        pos: g.position,
        center: new THREE.Vector3(),
        alive: true,
        mesh: g,
        dir,
        turnT: rand(0.6, 1.4),
      });
    }
  }

  /** A stick figure, drawn the way the other players are. */
  private makeDecoyMesh() {
    const g = new THREE.Group();
    const m = makeInkMaterial({ ink: INK.BLUE, shadeBias: -0.2 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.8, 4, 7), m);
    body.position.y = 1.0;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), m);
    head.position.y = 1.68;
    g.add(head);
    return g;
  }

  private runDecoys(dt: number) {
    for (const d of this.decoys) {
      if (!d.alive) continue;
      d.turnT -= dt;
      if (d.turnT <= 0) {
        // wander rather than sprint in a straight line, so they read as people
        d.turnT = rand(0.6, 1.6);
        const a = Math.atan2(d.dir.x, d.dir.z) + rand(-0.8, 0.8);
        d.dir.set(Math.sin(a), 0, Math.cos(a));
      }
      const step = d.dir.clone().multiplyScalar(DECOY_SPEED * dt);
      const ahead = this.hooks.world.raycast(
        new THREE.Vector3(d.pos.x, d.pos.y + 1, d.pos.z),
        d.dir,
        1.2,
      );
      if (ahead) {
        // bounce off whatever it walked into
        d.dir.multiplyScalar(-1);
        d.turnT = rand(0.4, 0.9);
      } else d.pos.add(step);
      d.mesh.rotation.y = Math.atan2(-d.dir.x, -d.dir.z);
      d.center.set(d.pos.x, d.pos.y + 1.0, d.pos.z);
    }
  }

  // ---- housekeeping --------------------------------------------------------

  private clearActive() {
    for (const d of this.decoys) {
      d.alive = false;
      this.hooks.scene.remove(d.mesh);
      d.mesh.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    }
    this.decoys.length = 0;
    if (this.flames) {
      this.hooks.scene.remove(this.flames);
      this.flames.geometry.dispose();
      (this.flames.material as THREE.Material).dispose();
      this.flames = null;
      this.flameGeo = null;
    }
  }

  onDeath() {
    this.activeT = 0;
    this.clearActive();
  }

  dispose() {
    this.clearActive();
    for (const b of this.bolts) {
      this.hooks.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
    this.bolts.length = 0;
  }
}

const FWD = new THREE.Vector3(0, 0, 1);
