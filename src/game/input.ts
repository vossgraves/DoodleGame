import { clamp } from "./math";

const KEYMAP: Record<string, string> = {
  KeyW: "forward",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "forward",
  ArrowDown: "back",
  ArrowLeft: "left",
  ArrowRight: "right",
  Space: "jump",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  ControlLeft: "crouch",
  KeyC: "crouch",
  KeyR: "reload",
  KeyF: "melee",
  KeyV: "melee",
  Digit1: "slot1",
  Digit2: "slot2",
  Digit3: "slot3",
  Digit4: "slot4",
  Escape: "pause",
  KeyP: "pause",
  KeyG: "grenade",
  KeyX: "dash",
  AltLeft: "dash",
  KeyM: "music",
  KeyQ: "grapple",
  KeyE: "nextWeapon",
  Tab: "score",
};
const MOUSEMAP: Record<number, string> = { 0: "fire", 2: "aim", 1: "melee" };
const PADMAP: Record<number, string> = {
  0: "jump",
  1: "crouch",
  2: "reload",
  3: "nextWeapon",
  4: "grenade",
  5: "melee",
  6: "aim",
  7: "fire",
  9: "pause",
  10: "sprint",
  11: "grenade",
  14: "prevWeapon",
  15: "nextWeapon",
  8: "grapple",
};

export class Input {
  canvas: HTMLCanvasElement;
  state: Record<string, boolean> = {};
  prev: Record<string, boolean> = {};
  /**
   * Actions that went down since the last frame. A tap shorter than one frame
   * would otherwise land and lift between two samples and be lost entirely —
   * which is exactly what happens to a quick jump on a struggling phone.
   */
  private tapped: Record<string, boolean> = {};
  keys: Record<string, boolean> = {};
  mouseBtns: Record<string, boolean> = {};
  move = { x: 0, y: 0 };
  look = { x: 0, y: 0 };
  mx = 0;
  my = 0;
  wheel = 0;
  mouseSens = 0.0022;
  padSensX = 3.4;
  padSensY = 2.6;
  invertY = false;
  usingGamepad = false;
  gamepadIndex = -1;
  pointerLocked = false;
  wantLock = false;
  isTouch = false;
  touchMove = { x: 0, y: 0 };
  touchLookAcc = { x: 0, y: 0 };
  touchButtons: Record<string, boolean> = {};
  private padHoldTime = 0;
  private padState: Record<string, boolean> = {};
  private padPrev: Record<string, boolean> = {};
  private _pad: Gamepad | null = null;
  private _lockRetry = 0;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const a = KEYMAP[e.code];
      if (a) {
        this.keys[a] = true;
        this.tapped[a] = true;
      }
      if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys[a] = false;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.keys = {};
        this.mouseBtns = {};
      }
    });
    window.addEventListener("blur", () => {
      this.keys = {};
      this.mouseBtns = {};
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      let dx = e.movementX,
        dy = e.movementY;
      if (Math.abs(dx) > 400) dx = 0;
      if (Math.abs(dy) > 400) dy = 0;
      this.mx += dx;
      this.my += dy;
    });
    document.addEventListener("mousedown", (e) => {
      const a = MOUSEMAP[e.button];
      if (a) {
        this.mouseBtns[a] = true;
        this.tapped[a] = true;
      }
      if (e.button === 1) e.preventDefault();
    });
    document.addEventListener("mouseup", (e) => {
      const a = MOUSEMAP[e.button];
      if (a) this.mouseBtns[a] = false;
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener(
      "wheel",
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.pointerLocked);
    });
    window.addEventListener("gamepadconnected", (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
  }

  requestLock() {
    if (this.isTouch) return;
    this.wantLock = true;
    if (this.pointerLocked) return;
    const attempt = (opts?: PointerLockOptions) => {
      try {
        const p = this.canvas.requestPointerLock(opts as PointerLockOptions);
        return p && typeof (p as Promise<void>).catch === "function" ? (p as Promise<void>) : Promise.resolve();
      } catch {
        return Promise.reject();
      }
    };
    attempt({ unadjustedMovement: true } as PointerLockOptions).catch(() =>
      attempt().catch(() => {
        clearTimeout(this._lockRetry);
        this._lockRetry = window.setTimeout(() => {
          if (this.wantLock && !this.pointerLocked) this.requestLock();
        }, 1200);
      }),
    );
  }

  exitLock() {
    this.wantLock = false;
    clearTimeout(this._lockRetry);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setTouchMove(x: number, y: number) {
    this.touchMove.x = x;
    this.touchMove.y = y;
  }
  addTouchLook(dx: number, dy: number) {
    this.touchLookAcc.x += dx;
    this.touchLookAcc.y += dy;
  }
  setTouch(btn: string, down: boolean) {
    this.touchButtons[btn] = down;
    if (down) this.tapped[btn] = true;
  }
  clearTouch() {
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.touchButtons = {};
  }

  private getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.gamepadIndex >= 0 && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads) {
      if (p && p.connected) {
        this.gamepadIndex = p.index;
        return p;
      }
    }
    return null;
  }

  update(dt: number) {
    this.prev = this.state;
    this.state = {};
    const s = this.state;
    for (const k in this.keys) if (this.keys[k]) s[k] = true;
    for (const k in this.mouseBtns) if (this.mouseBtns[k]) s[k] = true;
    for (const k in this.touchButtons) if (this.touchButtons[k]) s[k] = true;
    for (const k in this.tapped) if (this.tapped[k]) s[k] = true;
    this.tapped = {};
    if (this.wheel > 0) s.nextWeapon = true;
    else if (this.wheel < 0) s.prevWeapon = true;
    this.wheel = 0;

    let mx = (s.right ? 1 : 0) - (s.left ? 1 : 0);
    let my = (s.forward ? 1 : 0) - (s.back ? 1 : 0);
    if (Math.abs(this.touchMove.x) > 0.05 || Math.abs(this.touchMove.y) > 0.05) {
      mx = this.touchMove.x;
      my = this.touchMove.y;
    }

    let lx = -this.mx * this.mouseSens;
    let ly = -this.my * this.mouseSens;
    this.mx = 0;
    this.my = 0;
    lx += -this.touchLookAcc.x * this.mouseSens * 1.15;
    ly += -this.touchLookAcc.y * this.mouseSens * 1.15;
    this.touchLookAcc.x = 0;
    this.touchLookAcc.y = 0;

    const pad = this.getPad();
    const padS: Record<string, boolean> = {};
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      const ax = dz(pad.axes[0] || 0);
      const ay = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0);
      const ry = dz(pad.axes[3] || 0);
      if (Math.abs(ax) > 0 || Math.abs(ay) > 0) {
        mx = ax;
        my = -ay;
        this.usingGamepad = true;
      }
      if (Math.abs(rx) > 0 || Math.abs(ry) > 0) {
        const mag = Math.hypot(rx, ry);
        if (mag > 0.94) this.padHoldTime += dt;
        else this.padHoldTime = 0;
        const accel = 1 + clamp((this.padHoldTime - 0.25) / 0.6, 0, 1) * 0.9;
        const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
        lx += -curve(rx) * this.padSensX * accel * dt;
        ly += -curve(ry) * this.padSensY * accel * dt;
        this.usingGamepad = true;
      } else this.padHoldTime = 0;
      for (const idx in PADMAP) {
        const b = pad.buttons[Number(idx)];
        if (!b) continue;
        const pressed = b.pressed || b.value > 0.35;
        if (pressed) {
          s[PADMAP[Number(idx)]] = true;
          padS[PADMAP[Number(idx)]] = true;
        }
      }
      this._pad = pad;
    } else this._pad = null;
    this.padPrev = this.padState;
    this.padState = padS;

    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    this.move.x = mx;
    this.move.y = my;
    this.look.x = lx;
    this.look.y = this.invertY ? -ly : ly;
  }

  down(a: string) {
    return !!this.state[a];
  }
  pressed(a: string) {
    return (!!this.state[a] && !this.prev[a]) || (!!this.padState[a] && !this.padPrev[a]);
  }
  released(a: string) {
    return !this.state[a] && !!this.prev[a];
  }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    const pad = this._pad;
    if (!pad) return;
    const act = (pad as Gamepad & { vibrationActuator?: GamepadHapticActuator }).vibrationActuator;
    if (!act || !("playEffect" in act)) return;
    try {
      void (act as GamepadHapticActuator).playEffect("dual-rumble", {
        duration: ms,
        strongMagnitude: clamp(strong, 0, 1),
        weakMagnitude: clamp(weak, 0, 1),
      });
    } catch {
      /* ignore */
    }
  }
}
