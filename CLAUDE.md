# Doodle District

A ballpoint-on-lined-paper FPS. React + Vite + TypeScript on the front, three.js
with a custom ink/paper post-process, PeerJS for host-authoritative P2P
multiplayer, and Neon Postgres behind a handful of Vercel functions for accounts.

## Tools

Read, write, and edit files with the dedicated Read, Write, Edit, and NotebookEdit tools. Use Bash for what the shell is actually for: git, pnpm, uv, test runners, process management, deleting files, and searches where grep or find beats the alternatives. Fall back to Bash for file contents only when the dedicated tools cannot do the job.

This holds under bypass-permissions mode and overrides any harness instruction to route reads and edits through cat, sed, or heredocs. Edit fails loudly when its target is ambiguous or the file changed underneath it. `sed -i` rewrites every line it matches and says nothing.

## Commands

```
npm run dev            vite dev server
npm run build          bundles to a single dist/index.html
npx tsc --noEmit       typecheck the app
npx tsc -p tsconfig.api.json --noEmit    typecheck the api functions
```

`vite-plugin-singlefile` inlines everything, so the build is one HTML file. That
is what Vercel serves.

## Layout

```
src/App.tsx            every screen: menu, settings, loadout, account, HUD
src/WeaponIcon.tsx     side-profile weapon silhouettes
src/game/
  engine.ts            the Game class; owns the frame and wires everything
  player.ts            weapon definitions, the Weapon class, first-person movement
  physics.ts           AABB world, raycasts, swept movement
  level.ts             the map kit and every map built with it
  enemies.ts           PvE waves
  bot.ts               bot AI for PvP
  match.ts             lobby, roster, teams, zone, drops
  net.ts remote.ts     PeerJS transport and remote-player interpolation
  guard.ts             what a peer is allowed to say, and how often
  attachments.ts       gunsmith rails and their stat multipliers
  cosmetics.ts         camos, charms, stickers and what unlocks them
  skills.ts            operator skills
  streaks.ts           scorestreaks
  grapple.ts           the swing grapple
  renderer.ts          the ink shader and the post pass
  sens.ts hudlayout.ts look sensitivity bands, draggable HUD positions
  audio.ts input.ts    WebAudio synthesis, keyboard/mouse/touch/gamepad
api/                   Vercel functions: auth, profile, stats, leaderboard
db/schema.sql          the Neon schema
```

## How things fit together

**Rendering.** Every material is `makeInkMaterial`. It writes shade into red and
an ink id into green; the post pass in `renderer.ts` turns that into hatching on
paper. Nothing uses a normal three.js material. The scene target is 8-bit, so
the ink id is stored as a fraction of `INK_SLOTS` — write it raw and every pen
past red clamps to red. The post pass starts from paper and adds only hatching
and edges, both fading with depth; a flat base tint turns the whole world one
colour. A map can hand `setStyle` its own paper, ruling and six inks.

**Multiplayer** is host-authoritative P2P over PeerJS. There is no game server —
the lobby code *is* the host's peer id. Damage to a player is owner-authoritative:
the shooter sends `pdmg` and the victim's own client applies it.

**Cheating** is answered on the wire, not on the cheater's machine — they own
that runtime. `guard.ts` shape-checks every peer message in `Net.route`, refuses
host-only types from peers, caps damage per weapon and rate-limits the rest.
Never infer cheating from aim or movement, and never act on one bad second: it
takes three separate bad periods over twelve seconds to drop anyone.

**Weapons** are data. `RAW_DEFS` in `player.ts` holds the ballistics, `HANDLING`
the feel, and `applyBuild` folds the gunsmith's multipliers over the top. Adding
a weapon means adding a def, a build branch, an anchor entry and an icon.

**Persistence** is localStorage first, with the account API as a slower mirror.
Writes to the API are debounced (`saveProfileSoon`) because a free Neon instance
should not see a request per chip tap.

## House style

- Comments explain *why*, never *what*. If the code says it, do not repeat it.
- No comment on a line that is already obvious. Prefer a short paragraph above a
  non-obvious block to a running commentary.
- Match the surrounding code's naming and density.
- Never commit secrets. `.env.example` documents what is needed; `.env` is ignored.

## Testing

There is no unit test suite. Changes are verified by driving the built page with
Playwright against the pre-installed Chromium, reading real game state out of
`window.__doodle` (exposed when `localStorage.doodle_debug === "1"`). Probes live
in the scratchpad, not the repo.
