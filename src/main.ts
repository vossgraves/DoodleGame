/* main.ts — boot, menu wiring, global loop */
import { Game } from "./game";
import { Input } from "./input";
import { UI } from "./ui";
import { AudioSys } from "./audio";
import { Store } from "./utils";

const game = new Game();
const ui = new UI(game);
let booted = false;

function boot() {
  if (booted) return;
  booted = true;
  const container = document.getElementById("app3d")!;
  game.init(container, {
    onHUD: () => ui.updateHUD(),
    onShowBoss: (show) => ui.onShowBoss(show),
    onGameOver: (mode, isBest) => ui.onGameOver(mode, isBest),
    onPause: (on) => ui.onPause(on),
    onShop: (open) => ui.onShop(open),
    onToast: (msg, cls) => ui.onToast(msg, cls),
    onMenu: () => ui.onMenu(),
  });
  Input.init(container, game);

  const $ = (id: string) => document.getElementById(id)!;
  const on = (id: string, ev: string, fn: (e: Event) => void) => $(id)?.addEventListener(ev, fn);

  // menu
  on("btn-district", "click", () => { AudioSys.init(); AudioSys.resume(); ui.showBanner("DISTRICT", "survive the waves"); game.startGame("district"); });
  on("btn-zombies", "click", () => { AudioSys.init(); AudioSys.resume(); ui.showBanner("NIGHT MODE", "the horde is coming"); game.startGame("zombies"); });
  on("btn-howto", "click", () => $("screen-howto").classList.remove("hidden"));
  on("btn-howto-close", "click", () => $("screen-howto").classList.add("hidden"));
  on("btn-settings", "click", () => $("screen-settings").classList.remove("hidden"));
  on("btn-settings-close", "click", () => $("screen-settings").classList.add("hidden"));
  on("btn-pause-settings", "click", () => $("screen-settings").classList.remove("hidden"));

  // settings
  const musicBtn = $("set-music") as HTMLButtonElement;
  const sfxBtn = $("set-sfx") as HTMLButtonElement;
  const vibeBtn = $("set-vibe") as HTMLButtonElement;
  const assistBtn = $("set-assist") as HTMLButtonElement;
  const touchBtn = $("set-touch") as HTMLButtonElement;
  const sens = $("set-sens") as HTMLInputElement;
  ui.syncSettings(musicBtn, sfxBtn, vibeBtn, assistBtn, touchBtn, sens);
  const toggle = (b: HTMLButtonElement, key: string) => {
    const v = !b.classList.contains("on");
    b.classList.toggle("on", v);
    b.classList.toggle("off", !v);
    b.textContent = v ? "ON" : "OFF";
    Store.set(key, v);
    if (key === "music") AudioSys.setMusic(v);
    if (key === "sfx") AudioSys.setSfx(v);
    if (key === "vibe") AudioSys.setVibe(v);
    if (key === "force-touch") {
      Input.showTouchUI(v || Input.deviceType === "touch");
    }
  };
  on("set-music", "click", () => toggle(musicBtn, "music"));
  on("set-sfx", "click", () => toggle(sfxBtn, "sfx"));
  on("set-vibe", "click", () => toggle(vibeBtn, "vibe"));
  on("set-assist", "click", () => toggle(assistBtn, "assist"));
  on("set-touch", "click", () => toggle(touchBtn, "force-touch"));
  sens.addEventListener("input", () => {
    const v = Number(sens.value);
    Store.set("sens", v);
    const mv = document.getElementById("set-sens-val");
    if (mv) mv.textContent = v + "%";
  });

  // pause
  on("btn-resume", "click", () => { $("screen-settings").classList.add("hidden"); game.resumeGame(); });
  on("btn-restart", "click", () => { $("screen-settings").classList.add("hidden"); $("screen-pause").classList.add("hidden"); game.retry(); });
  on("btn-quit", "click", () => game.quitToMenu());
  on("btn-hud-pause", "click", () => game.pauseGame());
  on("btn-pause-music", "click", () => {
    AudioSys.setMusic(!AudioSys.musicOn);
    const b = $("btn-pause-music");
    b.textContent = "🎵 MUSIC: " + (AudioSys.musicOn ? "ON" : "OFF");
    if (AudioSys.musicOn) AudioSys.startMusic(game.mode === "zombies");
  });

  // shop
  on("btn-next-wave", "click", () => game.nextWave());
  on("shop-heal", "click", () => game.buyShopItem("heal"));
  on("shop-ammo", "click", () => game.buyShopItem("ammo"));
  on("shop-grenade", "click", () => game.buyShopItem("grenade"));

  // game over
  on("btn-retry", "click", () => { $("screen-over").classList.add("hidden"); game.retry(); });
  on("btn-menu", "click", () => game.quitToMenu());

  // meta keys
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" || e.code === "KeyP") {
      if (game.state === "play" && !game.paused) game.pauseGame();
      else if (game.paused && game.state === "play") game.resumeGame();
      else if (game.state === "shop") game.nextWave();
    }
    if (e.code === "KeyM") {
      AudioSys.setMusic(!AudioSys.musicOn);
      ui.onToast("🎵 music " + (AudioSys.musicOn ? "on" : "off"), "");
      if (AudioSys.musicOn && game.state === "play") AudioSys.startMusic(game.mode === "zombies");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game.state === "play" && !game.paused) game.pauseGame();
  });

  const unlock = () => { AudioSys.init(); AudioSys.resume(); AudioSys.startMusic(); };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

  game.uiCallbacks = {
    onHUD: () => ui.updateHUD(),
    onShowBoss: (show) => ui.onShowBoss(show),
    onGameOver: (mode, isBest) => ui.onGameOver(mode, isBest),
    onPause: (on) => ui.onPause(on),
    onShop: (open) => ui.onShop(open),
    onToast: (msg, cls) => ui.onToast(msg, cls),
    onMenu: () => ui.onMenu(),
  };

  requestAnimationFrame(function loop(t) {
    game.frame(t);
    ui.updateHint();
    requestAnimationFrame(loop);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
