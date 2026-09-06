/* entities.js — visual definitions for doodle enemies, zombies, player, projectiles */
"use strict";

const Shapes = {
  walker: [[0, -1], [.7, -.72], [.95, -.05], [.62, .72], [0, .95], [-.62, .72], [-.95, -.05], [-.7, -.72]],
  runner: [[1, 0], [-.2, -.9], [-.62, -.5], [-.97, -.72], [-.97, .72], [-.62, .5], [-.2, .9]],
  spitter: (() => { const p = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const r = i % 2 ? .62 : 1; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; })(),
  tank: [[0, -1], [.85, -.62], [.95, -.2], [.6, .35], [.95, .85], [.5, 1], [-.1, .8], [-.7, 1], [-.95, .55], [-.6, .2], [-.95, -.35], [-.7, -.8]],
  brute: (() => { const p = []; for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const r = i % 2 ? .58 : 1; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; })(),
  boss: (() => { const p = []; for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; const r = i % 2 ? .82 : 1; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; })(),
};

function polyPath(ctx, poly, s, rot) {
  ctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const a = i * 0.0007; // tiny per-vertex wobble via time-independent jitter
    const x = poly[i][0] * s, y = poly[i][1] * s;
    const px = x * Math.cos(rot) - y * Math.sin(rot);
    const py = x * Math.sin(rot) + y * Math.cos(rot);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const Eyes = {
  angry(ctx, x, y, s, color = "#22242a", look = 0) {
    ctx.save();
    ctx.fillStyle = color;
    const ox = Math.cos(look) * s * .18, oy = Math.sin(look) * s * .18;
    ctx.beginPath(); ctx.ellipse(x - s * .4 + ox, y - s * .15 + oy, s * .17, s * .2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + s * .4 + ox, y - s * .15 + oy, s * .17, s * .2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, s * .12); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x - s * .62, y - s * .45); ctx.lineTo(x - s * .18, y - s * .2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s * .62, y - s * .45); ctx.lineTo(x + s * .18, y - s * .2); ctx.stroke();
    ctx.restore();
  },
  xeyes(ctx, x, y, s, color = "#22242a") {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.4, s * .16); ctx.lineCap = "round";
    const k = s * .18;
    ctx.beginPath();
    ctx.moveTo(x - s * .4 - k, y - s * .2 - k); ctx.lineTo(x - s * .4 + k, y - s * .2 + k);
    ctx.moveTo(x - s * .4 - k, y - s * .2 + k); ctx.lineTo(x - s * .4 + k, y - s * .2 - k);
    ctx.moveTo(x + s * .4 - k, y - s * .2 - k); ctx.lineTo(x + s * .4 + k, y - s * .2 + k);
    ctx.moveTo(x + s * .4 - k, y - s * .2 + k); ctx.lineTo(x + s * .4 + k, y - s * .2 - k);
    ctx.stroke();
    ctx.restore();
  },
  dot(ctx, x, y, s, color = "#22242a") {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x - s * .38, y - s * .12, s * .16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + s * .38, y - s * .12, s * .16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};

/* ================= player ================= */
function drawPlayer(ctx, e, t) {
  const run = Math.sin(t * 11 + e.seed) * Math.min(1, Math.hypot(e.vx, e.vy) / 190) * .5;
  const standH = e.r * 2.1;
  ctx.save();
  ctx.translate(e.x, e.y - e.hop * .4);
  // shadow
  ctx.save();
  ctx.translate(0, e.r * 1.15);
  ctx.fillStyle = "rgba(34,36,42,.15)";
  ctx.beginPath(); ctx.ellipse(0, 0, e.r * .9, e.r * .3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.rotate(e.angle);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "#22242a"; ctx.fillStyle = "#22242a"; ctx.lineWidth = e.r * .30;

  // legs
  const legL = e.r * .95, hipY = e.r * .45;
  ctx.lineWidth = e.r * .26;
  ctx.beginPath(); ctx.moveTo(-e.r * .05, hipY); ctx.lineTo(-e.r * .1 - run * e.r * .5, hipY + legL); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(e.r * .05, hipY); ctx.lineTo(e.r * .1 + run * e.r * .5, hipY + legL); ctx.stroke();

  // torso lean
  const lean = U.clamp(e.vx * .0012, -.22, .22);
  ctx.rotate(lean);
  ctx.lineWidth = e.r * .34;
  ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(e.r * .1, -e.r * .55); ctx.stroke();

  // backpack/bandana
  ctx.fillStyle = "#3f9d63";
  Draw.circle(ctx, -e.r * .45, -e.r * .5, e.r * .3, { fill: "#3f9d63", width: 1.8, jitter: e.r * .05 });

  // head
  Draw.circle(ctx, e.r * .12, -e.r * 1.05, e.r * .5, { fill: "#fdf9ec", width: e.r * .22, jitter: e.r * .05 });
  // cap
  ctx.fillStyle = "#3b6fd4";
  ctx.beginPath();
  ctx.arc(e.r * .05, -e.r * 1.2, e.r * .48, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(e.r * .3, -e.r * 1.3, e.r * .55, e.r * .12);

  // arm toward gun (gun drawn by game)
  ctx.lineWidth = e.r * .26;
  ctx.beginPath(); ctx.moveTo(e.r * .05, -e.r * .3); ctx.lineTo(e.r * .85, -e.r * .18); ctx.stroke();
  ctx.restore();

  // invuln flicker
  if (e.invuln > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(59,111,212,${.3 + .4 * Math.sin(t * 30)})`;
    ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6 + Math.sin(t * 20) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/* ================= doodle district enemies ================= */
function drawDoodleEnemy(ctx, e, t) {
  const s = e.r;
  const wob = Math.sin(t * e.wobFreq + e.seed) * e.wobAmt;
  const rot = e.angle + wob * .12;
  ctx.save();
  ctx.translate(e.x, e.y + Math.sin(t * 7 + e.seed) * 2);
  // shadow
  ctx.save();
  ctx.translate(0, s * 1.05);
  ctx.fillStyle = "rgba(34,36,42,.12)";
  ctx.beginPath(); ctx.ellipse(0, 0, s * .85, s * .28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // body
  ctx.save();
  polyPath(ctx, Shapes[e.shape], s, rot);
  ctx.fillStyle = e.color;
  ctx.fill();
  ctx.strokeStyle = "#22242a";
  ctx.lineWidth = e.border;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke();
  // inner scribble shading
  if (s > 16) {
    ctx.globalAlpha = .16;
    ctx.strokeStyle = "#22242a"; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + rot;
      ctx.moveTo(Math.cos(a) * s * .3, Math.sin(a) * s * .3);
      ctx.lineTo(Math.cos(a) * s * .75, Math.sin(a) * s * .75);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // face (facing player)
  const look = e.lookAngle ?? 0;
  if (e.shape === "walker" || e.shape === "tank") Eyes.angry(ctx, 0, -s * .1, s, "#22242a", look);
  else if (e.shape === "runner") Eyes.angry(ctx, 0, -s * .1, s, "#22242a", look);
  else if (e.shape === "spitter") {
    Eyes.dot(ctx, 0, -s * .1, s, "#22242a");
    Draw.circle(ctx, look * 2, s * .3, s * .28, { fill: "#22242a", jitter: s * .08 });
  } else Eyes.xeyes(ctx, 0, -s * .1, s, "#22242a");

  // angry mouth
  if (e.shape !== "spitter") {
    ctx.strokeStyle = "#22242a"; ctx.lineWidth = Math.max(1.5, s * .1); ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(look * 3, s * .1, s * .3, .3, Math.PI - .3);
    ctx.stroke();
    if (e.shape === "tank") { // teeth
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 4; i++) {
        const a = .5 + i * .55;
        ctx.beginPath();
        ctx.arc(look * 3 + Math.cos(a) * s * .3, s * .1 + Math.sin(a) * s * .3, s * .07, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // tank extra arms / brute spikes visible as shape already
  ctx.restore();

  // hp bar (only when hurt)
  if (e.hp < e.maxHp && e.maxHp > 0) {
    const w = s * 1.8, pct = Math.max(0, e.hp / e.maxHp);
    ctx.save();
    ctx.translate(e.x, e.y - s - 12);
    ctx.fillStyle = "#fff";
    ctx.fillRect(-w / 2, -3, w, 6);
    ctx.strokeStyle = "#22242a"; ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2, -3, w, 6);
    ctx.fillStyle = "#d94f3d";
    ctx.fillRect(-w / 2 + 1, -2, (w - 2) * pct, 4);
    ctx.restore();
  }
}

/* ================= zombies ================= */
function drawZombie(ctx, e, t) {
  const s = e.r;
  const wob = Math.sin(t * e.wobFreq + e.seed) * e.wobAmt;
  const a = e.angle + wob * .1;
  const lean = e.shape === "runner" ? .8 : (e.shape === "spitter" ? .35 : .45);
  ctx.save();
  ctx.translate(e.x, e.y + Math.sin(t * 6 + e.seed) * 2);
  ctx.save();
  ctx.translate(0, s * 1.15);
  ctx.fillStyle = "rgba(20,24,38,.22)";
  ctx.beginPath(); ctx.ellipse(0, 0, s * .95, s * .3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.rotate(a + Math.PI / 2 + (e.shape === "brute" ? wob * .06 : 0)); // facing = a
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const skin = "#a8c98e", skinDark = "#7fae66", outline = "#22242a";
  const w = e.shape === "brute" ? s * .34 : s * .3;
  ctx.strokeStyle = outline; ctx.fillStyle = skin;

  if (e.shape === "brute") {
    // massive blob with stubby arms
    polyPath(ctx, Shapes.brute, s, 0);
    ctx.fillStyle = skin; ctx.fill(); ctx.stroke();
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(-s * .7, -s * .1); ctx.lineTo(-s * 1.15, -s * .5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * .7, -s * .1); ctx.lineTo(s * 1.15, -s * .5); ctx.stroke();
    ctx.restore();
    Eyes.xeyes(ctx, 0, -s * .2, s * .9, outline);
    return;
  }

  // legs
  ctx.lineWidth = w * .8;
  const step = Math.sin(t * (e.shape === "runner" ? 16 : 9) + e.seed);
  ctx.beginPath(); ctx.moveTo(0, s * .55); ctx.lineTo(-s * .3 - step * s * .35, s * 1.15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, s * .55); ctx.lineTo(s * .3 + step * s * .35, s * 1.15); ctx.stroke();

  // body
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(0, s * .55); ctx.lineTo(0, -s * .35); ctx.stroke();

  // arms stretched forward (toward -y in local space now)
  const armWave = Math.sin(t * (e.shape === "runner" ? 18 : 8) + e.seed * 2) * s * .25;
  ctx.beginPath(); ctx.moveTo(0, -s * .1);
  ctx.lineTo(-s * (e.shape === "runner" ? 1.0 : .8), -s * 1.15 + armWave); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -s * .1);
  ctx.lineTo(s * (e.shape === "runner" ? 1.0 : .8), -s * 1.15 - armWave); ctx.stroke();

  // head
  const hx = 0, hy = -s * (e.shape === "runner" ? .85 : .72);
  Draw.circle(ctx, hx, hy - lean * s * .1, s * (e.shape === "runner" ? .38 : .45), { fill: skin, width: w * .9, jitter: s * .06 });
  // torn shirts / guts
  ctx.strokeStyle = skinDark; ctx.lineWidth = w * .45;
  ctx.beginPath(); ctx.moveTo(-s * .3, s * .1); ctx.quadraticCurveTo(0, s * .35, s * .3, s * .05); ctx.stroke();

  ctx.restore();

  // face
  Eyes.xeyes(ctx, e.x, e.y - s * (e.shape === "runner" ? .0 : .05), s * .8, outline);
  if (e.shape === "spitter") {
    Draw.circle(ctx, e.x + Math.cos(a) * s * 2, e.y + Math.sin(a) * s * 2, s * .3, { fill: "#5a3b2e", width: 2 });
  }
  if (e.shape === "boss") {
    // hunch + crown spikes on top
    ctx.save();
    ctx.translate(e.x, e.y - s * .75);
    ctx.fillStyle = "#9ac27e";
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * .34 - s * .16, 0);
      ctx.lineTo(i * s * .34, -s * .4);
      ctx.lineTo(i * s * .34 + s * .16, 0);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // hp bar
  if (e.hp < e.maxHp && e.maxHp > 0) {
    const w2 = s * 1.7, pct = Math.max(0, e.hp / e.maxHp);
    ctx.save();
    ctx.translate(e.x, e.y - s - 14);
    ctx.fillStyle = "#fff"; ctx.fillRect(-w2 / 2, -3, w2, 6);
    ctx.strokeStyle = "#22242a"; ctx.lineWidth = 1.5; ctx.strokeRect(-w2 / 2, -3, w2, 6);
    ctx.fillStyle = "#7fc46a"; ctx.fillRect(-w2 / 2 + 1, -2, (w2 - 2) * pct, 4);
    ctx.restore();
  }
}

/* ================= projectiles & pickups ================= */
function drawBullet(ctx, b) {
  ctx.save();
  ctx.translate(b.x, b.y); ctx.rotate(b.angle);
  ctx.strokeStyle = "#22242a"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-b.len, 0); ctx.lineTo(0, 0); ctx.stroke();
  ctx.fillStyle = "#3b6fd4";
  ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawGrenade(ctx, g) {
  ctx.save();
  ctx.translate(g.x, g.y);
  Draw.circle(ctx, 0, 0, 7, { fill: "#3f9d63", width: 2.2 });
  ctx.strokeStyle = "#22242a"; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, -11); ctx.stroke();
  ctx.beginPath(); ctx.arc(3, -11, 3.5, 0, Math.PI * 2); ctx.stroke();
  if (g.fuse < 1.2) {
    Draw.star(ctx, 3, -11, 4 + Math.random() * 3, Math.random() < .5 ? "#e8b731" : "#d94f3d");
  }
  ctx.restore();
}

function drawPickup(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y + Math.sin(performance.now() / 300 + p.seed) * 2);
  if (p.type === "coin") {
    Draw.circle(ctx, 0, 0, 9, { fill: "#ffd76a", width: 2.2 });
    Draw.text(ctx, "¢", 0, 0, { size: 13, weight: "800", font: "Shantell Sans" });
  } else if (p.type === "heart") {
    Draw.heart(ctx, 0, 0, 12, "#e97f9a");
  } else if (p.type === "ammo") {
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#22242a"; ctx.lineWidth = 2;
    ctx.fillRect(-12, -8, 24, 16); ctx.strokeRect(-12, -8, 24, 16);
    Draw.text(ctx, "AMMO", 0, 0, { size: 8, font: "Shantell Sans", weight: "800" });
    Draw.line(ctx, -6, 8, -6, 12, "#22242a", 2);
  } else if (p.type === "medkit") {
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#22242a"; ctx.lineWidth = 2;
    ctx.fillRect(-13, -9, 26, 18); ctx.strokeRect(-13, -9, 26, 18);
    ctx.fillStyle = "#d94f3d";
    ctx.fillRect(-3, -6, 6, 12); ctx.fillRect(-8, -2, 16, 4);
  } else if (p.type === "flash") {
    Draw.star(ctx, 0, 0, 12, "#e8b731");
  }
  ctx.restore();
}

function drawParticle(ctx, p) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
  if (p.kind === "spark" || p.kind === "blood" || p.kind === "ink") {
    ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * .04, p.y - p.vy * .04);
    ctx.stroke();
  } else if (p.kind === "splat") {
    Draw.circle(ctx, p.x, p.y, p.size, { fill: p.color, width: 0, jitter: p.size * .25 });
  } else if (p.kind === "dust") {
    Draw.circle(ctx, p.x, p.y, p.size * (1.6 - p.life / p.maxLife * .6), { fill: "rgba(255,255,255,.8)", width: 0 });
  } else if (p.kind === "text") {
    Draw.text(ctx, p.txt, p.x, p.y - (1 - p.life / p.maxLife) * 30, { size: p.size, color: p.color, weight: "800", font: "Shantell Sans", alpha: p.life / p.maxLife });
  } else if (p.kind === "muzzle") {
    Draw.star(ctx, p.x, p.y, p.size * (p.life / p.maxLife), "#ffd76a");
  } else if (p.kind === "slash") {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.globalAlpha = U.clamp(p.life / p.maxLife, 0, 1) * .9;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, p.len + 14, -.7, .7);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#22242a";
    ctx.beginPath();
    ctx.arc(0, 0, p.len + 14, -.6, .6);
    ctx.stroke();
    ctx.restore();
  } else {
    Draw.circle(ctx, p.x, p.y, p.size * (p.life / p.maxLife), { fill: p.color, width: 0 });
  }
  ctx.restore();
}
