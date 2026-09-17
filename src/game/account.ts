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
  }
  return fresh;
}

export function adoptUid(id: string) {
  try {
    localStorage.setItem(UID_KEY, id);
  } catch {
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
  }
  setToken(null);
}

export async function me(): Promise<{ user: Account; profile: Profile; stats: Stats } | null> {
  if (!savedToken()) return null;
  try {
    return await call<{ user: Account; profile: Profile; stats: Stats }>("/me");
  } catch (e) {
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
