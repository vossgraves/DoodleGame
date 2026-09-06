/* input.ts — keyboard / mouse / gamepad / multitouch unified input */
import type { Game } from "./game";

export interface GamepadState {
  lx: number; ly: number; rx: number; ry: number;
  a: boolean; b: boolean; x: boolean; y: boolean;
  lb: boolean; rb: boolean; lt: number; rt: number;
  back: boolean; start: boolean; l3: boolean; r3: boolean;
}

class InputClass {
  keys = new Set<string>();
  keysPressed = new Set<string>();
  mouse = { x: 0, y: 0, nx: 0, ny: 0, lmb: false, rmb: false, wheel: 0 };
  gamepadIdx: number | null = null;
  touchMode = false;
  deviceType: "touch" | "desktop" = "desktop";
  canvas: HTMLElement | null = null;
  touch = {
    stickMove: null as null | { dx: number; dy: number },
    stickAim: null as null | { dx: number; dy: number },
    fire: false,
    btnState: {} as Record<string, boolean>,
  };
  gameRef: Game | null = null;

  init(canvas: HTMLElement, game: Game) {
    this.canvas = canvas;
    this.gameRef = game;
    this.deviceType = (navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) ? "touch" : "desktop";

    window.addEventListener("keydown", (e) => {
      if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.keysPressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === "Tab" && game.state === "play") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouse.lmb = false;
      this.mouse.rmb = false;
      this.touch.fire = false;
    });

    window.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.nx = (e.clientX - r.left) / r.width;
      this.mouse.ny = (e.clientY - r.top) / r.height;
    });
    window.addEventListener("mousedown", (e) => {
      if (game.state === "play") e.preventDefault();
      if (e.button === 0) this.mouse.lmb = true;
      if (e.button === 2) this.mouse.rmb = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.lmb = false;
      if (e.button === 2) this.mouse.rmb = false;
    });
    window.addEventListener("contextmenu", (e) => { if (game.state === "play") e.preventDefault(); });
    window.addEventListener("wheel", (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    this.bindTouch();

    window.addEventListener("gamepadconnected", (e) => { this.gamepadIdx = e.gamepad.index; });
    window.addEventListener("gamepaddisconnected", (e) => {
      if (this.gamepadIdx === e.gamepad.index) this.gamepadIdx = null;
    });
  }

  showTouchUI(show: boolean) {
    const ui = document.getElementById("touch-ui");
    if (ui) ui.classList.toggle("hidden", !show);
  }

  private setStickUI(key: "stickMove" | "stickAim", dx: number, dy: number) {
    const el = document.getElementById(key === "stickMove" ? "stick-move" : "stick-aim");
    const knob = el?.querySelector<HTMLElement>(".stick-knob");
    if (knob) {
      knob.style.transform = `translate(calc(-50% + ${dx * 38}px), calc(-50% + ${dy * 38}px))`;
    }
  }

  private updateStick(st: { dx: number; dy: number; cx: number; cy: number; sz: number }, key: "stickMove" | "stickAim", cx: number, cy: number) {
    let dx = (cx - st.cx) / (st.sz * 0.38);
    let dy = (cy - st.cy) / (st.sz * 0.38);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    (st as { dx: number; dy: number }).dx = dx;
    (st as { dx: number; dy: number }).dy = dy;
    this.setStickUI(key, dx, dy);
  }

  private bindTouch() {
    const zones: Record<string, string> = {
      "stick-move": "stickMove", "stick-aim": "stickAim",
      "btn-fire": "fire", "btn-dash": "dash", "btn-grenade": "grenade",
      "btn-reload": "reload", "btn-weapon": "weapon",
    };
    for (const [id, key] of Object.entries(zones)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.touchMode) {
          this.touchMode = true;
          this.gameRef?.onTouchMode();
        }
        const t = this.touch;
        if (key === "stickMove" || key === "stickAim") {
          const r = el.getBoundingClientRect();
          const sz = Math.min(r.width, r.height);
          const st = { dx: 0, dy: 0, cx: r.left + r.width / 2, cy: r.top + r.height / 2, sz };
          if (key === "stickMove") t.stickMove = st; else t.stickAim = st;
          el.classList.add("active");
          this.updateStick(st, key as "stickMove" | "stickAim", e.clientX, e.clientY);
        } else if (key === "fire") {
          t.fire = true;
        } else {
          t.btnState[key] = true;
        }
        el.setPointerCapture?.(e.pointerId);
      });
      el.addEventListener("pointermove", (e) => {
        if (key === "stickMove" && this.touch.stickMove) {
          const st = this.touch.stickMove as unknown as { cx: number; cy: number; sz: number };
          this.updateStick(Object.assign(st, this.touch.stickMove), "stickMove", e.clientX, e.clientY);
        }
        if (key === "stickAim" && this.touch.stickAim) {
          const st = this.touch.stickAim as unknown as { cx: number; cy: number; sz: number };
          this.updateStick(Object.assign(st, this.touch.stickAim), "stickAim", e.clientX, e.clientY);
        }
      });
      const end = () => {
        if (key === "stickMove") { this.touch.stickMove = null; el.classList.remove("active"); }
        if (key === "stickAim") { this.touch.stickAim = null; el.classList.remove("active"); }
        if (key === "fire") this.touch.fire = false;
        this.touch.btnState[key] = false;
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
    }
  }

  isTouchActive(): boolean {
    return this.touchMode ||
      !!(this.touch.stickMove && (Math.abs(this.touch.stickMove.dx) + Math.abs(this.touch.stickMove.dy) > .05)) ||
      this.touch.fire || Object.values(this.touch.btnState).some(Boolean);
  }

  getMove() {
    let x = 0, y = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    let mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; mag = 1; }
    const st = this.touch.stickMove;
    if (st && (Math.abs(st.dx) + Math.abs(st.dy) > 0.05)) {
      x = st.dx; y = st.dy; mag = Math.hypot(x, y);
    }
    let sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    if (st && mag > 0.92) sprint = true;
    return { x, y, mag, sprint };
  }

  getAim() {
    const st = this.touch.stickAim;
    if (st && (Math.abs(st.dx) + Math.abs(st.dy) > 0.12)) {
      return { x: st.dx, y: st.dy, mag: Math.min(1, Math.hypot(st.dx, st.dy)) };
    }
    return null;
  }

  getGamepad(): GamepadState | null {
    if (this.gamepadIdx === null) return null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[this.gamepadIdx];
    if (!gp) return null;
    let lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;
    let rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    const dead = 0.18;
    if (Math.abs(lx) < dead) lx = 0;
    if (Math.abs(ly) < dead) ly = 0;
    if (Math.abs(rx) < dead) rx = 0;
    if (Math.abs(ry) < dead) ry = 0;
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    return {
      lx, ly, rx, ry,
      a: b(0), b: b(1), x: b(2), y: b(3),
      lb: b(4), rb: b(5), lt: gp.buttons[6]?.value || 0, rt: gp.buttons[7]?.value || 0,
      back: b(8), start: b(9), l3: b(10), r3: b(11),
    };
  }

  pressed(code: string) { return this.keysPressed.has(code); }
  down(code: string) { return this.keys.has(code); }

  endFrame() {
    this.keysPressed.clear();
    this.mouse.wheel = 0;
  }
}

export const Input = new InputClass();
