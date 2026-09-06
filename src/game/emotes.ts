import * as THREE from "three";

/**
 * Emotes and weapon inspect. Both are the same thing mechanically: a timed pose
 * that the gun animation defers to, cancelled the moment you do something that
 * matters. The pose is described once here and read by both the first-person
 * rig and the stick figure other people see, so what you play is what they get.
 */

export type EmoteKind = "inspect" | "takeL" | "love" | "slice" | "wave";

export interface EmoteDef {
  kind: EmoteKind;
  name: string;
  blurb: string;
  dur: number;
  /** true when the weapon stays in frame instead of being lowered */
  holdsWeapon: boolean;
}

export const EMOTES: Record<EmoteKind, EmoteDef> = {
  inspect: { kind: "inspect", name: "INSPECT", blurb: "turn it over and admire the work", dur: 2.4, holdsWeapon: true },
  takeL: { kind: "takeL", name: "TAKE THE L", blurb: "an L, held where they can see it", dur: 2.2, holdsWeapon: false },
  love: { kind: "love", name: "LOVE", blurb: "a heart, entirely sincere", dur: 2.0, holdsWeapon: false },
  slice: { kind: "slice", name: "THROAT SLICE", blurb: "a thumb across the neck", dur: 1.6, holdsWeapon: false },
  wave: { kind: "wave", name: "WAVE", blurb: "no hard feelings", dur: 1.8, holdsWeapon: false },
};

export const EMOTE_ORDER: EmoteKind[] = ["inspect", "takeL", "love", "slice", "wave"];

/** Snapshots carry an index, so the order above is part of the wire format. */
export function emoteIndex(k: EmoteKind | null) {
  return k ? EMOTE_ORDER.indexOf(k) + 1 : 0;
}
export function emoteFromIndex(i: number): EmoteKind | null {
  return i > 0 && i <= EMOTE_ORDER.length ? EMOTE_ORDER[i - 1] : null;
}

/** Where the two arms sit at time `t` (0..1) through an emote. */
export interface ArmPose {
  /** shoulder rotations, radians */
  left: THREE.Euler;
  right: THREE.Euler;
  /** how much the head tilts along */
  headTilt: number;
}

const _l = new THREE.Euler();
const _r = new THREE.Euler();
const _pose: ArmPose = { left: _l, right: _r, headTilt: 0 };

/**
 * One description of each gesture, in shoulder angles. The first-person rig and
 * the remote figure both read this, which is why they never drift apart.
 */
export function armPose(kind: EmoteKind, t: number): ArmPose {
  // ease in and out so nothing snaps at either end
  const e = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
  const beat = Math.sin(t * Math.PI * 4);
  _pose.headTilt = 0;
  switch (kind) {
    case "takeL":
      // right arm up to the forehead, elbow square: the L
      _r.set(-2.5 * e, 0.2 * e, -0.5 * e);
      _l.set(0.1, 0, 0.12);
      _pose.headTilt = 0.12 * e;
      break;
    case "love":
      // both hands meet in front of the chest
      _r.set(-1.5 * e, 0, -1.15 * e);
      _l.set(-1.5 * e, 0, 1.15 * e);
      _pose.headTilt = -0.08 * e + beat * 0.02 * e;
      break;
    case "slice":
      // one hand crosses the throat, twice
      _r.set(-2.2 * e, 0, (-1.4 + Math.min(1, t * 2.4) * 2.6) * e);
      _l.set(0.1, 0, 0.12);
      _pose.headTilt = 0.1 * e;
      break;
    case "wave":
      _r.set(-2.3 * e, 0, (-0.3 + beat * 0.45) * e);
      _l.set(0.1, 0, 0.12);
      break;
    default:
      // inspect: the arms stay where the weapon puts them
      _r.set(0, 0, 0);
      _l.set(0, 0, 0);
      break;
  }
  return _pose;
}

/**
 * Where the weapon sits during an inspect: lifted, turned over to show the
 * left side, then rolled back and settled.
 */
export function inspectPose(t: number, out: { pos: THREE.Vector3; rot: THREE.Euler }) {
  const lift = Math.sin(Math.min(1, t * 1.6) * Math.PI) * (t < 0.75 ? 1 : (1 - t) / 0.25);
  const turn = t < 0.5 ? t / 0.5 : Math.max(0, 1 - (t - 0.5) / 0.4);
  out.pos.set(-0.06 * lift, 0.05 * lift, 0.12 * lift);
  out.rot.set(0.35 * lift, -1.5 * turn, 0.9 * turn - 0.18 * lift);
}
