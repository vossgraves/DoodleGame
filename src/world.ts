/* world.ts — three.js scene: renderer, camera, notebook arena, day/night decor */
import * as THREE from "three";
import { U, paperTexture, softTexture } from "./utils";
import type { Mode } from "./types";

const PAPER = 0xf6f1e3;

export class World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ambient: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  width = 2400;
  height = 1600;
  camOffset = new THREE.Vector3(0, 330, 265);
  camPos = new THREE.Vector3(this.width / 2, 330, this.height / 2 + 265);
  lookTarget = new THREE.Vector3(this.width / 2, 0, this.height / 2);
  shake = 0;
  private dayGroup = new THREE.Group();
  private nightGroup = new THREE.Group();
  private night = false;
  private tex: THREE.CanvasTexture | null = null;
  private _fogDay: THREE.Fog | null = null;
  private _fogNight: THREE.Fog | null = null;
  private stars: THREE.Points | null = null;
  private moon: THREE.Sprite | null = null;
  private sun: THREE.Sprite | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PAPER);
    this._fogDay = new THREE.Fog(PAPER, 1100, 2600);
    this._fogNight = new THREE.Fog(0x1b2030, 260, 1500);
    this.scene.fog = this._fogDay;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 5000);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookTarget);

    this.ambient = new THREE.HemisphereLight(0xfff6e0, 0xcbbf9f, 1.05);
    this.scene.add(this.ambient);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
    this.sunLight.position.set(300, 600, 200);
    this.scene.add(this.sunLight);

    this.buildGround();
    this.buildDayDecor();
    this.buildNightDecor();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: Mode) {
    this.night = mode === "zombies";
    this.dayGroup.visible = !this.night;
    this.nightGroup.visible = this.night;
    this.scene.fog = this.night ? this._fogNight : this._fogDay;
    this.scene.background = new THREE.Color(this.night ? 0x1b2030 : PAPER);
    if (this.night) {
      this.ambient.color.set(0x9fb6c8);
      this.ambient.groundColor.set(0x3a4438);
      this.ambient.intensity = 0.55;
      this.sunLight.color.set(0x8fa3c8);
      this.sunLight.intensity = 0.4;
    } else {
      this.ambient.color.set(0xfff6e0);
      this.ambient.groundColor.set(0xcbbf9f);
      this.ambient.intensity = 1.05;
      this.sunLight.color.set(0xffffff);
      this.sunLight.intensity = 0.85;
    }
  }

  private buildGround() {
    const tex = paperTexture();
    tex.repeat.set(this.width / 256, this.height / 256);
    tex.needsUpdate = true;
    this.tex = tex;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, this.height),
      new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.width / 2, 0, this.height / 2);
    this.scene.add(ground);

    // red margin line
    const margin = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.5, this.height),
      new THREE.MeshBasicMaterial({ color: 0xd94f3d, transparent: true, opacity: 0.55 })
    );
    margin.position.set(64, 0.4, this.height / 2);
    this.scene.add(margin);

    // edge border
    const pts: THREE.Vector3[] = [
      new THREE.Vector3(8, 0.4, 8),
      new THREE.Vector3(this.width - 8, 0.4, 8),
      new THREE.Vector3(this.width - 8, 0.4, this.height - 8),
      new THREE.Vector3(8, 0.4, this.height - 8),
      new THREE.Vector3(8, 0.4, 8),
    ];
    const border = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x22242a })
    );
    this.scene.add(border);
  }

  private makeFlat(geo: THREE.BufferGeometry, color: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return m;
  }

  private buildDayDecor() {
    const g = this.dayGroup;
    const rnd = U.mulberry(1234);
    // sun
    const sunTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ctx = c.getContext("2d")!;
      const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
      grad.addColorStop(0, "#fff3c9");
      grad.addColorStop(1, "#ffe9b0");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#e8b731"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false }));
    this.sun.scale.set(150, 150, 1);
    this.sun.position.set(this.width * .88, 120, this.height * .12);
    g.add(this.sun);
    // sun rays
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const ray = new THREE.Mesh(new THREE.ConeGeometry(4, 26, 4), new THREE.MeshBasicMaterial({ color: 0xe8b731 }));
      ray.position.set(
        this.sun.position.x + Math.cos(a) * 110,
        110,
        this.sun.position.z + Math.sin(a) * 110
      );
      ray.rotation.z = a - Math.PI / 2;
      g.add(ray);
    }
    // clouds
    for (let i = 0; i < 7; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      const s = 30 + rnd() * 40;
      for (let j = 0; j < n; j++) {
        const puff = this.makeFlat(new THREE.SphereGeometry(s * (0.6 + rnd() * 0.5), 7, 5), 0xffffff);
        puff.position.set((j - n / 2) * s * 0.8, 0, (rnd() - .5) * 18);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set(rnd() * this.width, 130 + rnd() * 60, rnd() * this.height);
      g.add(cloud);
    }
    // bushes / grass tufts
    for (let i = 0; i < 46; i++) {
      const tuft = this.makeFlat(new THREE.ConeGeometry(5 + rnd() * 8, 10 + rnd() * 16, 5), rnd() < .5 ? 0x8fbf6a : 0x9acf72);
      tuft.position.set(80 + rnd() * (this.width - 160), 5, 40 + rnd() * (this.height - 80));
      tuft.rotation.y = rnd() * 3;
      g.add(tuft);
    }
    // flowers
    const flowerCols = [0xd94f3d, 0xe8b731, 0x3b6fd4, 0xe97f9a];
    for (let i = 0; i < 26; i++) {
      const f = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 12, 4), new THREE.MeshLambertMaterial({ color: 0x3f9d63 }));
      stem.position.y = 6;
      f.add(stem);
      const petal = this.makeFlat(new THREE.SphereGeometry(5, 6, 5), U.pick(flowerCols));
      petal.position.y = 13;
      f.add(petal);
      f.position.set(100 + rnd() * (this.width - 200), 0, 90 + rnd() * (this.height - 160));
      f.rotation.y = rnd() * 3;
      g.add(f);
    }
    // wandering stick figures
    for (let i = 0; i < 5; i++) {
      const fig = new THREE.Group();
      const head = new THREE.Mesh(new THREE.SphereGeometry(7, 7, 5), new THREE.MeshLambertMaterial({ color: 0x22242a }));
      head.position.y = 26;
      fig.add(head);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 20, 5), new THREE.MeshLambertMaterial({ color: 0x22242a }));
      b.position.y = 12;
      fig.add(b);
      const l1 = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 14, 5), new THREE.MeshLambertMaterial({ color: 0x22242a }));
      l1.position.set(-4, 0, 0); l1.rotation.z = .5;
      fig.add(l1);
      const l2 = l1.clone(); l2.position.x = 4; l2.rotation.z = -.5;
      fig.add(l2);
      fig.position.set(150 + rnd() * (this.width - 300), 0, 150 + rnd() * (this.height - 300));
      fig.rotation.y = rnd() * Math.PI * 2;
      g.add(fig);
    }
    this.scene.add(g);
  }

  private buildNightDecor() {
    const g = this.nightGroup;
    const rnd = U.mulberry(987);
    // stars
    const starPos: number[] = [];
    for (let i = 0; i < 300; i++) {
      starPos.push(rnd() * this.width, 90 + rnd() * 220, rnd() * this.height);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff6c9, size: 4, sizeAttenuation: true, transparent: true, opacity: .9 }));
    g.add(this.stars);
    // moon
    const moonTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#f5efc8";
      ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(246,241,227,.95)";
      ctx.beginPath(); ctx.arc(82, 48, 48, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(34,36,42,.5)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false }));
    this.moon.scale.set(170, 170, 1);
    this.moon.position.set(this.width * .82, 160, this.height * .1);
    g.add(this.moon);
    // tombstones
    for (let i = 0; i < 10; i++) {
      const t = new THREE.Group();
      const stone = new THREE.Mesh(new THREE.BoxGeometry(26, 34, 8), new THREE.MeshLambertMaterial({ color: 0x808694 }));
      stone.position.y = 17;
      t.add(stone);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 8, 8, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x808694 }));
      cap.rotation.z = Math.PI / 2;
      cap.position.y = 34;
      t.add(cap);
      t.position.set(100 + rnd() * (this.width - 200), 0, 100 + rnd() * (this.height - 200));
      t.rotation.y = (rnd() - .5) * .4;
      g.add(t);
    }
    // crooked houses
    for (let i = 0; i < 5; i++) {
      const h = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(110, 90, 70), new THREE.MeshLambertMaterial({ color: 0x5a6074 }));
      body.position.y = 45;
      h.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(80, 46, 4), new THREE.MeshLambertMaterial({ color: 0x2e3242, flatShading: true }));
      roof.position.y = 112;
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = .62;
      h.add(roof);
      const winMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8 });
      for (const [wx, wz] of [[-28, 36], [0, 36], [28, 36]] as const) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(18, 20, 2), winMat);
        win.position.set(wx, 52, wz);
        h.add(win);
      }
      h.position.set(140 + rnd() * (this.width - 280), 0, 140 + rnd() * (this.height - 280));
      h.rotation.y = (rnd() - .5) * .5;
      g.add(h);
    }
    // graveyard bushes (dead)
    for (let i = 0; i < 26; i++) {
      const dead = this.makeFlat(new THREE.ConeGeometry(4, 12, 5), 0x4a5a48);
      dead.position.set(80 + rnd() * (this.width - 160), 5, 80 + rnd() * (this.height - 160));
      g.add(dead);
    }
    g.visible = false;
    this.scene.add(g);
  }

  /* camera helpers */
  followPlayer(px: number, pz: number, dt: number) {
    const tx = px + this.camOffset.x;
    const ty = this.camOffset.y;
    const tz = pz + this.camOffset.z;
    const k = 1 - Math.pow(0.001, dt);
    this.camPos.x = U.lerp(this.camPos.x, tx, k * 2.5 > 1 ? 1 : k * 2.5);
    this.camPos.z = U.lerp(this.camPos.z, tz, k * 2.5 > 1 ? 1 : k * 2.5);
    this.camPos.y = ty;
    this.shake = Math.max(0, this.shake - dt * 26);
    const sx = (Math.random() - .5) * this.shake;
    const sy = (Math.random() - .5) * this.shake * .6;
    const sz = (Math.random() - .5) * this.shake;
    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z + sz);
    this.camera.lookAt(this.lookTarget.set(px, 0, pz));
  }

  snapTo(px: number, pz: number) {
    this.camPos.set(px + this.camOffset.x, this.camOffset.y, pz + this.camOffset.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookTarget.set(px, 0, pz));
  }

  raycastGround(ndcX: number, ndcY: number, out: THREE.Vector3): boolean {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    return raycaster.ray.intersectPlane(plane, out) !== null;
  }

  /* soft billboard for particles / text popups */
  softSprite(color: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color, transparent: true, depthWrite: false }));
    return s;
  }
}
