import { bearer, destroySession } from "../_lib/auth";
import { handler, methodIs, type ApiRequest, type ApiResponse } from "../_lib/http";

export default handler(async (req: ApiRequest, res: ApiResponse) => {
  methodIs(req, "POST");
  const token = bearer(req);
  if (token) await destroySession(token);
  // signing out is idempotent: no token is still a successful sign-out
  res.status(200).json({ ok: true });
});
