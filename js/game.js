/* game.js — core simulation: waves, enemies, weapons, player, zombies mode */
"use strict";

const Game = {
  state: "menu",            // menu | play | paused | shop | over
  mode: null,               // "district" | "zombies"
  canvas: null, ctx: null,
  view: { w: 1280, h: 720, dpr: 1 },
  world: { w: 2200, h: 1400, deco: null, decoZ: null },
  camera: { x: 0, y: 0, shake: 0, sx: 0, sy: 0 },
  player: null,
  enemies: [], bullets: [], eBullets: [], grenades: [], pickups: [], particles: [],
  wave: 1, score: 0, kills: 0, coins: 0, timeAlive: 0, waveKills: 0,
  waveActive: false, spawnQueue: 0, spawnTimer: 0, wavePause: 0,
  boss: null, bossWave: false,
  upgradeLevels: {}, upgradeCards: [],
  paused: false,
  lastT: 0,
  best: { district: 0, zombies: 0 },
  hintT: 0,
  fps: 60,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.best.district = Store.get("best-district", 0);
    this.best.zombies = Store.get("best-zombies", 0);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  },

  resize() {
    const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.view = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    if (Game.state === "play") {
      const nw = Math.max(w * 1.5, 2000), nh = Math.max(h * 1.5, 1250);
      const px = U.clamp(this.player.x / this.world.w, 0, 1), py = U.clamp(this.player.y / this.world.h, 0, 1);
      this.world.w = nw; this.world.h = nh;
      this.buildWorldDeco();
      this.cameraToPlayer(true);
      this.player.x = px * nw; this.player.y = py * nh;
    }
  },

  buildWorldDeco() {
    const w = Math.round(this.world.w), h = Math.round(this.world.h);
    if (!this.world.deco || this.world.deco.width !== w || this.world.deco.height !== h) {
      this.world.deco = document.createElement("canvas");
      this.world.deco.width = w; this.world.deco.height = h;
      Draw.decorate(this.world.deco.getContext("2d"), w, h, U.mulberry(1234), false);
    }
    if (!this.world.decoZ || this.world.decoZ.width !== w || this.world.decoZ.height !== h) {
      this.world.decoZ = document.createElement("canvas");
      this.world.decoZ.width = w; this.world.decoZ.height = h;
      Draw.decorate(this.world.decoZ.getContext("2d"), w, h, U.mulberry(987), true);
    }
  },

  startGame(mode) {
    this.mode = mode;
    this.resetRun();
    this.state = "play";
    if (Input.deviceType === "touch") Input.touchMode = true;
    Input.showTouchUI(Input.deviceType === "touch" || Store.get("force-touch", false));
    UI.show("hud");
    UI.hide(["screen-menu", "screen-howto", "screen-settings", "screen-pause", "screen-shop", "screen-over", "banner"]);
    UI.updateHUD(true);
    UI.showBanner(mode === "zombies" ? "NIGHT MODE" : "DISTRICT", mode === "zombies" ? "the horde is coming" : "survive the waves");
    AudioSys.init(); AudioSys.resume();
    AudioSys.startMusic(mode === "zombies");
    if (mode === "zombies") this.toast("\u2623 ZOMBIES MODE \u2014 kills drop coins \u00b7 upgrades between waves");
    this.spawnWave(1);
    this.hintT = 0;
  },

  resetRun() {
    this.player = {
      x: this.world.w / 2, y: this.world.h / 2,
      vx: 0, vy: 0, r: 14,
      hp: 120, maxHp: 120,
      angle: 0, aimAngle: 0, aimTouch: false,
      onGround: true, hop: 0, seed: Math.random() * 100,
      invuln: 0, hurtFlash: 0,
      sprint: false, moving: false,
      dashCd: 0, dashT: 0, dashDir: { x: 1, y: 0 },
      dashGauge: .5, katanaGauge: .5,
      katanaCd: 0, quickSlashCd: 0,
      fireCd: 0,
      grenades: 2, grenadeHold: -1,
      wIndex: 0,
      combo: 1, comboT: 0,
      dmgMult: 1, fireRateMult: 1, speedMult: 1, reloadMult: 1,
      armor: 0, vamp: 0, double: 0, grenadeMult: 1,
      weapons: null,
    };
    this.player.weapons = this.mode === "zombies"
      ? WEAPON_DEFS.map(d => ({ def: d, ammo: d.mag, reserve: d.reserve, reloading: false, reloadT: 0 }))
      : [WEAPON_DEFS[0], WEAPON_DEFS[1], WEAPON_DEFS[2], WEAPON_DEFS[4]].map(d => ({ def: d, ammo: d.mag, reserve: d.reserve, reloading: false, reloadT: 0 }));
    this.enemies = []; this.bullets = []; this.eBullets = []; this.grenades = []; this.pickups = []; this.particles = [];
    this.wave = 1; this.score = 0; this.kills = 0; this.coins = 0; this.timeAlive = 0; this.waveKills = 0;
    this.upgradeLevels = {}; this.upgradeCards = [];
    this.boss = null; this.bossWave = false;
    this.cameraToPlayer(true);
  },

  toast(msg, cls) { if (UI.addToast) UI.addToast(msg, cls || ""); },

  frame(t) {
    if (!this.lastT) this.lastT = t;
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (dt > 0.05) dt = 0.05;
    this.dt = dt;
    this.fps = U.lerp(this.fps, 1 / Math.max(dt, 0.0001), .05);
    if (this.state === "play" && !this.paused) {
      this.update(dt);
    } else if (this.state === "menu") {
      this.updateMenu(dt);
    }
    this.draw();
    UI.updateHint();
    Input.endFrame();
  },

  updateMenu(dt) {
    if (!this.menuZombies) {
      this.menuZombies = [];
      for (let i = 0; i < 6; i++) {
        this.menuZombies.push({
          x: Math.random() * this.view.w, y: Math.random() * this.view.h,
          vx: U.rand(-30, 30), vy: U.rand(-18, 18), r: U.rand(14, 26),
          shape: U.pick(["walker", "runner", "tank", "brute"]), seed: Math.random() * 10,
          angle: 0, wobFreq: U.rand(6, 9), wobAmt: .5, hp: 1, maxHp: 1,
          color: U.pick(["#b7e0a5", "#ffb1a0", "#a8d8f0", "#f5d98a", "#c58fb4"]),
          border: 2.4,
        });
      }
    }
    for (const z of this.menuZombies) {
      z.x += z.vx * dt; z.y += z.vy * dt;
      if (z.x < 30) { z.x = 30; z.vx *= -1; }
      if (z.x > this.view.w - 30) { z.x = this.view.w - 30; z.vx *= -1; }
      if (z.y < 30) { z.y = 30; z.vy *= -1; }
      if (z.y > this.view.h - 30) { z.y = this.view.h - 30; z.vy *= -1; }
      z.angle = Math.atan2(z.vy, z.vx);
    }
  },

  update(dt) {
    const p = this.player;
    this.timeAlive += dt;
    if (this.hintT < 9) this.hintT += dt;

    const mv = Input.getMove();
    const gp = Input.getGamepad();
    let mx = mv.x, my = mv.y, sprint = mv.sprint || (gp && Math.hypot(gp.lx, gp.ly) > .9);
    if (gp && Math.hypot(gp.lx, gp.ly) > .1) { mx = gp.lx; my = gp.ly; }
    p.moving = Math.hypot(mx, my) > .05;

    const baseSpeed = (this.mode === "zombies" ? 250 : 240) * p.speedMult;
    const sp = sprint ? baseSpeed * 1.5 : baseSpeed;
    if (p.moving) {
      p.vx += mx * 2300 * dt; p.vy += my * 2300 * dt;
      const vel = Math.hypot(p.vx, p.vy);
      if (vel > sp) { p.vx *= sp / vel; p.vy *= sp / vel; }
    } else {
      const f = Math.pow(.0001, dt);
      p.vx *= f; p.vy *= f;
    }
    p.x = U.clamp(p.x + p.vx * dt, 40, this.world.w - 40);
    p.y = U.clamp(p.y + p.vy * dt, 40, this.world.h - 40);
    p.hop = Math.sin(this.timeAlive * (sprint ? 13 : 9)) * (p.moving ? 1.5 : 0);

    p.dashCd = Math.max(0, p.dashCd - dt);
    p.dashSlashT = Math.max(0, (p.dashSlashT || 0) - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);

    const wantDash = Input.pressed("KeyC") || Input.pressed("ControlLeft") || Input.pressed("Space") ||
      Input.touch.btnState.dash || (gp && (gp.b || gp.lt > .5));
    if (wantDash && p.dashCd <= 0 && p.dashT <= 0) {
      if (p.katanaGauge >= 1) {
        // dash-slash once the gauge is lit (both mouse buttons / dash)
        this.dashSlash();
      } else {
        let dx = mx, dy = my;
        if (Math.hypot(dx, dy) < .1) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
        const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
        p.dashT = .17;
        p.dashCd = 2.0;
        p.dashDir = { x: dx, y: dy };
        p.invuln = Math.max(p.invuln, .28);
        p.vx = dx * 640; p.vy = dy * 640;
        AudioSys.sfx("dash");
        this.burst(p.x, p.y, 6, "dust", "#fff");
      }
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDir.x * 640; p.vy = p.dashDir.y * 640;
      if (Math.random() < .5) this.burst(p.x, p.y, 1, "dust", "#fff");
    }

    this.updateAim(dt, gp);
    this.updateWeapons(dt, gp);
    this.updateGrenadeInput(gp);

    p.comboT = Math.max(0, p.comboT - dt);
    if (p.comboT <= 0) p.combo = 1;

    this.updateWaves(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateEnemyBullets(dt);
    this.updateGrenades(dt);
    this.updatePickups(dt);
    this.updateParticles(dt);

    this.cameraToPlayer(false);
    this.camera.shake = Math.max(0, this.camera.shake - dt * 26);
    this.camera.sx = (Math.random() - .5) * this.camera.shake;
    this.camera.sy = (Math.random() - .5) * this.camera.shake;
    UI.updateHUD();
  },
};
