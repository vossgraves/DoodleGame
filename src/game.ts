/* game.ts — core simulation (ported from the canvas version, now three.js) */
import * as THREE from "three";
import { U, Store, makeTextSprite } from "./utils";
import { AudioSys } from "./audio";
import { Input } from "./input";
import { WEAPON_DEFS } from "./weapons";
import { World } from "./world";
import {
  makeDoodleBlob, makeZombie, makePlayer, buildWeaponMesh,
  makeBullet, makeEBullet, makeGrenade, makePickup,
  makeHpBar, updateHpBar, makeSlashSprite,
} from "./entities";
import type {
  Bullet, EBullet, Enemy, EnemySpec, GameState, Grenade, Mode,
  Particle, Pickup, PlayerState, UpgradeDef,
} from "./types";

export class Game {
  state: GameState = "menu";
  mode: Mode = "district";
  world!: World;
  player!: PlayerState;
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  eBullets: EBullet[] = [];
  grenades: Grenade[] = [];
  pickups: Pickup[] = [];
  particles: Particle[] = [];
  wave = 1;
  score = 0;
  kills = 0;
  coins = 0;
  timeAlive = 0;
  waveKills = 0;
  waveActive = false;
  spawnQueue = 0;
  spawnTimer = 0;
  wavePause = 0;
  boss: Enemy | null = null;
  bossWave = false;
  upgradeLevels: Record<string, number> = {};
  upgradeCards: UpgradeDef[] = [];
  paused = false;
  best = { district: 0, zombies: 0 };
  hintT = 0;
  dt = 0.016;
  lastT = 0;
  private tid = 1;
  private aimTarget = new THREE.Vector3();
  private menuDoodles: Enemy[] = [];
  uiCallbacks: {
    onHUD(): void;
    onShowBoss(show: boolean): void;
    onGameOver(mode: Mode, isBest: boolean): void;
    onPause(on: boolean): void;
    onShop(open: boolean): void;
    onToast(msg: string, cls: string): void;
    onMenu(): void;
  } | null = null;

  /* ------------------------------------------------------------------ */
  init(container: HTMLElement, callbacks: Game["uiCallbacks"]) {
    this.world = new World(container);
    this.uiCallbacks = callbacks;
    this.best.district = Store.get("best-district", 0);
    this.best.zombies = Store.get("best-zombies", 0);
    this.spawnMenuDoodles();
    this.lastT = performance.now();
    this.world.setMode("district");
  }

  setUI(cb: Game["uiCallbacks"]) { this.uiCallbacks = cb; }
  toast(msg: string, cls = "") { this.uiCallbacks?.onToast(msg, cls); }

  /* ------------------------------------------------------------------ */
  startGame(mode: Mode) {
    this.mode = mode;
    this.resetRun();
    this.state = "play";
    this.world.setMode(mode);
    Input.showTouchUI(Input.deviceType === "touch" || Store.get("force-touch", false));
    this.uiCallbacks?.onMenu();
    this.uiCallbacks?.onShop(false);
    this.uiCallbacks?.onPause(false);
    AudioSys.init(); AudioSys.resume();
    AudioSys.startMusic(mode === "zombies");
    this.uiCallbacks?.onHUD();
    if (mode === "zombies") this.toast("☣ ZOMBIES MODE — kills drop coins · upgrades between waves");
    this.spawnWave(1);
    this.hintT = 0;
  }

  private resetRun() {
    const d = this.world;
    const playerMesh = makePlayer();
    this.player = {
      x: d.width / 2, z: d.height / 2, vx: 0, vz: 0, r: 14,
      hp: 120, maxHp: 120,
      angle: 0, aimAngle: 0, aimTouch: false,
      seed: Math.random() * 100,
      invuln: 0, hurtFlash: 0,
      sprint: false, moving: false,
      dashCd: 0, dashT: 0, dashDir: { x: 1, z: 0 },
      dashGauge: .5, katanaGauge: .5,
      katanaCd: 0, quickSlashCd: 0, dashSlashT: 0,
      fireCd: 0,
      grenades: 2, grenadeHold: -1,
      wIndex: 0,
      combo: 1, comboT: 0,
      dmgMult: 1, fireRateMult: 1, speedMult: 1, reloadMult: 1,
      armor: 0, vamp: 0, double: 0, grenadeMult: 1,
      weapons: [],
      group: playerMesh.group,
      body: playerMesh.body,
      armL: playerMesh.armL,
      armR: playerMesh.armR,
      gunMount: playerMesh.gunMount,
      shadow: playerMesh.shadow,
    };
    const defs = this.mode === "zombies"
      ? WEAPON_DEFS
      : [WEAPON_DEFS[0], WEAPON_DEFS[1], WEAPON_DEFS[2], WEAPON_DEFS[4]];
    this.player.weapons = defs.map(d => ({ def: d, ammo: d.mag, reserve: d.reserve, reloading: false, reloadT: 0 }));
    this.buildWeaponMeshOnPlayer();
    playerMesh.group.position.set(this.player.x, 0, this.player.z);
    d.scene.add(playerMesh.group);
    this.enemies = []; this.bullets = []; this.eBullets = []; this.grenades = []; this.pickups = []; this.particles = [];
    this.clearMenuDoodles();
    this.wave = 1; this.score = 0; this.kills = 0; this.coins = 0; this.timeAlive = 0; this.waveKills = 0;
    this.upgradeLevels = {}; this.upgradeCards = [];
    this.boss = null; this.bossWave = false;
    this.world.snapTo(this.player.x, this.player.z);
  }

  private buildWeaponMeshOnPlayer() {
    const p = this.player;
    while (p.gunMount.children.length) {
      const c = p.gunMount.children.pop()!;
      c.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mm = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mm)) mm.forEach(x => x.dispose()); else if (mm) mm.dispose();
      });
    }
    const wpn = buildWeaponMesh(p.weapons[p.wIndex].def.id);
    p.gunMount.add(wpn);
    p.gunMount.rotation.z = 0.1;
  }

  /* ------------------------- frame loop ------------------------- */
  frame(t: number) {
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (dt > 0.05) dt = 0.05;
    this.dt = dt;
    if (this.state === "play" && !this.paused) this.update(dt);
    else if (this.state === "menu") this.updateMenu(dt);
    this.animate(dt, t / 1000);
    this.world.renderer.render(this.world.scene, this.world.camera);
    this.updateCrosshair();
    Input.endFrame();
  }

  private updateCrosshair() {
    const ch = document.getElementById("crosshair");
    if (ch) {
      if (this.state === "play" && !this.player?.aimTouch && !Input.isTouchActive()) {
        ch.classList.remove("hidden");
        ch.style.transform = `translate(${Input.mouse.nx * window.innerWidth}px, ${Input.mouse.ny * window.innerHeight}px) translate(-50%,-50%)`;
      } else ch.classList.add("hidden");
    }
  }

  private updateMenu(dt: number) {
    for (const e of this.menuDoodles) {
      e.x += e.vx * dt; e.z += e.vz * dt;
      if (e.x < 60) { e.x = 60; e.vx *= -1; }
      if (e.x > this.world.width - 60) { e.x = this.world.width - 60; e.vx *= -1; }
      if (e.z < 60) { e.z = 60; e.vz *= -1; }
      if (e.z > this.world.height - 60) { e.z = this.world.height - 60; e.vz *= -1; }
      e.angle = Math.atan2(e.vz, e.vx);
    }
    // gentle orbit for menu
    const t = performance.now() / 1000;
    const px = this.world.width / 2 + Math.cos(t * 0.1) * 300;
    const pz = this.world.height / 2 + Math.sin(t * 0.1) * 300;
    this.world.followPlayer(px, pz, dt);
  }

  private spawnMenuDoodles() {
    for (let i = 0; i < 6; i++) {
      const r = U.rand(16, 26);
      const g = makeDoodleBlob(r, U.pick([0xffb1a0, 0xa8d8f0, 0xf5d98a, 0xc58fb4, 0x9acf72]), i * 7 + 3);
      g.position.set(U.rand(200, this.world.width - 200), 0, U.rand(200, this.world.height - 200));
      this.world.scene.add(g);
      this.menuDoodles.push({
        id: this.tid++, type: "walker",
        x: g.position.x, z: g.position.z, vx: U.rand(-30, 30), vz: U.rand(-18, 18),
        r, hp: 1, maxHp: 1, dmg: 0, speed: 0, color: "#ffffff", score: 0,
        angle: 0, seed: i * 9, attackCd: 0, spitCd: 0, stun: 0, kbx: 0, kbz: 0, hitFlash: 0,
        boss: false, bossPhase: 0, bossTimer: 0, charge: null,
        group: g, wobble: g, hpBar: null, hpCanvas: null, hpCtx: null, dead: false,
      });
    }
  }

  private clearMenuDoodles() {
    for (const e of this.menuDoodles) {
      this.world.scene.remove(e.group);
      e.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.menuDoodles = [];
  }

  /* ------------------------- update ------------------------- */
  private update(dt: number) {
    const p = this.player;
    this.timeAlive += dt;
    if (this.hintT < 9) this.hintT += dt;

    const mv = Input.getMove();
    const gp = Input.getGamepad();
    let mx = mv.x, my = mv.y;
    let sprint = mv.sprint || !!(gp && Math.hypot(gp.lx, gp.ly) > .9);
    if (gp && Math.hypot(gp.lx, gp.ly) > .1) { mx = gp.lx; my = gp.ly; }
    p.moving = Math.hypot(mx, my) > .05;
    p.sprint = sprint;

    const base = (this.mode === "zombies" ? 250 : 240) * p.speedMult;
    const sp = sprint ? base * 1.5 : base;
    if (p.moving) {
      p.vx += mx * 2300 * dt; p.vz += my * 2300 * dt;
      const vel = Math.hypot(p.vx, p.vz);
      if (vel > sp) { p.vx *= sp / vel; p.vz *= sp / vel; }
    } else {
      const f = Math.pow(.0001, dt);
      p.vx *= f; p.vz *= f;
    }
    p.x = U.clamp(p.x + p.vx * dt, 40, this.world.width - 40);
    p.z = U.clamp(p.z + p.vz * dt, 40, this.world.height - 40);

    p.dashCd = Math.max(0, p.dashCd - dt);
    p.dashSlashT = Math.max(0, p.dashSlashT - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);

    const wantDash = Input.pressed("KeyC") || Input.pressed("ControlLeft") || Input.pressed("Space") ||
      Input.touch.btnState.dash || (gp && (gp.b || gp.lt > .5)) ||
      (Input.mouse.lmb && Input.mouse.rmb);
    if (wantDash && p.dashCd <= 0 && p.dashT <= 0) {
      if (p.katanaGauge >= 1) this.dashSlash();
      else {
        let dx = mx, dz = my;
        if (Math.hypot(dx, dz) < .1) { dx = Math.cos(p.angle); dz = Math.sin(p.angle); }
        const m = Math.hypot(dx, dz) || 1; dx /= m; dz /= m;
        p.dashT = .17; p.dashCd = 2.0;
        p.dashDir = { x: dx, z: dz };
        p.invuln = Math.max(p.invuln, .28);
        p.vx = dx * 640; p.vz = dz * 640;
        AudioSys.sfx("dash");
        this.burst(p.x, p.z, 6, "dust", "#ffffff");
      }
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDir.x * 640; p.vz = p.dashDir.z * 640;
      if (Math.random() < .5) this.burst(p.x, p.z, 1, "dust", "#ffffff");
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

    this.world.followPlayer(p.x, p.z, dt);
    this.uiCallbacks?.onHUD();
  }

  private updateAim(dt: number, gp: ReturnType<typeof Input.getGamepad>) {
    const p = this.player;
    const ta = Input.getAim();
    let aimSet = false;
    if (gp && (Math.abs(gp.rx) + Math.abs(gp.ry) > .12)) {
      p.aimAngle = Math.atan2(-gp.ry, gp.rx); // screen up = -z
      p.aimTouch = true; aimSet = true;
    }
    if (ta) {
      let ax = ta.x, ay = ta.y;
      if (Store.get("assist", true) && ta.mag < .75) {
        const t = this.nearestEnemy(p.x, p.z, 620);
        if (t) {
          const ea = Math.atan2(t.z - p.z, t.x - p.x);
          const da = U.wrapAngle(ea - Math.atan2(ay, ax));
          if (Math.abs(da) < .75) { ax = Math.cos(ea); ay = Math.sin(ea); }
        }
      }
      p.aimAngle = Math.atan2(ay, ax);
      p.aimTouch = true; aimSet = true;
      if (p.moving && !aimSet) p.angle = Math.atan2(p.vz, p.vx);
      else p.angle = p.aimAngle;
    } else if (!Input.isTouchActive()) {
      if (this.world.raycastGround(Input.mouse.nx * 2 - 1, -(Input.mouse.ny * 2 - 1), this.aimTarget)) {
        const before = p.aimAngle;
        p.aimAngle = Math.atan2(this.aimTarget.z - p.z, this.aimTarget.x - p.x);
        p.aimAngle = U.angleLerp(before, p.aimAngle, Math.min(1, dt * 30));
        p.aimTouch = false; aimSet = true;
      }
    }
    if (p.moving && !aimSet) p.angle = Math.atan2(p.vz, p.vx);
    else p.angle = p.aimAngle;
  }

  nearestEnemy(x: number, z: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null, bd = maxDist * maxDist;
    for (const e of this.enemies) {
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /* ------------------------- weapons ------------------------- */
  private updateWeapons(dt: number, gp: ReturnType<typeof Input.getGamepad>) {
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

    let wantIdx: number | null = null;
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
      this.buildWeaponMeshOnPlayer();
      AudioSys.sfx("switch");
      this.uiCallbacks?.onHUD();
    }

    const touchFire = Input.touch.fire ||
      !!(Input.touch.stickAim && Math.hypot(Input.touch.stickAim.dx, Input.touch.stickAim.dy) > .55);
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
  }
  private weaponWheel = 0;
  private switchLock = false;

  private fireWeapon(w: PlayerState["weapons"][number]) {
    const p = this.player;
    const def = w.def;
    const baseAngle = p.aimAngle + (Math.random() - .5) * def.spread * 2;
    const shots = 1 + (Math.random() < p.double ? 1 : 0);
    const sx = p.x + Math.cos(p.aimAngle) * 20, sz = p.z + Math.sin(p.aimAngle) * 20;
    for (let s = 0; s < shots; s++) {
      for (let i = 0; i < def.pellets; i++) {
        const a = baseAngle + (i - (def.pellets - 1) / 2) * def.spread / Math.max(1, def.pellets * .2) + (Math.random() - .5) * def.spread * .4;
        const color = def.id === "sniper" ? 0x3f9d63 : 0x3b6fd4;
        const b = makeBullet(color);
        b.position.set(sx, 26, sz);
        b.rotation.y = -a;
        this.world.scene.add(b);
        this.bullets.push({
          x: sx, z: sz, vx: Math.cos(a) * def.speed, vz: Math.sin(a) * def.speed,
          angle: a, dmg: def.dmg * p.dmgMult, len: def.id === "sniper" ? 26 : 14,
          pierce: !!def.pierce, life: 1.4, group: b,
        });
      }
    }
    this.burst(sx, sz, 2 + def.pellets, "muzzle", "#ffd76a");
    this.world.shake = Math.min(16, this.world.shake + def.shake);
    p.vx -= Math.cos(p.aimAngle) * def.shake * 26 * this.dt;
    p.vz -= Math.sin(p.aimAngle) * def.shake * 26 * this.dt;
    const snd = def.id === "rifle" ? "rifle" : def.id === "shotgun" ? "shotgun" : def.id === "sniper" ? "sniper" : "shot";
    AudioSys.sfx(snd);
    if (Input.isTouchActive()) AudioSys.vibrate(def.shake > 5 ? 40 : 15);
  }

  private tryReload() {
    const p = this.player, w = p.weapons[p.wIndex];
    if (w.def.melee || w.reloading || w.ammo >= w.def.mag || w.reserve <= 0) return;
    w.reloading = true;
    w.reloadT = w.def.reloadTime * p.reloadMult;
    AudioSys.sfx("reload");
  }

  private meleeSlash(main: boolean) {
    const p = this.player;
    const w = p.weapons[p.wIndex];
    const arc = w.def.melee ? w.def.arc! : 1.9;
    const range = w.def.melee ? w.def.range! : 92;
    const dmg = (w.def.melee ? w.def.dmg : 45) * p.dmgMult;
    this.spawnSlash(p.x, p.z, p.aimAngle, range * .9, main ? "#eff6ff" : "#fff3c9");
    const hit = this.damageInArc(p.x, p.z, p.aimAngle, range, dmg, arc / 2);
    p.katanaGauge = Math.min(1, p.katanaGauge + .1 + hit * .07);
    if (main) AudioSys.sfx("slash");
  }

  private quickSlash() {
    const p = this.player;
    if (p.quickSlashCd > 0) return;
    p.quickSlashCd = .55;
    this.meleeSlash(false);
    p.katanaGauge = Math.min(1, p.katanaGauge + .12);
    AudioSys.sfx("slash");
  }

  private spawnSlash(x: number, z: number, a: number, len: number, color: string) {
    const c = new THREE.Color(color);
    const s = makeSlashSprite(c.getHex());
    s.position.set(x, 40, z);
    s.material.rotation = -a;
    this.world.scene.add(s);
    this.particles.push({
      kind: "slash", x, z, vx: 0, vz: 0, y: 40, size: len, color,
      life: .18, maxLife: .18, sprite: s, angle: a, len,
    });
  }

  private dashSlash() {
    const p = this.player;
    if (p.dashSlashT > 0 || p.katanaGauge < 1) return;
    p.dashSlashT = .5;
    p.katanaGauge = 0;
    p.invuln = Math.max(p.invuln, .4);
    p.dashT = .2; p.dashCd = Math.min(p.dashCd, .5);
    const dx = Math.cos(p.aimAngle), dz = Math.sin(p.aimAngle);
    p.dashDir = { x: dx, z: dz };
    p.vx = dx * 900; p.vz = dz * 900;
    this.spawnSlash(p.x, p.z, p.aimAngle, 130, "#ffe9b0");
    this.damageInArc(p.x, p.z, p.aimAngle, 140, 130, 1.2);
    AudioSys.sfx("dashslash");
    this.world.shake = 6;
  }

  private damageInArc(x: number, z: number, a: number, range: number, dmg: number, halfArc: number): number {
    let hit = 0;
    for (const e of [...this.enemies]) {
      const d = U.dist(x, z, e.x, e.z);
      if (d < range + e.r) {
        const ea = Math.atan2(e.z - z, e.x - x);
        if (Math.abs(U.wrapAngle(ea - a)) < halfArc) {
          this.damageEnemy(e, dmg, ea, "slash");
          hit++;
        }
      }
    }
    return hit;
  }

  /* ------------------------- grenades ------------------------- */
  private updateGrenadeInput(gp: ReturnType<typeof Input.getGamepad>) {
    const p = this.player;
    const hold = Input.down("KeyG") || !!Input.touch.btnState.grenade || (gp && gp.x);
    const wasHold = p.grenadeHold >= 0;
    if (hold && !wasHold) {
      if (p.grenades > 0) p.grenadeHold = 0;
      else {
        AudioSys.sfx("empty");
        p.grenadeHold = -2;
        setTimeout(() => { if (this.player.grenadeHold === -2) this.player.grenadeHold = -1; }, 250);
      }
    } else if (hold && p.grenadeHold >= 0) {
      p.grenadeHold += this.dt;
    } else if (!hold && wasHold) {
      if (p.grenades > 0) {
        this.throwGrenade(Math.min(1, p.grenadeHold / .9));
        p.grenades--;
      }
      p.grenadeHold = -1;
    }
  }

  private throwGrenade(power: number) {
    const p = this.player;
    const a = p.aimAngle;
    const sp = 420 + power * 520;
    const g = makeGrenade();
    g.position.set(p.x, 8, p.z);
    this.world.scene.add(g);
    this.grenades.push({
      x: p.x + Math.cos(a) * 18, z: p.z + Math.sin(a) * 18,
      vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
      fuse: 1.1 + power * .5, group: g,
    });
    AudioSys.sfx("grenade");
  }

  private updateGrenades(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.x += g.vx * dt; g.z += g.vz * dt;
      g.vx *= Math.pow(.25, dt); g.vz *= Math.pow(.25, dt);
      if (g.x < 30 || g.x > this.world.width - 30) { g.vx *= -.4; g.x = U.clamp(g.x, 30, this.world.width - 30); }
      if (g.z < 30 || g.z > this.world.height - 30) { g.vz *= -.4; g.z = U.clamp(g.z, 30, this.world.height - 30); }
      g.group.position.set(g.x, 8 + Math.abs(Math.sin(this.timeAlive * 9)) * 26, g.z);
      g.group.rotation.y += dt * 8;
      let boom = g.fuse <= 0;
      if (!boom) for (const e of this.enemies) if (U.dist(g.x, g.z, e.x, e.z) < e.r + 14) { boom = true; break; }
      if (boom) {
        this.explodeGrenade(g);
        this.world.scene.remove(g.group);
        this.grenades.splice(i, 1);
      }
    }
  }

  private explodeGrenade(g: Grenade) {
    const R = 115;
    const dmg = (this.mode === "zombies" ? 120 : 95) * this.player.grenadeMult;
    for (const e of [...this.enemies]) {
      const d = U.dist(g.x, g.z, e.x, e.z);
      if (d < R + e.r) {
        const a = Math.atan2(e.z - g.z, e.x - g.x);
        this.damageEnemy(e, dmg * (1 - .5 * U.clamp(d / R, 0, 1)), a, "boom");
      }
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, s = U.rand(60, 420);
      this.particles.push({
        kind: Math.random() < .5 ? "spark" : "splat",
        x: g.x, z: g.z, vx: Math.cos(a) * s, vz: Math.sin(a) * s,
        y: 20, size: U.rand(3, 8), color: Math.random() < .5 ? "#e8892f" : "#d94f3d",
        life: U.rand(.3, .7), maxLife: .7, sprite: null,
      });
    }
    this.burst(g.x, g.z, 10, "dust", "#ffffff");
    this.world.shake = Math.min(18, this.world.shake + 9);
    AudioSys.sfx("explosion");
  }

  /* ------------------------- waves ------------------------- */
  spawnWave(n: number) {
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
    this.uiCallbacks?.onHUD();
  }

  private updateWaves(dt: number) {
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
        this.paused = true;
        this.openShop();
        AudioSys.sfx("shop");
      } else {
        this.toast("WAVE " + this.wave + " CLEAR  +" + bonus, "good");
        this.wavePause = 3.4;
      }
    }
  }

  private pickEnemyType(): string {
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
  }

  private enemySpec(type: string, wave: number): EnemySpec {
    const z = this.mode === "zombies";
    const hpMult = 1 + (wave - 1) * (z ? .16 : .13);
    const dmgMult = 1 + (wave - 1) * .05;
    const base = ({
      walker: { r: z ? 15 : 16, hp: z ? 34 : 30, speed: z ? 62 + wave * 3 : U.rand(58, 88), dmg: 8, score: 10, color: z ? 0xa8c98e : 0xffb1a0 },
      runner: { r: 13, hp: z ? 22 : 26, speed: z ? 205 + wave * 4 : 205, dmg: 6, score: 15, color: z ? 0xc58fb4 : 0xa8d8f0 },
      spitter: { r: z ? 16 : 15, hp: z ? 40 : 34, speed: z ? 55 : 42, dmg: 10, score: 20, range: 320, color: z ? 0x8fbf6a : 0xe8b731 },
      tank: { r: 27, hp: 120, speed: 45, dmg: 16, score: 30, color: 0x5b87c0 },
      brute: { r: z ? 24 : 21, hp: z ? 85 : 70, speed: z ? 70 : 92, dmg: 12, score: 25, color: z ? 0xc0884f : 0xf5d98a },
      boss: { r: z ? 88 : 78, hp: z ? 1400 + wave * 90 : 900 + wave * 60, speed: z ? 78 : 70, dmg: 22, score: z ? 800 : 500, color: 0x9a6bd4 },
    } as Record<string, { r: number; hp: number; speed: number; dmg: number; score: number; color: number; range?: number }>)[type];
    return {
      r: base.r,
      hp: Math.round(base.hp * hpMult),
      speed: base.speed,
      dmg: Math.round(base.dmg * dmgMult),
      score: base.score + (z ? wave * 5 : 0),
      color: "#" + base.color.toString(16).padStart(6, "0"),
      range: base.range,
    };
  }

  private spawnEnemyAtEdge(type: string) {
    const spec = this.enemySpec(type, this.wave);
    const side = U.randInt(0, 3), m = 46;
    let x: number, z: number;
    if (side === 0) { x = U.rand(m, this.world.width - m); z = m; }
    else if (side === 1) { x = U.rand(m, this.world.width - m); z = this.world.height - m; }
    else if (side === 2) { x = m; z = U.rand(m, this.world.height - m); }
    else { x = this.world.width - m; z = U.rand(m, this.world.height - m); }
    this.addEnemy(type, x, z, spec);
    if (this.bossWave && type === "walker" && Math.random() < .3) {
      this.addEnemy("walker", x + U.rand(-80, 80), z + U.rand(-60, 60), this.enemySpec("walker", this.wave));
    }
  }

  private addEnemy(type: string, x: number, z: number, spec: EnemySpec): Enemy {
    const isBoss = type === "boss";
    const r = spec.r;
    const group = this.mode === "zombies"
      ? makeZombie(r, type, this.tid * 13)
      : makeDoodleBlob(r, new THREE.Color(spec.color).getHex(), this.tid * 13);
    group.position.set(x, 0, z);
    group.rotation.y = U.rand(-Math.PI, Math.PI);
    const wobble = (group.userData.wobble as THREE.Object3D) || group;
    this.world.scene.add(group);
    let hpBar: THREE.Sprite | null = null;
    let hpCanvas: HTMLCanvasElement | null = null;
    let hpCtx: CanvasRenderingContext2D | null = null;
    if (!isBoss) {
      const bar = makeHpBar();
      hpBar = bar.sprite; hpCanvas = bar.canvas; hpCtx = bar.ctx;
      hpBar.position.y = r * 2.6;
      group.add(hpBar);
      hpBar.visible = false;
    }
    const e: Enemy = {
      id: this.tid++, type, x, z, vx: 0, vz: 0, r,
      hp: spec.hp, maxHp: spec.hp, dmg: spec.dmg, speed: spec.speed,
      color: spec.color, score: spec.score,
      angle: U.rand(-Math.PI, Math.PI), seed: Math.random() * 10,
      attackCd: U.rand(.2, .8), spitCd: U.rand(1, 2.2),
      stun: 0, kbx: 0, kbz: 0, hitFlash: 0,
      boss: isBoss, bossPhase: 0, bossTimer: 0, charge: null,
      group, wobble, hpBar, hpCanvas, hpCtx, dead: false,
    };
    if (isBoss) {
      this.boss = e;
      this.bossWave = true;
      AudioSys.sfx("boss");
      this.uiCallbacks?.onShowBoss(true);
    }
    this.enemies.push(e);
    return e;
  }

  /* ------------------------- enemies ------------------------- */
  private updateEnemies(dt: number) {
    const p = this.player;
    const z = this.mode === "zombies";
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.stun = Math.max(0, e.stun - dt);
      const dx = p.x - e.x, dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      const nx = dx / d, nz = dz / d;

      let ax = 0, az = 0;
      if (e.type === "walker" || e.type === "tank") {
        ax = nx; az = nz;
        if (!z && e.type === "walker") {
          const wob = Math.sin(this.timeAlive * 2 + e.seed);
          ax = nx + wob * .4; az = nz - wob * .3;
          if (d < 60) { ax = -nx; az = -nz; }
        }
      } else if (e.type === "runner") {
        const wob = Math.sin(this.timeAlive * 6 + e.seed);
        ax = nx - nz * wob * .7; az = nz + nx * wob * .7;
        if (d < 130) { ax = -nz * Math.sign(wob) - nx * .2; az = nx * Math.sign(wob) - nz * .2; }
      } else if (e.type === "brute") {
        ax = nx; az = nz;
        if (d < 80) { ax = 0; az = 0; }
      } else if (e.type === "spitter") {
        const want = e.range || 320;
        if (d < want * .6) { ax = -nx; az = -nz; }
        else if (d > want) { ax = nx; az = nz; }
        else { ax = -nz * Math.sin(this.timeAlive + e.seed) * .5; az = nx * Math.sin(this.timeAlive + e.seed) * .5; }
        e.spitCd -= dt;
        if (e.spitCd <= 0 && d < 560) {
          e.spitCd = z ? 2.4 : 2.7;
          this.spit(e);
        }
      } else if (e.type === "boss") {
        ax = nx; az = nz;
      }

      e.kbx *= Math.pow(.02, dt); e.kbz *= Math.pow(.02, dt);
      const spd = e.stun > 0 ? 0 : e.speed;
      e.vx = ax * spd + e.kbx; e.vz = az * spd + e.kbz;
      e.x = U.clamp(e.x + e.vx * dt, e.r, this.world.width - e.r);
      e.z = U.clamp(e.z + e.vz * dt, e.r, this.world.height - e.r);
      if (Math.hypot(e.vx, e.vz) > 2) e.angle = Math.atan2(e.vz, e.vx);
      else e.angle = U.angleLerp(e.angle, Math.atan2(dz, dx), dt * 3);

      if (e.boss) this.updateBoss(e, dt, nx, nz);

      if (e.attackCd <= 0 && d < e.r + p.r + 2 && p.invuln <= 0) {
        e.attackCd = .8;
        this.damagePlayer(e.dmg);
        p.vx += nx * 380; p.vz += nz * 380;
      }

      for (let j = i + 1; j < this.enemies.length; j++) {
        const o = this.enemies[j];
        const ddx = o.x - e.x, ddz = o.z - e.z;
        const dd = Math.hypot(ddx, ddz);
        const min = (e.r + o.r) * .9;
        if (dd < min && dd > .01) {
          const push = (min - dd) * .5, ux = ddx / dd, uz = ddz / dd;
          e.x -= ux * push; e.z -= uz * push;
          o.x += ux * push; o.z += uz * push;
        }
      }
    }
  }

  private updateBoss(e: Enemy, dt: number, nx: number, nz: number) {
    e.bossTimer -= dt;
    if (e.bossTimer <= 0) {
      e.bossPhase = (e.bossPhase + 1) % 3;
      e.bossTimer = 2.6;
      if (e.bossPhase === 1) {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + this.timeAlive;
          this.spawnEBullet(e.x, e.z, Math.cos(a) * 210, Math.sin(a) * 210, 10, this.mode === "zombies" ? "#9ac27e" : "#8f5bd4");
        }
        AudioSys.sfx("boss");
      } else if (e.bossPhase === 2) {
        e.charge = { t: .8, dx: nx, dz: nz };
      }
    }
    const ch = e.charge;
    if (ch) {
      ch.t -= dt;
      if (ch.t <= 0) {
        e.x += ch.dx * 900 * dt; e.z += ch.dz * 900 * dt;
        if (ch.t < -.5) e.charge = null;
      }
      if (Math.random() < .4) this.burst(e.x - ch.dx * e.r * .8, e.z - ch.dz * e.r * .8, 1, "dust", "#ffffff");
    }
  }

  private spawnEBullet(x: number, z: number, vx: number, vz: number, dmg: number, color: string) {
    const g = makeEBullet(new THREE.Color(color).getHex());
    g.position.set(x, 24, z);
    this.world.scene.add(g);
    this.eBullets.push({ x, z, vx, vz, r: 6, dmg, life: 3.2, color, group: g });
  }

  private spit(e: Enemy) {
    const p = this.player;
    const a = Math.atan2(p.z - e.z, p.x - e.x) + (Math.random() - .5) * .3;
    const sp = this.mode === "zombies" ? 330 : 280;
    this.spawnEBullet(
      e.x + Math.cos(a) * e.r, e.z + Math.sin(a) * e.r,
      Math.cos(a) * sp, Math.sin(a) * sp, e.dmg,
      this.mode === "zombies" ? "#6f9a4e" : "#b05cc0"
    );
  }

  /* ------------------------- bullets ------------------------- */
  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      b.group.position.set(b.x, 26, b.z);
      if (b.life <= 0 || b.x < 0 || b.z < 0 || b.x > this.world.width || b.z > this.world.height) {
        this.world.scene.remove(b.group);
        this.bullets.splice(i, 1); continue;
      }
      for (const e of this.enemies) {
        if (U.dist(b.x, b.z, e.x, e.z) < e.r + 4) {
          this.damageEnemy(e, b.dmg, b.angle, "bullet");
          if (!b.pierce) {
            this.world.scene.remove(b.group);
            this.bullets.splice(i, 1);
          }
          break;
        }
      }
    }
  }

  private updateEnemyBullets(dt: number) {
    const p = this.player;
    for (let i = this.eBullets.length - 1; i >= 0; i--) {
      const b = this.eBullets[i];
      b.life -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      b.group.position.set(b.x, 24, b.z);
      if (b.life <= 0 || b.x < 0 || b.z < 0 || b.x > this.world.width || b.z > this.world.height) {
        this.world.scene.remove(b.group);
        this.eBullets.splice(i, 1); continue;
      }
      if (U.dist(b.x, b.z, p.x, p.z) < b.r + p.r && p.invuln <= 0) {
        this.damagePlayer(b.dmg);
        this.world.scene.remove(b.group);
        this.eBullets.splice(i, 1);
      }
    }
  }

  /* ------------------------- damage ------------------------- */
  private damageEnemy(e: Enemy, dmg: number, dir: number, kind: string) {
    if (e.hp <= 0 || e.dead) return;
    e.hp -= dmg;
    e.hitFlash = .12;
    e.stun = Math.max(e.stun, kind === "boom" ? .5 : .12);
    const kb = kind === "boom" ? 340 : kind === "slash" ? 420 : 90;
    const scale = 1 / Math.max(1, e.r / 18);
    e.kbx += Math.cos(dir) * kb * scale;
    e.kbz += Math.sin(dir) * kb * scale;
    const z = this.mode === "zombies";
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        kind: z ? "blood" : "ink",
        x: e.x + Math.cos(dir) * e.r * .7, z: e.z + Math.sin(dir) * e.r * .7,
        vx: Math.cos(dir + (Math.random() - .5)) * U.rand(60, 260),
        vz: Math.sin(dir + (Math.random() - .5)) * U.rand(60, 260),
        y: 26, size: U.rand(2.5, 5), color: z ? "#5d8540" : "#22242a",
        life: U.rand(.2, .5), maxLife: .5, sprite: null,
      });
    }
    AudioSys.sfx("hit");
    if (e.hpBar && e.hpCtx && e.hpCanvas) {
      e.hpBar.visible = true;
      updateHpBar({ sprite: e.hpBar, canvas: e.hpCanvas, ctx: e.hpCtx }, e.hp / e.maxHp, z ? "#7fc46a" : "#d94f3d");
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    const p = this.player;
    const idx = this.enemies.indexOf(e);
    if (idx >= 0) this.enemies.splice(idx, 1);
    if (e.boss) { this.boss = null; this.uiCallbacks?.onShowBoss(false); }
    this.kills++; this.waveKills++;

    p.combo = Math.min(5, p.combo + (p.comboT > 0 ? .5 : 1));
    p.comboT = 2.6;
    const pts = Math.round(e.score * (1 + (p.combo - 1) * .5));
    this.score += pts;

    const z = this.mode === "zombies";
    if (z) {
      const coins = e.boss ? 25 : U.randInt(1, 2 + Math.min(3, Math.floor(this.wave / 3)));
      this.coins += coins;
      this.spawnPickup(e.x + U.rand(-8, 8), e.z + U.rand(-8, 8), "coin", coins);
      const roll = Math.random();
      if (e.boss || roll < .05) this.spawnPickup(e.x, e.z, "ammo", 0);
      if (roll < .07) this.spawnPickup(e.x, e.z, "heart", 0);
      if (e.boss) {
        this.spawnPickup(e.x, e.z, "medkit", 0);
        this.spawnPickup(e.x + 20, e.z, "flash", 0);
      }
      AudioSys.sfx("zdie");
    } else {
      this.spawnText(e.x, e.z, "+" + pts, "#d94f3d");
      AudioSys.sfx("kill");
      if (e.type === "walker" && Math.random() < .04) this.spawnPickup(e.x, e.z, "heart", 0);
    }

    // poof particles
    this.burst(e.x, e.z, 8, z ? "blood" : "spark", e.color);
    // remove mesh
    this.world.scene.remove(e.group);
    e.group.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as THREE.Mesh).geometry) (m as THREE.Mesh).geometry.dispose();
    });

    p.katanaGauge = Math.min(1, p.katanaGauge + (e.boss ? .8 : .07));
    p.dashGauge = Math.min(1, p.dashGauge + (e.boss ? .8 : .08));
    if (z && p.vamp > 0) {
      p.hp = Math.min(p.maxHp, p.hp + p.vamp);
      this.burst(p.x, p.z, 3, "spark", "#7fc46a");
    }
    if (e.boss) { this.toast("BOSS DOWN! +" + pts, "good"); this.world.shake = 12; }
    this.uiCallbacks?.onHUD();
  }

  private damagePlayer(dmg: number) {
    const p = this.player;
    if (p.invuln > 0 || p.hp <= 0) return;
    const d = Math.max(1, Math.round(dmg * (1 - p.armor)));
    p.hp -= d;
    p.invuln = .35;
    p.hurtFlash = .3;
    p.combo = 1; p.comboT = 0;
    AudioSys.sfx("hurt");
    this.world.shake = Math.min(14, this.world.shake + 5);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        kind: "spark", x: p.x, z: p.z,
        vx: Math.cos(a) * U.rand(80, 260), vz: Math.sin(a) * U.rand(80, 260),
        y: 26, size: 4, color: "#d94f3d", life: U.rand(.2, .45), maxLife: .45, sprite: null,
      });
    }
    this.uiCallbacks?.onHUD();
    if (p.hp <= 0) this.gameOver();
  }

  /* ------------------------- pickups & particles ------------------------- */
  private spawnPickup(x: number, z: number, type: Pickup["type"], value: number) {
    const g = makePickup(type);
    g.position.set(x, 0, z);
    this.world.scene.add(g);
    this.pickups.push({ x, z, type, value, life: type === "coin" ? 14 : 12, seed: Math.random() * 10, group: g });
  }

  private spawnText(x: number, z: number, txt: string, color: string) {
    const s = makeTextSprite(txt, color);
    s.position.set(x, 60, z);
    this.world.scene.add(s);
    this.particles.push({
      kind: "text", x, z, vx: 0, vz: 0, y: 60, size: 1, color,
      life: .8, maxLife: .8, sprite: s, txt,
    });
  }

  private updatePickups(dt: number) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.life -= dt;
      if (k.life <= 0) {
        this.world.scene.remove(k.group);
        this.pickups.splice(i, 1); continue;
      }
      const d = U.dist(k.x, k.z, p.x, p.z);
      if (d < 90) { k.x += (p.x - k.x) * dt * 8; k.z += (p.z - k.z) * dt * 8; }
      k.group.position.set(k.x, 0, k.z);
      k.group.rotation.y += dt * 2.4;
      if (d < p.r + 14) {
        this.world.scene.remove(k.group);
        this.pickups.splice(i, 1);
        if (k.type === "coin") {
          this.coins += k.value; this.score += 5;
          AudioSys.sfx("coin");
          this.spawnText(k.x, k.z, "+" + k.value + "¢", "#e8b731");
        } else if (k.type === "heart") {
          p.hp = Math.min(p.maxHp, p.hp + 15);
          AudioSys.sfx("heal");
          this.spawnText(k.x, k.z, "+15 HP", "#e97f9a");
        } else if (k.type === "ammo") {
          for (const w of p.weapons) if (!w.def.melee) w.reserve += Math.round(w.def.mag * .6);
          AudioSys.sfx("reload");
          this.spawnText(k.x, k.z, "AMMO!", "#3b6fd4");
        } else if (k.type === "medkit") {
          p.hp = Math.min(p.maxHp, p.hp + 50);
          AudioSys.sfx("heal");
          this.spawnText(k.x, k.z, "+50 HP", "#d94f3d");
        } else {
          p.katanaGauge = 1; p.dashGauge = 1;
          AudioSys.sfx("dashslash");
          this.spawnText(k.x, k.z, "DASH READY!", "#e8b731");
        }
      }
    }
  }

  burst(x: number, z: number, n: number, kind: Particle["kind"], color: string) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = kind === "dust" ? 20 : U.rand(40, 220);
      this.particles.push({
        kind, x, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s,
        y: U.rand(6, 30), size: U.rand(3, 7), color,
        life: U.rand(.25, .6), maxLife: .6, sprite: null,
      });
    }
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        if (pt.sprite) {
          this.world.scene.remove(pt.sprite);
          (pt.sprite.material as THREE.SpriteMaterial).map?.dispose();
          (pt.sprite.material as THREE.SpriteMaterial).dispose();
        }
        this.particles.splice(i, 1); continue;
      }
      const fade = pt.life / pt.maxLife;
      if (pt.kind === "spark" || pt.kind === "blood" || pt.kind === "ink") {
        pt.x += pt.vx * dt; pt.z += pt.vz * dt;
        pt.vx *= .92; pt.vz *= .92;
      }
      if (pt.sprite) {
        pt.sprite.position.set(pt.x, pt.y + (1 - fade) * 26, pt.z);
        const mat = pt.sprite.material as THREE.SpriteMaterial;
        mat.opacity = pt.kind === "slash" ? fade * .9 : fade;
        const sc = pt.kind === "slash" ? pt.size * (1.3 - fade * .3) : pt.size * (0.6 + fade * .4);
        pt.sprite.scale.set(sc, sc, 1);
      } else {
        const mesh = this.world.softSprite(new THREE.Color(pt.color).getHex());
        mesh.position.set(pt.x, pt.y, pt.z);
        const s = pt.size * (kindScale(pt.kind, fade));
        mesh.scale.set(s, s, 1);
        (mesh.material as THREE.SpriteMaterial).opacity = fade * .9;
        this.world.scene.add(mesh);
        // convert to sprite-backed particle for cleanup
        pt.sprite = mesh;
        pt.life = Math.min(pt.life, .3);
      }
    }
    if (this.particles.length > 260) {
      for (const dead of this.particles.splice(0, this.particles.length - 260)) {
        if (dead.sprite) this.world.scene.remove(dead.sprite);
      }
    }
  }

  /* ------------------------- state changes ------------------------- */
  private gameOver() {
    if (this.state === "over") return;
    this.state = "over";
    this.paused = false;
    const key = this.mode === "zombies" ? "zombies" : "district";
    const isBest = this.score > this.best[key];
    if (isBest) { this.best[key] = this.score; Store.set("best-" + key, this.score); }
    AudioSys.sfx("death");
    AudioSys.stopMusic();
    this.uiCallbacks?.onGameOver(this.mode, isBest);
  }

  pauseGame() {
    if (this.state !== "play") return;
    this.paused = true;
    this.uiCallbacks?.onPause(true);
    AudioSys.stopMusic();
  }

  resumeGame() {
    if (this.state !== "play") return;
    this.paused = false;
    this.uiCallbacks?.onPause(false);
    AudioSys.startMusic(this.mode === "zombies");
  }

  quitToMenu() {
    this.state = "menu";
    this.paused = false;
    this.clearRunMeshes();
    this.spawnMenuDoodles();
    this.world.setMode("district");
    this.uiCallbacks?.onMenu();
    this.uiCallbacks?.onPause(false);
    this.uiCallbacks?.onShop(false);
    Input.showTouchUI(false);
    AudioSys.stopMusic();
  }

  retry() {
    this.clearRunMeshes();
    this.startGame(this.mode);
  }

  private clearRunMeshes() {
    if (this.player) {
      this.world.scene.remove(this.player.group);
      this.player.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    for (const e of this.enemies) this.world.scene.remove(e.group);
    for (const b of this.bullets) this.world.scene.remove(b.group);
    for (const b of this.eBullets) this.world.scene.remove(b.group);
    for (const g of this.grenades) this.world.scene.remove(g.group);
    for (const k of this.pickups) this.world.scene.remove(k.group);
    for (const pt of this.particles) if (pt.sprite) this.world.scene.remove(pt.sprite);
    this.enemies = []; this.bullets = []; this.eBullets = []; this.grenades = []; this.pickups = []; this.particles = [];
  }

  /* ------------------------- zombie shop ------------------------- */
  getUpgradePool(): UpgradeDef[] {
    const out: UpgradeDef[] = [
      { id: "rage", ic: "💢", tt: "RAGE", ds: "+20% damage" },
      { id: "haste", ic: "👟", tt: "HASTE", ds: "+12% move speed" },
      { id: "vital", ic: "🩸", tt: "VITALITY", ds: "+25 max HP & heal 25" },
      { id: "swift", ic: "⚡", tt: "SWIFT HANDS", ds: "+22% faster reload" },
      { id: "armor", ic: "🛡", tt: "ARMOR", ds: "-15% damage taken" },
      { id: "boom", ic: "💥", tt: "DEMO EXPERT", ds: "+40% grenade dmg, +1 nade" },
      { id: "vamp", ic: "🧛", tt: "VAMPIRISM", ds: "+1 HP per kill" },
      { id: "double", ic: "🎲", tt: "DOUBLE TAP", ds: "12% chance to double shot" },
    ];
    return out.filter(u => (this.upgradeLevels[u.id] || 0) < (u.id === "swift" || u.id === "vamp" ? 4 : 5));
  }

  openShop() {
    const pool = this.getUpgradePool().slice();
    const cards: UpgradeDef[] = [];
    while (cards.length < 3 && pool.length) {
      cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    this.upgradeCards = cards;
    this.uiCallbacks?.onShop(true);
  }

  applyUpgrade(id: string) {
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
    this.uiCallbacks?.onHUD();
  }

  buyShopItem(kind: "heal" | "ammo" | "grenade") {
    const p = this.player;
    const cost = kind === "heal" ? 30 + Math.floor(this.wave / 4) * 10 : kind === "ammo" ? 20 : 15;
    if (this.coins < cost) { AudioSys.sfx("deny"); this.uiCallbacks?.onToast("not enough coins", "warn"); return; }
    this.coins -= cost;
    if (kind === "heal") p.hp = Math.min(p.maxHp, p.hp + 40);
    if (kind === "ammo") for (const w of p.weapons) if (!w.def.melee) { w.reserve += Math.round(w.def.mag * 1.2); w.reloading = false; }
    if (kind === "grenade") p.grenades = Math.min(4, p.grenades + 1);
    AudioSys.sfx("buy");
    this.uiCallbacks?.onHUD();
  }

  nextWave() {
    this.paused = false;
    this.state = "play";
    this.uiCallbacks?.onShop(false);
    this.spawnWave(this.wave + 1);
    this.uiCallbacks?.onToast("WAVE " + this.wave + (this.bossWave ? " — BOSS INCOMING ☣" : ""), this.bossWave ? "warn" : "");
  }

  /* ------------------------- animation ------------------------- */
  private animate(dt: number, now: number) {
    // player
    if (this.player) {
      const p = this.player;
      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = -p.angle;
      const speed = Math.hypot(p.vx, p.vz);
      p.body.position.y = Math.sin(now * (p.sprint ? 13 : 9)) * Math.min(1.4, speed / 300);
      p.body.rotation.z = U.clamp(p.vx * .0012, -.18, .18);
      const legs = p.body.userData.legs as THREE.Mesh[] | undefined;
      if (legs) {
        const sw = Math.sin(now * 11) * Math.min(.9, speed / 260);
        legs[0].position.z = 5 + sw * 6;
        legs[1].position.z = -5 + sw * 6;
      }
      p.armL.rotation.x = Math.sin(now * 11) * Math.min(.5, speed / 500);
      p.armR.rotation.x = -Math.sin(now * 11) * Math.min(.5, speed / 500);
      // invuln blink
      p.group.visible = !(p.invuln > 0 && Math.floor(now * 18) % 2 === 0);
    }
    // enemies
    for (const e of this.enemies) {
      e.group.position.set(e.x, 0, e.z);
      e.group.rotation.y = -e.angle + Math.sin(now * (5 + (e.seed % 3)) + e.seed) * .09;
      if (e.wobble) {
        e.wobble.rotation.x = Math.sin(now * (e.type === "runner" ? 7 : 4.5) + e.seed) * .12;
        e.wobble.rotation.z = Math.sin(now * (e.type === "runner" ? 9 : 5) + e.seed) * .1;
      }
      if (e.hitFlash > 0) {
        e.group.scale.setScalar(1 + e.hitFlash * .3);
      } else e.group.scale.setScalar(1);
    }
    // pickups bob
    for (const k of this.pickups) {
      k.group.position.y = Math.sin(now * 3 + k.seed) * 3 + 3;
    }
  }

  onTouchMode() {
    this.toast("📱 touch controls on");
    this.uiCallbacks?.onHUD();
  }

  /** expose enemies count for HUD */
  enemiesLeft() {
    return this.enemies.length + (this.waveActive ? this.spawnQueue : 0);
  }
}

/* particles without own sprite get converted; scale by kind */
function kindScale(kind: string, fade: number): number {
  switch (kind) {
    case "muzzle": return 6 + (1 - fade) * 8;
    case "dust": return 10 + (1 - fade) * 14;
    case "spark": return 4 * fade;
    case "blood": return 5 * fade;
    case "ink": return 4 * fade;
    default: return 6 * fade;
  }
}
