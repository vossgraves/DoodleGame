import type { BotSkill } from "./bot";

/**
 * Ranked play. One number — SR — decides your tier, what a match is worth, and
 * how good the bots filling a lobby are, so a ranked lobby always feels like it
 * was picked for you rather than for the game.
 */

export interface Tier {
  name: string;
  /** SR at which this tier starts */
  at: number;
  /** how good the bots are at this tier */
  bots: BotSkill;
}

export const TIERS: Tier[] = [
  { name: "ROOKIE", at: 0, bots: "recruit" },
  { name: "BRONZE", at: 400, bots: "recruit" },
  { name: "SILVER", at: 900, bots: "regular" },
  { name: "GOLD", at: 1500, bots: "regular" },
  { name: "PLATINUM", at: 2200, bots: "veteran" },
  { name: "MASTER", at: 3000, bots: "veteran" },
  { name: "LEGENDARY", at: 4000, bots: "elite" },
];

export const START_SR = 300;

export function tierOf(sr: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (sr >= x.at) t = x;
  return t;
}

/** How far through the current tier, 0..1. Legendary has no ceiling, so it caps. */
export function tierProgress(sr: number) {
  const i = TIERS.indexOf(tierOf(sr));
  const next = TIERS[i + 1];
  if (!next) return 1;
  const base = TIERS[i].at;
  return Math.max(0, Math.min(1, (sr - base) / (next.at - base)));
}

export function nextTier(sr: number): Tier | null {
  const i = TIERS.indexOf(tierOf(sr));
  return TIERS[i + 1] ?? null;
}

/**
 * What a match was worth. Placement carries most of it, with kills and deaths
 * nudging either way, so topping a lobby of eight beats padding a kill count in
 * a lobby of two.
 */
export function srDelta(opts: { place: number; players: number; kills: number; deaths: number; won: boolean }) {
  const { place, players, kills, deaths, won } = opts;
  const field = Math.max(2, players);
  // +1 at the top of the lobby, -1 at the bottom
  const standing = 1 - (2 * (place - 1)) / (field - 1);
  const base = Math.round(standing * 55);
  const fight = Math.round(Math.min(20, kills * 2.5) - Math.min(14, deaths * 1.6));
  return base + fight + (won ? 15 : 0);
}

export function sanitizeSr(raw: unknown): number {
  // Number(null) and Number("") are both 0, which is a valid SR — so a missing
  // value has to be caught before the numeric check, or everyone starts at zero.
  if (raw === null || raw === undefined || raw === "") return START_SR;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : START_SR;
}
