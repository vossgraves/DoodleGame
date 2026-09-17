import { clamp } from "./math";

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
  }
  return out;
}

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

export function setBinding(action: string, code: string) {
  if (!(action in DEFAULT_KEYS)) return;
  for (const a of Object.keys(bindings)) {
    if (a !== action) bindings[a] = bindings[a].filter((k) => k !== code);
  }
  bindings[action] = [code];
  rebuild(bindings);
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

export type InputDevice = "kbm" | "touch" | "pad";

export class Input {
  canvas: HTMLCanvasElement;
  state: Record<string, boolean> = {};
  prev: Record<string, boolean> = {};
  private tapped: Record<string, boolean> = {};
  private touchTapped: Record<string, boolean> = {};
  keys: Record<string, boolean> = {};
  mouseBtns: Record<string, boolean> = {};
  move = { x: 0, y: 0 };
  look = { x: 0, y: 0 };
  mx = 0;
  my = 0;
  wheel = 0;
  mouseSens = 0.0022;
  touchSens = 0.0045;
  padSensX = 3.4;
  padSensY = 2.6;
  adsSens = { hip: 1, ads: 0.8, scope: 0.6, sniper: 0.42 };
  aimZoom = 1;
  invertY = false;
  usingGamepad = false;
  gamepadIndex = -1;
  pointerLocked = false;
  lockLostAt = 0;
  wantLock = false;
  isTouch = false;
  device: InputDevice = "kbm";
  onDeviceChange: ((device: InputDevice) => void) | null = null;
  private _textMode = false;
  get textMode() { return this._textMode; }
  set textMode(value: boolean) {
    this._textMode = value;
    if (value) this.clear();
  }
  lastCode = "";
  touchMove = { x: 0, y: 0 };
  touchLookAcc = { x: 0, y: 0 };
  touchButtons: Record<string, boolean> = {};
  private padHoldTime = 0;
  private padState: Record<string, boolean> = {};
  private padPrev: Record<string, boolean> = {};
  private _pad: Gamepad | null = null;
  private _lockRetry = 0;
  private events = new AbortController();
  private disposed = false;
  private focused = true;
  private lastTouchAt = -Infinity;
  private heldCodes = new Map<string, string>();
  private lockAttempt = 0;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setDevice(window.matchMedia("(pointer: coarse)").matches ? "touch" : "kbm");
    const options = { signal: this.events.signal };
    const onWindow = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) =>
      window.addEventListener(type, fn, options);
    const onDocument = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) =>
      document.addEventListener(type, fn, options);

    onWindow("keydown", (e) => {
      if (e.repeat) return;
      this.setDevice("kbm");
      if (this.textMode || this.editing()) return;
      this.lastCode = e.code;
      const a = KEYMAP[e.code];
      if (a) {
        this.heldCodes.set(e.code, a);
        this.keys[a] = true;
        this.tapped[a] = true;
        e.preventDefault();
      }
      if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F5"].includes(e.code)) e.preventDefault();
    });
    onWindow("keyup", (e) => {
      const a = this.heldCodes.get(e.code);
      this.heldCodes.delete(e.code);
      if (a) this.keys[a] = [...this.heldCodes.values()].includes(a);
    });
    onDocument("visibilitychange", () => {
      if (document.hidden) this.clear();
    });
    onWindow("blur", () => {
      this.focused = false;
      this.clear();
    });
    onWindow("focus", () => { this.focused = true; });
    onDocument("focusin", () => {
      if (this.editing()) this.clear();
    });
    // Capture touch before HUD handlers stop propagation; compatibility mouse events must not undo it.
    document.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        this.lastTouchAt = performance.now();
        this.setDevice("touch");
      } else if (e.pointerType === "mouse" && !this.syntheticMouse(e)) this.setDevice("kbm");
    }, { ...options, capture: true });
    document.addEventListener("touchstart", () => {
      this.lastTouchAt = performance.now();
      this.setDevice("touch");
    }, { ...options, capture: true, passive: true });
    document.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch" || e.pointerType === "pen") this.lastTouchAt = performance.now();
    }, { ...options, capture: true });
    document.addEventListener("touchend", () => { this.lastTouchAt = performance.now(); },
      { ...options, capture: true, passive: true });
    document.addEventListener("pointercancel", () => this.clearTouch(), { ...options, capture: true });
    document.addEventListener("touchcancel", () => this.clearTouch(), { ...options, capture: true });
    onDocument("mousemove", (e) => {
      if (this.syntheticMouse(e)) return;
      let dx = e.movementX, dy = e.movementY;
      if (Math.abs(dx) > 400) dx = 0;
      if (Math.abs(dy) > 400) dy = 0;
      if (dx || dy) this.setDevice("kbm");
      if (!this.pointerLocked || this.textMode || this.editing()) return;
      this.mx += dx;
      this.my += dy;
    });
    onDocument("mousedown", (e) => {
      if (this.syntheticMouse(e)) return;
      this.setDevice("kbm");
      const a = MOUSEMAP[e.button];
      if (a && this.pointerLocked && !this.textMode && !this.editing()) {
        this.mouseBtns[a] = true;
        this.tapped[a] = true;
      }
      if (e.button === 1 && this.pointerLocked) e.preventDefault();
    });
    onDocument("mouseup", (e) => {
      const a = MOUSEMAP[e.button];
      if (a) this.mouseBtns[a] = false;
    });
    onDocument("contextmenu", (e) => { if (this.pointerLocked) e.preventDefault(); });
    document.addEventListener("wheel", (e) => {
      if (!e.deltaX && !e.deltaY || this.syntheticMouse(e)) return;
      this.setDevice("kbm");
      if (this.pointerLocked && !this.textMode && !this.editing()) this.wheel += Math.sign(e.deltaY);
    }, { ...options, passive: true });
    onDocument("pointerlockchange", () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked && (!this.wantLock || this.isTouch)) {
        document.exitPointerLock();
        return;
      }
      if (locked === this.pointerLocked) return;
      this.pointerLocked = locked;
      if (!locked) {
        this.lockLostAt = performance.now();
        this.exitLock();
      }
      this.onLockChange?.(locked);
    });
    onWindow("gamepaddisconnected", (e) => {
      if (e.gamepad.index !== this.gamepadIndex) return;
      this.gamepadIndex = -1;
      this._pad = null;
      this.clear();
      if (this.device === "pad") this.setDevice("kbm");
    });
  }

  private editing() {
    const ae = document.activeElement as HTMLElement | null;
    return !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
  }

  private syntheticMouse(e: MouseEvent) {
    const caps = (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } | null }).sourceCapabilities;
    return caps ? caps.firesTouchEvents : performance.now() - this.lastTouchAt < 800;
  }

  setDevice(device: InputDevice) {
    if (this.disposed) return;
    const changed = this.device !== device;
    this.device = device;
    this.isTouch = device === "touch";
    this.usingGamepad = device === "pad";
    if (!changed) return;
    if (device !== "touch") this.clearTouch();
    if (device === "touch") this.exitLock();
    this.onDeviceChange?.(device);
  }

  clear() {
    this.keys = {};
    this.heldCodes.clear();
    this.mouseBtns = {};
    this.clearTouch();
    this.tapped = {};
    this.state = {};
    this.prev = {};
    this.padState = {};
    this.padPrev = {};
    this.padHoldTime = 0;
    this.mx = this.my = this.wheel = 0;
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.events.abort();
    this.onLockChange = null;
    this.onDeviceChange = null;
    this.exitLock();
    this.pointerLocked = false;
    this._pad = null;
  }

  requestLock() {
    if (this.disposed || this.isTouch || this.textMode) return;
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
    const id = ++this.lockAttempt;
    const wanted = () => !this.disposed && this.wantLock && !this.isTouch && id === this.lockAttempt;
    attempt({ unadjustedMovement: true } as PointerLockOptions).then(() => {
      if (!wanted() && document.pointerLockElement === this.canvas) document.exitPointerLock();
    }).catch(() => {
      if (!wanted()) return;
      return attempt().then(() => {
        if (!wanted() && document.pointerLockElement === this.canvas) document.exitPointerLock();
      }).catch(() => {
        if (!wanted()) return;
        clearTimeout(this._lockRetry);
        this._lockRetry = window.setTimeout(() => {
          if (wanted() && !this.pointerLocked) this.requestLock();
        }, 1200);
      });
    });
  }

  exitLock() {
    this.wantLock = false;
    this.lockAttempt++;
    clearTimeout(this._lockRetry);
    this.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  setTouchMove(x: number, y: number) {
    if (this.disposed || this.textMode) return;
    if (x || y) this.setDevice("touch");
    this.touchMove.x = x;
    this.touchMove.y = y;
  }
  addTouchLook(dx: number, dy: number) {
    if (this.disposed || this.textMode) return;
    if (dx || dy) this.setDevice("touch");
    this.touchLookAcc.x += dx;
    this.touchLookAcc.y += dy;
  }
  setTouch(btn: string, down: boolean) {
    if (this.disposed || this.textMode) return;
    if (down) this.setDevice("touch");
    this.touchButtons[btn] = down;
    if (down) this.touchTapped[btn] = true;
  }
  clearTouch() {
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.touchButtons = {};
    this.touchTapped = {};
    this.touchLookAcc.x = 0;
    this.touchLookAcc.y = 0;
  }

  private aimMul() {
    const z = this.aimZoom;
    if (z < 1.15) return this.adsSens.hip;
    if (z < 1.9) return this.adsSens.ads;
    if (z < 3.6) return this.adsSens.scope;
    return this.adsSens.sniper;
  }

  private getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.gamepadIndex >= 0 && pads[this.gamepadIndex]?.connected) return pads[this.gamepadIndex];
    for (const p of pads) {
      if (p && p.connected) {
        this.gamepadIndex = p.index;
        return p;
      }
    }
    return null;
  }

  update(dt: number) {
    if (this.disposed || !this.focused || document.hidden || this.textMode || this.editing()) {
      this.clear();
      return;
    }
    this.prev = this.state;
    this.state = {};
    const s = this.state;
    for (const k in this.keys) if (this.keys[k]) s[k] = true;
    for (const k in this.mouseBtns) if (this.mouseBtns[k]) s[k] = true;
    for (const k in this.touchButtons) if (this.touchButtons[k]) s[k] = true;
    for (const k in this.tapped) if (this.tapped[k]) s[k] = true;
    for (const k in this.touchTapped) if (this.touchTapped[k]) s[k] = true;
    this.tapped = {};
    this.touchTapped = {};
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
        this.setDevice("pad");
      }
      if (Math.abs(rx) > 0 || Math.abs(ry) > 0) {
        const mag = Math.hypot(rx, ry);
        if (mag > 0.94) this.padHoldTime += dt;
        else this.padHoldTime = 0;
        const accel = 1 + clamp((this.padHoldTime - 0.25) / 0.6, 0, 1) * 0.9;
        const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
        lx += -curve(rx) * this.padSensX * accel * aim * dt;
        ly += -curve(ry) * this.padSensY * accel * aim * dt;
        this.setDevice("pad");
      } else this.padHoldTime = 0;
      for (const idx in PADMAP) {
        const b = pad.buttons[Number(idx)];
        if (!b) continue;
        const pressed = b.pressed || b.value > 0.35;
        if (pressed) {
          this.setDevice("pad");
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
    }
  }
}
