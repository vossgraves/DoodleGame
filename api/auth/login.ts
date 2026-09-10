import { sql, type UserRow } from "../_lib/db";
import { createSession, hashPassword, verifyPassword } from "../_lib/auth";
import { HttpError, handler, methodIs, readBody, type ApiRequest, type ApiResponse } from "../_lib/http";

let decoyHash: string | null = null;
async function decoy(pw: string) {
  if (!decoyHash) decoyHash = await hashPassword("this-account-does-not-exist");
  await verifyPassword(pw, decoyHash);
}

export default handler(async (req: ApiRequest, res: ApiResponse) => {
  methodIs(req, "POST");
  const { username, password } = readBody<{ username?: string; password?: string }>(req);
  if (typeof username !== "string" || typeof password !== "string") {
    throw new HttpError(400, "username and password are required");
  }

  const rows = (await sql`
    select id, username, password_hash from users where username_ci = ${username.toLowerCase()}
  `) as UserRow[];
  const row = rows[0];

  if (!row) {
    await decoy(password);
    throw new HttpError(401, "wrong name or password");
  }
  if (!(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, "wrong name or password");
  }

  await sql`update users set last_seen_at = now() where id = ${row.id}`;
  const session = await createSession(row.id);
  res.status(200).json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: { id: row.id, username: row.username },
  });
});
