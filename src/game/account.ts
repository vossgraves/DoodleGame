// Client for the accounts API.
//
// The game must keep working with no backend at all — it is a static build with
// peer-to-peer play, and the API is an optional extra. Every call here fails
// soft: if there is no /api, you stay signed out and localStorage carries your
// loadout and best scores exactly as before.

export interface Account {
  id: string;
  username: string;
}

export interface Stats {
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
  best_district: number;
  best_zombies: number;
}

export interface Profile {
  loadout: string[];
  settings: Record<string, unknown>;
}

const TOKEN_KEY = "doodle_token";
const UID_KEY = "doodle_uid";
const API = "/api";

/**
 * A stable id for this player, minted on first run. Signing in adopts the
 * account's id so the same person is the same id on every device; signing out
 * keeps it, because the id is who you are in a lobby, not who you are to the
 * database. It is also the fallback identity when there is no backend at all.
 */
export function uid(): string {
  try {
    const seen = localStorage.getItem(UID_KEY);
    if (seen) return seen;
  } catch {
    return "DDL-GUEST";
  }
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => b.toString(36).toUpperCase().padStart(2, "0")).join("").slice(0, 10);
  const fresh = `DDL-${body.slice(0, 5)}-${body.slice(5, 10)}`;
  try {
    localStorage.setItem(UID_KEY, fresh);
  } catch {
    // private mode: the id lasts the session, which is still better than none
  }
  return fresh;
}

export function adoptUid(id: string) {
  try {
    localStorage.setItem(UID_KEY, id);
  } catch {
    // nothing to do; uid() will mint a fresh one next time
  }
}

export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode; the session just will not survive a reload */
  }
}

export class ApiError extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = savedToken();
  let res: Response;
  try {
    res = await fetch(API + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new ApiError("cannot reach the server");
  }
  // a static deploy with no functions answers HTML, not JSON
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.ok ? "accounts are not set up on this deploy" : `server error (${res.status})`);
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `server error (${res.status})`;
    throw new ApiError(msg);
  }
  return body as T;
}

interface AuthReply {
  token: string;
  expiresAt: string;
  user: Account;
}

export async function register(username: string, password: string): Promise<Account> {
  const r = await call<AuthReply>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setToken(r.token);
  return r.user;
}

export async function login(username: string, password: string): Promise<Account> {
  const r = await call<AuthReply>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setToken(r.token);
  return r.user;
}

export async function logout(): Promise<void> {
  try {
    await call("/auth/logout", { method: "POST" });
  } catch {
    /* dropping the local token is what actually signs you out here */
  }
  setToken(null);
}

export async function me(): Promise<{ user: Account; profile: Profile; stats: Stats } | null> {
  if (!savedToken()) return null;
  try {
    return await call<{ user: Account; profile: Profile; stats: Stats }>("/me");
  } catch (e) {
    // an expired or rejected session should not leave a dead token behind
    if (e instanceof ApiError && /session/i.test(e.message)) setToken(null);
    return null;
  }
}

export async function saveProfile(loadout: string[], settings: Record<string, unknown>): Promise<boolean> {
  if (!savedToken()) return false;
  try {
    await call("/profile", { method: "POST", body: JSON.stringify({ loadout, settings }) });
    return true;
  } catch {
    return false;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: { loadout: string[]; settings: Record<string, unknown> } | null = null;

/**
 * Coalesce profile writes.
 *
 * Tapping through the loadout fires a change per chip; without this that is one
 * serverless invocation and one database round trip each, which is a silly way
 * to spend a free tier. Only the last state in a 1.2s window is ever sent.
 */
export function saveProfileSoon(loadout: string[], settings: Record<string, unknown> = {}) {
  if (!savedToken()) return;
  pending = { loadout, settings };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const p = pending;
    pending = null;
    if (p) void saveProfile(p.loadout, p.settings);
  }, 1200);
}

/** Flush any queued write immediately, e.g. when leaving the loadout screen. */
export function flushProfile() {
  if (!saveTimer || !pending) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const p = pending;
  pending = null;
  void saveProfile(p.loadout, p.settings);
}

export async function reportStats(s: Partial<Record<string, number>>): Promise<boolean> {
  if (!savedToken()) return false;
  try {
    await call("/stats", { method: "POST", body: JSON.stringify(s) });
    return true;
  } catch {
    return false;
  }
}

export interface BoardRow {
  username: string;
  value: number;
  matches: number;
}

export async function leaderboard(board = "kills"): Promise<BoardRow[]> {
  try {
    const r = await call<{ rows: BoardRow[] }>(`/leaderboard?board=${encodeURIComponent(board)}`);
    return r.rows || [];
  } catch {
    return [];
  }
}
