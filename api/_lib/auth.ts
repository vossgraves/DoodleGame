import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./db";
import { unauthorized, bad, type ApiRequest } from "./http";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;
const SESSION_DAYS = 30;

const USERNAME_RE = /^[A-Za-z0-9_-]{3,14}$/;

export function validateUsername(name: unknown): string {
  if (typeof name !== "string" || !USERNAME_RE.test(name)) {
    throw bad("username must be 3-14 characters: letters, numbers, _ or -");
  }
  return name;
}

export function validatePassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < 8) throw bad("password must be at least 8 characters");
  if (pw.length > 200) throw bad("password is too long");
  return pw;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(pw, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${tokenHash(token)}, ${userId}, ${expires.toISOString()})
  `;
  return { token, expiresAt: expires.toISOString() };
}

export async function destroySession(token: string) {
  await sql`delete from sessions where token_hash = ${tokenHash(token)}`;
}

export function bearer(req: ApiRequest): string | null {
  const raw = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

export interface SessionUser {
  id: string;
  username: string;
}

export async function requireUser(req: ApiRequest): Promise<SessionUser> {
  const token = bearer(req);
  if (!token) throw unauthorized();
  const rows = (await sql`
    select u.id, u.username, s.expires_at
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash(token)}
  `) as { id: string; username: string; expires_at: string }[];

  const row = rows[0];
  if (!row) throw unauthorized("that session is no longer valid");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sql`delete from sessions where token_hash = ${tokenHash(token)}`;
    throw unauthorized("that session has expired");
  }
  return { id: row.id, username: row.username };
}
