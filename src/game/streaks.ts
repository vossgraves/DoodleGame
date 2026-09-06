// Scorestreaks: rewards for a run of kills without dying.
//
// Each one is deliberately simple mechanically but distinct to use — a reveal,
// an autonomous helper, a thing you pilot, and a swarm you point at trouble.
// Damage is routed back through the caller so PvE bots and PvP players take it
// down the same path the guns already use.

import * as THREE from "three";
import { World } from "./physics";
import { INK, makeInkMaterial } from "./renderer";
import { clamp, rand } from "./math";

export type StreakKind = "uav" | "drone" | "missile" | "swarm";

export interface StreakDef {
  kind: StreakKind;
  name: string;
  /** kills in a row needed to earn it */
  cost: number;
  /** seconds it stays out; 0 means it resolves immediately */
  duration: number;
  blurb: string;
}

export const STREAKS: Record<StreakKind, StreakDef> = {
  uav: { kind: "uav", name: "UAV", cost: 4, duration: 30, blurb: "paints everyone on the minimap" },
  drone: { kind: "drone", name: "SMG DRONE", cost: 6, duration: 22, blurb: "follows you and shoots for you" },
  missile: { kind: "missile", name: "PREDATOR", cost: 8, duration: 0, blurb: "you fly it in yourself" },
  swarm: { kind: "swarm", name: "SWARM", cost: 12, duration: 18, blurb: "twenty little drones, one bad day" },
};

export const STREAK_ORDER: StreakKind[] = ["uav", "drone", "missile", "swarm"];

/** Anything a streak can shoot at. The caller decides what counts as hostile. */
export interface StreakTarget {
  pos: THREE.Vector3;
  center: THREE.Vector3;
  alive: boolean;
  hit: (amount: number, crit: boolean) => void;
}

export interface StreakHooks {
  scene: THREE.Scene;
  world: World;
  /** everything the local player is allowed to hurt, rebuilt per frame */
  hostiles: () => StreakTarget[];
  /** where the player is right now */
  eye: () => THREE.Vector3;
  pos: () => THREE.Vector3;
  yaw: () => number;
  /** area damage, routed through the existing explosion path */
  boom: (at: THREE.Vector3, radius: number, dmg: number) => void;
  tracer: (from: THREE.Vector3, to: THREE.Vector3) => void;
  announce: (main: string, sub?: string) => void;
  /** look input this frame, for steering the missile */
  look: () => { x: number; y: number };
}

const MISSILE_SPEED = 34;
const MISSILE_LIFE = 13;
const DRONE_RANGE = 30;
const DRONE_INTERVAL = 0.22;
const DRONE_DAMAGE = 8;
const SWARM_COUNT = 20;
const SWARM_SPEED = 13;
const SWARM_DAMAGE = 42;

interface SwarmUnit {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  target: StreakTarget | null;
  retargetT: number;
  alive: boolean;
}

export class Streaks {
  hooks: StreakHooks;

  /** kills since the last death */
  streak = 0;
  /** earned but not yet used */
  ready = new Set<StreakKind>();

  uavT = 0;
  private droneT = 0;
  private droneFireT = 0;
  private drone: THREE.Group | null = null;
  private dronePos = new THREE.Vector3();

  private missile: THREE.Group | null = null;
  private missileT = 0;
  private missileDir = new THREE.Vector3();
  private missilePos = new THREE.Vector3();

  private swarm: SwarmUnit[] = [];
  private swarmT = 0;

  constructor(hooks: StreakHooks) {
    this.hooks = hooks;
  }

  /** True while the predator is in the air and owns the camera. */
  get piloting() {
    return !!this.missile;
  }
  get uavActive() {
    return this.uavT > 0;
  }

  /** Where the camera should be while piloting, or null to leave it alone. */
  cameraView(): { pos: THREE.Vector3; look: THREE.Vector3 } | null {
    if (!this.missile) return null;
    const back = this.missilePos.clone().addScaledVector(this.missileDir, -3.2);
    back.y += 1.1;
    return { pos: back, look: this.missilePos.clone().addScaledVector(this.missileDir, 6) };
  }

  /** A kill happened; hand out anything newly earned. */
  addKill() {
    this.streak += 1;
    for (const k of STREAK_ORDER) {
      const def = STREAKS[k];
      if (this.streak === def.cost && !this.ready.has(k)) {
        this.ready.add(k);
        this.hooks.announce(`${def.name} READY`, def.blurb);
      }
    }
  }

  /** Dying loses the run but keeps what you already earned, as CoD does. */
  onDeath() {
    this.streak = 0;
  }

  available(): StreakKind[] {
    return STREAK_ORDER.filter((k) => this.ready.has(k));
  }

  use(kind: StreakKind): boolean {
    if (!this.ready.has(kind)) return false;
    switch (kind) {
      case "uav":
        this.uavT = STREAKS.uav.duration;
        this.hooks.announce("UAV UP", "they are on your minimap");
        break;
      case "drone":
        this.spawnDrone();
        break;
      case "missile":
        this.launchMissile();
        break;
      case "swarm":
        this.spawnSwarm();
        break;
    }
    this.ready.delete(kind);
    return true;
  }

  // ---- drone -------------------------------------------------------------

  private spawnDrone() {
    this.clearDrone();
    const g = new THREE.Group();
    const ink = makeInkMaterial({ ink: INK.BLUE });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), ink);
    g.add(body);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.44), makeInkMaterial({ ink: INK.BLACK, fill: true }));
    gun.position.set(0, -0.16, -0.2);
    g.add(gun);
    for (const [dx, dz] of [
      [-0.32, -0.32],
      [0.32, -0.32],
      [-0.32, 0.32],
      [0.32, 0.32],
    ] as [number, number][]) {
      const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 5, 12), ink);
      rotor.rotation.x = Math.PI / 2;
      rotor.position.set(dx, 0.1, dz);
      g.add(rotor);
    }
    this.dronePos.copy(this.hooks.eye()).add(new THREE.Vector3(0, 2.2, 0));
    g.position.copy(this.dronePos);
    this.hooks.scene.add(g);
    this.drone = g;
    this.droneT = STREAKS.drone.duration;
    this.hooks.announce("DRONE OUT", "it picks its own targets");
  }

  private clearDrone() {
    if (!this.drone) return;
    this.hooks.scene.remove(this.drone);
    this.drone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.drone = null;
  }

  private updateDrone(dt: number) {
    if (!this.drone) return;
    this.droneT -= dt;
    if (this.droneT <= 0) {
      this.clearDrone();
      return;
    }
    // trail the player's shoulder
    const want = this.hooks.eye().clone();
    const yaw = this.hooks.yaw();
    want.x += Math.sin(yaw) * 1.6 + 1.1;
    want.z += Math.cos(yaw) * 1.6;
    want.y += 1.9;
    this.dronePos.lerp(want, 1 - Math.exp(-dt * 3.2));
    this.drone.position.copy(this.dronePos);
    this.drone.rotation.y += dt * 1.4;

    this.droneFireT -= dt;
    if (this.droneFireT > 0) return;

    let best: StreakTarget | null = null;
    let bestD = DRONE_RANGE;
    for (const t of this.hooks.hostiles()) {
      if (!t.alive) continue;
      const d = this.dronePos.distanceTo(t.center);
      if (d < bestD && this.hooks.world.hasLineOfSight(this.dronePos, t.center)) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return;
    this.droneFireT = DRONE_INTERVAL;
    this.drone.lookAt(best.center);
    this.hooks.tracer(this.dronePos.clone(), best.center.clone());
    best.hit(DRONE_DAMAGE, false);
  }

  // ---- predator missile ---------------------------------------------------

  private launchMissile() {
    this.clearMissile();
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 8), makeInkMaterial({ ink: INK.BLACK, fill: true }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 8), makeInkMaterial({ ink: INK.RED, fill: true }));
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.95;
    g.add(nose);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.32), makeInkMaterial({ ink: INK.ORANGE, fill: true }));
      fin.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.6);
      fin.rotation.z = a;
      g.add(fin);
    }
    // start high above and behind, nose down, the way a called-in strike arrives
    const from = this.hooks.pos().clone();
    this.missilePos.set(from.x, from.y + 46, from.z);
    this.missileDir.set(0, -1, 0).normalize();
    g.position.copy(this.missilePos);
    this.hooks.scene.add(g);
    this.missile = g;
    this.missileT = MISSILE_LIFE;
    this.hooks.announce("PREDATOR INBOUND", "steer it in");
  }

  private clearMissile() {
    if (!this.missile) return;
    this.hooks.scene.remove(this.missile);
    this.missile.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.missile = null;
  }

  private updateMissile(dt: number) {
    if (!this.missile) return;
    this.missileT -= dt;

    // steer with look input, clamped so it stays flyable
    const look = this.hooks.look();
    const right = new THREE.Vector3(-this.missileDir.z, 0, this.missileDir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, this.missileDir).normalize();
    this.missileDir.addScaledVector(right, clamp(look.x, -0.06, 0.06) * 2.4);
    this.missileDir.addScaledVector(up, clamp(-look.y, -0.06, 0.06) * 2.4);
    this.missileDir.normalize();

    const step = MISSILE_SPEED * dt;
    const hit = this.hooks.world.raycast(this.missilePos, this.missileDir, step + 0.6);
    this.missilePos.addScaledVector(this.missileDir, step);
    this.missile.position.copy(this.missilePos);
    this.missile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.missileDir);

    // a near miss on a body still counts
    let touched = !!hit;
    if (!touched) {
      for (const t of this.hooks.hostiles()) {
        if (t.alive && t.center.distanceTo(this.missilePos) < 1.6) {
          touched = true;
          break;
        }
      }
    }
    if (touched || this.missileT <= 0) {
      const at = this.missilePos.clone();
      this.clearMissile();
      this.hooks.boom(at, 11, 190);
    }
  }

  // ---- swarm --------------------------------------------------------------

  private spawnSwarm() {
    this.clearSwarm();
    const mat = makeInkMaterial({ ink: INK.RED, fill: true });
    const geo = new THREE.BoxGeometry(0.22, 0.12, 0.22);
    const from = this.hooks.eye();
    for (let i = 0; i < SWARM_COUNT; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(from.x + rand(-2.5, 2.5), from.y + rand(1.5, 4), from.z + rand(-2.5, 2.5));
      this.hooks.scene.add(m);
      this.swarm.push({
        mesh: m,
        vel: new THREE.Vector3(rand(-2, 2), rand(0, 2), rand(-2, 2)),
        target: null,
        retargetT: rand(0, 0.4),
        alive: true,
      });
    }
    this.swarmT = STREAKS.swarm.duration;
    this.hooks.announce("SWARM RELEASED", "they find their own way");
  }

  private clearSwarm() {
    for (const s of this.swarm) this.hooks.scene.remove(s.mesh);
    // one shared geometry across the flight, disposed once
    if (this.swarm.length) this.swarm[0].mesh.geometry.dispose();
    this.swarm.length = 0;
  }

  private updateSwarm(dt: number) {
    if (!this.swarm.length) return;
    this.swarmT -= dt;
    const expired = this.swarmT <= 0;
    const hostiles = this.hooks.hostiles();

    for (const s of this.swarm) {
      if (!s.alive) continue;
      s.retargetT -= dt;
      if (s.retargetT <= 0 || !s.target || !s.target.alive) {
        s.retargetT = 0.5;
        let best: StreakTarget | null = null;
        let bestD = Infinity;
        for (const t of hostiles) {
          if (!t.alive) continue;
          const d = s.mesh.position.distanceToSquared(t.center);
          if (d < bestD) {
            bestD = d;
            best = t;
          }
        }
        s.target = best;
      }

      if (s.target) {
        const to = new THREE.Vector3().subVectors(s.target.center, s.mesh.position);
        const dist = to.length();
        if (dist < 0.9) {
          s.alive = false;
          this.hooks.scene.remove(s.mesh);
          this.hooks.boom(s.mesh.position.clone(), 2.6, SWARM_DAMAGE);
          continue;
        }
        to.divideScalar(dist || 1);
        s.vel.lerp(to.multiplyScalar(SWARM_SPEED), 1 - Math.exp(-dt * 4));
      } else {
        // nothing to chase: mill about above the owner
        const want = this.hooks.eye().clone();
        want.y += 3;
        s.vel.lerp(want.sub(s.mesh.position).multiplyScalar(0.8), 1 - Math.exp(-dt * 2));
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.y += dt * 9;
    }

    this.swarm = this.swarm.filter((s) => s.alive);
    if (expired) this.clearSwarm();
  }

  update(dt: number) {
    if (this.uavT > 0) this.uavT -= dt;
    this.updateDrone(dt);
    this.updateMissile(dt);
    this.updateSwarm(dt);
  }

  dispose() {
    this.clearDrone();
    this.clearMissile();
    this.clearSwarm();
  }
}
