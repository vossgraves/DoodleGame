import * as THREE from "three";
import { InkRenderer } from "./renderer";
import { World } from "./physics";
import { Input } from "./input";
import { AudioSys } from "./audio";
import { buildLevel, disposeLevel, getMap, DEFAULT_MAP, type Level, type Mode } from "./level";
import { ZoneView } from "./zone";
import { Player, type Weapon, type WeaponKind } from "./player";
import { MatchNet } from "./match";
import { encodeLocal } from "./remote";
import { Combat, wavePlan, pickSpawn, type EnemyKind } from "./enemies";
import { clamp } from "./math";

export type GameState = "playing" | "paused" | "dead" | "intermission";

export interface KillFeedItem {
  id: number;
  text: string;
  pts: number;
}

export interface HudSnap {
  hp: number;
  maxHp: number;
  mag: string;
  reserve: string;
  reloading: boolean;
  weapon: string;
  hint: string;
  wave: number;
  left: number;
  score: number;
  combo: number;
  nades: number;
  slots: { name: string; ammo: string; active: boolean; empty: boolean }[];
  spread: number;
  ads: boolean;
  katana: boolean;
  boss: { name: string; frac: number } | null;
  message: string;
  sub: string;
  tip: string;
  low: boolean;
  kills: number;
  time: number;
  best: number;
  mode: Mode;
  state: GameState;
  hitmarker: number;
  hitKill: boolean;
  hitCrit: boolean;
  dmgAngle: number | null;
  killFeed: KillFeedItem[];
  waveLabel: string;
  modifier: string;
  focusFrac: number;
  focusReady: boolean;
}

const defaultHud = (): HudSnap => ({
  hp: 120,
  maxHp: 120,
  mag: "35",
  reserve: "/140",
  reloading: false,
  weapon: "RIFLE",
  hint: "",
  wave: 0,
  left: 0,
  score: 0,
  combo: 0,
  nades: 3,
  slots: [],
  spread: 10,
  ads: false,
  katana: false,
  boss: null,
  message: "",
  sub: "",
  tip: "",
  low: false,
  kills: 0,
  time: 0,
  best: 0,
  mode: "district",
  state: "playing",
  hitmarker: 0,
  hitKill: false,
  hitCrit: false,
  dmgAngle: null,
  killFeed: [],
  waveLabel: "WAVE",
  modifier: "",
  focusFrac: 0,
  focusReady: false,
});

export class Game {
  canvas: HTMLCanvasElement;
  R: InkRenderer;
  world = new World();
  input: Input;
  audio = new AudioSys();
  level: Level;
  player: Player;
  combat: Combat;
  mode: Mode;
  mapKey: string;
  state: GameState = "playing";
  wave = 0;
  score = 0;
  combo = 0;
  comboT = 0;
  kills = 0;
  time = 0;
  intermission = 0;
  queue: EnemyKind[] = [];
  spawnT = 0;
  maxAlive = 8;
  hitstopT = 0;
  best: number;
  hud: HudSnap = defaultHud();
  onHud: ((h: HudSnap) => void) | null = null;
  onState: ((s: GameState) => void) | null = null;
  /** fires when the lobby roster, scores or match state change */
  onNet: (() => void) | null = null;
  match!: MatchNet;
  zoneView!: ZoneView;
  private raf = 0;
  private last = 0;
  private msgT = 0;
  private tipT = 0;
  private feedId = 0;
  private running = false;
  private disposed = false;
  private onResize: () => void;

  constructor(canvas: HTMLCanvasElement, mode: Mode, mapKey: string = DEFAULT_MAP, loadout?: WeaponKind[]) {
    this.canvas = canvas;
    this.mode = mode;
    this.mapKey = mapKey;
    this.R = new InkRenderer(canvas);
    this.R.night = mode === "zombies" ? 1 : 0;
    this.input = new Input(canvas);
    this.best = Number(localStorage.getItem(mode === "zombies" ? "doodle_zbest" : "doodle_best") || 0);
    this.level = buildLevel(this.R.scene, this.world, mode, mapKey);
    this.combat = new Combat(this.world, this.R.scene, this.audio);
    this.player = new Player({
      world: this.world,
      input: this.input,
      audio: this.audio,
      camera: this.R.camera,
      scene: this.R.scene,
      onFire: (w, o, d, ads) => this.handleFire(w, o, d, ads),
      onSlash: (o, d, dmg, heavy) => this.handleSlash(o, d, dmg, heavy),
      onNade: (o, d, c) => this.combat.throwNade(o, d, c),
      onHurt: (_a, from) => this.handleHurt(from),
      onDeath: () => this.handleDeath(),
      loadout,
    });
    this.player.reset(this.level.playerStart);

    this.match = new MatchNet({
      scene: this.R.scene,
      snapshot: () =>
        encodeLocal(
          {
            pos: this.player.pos,
            vel: this.player.vel,
            yaw: this.player.yaw,
            pitch: this.player.pitch,
            hp: this.player.hp,
            alive: this.player.alive,
            crouching: this.player.crouching,
            sliding: this.player.sliding,
            onGround: this.player.onGround,
            aiming: this.player.aiming,
            weaponIndex: this.player.weaponIndex,
            weapon: this.player.weapon,
          },
          this.match.isFiring,
        ),
      hurt: (amount, from) => this.player.takeDamage(amount, from),
      respawn: (pos) => {
        this.player.reset(pos);
        this.state = "playing";
        this.onState?.("playing");
      },
      spawnPoints: () => this.level.spawns,
      localPos: () => this.player.pos,
      localAlive: () => this.player.alive,
      mapExtent: () => getMap(this.mapKey).half,
      spawnLoot: (items) => {
        for (const it of items) {
          this.combat.spawnPickup(it.kind, new THREE.Vector3(it.pos[0], it.pos[1], it.pos[2]));
        }
      },
      feed: (text, pts) => this.addScore(pts, text),
      announce: (m, s) => this.announce(m, s),
      changed: () => this.onNet?.(),
    });
    // a hit on another player is reported to them; their client applies it
    this.combat.onRemoteHit = (t, dmg, crit) => this.match.reportHit(t.id, dmg, this.player.eye, crit);
    this.zoneView = new ZoneView(this.R.scene);
    this.audio.setTune(mode === "zombies" ? "zombies" : "district");
    const sens = Number(localStorage.getItem("doodle_sens") || 100);
    const invert = localStorage.getItem("doodle_invert") === "1";
    this.input.mouseSens = 0.0022 * (sens / 100);
    this.input.invertY = invert;

    this.onResize = () => {
      const r = canvas.parentElement?.getBoundingClientRect() || canvas.getBoundingClientRect();
      const w = Math.max(1, r.width || window.innerWidth);
      const h = Math.max(1, r.height || window.innerHeight);
      this.R.resize(w, h);
    };
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.audio.ensure();
    this.audio.startMusic();
    this.last = performance.now();
    if (this.mode === "arena") {
      // no waves in PvP; the lobby decides when the match begins
      this.state = "playing";
      this.announce("THE ARENA", "waiting for the lobby");
    } else {
      this.beginWave();
      this.announce(
        this.mode === "zombies" ? "THEY RISE" : "INK SPILLS",
        this.mode === "zombies" ? "don't let them touch you" : "erase the doodles",
      );
    }
    if (!this.input.isTouch) this.input.requestLock();
    this.tip(this.input.isTouch ? "joystick move · drag look · hold FIRE" : "WASD move · mouse look · click shoot", 4);
    this.loop(this.last);
  }

  pause() {
    if (this.state !== "playing" && this.state !== "intermission") return;
    this.state = "paused";
    this.input.exitLock();
    this.onState?.("paused");
  }
  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    if (!this.input.isTouch) this.input.requestLock();
    this.onState?.("playing");
  }

  beginWave() {
    this.wave += 1;
    this.queue = wavePlan(this.mode, this.wave);
    this.spawnT = 0.4;
    this.intermission = 0;
    this.state = "playing";
    this.maxAlive = this.mode === "zombies" ? Math.min(22, 8 + this.wave) : Math.min(14, 5 + Math.floor(this.wave * 0.7));
    if (this.input.isTouch) this.maxAlive = Math.min(this.maxAlive, 12);
    this.audio.wave();
    this.announce(this.mode === "zombies" ? `HORDE ${this.wave}` : `WAVE ${this.wave}`, `${this.queue.length} inked`);
    const mods = this.mode === "zombies" ? ["hungrier", "faster feet", "rotten air", "more teeth"] : ["ink rain", "shaky hands", "loud paper", "double doodles"];
    this.hud.modifier = this.wave % 3 === 0 ? mods[this.wave % mods.length] : "";
  }

  private spawnOne() {
    if (!this.queue.length) return;
    if (this.combat.aliveCount() >= this.maxAlive) return;
    const kind = this.queue.shift()!;
    const p = pickSpawn(this.level.spawns, this.player.pos, this.level.snipers, kind);
    p.y = this.world.groundY(p.x, p.z) + 0.02;
    this.combat.spawn(kind, p);
  }

  private handleFire(w: Weapon, origin: THREE.Vector3, dir: THREE.Vector3, ads: boolean) {
    const spread = (ads ? w.def.adsSpread : w.spreadCur) + Math.hypot(this.player.vel.x, this.player.vel.z) * 0.0012;
    this.match.markFiring();
    let any = false,
      kill = false,
      crit = false;
    for (let i = 0; i < w.def.pellets; i++) {
      const d = this.player.aimDir(spread);
      const r = this.combat.hitscan(origin, d, 140, w.def.damage, w.def.headMul, w.def.falloff, this.player);
      if (r.hit) any = true;
      if (r.kill) kill = true;
      if (r.crit) crit = true;
      if (r.kill) this.onKill(r.enemy!.def.name, r.enemy!.def.score, r.crit);
    }
    void dir;
    if (any) this.markHit(kill, crit);
  }

  private handleSlash(origin: THREE.Vector3, dir: THREE.Vector3, dmg: number, heavy: boolean) {
    const r = this.combat.slash(origin, dir, dmg, heavy, this.player);
    if (r.hit) {
      this.markHit(r.kill, r.crit);
      this.player.katanaStreak += r.kill ? 1 : 0;
      this.hitstopT = heavy ? 0.08 : 0.04;
    }
    if (r.kill) {
      // score already? slash doesn't call onKill per enemy. Let's award roughly
      this.addScore(heavy ? 200 : 120, heavy ? "FOCUS SLASH" : "SLASH");
      this.kills += 1;
    }
  }

  private onKill(name: string, pts: number, crit: boolean) {
    this.kills += 1;
    this.combo = Math.min(12, this.combo + 1);
    this.comboT = 2.6;
    this.addScore(pts, (crit ? "HEAD! " : "") + name);
    if (this.player.weapon.def.kind === "katana") this.player.katanaStreak += 1;
  }

  addScore(pts: number, label: string) {
    const mult = 1 + Math.min(this.combo, 9) * 0.25;
    const p = Math.round(pts * mult);
    this.score += p;
    this.feedId += 1;
    this.hud.killFeed = [{ id: this.feedId, text: label, pts: p }, ...this.hud.killFeed].slice(0, 5);
    setTimeout(() => {
      this.hud.killFeed = this.hud.killFeed.filter((k) => k.id !== this.feedId);
    }, 1700);
  }

  private markHit(kill: boolean, crit: boolean) {
    this.hud.hitmarker += 1;
    this.hud.hitKill = kill;
    this.hud.hitCrit = crit;
    this.audio.hit();
    if (crit) this.audio.crit();
    this.input.rumble(kill ? 0.6 : 0.25, 0.4, kill ? 80 : 40);
    if (kill) this.hitstopT = Math.max(this.hitstopT, 0.05);
  }

  private handleHurt(from: THREE.Vector3 | null) {
    if (!from) {
      this.hud.dmgAngle = 0;
      return;
    }
    const v = new THREE.Vector3().subVectors(from, this.player.eye);
    const x = v.dot(this.player.right);
    const f = v.dot(this.player.forward);
    this.hud.dmgAngle = Math.atan2(x, f);
  }

  private handleDeath() {
    // online you come back; the match, not the run, is what ends
    if (this.match.inMatch) {
      this.match.reportDeath();
      this.announce("ERASED", "back on the page shortly");
      return;
    }
    this.state = "dead";
    this.announce("ERASED", this.mode === "zombies" ? "the page is overrun" : "the doodles won");
    this.audio.stopMusic();
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(this.mode === "zombies" ? "doodle_zbest" : "doodle_best", String(this.best));
    }
    this.input.exitLock();
    this.onState?.("dead");
  }

  announce(main: string, sub = "") {
    this.hud.message = main;
    this.hud.sub = sub;
    this.msgT = 1.8;
  }
  tip(t: string, dur = 2.2) {
    this.hud.tip = t;
    this.tipT = dur;
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const raw = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.input.update(raw);

    if (this.input.pressed("pause")) {
      if (this.state === "playing" || this.state === "intermission") this.pause();
      else if (this.state === "paused") this.resume();
    }
    if (this.input.pressed("music")) this.audio.setMusic(!this.audio.musicWanted);

    let dt = raw;
    if (this.hitstopT > 0) {
      this.hitstopT -= raw;
      dt *= 0.18;
    }

    if (this.state === "playing" || this.state === "intermission") {
      this.time += dt;
      this.player.update(dt);
      if (this.match.online) {
        this.match.update(dt);
        this.combat.remotes = this.match.targets();
        const z = this.match.zone;
        if (z.active && this.match.mode === "br") {
          this.zoneView.set(z.cx, z.cz, z.r);
          const burn = this.match.zoneTick(dt, this.player.pos);
          if (burn > 0 && this.player.alive) this.player.takeDamage(burn, null);
        } else this.zoneView.hide();
      } else if (this.combat.remotes.length) {
        this.combat.remotes = [];
      }
      this.combat.update(dt, this.player, this.time);
      for (const a of this.level.animated) a.update(this.time);

      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;

      if (this.state === "playing" && this.player.alive && this.mode !== "arena") {
        this.spawnT -= dt;
        if (this.spawnT <= 0 && this.queue.length) {
          this.spawnOne();
          this.spawnT = this.mode === "zombies" ? Math.max(0.12, 0.55 - this.wave * 0.03) : 0.55;
        }
        if (!this.queue.length && this.combat.aliveCount() === 0) {
          this.state = "intermission";
          this.intermission = 3.6;
          this.announce("WAVE CLEAR", "catch your breath");
          this.player.addHp(25);
          for (const w of this.player.weapons) if (w.def.isGun) w.addAmmo(Math.round(w.def.magSize * 0.6));
        }
      }
      if (this.state === "intermission") {
        this.intermission -= dt;
        if (this.intermission <= 0) this.beginWave();
      }
    } else if (this.state === "paused" || this.state === "dead") {
      // still render
    }

    if (this.msgT > 0) {
      this.msgT -= raw;
      if (this.msgT <= 0) {
        this.hud.message = "";
        this.hud.sub = "";
      }
    }
    if (this.tipT > 0) {
      this.tipT -= raw;
      if (this.tipT <= 0) this.hud.tip = "";
    }

    const moving = this.player.onGround && Math.hypot(this.player.vel.x, this.player.vel.z) > 1.2;
    this.audio.update(raw, moving && this.state === "playing", this.player.sprinting);

    const wpn = this.player.weapon;
    const boss = this.combat.enemies.find((e) => e.alive && e.def.boss);
    this.hud.hp = this.player.hp;
    this.hud.maxHp = this.player.maxHp;
    this.hud.mag = wpn.def.isGun ? String(wpn.mag) : "∞";
    this.hud.reserve = wpn.def.isGun ? "/" + wpn.reserve : "";
    this.hud.reloading = wpn.reloading;
    this.hud.weapon = wpn.def.name;
    this.hud.hint = wpn.def.hint;
    this.hud.wave = this.wave;
    this.hud.left = this.combat.aliveCount() + this.queue.length;
    this.hud.score = this.score;
    this.hud.combo = this.combo;
    this.hud.nades = this.player.grenades;
    this.hud.slots = this.player.weapons.map((w, i) => ({
      name: w.def.name,
      ammo: w.def.isGun ? `${w.mag}/${w.reserve}` : "slash",
      active: i === this.player.weaponIndex,
      empty: w.def.isGun && w.mag <= 0 && w.reserve <= 0,
    }));
    this.hud.spread = 8 + wpn.spreadCur * 180;
    this.hud.ads = this.player.aiming;
    this.hud.katana = wpn.def.kind === "katana";
    this.hud.boss = boss ? { name: boss.def.name, frac: clamp(boss.hp / boss.maxHp, 0, 1) } : null;
    this.hud.low = this.player.hp / this.player.maxHp < 0.3;
    this.hud.kills = this.kills;
    this.hud.time = this.time;
    this.hud.best = this.best;
    this.hud.mode = this.mode;
    this.hud.state = this.state;
    this.hud.waveLabel = this.mode === "zombies" ? "HORDE" : "WAVE";
    this.hud.focusFrac = clamp(this.player.katanaStreak / 3, 0, 1);
    this.hud.focusReady = this.player.katanaStreak >= 3;

    this.R.setHurt(this.player.hurtFx);
    this.R.setFlash(this.player.flashFx);
    this.R.setLowHp(this.hud.low ? 1 : 0);
    this.R.render(this.time);
    this.onHud?.(this.hud);
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input.exitLock();
    this.audio.stopMusic();
    this.combat.clear();
    this.match.leave();
    this.zoneView.dispose(this.R.scene);
    disposeLevel(this.R.scene, this.level);
    this.R.dispose();
  }
}
