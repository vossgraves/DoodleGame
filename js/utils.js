/* utils.js — math, rng, storage, shared drawing helpers */
"use strict";

const U = {
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(U.rand(a, b + 1)); },
  pick(arr) { return arr[(Math.random() * arr.length) | 0]; },
  dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.hypot(dx, dy); },
  angle(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); },
  angleLerp(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * U.clamp(t, 0, 1);
  },
  wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; },
  easeOut(t) { return 1 - (1 - t) * (1 - t); },
  easeInOut(t) { return t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); },
  // seeded rng for procedural decoration
  mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
};

const Store = {
  get(key, def) {
    try {
      const v = localStorage.getItem("dd_" + key);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set(key, val) {
    try { localStorage.setItem("dd_" + key, JSON.stringify(val)); } catch (e) { }
  },
};

/* ---------- canvas drawing helpers (all canvas element is passed) ---------- */

const Draw = {
  // wobbling circle — the core doodle shape
  circle(ctx, x, y, r, opts = {}) {
    const j = opts.jitter ?? r * 0.09;
    const rot = opts.rot ?? 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r + (Math.random() - 0.5) * j * 2;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }
    if (opts.stroke !== false) {
      ctx.strokeStyle = opts.color || opts.stroke || "#22242a";
      ctx.lineWidth = opts.width ?? 2.4;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  },
  line(ctx, x1, y1, x2, y2, color, width = 2.4, jitter = 1.2) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1 + (Math.random() - .5) * jitter, y1 + (Math.random() - .5) * jitter);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    ctx.quadraticCurveTo(
      mx + (Math.random() - .5) * jitter * 4, my + (Math.random() - .5) * jitter * 4,
      x2 + (Math.random() - .5) * jitter, y2 + (Math.random() - .5) * jitter
    );
    ctx.stroke();
    ctx.restore();
  },
  // scribble fill inside a shape via many strokes
  scribble(ctx, x, y, w, h, color, n = 22) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineCap = "round";
    ctx.globalAlpha = 0.75;
    for (let i = 0; i < n; i++) {
      const yy = y + (Math.random() * h);
      const x1 = x + Math.random() * w * 0.35;
      const x2 = x + w - Math.random() * w * 0.35;
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.quadraticCurveTo(x + w / 2 + (Math.random() - .5) * 14, yy + (Math.random() - .5) * 9, x2, yy + (Math.random() - .5) * 5);
      ctx.stroke();
    }
    ctx.restore();
  },
  text(ctx, txt, x, y, { size = 18, color = "#22242a", align = "center", font = "Patrick Hand", weight = "700", rot = 0, alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.font = `${weight} ${size}px "${font}", cursive`;
    ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  },
  // little arrow doodle
  arrow(ctx, x, y, a, len, color = "#d94f3d", width = 3) {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    Draw.line(ctx, x, y, x2, y2, color, width, 1);
    const s = 7;
    ctx.save();
    ctx.translate(x2, y2); ctx.rotate(a);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-s, -s * 0.6);
    ctx.moveTo(0, 0); ctx.lineTo(-s, s * 0.6);
    ctx.stroke();
    ctx.restore();
  },
  // hand-drawn x marker used for kills / blood
  xmark(ctx, x, y, s, color = "#d94f3d") {
    Draw.line(ctx, x - s, y - s, x + s, y + s, color, 3, 1.5);
    Draw.line(ctx, x - s, y + s, x + s, y - s, color, 3, 1.5);
  },
  star(ctx, x, y, s, color = "#e8b731") {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? s : s * 0.45;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  heart(ctx, x, y, s, color = "#d94f3d") {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(Math.random() * .3 - .15);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, s * .5);
    ctx.bezierCurveTo(-s, -s * .4, -s * .5, -s * .9, 0, -s * .35);
    ctx.bezierCurveTo(s * .5, -s * .9, s, -s * .4, 0, s * .5);
    ctx.fill();
    ctx.restore();
  },
  // notebook doodle decorations drawn once to an offscreen canvas
  decorate(ctx, w, h, rng, zombies) {
    // margin line
    ctx.strokeStyle = "rgba(217,79,61,.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(46, -20); ctx.lineTo(46, h + 20); ctx.stroke();
    // date scribble
    Draw.text(ctx, "district paper · v1", 70, 26, { size: 15, color: "rgba(74,77,87,.55)", align: "left", rot: -.03 });
    // clouds
    for (let i = 0; i < 5; i++) {
      const cx = rng() * w, cy = rng() * h * 0.55, s = 24 + rng() * 40;
      Draw.circle(ctx, cx, cy, s, { fill: "rgba(255,255,255,.55)", jitter: s * .2 });
      Draw.circle(ctx, cx + s * .6, cy + s * .25, s * .7, { fill: "rgba(255,255,255,.55)", jitter: s * .2 });
    }
    // sun
    const sx = w * .88, sy = h * .12;
    Draw.circle(ctx, sx, sy, 34, { fill: "#ffe9b0" });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      Draw.line(ctx, sx + Math.cos(a) * 44, sy + Math.sin(a) * 44, sx + Math.cos(a) * 56, sy + Math.sin(a) * 56, "#e8b731", 2.5, 1);
    }
    // grass tufts
    for (let i = 0; i < 40; i++) {
      const gx = 60 + rng() * (w - 90), gy = h * .98 - rng() * 30;
      Draw.line(ctx, gx, gy, gx + (rng() * 6 - 3), gy - 10 - rng() * 12, "rgba(63,157,99,.55)", 2, 1);
    }
    // little flowers
    for (let i = 0; i < 8; i++) {
      const fx = rng() * w, fy = rng() * h;
      const cols = ["#d94f3d", "#e8b731", "#3b6fd4", "#e97f9a"];
      Draw.circle(ctx, fx, fy, 4.5, { fill: U.pick(cols) });
      Draw.circle(ctx, fx, fy, 4.5, { fill: "#fff" });
    }
    // scattered scribbles
    for (let i = 0; i < 6; i++) {
      const x = rng() * w, y = h * .65 + rng() * h * .3, L = 40 + rng() * 60;
      Draw.scribble(ctx, x, y, L, 8, "rgba(34,36,42,.12)", 8);
    }
    // doodle stick figures walking ("the district")
    for (let i = 0; i < 4; i++) {
      const x = rng() * w, y = h * .78 + rng() * h * .2, s = 10 + rng() * 7;
      ctx.strokeStyle = "rgba(34,36,42,.28)"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(x, y - s * 1.6, s * .5, 0, Math.PI * 2); ctx.stroke();
      Draw.line(ctx, x, y - s * 1.1, x, y, "rgba(34,36,42,.28)", 2, 1);
      Draw.line(ctx, x, y - s * .6, x - s * .6, y + s * .4, "rgba(34,36,42,.28)", 2, 1);
      Draw.line(ctx, x, y - s * .6, x + s * .6, y + s * .4, "rgba(34,36,42,.28)", 2, 1);
      Draw.line(ctx, x, y, x - s * .7, y + s * .8, "rgba(34,36,42,.28)", 2, 1);
      Draw.line(ctx, x, y, x + s * .7, y + s * .8, "rgba(34,36,42,.28)", 2, 1);
    }
    if (zombies) {
      // night sky chaos: stars, moon, tombstones, broken houses, green drips
      ctx.fillStyle = "rgba(20,24,38,.28)";
      ctx.fillRect(0, 0, w, h); // dusk overlay
      for (let i = 0; i < 90; i++) {
        const x = rng() * w, y = rng() * h;
        ctx.fillStyle = `rgba(255,255,220,${.25 + rng() * .5})`;
        ctx.fillRect(x, y, 2, 2);
      }
      // moon
      Draw.circle(ctx, w * .85, h * .13, 40, { fill: "#f5efc8" });
      Draw.circle(ctx, w * .85 + 14, h * .13 - 8, 36, { fill: "rgba(246,241,227,.9)" });
      // tombstones
      for (let i = 0; i < 6; i++) {
        const x = 80 + rng() * (w - 160), y = h * .8 + rng() * h * .18, s = 16 + rng() * 10;
        ctx.fillStyle = "rgba(128,134,148,.7)";
        ctx.beginPath();
        ctx.moveTo(x - s, y + s * 1.2); ctx.lineTo(x - s, y - s * .4);
        ctx.quadraticCurveTo(x, y - s * 1.6, x + s, y - s * .4);
        ctx.lineTo(x + s, y + s * 1.2); ctx.closePath(); ctx.fill();
        Draw.xmark(ctx, x, y, 4, "rgba(34,36,42,.6)");
      }
      // crooked houses
      for (let i = 0; i < 3; i++) {
        const x = rng() * w, y = h * .55 + rng() * h * .3, s = 40 + rng() * 30;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * .12 - .06);
        ctx.fillStyle = "rgba(90,96,116,.6)";
        ctx.fillRect(-s, -s * .8, s * 2, s * .8);
        ctx.beginPath(); ctx.moveTo(-s * 1.1, -s * .8); ctx.lineTo(0, -s * 1.5); ctx.lineTo(s * 1.1, -s * .8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(246,241,227,.8)";
        ctx.fillRect(-s * .4, -s * .6, s * .35, s * .3);
        ctx.fillRect(s * .2, -s * .5, s * .3, s * .3);
        ctx.restore();
      }
    }
  },
};
