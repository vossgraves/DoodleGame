/* game3.js — projectiles, damage, pickups, camera, shop, pause, drawing */
"use strict";

Object.assign(Game, {
  updateEnemyBullets(dt) {
    const p = this.player;
    for (let i = this.eBullets.length - 1; i >= 0; i--) {
      const b = this.eBullets[i];
      b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > this.world.w || b.y > this.world.h) {
        this.eBullets.splice(i, 1); continue;
      }
      if (U.dist(b.x, b.y, p.x, p.y) < b.r + p.r && p.invuln <= 0) {
        this.damagePlayer(b.dmg);
        this.eBullets.splice(i, 1);
      }
    }
  },

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > this.world.w || b.y > this.world.h) {
        this.bullets.splice(i, 1); continue;
      }
      for (const e of this.enemies) {
        if (U.dist(b.x, b.y, e.x, e.y) < e.r + 4) {
          this.damageEnemy(e, b.dmg, b.angle, "bullet");
          if (!b.pierce) { this.bullets.splice(i, 1); }
          break;
        }
      }
    }
  },

  damageEnemy(e, dmg, dir, kind) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.hitFlash = .12;
    e.stun = Math.max(e.stun, kind === "boom" ? .5 : .12);
    const kb = kind === "boom" ? 340 : kind === "slash" ? 420 : 90;
    const scale = 1 / Math.max(1, e.r / 18);
    e.kbx += Math.cos(dir) * kb * scale;
    e.kby += Math.sin(dir) * kb * scale;
    const z = this.mode === "zombies";
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        kind: z ? "blood" : "ink",
        x: e.x + Math.cos(dir) * e.r * .7, y: e.y + Math.sin(dir) * e.r * .7,
        vx: Math.cos(dir + (Math.random() - .5)) * U.rand(60, 260),
        vy: Math.sin(dir + (Math.random() - .5)) * U.rand(60, 260),
        size: U.rand(2.5, 4.5), color: z ? "#5d8540" : "#22242a",
        life: U.rand(.15, .4), maxLife: .4,
      });
    }
    AudioSys.sfx("hit");
    if (e.hp <= 0) this.killEnemy(e);
  },

  killEnemy(e) {
    const p = this.player;
    const idx = this.enemies.indexOf(e);
    if (idx >= 0) this.enemies.splice(idx, 1);
    if (e.boss) { this.boss = null; UI.showBoss(false); }
    this.kills++; this.waveKills++;

    p.combo = Math.min(5, p.combo + (p.comboT > 0 ? .5 : 1));
    p.comboT = 2.6;
    const pts = Math.round(e.score * (1 + (p.combo - 1) * .5));
    this.score += pts;

    const z = this.mode === "zombies";
    if (z) {
      const coins = e.boss ? 25 : U.randInt(1, 2 + Math.min(3, Math.floor(this.wave / 3)));
      this.coins += coins;
      this.pickups.push({ x: e.x + U.rand(-8, 8), y: e.y + U.rand(-8, 8), type: "coin", value: coins, seed: Math.random() * 10, life: 14 });
      const roll = Math.random();
      if (e.boss || roll < .05) this.pickups.push({ x: e.x, y: e.y, type: "ammo", seed: Math.random() * 10, life: 14 });
      if (roll < .07) this.pickups.push({ x: e.x, y: e.y, type: "heart", seed: Math.random() * 10, life: 12 });
      if (e.boss) {
        this.pickups.push({ x: e.x, y: e.y, type: "medkit", seed: 1, life: 20 });
        this.pickups.push({ x: e.x + 20, y: e.y, type: "flash", seed: 2, life: 8 });
      }
      for (let i = 0; i < 8; i++) {
        this.particles.push({
          kind: "splat", x: e.x + U.rand(-e.r, e.r), y: e.y + U.rand(-e.r, e.r),
          vx: 0, vy: 0, size: U.rand(5, 12), color: "rgba(93,133,64,.75)",
          life: U.rand(3, 6), maxLife: 6,
        });
      }
      AudioSys.sfx("zdie");
    } else {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.push({
          kind: "spark", x: e.x, y: e.y,
          vx: Math.cos(a) * U.rand(40, 300), vy: Math.sin(a) * U.rand(40, 300),
          size: U.rand(2.5, 5), color: e.color,
          life: U.rand(.3, .7), maxLife: .7,
        });
      }
      this.particles.push({ kind: "text", x: e.x, y: e.y - 20, txt: "+" + pts, size: 20, color: "#d94f3d", life: .8, maxLife: .8 });
      AudioSys.sfx("kill");
      if (e.type === "walker" && Math.random() < .04) this.pickups.push({ x: e.x, y: e.y, type: "heart", seed: Math.random() * 10, life: 10 });
    }

    p.katanaGauge = Math.min(1, p.katanaGauge + (e.boss ? .8 : .07));
    p.dashGauge = Math.min(1, p.dashGauge + (e.boss ? .8 : .08));
    if (z && p.vamp > 0) { p.hp = Math.min(p.maxHp, p.hp + p.vamp); this.burst(p.x, p.y, 3, "spark", "#7fc46a"); }
    if (e.boss) { this.toast("BOSS DOWN! +" + pts, "good"); this.camera.shake = 12; }
    UI.updateHUD();
  },

  damagePlayer(dmg) {
    const p = this.player;
    if (p.invuln > 0 || p.hp <= 0) return;
    const d = Math.max(1, Math.round(dmg * (1 - (p.armor || 0))));
    p.hp -= d;
    p.invuln = .35;
    p.hurtFlash = .3;
    p.combo = 1; p.comboT = 0;
    AudioSys.sfx("hurt");
    this.camera.shake = Math.min(14, this.camera.shake + 5);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        kind: "spark", x: p.x, y: p.y,
        vx: Math.cos(a) * U.rand(80, 260), vy: Math.sin(a) * U.rand(80, 260),
        size: 3.4, color: "#d94f3d", life: U.rand(.2, .45), maxLife: .45,
      });
    }
    UI.updateHUD();
    if (p.hp <= 0) this.gameOver();
  },

  updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.life -= dt;
      if (k.life <= 0) { this.pickups.splice(i, 1); continue; }
      const d = U.dist(k.x, k.y, p.x, p.y);
      if (d < 90) { k.x += (p.x - k.x) * dt * 8; k.y += (p.y - k.y) * dt * 8; }
      if (d < p.r + 14) {
        this.pickups.splice(i, 1);
        if (k.type === "coin") {
          this.coins += k.value; this.score += 5;
          AudioSys.sfx("coin");
          this.particles.push({ kind: "text", x: k.x, y: k.y - 10, txt: "+" + k.value + "¢", size: 15, color: "#e8b731", life: .6, maxLife: .6 });
        } else if (k.type === "heart") {
          p.hp = Math.min(p.maxHp, p.hp + 15);
          AudioSys.sfx("heal");
          this.particles.push({ kind: "text", x: k.x, y: k.y, txt: "+15 HP", size: 16, color: "#e97f9a", life: .8, maxLife: .8 });
        } else if (k.type === "ammo") {
          for (const w of p.weapons) if (!w.def.melee) w.reserve += Math.round(w.def.mag * .6);
          AudioSys.sfx("reload");
          this.particles.push({ kind: "text", x: k.x, y: k.y, txt: "AMMO!", size: 16, color: "#3b6fd4", life: .8, maxLife: .8 });
        } else if (k.type === "medkit") {
          p.hp = Math.min(p.maxHp, p.hp + 50);
          AudioSys.sfx("heal");
          this.particles.push({ kind: "text", x: k.x, y: k.y, txt: "+50 HP", size: 18, color: "#d94f3d", life: 1, maxLife: 1 });
        } else if (k.type === "flash") {
          p.katanaGauge = 1; p.dashGauge = 1;
          AudioSys.sfx("dashslash");
          this.particles.push({ kind: "text", x: k.x, y: k.y, txt: "DASH READY!", size: 16, color: "#e8b731", life: .9, maxLife: .9 });
        }
      }
    }
  },

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) { this.particles.splice(i, 1); continue; }
      if (pt.kind === "spark" || pt.kind === "blood" || pt.kind === "ink") {
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        pt.vx *= .92; pt.vy *= .92;
      }
      if (pt.kind === "slash") pt.angle += dt * 2;
    }
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420);
  },

  burst(x, y, n, kind, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = kind === "dust" ? 20 : U.rand(40, 200);
      this.particles.push({
        kind, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        size: U.rand(3, 7), color, life: U.rand(.25, .55), maxLife: .55,
      });
    }
  },

  cameraToPlayer(instant) {
    const vw = this.view.w, vh = this.view.h, p = this.player;
    let tx = p.x - vw / 2, ty = p.y - vh / 2;
    tx = U.clamp(tx, 0, Math.max(0, this.world.w - vw));
    ty = U.clamp(ty, 0, Math.max(0, this.world.h - vh));
    if (vw > this.world.w) tx = (this.world.w - vw) / 2;
    if (vh > this.world.h) ty = (this.world.h - vh) / 2;
    if (instant) { this.camera.x = tx; this.camera.y = ty; return; }
    this.camera.x = U.lerp(this.camera.x, tx, .14);
    this.camera.y = U.lerp(this.camera.y, ty, .14);
  },

  gameOver() {
    if (this.state === "over") return;
    this.state = "over";
    this.paused = false;
    const key = this.mode === "zombies" ? "zombies" : "district";
    const isBest = this.score > this.best[key];
    if (isBest) { this.best[key] = this.score; Store.set("best-" + key, this.score); }
    AudioSys.sfx("death");
    AudioSys.stopMusic();
    setTimeout(() => AudioSys.sfx("over"), 400);
    UI.showGameOver(this.mode, isBest);
  },

  pauseGame() {
    if (this.state !== "play") return;
    this.paused = true;
    UI.togglePause(true);
    AudioSys.stopMusic();
  },
  resumeGame() {
    if (this.state !== "play") return;
    this.paused = false;
    UI.togglePause(false);
    AudioSys.startMusic(this.mode === "zombies");
  },
  quitToMenu() {
    this.state = "menu";
    this.paused = false;
    UI.show("screen-menu");
    UI.hide(["hud", "screen-pause", "screen-shop", "screen-over", "banner"]);
    Input.showTouchUI(false);
    AudioSys.stopMusic();
    UI.updateMenuBest();
  },
  retry() { this.startGame(this.mode); },

  /* ================= zombie shop ================= */
  getUpgradePool() {
    return [
      { id: "rage", ic: "\uD83D\uDCA2", tt: "RAGE", ds: "+20% damage" },
      { id: "haste", ic: "\uD83D\uDC5F", tt: "HASTE", ds: "+12% move speed" },
      { id: "vital", ic: "\uD83E\uDE78", tt: "VITALITY", ds: "+25 max HP & heal 25" },
      { id: "swift", ic: "\u26A1", tt: "SWIFT HANDS", ds: "+22% faster reload" },
      { id: "armor", ic: "\uD83D\uDEE1", tt: "ARMOR", ds: "-15% damage taken" },
      { id: "boom", ic: "\uD83D\uDCA5", tt: "DEMO EXPERT", ds: "+40% grenade dmg, +1 nade" },
      { id: "vamp", ic: "\uD83E\uDDDB", tt: "VAMPIRISM", ds: "+1 HP per kill" },
      { id: "double", ic: "\uD83C\uDFB2", tt: "DOUBLE TAP", ds: "12% chance to double shot" },
    ].filter(u => (this.upgradeLevels[u.id] || 0) < (u.id === "swift" || u.id === "vamp" ? 4 : 5));
  },

  openShop() {
    const pool = this.getUpgradePool().slice();
    const cards = [];
    while (cards.length < 3 && pool.length) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    this.upgradeCards = cards;
    UI.showShop();
  },

  applyUpgrade(id) {
    const p = this.player;
    this.upgradeLevels[id] = (this.upgradeLevels[id] || 0) + 1;
    if (id === "rage") p.dmgMult += .2;
    if (id === "haste") p.speedMult += .12;
    if (id === "vital") { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); }
    if (id === "swift") p.reloadMult *= .78;
    if (id === "armor") p.armor = Math.min(.6, p.armor + .15);
    if (id === "boom") { p.grenadeMult += .4; p.grenades = Math.min(4, p.grenades + 1); }
    if (id === "vamp") p.vamp += 1;
    if (id === "double") p.double += .12;
    AudioSys.sfx("buy");
    UI.renderShop();
  },

  buyShopItem(kind) {
    const p = this.player;
    let cost = kind === "heal" ? 30 + Math.floor(this.wave / 4) * 10 : kind === "ammo" ? 20 : 15;
    if (this.coins < cost) { AudioSys.sfx("deny"); UI.flashCoins(); return; }
    this.coins -= cost;
    if (kind === "heal") p.hp = Math.min(p.maxHp, p.hp + 40);
    if (kind === "ammo") for (const w of p.weapons) if (!w.def.melee) { w.reserve += Math.round(w.def.mag * 1.2); w.reloading = false; }
    if (kind === "grenade") p.grenades = Math.min(4, p.grenades + 1);
    AudioSys.sfx("buy");
    UI.renderShop();
  },

  nextWave() {
    this.paused = false;
    this.state = "play";
    UI.hide(["screen-shop"]);
    this.spawnWave(this.wave + 1);
    UI.showBanner("WAVE " + this.wave, this.bossWave ? "\u2623 BOSS INCOMING \u2623" : "(they're getting hungrier...)");
  },

  onTouchMode() {
    UI.updateHUD(true);
    this.toast("\uD83D\uDCF1 touch controls on");
  },

  /* ================= drawing ================= */
  draw() {
    const ctx = this.ctx, v = this.view;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.fillStyle = "#f6f1e3";
    ctx.fillRect(0, 0, v.w, v.h);

    if (this.state === "menu" || this.state === "play" || this.state === "over" || this.state === "paused" || this.state === "shop") {
      ctx.save();
      ctx.translate(-this.camera.x + this.camera.sx || 0, -this.camera.y + this.camera.sy || 0);
      if (this.state === "menu") {
        if (this.menuZombies) for (const z of this.menuZombies) drawDoodleEnemy(ctx, z, performance.now() / 1000);
      } else if (this.world.deco) {
        ctx.drawImage(this.mode === "zombies" ? this.world.decoZ : this.world.deco, 0, 0);
      }
      for (const pt of this.particles) if (pt.kind === "splat") drawParticle(ctx, pt);
      for (const k of this.pickups) drawPickup(ctx, k);
      for (const g of this.grenades) drawGrenade(ctx, g);
      const now = performance.now() / 1000;
      for (const e of this.enemies) {
        if (this.mode === "zombies") drawZombie(ctx, e, now);
        else drawDoodleEnemy(ctx, e, now);
      }
      if (this.player && (this.state === "play" || this.state === "paused" || this.state === "shop" || this.state === "over")) {
        if (this.player.hp > 0) {
          drawPlayer(ctx, this.player, now);
          this.drawWeapon();
        }
      }
      for (const b of this.bullets) drawBullet(ctx, b);
      for (const b of this.eBullets) {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
        Draw.circle(ctx, 0, 0, b.r, { fill: b.color, width: 2 });
        ctx.restore();
      }
      for (const pt of this.particles) if (pt.kind !== "splat") drawParticle(ctx, pt);
      ctx.restore();
    }

    if (this.mode === "zombies" && this.state !== "menu") {
      const g = ctx.createRadialGradient(v.w / 2, v.h / 2, v.h * .3, v.w / 2, v.h / 2, v.h * .9);
      g.addColorStop(0, "rgba(20,24,38,0)");
      g.addColorStop(1, "rgba(20,24,38,.38)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, v.w, v.h);
    }

    if (this.state === "play" && !this.paused && this.player && !this.player.aimTouch && !Input.isTouchActive() && Input.deviceType !== "touch") {
      const mx = Input.mouse.x * v.w, my = Input.mouse.y * v.h;
      ctx.save();
      ctx.strokeStyle = "#d94f3d"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 16, my); ctx.lineTo(mx - 6, my);
      ctx.moveTo(mx + 6, my); ctx.lineTo(mx + 16, my);
      ctx.moveTo(mx, my - 16); ctx.lineTo(mx, my - 6);
      ctx.moveTo(mx, my + 6); ctx.lineTo(mx, my + 16);
      ctx.stroke();
      ctx.restore();
    }

    if (this.player && this.player.hurtFlash > 0) {
      ctx.fillStyle = "rgba(217,79,61," + (this.player.hurtFlash * .5) + ")";
      ctx.fillRect(0, 0, v.w, v.h);
    }
    if (this.player && this.player.hp > 0 && this.player.hp < 30 && (this.state === "play" || this.state === "paused")) {
      const a = .12 + Math.sin(performance.now() / 180) * .08;
      ctx.strokeStyle = "rgba(217,79,61," + a + ")";
      ctx.lineWidth = 26;
      ctx.strokeRect(0, 0, v.w, v.h);
    }
  },

  drawWeapon() {
    const p = this.player, ctx = this.ctx;
    const w = p.weapons[p.wIndex];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (w.def.melee) {
      ctx.strokeStyle = "#22242a"; ctx.lineWidth = 4.4;
      const wave = Math.sin(performance.now() / 140 + p.seed) * 2;
      ctx.beginPath();
      ctx.moveTo(p.r * .4, -p.r * .3);
      ctx.quadraticCurveTo(p.r * 1.6 + wave, -p.r * 1.1, p.r * 2.9 + wave, -p.r * 1.5);
      ctx.stroke();
      ctx.strokeStyle = "#3b6fd4"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(p.r * .3, -p.r * .22); ctx.lineTo(p.r * .85, -p.r * .62); ctx.stroke();
    } else {
      const len = w.def.id === "sniper" ? 46 : 30;
      ctx.fillStyle = "#22242a";
      ctx.fillRect(p.r * .6, -4, len, 8);
      ctx.fillStyle = w.def.id === "sniper" ? "#3f9d63" : "#3b6fd4";
      ctx.fillRect(p.r * .6 + len * .45, -3.4, len * .5, 6.8);
      ctx.strokeStyle = "#22242a"; ctx.lineWidth = p.r * .24;
      ctx.beginPath(); ctx.moveTo(p.r * .2, 0); ctx.lineTo(p.r * .8, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.r * .1, -p.r * .4); ctx.lineTo(p.r * 1.1, -2); ctx.stroke();
    }
    ctx.restore();
  },
});
