/* utils.ts — math, seeded rng, storage, canvas-texture helpers */
import * as THREE from "three";

export const U = {
  clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; },
  lerp(a: number, b: number, t: number) { return a + (b - a) * t; },
  rand(a: number, b: number) { return a + Math.random() * (b - a); },
  randInt(a: number, b: number) { return Math.floor(U.rand(a, b + 1)); },
  pick<T>(arr: T[]): T { return arr[(Math.random() * arr.length) | 0]; },
  dist(x1: number, z1: number, x2: number, z2: number) { return Math.hypot(x2 - x1, z2 - z1); },
  angle(x1: number, z1: number, x2: number, z2: number) { return Math.atan2(z2 - z1, x2 - x1); },
  angleLerp(a: number, b: number, t: number) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * U.clamp(t, 0, 1);
  },
  wrapAngle(a: number) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; },
  mulberry(seed: number) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
};

export const Store = {
  get<T>(key: string, def: T): T {
    try {
      const v = localStorage.getItem("dd3_" + key);
      return v === null ? def : (JSON.parse(v) as T);
    } catch { return def; }
  },
  set(key: string, val: unknown) {
    try { localStorage.setItem("dd3_" + key, JSON.stringify(val)); } catch { /* ignore */ }
  },
};

/* ---------- canvas textures ---------- */
export function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* soft round particle sprite texture (shared) */
let _softTex: THREE.CanvasTexture | null = null;
export function softTexture(): THREE.CanvasTexture {
  if (_softTex) return _softTex;
  _softTex = canvasTex(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  return _softTex;
}

/* notebook paper ground texture: grid + subtle stains */
export function paperTexture(): THREE.CanvasTexture {
  const tex = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = "#f6f1e3";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(59,111,212,.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= 256; x += 36) {
      ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, 256); ctx.stroke();
    }
    for (let y = 0; y <= 256; y += 36) {
      ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(256, y + .5); ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function textSpriteTexture(txt: string, color: string, size = 26, bold = true): THREE.CanvasTexture {
  return canvasTex(512, 128, (ctx) => {
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = `${bold ? "800" : "500"} ${size}px "Shantell Sans", "Patrick Hand", cursive`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = size / 5;
    ctx.strokeStyle = "rgba(255,255,255,.92)";
    ctx.strokeText(txt, 256, 64);
    ctx.fillStyle = color;
    ctx.fillText(txt, 256, 64);
  });
}

export function makeTextSprite(txt: string, color: string, scale = 1): THREE.Sprite {
  const tex = textSpriteTexture(txt, color);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(60 * scale, 15 * scale, 1);
  return s;
}
