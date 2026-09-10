import * as THREE from "three";
import { World } from "./physics";
import { INK, makeInkMaterial, type PaperStyle } from "./renderer";
import { rand } from "./math";

export type Mode = "district" | "zombies" | "arena";

export interface Level {
  key: string;
  meshes: THREE.Object3D[];
  animated: { mesh: THREE.Object3D; update: (t: number) => void }[];
  spawns: THREE.Vector3[];
  snipers: THREE.Vector3[];
  pickups: THREE.Vector3[];
  playerStart: THREE.Vector3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface MapDef {
  key: string;
  name: string;
  blurb: string;
  half: number;
  playerStart: [number, number];
  style?: PaperStyle;
  build: (k: MapKit) => void;
}

interface BoxOpts {
  ink?: number;
  noCollide?: boolean;
  noShoot?: boolean;
  fill?: boolean;
  jitter?: number;
}

function jitterGeo(g: THREE.BufferGeometry, amt: number) {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + rand(-amt, amt), pos.getY(i) + rand(-amt, amt), pos.getZ(i) + rand(-amt, amt));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

export class MapKit {
  scene: THREE.Scene;
  world: World;
  night: boolean;
  inkWall: number;
  inkAccent: number;
  meshes: THREE.Object3D[] = [];
  animated: Level["animated"] = [];
  snipers: THREE.Vector3[] = [];
  pickups: THREE.Vector3[] = [];
  rawSpawns: [number, number][] = [];
  private mats: Record<number, THREE.ShaderMaterial> = {};

  constructor(scene: THREE.Scene, world: World, night: boolean) {
    this.scene = scene;
    this.world = world;
    this.night = night;
    this.inkWall = night ? INK.BLACK : INK.BLUE;
    this.inkAccent = night ? INK.RED : INK.ORANGE;
  }

  mat(ink: number, fill = false) {
    const k = ink + (fill ? 10 : 0);
    if (!this.mats[k]) this.mats[k] = makeInkMaterial({ ink, fill, shadeBias: fill ? 0 : -0.05 });
    return this.mats[k];
  }

  add<T extends THREE.Object3D>(o: T): T {
    this.scene.add(o);
    this.meshes.push(o);
    return o;
  }

  mesh(g: THREE.BufferGeometry, ink: number, x: number, y: number, z: number, fill = false) {
    jitterGeo(g, 0.018);
    const m = new THREE.Mesh(g, this.mat(ink, fill));
    m.position.set(x, y, z);
    return this.add(m);
  }

  box(cx: number, y: number, cz: number, w: number, h: number, d: number, o: BoxOpts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.jitter !== 0) jitterGeo(g, o.jitter ?? 0.02);
    const m = new THREE.Mesh(g, this.mat(o.ink ?? this.inkWall, o.fill));
    m.position.set(cx, y + h / 2, cz);
    this.add(m);
    if (!o.noCollide) this.world.addBox(cx, y, cz, w, h, d, { noShoot: o.noShoot });
    return m;
  }

  arena(half: number, wallH = 16) {
    const P = half;
    this.world.bounds = { minX: -P + 1, maxX: P - 1, minZ: -P + 1, maxZ: P - 1 };
    this.box(0, -1, 0, 2 * P + 8, 1, 2 * P + 8, { ink: this.inkWall, jitter: 0.01 });
    this.box(0, 0, -P, 2 * P + 6, wallH, 4, { ink: this.inkWall });
    this.box(0, 0, P, 2 * P + 6, wallH, 4, { ink: this.inkWall });
    this.box(-P, 0, 0, 4, wallH, 2 * P + 6, { ink: this.inkWall });
    this.box(P, 0, 0, 4, wallH, 2 * P + 6, { ink: this.inkWall });
  }

  windowRow(cx: number, cz: number, w: number, d: number, floors: number, face: "x" | "z", sign: number) {
    for (let f = 0; f < floors; f++) {
      const y = 1.4 + f * 3.1;
      const n = Math.max(1, Math.floor((face === "x" ? d : w) / 2.4));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = face === "z" ? cx - w / 2 + t * w : cx + sign * (w / 2 + 0.06);
        const z = face === "x" ? cz - d / 2 + t * d : cz + sign * (d / 2 + 0.06);
        const gw = face === "z" ? 0.7 : 0.08;
        const gd = face === "x" ? 0.7 : 0.08;
        this.box(x, y, z, gw, 1.1, gd, {
          ink: this.night ? INK.RED : INK.BLACK,
          noCollide: true,
          fill: this.night,
          jitter: 0.01,
        });
        if (this.night && Math.random() < 0.45) {
          const plank = new THREE.BoxGeometry(0.08, 1.3, 0.08);
          const m1 = new THREE.Mesh(plank, this.mat(INK.RED));
          m1.position.set(x, y + 0.55, z);
          m1.rotation.z = 0.7;
          this.add(m1);
          const m2 = m1.clone();
          m2.rotation.z = -0.7;
          this.add(m2);
        }
      }
    }
  }

  building(x: number, z: number, w: number, h: number, d: number) {
    this.box(x, 0, z, w, h, d, { ink: this.inkWall });
    const floors = Math.floor(h / 3);
    this.windowRow(x, z, w, d, floors, "z", 1);
    this.windowRow(x, z, w, d, floors, "z", -1);
    this.windowRow(x, z, w, d, floors, "x", 1);
    this.windowRow(x, z, w, d, floors, "x", -1);
    this.box(x, h, z, w + 0.4, 0.35, d + 0.4, { ink: this.inkAccent });
  }

  stairs(sx: number, sz: number, dir: 1 | -1, axis: "x" | "z", steps = 8, rise = 0.32, run = 0.48, width = 2.2) {
    for (let i = 0; i < steps; i++) {
      const c = (i + 0.5) * run;
      const h = (i + 1) * rise;
      const cx = axis === "x" ? sx + dir * c : sx;
      const cz = axis === "z" ? sz + dir * c : sz;
      this.box(cx, 0, cz, axis === "x" ? run + 0.02 : width, h, axis === "z" ? run + 0.02 : width, {
        ink: this.inkWall,
        jitter: 0.01,
      });
    }
  }

  lamp(x: number, z: number, h = 4.4) {
    this.box(x, 0, z, 0.22, h, 0.22, { ink: INK.BLACK, noShoot: true });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), this.mat(INK.ORANGE, true));
    bulb.position.set(x, h + 0.2, z);
    this.add(bulb);
  }

  crate(x: number, z: number, s = rand(0.7, 1.15)) {
    this.box(x, 0, z, s, s, s, { ink: Math.random() < 0.3 ? this.inkAccent : this.inkWall });
  }

  barrel(x: number, z: number, h = 1.4) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, h, 9), this.mat(this.inkAccent));
    m.position.set(x, h / 2, z);
    this.add(m);
    this.world.addBox(x, 0, z, 1, h, 1);
  }

  tree(x: number, z: number) {
    this.box(x, 0, z, 0.35, 2.2, 0.35, { ink: INK.BLACK, noShoot: true });
    this.mesh(new THREE.SphereGeometry(1.3, 8, 6), this.night ? INK.BLACK : INK.GREEN, x, 3.1, z);
  }

  car(x: number, z: number, rot: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 1.6), this.mat(this.night ? INK.BLACK : INK.BLUE));
    body.position.y = 0.7;
    g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.5), this.mat(this.night ? INK.RED : INK.BLACK));
    cab.position.set(-0.3, 1.4, 0);
    g.add(cab);
    for (const wz of [-0.85, 0.85])
      for (const wx of [-1.1, 1.1]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8), this.mat(INK.BLACK, true));
        wh.rotation.z = Math.PI / 2;
        wh.position.set(wx, 0.32, wz);
        g.add(wh);
      }
    this.add(g);
    this.world.addBox(x, 0, z, 3.4, 1.5, 1.7);
  }

  deck(x: number, y: number, z: number, w: number, d: number, ink = this.inkAccent) {
    this.box(x, y, z, w, 0.3, d, { ink });
  }

  spawn(x: number, z: number) {
    this.rawSpawns.push([x, z]);
  }
  sniper(x: number, y: number, z: number) {
    this.snipers.push(new THREE.Vector3(x, y, z));
  }
  pickup(x: number, y: number, z: number) {
    this.pickups.push(new THREE.Vector3(x, y, z));
  }

  float(mesh: THREE.Object3D, update: (t: number) => void) {
    this.animated.push({ mesh, update });
  }

  planes(count = 4, baseR = 18) {
    for (let i = 0; i < count; i++) {
      const g = new THREE.ConeGeometry(0.7, 2.2, 3);
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, this.mat(this.night ? INK.RED : INK.BLUE));
      this.add(m);
      const r = baseR + i * 6;
      const h = 9 + i * 2.2;
      const ph = i * 1.7;
      const sp = 0.12 + i * 0.02;
      this.float(m, (t) => {
        const a = t * sp + ph;
        m.position.set(Math.cos(a) * r, h + Math.sin(a * 2.2) * 1.4, Math.sin(a) * r * 0.75);
        m.lookAt(Math.cos(a + 0.08) * r, h, Math.sin(a + 0.08) * r * 0.75);
      });
    }
  }
}

const district: MapDef = {
  key: "district",
  name: "DOODLE DISTRICT",
  blurb: "streets, rooftops and fire escapes",
  half: 40,
  playerStart: [0, 28],
  build: (k) => {
    k.arena(40);

    const buildings: Array<[number, number, number, number, number]> = [
      [-26, -26, 16, 11, 16],
      [24, -24, 18, 9, 14],
      [-24, 22, 14, 13, 18],
      [26, 24, 16, 10, 14],
      [-8, -28, 10, 7, 12],
      [8, 28, 12, 8, 10],
      [-30, 4, 10, 8, 14],
      [30, -6, 10, 7, 16],
    ];
    for (const [x, z, w, h, d] of buildings) k.building(x, z, w, h, d);

    const cover: Array<[number, number, number, number, number]> = [
      [-6, 6, 4, 1.2, 1.1],
      [7, -4, 5, 1.1, 1.2],
      [2, 12, 3.5, 1.3, 1.1],
      [-12, -8, 4, 1.2, 1.4],
      [14, 8, 3.2, 1.15, 1.2],
      [-16, 10, 2.8, 1.4, 1.1],
      [10, -14, 4.4, 1.2, 1.3],
      [0, -10, 6, 0.9, 1.0],
      [-4, 18, 3, 1.2, 1.1],
      [18, 2, 2.5, 1.5, 1.2],
    ];
    for (const [x, z, w, h, d] of cover) k.box(x, 0, z, w, h, d);

    for (const [x, z] of [
      [-10, 2],
      [-9.1, 2.2],
      [12, -8],
      [12.9, -7.4],
      [4, 6],
      [-18, -12],
      [16, 14],
      [-2, -16],
      [8, 10],
      [-14, 16],
    ] as [number, number][])
      k.crate(x, z);

    for (const [x, z, rot] of [
      [-4, -18, 0.4],
      [15, -2, 1.2],
      [-20, 8, -0.5],
      [6, 16, 2.1],
    ] as [number, number, number][])
      k.car(x, z, rot);

    k.stairs(-14, -18, 1, "z", 10);
    k.deck(-14, 3.2, -12.4, 6, 4, k.inkWall);
    k.stairs(18, 12, -1, "x", 9);
    k.deck(13.2, 2.88, 12, 4, 5, k.inkWall);

    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.6, 10), k.mat(k.inkAccent));
    fountain.position.set(0, 0.3, 0);
    k.add(fountain);
    k.world.addBox(0, 0, 0, 4.6, 0.6, 4.6);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6), k.mat(k.inkWall));
    spout.position.set(0, 1.3, 0);
    k.add(spout);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 6), k.mat(k.night ? INK.RED : INK.BLUE, true));
    bowl.position.set(0, 2.1, 0);
    k.add(bowl);

    for (const [x, z] of [
      [-10, -10],
      [10, 10],
      [-10, 10],
      [10, -10],
      [0, 22],
      [0, -22],
    ] as [number, number][])
      k.lamp(x, z);

    for (const [x, z] of [
      [-22, -8],
      [22, 10],
      [-6, 24],
    ] as [number, number][])
      k.box(x, 0, z, 2.2, 1.4, 1.2, { ink: k.night ? INK.GREEN : INK.BLACK });

    for (const [x, z, w, d] of [
      [-36, -12, 1.4, 6],
      [36, 14, 1.4, 6],
      [-12, -36, 6, 1.4],
      [10, 36, 6, 1.4],
    ] as [number, number, number, number][]) {
      k.deck(x, 6, z, w, d);
      k.deck(x, 3.2, z, w, d);
    }

    for (const [x, y, z] of [
      [0, 5, 0],
      [-16, 4, 4],
      [14, 3.5, -10],
    ] as [number, number, number][]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 14), k.mat(INK.ORANGE));
      t.position.set(x, y, z);
      t.rotation.x = Math.PI / 2;
      k.add(t);
    }

    k.planes();

    if (k.night) {
      for (let i = 0; i < 12; i++) {
        const g = new THREE.BoxGeometry(rand(0.4, 1.6), 0.08, 0.08);
        const m = new THREE.Mesh(g, k.mat(INK.RED, true));
        m.position.set(rand(-30, 30), rand(1.2, 3.5), -37.7);
        m.rotation.z = rand(-0.4, 0.4);
        k.add(m);
      }
    }

    for (const [x, z] of [
      [0, 32],
      [0, -32],
      [32, 0],
      [-32, 0],
      [20, 20],
      [-20, 20],
      [20, -20],
      [-20, -20],
      [8, -30],
      [-28, 12],
      [28, -14],
      [-12, 30],
      [14, 30],
      [-30, -16],
      [30, 18],
      [0, 18],
    ] as [number, number][])
      k.spawn(x, z);

    k.sniper(-26, 11.2, -26);
    k.sniper(24, 9.2, -24);
    k.sniper(-24, 13.2, 22);
    k.sniper(26, 10.2, 24);
    k.sniper(-14, 3.6, -12.4);

    k.pickup(4, 0.6, 4);
    k.pickup(-8, 0.6, 8);
    k.pickup(12, 0.6, -6);

    for (const [x, z] of [
      [-32, 28],
      [32, -28],
      [-28, -32],
      [28, 32],
    ] as [number, number][])
      k.tree(x, z);
  },
};

const rooftops: MapDef = {
  key: "rooftops",
  name: "THE ROOFTOPS",
  blurb: "towers and plank bridges · mind the gap",
  half: 38,
  playerStart: [0, 30],
  build: (k) => {
    k.arena(38, 20);

    const TOWER_H = 12;
    for (const [x, z] of [
      [-22, -22],
      [22, -22],
      [-22, 22],
      [22, 22],
    ] as [number, number][]) {
      k.building(x, z, 13, TOWER_H, 13);
      for (const [ox, oz, pw, pd] of [
        [0, -6.5, 13, 0.4],
        [0, 6.5, 13, 0.4],
        [-6.5, 0, 0.4, 13],
        [6.5, 0, 0.4, 13],
      ] as [number, number, number, number][])
        k.box(x + ox, TOWER_H + 0.35, z + oz, pw, 1.1, pd, { ink: k.inkAccent });
    }

    k.deck(0, TOWER_H, -22, 31, 3.2, k.inkWall);
    k.deck(0, TOWER_H, 22, 31, 3.2, k.inkWall);
    k.deck(-22, TOWER_H, 0, 3.2, 31, k.inkWall);
    k.deck(22, TOWER_H, 0, 3.2, 31, k.inkWall);

    k.box(0, 0, 0, 9, 6, 9, { ink: k.inkWall });
    k.deck(0, 6, 0, 10, 10, k.inkAccent);
    for (const [ox, oz, pw, pd] of [
      [0, -5, 10, 0.4],
      [0, 5, 10, 0.4],
      [-5, 0, 0.4, 10],
      [5, 0, 0.4, 10],
    ] as [number, number, number, number][])
      k.box(ox, 6.3, oz, pw, 0.9, pd, { ink: k.inkWall });
    k.box(0, 6, 0, 3, 10, 3, { ink: k.inkAccent });

    const ring: [number, number][] = [
      [3.2, 0],
      [0, 3.2],
      [-3.2, 0],
      [0, -3.2],
    ];
    for (let i = 0; i < 6; i++) {
      const [ox, oz] = ring[i % 4];
      k.deck(ox, 7.4 + i * 1.4, oz, 2.8, 2.8, k.inkAccent);
    }
    k.deck(0, 15.8, 0, 5.5, 5.5, k.inkAccent);

    k.stairs(0, -14, 1, "z", 15, 0.4, 0.5, 3);
    k.deck(0, 5.9, -5.6, 3, 2.6, k.inkWall);
    k.stairs(-30, -8, 1, "z", 24, 0.5, 0.55, 3);
    k.deck(-26, TOWER_H, 5.2, 8.5, 3.2, k.inkWall);
    k.stairs(30, 8, -1, "z", 24, 0.5, 0.55, 3);
    k.deck(26, TOWER_H, -5.2, 8.5, 3.2, k.inkWall);

    for (const [x, z, w, d] of [
      [-12, -6, 6, 1.3],
      [12, 6, 6, 1.3],
      [-6, 12, 1.3, 6],
      [6, -12, 1.3, 6],
      [-16, 14, 4, 1.3],
      [16, -14, 4, 1.3],
    ] as [number, number, number, number][])
      k.box(x, 0, z, w, 1.35, d, { ink: k.inkWall });
    for (const [x, z] of [
      [-9, -9],
      [9, 9],
      [-9, 9],
      [9, -9],
      [0, 17],
      [0, -17],
      [17, 0],
      [-17, 0],
    ] as [number, number][])
      k.crate(x, z, rand(0.9, 1.25));
    for (const [x, z, rot] of [
      [-14, 26, 0.3],
      [14, -26, 1.9],
    ] as [number, number, number][])
      k.car(x, z, rot);

    for (const [x, z] of [
      [-30, 0],
      [30, 0],
      [0, -32],
      [0, 32],
    ] as [number, number][])
      k.lamp(x, z, 5.2);

    k.planes(5, 26);

    for (const [x, z] of [
      [0, 32],
      [0, -32],
      [32, 0],
      [-32, 0],
      [-30, -30],
      [30, 30],
      [30, -30],
      [-30, 30],
      [-14, 8],
      [14, -8],
      [-8, -20],
      [8, 20],
    ] as [number, number][])
      k.spawn(x, z);

    k.sniper(0, 16.1, 0);
    k.sniper(-22, TOWER_H + 0.4, -22);
    k.sniper(22, TOWER_H + 0.4, -22);
    k.sniper(-22, TOWER_H + 0.4, 22);
    k.sniper(22, TOWER_H + 0.4, 22);
    k.sniper(0, 6.4, 0);

    k.pickup(0, 6.6, 0);
    k.pickup(0, 16.2, 0);
    k.pickup(-22, TOWER_H + 0.5, 0);
    k.pickup(22, TOWER_H + 0.5, 0);
  },
};

const schoolyard: MapDef = {
  key: "schoolyard",
  name: "THE SCHOOLYARD",
  blurb: "open tarmac · climbing frames and long sightlines",
  half: 36,
  playerStart: [0, 26],
  build: (k) => {
    k.arena(36, 9);

    k.building(0, -28, 34, 9, 10);
    k.deck(0, 4.2, -20, 32, 3);
    for (let i = -14; i <= 14; i += 7) k.box(i, 0, -20, 0.5, 4.2, 0.5, { ink: INK.BLACK, noShoot: true });
    k.stairs(-17, -18, 1, "x", 11, 0.38, 0.5, 3);

    const frame = (cx: number, cz: number) => {
      for (const ox of [-3, 3])
        for (const oz of [-3, 3]) k.box(cx + ox, 0, cz + oz, 0.4, 4.2, 0.4, { ink: k.inkAccent });
      k.deck(cx, 2.1, cz, 6.8, 0.5, k.inkAccent);
      k.deck(cx, 2.1, cz, 0.5, 6.8, k.inkAccent);
      k.deck(cx, 4.2, cz, 7.2, 7.2, k.inkAccent);
      k.spawn(cx, cz + 6);
    };
    frame(-16, 6);
    frame(16, 6);

    for (const [x, z, w, d] of [
      [0, 14, 9, 9],
      [-22, -6, 6, 6],
      [22, -6, 6, 6],
    ] as [number, number, number, number][]) {
      for (const [ox, oz, bw, bd] of [
        [0, -d / 2, w, 0.6],
        [0, d / 2, w, 0.6],
        [-w / 2, 0, 0.6, d],
        [w / 2, 0, 0.6, d],
      ] as [number, number, number, number][])
        k.box(x + ox, 0, z + oz, bw, 0.7, bd, { ink: k.night ? INK.RED : INK.ORANGE });
    }
    for (const [x, z, rot] of [
      [-8, 22, 0],
      [8, 22, 0],
      [-26, 14, 1.57],
      [26, 14, 1.57],
    ] as [number, number, number][]) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 0.9), k.mat(k.inkWall));
      seat.position.y = 0.9;
      g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.2), k.mat(k.inkWall));
      back.position.set(0, 1.5, -0.35);
      g.add(back);
      k.add(g);
      k.world.addBox(x, 0, z, rot ? 1.1 : 3.4, 1.9, rot ? 3.4 : 1.1);
    }

    for (const [x, z, s] of [
      [-28, 24, 1],
      [28, 24, -1],
    ] as [number, number, number][]) {
      k.box(x, 0, z, 0.35, 5.2, 0.35, { ink: INK.BLACK, noShoot: true });
      k.box(x + s * 0.7, 4.4, z, 1.6, 1.2, 0.15, { ink: k.inkAccent, noCollide: true });
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 14), k.mat(INK.ORANGE));
      hoop.position.set(x + s * 1.3, 4.3, z);
      hoop.rotation.x = Math.PI / 2;
      k.add(hoop);
    }

    for (const [x, z, w, d] of [
      [-6, 0, 5, 1.2],
      [6, 0, 5, 1.2],
      [0, -8, 1.2, 5],
      [-14, -12, 4, 1.2],
      [14, -12, 4, 1.2],
      [-8, 30, 4.5, 1.2],
      [8, 30, 4.5, 1.2],
    ] as [number, number, number, number][])
      k.box(x, 0, z, w, 1.25, d, { ink: k.inkWall });

    for (const [x, z] of [
      [-30, -18],
      [30, -18],
      [-30, 30],
      [30, 30],
    ] as [number, number][])
      k.tree(x, z);
    for (const [x, z] of [
      [-12, 8],
      [12, 8],
      [0, -14],
    ] as [number, number][])
      k.crate(x, z, 1.2);

    k.planes(3, 20);

    for (const [x, z] of [
      [0, 30],
      [-28, 0],
      [28, 0],
      [-28, -22],
      [28, -22],
      [0, 4],
      [-18, 26],
      [18, 26],
      [-10, -14],
      [10, -14],
      [0, 20],
    ] as [number, number][])
      k.spawn(x, z);

    k.sniper(0, 9.4, -28);
    k.sniper(-16, 4.6, 6);
    k.sniper(16, 4.6, 6);
    k.sniper(0, 4.6, -20);

    k.pickup(0, 0.6, 14);
    k.pickup(-22, 0.6, -6);
    k.pickup(22, 0.6, -6);
  },
};

const subway: MapDef = {
  key: "subway",
  name: "THE UNDERLINE",
  blurb: "platforms and pillars · nowhere to run",
  half: 34,
  playerStart: [0, 26],
  build: (k) => {
    k.arena(34, 12);

    k.box(0, 9, 0, 70, 1, 70, { ink: k.inkWall, noShoot: true });

    k.box(0, -0.6, 0, 12, 0.4, 62, { ink: INK.BLACK, fill: k.night });
    for (const s of [-1, 1]) {
      k.box(s * 13.5, 0, 0, 15, 1.2, 62, { ink: k.inkWall });
      k.box(s * 6.6, 1.2, 0, 0.6, 0.12, 62, { ink: k.inkAccent, noCollide: true });
      for (let z = -26; z <= 26; z += 6.5) k.box(s * 13.5, 1.2, z, 1.1, 6.6, 1.1, { ink: k.inkAccent });
      for (let z = -22; z <= 22; z += 11) k.box(s * 19.5, 1.2, z, 1.4, 1.5, 3.2, { ink: k.inkWall });
    }

    for (const x of [-3.2, 3.2]) k.box(x, -0.6, 0, 0.28, 0.24, 62, { ink: k.inkAccent, noCollide: true });

    for (const cz of [-20, 0, 20]) {
      k.box(0, -0.2, cz, 9, 3.4, 13, { ink: k.night ? INK.RED : INK.BLUE });
      k.deck(0, 3.2, cz, 9.4, 13.4, k.inkAccent);
      for (const s of [-1, 1])
        for (const oz of [-4, 0, 4])
          k.box(s * 4.6, 1.0, cz + oz, 0.12, 1.4, 2.4, {
            ink: k.night ? INK.BLACK : INK.BLACK,
            noCollide: true,
            fill: true,
          });
    }

    for (const s of [-1, 1]) {
      k.stairs(s * 7.6, -28, 1, "z", 7, 0.32, 0.55, 2.4);
      k.stairs(s * 7.6, 28, -1, "z", 7, 0.32, 0.55, 2.4);
    }

    for (const s of [-1, 1]) {
      k.stairs(s * 26, -12, 1, "z", 12, 0.4, 0.5, 3.4);
      k.deck(s * 26, 4.8, -2, 7, 12, k.inkWall);
      k.box(s * 26, 4.8, 4.2, 7, 1.0, 0.4, { ink: k.inkAccent });
    }

    for (let z = -28; z <= 28; z += 9)
      for (const s of [-1, 1]) k.lamp(s * 19, z, 3.2);

    for (const [x, z] of [
      [0, 30],
      [0, -30],
      [-13, 28],
      [13, 28],
      [-13, -28],
      [13, -28],
      [-20, 10],
      [20, 10],
      [-20, -10],
      [20, -10],
      [-26, 0],
      [26, 0],
    ] as [number, number][])
      k.spawn(x, z);

    k.sniper(-26, 5.2, -2);
    k.sniper(26, 5.2, -2);
    k.sniper(0, 3.6, 0);
    k.sniper(0, 3.6, 20);

    k.pickup(0, 3.8, 0);
    k.pickup(-13.5, 1.8, 14);
    k.pickup(13.5, 1.8, -14);
  },
};

const sketchpad: MapDef = {
  key: "sketchpad",
  name: "THE SKETCHPAD",
  blurb: "floating paper · all jump, no floor plan",
  half: 34,
  playerStart: [0, 26],
  build: (k) => {
    k.arena(34, 26);

    const slab = (x: number, y: number, z: number, w: number, d: number, ink = k.inkWall) => {
      k.box(x, y, z, w, 0.5, d, { ink });
      k.box(x, y + 0.5, z, w + 0.3, 0.18, d + 0.3, { ink: k.inkAccent, noCollide: true });
    };

    slab(-16, 2.4, -16, 9, 9);
    slab(16, 2.4, -16, 9, 9);
    slab(-16, 2.4, 16, 9, 9);
    slab(16, 2.4, 16, 9, 9);
    slab(0, 5.2, -20, 11, 7);
    slab(0, 5.2, 20, 11, 7);
    slab(-20, 5.2, 0, 7, 11);
    slab(20, 5.2, 0, 7, 11);
    slab(0, 8.6, 0, 13, 13, k.inkAccent);
    for (const [ox, oz, w, d] of [
      [0, -6.5, 13, 0.4],
      [0, 6.5, 13, 0.4],
      [-6.5, 0, 0.4, 13],
      [6.5, 0, 0.4, 13],
    ] as [number, number, number, number][])
      k.box(ox, 9.1, oz, w, 0.9, d, { ink: k.inkWall });

    for (const [x, y, z] of [
      [-8, 3.8, -8],
      [8, 3.8, -8],
      [-8, 3.8, 8],
      [8, 3.8, 8],
      [-5, 7.0, -13],
      [5, 7.0, 13],
      [-13, 7.0, 5],
      [13, 7.0, -5],
      [-4, 6.4, -4],
      [4, 6.4, 4],
    ] as [number, number, number][])
      slab(x, y, z, 3.4, 3.4);

    k.stairs(-26, -6, 1, "z", 8, 0.32, 0.55, 3);
    k.stairs(26, 6, -1, "z", 8, 0.32, 0.55, 3);
    slab(-26, 2.4, 0, 5, 6);
    slab(26, 2.4, 0, 5, 6);

    for (const [x, z, h] of [
      [-11, 0, 9],
      [11, 0, 9],
      [0, -11, 7],
      [0, 11, 7],
    ] as [number, number, number][]) {
      k.box(x, 0, z, 0.7, h, 0.7, { ink: k.night ? INK.RED : INK.ORANGE });
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6), k.mat(INK.BLACK, true));
      tip.position.set(x, h + 0.6, z);
      k.add(tip);
    }

    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), k.mat(k.inkAccent));
      k.add(m);
      const r = 12 + i * 4;
      const y = 4 + i * 1.5;
      const sp = 0.18 + i * 0.03;
      k.float(m, (t) => {
        m.position.set(Math.cos(t * sp + i) * r, y + Math.sin(t * 1.3 + i) * 0.8, Math.sin(t * sp + i) * r);
        m.rotation.y = t * 0.6;
      });
    }

    k.planes(4, 26);

    for (const [x, z] of [
      [0, 30],
      [0, -30],
      [30, 0],
      [-30, 0],
      [-26, -26],
      [26, 26],
      [26, -26],
      [-26, 26],
      [-16, -16],
      [16, 16],
    ] as [number, number][])
      k.spawn(x, z);

    k.sniper(0, 9.3, 0);
    k.sniper(-20, 5.9, 0);
    k.sniper(20, 5.9, 0);
    k.sniper(0, 5.9, -20);
    k.sniper(0, 5.9, 20);

    k.pickup(0, 9.5, 0);
    k.pickup(-16, 3.2, -16);
    k.pickup(16, 3.2, 16);
  },
};

const bazaar: MapDef = {
  key: "bazaar",
  name: "THE BAZAAR",
  blurb: "stall alleys and awnings · knife-fight close",
  half: 32,
  playerStart: [0, 24],
  build: (k) => {
    k.arena(32, 14);

    const stall = (x: number, z: number, rot: 0 | 1) => {
      const w = rot ? 3.2 : 6.4;
      const d = rot ? 6.4 : 3.2;
      k.box(x, 0, z, w, 1.35, d, { ink: k.inkWall });
      for (const [ox, oz] of [
        [-w / 2 + 0.3, -d / 2 + 0.3],
        [w / 2 - 0.3, -d / 2 + 0.3],
        [-w / 2 + 0.3, d / 2 - 0.3],
        [w / 2 - 0.3, d / 2 - 0.3],
      ] as [number, number][])
        k.box(x + ox, 1.35, z + oz, 0.28, 1.9, 0.28, { ink: INK.BLACK, noShoot: true });
      k.deck(x, 3.25, z, w + 0.8, d + 0.8, k.inkAccent);
      k.box(x, 1.5, z + (rot ? 0 : d / 2), rot ? 0.12 : w * 0.8, 1.0, rot ? d * 0.8 : 0.12, {
        ink: k.night ? INK.RED : INK.ORANGE,
        noCollide: true,
        fill: true,
      });
    };

    for (const [x, z, r] of [
      [-18, -14, 0],
      [-6, -14, 0],
      [6, -14, 0],
      [18, -14, 0],
      [-18, 14, 0],
      [-6, 14, 0],
      [6, 14, 0],
      [18, 14, 0],
      [-22, 0, 1],
      [-10, 2, 1],
      [10, -2, 1],
      [22, 0, 1],
    ] as [number, number, 0 | 1][])
      stall(x, z, r);

    const well = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 1.4, 12), k.mat(k.inkAccent));
    well.position.set(0, 0.7, 0);
    k.add(well);
    k.world.addBox(0, 0, 0, 5, 1.4, 5);
    for (const s of [-1, 1]) k.box(s * 2.2, 1.4, 0, 0.3, 3, 0.3, { ink: INK.BLACK, noShoot: true });
    k.box(0, 4.4, 0, 5.4, 0.4, 1.6, { ink: k.inkWall, noCollide: true });

    for (const [x, z] of [
      [-13, -6],
      [-12.2, -5.4],
      [13, 6],
      [12.4, 6.6],
      [-2, -22],
      [2, 22],
      [-26, -24],
      [26, 24],
      [0, -8],
      [0, 8],
      [-24, 20],
      [24, -20],
    ] as [number, number][])
      k.crate(x, z, rand(0.9, 1.3));

    for (const [x, z] of [
      [-14, -24],
      [14, -24],
      [-14, 24],
      [14, 24],
    ] as [number, number][])
      k.barrel(x, z);

    k.deck(0, 4.6, -27, 56, 6, k.inkWall);
    k.box(0, 4.6, -24.2, 56, 1.0, 0.4, { ink: k.inkAccent });
    k.stairs(-27, -22, -1, "z", 13, 0.36, 0.5, 3.2);
    k.stairs(27, -22, -1, "z", 13, 0.36, 0.5, 3.2);

    for (const [x, z] of [
      [-9, 0],
      [9, 0],
      [0, -18],
      [0, 18],
    ] as [number, number][])
      k.lamp(x, z, 3.8);

    k.planes(3, 18);

    for (const [x, z] of [
      [0, 28],
      [0, -20],
      [28, 0],
      [-28, 0],
      [-26, 26],
      [26, 26],
      [-26, -8],
      [26, -8],
      [0, 6],
      [-16, 20],
      [16, 20],
      [0, -10],
    ] as [number, number][])
      k.spawn(x, z);

    k.sniper(0, 5.0, -27);
    k.sniper(-18, 3.5, -14);
    k.sniper(18, 3.5, 14);
    k.sniper(-22, 3.5, 0);
    k.sniper(22, 3.5, 0);

    k.pickup(0, 0.6, 0);
    k.pickup(-13, 0.6, -6);
    k.pickup(13, 0.6, 6);
  },
};

const island: MapDef = {
  key: "island",
  name: "PEN ISLAND",
  blurb: "a prison rock · cell block, harbour and a long swim",
  half: 40,
  playerStart: [0, 33],
  build: (k) => {
    k.arena(40, 18);

    for (const [x, z, w, d] of [
      [0, 37, 80, 8],
      [0, -37, 80, 8],
      [-37, 0, 8, 66],
      [37, 0, 8, 66],
    ] as [number, number, number, number][]) {
      k.box(x, 0.02, z, w, 0.06, d, { ink: INK.BLUE, noCollide: true, fill: true });
    }
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      const r = 33.5 + Math.sin(i * 2.3) * 1.6;
      k.box(Math.cos(a) * r, 0.05, Math.sin(a) * r, 2.4, 0.1, 2.4, {
        ink: INK.BLUE,
        noCollide: true,
      });
    }

    const cellW = 34;
    const cellD = 12;
    k.box(0, 0, 0, cellW, 4.2, cellD, { ink: k.inkWall });
    k.deck(0, 4.2, 0, cellW, cellD, k.inkWall);
    k.box(0, 4.2, 0, cellW - 2, 4.0, cellD - 2, { ink: k.inkWall });
    k.deck(0, 8.2, 0, cellW - 2, cellD - 2, k.inkAccent);
    k.windowRow(0, 0, cellW, cellD, 2, "z", 1);
    k.windowRow(0, 0, cellW, cellD, 2, "z", -1);
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue;
      k.box(i * 3, 0, -cellD / 2 - 1.6, 0.5, 3.4, 3.2, { ink: INK.BLACK });
      k.box(i * 3, 0, cellD / 2 + 1.6, 0.5, 3.4, 3.2, { ink: INK.BLACK });
    }
    k.stairs(-cellW / 2 - 3, -6, 1, "x", 12, 0.36, 0.5, 3);
    k.stairs(cellW / 2 + 3, 6, -1, "x", 12, 0.36, 0.5, 3);

    const container = (x: number, z: number, rot: 0 | 1, stack = 1) => {
      const w = rot ? 3.2 : 8;
      const d = rot ? 8 : 3.2;
      for (let s = 0; s < stack; s++) {
        k.box(x, s * 2.9, z, w, 2.8, d, { ink: s % 2 ? k.inkAccent : k.inkWall });
      }
    };
    container(-26, 22, 0, 2);
    container(-17, 24, 0, 1);
    container(-28, 14, 1, 3);
    container(-20, 15, 1, 1);
    container(-33, 24, 0, 1);
    k.deck(-24, 8.8, 18, 12, 10, k.inkAccent);
    k.stairs(-14, 20, -1, "x", 12, 0.42, 0.5, 2.6);
    k.box(-24, 0, 33, 6, 0.8, 14, { ink: k.inkWall });
    for (const z of [29, 33, 37]) {
      k.box(-27, 0.8, z, 0.4, 1.6, 0.4, { ink: INK.BLACK, noShoot: true });
      k.box(-21, 0.8, z, 0.4, 1.6, 0.4, { ink: INK.BLACK, noShoot: true });
    }

    const tank = (x: number, z: number, r: number, h: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), k.mat(k.inkWall));
      m.position.set(x, h / 2, z);
      k.add(m);
      k.world.addBox(x, 0, z, r * 1.8, h, r * 1.8);
      k.box(x, h * 0.6, z, r * 1.95, 0.35, r * 1.95, { ink: k.inkAccent, noCollide: true });
    };
    tank(22, -20, 3.4, 8);
    tank(30, -14, 2.6, 6);
    tank(20, -29, 2.4, 5.5);
    k.deck(25, 6.2, -18, 14, 3, k.inkAccent);
    k.box(25, 6.2, -16.4, 14, 1.0, 0.3, { ink: k.inkAccent });
    k.stairs(16, -18, 1, "x", 17, 0.37, 0.42, 2.4);
    for (const [x, z] of [
      [26, -25],
      [17, -24],
      [31, -22],
    ] as [number, number][])
      k.barrel(x, z, 1.6);

    k.building(-24, -22, 14, 12, 12);
    k.deck(-24, 12, -22, 16, 14, k.inkAccent);
    k.stairs(-14, -22, -1, "x", 14, 0.5, 0.5, 3);
    k.box(-24, 0, -14, 10, 3.2, 0.6, { ink: k.inkWall });

    const light = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 16, 10), k.mat(k.inkWall));
    light.position.set(32, 8, 14);
    k.add(light);
    k.world.addBox(32, 0, 14, 5.4, 16, 5.4);
    k.box(32, 16, 14, 6, 1.4, 6, { ink: k.inkAccent });
    k.box(32, 17.4, 14, 3, 1.6, 3, { ink: INK.ORANGE, fill: true, noCollide: true });
    k.stairs(26, 14, 1, "x", 10, 0.5, 0.5, 2.4);
    k.deck(28, 5, 14, 6, 5, k.inkAccent);

    for (let f = 0; f < 3; f++) {
      k.deck(22, 3.4 + f * 3.4, 24, 14, 12, f % 2 ? k.inkAccent : k.inkWall);
      for (const [ox, oz] of [
        [-6.5, -5.5],
        [6.5, -5.5],
        [-6.5, 5.5],
        [6.5, 5.5],
      ] as [number, number][])
        k.box(22 + ox, f * 3.4, 24 + oz, 0.4, 3.4, 0.4, { ink: INK.BLACK, noShoot: true });
      k.stairs(f % 2 ? 15.5 : 28.5, 24, f % 2 ? 1 : -1, "x", 10, 0.34, 0.42, 2.2);
    }

    for (const [x, z, w, h, d] of [
      [-10, 18, 5, 1.3, 1.4],
      [9, 17, 4, 1.2, 1.5],
      [-8, -14, 4.5, 1.4, 1.3],
      [8, -15, 5, 1.2, 1.4],
      [0, 24, 7, 1.1, 1.2],
      [0, -24, 6, 1.3, 1.2],
      [-32, 2, 3.5, 1.6, 5],
      [32, -2, 3.5, 1.6, 5],
      [-18, 32, 4, 1.2, 1.2],
      [16, 33, 4, 1.2, 1.2],
    ] as [number, number, number, number, number][])
      k.box(x, 0, z, w, h, d);

    for (const [x, z] of [
      [-12, 8],
      [-11.2, 8.6],
      [12, -8],
      [11.3, -8.5],
      [-30, -8],
      [30, 8],
      [4, 28],
      [-4, -30],
      [26, 6],
      [-26, -4],
    ] as [number, number][])
      k.crate(x, z, rand(0.8, 1.2));

    for (const [x, z] of [
      [-14, 0],
      [14, 0],
      [0, 16],
      [0, -16],
      [-30, 30],
      [30, -30],
    ] as [number, number][])
      k.lamp(x, z, 5);

    k.planes(3, 26);

    for (const [x, z] of [
      [0, 33],
      [0, -33],
      [-24, 30],
      [24, 30],
      [-30, -30],
      [30, -28],
      [-34, 8],
      [34, -8],
      [-18, 6],
      [18, -6],
      [8, 30],
      [-8, -30],
    ] as [number, number][])
      k.spawn(x, z);

    k.sniper(0, 8.6, 0);
    k.sniper(-24, 12.4, -22);
    k.sniper(32, 16.6, 14);
    k.sniper(22, 13.8, 24);
    k.sniper(-24, 9.2, 18);
    k.sniper(25, 6.6, -18);

    k.pickup(0, 0.6, 0);
    k.pickup(-24, 0.6, 18);
    k.pickup(22, 0.6, -20);
    k.pickup(0, 8.8, 0);
  },
};

const jungle: MapDef = {
  key: "jungle",
  name: "DOODLE JUNGLE",
  blurb: "canopies, vines and a temple somebody drew from memory",
  half: 40,
  playerStart: [0, 30],
  style: {
    paper: [0.955, 0.948, 0.865],
    grid: 1,
    inks: [
      [0.06, 0.3, 0.52],
      [0.86, 0.12, 0.2],
      [0.34, 0.21, 0.1],
      [0.95, 0.55, 0.1],
      [0.1, 0.55, 0.22],
      [0.9, 0.32, 0.55],
    ],
  },
  build: (k) => {
    k.arena(40, 20);

    const riverX = (z: number) => -6 + z * 0.34 + Math.sin(z * 0.09) * 5;
    for (let z = -38; z <= 38; z += 3) {
      const x = riverX(z);
      k.box(x, 0.02, z, 9 + Math.sin(z * 0.21) * 2, 0.06, 3.1, {
        ink: INK.BLUE,
        noCollide: true,
        fill: true,
      });
    }
    for (const [x, z] of [
      [riverX(-20) - 2.8, -20],
      [riverX(-19), -19],
      [riverX(-18) + 2.8, -18],
      [riverX(8) - 2.6, 8],
      [riverX(9), 9],
      [riverX(10) + 2.6, 10],
    ] as [number, number][]) {
      k.box(x, 0, z, 1.6, 0.5, 1.6, { ink: INK.GREEN });
    }

    const tree = (x: number, z: number, top: number, crown: number) => {
      const trunk = 0.9 + crown * 0.06;
      k.box(x, 0, z, trunk, top - 0.6, trunk, { ink: INK.BLACK });
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        k.box(x + dx * (trunk * 0.9), 0, z + dz * (trunk * 0.9), 1.1, 0.75, 1.1, { ink: INK.BLACK });
      }
      k.deck(x, top, z, crown * 1.5, crown * 1.5, INK.GREEN);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + x * 0.01;
        const r = i === 0 ? 0 : crown * 0.5;
        k.mesh(
          new THREE.SphereGeometry(crown * (i === 0 ? 0.62 : 0.4), 9, 6).scale(1, 0.42, 1),
          INK.GREEN,
          x + Math.cos(a) * r,
          top + 0.55,
          z + Math.sin(a) * r,
        );
      }
      for (const a of [0.8, 3.4]) {
        k.box(x + Math.cos(a) * crown * 0.8, top - 6, z + Math.sin(a) * crown * 0.8, 0.16, 12, 0.16, {
          ink: INK.GREEN,
          noCollide: true,
        });
      }
    };
    tree(-26, -24, 9.5, 6.5);
    tree(24, -20, 11, 7);
    tree(-22, 22, 10, 6);
    tree(27, 25, 8.5, 6);
    tree(-32, 2, 12.5, 7.5);
    tree(8, -34, 9, 5.5);

    k.box(-1, 9.6, -22, 26, 0.5, 1.6, { ink: INK.BLACK });
    k.box(-24, 9.8, -1, 1.6, 0.5, 24, { ink: INK.BLACK });

    k.box(0, 0, 0, 20, 3.2, 20, { ink: INK.ORANGE });
    k.box(0, 3.2, 0, 16, 3.0, 16, { ink: INK.ORANGE });
    k.deck(0, 6.2, 0, 12, 12, INK.PINK);
    for (const [x, z, w, d] of [
      [0, -8.4, 4.4, 3.4],
      [0, 8.4, 4.4, 3.4],
    ] as [number, number, number, number][]) {
      k.box(x, 2.4, z, w, 0.8, d, { ink: INK.ORANGE });
    }
    k.stairs(0, -13, 1, "z", 10, 0.34, 0.5, 5);
    k.stairs(0, 13, -1, "z", 10, 0.34, 0.5, 5);
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) k.box(s * 7, 6.2, t * 7, 1.1, 3.4, 1.1, { ink: INK.PINK });
    }

    for (const [x, z, w, h, d] of [
      [-14, -10, 5, 1.4, 1.2],
      [15, 9, 4.5, 1.3, 1.2],
      [-9, 16, 3.4, 1.5, 1.1],
      [12, -14, 4, 1.2, 1.4],
      [-30, -8, 3, 1.6, 1.2],
      [30, 12, 3.6, 1.3, 1.1],
      [-18, 32, 4.2, 1.2, 1.3],
      [20, -32, 3.8, 1.4, 1.2],
    ] as [number, number, number, number, number][]) {
      k.box(x, 0, z, w, h, d, { ink: INK.ORANGE, jitter: 0.03 });
    }
    for (const [x, z] of [
      [-34, -34],
      [34, -34],
      [-34, 34],
      [34, 34],
      [-6, -30],
      [6, 30],
      [-30, 14],
      [30, -14],
      [16, 20],
      [-16, -20],
    ] as [number, number][]) {
      k.mesh(new THREE.SphereGeometry(1.5, 8, 6).scale(1, 0.6, 1), INK.GREEN, x, 0.5, z);
    }

    for (const [x, z] of [
      [0, 30],
      [0, -30],
      [-30, 0],
      [30, 0],
      [-26, -26],
      [26, -26],
      [-26, 26],
      [26, 26],
      [14, 0],
      [-14, 0],
    ] as [number, number][]) {
      k.spawn(x, z);
    }
    k.sniper(0, 6.8, 0);
    k.sniper(-32, 12.9, 2);
    k.sniper(24, 11.4, -20);
    k.sniper(-26, 9.9, -24);

    k.pickup(0, 6.8, 0);
    k.pickup(-22, 0.6, 22);
    k.pickup(24, 0.6, -20);
    k.pickup(0, 0.6, 18);
  },
};

export const MAPS: MapDef[] = [district, rooftops, schoolyard, subway, sketchpad, bazaar, island, jungle];
export const DEFAULT_MAP = district.key;

export function getMap(key: string): MapDef {
  return MAPS.find((m) => m.key === key) ?? district;
}

export function buildLevel(
  scene: THREE.Scene,
  world: World,
  mode: Mode,
  mapKey: string = DEFAULT_MAP,
  night = false,
): Level {
  const def = getMap(mapKey);
  const k = new MapKit(scene, world, mode === "zombies" || night);
  def.build(k);

  const spawns = k.rawSpawns.map(([x, z]) => new THREE.Vector3(x, world.groundY(x, z) + 0.05, z));
  const [px, pz] = def.playerStart;

  return {
    key: def.key,
    meshes: k.meshes,
    animated: k.animated,
    spawns,
    snipers: k.snipers,
    pickups: k.pickups,
    playerStart: new THREE.Vector3(px, world.groundY(px, pz) + 0.05, pz),
    bounds: world.bounds,
  };
}

export function disposeLevel(scene: THREE.Scene, level: Level) {
  for (const m of level.meshes) {
    scene.remove(m);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
  level.meshes.length = 0;
  level.animated.length = 0;
}
