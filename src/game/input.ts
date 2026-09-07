import { clamp } from "./math";

/** The default keys, and the order the settings screen lists them in. */
export const DEFAULT_KEYS: Record<string, string[]> = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["Space"],
  sprint: ["ShiftLeft", "ShiftRight"],
  crouch: ["ControlLeft", "KeyC"],
  dash: ["KeyX", "AltLeft"],
  grapple: ["KeyQ"],
  reload: ["KeyR"],
  melee: ["KeyF", "KeyV"],
  grenade: ["KeyG"],
  inspect: ["KeyI"],
  emote: ["KeyB"],
  goggles: ["KeyN"],
  slot1: ["Digit1"],
  slot2: ["Digit2"],
  slot3: ["Digit3"],
  slot4: ["Digit4"],
  nextWeapon: ["KeyE"],
  score: ["Tab"],
  pause: ["Escape", "KeyP"],
  music: ["KeyM"],
};

/** Only these are worth offering to rebind; the rest are fixed or aliases. */
export const BINDABLE: { id: string; name: string }[] = [
  { id: "forward", name: "forward" },
  { id: "back", name: "back" },
  { id: "left", name: "strafe left" },
  { id: "right", name: "strafe right" },
  { id: "jump", name: "jump" },
  { id: "sprint", name: "sprint" },
  { id: "crouch", name: "crouch / slide" },
  { id: "dash", name: "dash" },
  { id: "grapple", name: "grapple / skill" },
  { id: "reload", name: "reload" },
  { id: "melee", name: "melee" },
  { id: "grenade", name: "grenade" },
  { id: "inspect", name: "inspect weapon" },
  { id: "emote", name: "emote wheel" },
  { id: "goggles", name: "night goggles" },
  { id: "slot1", name: "weapon 1" },
  { id: "slot2", name: "weapon 2" },
  { id: "slot3", name: "weapon 3" },
  { id: "slot4", name: "weapon 4" },
  { id: "nextWeapon", name: "next weapon" },
  { id: "score", name: "scoreboard" },
];

const BINDING_KEY = "doodle_binds";

function loadBindings(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [a, keys] of Object.entries(DEFAULT_KEYS)) out[a] = [...keys];
  try {
    const saved = JSON.parse(localStorage.getItem(BINDING_KEY) || "null");
    if (saved && typeof saved === "object") {
      for (const [a, k] of Object.entries(saved as Record<string, unknown>)) {
        if (a in out && typeof k === "string" && k) out[a] = [k];
      }
    }
  } catch {
    // a corrupt binding file should cost you the customisation, not the game
  }
  return out;
}

/** action per key code, rebuilt whenever a binding changes */
let KEYMAP: Record<string, string> = {};

function rebuild(bindings: Record<string, string[]>) {
  KEYMAP = {};
  for (const [action, keys] of Object.entries(bindings)) {
    for (const k of keys) KEYMAP[k] = action;
  }
}

let bindings = loadBindings();
rebuild(bindings);

export function currentBindings() {
  return bindings;
}

/** Bind one action to one key, dropping that key from wherever it was. */
export function setBinding(action: string, code: string) {
  if (!(action in DEFAULT_KEYS)) return;
  for (const a of Object.keys(bindings)) {
    if (a !== action) bindings[a] = bindings[a].filter((k) => k !== code);
  }
  bindings[action] = [code];
  rebuild(bindings);
  // Save only what actually differs. Writing every action would freeze the
  // aliases as they are today and quietly drop the arrow keys from the actions
  // the player never touched.
  const diff: Record<string, string> = {};
  for (const [a, keys] of Object.entries(bindings)) {
    const def = DEFAULT_KEYS[a] ?? [];
    const same = keys.length === def.length && keys.every((k, i) => k === def[i]);
    if (!same && keys[0]) diff[a] = keys[0];
  }
  localStorage.setItem(BINDING_KEY, JSON.stringify(diff));
}

export function resetBindings() {
  localStorage.removeItem(BINDING_KEY);
  bindings = loadBindings();
  rebuild(bindings);
}

/** "KeyW" reads badly on a settings row; "W" does not. */
export function keyLabel(code: string) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5).toLowerCase();
  const named: Record<string, string> = {
    Space: "space",
    ShiftLeft: "l shift",
    ShiftRight: "r shift",
    ControlLeft: "l ctrl",
    ControlRight: "r ctrl",
    AltLeft: "l alt",
    AltRight: "r alt",
    Tab: "tab",
    Escape: "esc",
    Backquote: "`",
  };
  return named[code] ?? code.toLowerCase();
}
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
  /**
   * A finger drag covers far more screen than a mouse covers mousepad, so touch
   * gets its own base rather than a fudge factor on the mouse one. At this value
   * a drag across half the screen is about a quarter turn.
   */
  touchSens = 0.0045;
  padSensX = 3.4;
  padSensY = 2.6;
  /**
   * Aim sensitivity, as multipliers on the hipfire number. Splitting them by
   * magnification is the point: what feels right down an iron sight is unusable
   * through a sniper scope, because the same wrist flick covers eight times the
   * arc on screen.
   */
  adsSens = { hip: 1, ads: 0.8, scope: 0.6, sniper: 0.42 };
  /** how much the current sight magnifies, set by the player each frame */
  aimZoom = 1;
  invertY = false;
  usingGamepad = false;
  gamepadIndex = -1;
  pointerLocked = false;
  wantLock = false;
  isTouch = false;
  /**
   * True while the player is typing. Without it, saying "sniper" in chat makes
   * you crouch, sprint and reload halfway through the word.
   */
  textMode = false;
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
      if (e.repeat || this.textMode) return;
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

  /**
   * Which aim multiplier applies right now. The bands follow how the sight
   * actually behaves rather than what it is called, so a 4x on a rifle and a 4x
   * on a sniper feel the same.
   */
  private aimMul() {
    const z = this.aimZoom;
    if (z < 1.15) return this.adsSens.hip;
    if (z < 1.9) return this.adsSens.ads;
    if (z < 3.6) return this.adsSens.scope;
    return this.adsSens.sniper;
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

    const aim = this.aimMul();
    let lx = -this.mx * this.mouseSens * aim;
    let ly = -this.my * this.mouseSens * aim;
    this.mx = 0;
    this.my = 0;
    lx += -this.touchLookAcc.x * this.touchSens * aim;
    ly += -this.touchLookAcc.y * this.touchSens * aim;
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
        lx += -curve(rx) * this.padSensX * accel * aim * dt;
        ly += -curve(ry) * this.padSensY * accel * aim * dt;
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
