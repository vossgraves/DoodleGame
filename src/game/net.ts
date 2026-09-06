// Peer-to-peer transport over WebRTC.
//
// There is no game server. The host player's browser is the authority and every
// other player connects straight to it, which is what lets online play work from
// a plain static deploy.
//
// A lobby code *is* the host's peer id. Private lobbies take a random 5-letter
// code; public lobbies claim one of a handful of well-known slots (PUB0..PUB7)
// so quick play can knock on every slot at once — a directory with no directory
// server. A connection only counts once the host answers with a welcome, so a
// full or closed lobby is skipped rather than hung on.

import Peer, { type DataConnection } from "peerjs";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const isLocal = typeof location !== "undefined" && LOCAL_HOST.test(location.hostname);
/** dev servers get their own namespace so testing never wanders into a live lobby */
const PREFIX = isLocal ? "doodledev-" : "doodledistrict-";

const PUBLIC_SLOTS = 8;
/** no I/O/0/1 — these get read aloud and typed in by hand */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

const SIGNAL_TIMEOUT = 12_000;
const JOIN_TIMEOUT = 14_000;
const QUICK_TIMEOUT = 11_000;

export const makeCode = () =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

export interface NetMessage {
  t: string;
  d?: unknown;
  from?: string;
  to?: string;
  relay?: boolean;
}

export interface PeerMeta {
  name?: string;
  [k: string]: unknown;
}

type Handler = (data: never, from: string) => void;

/**
 * Signalling defaults to the public PeerJS broker. Tests and self-hosted
 * deployments can point it elsewhere without touching the code.
 */
function peerOptions() {
  const opts: ConstructorParameters<typeof Peer>[1] = {
    debug: 0,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
    },
  };
  try {
    const host = localStorage.getItem("doodle_peer_host");
    if (host) {
      opts.host = host;
      opts.port = Number(localStorage.getItem("doodle_peer_port") || 9000);
      opts.path = localStorage.getItem("doodle_peer_path") || "/";
      opts.secure = localStorage.getItem("doodle_peer_secure") === "1";
    }
  } catch {
    /* storage unavailable; stay on the public broker */
  }
  return opts;
}

/** PeerJS reports an unreachable peer by name only inside the error text. */
const idFromError = (err: unknown) => {
  const m = /peer\s+(\S+)/.exec(String((err as Error)?.message || ""));
  return m ? m[1] : null;
};
const errType = (err: unknown) => (err as { type?: string })?.type;

export class Net {
  peer: Peer | null = null;
  conns = new Map<string, DataConnection>();
  isHost = false;
  isPublic = false;
  accepting = true;
  connected = false;
  /** 10 so team deathmatch can run a full 5v5; the host relays for everyone else */
  maxPlayers = 10;
  id: string | null = null;
  code: string | null = null;
  hostId: string | null = null;

  onPeerJoin: ((id: string, meta: PeerMeta) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  private handlers = new Map<string, Handler>();
  private leaving = false;

  get active() {
    return !!this.peer && this.connected;
  }
  get peerIds() {
    return [...this.conns.keys()];
  }
  get playerCount() {
    return this.conns.size + 1;
  }

  on<T>(type: string, fn: (data: T, from: string) => void) {
    this.handlers.set(type, fn as Handler);
  }

  private emit(type: string, data: unknown, from: string) {
    const h = this.handlers.get(type);
    if (h) (h as (d: unknown, f: string) => void)(data, from);
  }

  private newPeer(id: string | null): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error("signalling server timed out"));
      }, SIGNAL_TIMEOUT);
      peer.on("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(peer);
      });
      peer.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      });
    });
  }

  private wire(conn: DataConnection) {
    conn.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;
      this.route(msg as NetMessage, conn.peer);
    });
    conn.on("close", () => this.drop(conn.peer));
    conn.on("error", () => this.drop(conn.peer));
  }

  private drop(pid: string) {
    if (this.leaving || !this.conns.has(pid)) return;
    this.conns.delete(pid);
    if (this.isHost) {
      this.onPeerLeave?.(pid);
      this.broadcast("leave", { id: pid });
    } else if (pid === this.hostId) {
      this.connected = false;
      this.onDisconnect?.();
    }
  }

  private route(msg: NetMessage, from: string) {
    // clients can address each other; the host forwards on their behalf
    if (this.isHost && msg.to && msg.to !== this.id) {
      const c = this.conns.get(msg.to);
      if (c?.open) c.send(msg);
      return;
    }
    if (this.isHost && msg.relay) {
      for (const [pid, c] of this.conns) if (pid !== from && c.open) c.send({ t: msg.t, d: msg.d, from });
    }
    this.emit(msg.t, msg.d, msg.from || from);
  }

  private keepAlive(peer: Peer) {
    peer.on("disconnected", () => {
      if (this.peer === peer && !peer.destroyed) {
        try {
          peer.reconnect();
        } catch {
          /* the next heartbeat will try again */
        }
      }
    });
  }

  // ---- hosting ----

  async host({ isPublic = false, code = null }: { isPublic?: boolean; code?: string | null } = {}) {
    this.leave();
    this.isHost = true;
    this.isPublic = isPublic;

    if (code) {
      this.code = code.toUpperCase();
      this.peer = await this.newPeer(PREFIX + this.code);
    } else if (isPublic) {
      for (let slot = 0; slot < PUBLIC_SLOTS; slot++) {
        try {
          this.peer = await this.newPeer(`${PREFIX}PUB${slot}`);
          this.code = `PUB${slot}`;
          break;
        } catch (e) {
          if (errType(e) !== "unavailable-id") throw e;
        }
      }
      if (!this.peer) throw new Error("all public lobbies are busy — host a private one");
    } else {
      for (let tries = 0; tries < 3 && !this.peer; tries++) {
        this.code = makeCode();
        try {
          this.peer = await this.newPeer(PREFIX + this.code);
        } catch (e) {
          if (errType(e) !== "unavailable-id" || tries === 2) throw e;
        }
      }
    }
    if (!this.peer) throw new Error("could not open a lobby");

    this.id = this.peer.id;
    this.hostId = this.id;
    this.connected = true;
    this.accepting = true;

    this.peer.on("connection", (conn) => {
      conn.on("open", () => {
        if (!this.accepting || this.conns.size >= this.maxPlayers - 1) {
          conn.send({ t: "refused", d: { reason: this.accepting ? "that lobby is full" : "that lobby is closed" } });
          setTimeout(() => {
            try {
              conn.close();
            } catch {
              /* already gone */
            }
          }, 400);
          return;
        }
        this.conns.set(conn.peer, conn);
        this.wire(conn);
        conn.send({ t: "welcome", d: { hostId: this.id, code: this.code, isPublic: this.isPublic }, from: this.id });
        this.onPeerJoin?.(conn.peer, (conn.metadata || {}) as PeerMeta);
      });
    });
    this.keepAlive(this.peer);
    return this.code as string;
  }

  // ---- joining ----

  async join(code: string, meta: PeerMeta = {}) {
    this.leave();
    this.isHost = false;
    const c = String(code || "").trim().toUpperCase();
    if (!c) throw new Error("enter a lobby code");
    this.peer = await this.newPeer(null);
    this.id = this.peer.id;
    this.keepAlive(this.peer);
    const hostId = PREFIX + c;
    const { conn, welcome } = await this.knock(hostId, meta, JOIN_TIMEOUT);
    this.adopt(hostId, conn, welcome);
    this.code = c;
    return c;
  }

  /** Knock on every public slot at once and take the first host that answers. */
  async quickJoin(meta: PeerMeta = {}) {
    this.leave();
    this.isHost = false;
    this.peer = await this.newPeer(null);
    this.id = this.peer.id;
    this.keepAlive(this.peer);
    const peer = this.peer;

    const ids = Array.from({ length: PUBLIC_SLOTS }, (_, i) => `${PREFIX}PUB${i}`);
    const winner = await new Promise<{ conn: DataConnection; hostId: string; welcome: unknown } | null>((resolve) => {
      const attempts: { conn: DataConnection; hostId: string; done: boolean }[] = [];
      let pending = ids.length;
      let done = false;

      const settle = (val: { conn: DataConnection; hostId: string; welcome: unknown } | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off("error", onErr);
        for (const a of attempts) {
          if (!val || a.conn !== val.conn) {
            try {
              a.conn.close();
            } catch {
              /* never opened */
            }
          }
        }
        resolve(val);
      };
      const failOne = (a: { done: boolean }) => {
        if (a.done) return;
        a.done = true;
        if (--pending <= 0) settle(null);
      };
      const onErr = (err: unknown) => {
        if (errType(err) !== "peer-unavailable") return;
        const a = attempts.find((x) => x.hostId === idFromError(err));
        if (a) failOne(a);
      };
      peer.on("error", onErr);
      const timer = setTimeout(() => settle(null), QUICK_TIMEOUT);

      for (const hostId of ids) {
        let conn: DataConnection;
        try {
          conn = peer.connect(hostId, { reliable: true, serialization: "json", metadata: meta });
        } catch {
          pending--;
          continue;
        }
        const a = { conn, hostId, done: false };
        attempts.push(a);
        conn.on("data", (msg) => {
          const m = msg as NetMessage;
          if (!m) return;
          if (m.t === "welcome") {
            a.done = true;
            settle({ conn, hostId, welcome: m.d });
          } else if (m.t === "refused") failOne(a);
        });
        conn.on("error", () => failOne(a));
        conn.on("close", () => failOne(a));
      }
      if (pending <= 0) settle(null);
    });

    if (!winner) {
      this.leave();
      throw new Error("no open public lobbies");
    }
    this.adopt(winner.hostId, winner.conn, winner.welcome);
    this.code = winner.hostId.slice(PREFIX.length);
    return this.code;
  }

  private knock(hostId: string, meta: PeerMeta, timeoutMs: number) {
    return new Promise<{ conn: DataConnection; welcome: unknown }>((resolve, reject) => {
      const peer = this.peer;
      if (!peer) return reject(new Error("not connected"));
      let conn: DataConnection;
      try {
        conn = peer.connect(hostId, { reliable: true, serialization: "json", metadata: meta });
      } catch {
        return reject(new Error("could not start a connection"));
      }
      let done = false;
      const finish = (err: Error | null, val?: { conn: DataConnection; welcome: unknown }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off("error", onErr);
        if (err) {
          try {
            conn.close();
          } catch {
            /* never opened */
          }
          reject(err);
        } else resolve(val!);
      };
      const timer = setTimeout(() => finish(new Error("no answer from that lobby")), timeoutMs);
      const onErr = (err: unknown) => {
        if (errType(err) === "peer-unavailable" && idFromError(err) === hostId) {
          finish(new Error("no lobby with that code"));
        }
      };
      peer.on("error", onErr);
      conn.on("data", (msg) => {
        const m = msg as NetMessage;
        if (!m) return;
        if (m.t === "welcome") finish(null, { conn, welcome: m.d });
        else if (m.t === "refused") finish(new Error((m.d as { reason?: string })?.reason || "the lobby turned you away"));
      });
      conn.on("error", () => finish(new Error("could not connect")));
      conn.on("close", () => finish(new Error("the lobby closed the connection")));
    });
  }

  private adopt(hostId: string, conn: DataConnection, welcome: unknown) {
    this.hostId = hostId;
    this.conns.set(hostId, conn);
    this.connected = true;
    this.isPublic = !!(welcome as { isPublic?: boolean })?.isPublic;
    this.wire(conn);
  }

  leave() {
    // closing our own connections must not look like everyone else leaving
    this.leaving = true;
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* already closed */
      }
    }
    this.conns.clear();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        /* already destroyed */
      }
    }
    this.peer = null;
    this.connected = false;
    this.isHost = false;
    this.id = null;
    this.code = null;
    this.hostId = null;
    this.leaving = false;
  }

  // ---- messaging ----

  /** host: to everyone. client: to the host, and on to everyone if relay is set. */
  send(type: string, data?: unknown, relay = false) {
    if (this.isHost) {
      const m: NetMessage = { t: type, d: data, from: this.id! };
      for (const c of this.conns.values()) if (c.open) c.send(m);
    } else {
      const c = this.conns.get(this.hostId!);
      if (c?.open) c.send({ t: type, d: data, relay });
    }
  }

  broadcast(type: string, data?: unknown) {
    this.send(type, data, true);
  }

  sendTo(pid: string, type: string, data?: unknown) {
    if (this.isHost) {
      const c = this.conns.get(pid);
      if (c?.open) c.send({ t: type, d: data, from: this.id });
    } else {
      const c = this.conns.get(this.hostId!);
      if (c?.open) c.send({ t: type, d: data, to: pid, from: this.id });
    }
  }
}
