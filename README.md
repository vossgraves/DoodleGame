# ✏️ Doodle District — three.js + TypeScript remake

A scribbled survival shooter (fan-made tribute in the spirit of doodleshooter.vercel.app),
rebuilt from the ground up in **three.js + TypeScript** (Vite). Doodle-style geometry and
procedural textures give it a hand-drawn notebook look — no external art or audio assets
(WebAudio SFX + chiptune loop are synthesized at runtime).

## 🎮 Modes

- **DISTRICT** — solo wave survival with the classic loadout:
  Rifle (35/175) · Shotgun (6/36) · Sniper (5/25) · Katana (∞).
  Doodle enemies: walkers, runners, spitters, tanks, brutes — **boss every 10th wave**.
- **ZOMBIES** — night horde survival. Green-eyed undead, **boss every 5th wave**,
  coin drops, and a **night shop between waves**:
  free upgrade picks (rage, haste, vitality, swift hands, armor, demo expert,
  vampirism, double tap) or buy heals / ammo / grenades.

## 🕹 Controls

| Desktop | Mobile (touch) |
|---|---|
| WASD move · mouse aim | Left stick move (push far = sprint) |
| LMB fire / slash · Shift sprint | Right stick aim + fire (aim assist) |
| Space / C / Ctrl dash · F katana | FIRE · DASH · 💣 hold to lob · RLD · ▤ |
| G grenade (hold = further) · R reload | twin-stick, vibration, safe-area aware |
| 1–5 / wheel · P/Esc pause · M music | pinch/scroll disabled |

Gamepads supported too (sticks, triggers, face buttons, L2+R2/LB for dash-slash).

## 🛠 Development

```bash
npm install
npm run dev        # vite dev server (localhost:5173)
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # serve the production build
```

## 📁 Source layout

```
index.html          shared shell: HUD, touch controls, menus, screens
css/style.css       doodle-paper styling + responsive touch layout
src/main.ts         boot, menu wiring, global loop
src/game.ts         simulation: movement, weapons, waves, enemies, boss, shop
src/world.ts        three.js scene: renderer, camera, notebook arena, day/night
src/entities.ts     mesh factories: doodle blobs, zombies, player, projectiles
src/input.ts        keyboard / mouse / gamepad / multitouch
src/audio.ts        WebAudio SFX + chiptune sequencer
src/weapons.ts      weapon definitions
src/ui.ts           DOM HUD + screens
src/utils.ts        math, seeded rng, storage, canvas-texture helpers
src/types.ts        shared TypeScript types
```

Scores/settings persist in `localStorage`.
