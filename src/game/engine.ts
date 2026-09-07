import * as THREE from "three";
import { InkRenderer, INK, QUALITY, isQuality, type Quality } from "./renderer";
import { World } from "./physics";
import { Input } from "./input";
import { AudioSys } from "./audio";
import { buildLevel, disposeLevel, getMap, DEFAULT_MAP, type Level, type Mode } from "./level";
import { ZoneView } from "./zone";
import { Streaks, type StreakKind, type StreakTarget } from "./streaks";
import { Skills, sanitizeSkill } from "./skills";

/** how long a fallen player's kit stays on the ground */
const DROP_LIFE = 30;
/** seconds after respawning during which the loadout can still be changed */
const RESPAWN_SWAP = 5;
import { Player, WEAPONS, type Weapon, type WeaponKind } from "./player";
import type { Gunsmith } from "./attachments";
import type { Wardrobe } from "./cosmetics";
import type { GrappleTarget } from "./grapple";
import { MatchNet } from "./match";
import { encodeLocal } from "./remote";
import { Combat, wavePlan, pickSpawn, type EnemyKind } from "./enemies";
import { clamp, damp } from "./math";
import { START_SR, srDelta, tierOf } from "./rank";

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
  slots: { name: string; kind: string; ammo: string; active: boolean; empty: boolean }[];
  spread: number;
  ads: boolean;
  melee: boolean;
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
  /** the brief post-respawn window where the kit can still be swapped */
  canSwap: boolean;
  /** scorestreaks earned and waiting to be called in */
  streakReady: string[];
  streak: number;
  uav: boolean;
  piloting: boolean;
  /** grapple: breath left, whether you are hanging, and whether it has a bite */
  grappleStam: number;
  grappleOn: boolean;
  grappleAim: boolean;
  /** operator skill: which one, how charged, and how long it has left */
  skill: string;
  skillCharge: number;
  skillActive: number;
  skillReady: boolean;
  /** night map, and whether the goggles are down */
  night: boolean;
  goggles: boolean;
  /** who put you down, while the kill cam is framing them */
  killCam: { name: string; hp: number; dist: number } | null;
  /** minimap blips in world space; the UI rotates them into the player's frame */
  radar: { x: number; z: number; hostile: boolean }[];
  /** the map's footprint in world units, built once when the level loads */
  radarWalls: { x: number; z: number; w: number; d: number; tall: boolean }[];
  radarSelf: { x: number; z: number; yaw: number };
  radarHalf: number;
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
  melee: false,
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
  canSwap: false,
  streakReady: [],
  streak: 0,
  uav: false,
  piloting: false,
  grappleStam: 1,
  grappleOn: false,
  grappleAim: false,
  skill: "grappler",
  skillCharge: 0,
  skillActive: 0,
  skillReady: false,
  night: false,
  goggles: false,
  killCam: null,
  radar: [],
  radarWalls: [],
  radarSelf: { x: 0, z: 0, yaw: 0 },
  radarHalf: 40,
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
  swapWindow = 0;
  private radarAt = -1;
  best: number;
  hud: HudSnap = defaultHud();
  onHud: ((h: HudSnap) => void) | null = null;
  onState: ((s: GameState) => void) | null = null;
  /** fired per kill with the weapon that got it, so camos can progress */
  onWeaponKill: (k: WeaponKind) => void = () => {};
  /** fires when the lobby roster, scores or match state change */
  onNet: (() => void) | null = null;
  match!: MatchNet;
  zoneView!: ZoneView;
  streaks!: Streaks;
  skills!: Skills;

  /**
   * Swap kit during the post-respawn window. Guarded here rather than in the UI
   * so holding the menu open past the window does not become a free re-arm.
   */
  applyLoadout(kinds: WeaponKind[], gunsmith?: Gunsmith, wardrobe?: Wardrobe): boolean {
    if (this.swapWindow <= 0 || this.player.spentResource || !this.player.alive) return false;
    this.player.setLoadout(kinds, gunsmith, wardrobe);
    return true;
  }

  /**
   * The map as seen from above, for the minimap. Small props are left out — at
   * minimap scale they are noise, and what you actually navigate by is the
   * buildings and the cover you can hide behind.
   */
  private mapFootprint() {
    const half = getMap(this.mapKey).half;
    const out: HudSnap["radarWalls"] = [];
    for (const b of this.world.boxes) {
      const w = b.maxx - b.minx;
      const d = b.maxz - b.minz;
      if (b.maxy < 0.7 || w < 1.2 || d < 1.2) continue;
      // the arena's own boundary walls sit outside what the minimap shows
      if (b.minx > half || b.maxx < -half || b.minz > half || b.maxz < -half) continue;
      out.push({ x: b.minx, z: b.minz, w, d, tall: b.maxy > 4 });
    }
    return out;
  }

  /**
   * What the grapple may hook. Anything you could shoot is fair game — hooking
   * a body yanks it to you instead of pulling you to it.
   */
  private grappleTargets(): GrappleTarget[] {
    const out: GrappleTarget[] = [];
    for (const e of this.combat.enemies) {
      if (!e.alive) continue;
      out.push({
        center: e.center,
        alive: e.alive,
        yank: (toward) => {
          const to = new THREE.Vector3().subVectors(toward, e.pos);
          to.y = 0;
          const d = to.length() || 1;
          e.vel.addScaledVector(to.divideScalar(d), Math.min(26, d * 3));
          e.vel.y = Math.max(e.vel.y, 5);
          this.addScore(30, "YANKED");
        },
      });
    }
    for (const r of this.match.remotes.values()) {
      if (!r.alive) continue;
      out.push({ center: r.center, alive: r.alive });
    }
    return out;
  }

  /** Everything the local player may hurt, for streaks to pick from. */
  private streakTargets(): StreakTarget[] {
    const out: StreakTarget[] = [];
    for (const e of this.combat.enemies) {
      if (!e.alive) continue;
      out.push({
        pos: e.pos,
        center: e.center,
        alive: e.alive,
        hit: (amount) => {
          if (e.takeDamage(amount, this.player.eye, 3)) {
            this.combat.onEnemyKilled(e, this.player);
            this.onKill(e.def.name, e.def.score, false);
          }
        },
      });
    }
    for (const r of this.match.remotes.values()) {
      if (!r.alive || !this.match.canHurt(r.id)) continue;
      out.push({
        pos: r.pos,
        center: r.center,
        alive: r.alive,
        hit: (amount, crit) => this.match.reportHit(r.id, amount, this.player.eye, crit),
      });
    }
    return out;
  }

  /**
   * The kill cam. Not a replay — there is no recording — but the shot's own
   * origin looking back at your body, which is the part you actually want:
   * where they were standing and what they could see.
   */
  private killCamView(dt: number) {
    const cam = this.match.killCam;
    if (!cam || this.player.alive) {
      this.killCamT = 0;
      this.hud.killCam = null;
      return;
    }
    this.killCamT += dt;
    // pull back a little from the muzzle and drift in, so it reads as a shot
    const back = new THREE.Vector3().subVectors(cam.from, cam.at);
    const dist = back.length() || 1;
    back.divideScalar(dist);
    const ease = Math.min(1, this.killCamT * 0.6);
    const eye = cam.at.clone().addScaledVector(back, Math.min(dist, 3.5) + (1 - ease) * 2.5);
    eye.y += 1.4;
    this.R.camera.position.copy(eye);
    this.R.camera.lookAt(cam.at.x, cam.at.y + 0.9, cam.at.z);
    this.hud.killCam = { name: cam.name, hp: cam.hp, dist: Math.round(dist) };
  }

  /**
   * Pay out a ranked match once, when it ends. It reads the final board rather
   * than tallying as it goes, so a late disconnect cannot bank a better place
   * than the one you actually finished in.
   */
  private settleRank() {
    if (!this.ranked || this.rankedDone) return;
    if (this.match.state !== "over") return;
    this.rankedDone = true;
    const board = this.match.scoreboard();
    const mine = board.find((r) => r.id === this.match.myId);
    if (!mine) return;
    const place = board.indexOf(mine) + 1;
    const delta = srDelta({
      place,
      players: board.length,
      kills: mine.kills,
      deaths: mine.deaths,
      won: place === 1,
    });
    this.onRanked?.(delta, place, board.length);
  }

  /** Call in the operator skill, if it is charged. */
  useSkill() {
    return this.skills.use();
  }

  /** Swap the operator skill, e.g. during the post-respawn window. */
  setSkill(k: string) {
    this.skills.setKind(sanitizeSkill(k));
    this.player.grappleEnabled = this.skills.kind === "grappler";
  }

  /** Call in an earned streak. */
  useStreak(kind: StreakKind) {
    return this.streaks.use(kind);
  }

  /** 0 means uncapped; otherwise the shortest gap between frames, in ms. */
  private frameMin = 0;
  /** the map is dark, so the goggles are worth carrying */
  night = false;
  ranked = false;
  /** fires once when a ranked match ends, with what it was worth */
  onRanked: ((delta: number, place: number, players: number) => void) | null = null;
  private gogglesOn = false;
  private killCamT = 0;
  private rankedDone = false;

  setFpsCap(fps: number) {
    this.frameMin = fps > 0 ? 1000 / fps : 0;
  }

  /** Apply a graphics preset to a running game. */
  setQuality(q: Quality) {
    this.R.setQuality(q);
    this.combat.fx = QUALITY[q].fx;
    this.onResize();
  }
  private raf = 0;
  private last = 0;
  private msgT = 0;
  private tipT = 0;
  private feedId = 0;
  private running = false;
  private disposed = false;
  private onResize: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    mode: Mode,
    mapKey: string = DEFAULT_MAP,
    loadout?: WeaponKind[],
    gunsmith?: Gunsmith,
    wardrobe?: Wardrobe,
    skill?: string,
    night = false,
    ranked = false,
    sr = START_SR,
  ) {
    this.canvas = canvas;
    this.mode = mode;
    this.mapKey = mapKey;
    const saved = localStorage.getItem("doodle_quality");
    const quality: Quality = isQuality(saved) ? saved : "high";
    this.R = new InkRenderer(canvas, quality);
    this.night = night || mode === "zombies";
    this.R.night = this.night ? 1 : 0;
    this.input = new Input(canvas);
    this.best = Number(localStorage.getItem(mode === "zombies" ? "doodle_zbest" : "doodle_best") || 0);
    this.level = buildLevel(this.R.scene, this.world, mode, mapKey, this.night);
    this.combat = new Combat(this.world, this.R.scene, this.audio);
    const readInk = (key: string, fallback: number) => {
      const v = Number(localStorage.getItem(key));
      return Number.isInteger(v) && v >= 0 && v <= 5 ? v : fallback;
    };
    this.combat.hitInk = readInk("doodle_hit_ink", INK.RED);
    this.combat.tracerInk = readInk("doodle_tracer_ink", INK.ORANGE);
    this.combat.fx = QUALITY[quality].fx;
    this.player = new Player({
      world: this.world,
      input: this.input,
      audio: this.audio,
      camera: this.R.camera,
      scene: this.R.scene,
      onFire: (w, o, d, ads) => this.handleFire(w, o, d, ads),
      onSlash: (o, d, dmg, heavy) => this.handleSlash(o, d, dmg, heavy),
      onDeflect: (o, d, dmg) => this.handleDeflect(o, d, dmg),
      grappleTargets: () => this.grappleTargets(),
      tip: (t) => this.tip(t),
      onNade: (o, d, c) => this.combat.throwNade(o, d, c),
      onHurt: (_a, from) => this.handleHurt(from),
      onDeath: () => this.handleDeath(),
      loadout,
      gunsmith,
      wardrobe,
    });
    this.hud.radarWalls = this.mapFootprint();
    this.player.adsToggle = localStorage.getItem("doodle_ads_toggle") === "1";
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
            emote: this.player.emote,
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
        this.swapWindow = RESPAWN_SWAP;
        this.onState?.("playing");
      },
      spawnPoints: () => this.level.spawns,
      localPos: () => this.player.pos,
      localAlive: () => this.player.alive,
      mapExtent: () => getMap(this.mapKey).half,
      world: this.world,
      decoys: () => this.skills.liveDecoys(),
      hidden: () => this.skills.untargetable,
      localBody: () => ({
        pos: this.player.pos,
        center: this.player.center,
        headPos: this.player.eye,
        alive: this.player.alive,
      }),
      dropAt: (p, weapon, ids) => {
        const at = new THREE.Vector3(p[0], p[1], p[2]);
        this.combat.spawnPickup("ammo", at, { id: ids[0], life: DROP_LIFE });
        // only drop a gun we actually know about
        const kind = WEAPONS.find((w) => w.kind === weapon && w.isGun)?.kind;
        if (kind) {
          this.combat.spawnPickup("gun", at.clone().add(new THREE.Vector3(1.0, 0, 0.4)), {
            id: ids[1],
            weapon: kind,
            life: DROP_LIFE,
          });
        }
      },
      removeDrop: (id) => this.combat.removePickup(id),
      localWeapon: () => (this.player.weapon.def.isGun ? this.player.weapon.def.kind : null),
      spawnLoot: (items) => {
        for (const it of items) {
          this.combat.spawnPickup(it.kind, new THREE.Vector3(it.pos[0], it.pos[1], it.pos[2]));
        }
      },
      feed: (text, pts) => this.addScore(pts, text),
      announce: (m, s) => this.announce(m, s),
      changed: () => this.onNet?.(),
      localKill: () => this.streaks.addKill(),
    });
    this.ranked = ranked;
    // a ranked lobby fills with bots picked for your tier, not the house default
    if (ranked) this.match.botSkill = tierOf(sr).bots;
    // a hit on another player is reported to them; their client applies it
    this.combat.onRemoteHit = (t, dmg, crit) => this.match.reportHit(t.id, dmg, this.player.eye, crit);
    // a finisher: no health bar survives it, and it reads as its own event
    this.combat.onRemoteExecute = (t) => {
      this.match.reportHit(t.id, 500, this.player.eye, true);
      const name = this.match.roster.get(t.id)?.name ?? "them";
      this.addScore(150, `EXECUTED ${name}`);
      this.hitstopT = Math.max(this.hitstopT, 0.16);
      this.player.shake += 0.5;
      this.player.fovKick.kick(120);
      this.audio.crit();
    };
    this.combat.onPickupTaken = (id) => this.match.reportPickup(id);
    this.zoneView = new ZoneView(this.R.scene);
    this.skills = new Skills({
      scene: this.R.scene,
      world: this.world,
      hostiles: () => this.streakTargets(),
      eye: () => this.player.eye,
      pos: () => this.player.pos,
      forward: () => this.player.forward,
      yaw: () => this.player.yaw,
      boom: (at, r, d) => this.combat.explode(at, r, d, this.player),
      tracer: (a, b) => this.combat.tracer(a, b),
      announce: (main, sub) => this.announce(main, sub),
    });
    this.skills.setKind(sanitizeSkill(skill));
    this.player.grappleEnabled = this.skills.kind === "grappler";

    this.streaks = new Streaks({
      scene: this.R.scene,
      world: this.world,
      hostiles: () => this.streakTargets(),
      eye: () => this.player.eye,
      pos: () => this.player.pos,
      yaw: () => this.player.yaw,
      boom: (at, r, d) => this.combat.explode(at, r, d, this.player),
      tracer: (a, b) => this.combat.tracer(a, b),
      announce: (m, sub) => this.announce(m, sub),
      look: () => this.input.look,
    });
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
      this.player.meleeStreak += r.kill ? 1 : 0;
      this.hitstopT = heavy ? 0.08 : 0.04;
      this.player.weapon.bloody(r.kill ? 0.34 : 0.12);
    }
    if (r.kill) {
      // a slash can take several at once, so it scores as one swing rather than
      // going through onKill per body
      this.addScore(heavy ? 200 : 120, heavy ? "FOCUS SLASH" : "SLASH");
      this.kills += 1;
    }
  }

  /**
   * A shot the katana turned away. It goes back down its own path as a real
   * hitscan, so whoever fired it takes it — and the blade wears the result.
   */
  private handleDeflect(origin: THREE.Vector3, dir: THREE.Vector3, dmg: number) {
    this.combat.tracer(origin, origin.clone().addScaledVector(dir, 40));
    this.audio.parry();
    this.addScore(20, "DEFLECTED");
    for (const t of this.streakTargets()) {
      const to = new THREE.Vector3().subVectors(t.center, origin);
      const d = to.length();
      if (d > 42) continue;
      to.divideScalar(d);
      if (to.dot(dir) < 0.985) continue;
      if (!this.world.hasLineOfSight(origin, t.center)) continue;
      t.hit(dmg * 1.5, false);
      this.player.weapon.bloody(0.2);
      break;
    }
  }

  private onKill(name: string, pts: number, crit: boolean) {
    this.kills += 1;
    // the gun in hand earns its own progression, which is what unlocks camos
    this.onWeaponKill(this.player.weapon.def.kind);
    this.streaks.addKill();
    this.combo = Math.min(12, this.combo + 1);
    this.comboT = 2.6;
    this.addScore(pts, (crit ? "HEAD! " : "") + name);
    if (!this.player.weapon.def.isGun) this.player.meleeStreak += 1;
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
    // online you come back; the match, not the run, is what ends.
    // reportDeath does the announcing, because it knows who killed you.
    this.streaks.onDeath();
    this.skills.onDeath();
    if (this.match.inMatch) {
      this.match.reportDeath();
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
    // A cap saves battery on a phone that would otherwise render 120 frames it
    // cannot sustain. The slack keeps a 60Hz display from dropping to 30.
    if (this.frameMin > 0 && now - this.last < this.frameMin - 1) return;
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
      this.streaks.update(dt);
      this.skills.update(dt, this.input.down("fire"));
      this.player.weaponHidden = this.skills.overridesWeapon;
      this.player.setSkillModel(this.skills.overridesWeapon ? this.skills.kind : "");
      // the skill key doubles as the grapple key: whichever this loadout runs
      if (!this.player.grappleEnabled && this.input.pressed("grapple")) this.skills.use();
      if (this.night && this.input.pressed("goggles")) {
        this.gogglesOn = !this.gogglesOn;
        this.audio.ui();
        this.tip(this.gogglesOn ? "goggles down" : "goggles up");
      }
      this.R.nvg = damp(this.R.nvg, this.gogglesOn ? 1 : 0, 9, dt);
      this.hud.goggles = this.gogglesOn;
      this.hud.night = this.night;
      this.settleRank();
      this.player.frozen = this.streaks.piloting;
      const view = this.streaks.cameraView();
      if (view) {
        this.R.camera.position.copy(view.pos);
        this.R.camera.lookAt(view.look);
      } else {
        this.killCamView(dt);
      }
      this.combat.update(dt, this.player, this.time);
      for (const a of this.level.animated) a.update(this.time);

      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
      if (this.swapWindow > 0) this.swapWindow -= dt;

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

    // the radar only needs a dozen refreshes a second, not one per frame
    if (this.time - this.radarAt > 0.08) {
      this.radarAt = this.time;
      const blips: HudSnap["radar"] = [];
      // a UAV is what turns the minimap from "nearby" into "everyone"
      const reach = this.streaks.uavActive ? Infinity : 26;
      const near = (x: number, z: number) => Math.hypot(x - this.player.pos.x, z - this.player.pos.z) <= reach;
      for (const e of this.combat.enemies) {
        if (e.alive && near(e.pos.x, e.pos.z)) blips.push({ x: e.pos.x, z: e.pos.z, hostile: true });
      }
      for (const r of this.match.remotes.values()) {
        const friendly = !this.match.canHurt(r.id);
        // teammates always show; enemies need proximity or a UAV
        if (r.alive && (friendly || near(r.pos.x, r.pos.z))) {
          blips.push({ x: r.pos.x, z: r.pos.z, hostile: !friendly });
        }
      }
      this.hud.radar = blips;
      this.hud.radarSelf = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw };
      this.hud.radarHalf = getMap(this.mapKey).half;
    }

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
      kind: w.def.kind,
      ammo: w.def.isGun ? `${w.mag}/${w.reserve}` : "slash",
      active: i === this.player.weaponIndex,
      empty: w.def.isGun && w.mag <= 0 && w.reserve <= 0,
    }));
    this.hud.spread = 8 + wpn.spreadCur * 180;
    this.hud.ads = this.player.aiming;
    this.hud.melee = !wpn.def.isGun;
    this.hud.streakReady = this.streaks.available();
    this.hud.streak = this.streaks.streak;
    this.hud.uav = this.streaks.uavActive;
    this.hud.piloting = this.streaks.piloting;
    this.hud.grappleStam = this.player.grapple.stamina;
    this.hud.grappleOn = this.player.grapple.attached;
    this.hud.grappleAim = this.player.grapple.hasTarget;
    this.hud.skill = this.skills.kind;
    this.hud.skillCharge = this.skills.charge;
    this.hud.skillActive = this.skills.activeT;
    this.hud.skillReady = this.skills.ready;
    // spending anything — a bullet, a grenade, a swing — closes the window
    this.hud.canSwap =
      this.match.inMatch && this.player.alive && this.swapWindow > 0 && !this.player.spentResource;
    this.hud.boss = boss ? { name: boss.def.name, frac: clamp(boss.hp / boss.maxHp, 0, 1) } : null;
    this.hud.low = this.player.hp / this.player.maxHp < 0.3;
    this.hud.kills = this.kills;
    this.hud.time = this.time;
    this.hud.best = this.best;
    this.hud.mode = this.mode;
    this.hud.state = this.state;
    this.hud.waveLabel = this.mode === "zombies" ? "HORDE" : "WAVE";
    this.hud.focusFrac = clamp(this.player.meleeStreak / 3, 0, 1);
    this.hud.focusReady = this.player.meleeStreak >= 3;

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
    this.streaks.dispose();
    this.skills.dispose();
    this.player.grapple.dispose();
    this.zoneView.dispose(this.R.scene);
    disposeLevel(this.R.scene, this.level);
    this.R.dispose();
  }
}
