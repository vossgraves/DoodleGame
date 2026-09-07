// Other people in the match: a doodle figure in a team colour, eased between the
// snapshots its owner sends (~20/s). It exposes the same head and centre spheres
// the hitscan uses for enemies, so shooting a person and shooting a bot go down
// one path. Authority is split in match.ts.

import * as THREE from "three";
import { humanoid, TYPES, type BodyParts, type TypeDef } from "./enemies";
import { INK, makeInkMaterial } from "./renderer";
import { clamp, damp, rand } from "./math";
import { EMOTES, armPose, emoteFromIndex, emoteIndex, type EmoteKind } from "./emotes";
import { kindId, kindFromId, type WeaponKind } from "./player";

/** Anything a bullet can find that is not an Enemy. */
export interface NetTarget {
  id: string;
  alive: boolean;
  headPos: THREE.Vector3;
  center: THREE.Vector3;
  scale: number;
  ink: number;
  /** which way they are facing — an execution has to come from behind */
  forward: THREE.Vector3;
}

export const TEAM_INKS = [INK.BLUE, INK.RED] as const;
export const FFA_INK = INK.RED;

/** flags packed into one snapshot int */
const F_CROUCH = 1;
const F_SLIDE = 2;
const F_BLOCK = 4;
const F_AIM = 8;
const F_GROUND = 16;
const F_FIRING = 32;
const F_ALIVE = 64;

export type Snapshot = number[];

export interface LocalSnapshotSource {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  crouching: boolean;
  sliding: boolean;
  onGround: boolean;
  aiming: boolean;
  /** what they are actually holding, not which slot it sits in */
  weaponKind: WeaponKind;
  weapon: { blocking: boolean };
  /** bots never emote, so this is optional on the wire */
  emote?: EmoteKind | null;
}

/** What a player broadcasts about itself, kept small: 12 numbers. */
export function encodeLocal(p: LocalSnapshotSource, firing: boolean): Snapshot {
  const flags =
    (p.crouching ? F_CROUCH : 0) |
    (p.sliding ? F_SLIDE : 0) |
    (p.weapon.blocking ? F_BLOCK : 0) |
    (p.aiming ? F_AIM : 0) |
    (p.onGround ? F_GROUND : 0) |
    (firing ? F_FIRING : 0) |
    (p.alive ? F_ALIVE : 0);
  return [
    +p.pos.x.toFixed(2),
    +p.pos.y.toFixed(2),
    +p.pos.z.toFixed(2),
    +p.yaw.toFixed(2),
    +p.pitch.toFixed(2),
    kindId(p.weaponKind),
    flags,
    Math.round(p.hp),
    +p.vel.x.toFixed(1),
    +p.vel.y.toFixed(1),
    +p.vel.z.toFixed(1),
    emoteIndex(p.emote ?? null),
  ];
}

/** Render this far behind real time so there is always a pair to interpolate between. */
const INTERP_DELAY = 0.08;
const STAND_H = 1.72;
const CROUCH_H = 1.08;

function shortestAngle(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The gun in someone else's hands. Not the first-person model — that one carries
 * camos, charms and a working bolt, and ten of them would be ten times the
 * geometry for something the size of a thumbnail at across-the-map range. This
 * is the silhouette: enough to read what they are carrying and which way it
 * points.
 */
const PROPS: Record<string, { len: number; thick: number; mag: number; stock: boolean; scope: number; bore: number }> = {
  rifle: { len: 0.58, thick: 0.09, mag: 0.17, stock: true, scope: 0, bore: 0.3 },
  carbine: { len: 0.46, thick: 0.09, mag: 0.15, stock: true, scope: 0, bore: 0.22 },
  smg: { len: 0.34, thick: 0.08, mag: 0.22, stock: false, scope: 0, bore: 0.14 },
  lmg: { len: 0.62, thick: 0.12, mag: 0.26, stock: true, scope: 0, bore: 0.36 },
  shotgun: { len: 0.56, thick: 0.1, mag: 0, stock: true, scope: 0, bore: 0.34 },
  sniper: { len: 0.66, thick: 0.09, mag: 0.12, stock: true, scope: 0.26, bore: 0.44 },
  revolver: { len: 0.16, thick: 0.07, mag: 0, stock: false, scope: 0, bore: 0.14 },
  pistol: { len: 0.16, thick: 0.06, mag: 0.13, stock: false, scope: 0, bore: 0.1 },
};

function weaponProp(kind: string, ink: number): THREE.Object3D | null {
  const body = makeInkMaterial({ ink, shadeBias: -0.12 });
  const dark = makeInkMaterial({ ink: INK.BLACK, shadeBias: -0.1 });
  const g = new THREE.Group();
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  if (kind === "knife" || kind === "katana") {
    const len = kind === "katana" ? 0.82 : 0.2;
    add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, len), body), 0, 0, len / 2 + 0.06);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.12), dark), 0, 0, -0.02);
    if (kind === "katana") add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.02), dark), 0, 0, 0.05);
    return g;
  }

  const p = PROPS[kind];
  if (!p) return null;
  add(new THREE.Mesh(new THREE.BoxGeometry(p.thick * 0.8, p.thick, p.len), body), 0, 0, p.len / 2);
  add(new THREE.Mesh(new THREE.CylinderGeometry(p.thick * 0.22, p.thick * 0.22, p.bore, 5), dark), 0, 0, p.len + p.bore / 2).rotation.x =
    Math.PI / 2;
  add(new THREE.Mesh(new THREE.BoxGeometry(p.thick * 0.7, 0.13, 0.07), dark), 0, -0.07, 0.06);
  if (p.mag) add(new THREE.Mesh(new THREE.BoxGeometry(p.thick * 0.6, p.mag, 0.07), dark), 0, -p.mag / 2 - 0.03, 0.2);
  if (p.stock) add(new THREE.Mesh(new THREE.BoxGeometry(p.thick * 0.7, p.thick * 1.1, 0.2), body), 0, -0.02, -0.1);
  if (p.scope) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, p.scope, 6), dark), 0, p.thick * 0.75, 0.3).rotation.x =
      Math.PI / 2;
  }
  return g;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

function nameSprite(name: string, ink: number): THREE.Sprite | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext("2d");
  if (!g) return null;
  const colors = ["#1a30c0", "#d02030", "#2d3342", "#eb8c14", "#1f9950", "#e666a8"];
  g.font = "600 40px 'Patrick Hand', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 7;
  g.strokeStyle = "rgba(246,243,230,0.92)";
  g.strokeText(name, 128, 34, 240);
  g.fillStyle = colors[ink] || colors[0];
  g.fillText(name, 128, 34, 240);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.6, 0.4, 1);
  return sp;
}

export class RemotePlayer implements NetTarget {
  emote: EmoteKind | null = null;
  private emoteT = 0;
  id: string;
  name: string;
  team: number;
  ink: number;
  scale = 1;

  pos = new THREE.Vector3(0, -80, 0);
  vel = new THREE.Vector3();
  center = new THREE.Vector3();
  eye = new THREE.Vector3();
  headPos = new THREE.Vector3();
  forward = new THREE.Vector3(0, 0, -1);

  yaw = 0;
  pitch = 0;
  hp = 120;
  alive = true;
  crouching = false;
  sliding = false;
  blocking = false;
  aiming = false;
  onGround = true;
  firing = false;
  weaponKind: WeaponKind = "rifle";

  kills = 0;
  deaths = 0;
  lastSeen = 0;

  parts: BodyParts;
  private scene: THREE.Scene;
  private tag: THREE.Sprite | null;
  private snapA: { p: THREE.Vector3; yaw: number; pitch: number; t: number } | null = null;
  private snapB: { p: THREE.Vector3; yaw: number; pitch: number; t: number } | null = null;
  private phase = 0;
  private walk = 0;
  private visible = false;
  /** which way this body happens to fall, picked once per death */
  private topple = 0;
  private limp = 0;
  /** the right hand, oriented so a prop's +Z runs down the arm and out the muzzle */
  private hand: THREE.Group;
  private prop: THREE.Object3D | null = null;

  constructor(scene: THREE.Scene, id: string, name: string, team: number, ink: number) {
    this.scene = scene;
    this.id = id;
    this.name = name || "doodle";
    this.team = team;
    this.ink = ink;
    const def: TypeDef = { ...TYPES.grunt, ink, hat: "cap", scale: 1, zombie: false };
    this.parts = humanoid(def);
    this.parts.root.visible = false;
    scene.add(this.parts.root);
    this.hand = new THREE.Group();
    this.hand.position.y = -0.6;
    this.hand.rotation.x = Math.PI / 2;
    this.parts.rarm.add(this.hand);
    this.setWeapon("rifle");
    this.tag = nameSprite(this.name, ink);
    if (this.tag) {
      this.tag.position.y = 2.15;
      this.parts.root.add(this.tag);
    }
  }

  private setWeapon(kind: WeaponKind) {
    if (this.prop && this.weaponKind === kind) return;
    this.weaponKind = kind;
    if (this.prop) {
      this.hand.remove(this.prop);
      disposeTree(this.prop);
    }
    this.prop = weaponProp(kind, this.ink);
    if (this.prop) this.hand.add(this.prop);
  }

  /** Feed a snapshot from this player's owner. */
  push(snap: Snapshot, now: number) {
    if (!snap || snap.length < 8) return;
    const p = new THREE.Vector3(snap[0], snap[1], snap[2]);
    this.snapA = this.snapB || { p: p.clone(), yaw: snap[3], pitch: snap[4], t: now - 0.07 };
    this.snapB = { p, yaw: snap[3], pitch: snap[4], t: now };

    this.setWeapon(kindFromId(snap[5]));
    const f = snap[6];
    this.crouching = !!(f & F_CROUCH);
    this.sliding = !!(f & F_SLIDE);
    this.blocking = !!(f & F_BLOCK);
    this.aiming = !!(f & F_AIM);
    this.onGround = !!(f & F_GROUND);
    this.firing = !!(f & F_FIRING);
    this.alive = !!(f & F_ALIVE);
    this.hp = snap[7];
    if (snap.length > 10) this.vel.set(snap[8], snap[9], snap[10]);
    else this.vel.set(0, 0, 0);

    const em = emoteFromIndex(snap[11] ?? 0);
    if (em !== this.emote) {
      this.emote = em;
      this.emoteT = 0;
    }

    // first snapshot, or coming back from the dead: snap rather than glide in
    if (!this.visible) {
      this.pos.copy(p);
      this.visible = true;
      this.parts.root.visible = true;
      this.snapA = null;
    }
    this.lastSeen = now;
  }

  update(dt: number, now: number) {
    if (this.snapB) {
      const A = this.snapA || this.snapB;
      const span = Math.max(0.02, this.snapB.t - A.t);
      const tt = now - INTERP_DELAY;
      const k = clamp((tt - A.t) / span, 0, 1);
      const want = new THREE.Vector3().lerpVectors(A.p, this.snapB.p, k);
      // if we have run past the newest snapshot, carry on along their velocity
      const late = tt - this.snapB.t;
      if (late > 0) want.addScaledVector(this.vel, Math.min(late, 0.35));
      // a big gap means a teleport or a respawn, not a stutter
      if (want.distanceToSquared(this.pos) > 36) this.pos.copy(want);
      else this.pos.lerp(want, 1 - Math.exp(-dt * 22));
      this.yaw = A.yaw + shortestAngle(A.yaw, this.snapB.yaw) * k;
      this.pitch = A.pitch + (this.snapB.pitch - A.pitch) * k;
    }

    const h = this.crouching ? CROUCH_H : STAND_H;
    this.center.set(this.pos.x, this.pos.y + h * 0.55, this.pos.z);
    this.eye.set(this.pos.x, this.pos.y + (this.crouching ? 0.88 : 1.58), this.pos.z);
    this.headPos.set(this.pos.x, this.pos.y + (this.crouching ? 0.95 : 1.62), this.pos.z);
    this.forward
      .set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
      .normalize();

    const root = this.parts.root;
    root.visible = this.visible;
    if (!this.visible) return;
    root.position.copy(this.pos);
    root.rotation.y = this.yaw + Math.PI;
    this.animate(dt);
  }

  private animate(dt: number) {
    const P = this.parts;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk = damp(this.walk, clamp(sp / 4, 0, 1), 10, dt);
    const w = this.walk;
    this.phase += dt * (sp * 2.2 + (sp > 0.4 ? 3 : 0));
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    P.eyes.visible = this.alive;
    P.xeyes.visible = !this.alive;

    if (!this.alive) {
      // topple rather than slump: pick a direction once, then go limp
      if (this.topple === 0) this.topple = rand(0.35, 1) * (Math.random() < 0.5 ? -1 : 1);
      this.limp = damp(this.limp, 1, 7, dt);
      P.root.rotation.x = damp(P.root.rotation.x, Math.PI / 2.1, 7, dt);
      P.root.rotation.z = damp(P.root.rotation.z, this.topple * 0.55, 5, dt);
      const l = this.limp;
      P.larm.rotation.x = damp(P.larm.rotation.x, -0.4 - l * this.topple, 8, dt);
      P.rarm.rotation.x = damp(P.rarm.rotation.x, -0.2 + l * this.topple * 1.3, 8, dt);
      P.lleg.rotation.x = damp(P.lleg.rotation.x, l * 0.7, 8, dt);
      P.rleg.rotation.x = damp(P.rleg.rotation.x, -l * 0.45, 8, dt);
      P.torso.rotation.x = damp(P.torso.rotation.x, l * 0.3, 6, dt);
      if (this.tag) this.tag.visible = false;
      return;
    }
    this.topple = 0;
    this.limp = 0;
    P.root.rotation.x = damp(P.root.rotation.x, 0, 8, dt);
    P.root.rotation.z = damp(P.root.rotation.z, 0, 8, dt);
    if (this.tag) this.tag.visible = true;

    P.lleg.rotation.x = s * 0.9 * w;
    P.rleg.rotation.x = -s * 0.9 * w;
    if (!this.onGround) {
      P.lleg.rotation.x = -0.5;
      P.rleg.rotation.x = 0.6;
    }
    // an emote owns the arms outright; the same pose the emoter is playing
    if (this.emote && EMOTES[this.emote] && !EMOTES[this.emote].holdsWeapon) {
      this.emoteT += dt;
      const def = EMOTES[this.emote];
      if (this.emoteT >= def.dur) this.emote = null;
      else {
        const pose = armPose(this.emote, this.emoteT / def.dur);
        P.larm.rotation.set(pose.left.x, pose.left.y, pose.left.z);
        P.rarm.rotation.set(pose.right.x, pose.right.y, pose.right.z);
        P.head.rotation.z = pose.headTilt;
        P.torso.rotation.x = damp(P.torso.rotation.x, 0, 10, dt);
        void c;
        return;
      }
    }
    P.head.rotation.z = damp(P.head.rotation.z, 0, 10, dt);

    // guns come up and forward; the blade hangs until it is raised to guard
    const aim = this.aiming ? 1 : 0.9;
    const look = clamp(this.pitch, -1.1, 1.1);
    P.rarm.rotation.x = damp(P.rarm.rotation.x, (-1.35 - look * 0.85) * aim - s * 0.6 * w * (1 - aim), 14, dt);
    P.larm.rotation.x = damp(P.larm.rotation.x, (-1.25 - look * 0.85) * aim + s * 0.6 * w * (1 - aim), 14, dt);
    P.torso.rotation.x = damp(P.torso.rotation.x, -0.2 * w + (this.sliding ? 0.5 : 0) + (this.crouching ? 0.22 : 0), 10, dt);
    P.head.rotation.x = damp(P.head.rotation.x, clamp(-this.pitch, -0.7, 0.7) * 0.7, 12, dt);
    void c;
  }

  dispose() {
    this.scene.remove(this.parts.root);
    disposeTree(this.parts.root);
    if (this.tag) this.tag.material.map?.dispose();
  }
}
