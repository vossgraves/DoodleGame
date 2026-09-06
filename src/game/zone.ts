import * as THREE from "three";
import { INK, makeInkMaterial } from "./renderer";

/**
 * The battle-royale play area, drawn as a wall of red ink closing in.
 *
 * One open-ended cylinder scaled on X/Z: the radius changes every frame while
 * the zone is contracting, so rebuilding geometry would be wasteful.
 */
export class ZoneView {
  group = new THREE.Group();
  private wall: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.CylinderGeometry(1, 1, 34, 44, 1, true);
    this.wall = new THREE.Mesh(geo, makeInkMaterial({ ink: INK.RED, side: THREE.DoubleSide, shadeBias: 0.25 }));
    this.wall.position.y = 16;
    this.group.add(this.wall);
    this.group.visible = false;
    scene.add(this.group);
  }

  set(cx: number, cz: number, r: number) {
    this.group.position.set(cx, 0, cz);
    this.wall.scale.set(r, 1, r);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.wall.geometry.dispose();
  }
}
