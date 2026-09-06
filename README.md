# ✏️ Doodle District

A scribbled survival shooter — a fan-made doodle tribute (inspired by doodleshooter.vercel.app).
Everything is drawn with code on a "notebook paper" canvas: wobbly circles, scribble shading,
hand-drawn enemies, procedural chiptune audio. No assets, no dependencies, no build step.

## ▶ Play

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

or drop the folder on any static host (Netlify / Vercel / GitHub Pages).

## 🎮 Modes

- **DISTRICT** — solo wave survival. Rifle (35/175) · Shotgun (6/36) · Sniper (5/25) · Katana (∞).
  Doodle enemies: walkers, runners, spitters, tanks, brutes — and a **boss every 10th wave**.
- **ZOMBIES** — night horde survival. A green-eyed undead army with a **boss every 5th wave**.
  Kills drop coins → spend them in the **night shop** between waves:
  free upgrade picks (damage, speed, vitality, reload, armor, grenades, vampirism, double-tap)
  or buy heals / ammo / grenades.

## 🖱 Desktop controls

- **WASD** move · **Mouse** aim · **LMB** fire / slash · **Shift** sprint
- **Space / C / Ctrl** dash (i-frames) — dash-slash when the gauge is lit
- **F** quick katana slash · **G** grenade (hold for a longer throw) · **R** reload
- **1–5 / wheel** weapons · **P / Esc** pause · **M** music · **Tab-free** 😉
- Gamepads are supported (sticks, triggers, face buttons).

## 📱 Mobile / touch

- **Left stick** move (push past ~92% to sprint)
- **Right stick** aim + fire (with aim assist)
- **FIRE** shoots the nearest enemy · **DASH** dodge · **💣** hold to lob further
- **RLD** reload · **▤** next weapon · pinch-proof, no scroll, safe-area aware

## 🗂 Files

```
index.html      shell + HUD + touch controls + menus
css/style.css   doodle paper styling
js/utils.js     math, rng, storage, canvas doodle helpers
js/audio.js     WebAudio SFX + looped chiptune sequencer
js/input.js     keyboard / mouse / gamepad / multitouch
js/weapons.js   weapon definitions
js/entities.js  drawing for doodles, zombies, player, pickups
js/game*.js     simulation: movement, waves, enemies, boss, shop, drawing
js/ui.js        DOM HUD + screens
js/main.js      boot + menu wiring
```

Scores are kept in `localStorage`.
