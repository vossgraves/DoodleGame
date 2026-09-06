import { sql } from "./_lib/db";
import { requireUser } from "./_lib/auth";
import { bad, handler, methodIs, readBody, type ApiRequest, type ApiResponse } from "./_lib/http";

/**
 * Match results are self-reported, because in a peer-to-peer game there is no
 * server that saw the match. Values are clamped so a bad or malicious client
 * cannot post a nonsense score, but this is a friendly leaderboard, not a
 * tamper-proof one — say so rather than implying otherwise.
 */
const clamp = (v: unknown, max: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
  if (n < 0) throw bad("counts cannot be negative");
  return Math.min(n, max);
};

export default handler(async (req: ApiRequest, res: ApiResponse) => {
  methodIs(req, "POST");
  const user = await requireUser(req);
  const b = readBody<Record<string, unknown>>(req);

  const kills = clamp(b.kills, 200);
  const deaths = clamp(b.deaths, 200);
  const wins = clamp(b.wins, 1);
  const matches = clamp(b.matches, 1);
  const bestDistrict = clamp(b.bestDistrict, 10_000_000);
  const bestZombies = clamp(b.bestZombies, 10_000_000);

  await sql`
    insert into stats (user_id, kills, deaths, wins, matches, best_district, best_zombies, updated_at)
    values (${user.id}, ${kills}, ${deaths}, ${wins}, ${matches}, ${bestDistrict}, ${bestZombies}, now())
    on conflict (user_id) do update set
      kills         = stats.kills   + ${kills},
      deaths        = stats.deaths  + ${deaths},
      wins          = stats.wins    + ${wins},
      matches       = stats.matches + ${matches},
      best_district = greatest(stats.best_district, ${bestDistrict}),
      best_zombies  = greatest(stats.best_zombies,  ${bestZombies}),
      updated_at    = now()
  `;

  res.status(200).json({ ok: true });
});
