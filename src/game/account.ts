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
const API = "/api";

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
