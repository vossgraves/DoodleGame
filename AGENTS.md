# Doodle District

- Ballpoint-on-lined-paper FPS
- React + Vite + TypeScript frontend
- three.js with a custom ink/paper post-process
- PeerJS host-authoritative P2P multiplayer
- Neon Postgres behind a few Vercel functions for accounts

## Tools

- Use the dedicated read/edit file tools for file contents — not `cat`/`sed`/heredocs
- The shell is for git, npm, process management, deletes, and searches

## Commands

- `npm run dev` — vite dev server
- `npm run build` — bundles to a single `dist/index.html` (what Vercel serves)
- `npx tsc --noEmit` — typecheck the app
- `npx tsc -p tsconfig.api.json --noEmit` — typecheck the api functions

## Layout

- `src/App.tsx` — every screen: menu, settings, loadout, account, HUD
- `src/WeaponIcon.tsx` — side-profile weapon silhouettes
- `src/game/engine.ts` — the Game class; owns the frame and wires everything
- `src/game/player.ts` — weapon definitions, the Weapon class, first-person movement
- `src/game/physics.ts` — AABB world, raycasts, swept movement, spatial grid
- `src/game/level.ts` — the map kit and every map built with it
- `src/game/enemies.ts` — PvE waves
- `src/game/bot.ts` — bot AI for PvP
- `src/game/match.ts` — lobby, roster, teams, zone, drops
- `src/game/net.ts`, `src/game/remote.ts` — PeerJS transport and remote-player interpolation
- `src/game/guard.ts` — what a peer is allowed to say, and how often
- `src/game/attachments.ts` — gunsmith rails and their stat multipliers
- `src/game/cosmetics.ts` — camos, charms, stickers and what unlocks them
- `src/game/skills.ts` — operator skills
- `src/game/streaks.ts` — scorestreaks
- `src/game/grapple.ts` — the swing grapple
- `src/game/renderer.ts` — the ink shader and the post pass
- `src/game/sens.ts`, `src/game/hudlayout.ts` — look sensitivity bands, draggable HUD positions
- `src/game/audio.ts`, `src/game/input.ts` — WebAudio synthesis, keyboard/mouse/touch/gamepad
- `api/` — Vercel functions: auth, profile, stats, leaderboard
- `db/schema.sql` — the Neon schema

## How things fit together

- Rendering: every material is `makeInkMaterial`; it writes shade into red and an ink id into green, and the post pass in `renderer.ts` turns that into hatching on paper
- The scene target is 8-bit: ink id is stored as a fraction of `INK_SLOTS` — write it raw and every pen past red clamps to red
- A map can hand `setStyle` its own paper, ruling and six inks
- Multiplayer: host-authoritative P2P over PeerJS — no game server; the lobby code is the host's peer id
- Damage is owner-authoritative: the shooter sends `pdmg`, the victim's client applies it
- Anti-cheat lives on the wire: `guard.ts` shape-checks every peer message, refuses host-only types from peers, caps damage per weapon, rate-limits the rest
- Weapons are data: `RAW_DEFS` in `player.ts` holds ballistics, `HANDLING` the feel, `applyBuild` folds gunsmith multipliers over the top
- Adding a weapon = adding a def, a build branch, an anchor entry and an icon
- Persistence: localStorage first, account API as a slower debounced mirror (`saveProfileSoon`)

## House style

- Comments explain *why*, never *what* — and most lines need none
- Match the surrounding code's naming and density
- Never commit secrets; `.env.example` documents what's needed, `.env` is ignored
- No `new` inside per-frame hot paths — use module/class scratch vectors; the physics world has a spatial grid, use `hasLineOfSight`/`raycast` rather than scanning `boxes`

## Testing

- No unit test suite — do not add one
- Verify by driving the built page with Playwright against the pre-installed Chromium
- Read real game state from `window.__doodle` (exposed when `localStorage.doodle_debug === "1"`)
- Probes live in the scratchpad, not the repo
