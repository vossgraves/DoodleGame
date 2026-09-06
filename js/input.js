/* input.js — keyboard / mouse / gamepad / multitouch unified input */
"use strict";

const Input = {
  keys: new Set(),
  keysPressed: new Set(),
  mouse: { x: 0, y: 0, dx: 0, dy: 0, lmb: false, rmb: false, wheel: 0 },
  gamepadIdx: null,
  touchMode: false,
  touch: {
    moveX: 0, moveY: 0, aimX: 0, aimY: 0,
    stickMove: 0, stickAim: 0,
    fire: false,
    btnState: {},        // per-button pointer captured
    lastChange: 0,
  },
  canvas: null,
  deviceType: "desktop",

  init(canvas) {
    this.canvas = canvas;
    this.deviceType = (navigator.maxTouchPoints > 0 || navigator.userAgent.match(/Android|iPhone|iPad|iPod|Mobile/i)) ? "touch" : "desktop";

    window.addEventListener("keydown", (e) => {
      if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.keysPressed.add(e.code);
      this.keys.add(e.code);
      // ignore browser shortcuts during play
      if (e.code === "Tab" && Game.state === "play") { e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouse.lmb = false; this.mouse.rmb = false; this.touch.fire = false; });

    window.addEventListener("mousemove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
      this.mouse.dx += (nx - this.mouse.x) * (Game.view?.w || 1280);
      this.mouse.dy += (ny - this.mouse.y) * (Game.view?.h || 720);
      this.mouse.x = nx; this.mouse.y = ny;
    });
    window.addEventListener("mousedown", (e) => {
      if (Game.state === "play") e.preventDefault();
      if (e.button === 0) this.mouse.lmb = true;
      if (e.button === 2) this.mouse.rmb = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.lmb = false;
      if (e.button === 2) this.mouse.rmb = false;
    });
    window.addEventListener("contextmenu", (e) => { if (Game.state === "play") e.preventDefault(); });
    window.addEventListener("wheel", (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    // ---- touch ----
    this.bindTouch();
    // horizontal pages (mobile) touch
    window.addEventListener("orientationchange", () => { setTimeout(() => Game.resize(), 250); });

    // ---- gamepad ----
    window.addEventListener("gamepadconnected", (e) => { this.gamepadIdx = e.gamepad.index; });
    window.addEventListener("gamepaddisconnected", (e) => { if (this.gamepadIdx === e.gamepad.index) this.gamepadIdx = null; });
  },

  /* ---------------- touch controls ---------------- */
  showTouchUI(show) {
    const ui = document.getElementById("touch-ui");
    if (show) ui.classList.remove("hidden"); else ui.classList.add("hidden");
  },

  bindTouch() {
    const zones = {
      "stick-move": "stickMove", "stick-aim": "stickAim",
      "btn-fire": "fire", "btn-dash": "dash", "btn-grenade": "grenade",
      "btn-reload": "reload", "btn-weapon": "weapon",
    };
    for (const [id, key] of Object.entries(zones)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.pointerType === "mouse" && !Input.touchMode) return;
        if (!this.touchMode) { this.touchMode = true; Game.onTouchMode(true); }
        this.touchMode = true;
        const t = this.touch;
        t[`${key}Pt`] = e.pointerId;
        if (key === "stickMove" || key === "stickAim") {
          const r = el.getBoundingClientRect();
          const sz = Math.min(r.width, r.height);
          t[key] = { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, sz, dx: 0, dy: 0 };
          el.classList.add("active");
          this.updateStick(t[key], e.clientX, e.clientY);
          t.lastChange = performance.now();
        } else if (key === "fire") { t.fire = true; t.lastChange = performance.now(); }
        else if (key === "pause") { Game.pauseGame(); }
        else { t.btnState[key] = true; t.lastChange = performance.now(); }
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
      });
      el.addEventListener("pointermove", (e) => {
        const t = this.touch;
        if (t.stickMove?.el === el) this.updateStick(t.stickMove, e.clientX, e.clientY);
        if (t.stickAim?.el === el) this.updateStick(t.stickAim, e.clientX, e.clientY);
      });
      const end = (e) => {
        const t = this.touch;
        if (key === "stickMove" && t.stickMove) { t.stickMove.dx = t.stickMove.dy = 0; el.classList.remove("active"); }
        if (key === "stickAim" && t.stickAim) { t.stickAim.dx = t.stickAim.dy = 0; el.classList.remove("active"); }
        if (key === "fire") t.fire = false;
        t.btnState[key] = false;
        t.stickMovePt === e.pointerId && (t.stickMovePt = null);
        t.stickAimPt === e.pointerId && (t.stickAimPt = null);
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
    }
  },
  setStickUI(key, dx, dy) {
    const t = this.touch;
    const st = t[key];
    if (!st || !st.el) return;
    const kb = st.el.querySelector(".stick-knob");
    if (kb) kb.style.transform = `translate(calc(-50% + ${dx * st.sz * 0.3}px), calc(-50% + ${dy * st.sz * 0.3}px)) rotate(${dx<0?-4:4}deg)`;
  },
  updateStick(st, cx, cy) {
    let dx = (cx - st.cx) / (st.sz * 0.38);
    let dy = (cy - st.cy) / (st.sz * 0.38);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    st.dx = dx; st.dy = dy;
    Input.setStickUI(st === Input.touch.stickMove ? "stickMove" : "stickAim", dx, dy);
  },

  /* ---------------- unified query ---------------- */
  isTouchActive() {
    return this.touchMode ||
      (this.touch.stickMove && (Math.abs(this.touch.stickMove.dx) + Math.abs(this.touch.stickMove.dy) > .05)) ||
      this.touch.fire || Object.values(this.touch.btnState).some(Boolean);
  },

  getMove() {
    let x = 0, y = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    let mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; mag = 1; }
    // touch joystick overrides
    const st = this.touch.stickMove;
    if (st && (Math.abs(st.dx) + Math.abs(st.dy) > 0.05)) {
      x = st.dx; y = st.dy; mag = Math.hypot(x, y);
    }
    let sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    if (st && mag > 0.92) sprint = true;
    return { x, y, mag, sprint };
  },

  getAim() {
    // returns {x,y} world-ish aim direction (length <= 1) or null
    const st = this.touch.stickAim;
    if (st && (Math.abs(st.dx) + Math.abs(st.dy) > 0.12)) {
      return { x: st.dx, y: st.dy, mag: Math.min(1, Math.hypot(st.dx, st.dy)) };
    }
    return null;
  },

  getGamepad() {
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
    return {
      lx, ly, rx, ry,
      a: gp.buttons[0]?.pressed, b: gp.buttons[1]?.pressed,
      x: gp.buttons[2]?.pressed, y: gp.buttons[3]?.pressed,
      lb: gp.buttons[4]?.pressed, rb: gp.buttons[5]?.pressed,
      lt: gp.buttons[6]?.value || 0, rt: gp.buttons[7]?.value || 0,
      back: gp.buttons[8]?.pressed, start: gp.buttons[9]?.pressed,
      l3: gp.buttons[10]?.pressed, r3: gp.buttons[11]?.pressed,
      dpad: [gp.buttons[12]?.pressed, gp.buttons[13]?.pressed, gp.buttons[14]?.pressed, gp.buttons[15]?.pressed],
    };
  },

  endFrame() {
    this.keysPressed.clear();
    this.mouse.wheel = 0;
    this.mouse.dx = 0; this.mouse.dy = 0;
  },

  pressed(code) { return this.keysPressed.has(code); },
  down(code) { return this.keys.has(code); },
};
