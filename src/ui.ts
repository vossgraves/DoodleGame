/* ui.ts — DOM HUD wiring on top of Game */
import { Store } from "./utils";
import { AudioSys } from "./audio";
import { Input } from "./input";
import type { Game } from "./game";
import type { Mode } from "./types";

export class UI {
  private game: Game;
  private els: Record<string, HTMLElement | null> = {};
  private chips: HTMLElement[] = [];
  private chipsLen = 0;
  private bossOn = false;

  constructor(game: Game) {
    this.game = game;
    const ids = ["hud", "banner", "banner-title", "banner-sub", "toasts",
      "hp-fill", "hp-text", "wave-num", "enemies-num", "score", "score-hi", "combo", "combo-num",
      "boss-bar", "boss-fill", "weapon-chips", "grenade-count", "dash-dot", "katana-dot",
      "screen-menu", "screen-howto", "screen-settings", "screen-pause", "screen-shop", "screen-over",
      "pause-stats", "over-title", "over-stats", "over-hi", "shop-wave", "shop-cards", "shop-coins",
      "shop-heal-c", "shop-grenade-c", "hint", "hint-text", "hint-sub", "attract-tip",
      "btn-mute", "btn-restart-quick"];
    for (const id of ids) this.els[id] = document.getElementById(id);
    this.els["hi-district"] = document.getElementById("hi-district");
    this.els["hi-zombies"] = document.getElementById("hi-zombies");
    this.updateMenuBest();
    this.els["attract-tip"]?.classList.remove("hidden");
    this.els["btn-mute"]?.classList.add("hidden");
  }

  private el(id: string) { return this.els[id] as HTMLElement | null; }
  private show(id: string) { this.el(id)?.classList.remove("hidden"); }
  private hide(id: string) { this.el(id)?.classList.add("hidden"); }

  updateMenuBest() {
    if (!this.el("hi-district") || !this.el("hi-zombies")) return;
    this.el("hi-district")!.textContent = "DISTRICT BEST " + this.game.best.district;
    this.el("hi-zombies")!.textContent = "ZOMBIES BEST " + this.game.best.zombies;
  }

  onMenu() {
    this.show("screen-menu");
    for (const id of ["hud", "screen-howto", "screen-settings", "screen-pause", "screen-shop", "screen-over", "banner"]) this.hide(id);
    Input.showTouchUI(false);
    this.updateMenuBest();
  }

  onGameOver(mode: Mode, isBest: boolean) {
    const g = this.game;
    this.el("over-title")!.textContent = mode === "zombies" ? "THE HORDE WINS" : "GAME OVER";
    this.el("over-title")!.classList.toggle("zombies", mode === "zombies");
    this.el("over-stats")!.innerHTML =
      "<b>SCORE</b> " + g.score + "<br><b>WAVE</b> " + g.wave +
      "<br><b>KILLS</b> " + g.kills +
      (mode === "zombies" ? "<br><b>COINS EARNED</b> " + g.coins : "") +
      "<br><b>SURVIVED</b> " + Math.floor(g.timeAlive) + "s";
    this.el("over-hi")!.textContent = isBest ? "⭐ NEW BEST! ⭐" : "BEST " + g.best[mode === "zombies" ? "zombies" : "district"];
    this.show("screen-over");
    this.hide("hud");
    this.hide("banner");
  }

  onPause(on: boolean) {
    if (on) {
      const g = this.game;
      this.el("pause-stats")!.innerHTML =
        "<b>SCORE</b> " + g.score + "<br><b>WAVE</b> " + g.wave +
        "<br><b>KILLS</b> " + g.kills + "<br><b>TIME</b> " + Math.floor(g.timeAlive) + "s";
      this.show("screen-pause");
    } else this.hide("screen-pause");
  }

  onShop(open: boolean) {
    if (!open) { this.hide("screen-shop"); return; }
    this.renderShop();
    this.show("screen-shop");
  }

  onToast(msg: string, cls: string) {
    const host = this.el("toasts")!;
    const d = document.createElement("div");
    d.className = "toast " + cls;
    d.textContent = msg;
    host.appendChild(d);
    setTimeout(() => d.remove(), 2700);
    while (host.children.length > 3) host.firstElementChild?.remove();
  }

  showBanner(title: string, sub: string) {
    const b = this.el("banner")!;
    this.el("banner-title")!.textContent = title;
    this.el("banner-sub")!.textContent = sub || "";
    b.classList.remove("hidden");
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "";
    clearTimeout(this._bT);
    this._bT = setTimeout(() => this.hide("banner") as unknown as void, 3000);
  }
  private _bT = 0;

  onShowBoss(show: boolean) {
    this.bossOn = show;
    if (show) this.show("boss-bar"); else this.hide("boss-bar");
  }

  updateHUD() {
    const g = this.game;
    if (g.state !== "play" && g.state !== "paused" && g.state !== "shop") return;
    const p = g.player;
    if (!p) return;
    const pct = Math.min(1, Math.max(0, p.hp / p.maxHp));
    this.el("hp-fill")!.style.width = (pct * 100) + "%";
    this.el("hp-fill")!.style.background = pct > .5 ? "#3f9d63" : pct > .25 ? "#e8b731" : "#d94f3d";
    this.el("hp-text")!.textContent = Math.max(0, Math.ceil(p.hp)) + "/" + p.maxHp;
    this.el("wave-num")!.textContent = String(g.wave);
    this.el("enemies-num")!.textContent = String(g.enemiesLeft());
    this.el("score")!.textContent = String(g.score);
    this.el("score-hi")!.textContent = "BEST " + g.best[g.mode];
    const comboOn = p.combo > 1;
    this.el("combo")!.classList.toggle("hidden", !comboOn);
    this.el("combo-num")!.textContent = "×" + p.combo.toFixed(1);
    this.el("grenade-count")!.textContent = "💣 ×" + p.grenades;
    this.el("dash-dot")!.classList.toggle("ready", p.dashCd <= 0);
    this.el("katana-dot")!.classList.toggle("ready", p.katanaGauge >= 1);
    const dw = document.getElementById("btn-dash");
    if (dw) {
      dw.classList.toggle("ready", p.dashCd <= 0);
      dw.classList.toggle("cooldown", p.dashCd > 0);
      const span = dw.querySelector("span");
      if (span) span.textContent = p.dashCd > 0 ? p.dashCd.toFixed(1) : "DASH";
    }
    if (g.boss) {
      this.el("boss-fill")!.style.width = (Math.min(1, Math.max(0, g.boss.hp / g.boss.maxHp)) * 100) + "%";
      this.show("boss-bar");
    } else if (this.bossOn) this.hide("boss-bar");
    if (!this.chips.length || this.chipsLen !== p.weapons.length) this.buildChips(p.weapons.length);
    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i];
      const w = p.weapons[i];
      c.classList.toggle("active", i === p.wIndex);
      const am = c.querySelector(".am");
      if (am) am.textContent = w.def.melee ? "∞" : (w.reloading ? "reloading…" : w.ammo + "/" + w.reserve);
    }
  }

  private buildChips(n: number) {
    const host = this.el("weapon-chips")!;
    host.innerHTML = "";
    this.chips = [];
    const p = this.game.player;
    for (let i = 0; i < n; i++) {
      const w = p.weapons[i];
      const div = document.createElement("div");
      div.className = "wchip";
      const key = document.createElement("span");
      key.className = "key"; key.textContent = String(i + 1);
      const nm = document.createElement("span");
      nm.className = "nm"; nm.textContent = w.def.name;
      const am = document.createElement("span");
      am.className = "am";
      div.append(key, nm, am);
      div.title = w.def.desc;
      host.appendChild(div);
      this.chips.push(div);
    }
    this.chipsLen = n;
  }

  updateHint() {
    const hint = this.el("hint");
    if (!hint) return;
    if (this.game.hintT < 7 && this.game.state === "play") {
      this.show("hint");
      const touch = Input.isTouchActive();
      this.el("hint-text")!.textContent = touch
        ? "left stick move · right stick aim + fire · DASH to dodge · ▤ weapons"
        : "WASD move · mouse aim · LMB fire · C dash · F katana · G grenade · R reload";
      this.el("hint-sub")!.textContent = touch ? "hold the 💣 to throw it further" : "kill doodles to fill the SLASH gauge";
    } else this.hide("hint");
  }

  renderShop() {
    const g = this.game;
    this.el("shop-wave")!.textContent = String(g.wave);
    this.el("shop-coins")!.textContent = "¢ " + g.coins;
    this.el("shop-heal-c")!.textContent = (30 + Math.floor(g.wave / 4) * 10) + "¢";
    this.el("shop-grenade-c")!.textContent = "15¢";
    const host = this.el("shop-cards")!;
    host.innerHTML = "";
    for (const u of g.upgradeCards) {
      const d = document.createElement("button");
      d.className = "shop-card";
      const ic = document.createElement("div"); ic.className = "ic"; ic.textContent = u.ic;
      const tt = document.createElement("div"); tt.className = "tt"; tt.textContent = u.tt;
      const ds = document.createElement("div"); ds.className = "ds"; ds.textContent = u.ds;
      const lv = document.createElement("div"); lv.className = "lv";
      lv.textContent = "LV " + ((g.upgradeLevels[u.id] || 0) + 1);
      d.append(ic, tt, ds, lv);
      d.onclick = () => g.applyUpgrade(u.id);
      host.appendChild(d);
    }
  }

  /* settings persisting */
  syncSettings(musicBtn: HTMLButtonElement, sfxBtn: HTMLButtonElement, vibeBtn: HTMLButtonElement, assistBtn: HTMLButtonElement, touchBtn: HTMLButtonElement, sens: HTMLInputElement) {
    const set = (b: HTMLButtonElement, v: boolean) => {
      b.classList.toggle("on", v);
      b.classList.toggle("off", !v);
      b.textContent = v ? "ON" : "OFF";
    };
    set(musicBtn, Store.get("music", true));
    set(sfxBtn, Store.get("sfx", true));
    set(vibeBtn, Store.get("vibe", true));
    set(assistBtn, Store.get("assist", true));
    set(touchBtn, Store.get("force-touch", false));
    sens.value = String(Store.get("sens", 100));
    AudioSys.setMusic(Store.get("music", true));
    AudioSys.setSfx(Store.get("sfx", true));
    AudioSys.setVibe(Store.get("vibe", true));
    const mv = document.getElementById("set-sens-val");
    if (mv) mv.textContent = sens.value + "%";
  }
}
