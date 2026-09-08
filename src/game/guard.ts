/**
 * What a peer is allowed to say.
 *
 * There is no such thing as browser anti-cheat that runs on the cheater's
 * machine — they own the runtime, so anything we ship to them, they can delete.
 * What can be defended is the wire. Every message another player sends arrives
 * here first, and this decides whether it is even a well-formed thing to say,
 * whether that player is entitled to say it, and whether they have said it more
 * often than the game physically allows.
 *
 * Two rules keep it honest:
 *
 * - Never infer cheating from aim or movement. A good player on a bad
 *   connection looks exactly like an aimbot to a heuristic, and banning them is
 *   worse than missing a cheat.
 * - One bad second is never a verdict. A tab that was backgrounded flushes a
 *   burst of queued messages on the way back; that is a backlog, not a hack. It
 *   takes three separate bad periods spread over at least twelve seconds.
 */

/** Types only the host may originate. A peer claiming one is spoofing. */
export const HOST_ONLY = new Set(["lobby", "start", "end", "leave", "score", "taken", "bots", "zone", "refused"]);
/** Types a peer may ask the host to pass on to everyone. */
const RELAYABLE = new Set(["ps", "pdead", "chat"]);
/** Types a peer may address to one other player. */
const DIRECTED = new Set(["pdmg", "botdmg"]);

/**
 * The most one hit of each weapon can ever take off, and how many hits of it
 * can land in two seconds. Both come from the weapon table with headroom for a
 * headshot and every attachment stacked.
 */
export const HIT_CAP: Record<string, [number, number]> = {
  rifle: [70, 26],
  carbine: [72, 22],
  smg: [56, 34],
  lmg: [66, 26],
  shotgun: [150, 12],
  sniper: [260, 6],
  revolver: [180, 10],
  pistol: [70, 16],
  knife: [130, 10],
  katana: [200, 9],
  grenade: [160, 6],
  streak: [300, 10],
  // a finisher is an instant kill by design; the limit is how often, not how hard
  execute: [500, 4],
};

const obj = (d: unknown): d is Record<string, unknown> => !!d && typeof d === "object" && !Array.isArray(d);
const nums = (d: unknown, n: number): d is number[] => Array.isArray(d) && d.length === n && d.every(Number.isFinite);
const id = (d: unknown) => typeof d === "string" && d.length > 0 && d.length <= 200;
const str = (d: unknown, max: number) => typeof d === "string" && d.length <= max;

export interface PeerMsg {
  t?: unknown;
  d?: unknown;
  to?: unknown;
  from?: unknown;
  relay?: unknown;
}

/**
 * Is this a well-formed thing for a peer to have sent? Shape only — nothing
 * here knows the state of the match.
 */
export function validPeerMessage(m: PeerMsg): boolean {
  if (!obj(m) || typeof m.t !== "string") return false;
  if (HOST_ONLY.has(m.t)) return false;
  if (m.to != null && (!DIRECTED.has(m.t) || !id(m.to))) return false;
  if (m.relay && !RELAYABLE.has(m.t)) return false;
  const d = m.d;

  // a position snapshot: twelve numbers, with the flag word and emote in range
  if (m.t === "ps") {
    return nums(d, 12) && Number.isInteger(d[6]) && d[6] >= 0 && d[6] < 256 && Number.isInteger(d[11]) && d[11] >= 0 && d[11] < 32;
  }
  if (!obj(d)) return m.t === "startreq";
  switch (m.t) {
    case "pdmg":
      return (
        typeof d.by === "string" &&
        Number.isFinite(d.amount) &&
        (d.amount as number) > 0 &&
        (d.from == null || nums(d.from, 3))
      );
    case "botdmg":
      return id(d.bot) && Number.isFinite(d.amount) && (d.amount as number) > 0 && id(d.by);
    case "pdead":
      return (d.killer == null || id(d.killer)) && (d.at == null || nums(d.at, 3)) && (d.gun == null || str(d.gun, 24));
    case "chat":
      return str(d.text, 160) && typeof d.team === "boolean";
    case "startreq":
      return true;
    default:
      return false;
  }
}

/**
 * Sliding windows, bounded so a flood cannot grow the logs without limit.
 */
export class Guard {
  private logs = new Map<string, number[]>();
  private strikes = new Map<string, number[]>();
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  clear() {
    this.logs.clear();
    this.strikes.clear();
  }

  /** Drop everything remembered about a player who has left. */
  forget(pid: string) {
    for (const map of [this.logs, this.strikes]) {
      for (const key of [...map.keys()]) if (key.startsWith(pid + "|")) map.delete(key);
    }
  }

  /** Book `n` events against a budget of `limit` per `window` ms. */
  allow(pid: string, key: string, n: number, limit: number, window: number) {
    const k = pid + "|" + key;
    const now = this.now();
    const log = (this.logs.get(k) || []).filter((t) => now - t < window);
    const ok = n <= limit - log.length;
    if (ok) for (let i = 0; i < n; i++) log.push(now);
    this.logs.set(k, log);
    return ok;
  }

  /** True once the same complaint has come up in three separate periods. */
  repeated(pid: string, reason: string) {
    const key = pid + "|" + reason;
    const now = this.now();
    const log = (this.strikes.get(key) || []).filter((t) => now - t < 30000);
    if (!log.length || now - log[log.length - 1] >= 6000) log.push(now);
    this.strikes.set(key, log);
    return log.length >= 3;
  }
}

/** Snapshots, chat and damage all have a ceiling the real game cannot exceed. */
const RATE: Record<string, [number, number]> = {
  ps: [90, 2000],
  chat: [8, 6000],
  pdead: [8, 10000],
  startreq: [6, 5000],
};

/**
 * Is this message within what the game could actually produce? Called only for
 * messages that already passed {@link validPeerMessage}.
 */
export function gameplayAllowed(
  guard: Guard,
  m: PeerMsg,
  from: string,
  localId: string,
  violation: (pid: string, reason: string) => void,
): boolean {
  const t = m.t as string;
  const cap = RATE[t];
  if (cap && !guard.allow(from, t, 1, cap[0], cap[1])) {
    violation(from, `too many ${t} messages`);
    return false;
  }
  const d = m.d as Record<string, unknown>;

  if (t === "pdmg" || t === "botdmg") {
    const src = typeof d.gun === "string" && d.gun in HIT_CAP ? (d.gun as string) : "rifle";
    const [maxHit, perTwoSec] = HIT_CAP[src];
    if ((d.amount as number) > maxHit) {
      violation(from, "impossible damage in one hit");
      return false;
    }
    // Counted per victim, so an honest grenade or katana sweep catching several
    // people at once never reads as one impossible stream of hits.
    const target = t === "botdmg" ? String(d.bot) : (m.to as string) || localId;
    if (!guard.allow(from, "hits|" + target + "|" + src, 1, perTwoSec * 2, 2000)) {
      violation(from, "sustained impossible damage rate");
      return false;
    }
  }
  return true;
}
