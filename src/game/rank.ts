import type { BotSkill } from "./bot";

export interface Tier {
  name: string;
  at: number;
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

export function srDelta(opts: { place: number; players: number; kills: number; deaths: number; won: boolean }) {
  const { place, players, kills, deaths, won } = opts;
  const field = Math.max(2, players);
  const standing = 1 - (2 * (place - 1)) / (field - 1);
  const base = Math.round(standing * 55);
  const fight = Math.round(Math.min(20, kills * 2.5) - Math.min(14, deaths * 1.6));
  return base + fight + (won ? 15 : 0);
}

export function sanitizeSr(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return START_SR;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : START_SR;
}
