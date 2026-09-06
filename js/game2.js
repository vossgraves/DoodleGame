/* game2.js — the rest of the simulation (aiming, weapons, waves, enemies, shop, draw) */
"use strict";

Object.assign(Game, {
  updateAim(dt, gp) {
    const p = this.player;
    const ta = Input.getAim();
    let aimSet = false;
    if (gp && (Math.abs(gp.rx) + Math.abs(gp.ry) > .12)) {
      p.aimAngle = Math.atan2(gp.ry, gp.rx);
      p.aimTouch = true; aimSet = true;
    }
    if (ta) {
      let ax = ta.x, ay = ta.y;
      if (Store.get("assist", true) && ta.mag < .75) {
        const t = this.nearestEnemy(p.x, p.y, 620);
        if (t) {
          const ea = Math.atan2(t.y - p.y, t.x - p.x);
          const da = U.wrapAngle(ea - Math.atan2(ay, ax));
          if (Math.abs(da) < .75) { ax = Math.cos(ea); ay = Math.sin(ea); ta.mag = Math.min(1, ta.mag + .5); }
        }
      }
      p.aimAngle = Math.atan2(ay, ax);
      p.aimTouch = true; aimSet = true;
    } else if (!Input.isTouchActive()) {
      const wx = this.camera.x + Input.mouse.x * this.view.w - this.camera.sx;
      const wy = this.camera.y + Input.mouse.y * this.view.h - this.camera.sy;
      const before = p.aimAngle;
      p.aimAngle = Math.atan2(wy - p.y, wx - p.x);
      p.aimAngle = U.angleLerp(before, p.aimAngle, Math.min(1, dt * 22));
      p.aimTouch = false; aimSet = true;
    }
    if (p.moving && !aimSet) p.angle = Math.atan2(p.vy, p.vx);
    else p.angle = p.aimAngle;
  },

  nearestEnemy(x, y, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.enemies) {
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  },

  /* ================= weapons ================= */
  updateWeapons(dt, gp) {
    const p = this.player;
    const w = p.weapons[p.wIndex];
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.katanaCd = Math.max(0, p.katanaCd - dt);
    p.quickSlashCd = Math.max(0, p.quickSlashCd - dt);

    if (w.reloading) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) {
        const need = w.def.mag - w.ammo;
        const take = Math.min(need, w.reserve);
        w.ammo += take; w.reserve -= take;
        w.reloading = false;
        AudioSys.sfx("reload");
      }
    }
    if (Input.pressed("KeyR") || Input.touch.btnState.reload || (gp && gp.y)) this.tryReload();

    let wantIdx = null;
    for (let i = 0; i < p.weapons.length; i++) {
      if (Input.pressed("Digit" + (i + 1)) || Input.pressed("Numpad" + (i + 1))) wantIdx = i;
    }
    if (Input.mouse.wheel !== 0) {
      this.weaponWheel = (this.weaponWheel || 0) + Input.mouse.wheel;
      if (Math.abs(this.weaponWheel) > 1) {
        wantIdx = (p.wIndex + (this.weaponWheel > 0 ? 1 : p.weapons.length - 1)) % p.weapons.length;
        this.weaponWheel = 0;
      }
    } else this.weaponWheel = 0;
    const btnNext = Input.touch.btnState.weapon || (gp && gp.rb);
    if (btnNext) {
      if (!this.switchLock) { wantIdx = (p.wIndex + 1) % p.weapons.length; this.switchLock = true; }
    } else this.switchLock = false;

    if (wantIdx !== null && wantIdx !== p.wIndex && wantIdx < p.weapons.length) {
      p.wIndex = wantIdx;
      p.fireCd = Math.max(p.fireCd, .12);
      UI.updateHUD();
    }

    const touchFire = Input.touch.fire ||
      (Input.touch.stickAim && Math.hypot(Input.touch.stickAim.dx, Input.touch.stickAim.dy) > .55);
    const wantFire = Input.mouse.lmb || touchFire || (gp && gp.rt > .5);

    if (w.def.melee) {
      if (Input.pressed("KeyF")) this.quickSlash();
      if (wantFire && p.katanaCd <= 0 && p.fireCd <= 0) {
        this.meleeSlash(true);
        p.katanaCd = .3; p.fireCd = .3;
      }
    } else {
      if (Input.pressed("KeyF")) this.quickSlash();
      if (wantFire && p.fireCd <= 0) {
        if (w.ammo <= 0) {
          if (w.reserve > 0) this.tryReload(); else AudioSys.sfx("empty");
          p.fireCd = .22;
        } else {
          this.fireWeapon(w);
          p.fireCd = 1 / (w.def.fireRate * p.fireRateMult);
          w.ammo--;
          if (w.ammo <= 0 && w.reserve > 0) this.tryReload();
        }
      }
    }
  },

  fireWeapon(w) {
    const p = this.player;
    const def = w.def;
    const baseAngle = p.aimAngle + (Math.random() - .5) * def.spread * 2;
    const shots = 1 + (Math.random() < p.double ? 1 : 0);
    const sx = p.x + Math.cos(p.aimAngle) * 20, sy = p.y + Math.sin(p.aimAngle) * 20 - 6;
    for (let s = 0; s < shots; s++) {
      for (let i = 0; i < def.pellets; i++) {
        const a = baseAngle + (i - (def.pellets - 1) / 2) * def.spread / Math.max(1, def.pellets * .2) + (Math.random() - .5) * def.spread * .4;
        this.bullets.push({
          x: sx, y: sy, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
          angle: a, dmg: def.dmg * p.dmgMult, len: def.id === "sniper" ? 26 : 14,
          pierce: !!def.pierce, life: 1.4, from: def.id,
        });
      }
    }
    this.burst(sx, sy, Math.min(8, shots * def.pellets), "muzzle", "#ffd76a");
    this.camera.shake = Math.min(16, this.camera.shake + def.shake);
    p.vx -= Math.cos(p.aimAngle) * def.shake * 26 * (this.dt || .016);
    p.vy -= Math.sin(p.aimAngle) * def.shake * 26 * (this.dt || .016);
    const snd = def.id === "rifle" ? "rifle" : def.id === "shotgun" ? "shotgun" : def.id === "sniper" ? "sniper" : "shot";
    AudioSys.sfx(snd);
    if (Input.isTouchActive()) AudioSys.vibrate(def.shake > 5 ? 40 : 15);
  },

  tryReload() {
    const p = this.player, w = p.weapons[p.wIndex];
    if (w.def.melee || w.reloading || w.ammo >= w.def.mag || w.reserve <= 0) return;
    w.reloading = true;
    w.reloadT = w.def.reloadTime * p.reloadMult;
    AudioSys.sfx("reload");
  },

  meleeSlash(main) {
    const p = this.player;
    const w = p.weapons[p.wIndex];
    const arc = w.def.melee ? w.def.arc : 1.9, range = w.def.melee ? w.def.range : 92;
    const dmg = (w.def.melee ? w.def.dmg : 45) * p.dmgMult;
    this.spawnSlashFx(p.x, p.y, p.aimAngle, range * .9, main ? "#eff6ff" : "#fff3c9");
    let hit = this.damageInArc(p.x, p.y, p.aimAngle, range, dmg, arc / 2);
    p.katanaGauge = Math.min(1, p.katanaGauge + .1 + hit * .07);
    if (main) AudioSys.sfx("slash");
  },

  quickSlash() {
    const p = this.player;
    if (p.quickSlashCd > 0) return;
    p.quickSlashCd = .55;
    this.meleeSlash(false);
    p.katanaGauge = Math.min(1, p.katanaGauge + .12);
    AudioSys.sfx("slash");
  },

  spawnSlashFx(x, y, a, len, color) {
    this.particles.push({ kind: "slash", x, y, angle: a, len, color, life: .18, maxLife: .18 });
  },

  damageInArc(x, y, a, range, dmg, halfArc) {
    let hit = 0;
    for (const e of [...this.enemies]) {
      const d = U.dist(x, y, e.x, e.y);
      if (d < range + e.r) {
        const ea = Math.atan2(e.y - y, e.x - x);
        if (Math.abs(U.wrapAngle(ea - a)) < halfArc) {
          this.damageEnemy(e, dmg, ea, "slash");
          hit++;
        }
      }
    }
    return hit;
  },

  dashSlash() {
    const p = this.player;
    if (p.dashSlashT > 0 || p.katanaGauge < 1) return;
    p.dashSlashT = .5;
    p.katanaGauge = 0;
    p.invuln = Math.max(p.invuln, .4);
    p.dashT = .2; p.dashCd = Math.min(p.dashCd, .5);
    const dx = Math.cos(p.aimAngle), dy = Math.sin(p.aimAngle);
    p.dashDir = { x: dx, y: dy };
    p.vx = dx * 900; p.vy = dy * 900;
    this.spawnSlashFx(p.x, p.y, p.aimAngle, 130, "#ffe9b0");
    this.damageInArc(p.x, p.y, p.aimAngle, 140, 130, 1.2);
    AudioSys.sfx("dashslash");
    this.camera.shake = 6;
  },

  /* ================= grenade ================= */
  updateGrenadeInput(gp) {
    const p = this.player;
    const hold = Input.down("KeyG") || !!Input.touch.btnState.grenade || (gp && gp.x);
    const wasHold = p.grenadeHold >= 0;
    if (hold && !wasHold) {
      if (p.grenades > 0) p.grenadeHold = 0;
      else { AudioSys.sfx("empty"); p.grenadeHold = -2; setTimeout(() => { if (Game.player && Game.player.grenadeHold === -2) Game.player.grenadeHold = -1; }, 250); }
    } else if (hold && p.grenadeHold >= 0) {
      p.grenadeHold += this.dt || .016;
    } else if (!hold && wasHold) {
      if (p.grenades > 0) {
        this.throwGrenade(Math.min(1, p.grenadeHold / .9));
        p.grenades--;
      }
      p.grenadeHold = -1;
    }
  },

  throwGrenade(power) {
    const p = this.player;
    const a = p.aimAngle;
    const sp = 420 + power * 520;
    this.grenades.push({
      x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      fuse: 1.1 + power * .5,
    });
    AudioSys.sfx("grenade");
  },

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.x += g.vx * dt; g.y += g.vy * dt;
      g.vx *= Math.pow(.25, dt); g.vy *= Math.pow(.25, dt);
      if (g.x < 30 || g.x > this.world.w - 30) { g.vx *= -.4; g.x = U.clamp(g.x, 30, this.world.w - 30); }
      if (g.y < 30 || g.y > this.world.h - 30) { g.vy *= -.4; g.y = U.clamp(g.y, 30, this.world.h - 30); }
      let boom = g.fuse <= 0;
      if (!boom) for (const e of this.enemies) if (U.dist(g.x, g.y, e.x, e.y) < e.r + 14) { boom = true; break; }
      if (boom) { this.explodeGrenade(g); this.grenades.splice(i, 1); }
    }
  },

  explodeGrenade(g) {
    const R = 115, dmg = (this.mode === "zombies" ? 120 : 95) * (this.player.grenadeMult || 1);
    for (const e of [...this.enemies]) {
      const d = U.dist(g.x, g.y, e.x, e.y);
      if (d < R + e.r) {
        const a = Math.atan2(e.y - g.y, e.x - g.x);
        this.damageEnemy(e, dmg * (1 - .5 * U.clamp(d / R, 0, 1)), a, "boom");
      }
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, s = U.rand(60, 420);
      this.particles.push({
        kind: Math.random() < .5 ? "spark" : "splat",
        x: g.x, y: g.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        size: U.rand(3, 7), color: Math.random() < .5 ? "#e8892f" : "#d94f3d",
        life: U.rand(.25, .6), maxLife: .6,
      });
    }
    this.burst(g.x, g.y, 12, "dust", "#fff");
    this.camera.shake = Math.min(18, this.camera.shake + 9);
    AudioSys.sfx("explosion");
  },

  /* ================= waves ================= */
  spawnWave(n) {
    this.wave = n;
    this.waveKills = 0;
    this.bossWave = this.mode === "zombies" ? (n % 5 === 0) : (n % 10 === 0);
    this.boss = null;
    const base = this.mode === "zombies" ? 8 + n * 4 + (this.bossWave ? 6 : 0) : Math.min(40, 6 + n * 3);
    this.spawnQueue = base + (this.bossWave ? 1 : 0);
    this.spawnTimer = .4;
    this.waveActive = true;
    this.wavePause = 0;
    AudioSys.sfx("wave");
    UI.updateHUD(true);
  },

  updateWaves(dt) {
    if (this.wavePause > 0) {
      this.wavePause -= dt;
      if (this.wavePause <= 0) this.spawnWave(this.wave + 1);
      return;
    }
    if (!this.waveActive) return;
    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      const n = Math.max(1, (this.mode === "zombies" ? 2.2 : 1.4) - this.wave * .06);
      if (this.spawnTimer <= 0) {
        this.spawnTimer = Math.max(.35, n * U.rand(.7, 1.3));
        const type = (this.bossWave && this.spawnQueue === 1) ? "boss" : this.pickEnemyType();
        this.spawnEnemyAtEdge(type);
        this.spawnQueue--;
      }
    } else if (this.enemies.length === 0) {
      this.waveActive = false;
      const bonus = 50 + this.wave * 25;
      this.score += bonus;
      if (this.mode === "zombies") {
        this.coins += 20 + this.wave * 5;
        this.state = "shop";
        UI.showShop();
        AudioSys.sfx("shop");
      } else {
        this.toast("WAVE " + this.wave + " CLEAR  +" + bonus, "good");
        this.wavePause = 3.4;
      }
    }
  },

  pickEnemyType() {
    const w = this.wave, r = Math.random();
    if (this.mode === "zombies") {
      if (w >= 4 && r < .18) return "runner";
      if (w >= 3 && r < .13) return "spitter";
      if (w >= 2 && r < .1) return "brute";
      if (r < .82) return "walker";
      return "brute";
    }
    if (w >= 3 && r < .2) return "runner";
    if (w >= 4 && r < .17) return "spitter";
    if (w >= 4 && r < .08) return "tank";
    if (w >= 2 && r < .14) return "brute";
    return "walker";
  },

  enemySpec(type, wave) {
    const z = this.mode === "zombies";
    const hpMult = 1 + (wave - 1) * (z ? .16 : .13);
    const dmgMult = 1 + (wave - 1) * .05;
    const base = {
      walker: { r: z ? 15 : 16, hp: z ? 34 : 30, speed: z ? 62 + wave * 3 : U.rand(58, 88), dmg: 8, score: 10, color: z ? "#a8c98e" : "#ffb1a0" },
      runner: { r: 13, hp: z ? 22 : 26, speed: z ? 205 + wave * 4 : 205, dmg: 6, score: 15, color: z ? "#c58fb4" : "#a8d8f0" },
      spitter: { r: z ? 16 : 15, hp: z ? 40 : 34, speed: z ? 55 : 42, dmg: 10, score: 20, range: 320, color: z ? "#8fbf6a" : "#e8b731" },
      tank: { r: 27, hp: 120, speed: 45, dmg: 16, score: 30, color: "#5b87c0" },
      brute: { r: z ? 24 : 21, hp: z ? 85 : 70, speed: z ? 70 : 92, dmg: 12, score: 25, color: z ? "#c0884f" : "#f5d98a" },
      boss: { r: z ? 88 : 78, hp: z ? 1400 + wave * 90 : 900 + wave * 60, speed: z ? 78 : 70, dmg: 22, score: z ? 800 : 500, color: "#9a6bd4" },
    }[type];
    return Object.assign({}, base, {
      hp: Math.round(base.hp * hpMult),
      maxHp: Math.round(base.hp * hpMult),
      dmg: Math.round(base.dmg * dmgMult),
      score: base.score + (z ? wave * 5 : 0),
      color: base.color,
    });
  },

  spawnEnemyAtEdge(type) {
    const spec = this.enemySpec(type, this.wave);
    const side = U.randInt(0, 3), m = 46;
    let x, y;
    if (side === 0) { x = U.rand(m, this.world.w - m); y = m; }
    else if (side === 1) { x = U.rand(m, this.world.w - m); y = this.world.h - m; }
    else if (side === 2) { x = m; y = U.rand(m, this.world.h - m); }
    else { x = this.world.w - m; y = U.rand(m, this.world.h - m); }
    this.addEnemy(type, x, y, spec);
    if (this.bossWave && type === "walker" && Math.random() < .3) {
      this.addEnemy("walker", x + U.rand(-80, 80), y + U.rand(-60, 60), this.enemySpec("walker", this.wave));
    }
  },

  addEnemy(type, x, y, spec) {
    const isBoss = type === "boss";
    const e = {
      x, y, vx: 0, vy: 0, r: spec.r, type,
      hp: spec.hp, maxHp: spec.maxHp, dmg: spec.dmg, speed: spec.speed,
      color: spec.color, score: spec.score,
      seed: Math.random() * 10, angle: U.rand(-Math.PI, Math.PI),
      shape: type, lookAngle: 0,
      attackCd: U.rand(.2, .8), spitCd: U.rand(1, 2.2),
      wobFreq: U.rand(5, 8), wobAmt: isBoss ? .35 : .6,
      border: isBoss ? 4 : 2.6,
      hitFlash: 0, kbx: 0, kby: 0, stun: 0,
      boss: isBoss, bossPhase: 0, bossTimer: 0, charge: null,
    };
    if (isBoss) {
      this.boss = e;
      this.bossWave = true;
      AudioSys.sfx("boss");
      UI.showBoss(true);
    }
    this.enemies.push(e);
    return e;
  },

  /* ================= enemies ================= */
  updateEnemies(dt) {
    const p = this.player;
    const z = this.mode === "zombies";
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.stun = Math.max(0, e.stun - dt);
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      e.lookAngle = Math.atan2(dy, dx);

      let ax = 0, ay = 0;
      if (e.type === "walker" || e.type === "tank") {
        ax = nx; ay = ny;
        if (!z && e.type === "walker") {
          const wob = Math.sin(this.timeAlive * 2 + e.seed);
          ax = nx + wob * .4; ay = ny - wob * .3;
          if (d < 60) { ax = -nx; ay = -ny; }
        }
      } else if (e.type === "runner") {
        const wob = Math.sin(this.timeAlive * 6 + e.seed);
        ax = nx - ny * wob * .7; ay = ny + nx * wob * .7;
        if (d < 130) { ax = -ny * Math.sign(wob) - nx * .2; ay = nx * Math.sign(wob) - ny * .2; }
      } else if (e.type === "brute") {
        ax = nx; ay = ny;
        if (d < 80) { ax = 0; ay = 0; }
      } else if (e.type === "spitter") {
        const want = e.range || 320;
        if (d < want * .6) { ax = -nx; ay = -ny; }
        else if (d > want) { ax = nx; ay = ny; }
        else { ax = -ny * Math.sin(this.timeAlive + e.seed) * .5; ay = nx * Math.sin(this.timeAlive + e.seed) * .5; }
        e.spitCd -= dt;
        if (e.spitCd <= 0 && d < 560) {
          e.spitCd = z ? 2.4 : 2.7;
          this.spit(e);
        }
      } else if (e.type === "boss") {
        ax = nx; ay = ny;
      }

      e.kbx *= Math.pow(.02, dt); e.kby *= Math.pow(.02, dt);
      const spd = e.stun > 0 ? 0 : e.speed;
      e.vx = ax * spd + e.kbx; e.vy = ay * spd + e.kby;
      e.x = U.clamp(e.x + e.vx * dt, e.r, this.world.w - e.r);
      e.y = U.clamp(e.y + e.vy * dt, e.r, this.world.h - e.r);
      if (Math.hypot(e.vx, e.vy) > 2) e.angle = Math.atan2(e.vy, e.vx);
      else e.angle = U.angleLerp(e.angle, Math.atan2(dy, dx), dt * 3);

      if (e.boss) this.updateBoss(e, dt, nx, ny);

      if (e.attackCd <= 0 && d < e.r + p.r + 2 && p.invuln <= 0) {
        e.attackCd = .8;
        this.damagePlayer(e.dmg);
        p.vx += nx * 380; p.vy += ny * 380;
      }

      for (let j = i + 1; j < this.enemies.length; j++) {
        const o = this.enemies[j];
        const ddx = o.x - e.x, ddy = o.y - e.y;
        const dd = Math.hypot(ddx, ddy);
        const min = (e.r + o.r) * .9;
        if (dd < min && dd > .01) {
          const push = (min - dd) * .5, ux = ddx / dd, uy = ddy / dd;
          e.x -= ux * push; e.y -= uy * push;
          o.x += ux * push; o.y += uy * push;
        }
      }
    }
  },

  updateBoss(e, dt, nx, ny) {
    e.bossTimer -= dt;
    if (e.bossTimer <= 0) {
      e.bossPhase = (e.bossPhase + 1) % 3;
      e.bossTimer = 2.6;
      if (e.bossPhase === 1) {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + this.timeAlive;
          this.eBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, r: 6, dmg: 10, life: 3.2, color: this.mode === "zombies" ? "#9ac27e" : "#8f5bd4" });
        }
        AudioSys.sfx("boss");
      } else if (e.bossPhase === 2) {
        e.charge = { t: .8, dx: nx, dy: ny };
      }
    }
    if (e.charge) {
      e.charge.t -= dt;
      if (e.charge.t <= 0) {
        e.x += e.charge.dx * 900 * dt; e.y += e.charge.dy * 900 * dt;
        if (e.charge.t < -.5) e.charge = null;
      }
      if (Math.random() < .4) {
        this.particles.push({
          kind: "dust", x: e.x - e.charge.dx * e.r * .8, y: e.y - e.charge.dy * e.r * .8,
          vx: 0, vy: 0, size: U.rand(4, 9), color: "#fff", life: .3, maxLife: .3,
        });
      }
    }
  },

  spit(e) {
    const p = this.player;
    const a = Math.atan2(p.y - e.y, p.x - e.x) + (Math.random() - .5) * .3;
    const sp = this.mode === "zombies" ? 330 : 280;
    this.eBullets.push({
      x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6, dmg: e.dmg,
      life: 3, color: this.mode === "zombies" ? "#6f9a4e" : "#b05cc0",
    });
  },
});
