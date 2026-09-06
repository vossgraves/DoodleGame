import * as THREE from "three";
import { World } from "./physics";
import { INK, makeInkMaterial } from "./renderer";
import { rand } from "./math";

export type Mode = "district" | "zombies";

export interface Level {
  meshes: THREE.Object3D[];
  animated: { mesh: THREE.Object3D; update: (t: number) => void }[];
  spawns: THREE.Vector3[];
  snipers: THREE.Vector3[];
  pickups: THREE.Vector3[];
  playerStart: THREE.Vector3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function jitterGeo(g: THREE.BufferGeometry, amt: number) {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + rand(-amt, amt), pos.getY(i) + rand(-amt, amt), pos.getZ(i) + rand(-amt, amt));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

export function buildLevel(scene: THREE.Scene, world: World, mode: Mode): Level {
  const meshes: THREE.Object3D[] = [];
  const animated: Level["animated"] = [];
  const spawns: THREE.Vector3[] = [];
  const snipers: THREE.Vector3[] = [];
  const pickups: THREE.Vector3[] = [];
  const night = mode === "zombies";
  const inkWall = night ? INK.BLACK : INK.BLUE;
  const inkAccent = night ? INK.RED : INK.ORANGE;

  const mats: Record<number, THREE.ShaderMaterial> = {};
  const mat = (ink: number, fill = false) => {
    const k = ink + (fill ? 10 : 0);
    if (!mats[k]) mats[k] = makeInkMaterial({ ink, fill, shadeBias: fill ? 0 : -0.05 });
    return mats[k];
  };

  const addMesh = (g: THREE.BufferGeometry, ink: number, x: number, y: number, z: number, fill = false) => {
    jitterGeo(g, 0.018);
    const m = new THREE.Mesh(g, mat(ink, fill));
    m.position.set(x, y, z);
    scene.add(m);
    meshes.push(m);
    return m;
  };

  const box = (cx: number, y: number, cz: number, w: number, h: number, d: number, o: { ink?: number; noCollide?: boolean; noShoot?: boolean; fill?: boolean; jitter?: number } = {}) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.jitter !== 0) jitterGeo(g, o.jitter ?? 0.02);
    const m = new THREE.Mesh(g, mat(o.ink ?? inkWall, o.fill));
    m.position.set(cx, y + h / 2, cz);
    scene.add(m);
    meshes.push(m);
    if (!o.noCollide) world.addBox(cx, y, cz, w, h, d, { noShoot: o.noShoot });
    return m;
  };

  const P = 40;
  world.bounds = { minX: -P + 1, maxX: P - 1, minZ: -P + 1, maxZ: P - 1 };
  // ground + perimeter
  box(0, -1, 0, 2 * P + 8, 1, 2 * P + 8, { ink: inkWall, jitter: 0.01 });
  box(0, 0, -P, 2 * P + 6, 16, 4, { ink: inkWall });
  box(0, 0, P, 2 * P + 6, 16, 4, { ink: inkWall });
  box(-P, 0, 0, 4, 16, 2 * P + 6, { ink: inkWall });
  box(P, 0, 0, 4, 16, 2 * P + 6, { ink: inkWall });

  const windowRow = (cx: number, cz: number, w: number, d: number, floors: number, face: "x" | "z", sign: number) => {
    for (let f = 0; f < floors; f++) {
      const y = 1.4 + f * 3.1;
      const n = Math.max(1, Math.floor((face === "x" ? d : w) / 2.4));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = face === "z" ? cx - w / 2 + t * w : cx + sign * (w / 2 + 0.06);
        const z = face === "x" ? cz - d / 2 + t * d : cz + sign * (d / 2 + 0.06);
        const gw = face === "z" ? 0.7 : 0.08;
        const gd = face === "x" ? 0.7 : 0.08;
        box(x, y, z, gw, 1.1, gd, { ink: night ? INK.RED : INK.BLACK, noCollide: true, fill: night, jitter: 0.01 });
        if (night && Math.random() < 0.45) {
          // boarded X
          const plank = new THREE.BoxGeometry(0.08, 1.3, 0.08);
          const m1 = new THREE.Mesh(plank, mat(INK.RED));
          m1.position.set(x, y + 0.55, z);
          m1.rotation.z = 0.7;
          scene.add(m1);
          meshes.push(m1);
          const m2 = m1.clone();
          m2.rotation.z = -0.7;
          scene.add(m2);
          meshes.push(m2);
        }
      }
    }
  };

  // city blocks
  const buildings: Array<[number, number, number, number, number, number]> = [
    [-26, -26, 16, 11, 16, 0],
    [24, -24, 18, 9, 14, 0],
    [-24, 22, 14, 13, 18, 0],
    [26, 24, 16, 10, 14, 0],
    [-8, -28, 10, 7, 12, 0],
    [8, 28, 12, 8, 10, 0],
    [-30, 4, 10, 8, 14, 0],
    [30, -6, 10, 7, 16, 0],
  ];
  for (const [x, z, w, h, d] of buildings) {
    box(x, 0, z, w, h, d, { ink: inkWall });
    windowRow(x, z, w, d, Math.floor(h / 3), "z", 1);
    windowRow(x, z, w, d, Math.floor(h / 3), "z", -1);
    windowRow(x, z, w, d, Math.floor(h / 3), "x", 1);
    windowRow(x, z, w, d, Math.floor(h / 3), "x", -1);
    // rooftop lip
    box(x, h, z, w + 0.4, 0.35, d + 0.4, { ink: inkAccent, noCollide: false });
  }

  // low walls / cover
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
  for (const [x, z, w, h, d] of cover) box(x, 0, z, w, h, d, { ink: inkWall });

  // crates
  const crates = [
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
  ];
  for (const [x, z] of crates) {
    const s = rand(0.7, 1.15);
    box(x, 0, z, s, s, s, { ink: Math.random() < 0.3 ? inkAccent : inkWall });
  }

  // doodle cars (cover)
  const cars: Array<[number, number, number]> = [
    [-4, -18, 0.4],
    [15, -2, 1.2],
    [-20, 8, -0.5],
    [6, 16, 2.1],
  ];
  for (const [x, z, rot] of cars) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 1.6), mat(night ? INK.BLACK : INK.BLUE));
    body.position.y = 0.7;
    g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.5), mat(night ? INK.RED : INK.BLACK));
    cab.position.set(-0.3, 1.4, 0);
    g.add(cab);
    for (const wz of [-0.85, 0.85])
      for (const wx of [-1.1, 1.1]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8), mat(INK.BLACK, true));
        wh.rotation.z = Math.PI / 2;
        wh.position.set(wx, 0.32, wz);
        g.add(wh);
      }
    scene.add(g);
    meshes.push(g);
    world.addBox(x, 0, z, 3.4, 1.5, 1.7);
  }

  // stairs onto a low roof platform
  const stairs = (sx: number, sz: number, dir: 1 | -1, axis: "x" | "z", steps = 8, rise = 0.32, run = 0.48, width = 2.2) => {
    for (let i = 0; i < steps; i++) {
      const c = (i + 0.5) * run;
      const h = (i + 1) * rise;
      const cx = axis === "x" ? sx + dir * c : sx;
      const cz = axis === "z" ? sz + dir * c : sz;
      box(cx, 0, cz, axis === "x" ? run + 0.02 : width, h, axis === "z" ? run + 0.02 : width, { ink: inkWall, jitter: 0.01 });
    }
  };
  stairs(-14, -18, 1, "z", 10);
  box(-14, 3.2, -12.4, 6, 0.35, 4, { ink: inkWall });
  stairs(18, 12, -1, "x", 9);
  box(13.2, 2.88, 12, 4, 0.35, 5, { ink: inkWall });

  // plaza fountain / lamp
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.6, 10), mat(inkAccent));
  fountain.position.set(0, 0.3, 0);
  scene.add(fountain);
  meshes.push(fountain);
  world.addBox(0, 0, 0, 4.6, 0.6, 4.6);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6), mat(inkWall));
  spout.position.set(0, 1.3, 0);
  scene.add(spout);
  meshes.push(spout);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 6), mat(night ? INK.RED : INK.BLUE, true));
  bowl.position.set(0, 2.1, 0);
  scene.add(bowl);
  meshes.push(bowl);

  // lamp posts
  const lamps = [
    [-10, -10],
    [10, 10],
    [-10, 10],
    [10, -10],
    [0, 22],
    [0, -22],
  ];
  for (const [x, z] of lamps) {
    box(x, 0, z, 0.22, 4.4, 0.22, { ink: INK.BLACK, noShoot: true });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mat(night ? INK.ORANGE : INK.ORANGE, true));
    bulb.position.set(x, 4.6, z);
    scene.add(bulb);
    meshes.push(bulb);
  }

  // dumpsters
  for (const [x, z] of [
    [-22, -8],
    [22, 10],
    [-6, 24],
  ] as [number, number][]) {
    box(x, 0, z, 2.2, 1.4, 1.2, { ink: night ? INK.GREEN : INK.BLACK });
  }

  // fire escapes / ledges
  const ledges: Array<[number, number, number, number]> = [
    [-36, -12, 1.4, 6],
    [36, 14, 1.4, 6],
    [-12, -36, 6, 1.4],
    [10, 36, 6, 1.4],
  ];
  for (const [x, z, w, d] of ledges) {
    box(x, 6, z, w, 0.3, d, { ink: inkAccent });
    box(x, 3.2, z, w, 0.3, d, { ink: inkAccent });
  }

  // rings / doodle props
  for (const [x, y, z] of [
    [0, 5, 0],
    [-16, 4, 4],
    [14, 3.5, -10],
  ] as [number, number, number][]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 14), mat(INK.ORANGE));
    t.position.set(x, y, z);
    t.rotation.x = Math.PI / 2;
    scene.add(t);
    meshes.push(t);
  }

  // paper planes
  for (let i = 0; i < 4; i++) {
    const g = new THREE.ConeGeometry(0.7, 2.2, 3);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, mat(night ? INK.RED : INK.BLUE));
    scene.add(m);
    meshes.push(m);
    const r = 18 + i * 6;
    const h = 9 + i * 2.2;
    const ph = i * 1.7;
    const sp = 0.12 + i * 0.02;
    animated.push({
      mesh: m,
      update: (t) => {
        const a = t * sp + ph;
        m.position.set(Math.cos(a) * r, h + Math.sin(a * 2.2) * 1.4, Math.sin(a) * r * 0.75);
        m.lookAt(Math.cos(a + 0.08) * r, h, Math.sin(a + 0.08) * r * 0.75);
      },
    });
  }

  // graffiti scribbles on a wall (zombies)
  if (night) {
    for (let i = 0; i < 12; i++) {
      const g = new THREE.BoxGeometry(rand(0.4, 1.6), 0.08, 0.08);
      const m = new THREE.Mesh(g, mat(INK.RED, true));
      m.position.set(rand(-30, 30), rand(1.2, 3.5), -37.7);
      m.rotation.z = rand(-0.4, 0.4);
      scene.add(m);
      meshes.push(m);
    }
  }

  // spawn points around streets
  const spawnPts = [
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
  ];
  for (const [x, z] of spawnPts) spawns.push(new THREE.Vector3(x, world.groundY(x, z) + 0.05, z));

  snipers.push(new THREE.Vector3(-26, 11.2, -26));
  snipers.push(new THREE.Vector3(24, 9.2, -24));
  snipers.push(new THREE.Vector3(-24, 13.2, 22));
  snipers.push(new THREE.Vector3(26, 10.2, 24));
  snipers.push(new THREE.Vector3(-14, 3.6, -12.4));

  pickups.push(new THREE.Vector3(4, 0.6, 4));
  pickups.push(new THREE.Vector3(-8, 0.6, 8));
  pickups.push(new THREE.Vector3(12, 0.6, -6));

  // doodle trees / scribbly bushes
  for (const [x, z] of [
    [-32, 28],
    [32, -28],
    [-28, -32],
    [28, 32],
  ] as [number, number][]) {
    box(x, 0, z, 0.35, 2.2, 0.35, { ink: INK.BLACK, noShoot: true });
    addMesh(new THREE.SphereGeometry(1.3, 8, 6), night ? INK.BLACK : INK.GREEN, x, 3.1, z);
  }

  return {
    meshes,
    animated,
    spawns,
    snipers,
    pickups,
    playerStart: new THREE.Vector3(0, 0, 28),
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