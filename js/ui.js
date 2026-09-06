/* ui.js — DOM HUD, screens, banners, shop, toasts */
"use strict";

const UI = {
  els: {},
  toastN: 0,

  init() {
    const ids = ["hud", "banner", "banner-title", "banner-sub", "toasts",
      "hp-fill", "hp-text", "wave-num", "enemies-num", "score", "score-hi", "combo", "combo-num",
      "boss-bar", "boss-fill", "weapon-chips", "grenade-count", "dash-dot", "katana-dot",
      "screen-menu", "screen-howto", "screen-settings", "screen-pause", "screen-shop", "screen-over",
      "pause-stats", "over-title", "over-stats", "over-hi", "shop-wave", "shop-cards", "shop-coins", "shop-heal-c", "shop-grenade-c",
      "hint", "hint-text", "hint-sub", "attract-tip", "rot-tip"];
    for (const id of ids) this.els[id] = document.getElementById(id);
    this.els["hi-district"] = document.getElementById("hi-district");
    this.els["hi-zombies"] = document.getElementById("hi-zombies");
    this.updateMenuBest();
    this.els["attract-tip"].classList.remove("hidden");
  },

  show(id) { if (Array.isArray(id)) { for (const i of id) this.show(i); return; } const el = typeof id === "string" ? document.getElementById(id) : id; if (el) el.classList.remove("hidden"); },
  hide(id) { if (Array.isArray(id)) { for (const i of id) this.hide(i); return; } const el = typeof id === "string" ? document.getElementById(id) : id; if (el) el.classList.add("hidden"); },
  hideAll(ids) { for (const id of ids) this.hide(id); },

  updateMenuBest() {
    if (!this.els["hi-district"]) return;
    this.els["hi-district"].textContent = "DISTRICT BEST " + Game.best.district;
    this.els["hi-zombies"].textContent = "ZOMBIES BEST " + Game.best.zombies;
  },

  updateHUD(force) {
    if (Game.state !== "play" && Game.state !== "paused" && Game.state !== "shop") return;
    const p = Game.player;
    if (!p) return;
    const e = this.els;
    const pct = U.clamp(p.hp / p.maxHp, 0, 1);
    e["hp-fill"].style.width = (pct * 100) + "%";
    e["hp-fill"].style.background = pct > .5 ? "#3f9d63" : pct > .25 ? "#e8b731" : "#d94f3d";
    e["hp-text"].textContent = Math.max(0, Math.ceil(p.hp)) + "/" + p.maxHp;
    e["wave-num"].textContent = Game.wave;
    e["enemies-num"].textContent = (Game.waveActive ? Game.enemies.length + Game.spawnQueue : 0);
    e["score"].textContent = Game.score;
    e["score-hi"].textContent = "BEST " + Game.best[Game.mode];
    const comboOn = p.combo > 1;
    e["combo"].classList.toggle("hidden", !comboOn);
    e["combo-num"].textContent = "×" + p.combo.toFixed(1);
    e["grenade-count"].textContent = "\uD83D\uDCA3 ×" + p.grenades;
    e["dash-dot"].classList.toggle("ready", p.dashCd <= 0);
    e["katana-dot"].classList.toggle("ready", p.katanaGauge >= 1);
    const dw = document.getElementById("btn-dash");
    if (dw) {
      dw.classList.toggle("ready", p.dashCd <= 0);
      dw.classList.toggle("cooldown", p.dashCd > 0);
      dw.querySelector("span").textContent = p.dashCd > 0 ? (p.dashCd.toFixed(1)) : "DASH";
    }
    if (Game.boss) {
      this.show("boss-bar");
      this.els["boss-fill"].style.width = (U.clamp(Game.boss.hp / Game.boss.maxHp, 0, 1) * 100) + "%";
      this.els["boss-bar"].classList.remove("hidden");
    } else if (this._bossOn) this.hide("boss-bar");
    if (force || !this._chips || this._chipsLen !== p.weapons.length) this.buildWeaponChips();
    const w = p.weapons[p.wIndex];
    for (let i = 0; i < this._chips.length; i++) {
      const c = this._chips[i];
      const ww = p.weapons[i];
      c.classList.toggle("active", i === p.wIndex);
      const am = c.querySelector(".am");
      am.textContent = ww.def.melee ? "\u221E" : (ww.reloading ? "reloading\u2026" : ww.ammo + "/" + ww.reserve);
    }
  },

  buildWeaponChips() {
    const host = this.els["weapon-chips"];
    host.innerHTML = "";
    this._chips = [];
    const p = Game.player;
    p.weapons.forEach((w, i) => {
      const div = document.createElement("div");
      div.className = "wchip";
      div.innerHTML = '<span class="key">' + (i + 1) + "</span><span class=\"nm\">" + w.def.name + "</span><span class=\"am\"></span>";
      div.title = w.def.desc;
      host.appendChild(div);
      this._chips.push(div);
    });
    this._chipsLen = p.weapons.length;
  },

  showBoss(on) {
    if (on) this.show("boss-bar"); else this.hide("boss-bar");
    this._bossOn = on;
  },

  updateHint() {
    const hint = this.els["hint"];
    if (Game.hintT < 6 && Game.state === "play") {
      this.show("hint");
      const touch = Input.isTouchActive();
      this.els["hint-text"].textContent = touch
        ? "left stick move · right stick aim + fire · DASH to dodge · ▤ weapons"
        : "WASD move · mouse aim · LMB fire · C dash · F katana · G grenade · R reload";
      this.els["hint-sub"].textContent = touch ? "hold the 💣 to throw it further" : "kill doodles to fill the SLASH gauge";
    } else this.hide("hint");
  },

  showBanner(title, sub) {
    const b = this.els["banner"];
    this.els["banner-title"].textContent = title;
    this.els["banner-sub"].textContent = sub || "";
    b.classList.remove("hidden");
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "";
    clearTimeout(this._bT);
    this._bT = setTimeout(() => this.hide("banner"), 3000);
  },

  addToast(msg, cls) {
    const host = this.els["toasts"];
    const d = document.createElement("div");
    d.className = "toast " + (cls || "");
    d.textContent = msg;
    host.appendChild(d);
    setTimeout(() => d.remove(), 2700);
    while (host.children.length > 3) host.firstElementChild?.remove();
  },

  togglePause(on) {
    if (on) this.show("screen-pause");
    else this.hide("screen-pause");
    if (on) {
      const p = Game.player;
      this.els["pause-stats"].innerHTML =
        "<b>SCORE</b> " + Game.score + "<br><b>WAVE</b> " + Game.wave +
        "<br><b>KILLS</b> " + Game.kills + "<br><b>TIME</b> " + Math.floor(Game.timeAlive) + "s";
    }
  },

  showGameOver(mode, isBest) {
    const p = Game.player;
    this.els["over-title"].textContent = mode === "zombies" ? "THE HORDE WINS" : "GAME OVER";
    this.els["over-title"].className = mode === "zombies" ? "zombies" : "";
    this.els["over-stats"].innerHTML =
      "<b>SCORE</b> " + Game.score + "<br><b>WAVE</b> " + Game.wave +
      "<br><b>KILLS</b> " + Game.kills +
      (mode === "zombies" ? "<br><b>COINS EARNED</b> " + Game.coins : "") +
      "<br><b>SURVIVED</b> " + Math.floor(Game.timeAlive) + "s";
    this.els["over-hi"].textContent = isBest ? "\u2B50 NEW BEST! \u2B50" : "BEST " + Game.best[mode === "zombies" ? "zombies" : "district"];
    this.show("screen-over");
    this.hide("hud");
    this.hide("banner");
  },

  showShop() {
    this.renderShop();
    this.show("screen-shop");
    this.els["screen-shop"].classList.remove("hidden");
  },

  renderShop() {
    if (!this.els["shop-wave"]) return;
    this.els["shop-wave"].textContent = Game.wave;
    this.els["shop-coins"].textContent = "¢ " + Game.coins;
    const cost = 30 + Math.floor(Game.wave / 4) * 10;
    this.els["shop-heal-c"].textContent = cost + "¢";
    this.els["shop-grenade-c"].textContent = "15¢";
    const host = this.els["shop-cards"];
    host.innerHTML = "";
    for (const u of Game.upgradeCards) {
      const d = document.createElement("button");
      d.className = "shop-card";
      d.innerHTML = '<div class="ic">' + u.ic + '</div><div class="tt">' + u.tt +
        '</div><div class="ds">' + u.ds + '</div><div class="lv">LV ' + ((Game.upgradeLevels[u.id] || 0) + 1) + "</div>";
      d.onclick = () => Game.applyUpgrade(u.id);
      host.appendChild(d);
    }
  },

  flashCoins() {
    this.els["shop-coins"].style.color = "#d94f3d";
    setTimeout(() => this.els["shop-coins"].style.color = "", 500);
  },

  updateRot() {
    if (window.innerHeight > window.innerWidth && window.innerHeight > 800) this.show("rot-tip");
    else this.hide("rot-tip");
    clearTimeout(this._rotT);
    this._rotT = setTimeout(() => this.hide("rot-tip"), 4000);
  },
};
