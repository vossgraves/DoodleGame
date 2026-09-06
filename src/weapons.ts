/* weapons.ts — weapon definitions */
import type { WeaponDef } from "./types";

export const WEAPON_DEFS: WeaponDef[] = [
  {
    id: "rifle", name: "RIFLE", desc: "auto · put the red dot on them",
    autofire: true, mag: 35, reserve: 175, dmg: 34,
    fireRate: 8.5, reloadTime: 1.15, spread: 0.055,
    speed: 900, pellets: 1, shake: 2.5,
  },
  {
    id: "shotgun", name: "SHOTGUN", desc: "big boom up close",
    autofire: false, mag: 6, reserve: 36, dmg: 12,
    fireRate: 5.5, reloadTime: 1.9, spread: 0.22,
    speed: 640, pellets: 7, shake: 7,
  },
  {
    id: "sniper", name: "SNIPER", desc: "one zoom, one gone",
    autofire: false, mag: 5, reserve: 25, dmg: 170,
    fireRate: 3.4, reloadTime: 2.3, spread: 0.004,
    speed: 1600, pellets: 1, shake: 9, pierce: true,
  },
  {
    id: "smg", name: "SMG", desc: "spray and pray, quickly",
    autofire: true, mag: 24, reserve: 168, dmg: 16,
    fireRate: 14, reloadTime: 1.35, spread: 0.09,
    speed: 820, pellets: 1, shake: 1.6,
  },
  {
    id: "katana", name: "KATANA", desc: "∞ slices · dash-slash when lit",
    autofire: false, melee: true, mag: Infinity, reserve: Infinity,
    dmg: 60, arc: 1.5, range: 96, fireRate: 0, reloadTime: 0, spread: 0, speed: 0, pellets: 0, shake: 0,
  },
];
