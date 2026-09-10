import { sql } from "./_lib/db";
import { requireUser } from "./_lib/auth";
import { bad, handler, methodIs, readBody, type ApiRequest, type ApiResponse } from "./_lib/http";

function cleanLoadout(v: unknown): string[] {
  if (!Array.isArray(v)) throw bad("loadout must be an array");
  if (v.length > 8) throw bad("loadout is too long");
  return v.map((k) => {
    if (typeof k !== "string" || k.length > 24) throw bad("loadout entries must be short strings");
    return k;
  });
}

function cleanSettings(v: unknown): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw bad("settings must be an object");
  const out = v as Record<string, unknown>;
  if (Object.keys(out).length > 40) throw bad("too many settings");
  return out;
}

export default handler(async (req: ApiRequest, res: ApiResponse) => {
  methodIs(req, "POST");
  const user = await requireUser(req);
  const body = readBody<{ loadout?: unknown; settings?: unknown }>(req);

  const loadout = body.loadout === undefined ? null : cleanLoadout(body.loadout);
  const settings = body.settings === undefined ? null : cleanSettings(body.settings);

  await sql`
    insert into profiles (user_id, loadout, settings, updated_at)
    values (
      ${user.id},
      ${JSON.stringify(loadout ?? [])}::jsonb,
      ${JSON.stringify(settings ?? {})}::jsonb,
      now()
    )
    on conflict (user_id) do update set
      loadout    = coalesce(${loadout === null ? null : JSON.stringify(loadout)}::jsonb, profiles.loadout),
      settings   = coalesce(${settings === null ? null : JSON.stringify(settings)}::jsonb, profiles.settings),
      updated_at = now()
  `;

  res.status(200).json({ ok: true });
});
