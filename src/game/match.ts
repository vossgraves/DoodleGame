// An online match: lobby, roster, scoring, and the snapshot pump.
//
// Authority is split the way a serverless P2P game has to split it:
//   - the host owns the roster, team assignment, match start/end and the score table
//   - each client owns its own body — damage dealt to you is sent *to* you and your
//     client applies it, so nobody can kill you on your screen without your agreement
//
// That trades cheat-resistance for not needing a server, which is the whole point.

import * as THREE from "three";
import { Net, type PeerMeta } from "./net";
import { RemotePlayer, encodeLocal, TEAM_INKS, FFA_INK, type Snapshot } from "./remote";
import { Bot, BOT_NAMES, type BotCandidate, type BotSkill } from "./bot";
import { raySphere, type World } from "./physics";

export type MatchMode = "ffa" | "tdm" | "br";
export type MatchState = "offline" | "lobby" | "playing" | "over";

/** kills to win; battle royale is last-one-standing instead */
export const SCORE_TARGET: Record<MatchMode, number> = { ffa: 25, tdm: 50, br: 0 };
export const RESPAWN_DELAY = 3.0;

/** how long you get before each closure, and what fraction of the map is left after */
const ZONE_PHASES = [
  { wait: 30, factor: 0.7 },
  { wait: 26, factor: 0.52 },
  { wait: 22, factor: 0.36 },
  { wait: 20, factor: 0.22 },
  { wait: 18, factor: 0.1 },
];
/** how long quick play hunts for a real lobby before falling back to bots */
export const MATCHMAKING_MS = 40_000;
const ZONE_CLOSE_SPEED = 2.6;
const ZONE_DPS = [3, 5, 8, 12, 18, 25];
const ZONE_TICK = 0.6;

export type LootKind = "ammo" | "hp" | "nade";
export interface LootItem {
  kind: LootKind;
  pos: [number, number, number];
}

export interface ZoneState {
  cx: number;
  cz: number;
  r: number;
  target: number;
  phase: number;
  wait: number;
  active: boolean;
}
/** 20 snapshots a second is plenty for figures this size */
const SNAPSHOT_HZ = 20;
const DROP_AFTER = 12;

export interface RosterRow {
  id: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
  /** battle royale only: eliminated, no respawn coming */
  out?: boolean;
  /** filled by the host rather than a person */
  bot?: boolean;
}

export interface MatchHooks {
  scene: THREE.Scene;
  /** encode the local player right now */
  snapshot: () => Snapshot;
  /** apply incoming damage to the local player */
  hurt: (amount: number, from: THREE.Vector3 | null) => void;
  /** put the local player back in the world */
  respawn: (pos: THREE.Vector3) => void;
  spawnPoints: () => THREE.Vector3[];
  localPos: () => THREE.Vector3;
  localAlive: () => boolean;
  /** half-extent of the current map, used to size the opening zone */
  mapExtent: () => number;
  spawnLoot: (items: LootItem[]) => void;
  /** bots need the collision world to walk and shoot through */
  world: World;
  /** the local player as something a bot can aim at */
  localBody: () => { pos: THREE.Vector3; center: THREE.Vector3; headPos: THREE.Vector3; alive: boolean };
  /** scatter what a fallen player left behind; ids are shared so drops match everywhere */
  dropAt: (pos: [number, number, number], weapon: string | null, ids: [number, number]) => void;
  removeDrop: (id: number) => void;
  /** the gun currently in the local player's hands, for their death drop */
  localWeapon: () => string | null;
  feed: (text: string, pts: number) => void;
  announce: (main: string, sub?: string) => void;
  /** roster/score/state changed — refresh any UI */
  changed: () => void;
  /** we got the kill; feeds the scorestreak counter */
  localKill: () => void;
}

export class MatchNet {
  net = new Net();
  hooks: MatchHooks;
  remotes = new Map<string, RemotePlayer>();
  roster = new Map<string, RosterRow>();
  mode: MatchMode = "ffa";
  state: MatchState = "offline";
  mapKey = "district";
  name = "doodle";
  status = "";
  winner: string | null = null;

  zone: ZoneState = { cx: 0, cz: 0, r: 0, target: 0, phase: 0, wait: 0, active: false };

  /** host only: the AI players filling out the match */
  bots = new Map<string, Bot>();
  /** rebuilt once a tick; every bot reads it many times per frame */
  private candidateCache: BotCandidate[] = [];
  botSkill: BotSkill = "regular";
  /** how many players the host wants in the match, bots making up the shortfall */
  fillTo = 0;

  private sendT = 0;
  private firing = false;
  private deadT = 0;
  private pendingRespawn = false;
  private zoneR0 = 0;
  private zoneSendT = 0;
  private zoneHurtT = 0;

  constructor(hooks: MatchHooks) {
    this.hooks = hooks;
    this.wire();
  }

  get online() {
    return this.net.active;
  }
  get inMatch() {
    return this.net.active && this.state === "playing";
  }
  get code() {
    return this.net.code;
  }
  get isHost() {
    return this.net.isHost;
  }
  get myId() {
    return this.net.id;
  }
  get myTeam() {
    return this.roster.get(this.net.id || "")?.team ?? 0;
  }

  /** Team of a peer; -1 when unknown. Used for friendly-fire checks. */
  teamOf(id: string) {
    return this.roster.get(id)?.team ?? -1;
  }

  /** In TDM you cannot hurt your own side. */
  canHurt(id: string) {
    if (this.mode !== "tdm") return true;
    const mine = this.myTeam;
    const theirs = this.teamOf(id);
    return theirs < 0 || theirs !== mine;
  }

  // ---- lobby lifecycle -------------------------------------------------

  private meta(): PeerMeta {
    return { name: this.name };
  }

  async host(isPublic: boolean, mapKey: string, mode: MatchMode) {
    this.mapKey = mapKey;
    this.mode = mode;
    const code = await this.net.host({ isPublic });
    this.state = "lobby";
    this.roster.clear();
    this.roster.set(this.net.id!, { id: this.net.id!, name: this.name, team: 0, kills: 0, deaths: 0 });
    this.broadcastLobby();
    this.hooks.changed();
    return code;
  }

  async join(code: string) {
    await this.net.join(code, this.meta());
    this.state = "lobby";
    this.hooks.changed();
    return this.net.code!;
  }

  async quickJoin() {
    await this.net.quickJoin(this.meta());
    this.state = "lobby";
    this.hooks.changed();
    return this.net.code!;
  }

  /**
   * Hunt for a real lobby, and if nobody answers inside the matchmaking window,
   * open one of our own and fill it with bots rather than leaving you waiting.
   */
  async quickPlay(onStatus?: (s: string) => void): Promise<"joined" | "bots"> {
    const deadline = Date.now() + MATCHMAKING_MS;
    let tries = 0;
    while (Date.now() < deadline) {
      tries++;
      onStatus?.(tries === 1 ? "looking for a lobby" : `still looking · attempt ${tries}`);
      try {
        await this.quickJoin();
        return "joined";
      } catch {
        /* nobody answered that round; keep knocking until the deadline */
      }
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 1200));
    }
    onStatus?.("no one about — bringing in bots");
    await this.host(true, this.mapKey, this.mode);
    this.fillTo = this.mode === "ffa" ? 8 : 10;
    return "bots";
  }

  leave() {
    this.clearBots();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.roster.clear();
    this.net.leave();
    this.state = "offline";
    this.status = "";
    this.winner = null;
    this.hooks.changed();
  }

  /** Host only: balance teams and drop everyone into the map. */
  start() {
    if (!this.net.isHost || this.state === "playing") return;
    if (this.fillTo > 0) this.fillWithBots();
    this.assignTeams();
    for (const r of this.roster.values()) {
      r.kills = 0;
      r.deaths = 0;
      r.out = false;
    }
    const spawns = this.shuffledSpawnIndices();
    const assign: Record<string, number> = {};
    let i = 0;
    for (const id of this.roster.keys()) assign[id] = spawns[i++ % spawns.length];
    const loot = this.mode === "br" ? this.makeLoot() : [];
    this.net.send("start", { map: this.mapKey, mode: this.mode, spawns: assign, roster: this.rosterRows(), loot });
    this.beginMatch(assign[this.net.id!] ?? 0, loot);
  }

  /** Scatter supplies around every spawn so a drop-in has something to find. */
  private makeLoot(): LootItem[] {
    const kinds: LootKind[] = ["ammo", "ammo", "hp", "nade"];
    const out: LootItem[] = [];
    for (const p of this.hooks.spawnPoints()) {
      for (let i = 0; i < 2; i++) {
        out.push({
          kind: kinds[Math.floor(Math.random() * kinds.length)],
          pos: [
            +(p.x + (Math.random() - 0.5) * 7).toFixed(1),
            +p.y.toFixed(1),
            +(p.z + (Math.random() - 0.5) * 7).toFixed(1),
          ],
        });
      }
    }
    return out;
  }

  private shuffledSpawnIndices() {
    const n = Math.max(1, this.hooks.spawnPoints().length);
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }

  private assignTeams() {
    if (this.mode !== "tdm") {
      for (const r of this.roster.values()) r.team = 0;
      return;
    }
    // alternate so the sides stay even as people join and leave
    let t = 0;
    for (const r of this.roster.values()) r.team = t++ % 2;
  }

  private beginMatch(spawnIndex: number, loot: LootItem[] = []) {
    this.state = "playing";
    this.winner = null;
    this.deadT = 0;
    this.pendingRespawn = false;
    const pts = this.hooks.spawnPoints();
    if (pts.length) this.hooks.respawn(pts[spawnIndex % pts.length].clone());
    this.applyTeamInks();

    if (this.mode === "br") {
      this.zoneR0 = this.hooks.mapExtent() * 1.35;
      this.zone = {
        cx: 0,
        cz: 0,
        r: this.zoneR0,
        target: this.zoneR0,
        phase: 0,
        wait: ZONE_PHASES[0].wait,
        active: true,
      };
      this.zoneSendT = 0;
      this.zoneHurtT = ZONE_TICK;
      if (loot.length) this.hooks.spawnLoot(loot);
      this.hooks.announce("BATTLE ROYALE", "last doodle on the page wins");
    } else {
      this.zone.active = false;
      this.hooks.announce(this.mode === "tdm" ? "TEAM DEATHMATCH" : "DEATHMATCH", `first to ${SCORE_TARGET[this.mode]}`);
    }
    this.hooks.changed();
  }

  // ---- bots --------------------------------------------------------------

  /** Everything a bot could shoot at: us, the real remotes, and the other bots. */
  private botCandidates(): BotCandidate[] {
    const out: BotCandidate[] = [];
    const myId = this.net.id;
    if (myId) {
      const body = this.hooks.localBody();
      out.push({
        id: myId,
        team: this.roster.get(myId)?.team ?? 0,
        alive: body.alive,
        pos: body.pos,
        center: body.center,
        headPos: body.headPos,
      });
    }
    for (const [id, r] of this.remotes) {
      // a bot's own RemotePlayer is presentation only; its Bot is the real thing
      if (this.bots.has(id)) continue;
      out.push({
        id,
        team: this.roster.get(id)?.team ?? 0,
        alive: r.alive,
        pos: r.pos,
        center: r.center,
        headPos: r.headPos,
      });
    }
    for (const [id, b] of this.bots) {
      out.push({ id, team: b.team, alive: b.alive, pos: b.pos, center: b.center, headPos: b.headPos });
    }
    return out;
  }

  /**
   * Resolve a bot's shot properly rather than assuming it connects — the aim
   * error in its skill profile is only meaningful if a miss can actually miss.
   */
  private botShoot(bot: Bot, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, targetId: string) {
    const t = this.candidateCache.find((c) => c.id === targetId);
    if (!t || !t.alive) return;
    const wall = this.hooks.world.raycast(origin, dir, 120);
    const limit = wall ? wall.dist : 120;
    const head = raySphere(origin, dir, t.headPos, 0.26, limit);
    const body = head === null ? raySphere(origin, dir, t.center, 0.42, limit) : null;
    if (head === null && body === null) return;
    const dmg = head !== null ? damage * 2.2 : damage;

    if (targetId === this.net.id) {
      this.hooks.hurt(dmg, origin.clone());
    } else if (this.bots.has(targetId)) {
      this.damageBot(targetId, dmg, bot.id);
    } else {
      this.net.sendTo(targetId, "pdmg", {
        amount: Math.round(dmg),
        from: [+origin.x.toFixed(1), +origin.y.toFixed(1), +origin.z.toFixed(1)],
        by: bot.id,
      });
    }
  }

  /** Host-side: apply damage to a bot and announce it if that killed them. */
  private damageBot(botId: string, amount: number, by: string) {
    const bot = this.bots.get(botId);
    if (!bot || !bot.alive) return;
    if (!this.canHurtBetween(this.teamOf(by), bot.team)) return;
    if (!bot.takeDamage(amount, by)) return;

    if (this.mode === "br") bot.respawns = false;
    const row = this.roster.get(botId);
    if (row) {
      row.deaths += 1;
      if (this.mode === "br") row.out = true;
    }
    const killer = this.roster.get(by);
    if (killer) killer.kills += 1;
    const drops = this.dropIds();
    const at: [number, number, number] = [+bot.pos.x.toFixed(1), +bot.pos.y.toFixed(1), +bot.pos.z.toFixed(1)];
    this.net.send("pdead", { killer: by, who: botId, at, gun: bot.dropWeapon, drops });
    this.hooks.dropAt(at, bot.dropWeapon, drops);
    if (by === this.net.id) {
      this.hooks.feed(`ERASED ${bot.name}`, 100);
      this.hooks.localKill();
    }
    else if (killer && row) this.hooks.feed(`${killer.name} erased ${row.name}`, 0);
    const rp = this.remotes.get(botId);
    if (rp) rp.alive = false;
    this.sendScores();
    this.checkWin();
    this.hooks.changed();
  }

  private canHurtBetween(a: number, b: number) {
    if (this.mode !== "tdm") return true;
    return a < 0 || b < 0 || a !== b;
  }

  /** Top the match up to fillTo with bots, balancing teams as it goes. */
  fillWithBots() {
    if (!this.net.isHost) return;
    const want = Math.max(0, this.fillTo - this.roster.size);
    const pool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < want; i++) {
      const id = `bot~${Math.random().toString(36).slice(2, 9)}`;
      const team = this.mode === "tdm" ? this.smallestTeam() : 0;
      const bot = new Bot(id, pool[i % pool.length], team, this.botSkill, {
        world: this.hooks.world,
        candidates: () => this.candidateCache,
        shoot: (b, o, d, dmg, tid) => this.botShoot(b, o, d, dmg, tid),
        spawnPoints: () => this.hooks.spawnPoints(),
        teamPlay: () => this.mode === "tdm",
      });
      bot.respawns = this.mode !== "br";
      // varied kit, so what they drop is worth walking over
      bot.dropWeapon = ["rifle", "carbine", "smg", "shotgun", "lmg", "revolver"][Math.floor(Math.random() * 6)];
      const pts = this.hooks.spawnPoints();
      if (pts.length) bot.spawn(pts[Math.floor(Math.random() * pts.length)].clone());
      this.bots.set(id, bot);
      this.roster.set(id, { id, name: bot.name, team, kills: 0, deaths: 0, bot: true });
      this.addRemote(id, bot.name, team);
    }
    if (want > 0) this.broadcastLobby();
  }

  /** Drop one bot so an arriving human can take its place. */
  private dropOneBot(): boolean {
    const first = this.bots.keys().next();
    if (first.done) return false;
    const id = first.value;
    this.bots.delete(id);
    this.roster.delete(id);
    this.removeRemote(id);
    this.net.broadcast("leave", { id });
    return true;
  }

  private clearBots() {
    for (const id of [...this.bots.keys()]) {
      this.roster.delete(id);
      this.removeRemote(id);
    }
    this.bots.clear();
  }

  /** How many are still in it (battle royale). */
  aliveCount() {
    let n = 0;
    for (const r of this.roster.values()) if (!r.out) n++;
    return n;
  }

  /**
   * Damage owed for standing outside the zone, batched onto a tick so the hurt
   * effects do not fire every frame. Returns 0 when safe.
   */
  zoneTick(dt: number, pos: THREE.Vector3) {
    if (this.mode !== "br" || !this.inMatch || !this.zone.active) return 0;
    const outside = Math.hypot(pos.x - this.zone.cx, pos.z - this.zone.cz) > this.zone.r;
    if (!outside) {
      this.zoneHurtT = ZONE_TICK;
      return 0;
    }
    this.zoneHurtT -= dt;
    if (this.zoneHurtT > 0) return 0;
    this.zoneHurtT = ZONE_TICK;
    return ZONE_DPS[Math.min(this.zone.phase, ZONE_DPS.length - 1)] * ZONE_TICK;
  }

  private applyTeamInks() {
    for (const [id, r] of this.remotes) {
      const row = this.roster.get(id);
      const ink = this.mode === "tdm" ? TEAM_INKS[(row?.team ?? 0) % TEAM_INKS.length] : FFA_INK;
      if (r.ink !== ink) {
        // rebuild in the new colour
        r.dispose();
        const fresh = new RemotePlayer(this.hooks.scene, id, row?.name || r.name, row?.team ?? 0, ink);
        this.remotes.set(id, fresh);
      }
    }
  }

  // ---- roster ----------------------------------------------------------

  private rosterRows(): RosterRow[] {
    return [...this.roster.values()].map((r) => ({ ...r }));
  }

  private broadcastLobby() {
    if (!this.net.isHost) return;
    this.net.send("lobby", {
      hostId: this.net.id,
      map: this.mapKey,
      mode: this.mode,
      isPublic: this.net.isPublic,
      players: this.rosterRows(),
    });
    this.hooks.changed();
  }

  private addRemote(id: string, name: string, team: number) {
    if (this.remotes.has(id)) return;
    const ink = this.mode === "tdm" ? TEAM_INKS[team % TEAM_INKS.length] : FFA_INK;
    this.remotes.set(id, new RemotePlayer(this.hooks.scene, id, name, team, ink));
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (r) r.dispose();
    this.remotes.delete(id);
  }

  /** Live list for the hitscan, refreshed each frame. */
  targets() {
    const out = [];
    for (const r of this.remotes.values()) if (this.canHurt(r.id)) out.push(r);
    return out;
  }

  scoreboard(): RosterRow[] {
    return [...this.roster.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  teamScores(): [number, number] {
    const t: [number, number] = [0, 0];
    for (const r of this.roster.values()) t[r.team % 2] += r.kills;
    return t;
  }

  // ---- messages --------------------------------------------------------

  private wire() {
    const net = this.net;

    net.onPeerJoin = (id, meta) => {
      // a person takes a bot's seat rather than growing the match
      if (this.bots.size) this.dropOneBot();
      const name = String((meta as { name?: string })?.name || "doodle").slice(0, 14);
      const team = this.mode === "tdm" ? this.smallestTeam() : 0;
      this.roster.set(id, { id, name, team, kills: 0, deaths: 0 });
      this.addRemote(id, name, team);
      this.broadcastLobby();
      if (this.state === "playing") {
        // late joiner: drop them straight in
        const pts = this.hooks.spawnPoints();
        net.sendTo(id, "start", {
          map: this.mapKey,
          mode: this.mode,
          late: true,
          spawns: { [id]: Math.floor(Math.random() * Math.max(1, pts.length)) },
          roster: this.rosterRows(),
        });
        this.hooks.feed(`${name} joined`, 0);
      }
    };

    net.onPeerLeave = (id) => {
      const nm = this.roster.get(id)?.name;
      this.roster.delete(id);
      this.removeRemote(id);
      this.broadcastLobby();
      if (this.state === "playing" && nm) this.hooks.feed(`${nm} left`, 0);
    };

    net.onDisconnect = () => {
      this.status = "the host left the lobby";
      this.leave();
    };

    net.on<{ reason?: string }>("refused", (d) => {
      this.status = d?.reason || "the lobby turned you away";
      this.leave();
    });

    net.on<{
      hostId: string;
      map: string;
      mode: MatchMode;
      players: RosterRow[];
    }>("lobby", (d) => {
      if (net.isHost) return;
      this.mapKey = d.map || this.mapKey;
      this.mode = d.mode || this.mode;
      this.roster.clear();
      for (const p of d.players) {
        this.roster.set(p.id, { ...p });
        if (p.id !== net.id) this.addRemote(p.id, p.name, p.team);
      }
      for (const id of [...this.remotes.keys()]) if (!this.roster.has(id)) this.removeRemote(id);
      this.hooks.changed();
    });

    net.on<{ id: string }>("leave", (d) => {
      this.roster.delete(d.id);
      this.removeRemote(d.id);
      this.hooks.changed();
    });

    net.on<{
      map: string;
      mode: MatchMode;
      spawns: Record<string, number>;
      roster: RosterRow[];
      loot?: LootItem[];
    }>("start", (d) => {
      if (net.isHost) return;
      this.mapKey = d.map || this.mapKey;
      this.mode = d.mode || this.mode;
      if (d.roster) {
        this.roster.clear();
        for (const p of d.roster) this.roster.set(p.id, { ...p });
      }
      this.beginMatch(d.spawns?.[net.id!] ?? 0, d.loot || []);
    });

    // the host owns the zone; everyone else just draws where it says
    net.on<ZoneState>("zone", (d) => {
      if (net.isHost || !d) return;
      this.zone = { ...d };
    });

    // a player snapshot, relayed to everyone
    net.on<Snapshot>("ps", (d, from) => {
      const r = this.remotes.get(from);
      if (r) r.push(d, performance.now() / 1000);
    });

    // every bot in one message rather than one message each
    net.on<{ i: string; s: Snapshot }[]>("bots", (list) => {
      if (net.isHost || !Array.isArray(list)) return;
      const now = performance.now() / 1000;
      for (const e of list) this.remotes.get(e.i)?.push(e.s, now);
    });

    // a client hit one of the host's bots
    net.on<{ bot: string; amount: number; by: string }>("botdmg", (d, from) => {
      if (!net.isHost || !d) return;
      this.damageBot(d.bot, Math.max(0, d.amount || 0), d.by || from);
    });

    // someone got to a drop first
    net.on<{ id: number }>("taken", (d) => {
      if (d && typeof d.id === "number") this.hooks.removeDrop(d.id);
    });

    // someone says they hit us; our client is the one that applies it
    net.on<{ amount: number; from: number[] | null; by: string; crit?: boolean }>("pdmg", (d, from) => {
      if (this.state !== "playing" || !this.hooks.localAlive()) return;
      const by = d.by || from;
      if (!this.canHurt(by)) return;
      const pos = d.from ? new THREE.Vector3(d.from[0], d.from[1], d.from[2]) : null;
      this.lastHitBy = by;
      this.hooks.hurt(Math.max(0, d.amount || 0), pos);
    });

    net.on<{
      killer: string;
      who?: string;
      how?: string;
      at?: [number, number, number];
      gun?: string | null;
      drops?: [number, number];
    }>("pdead", (d, from) => {
      // the host reports bot deaths on their behalf, so trust `who` when present
      const whoId = d.who || from;
      const victim = this.roster.get(whoId);
      // everyone spawns the same drops from the same ids, so no round trip is needed
      if (d.at && d.drops) this.hooks.dropAt(d.at, d.gun ?? null, d.drops);
      const killer = d.killer ? this.roster.get(d.killer) : null;
      if (victim) victim.deaths += 1;
      if (killer) killer.kills += 1;
      if (victim) {
        const vn = victim.name;
        if (d.killer === net.id) {
          this.hooks.feed(`ERASED ${vn}`, 100);
          this.hooks.localKill();
        } else if (killer) {
          this.hooks.feed(`${killer.name} erased ${vn}`, 0);
        } else {
          this.hooks.feed(`${vn} was erased`, 0);
        }
      }
      const r = this.remotes.get(whoId);
      if (r) r.alive = false;
      if (this.mode === "br" && victim) victim.out = true;
      if (net.isHost) {
        this.sendScores();
        this.checkWin();
      }
      this.hooks.changed();
    });

    net.on<RosterRow[]>("score", (rows) => {
      if (net.isHost) return;
      for (const row of rows) {
        const cur = this.roster.get(row.id);
        if (cur) Object.assign(cur, row);
        else this.roster.set(row.id, { ...row });
      }
      this.hooks.changed();
    });

    net.on<{ id: string | null; team?: number }>("end", (d) => {
      this.endMatch(d);
    });

    net.on("startreq", () => {
      if (net.isHost && this.state === "lobby") this.start();
    });
  }

  lastHitBy: string | null = null;

  private smallestTeam() {
    let a = 0;
    let b = 0;
    for (const r of this.roster.values()) r.team === 0 ? a++ : b++;
    return a <= b ? 0 : 1;
  }

  private sendScores() {
    if (!this.net.isHost) return;
    this.net.send("score", this.rosterRows());
  }

  private checkWin() {
    if (!this.net.isHost || this.state !== "playing") return;
    if (this.mode === "br") {
      // a lobby of one is a practice run, not a won match
      if (this.roster.size < 2) return;
      const standing = [...this.roster.values()].filter((r) => !r.out);
      if (standing.length <= 1) {
        const w = standing[0] || null;
        this.net.send("end", { id: w?.id ?? null });
        this.endMatch({ id: w?.id ?? null });
      }
      return;
    }
    const target = SCORE_TARGET[this.mode];
    if (this.mode === "tdm") {
      const [a, b] = this.teamScores();
      if (a >= target || b >= target) {
        const team = a >= target ? 0 : 1;
        this.net.send("end", { id: null, team });
        this.endMatch({ id: null, team });
      }
      return;
    }
    const top = this.scoreboard()[0];
    if (top && top.kills >= target) {
      this.net.send("end", { id: top.id });
      this.endMatch({ id: top.id });
    }
  }

  private endMatch(d: { id: string | null; team?: number }) {
    this.state = "over";
    if (this.mode === "tdm" && d.team != null) {
      this.winner = `TEAM ${d.team === 0 ? "BLUE" : "RED"}`;
      const mine = this.myTeam === d.team;
      this.hooks.announce(mine ? "YOUR TEAM WINS" : "YOUR TEAM LOSES", "");
    } else {
      const w = d.id ? this.roster.get(d.id) : null;
      this.winner = w?.name || "nobody";
      this.hooks.announce(d.id === this.net.id ? "YOU WIN" : `${this.winner} WINS`, "");
    }
    this.hooks.changed();
  }

  /** Host only: throw everyone back to the lobby for another round. */
  backToLobby() {
    if (!this.net.isHost) return;
    this.state = "lobby";
    this.winner = null;
    this.net.send("lobby", {
      hostId: this.net.id,
      map: this.mapKey,
      mode: this.mode,
      isPublic: this.net.isPublic,
      players: this.rosterRows(),
    });
    this.hooks.changed();
  }

  requestStart() {
    if (this.net.isHost) this.start();
    else this.net.send("startreq");
  }

  // ---- per-frame -------------------------------------------------------

  /** Report a hit we landed on another player. */
  reportHit(id: string, amount: number, fromPos: THREE.Vector3, crit: boolean) {
    if (!this.inMatch) return;
    // bots live on the host, so their damage goes there rather than to a peer
    if (this.roster.get(id)?.bot) {
      if (this.net.isHost) this.damageBot(id, amount, this.net.id!);
      else this.net.send("botdmg", { bot: id, amount: Math.round(amount), by: this.net.id });
      return;
    }
    this.net.sendTo(id, "pdmg", {
      amount: Math.round(amount),
      from: [+fromPos.x.toFixed(1), +fromPos.y.toFixed(1), +fromPos.z.toFixed(1)],
      by: this.net.id,
      crit,
    });
  }

  /** The local player died; tell everyone and start the respawn clock. */
  /** Two ids from one random base, so both drops are unique across clients. */
  private dropIds(): [number, number] {
    const base = Math.floor(Math.random() * 1e9);
    return [base, base + 1];
  }

  /** Someone walked over a drop; make it vanish for everyone else too. */
  reportPickup(id: number) {
    if (this.net.active) this.net.broadcast("taken", { id });
  }

  reportDeath() {
    if (!this.inMatch) return;
    const killer = this.lastHitBy;
    const p = this.hooks.localPos();
    const drops = this.dropIds();
    const gun = this.hooks.localWeapon();
    const at: [number, number, number] = [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)];
    this.net.broadcast("pdead", { killer, at, gun, drops });
    // drop our own kit locally as well; the message does not come back to us
    this.hooks.dropAt(at, gun, drops);
    const me = this.roster.get(this.net.id!);
    if (me) me.deaths += 1;
    const k = killer ? this.roster.get(killer) : null;
    if (k) k.kills += 1;
    if (this.net.isHost) {
      this.sendScores();
      this.checkWin();
    }
    this.lastHitBy = null;
    this.deadT = 0;
    // battle royale has no second chances
    // name whoever did it, the way a kill cam would
    const byName = k?.name;
    if (this.mode === "br") {
      if (me) me.out = true;
      this.pendingRespawn = false;
      this.hooks.announce("ERASED", byName ? `${byName} put you out` : "you are out");
      if (this.net.isHost) this.checkWin();
    } else {
      this.pendingRespawn = true;
      this.hooks.announce("ERASED", byName ? `by ${byName}` : "back on the page shortly");
    }
    this.hooks.changed();
  }

  markFiring() {
    this.firing = true;
  }

  update(dt: number) {
    if (!this.net.active) return;
    const now = performance.now() / 1000;

    for (const r of this.remotes.values()) {
      r.update(dt, now);
      if (r.lastSeen && now - r.lastSeen > DROP_AFTER) r.parts.root.visible = false;
    }

    if (this.state !== "playing") return;

    // the host drives the zone and tells everyone else where it is
    if (this.mode === "br" && this.zone.active && this.net.isHost) {
      const z = this.zone;
      z.wait -= dt;
      if (z.wait <= 0 && z.phase < ZONE_PHASES.length) {
        z.target = this.zoneR0 * ZONE_PHASES[z.phase].factor;
        z.phase += 1;
        z.wait = ZONE_PHASES[Math.min(z.phase, ZONE_PHASES.length - 1)].wait;
        this.hooks.announce("THE PAGE CURLS IN", "get inside the ink");
      }
      if (z.r > z.target) z.r = Math.max(z.target, z.r - ZONE_CLOSE_SPEED * dt);
      this.zoneSendT -= dt;
      if (this.zoneSendT <= 0) {
        this.zoneSendT = 0.5;
        this.net.send("zone", { ...z });
      }
    }

    // respawn the local player after a beat, as far from everyone else as we can
    if (this.pendingRespawn) {
      this.deadT += dt;
      if (this.deadT >= RESPAWN_DELAY) {
        this.pendingRespawn = false;
        this.hooks.respawn(this.farthestSpawn());
        this.hooks.announce("BACK ON THE PAGE", "");
      }
    }

    // the host runs the bots every frame, but only ships them at snapshot rate
    if (this.net.isHost && this.bots.size) {
      this.candidateCache = this.botCandidates();
      for (const b of this.bots.values()) b.update(dt);
    }

    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / SNAPSHOT_HZ;
      this.net.broadcast("ps", this.hooks.snapshot());
      this.firing = false;

      if (this.net.isHost && this.bots.size) {
        const now = performance.now() / 1000;
        const batch: { i: string; s: Snapshot }[] = [];
        for (const [id, b] of this.bots) {
          const s = encodeLocal(b, b.firing);
          batch.push({ i: id, s });
          // the host draws its own bots through the same interpolation path
          this.remotes.get(id)?.push(s, now);
        }
        this.net.send("bots", batch);
      }
    }
  }

  get isFiring() {
    return this.firing;
  }

  private farthestSpawn() {
    const pts = this.hooks.spawnPoints();
    if (!pts.length) return new THREE.Vector3();
    const others = [...this.remotes.values()].filter((r) => r.alive).map((r) => r.pos);
    if (!others.length) return pts[Math.floor(Math.random() * pts.length)].clone();
    let best = pts[0];
    let bestD = -1;
    for (const p of pts) {
      let nearest = Infinity;
      for (const o of others) nearest = Math.min(nearest, p.distanceToSquared(o));
      if (nearest > bestD) {
        bestD = nearest;
        best = p;
      }
    }
    return best.clone();
  }
}
