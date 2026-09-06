import { sql } from "./_lib/db";
import { requireUser } from "./_lib/auth";
import { handler, methodIs, type ApiRequest, type ApiResponse } from "./_lib/http";

export default handler(async (req: ApiRequest, res: ApiResponse) => {
  methodIs(req, "GET");
  const user = await requireUser(req);

  const profiles = (await sql`select loadout, settings from profiles where user_id = ${user.id}`) as {
    loadout: unknown;
    settings: unknown;
  }[];
  const stats = (await sql`
    select kills, deaths, wins, matches, best_district, best_zombies from stats where user_id = ${user.id}
  `) as Record<string, number>[];

  res.status(200).json({
    user,
    profile: profiles[0] ?? { loadout: [], settings: {} },
    stats: stats[0] ?? { kills: 0, deaths: 0, wins: 0, matches: 0, best_district: 0, best_zombies: 0 },
  });
});
