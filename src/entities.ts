/* entities.ts — three.js mesh factories: doodle blobs, zombies, player, projectiles, pickups */
import * as THREE from "three";
import { U, canvasTex, softTexture } from "./utils";

/* shared materials (lightweight) */
const INK = new THREE.MeshLambertMaterial({ color: 0x22242a, flatShading: true });
const PAPER = new THREE.MeshLambertMaterial({ color: 0xfdf9ec, flatShading: true });
const OUTLINE_MAT = new THREE.LineBasicMaterial({ color: 0x22242a });

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/* jittered geometry → hand-drawn wobble */
function jitter(geo: THREE.BufferGeometry, amt: number, seed: number, flat = true): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rnd = U.mulberry(seed);
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (rnd() - .5) * amt,
      pos.getY(i) + (rnd() - .5) * amt,
      pos.getZ(i) + (rnd() - .5) * amt
    );
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  if (flat) {
    // ensure flat shading look: merge duplicate-vertex normals already handled by material
  }
  return g;
}

function outline(geo: THREE.BufferGeometry, threshold = 20): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geo, threshold);
  return new THREE.LineSegments(edges, OUTLINE_MAT);
}

function addOutline(mesh: THREE.Mesh, geo: THREE.BufferGeometry, threshold = 20) {
  mesh.add(outline(geo, threshold));
}

/* ---------- doodle blob (district enemies & boss) ---------- */
export function makeDoodleBlob(radius: number, color: number, seed: number, jag = 0.22): THREE.Group {
  const g = new THREE.Group();
  const geo = jitter(new THREE.SphereGeometry(radius, 10, 8), radius * jag, seed);
  const body = new THREE.Mesh(geo, mat(color));
  body.position.y = radius * 0.92;
  addOutline(body, geo, 30);
  g.add(body);

  // eyes (facing +X)
  const eyeGeo = new THREE.SphereGeometry(radius * .17, 8, 6);
  const pupilGeo = new THREE.SphereGeometry(radius * .085, 6, 5);
  const whiteMat = PAPER;
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, whiteMat);
    eye.position.set(radius * .78, radius * .95, s * radius * .34);
    g.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, INK);
    pupil.position.set(radius * .92, radius * .95, s * radius * .34);
    g.add(pupil);
  }
  // angry brows
  const browGeo = new THREE.BoxGeometry(radius * .34, radius * .09, radius * .09);
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(browGeo, INK);
    brow.position.set(radius * .78, radius * 1.18, s * radius * .34);
    brow.rotation.z = s * -0.5;
    g.add(brow);
  }
  // mouth (arc)
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(radius * .3, radius * .07, 5, 10, Math.PI),
    INK
  );
  mouth.position.set(radius * .86, radius * .55, 0);
  mouth.rotation.y = Math.PI / 2;
  mouth.rotation.z = Math.PI;
  g.add(mouth);
  return g;
}

/* ---------- zombie ---------- */
export function makeZombie(radius: number, type: string, seed: number): THREE.Group {
  const g = new THREE.Group();
  const skin = 0xa8c98e;
  const wob = new THREE.Group(); // children that wobble
  g.add(wob);

  const r = radius;
  const bodyGeo = jitter(new THREE.CapsuleGeometry(r * .5, r * .9, 3, 7), r * .12, seed);
  const body = new THREE.Mesh(bodyGeo, mat(skin));
  body.position.y = r * .95;
  body.rotation.z = -0.35;
  addOutline(body, bodyGeo, 30);
  wob.add(body);

  // guts stripe
  const guts = new THREE.Mesh(new THREE.CylinderGeometry(r * .12, r * .12, r * .9, 6), mat(0x5d8540));
  guts.position.set(r * .1, r * .95, 0);
  guts.rotation.z = -0.35;
  wob.add(guts);

  // legs
  const legGeo = new THREE.CylinderGeometry(r * .13, r * .13, r * .85, 6);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, mat(0x4a4d57));
    leg.position.set(s * r * .22, r * .25, s * r * .1);
    leg.rotation.z = s * -0.12;
    wob.add(leg);
  }

  // head at front (+X), above
  const headGeo = jitter(new THREE.SphereGeometry(r * .48, 8, 7), r * .1, seed + 3);
  const head = new THREE.Mesh(headGeo, mat(skin));
  head.position.set(r * .55, r * 1.5, 0);
  addOutline(head, headGeo, 30);
  wob.add(head);

  // stretched arms toward +X
  const armGeo = new THREE.CylinderGeometry(r * .14, r * .14, r * 1.15, 6);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, mat(skin));
    arm.position.set(r * 1.05, r * 1.15, s * r * .3);
    arm.rotation.z = -Math.PI / 2.4;
    wob.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(r * .18, 6, 5), mat(skin));
    hand.position.set(r * 1.62, r * .78, s * r * .3);
    wob.add(hand);
  }

  // X eyes
  const xSeg = new THREE.BoxGeometry(r * .2, r * .05, r * .05);
  for (const s of [-1, 1]) {
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const seg = new THREE.Mesh(xSeg, INK);
      seg.position.set(r * .62, r * 1.62, s * r * .18);
      seg.rotation.x = rot;
      seg.rotation.y = Math.PI / 2;
      wob.add(seg);
    }
  }
  // wound patch
  const wound = new THREE.Mesh(new THREE.CircleGeometry(r * .28, 8), mat(0x7a3b2e));
  wound.position.set(r * .42, r * .72, r * .3);
  wound.rotation.y = Math.PI / 2;
  wob.add(wound);

  if (type === "brute" || type === "boss") {
    g.remove(wob);
    // big blob + arms + crown
    const blob = makeDoodleBlob(r, 0x7fae66, seed, .18);
    blob.position.y = 0;
    const inner = blob.children[0] as THREE.Mesh;
    inner.position.y = r * .95;
    g.add(blob);
    g.userData.wobble = blob;
    if (type === "boss") {
      const crown = new THREE.Group();
      for (let i = -2; i <= 2; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(r * .14, r * .5, 5), mat(0x9ac27e));
        spike.position.set(i * r * .3, r * 2.1, 0);
        crown.add(spike);
      }
      g.add(crown);
      g.userData.wobble = blob;
    }
    return g;
  }
  g.userData.wobble = wob;
  return g;
}

/* ---------- player ---------- */
export function makePlayer(): { group: THREE.Group; body: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; gunMount: THREE.Object3D; shadow: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // legs
  const legGeo = new THREE.CylinderGeometry(3.4, 3.4, 16, 6);
  const legL = new THREE.Mesh(legGeo, INK); legL.position.set(0, 8, 5);
  const legR = new THREE.Mesh(legGeo, INK); legR.position.set(0, 8, -5);
  body.add(legL, legR);
  body.userData.legs = [legL, legR];

  // torso (leaning stick)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(5, 6.4, 24, 7), INK);
  torso.position.set(-1, 24, 0);
  torso.rotation.z = 0.12;
  body.add(torso);

  // backpack
  const bag = new THREE.Mesh(new THREE.SphereGeometry(7, 7, 6), mat(0x3f9d63));
  bag.position.set(-10, 26, 0);
  body.add(bag);

  // head + cap (facing +X)
  const head = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), PAPER);
  head.position.set(4, 42, 0);
  body.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(9.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3b6fd4));
  cap.position.set(4, 43, 0);
  body.add(cap);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 2, 8), mat(0x3b6fd4));
  brim.position.set(13, 44, 0);
  brim.rotation.z = Math.PI / 2;
  body.add(brim);

  // eyes + smile
  const eyeGeo = new THREE.SphereGeometry(1.6, 6, 5);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, INK);
    eye.position.set(11, 44, s * 4);
    body.add(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(3.4, 1, 4, 8, Math.PI), INK);
  smile.position.set(10, 38, 0);
  smile.rotation.y = Math.PI / 2;
  smile.rotation.z = Math.PI;
  body.add(smile);

  // arms (mounted for aiming)
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const armGeo = new THREE.CylinderGeometry(2.6, 2.6, 18, 6);
  const armMeshL = new THREE.Mesh(armGeo, INK); armMeshL.position.set(9, 0, 0); armMeshL.rotation.z = Math.PI / 2;
  const armMeshR = new THREE.Mesh(armGeo, INK); armMeshR.position.set(9, 0, 0); armMeshR.rotation.z = Math.PI / 2;
  armL.add(armMeshL); armR.add(armMeshR);
  armL.position.set(0, 30, 7);
  armR.position.set(0, 30, -7);
  body.add(armL, armR);

  // gun mount
  const gunMount = new THREE.Group();
  gunMount.position.set(6, 30, 0);
  body.add(gunMount);

  // shadow blob
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(16, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.6;
  group.add(shadow);

  return { group, body, armL, armR, gunMount, shadow };
}

/* weapon mesh builder — replaces content of gunMount */
export function buildWeaponMesh(defId: string): THREE.Group {
  const g = new THREE.Group();
  if (defId === "katana") {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(46, 2.2, 8), mat(0xdfe9f5));
    blade.position.x = 24;
    g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(4.2, 8, 4), mat(0xdfe9f5));
    tip.position.x = 50; tip.rotation.z = -Math.PI / 2;
    g.add(tip);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 12, 6), mat(0x3b6fd4));
    handle.rotation.z = Math.PI / 2;
    handle.position.x = -4;
    g.add(handle);
  } else {
    const len = defId === "sniper" ? 52 : 34;
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 6.5, 6), INK);
    body.position.x = len / 2 + 4;
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, len * 0.55, 6), mat(defId === "sniper" ? 0x3f9d63 : 0x3b6fd4));
    barrel.rotation.z = Math.PI / 2;
    barrel.position.x = len + 6;
    g.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 5), mat(0x3b6fd4));
    mag.position.set(len * .55, -7, 0);
    g.add(mag);
    if (defId === "sniper") {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 16, 6), PAPER);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(len * .6, 8, 0);
      g.add(scope);
    }
  }
  return g;
}

/* ---------- projectiles / pickups ---------- */
export function makeBullet(color: number): THREE.Group {
  const g = new THREE.Group();
  const tip = new THREE.Mesh(new THREE.SphereGeometry(3, 6, 5), mat(color));
  g.add(tip);
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 3, 12, 5), INK);
  trail.rotation.z = Math.PI / 2;
  trail.position.x = -7;
  g.add(trail);
  return g;
}

export function makeEBullet(color: number): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(6, 7, 6), mat(color));
  g.add(s);
  return g;
}

export function makeGrenade(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 6), mat(0x3f9d63));
  body.position.y = 7;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 6, 5), INK);
  cap.position.y = 15;
  g.add(cap);
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xffd76a, transparent: true, blending: THREE.AdditiveBlending }));
  spark.scale.set(10, 10, 1);
  spark.position.y = 20;
  g.add(spark);
  return g;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function makePickup(type: "coin" | "heart" | "ammo" | "medkit" | "flash"): THREE.Group {
  const g = new THREE.Group();
  if (type === "coin") {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2.5, 14), mat(0xffd76a));
    c.rotation.x = Math.PI / 2;
    c.position.y = 8;
    g.add(c);
    const face = canvasTex(64, 64, (ctx) => {
      ctx.fillStyle = "#ffd76a"; ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#22242a"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#22242a"; ctx.font = "800 34px cursive"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("¢", 32, 34);
    });
    const coinFace = new THREE.Sprite(new THREE.SpriteMaterial({ map: face, transparent: true }));
    coinFace.scale.set(22, 22, 1);
    coinFace.position.y = 9;
    g.add(coinFace);
  } else if (type === "heart") {
    const tex = canvasTex(64, 64, (ctx) => {
      ctx.fillStyle = "#e97f9a";
      ctx.beginPath();
      ctx.moveTo(32, 56);
      ctx.bezierCurveTo(6, 38, 10, 12, 32, 22);
      ctx.bezierCurveTo(54, 12, 58, 38, 32, 56);
      ctx.fill();
      ctx.strokeStyle = "#22242a"; ctx.lineWidth = 4; ctx.stroke();
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    s.scale.set(26, 26, 1); s.position.y = 10;
    g.add(s);
  } else if (type === "ammo") {
    const box = new THREE.Mesh(new THREE.BoxGeometry(26, 10, 16), mat(0xffffff));
    box.position.y = 8;
    g.add(box);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(18, 4, 2), mat(0x3b6fd4));
    mark.position.set(0, 8, 8.4);
    g.add(mark);
  } else if (type === "medkit") {
    const box = new THREE.Mesh(new THREE.BoxGeometry(28, 10, 18), PAPER);
    box.position.y = 8;
    g.add(box);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 12), mat(0xd94f3d));
    crossV.position.set(0, 8.5, 0);
    g.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 6), mat(0xd94f3d));
    crossH.position.set(0, 8.5, 0);
    crossH.rotation.y = Math.PI / 2;
    g.add(crossH);
  } else {
    const tex = canvasTex(64, 64, (ctx) => {
      ctx.fillStyle = "#e8b731";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 30 : 14;
        const px = 32 + Math.cos(a) * r, py = 32 + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#22242a"; ctx.lineWidth = 3; ctx.stroke();
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending }));
    s.scale.set(34, 34, 1); s.position.y = 12;
    g.add(s);
  }
  return g;
}

/* enemy hp bar (billboard sprite with bitmap) */
export function makeHpBar(): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 10;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(34, 5.4, 1);
  return { sprite, canvas, ctx };
}

export function updateHpBar(bar: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }, pct: number, color: string) {
  const { ctx, canvas, sprite } = bar;
  ctx.clearRect(0, 0, 64, 10);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 1, 1, 62, 8, 3); ctx.fill();
  ctx.strokeStyle = "#22242a"; ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, 62, 8, 3); ctx.stroke();
  ctx.fillStyle = color;
  roundRect(ctx, 3, 3, Math.max(2, 58 * Math.max(0, pct)), 4, 2); ctx.fill();
  (sprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  void canvas;
}

/* slash arc visual */
export function makeSlashSprite(color: number): THREE.Sprite {
  const tex = canvasTex(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(64, 64, 46, -1.1, 1.1);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(64, 64, 40, -1.0, 1.0);
    ctx.stroke();
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false }));
  s.scale.set(110, 110, 1);
  return s;
}
