import { sql } from "./_lib/db";
import { handler, methodIs, type ApiRequest, type ApiResponse } from "./_lib/http";

const BOARDS = {
  kills: "kills",
  wins: "wins",
  district: "best_district",
  zombies: "best_zombies",
} as const;

export default handler(async (req: ApiRequest, res: ApiResponse) => {
  methodIs(req, "GET");
  const url = new URL(req.url || "/", "http://local");
  const key = (url.searchParams.get("board") || "kills") as keyof typeof BOARDS;
  const column = BOARDS[key] ?? BOARDS.kills;

  // the column is chosen from a fixed map, never interpolated from user input
  const rows =
    column === "wins"
      ? await sql`select u.username, s.wins as value, s.matches from stats s join users u on u.id = s.user_id order by s.wins desc limit 25`
      : column === "best_district"
        ? await sql`select u.username, s.best_district as value, s.matches from stats s join users u on u.id = s.user_id order by s.best_district desc limit 25`
        : column === "best_zombies"
          ? await sql`select u.username, s.best_zombies as value, s.matches from stats s join users u on u.id = s.user_id order by s.best_zombies desc limit 25`
          : await sql`select u.username, s.kills as value, s.matches from stats s join users u on u.id = s.user_id order by s.kills desc limit 25`;

  res.status(200).json({ board: key in BOARDS ? key : "kills", rows });
});
