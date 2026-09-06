/* main.js — boot, menu wiring, global loop */
"use strict";

(function () {
  let booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    const canvas = document.getElementById("world");
    Game.init(canvas);
    Input.init(canvas);
    UI.init();

    const $ = (id) => document.getElementById(id);
    const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);

    // menu
    on("btn-district", "click", () => { AudioSys.init(); AudioSys.resume(); Game.startGame("district"); });
    on("btn-zombies", "click", () => { AudioSys.init(); AudioSys.resume(); Game.startGame("zombies"); });
    on("btn-howto", "click", () => { UI.show("screen-howto"); });
    on("btn-howto-close", "click", () => { UI.hide("screen-howto"); });
    on("btn-settings", "click", () => { UI.show("screen-settings"); });
    on("btn-settings-close", "click", () => { UI.hide("screen-settings"); });
    on("btn-pause-settings", "click", () => { UI.show("screen-settings"); });

    // settings
    const musicBtn = $("set-music"), sfxBtn = $("set-sfx"), vibeBtn = $("set-vibe"),
      assistBtn = $("set-assist"), touchBtn = $("set-touch"), sens = $("set-sens");
    function applySettings() {
      const music = !musicBtn.classList.contains("off");
      const sfx = !sfxBtn.classList.contains("off");
      const vibe = !vibeBtn.classList.contains("off");
      AudioSys.setMusic(music);
      AudioSys.setSfx(sfx);
      AudioSys.setVibe(vibe);
      Store.set("music", music);
      Store.set("sfx", sfx);
      Store.set("vibe", vibe);
      Store.set("assist", !assistBtn.classList.contains("off"));
      const forced = touchBtn.classList.contains("on");
      Store.set("force-touch", forced);
      Input.touchMode = Input.touchMode || forced || Input.deviceType === "touch";
      Input.showTouchUI(forced || Input.deviceType === "touch");
    }
    function tog(btn) { btn.classList.toggle("on"); btn.classList.toggle("off"); btn.textContent = btn.classList.contains("on") ? "ON" : "OFF"; applySettings(); }
    on("set-music", "click", () => tog(musicBtn));
    on("set-sfx", "click", () => tog(sfxBtn));
    on("set-vibe", "click", () => tog(vibeBtn));
    on("set-assist", "click", () => tog(assistBtn));
    on("set-touch", "click", () => tog(touchBtn));
    sens.addEventListener("input", () => { $("set-sens-val").textContent = sens.value + "%"; Store.set("sens", +sens.value); });
    musicBtn.classList.toggle("off", !Store.get("music", true));
    musicBtn.classList.toggle("on", Store.get("music", true));
    musicBtn.textContent = Store.get("music", true) ? "ON" : "OFF";
    sfxBtn.classList.toggle("off", !Store.get("sfx", true));
    sfxBtn.classList.toggle("on", Store.get("sfx", true));
    sfxBtn.textContent = Store.get("sfx", true) ? "ON" : "OFF";
    vibeBtn.classList.toggle("off", !Store.get("vibe", true));
    vibeBtn.classList.toggle("on", Store.get("vibe", true));
    vibeBtn.textContent = Store.get("vibe", true) ? "ON" : "OFF";
    sens.value = Store.get("sens", 100);
    $("set-sens-val").textContent = sens.value + "%";
    AudioSys.setMusic(Store.get("music", true));
    AudioSys.setSfx(Store.get("sfx", true));
    AudioSys.setVibe(Store.get("vibe", true));
    $("btn-pause-music").textContent = "\uD83C\uDFB5 MUSIC: " + (AudioSys.musicOn ? "ON" : "OFF");

    // pause screen
    on("btn-resume", "click", () => { UI.hide("screen-settings"); Game.resumeGame(); });
    on("btn-restart", "click", () => Game.retry());
    on("btn-quit", "click", () => Game.quitToMenu());
    on("btn-pause-music", "click", () => {
      const b = $("btn-pause-music");
      AudioSys.setMusic(!AudioSys.musicOn);
      b.textContent = "\uD83C\uDFB5 MUSIC: " + (AudioSys.musicOn ? "ON" : "OFF");
      if (AudioSys.musicOn) AudioSys.startMusic(Game.mode === "zombies");
    });
    on("btn-hud-pause", "click", () => Game.pauseGame());

    // shop
    on("btn-next-wave", "click", () => Game.nextWave());
    on("shop-heal", "click", () => Game.buyShopItem("heal"));
    on("shop-ammo", "click", () => Game.buyShopItem("ammo"));
    on("shop-grenade", "click", () => Game.buyShopItem("grenade"));

    // game over
    on("btn-retry", "click", () => { UI.hide("screen-over"); Game.retry(); });
    on("btn-menu", "click", () => Game.quitToMenu());

    // keyboard meta
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        if (Game.state === "play" && !Game.paused) Game.pauseGame();
        else if (Game.paused && Game.state === "play") Game.resumeGame();
        else if (Game.state === "shop") Game.nextWave();
      }
      if (e.code === "KeyM") {
        AudioSys.setMusic(!AudioSys.musicOn);
        UI.addToast("\uD83C\uDFB5 music " + (AudioSys.musicOn ? "on" : "off"));
        if (AudioSys.musicOn && Game.state === "play") AudioSys.startMusic(Game.mode === "zombies");
      }
    });

    // auto-pause when the tab hides
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && Game.state === "play" && !Game.paused) Game.pauseGame();
    });

    // first interaction unlocks audio
    const unlock = () => { AudioSys.init(); AudioSys.resume(); AudioSys.startMusic(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    // resize/rotate tips
    window.addEventListener("resize", () => { if (window.innerHeight > window.innerWidth) UI.updateRot(); });

    // main loop
    requestAnimationFrame(function loop(t) {
      Game.frame(t);
      requestAnimationFrame(loop);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
