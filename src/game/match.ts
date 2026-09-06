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
import { RemotePlayer, TEAM_INKS, FFA_INK, type Snapshot } from "./remote";

export type MatchMode = "ffa" | "tdm";
export type MatchState = "offline" | "lobby" | "playing" | "over";

export const SCORE_TARGET: Record<MatchMode, number> = { ffa: 25, tdm: 50 };
export const RESPAWN_DELAY = 3.0;
/** 20 snapshots a second is plenty for figures this size */
const SNAPSHOT_HZ = 20;
const DROP_AFTER = 12;

export interface RosterRow {
  id: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
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
  feed: (text: string, pts: number) => void;
  announce: (main: string, sub?: string) => void;
  /** roster/score/state changed — refresh any UI */
  changed: () => void;
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

  private sendT = 0;
  private firing = false;
  private deadT = 0;
  private pendingRespawn = false;

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

  leave() {
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
    this.assignTeams();
    for (const r of this.roster.values()) {
      r.kills = 0;
      r.deaths = 0;
    }
    const spawns = this.shuffledSpawnIndices();
    const assign: Record<string, number> = {};
    let i = 0;
    for (const id of this.roster.keys()) assign[id] = spawns[i++ % spawns.length];
    this.net.send("start", { map: this.mapKey, mode: this.mode, spawns: assign, roster: this.rosterRows() });
    this.beginMatch(assign[this.net.id!] ?? 0);
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

  private beginMatch(spawnIndex: number) {
    this.state = "playing";
    this.winner = null;
    this.deadT = 0;
    this.pendingRespawn = false;
    const pts = this.hooks.spawnPoints();
    if (pts.length) this.hooks.respawn(pts[spawnIndex % pts.length].clone());
    this.applyTeamInks();
    this.hooks.announce(this.mode === "tdm" ? "TEAM DEATHMATCH" : "DEATHMATCH", `first to ${SCORE_TARGET[this.mode]}`);
    this.hooks.changed();
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

    net.on<{ map: string; mode: MatchMode; spawns: Record<string, number>; roster: RosterRow[] }>("start", (d) => {
      if (net.isHost) return;
      this.mapKey = d.map || this.mapKey;
      this.mode = d.mode || this.mode;
      if (d.roster) {
        this.roster.clear();
        for (const p of d.roster) this.roster.set(p.id, { ...p });
      }
      this.beginMatch(d.spawns?.[net.id!] ?? 0);
    });

    // a player snapshot, relayed to everyone
    net.on<Snapshot>("ps", (d, from) => {
      const r = this.remotes.get(from);
      if (r) r.push(d, performance.now() / 1000);
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

    net.on<{ killer: string; how?: string }>("pdead", (d, from) => {
      const victim = this.roster.get(from);
      const killer = d.killer ? this.roster.get(d.killer) : null;
      if (victim) victim.deaths += 1;
      if (killer) killer.kills += 1;
      if (victim) {
        const vn = victim.name;
        if (d.killer === net.id) {
          this.hooks.feed(`ERASED ${vn}`, 100);
        } else if (killer) {
          this.hooks.feed(`${killer.name} erased ${vn}`, 0);
        } else {
          this.hooks.feed(`${vn} was erased`, 0);
        }
      }
      const r = this.remotes.get(from);
      if (r) r.alive = false;
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
    this.net.sendTo(id, "pdmg", {
      amount: Math.round(amount),
      from: [+fromPos.x.toFixed(1), +fromPos.y.toFixed(1), +fromPos.z.toFixed(1)],
      by: this.net.id,
      crit,
    });
  }

  /** The local player died; tell everyone and start the respawn clock. */
  reportDeath() {
    if (!this.inMatch) return;
    const killer = this.lastHitBy;
    this.net.broadcast("pdead", { killer });
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
    this.pendingRespawn = true;
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

    // respawn the local player after a beat, as far from everyone else as we can
    if (this.pendingRespawn) {
      this.deadT += dt;
      if (this.deadT >= RESPAWN_DELAY) {
        this.pendingRespawn = false;
        this.hooks.respawn(this.farthestSpawn());
        this.hooks.announce("BACK ON THE PAGE", "");
      }
    }

    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / SNAPSHOT_HZ;
      this.net.broadcast("ps", this.hooks.snapshot());
      this.firing = false;
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
