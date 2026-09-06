import { sql } from "../_lib/db";
import { createSession, hashPassword, validatePassword, validateUsername } from "../_lib/auth";
import { HttpError, handler, methodIs, readBody, type ApiRequest, type ApiResponse } from "../_lib/http";

export default handler(async (req: ApiRequest, res: ApiResponse) => {
  methodIs(req, "POST");
  const { username, password } = readBody<{ username?: string; password?: string }>(req);
  const name = validateUsername(username);
  const pw = validatePassword(password);

  const taken = (await sql`select 1 from users where username_ci = ${name.toLowerCase()}`) as unknown[];
  if (taken.length) throw new HttpError(409, "that name is already taken");

  const hash = await hashPassword(pw);
  const rows = (await sql`
    insert into users (username, username_ci, password_hash)
    values (${name}, ${name.toLowerCase()}, ${hash})
    returning id, username
  `) as { id: string; username: string }[];
  const user = rows[0];

  await sql`insert into profiles (user_id) values (${user.id}) on conflict do nothing`;
  await sql`insert into stats (user_id) values (${user.id}) on conflict do nothing`;

  const session = await createSession(user.id);
  res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user });
});
