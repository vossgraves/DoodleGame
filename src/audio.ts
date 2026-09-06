/* audio.ts — procedural WebAudio SFX + a tiny chiptune sequencer (ported) */

class AudioSysClass {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  fxBus: GainNode | null = null;
  musBus: GainNode | null = null;
  noiseBuf: AudioBuffer | null = null;
  musicOn = true;
  sfxOn = true;
  vibOn = true;
  zombieMode = false;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private seqStep = 0;
  private seqNext = 0;
  private bass: number[] = [];
  private lead: number[] = [];

  init() {
    if (this.ctx) return;
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.fxBus = this.ctx.createGain(); this.fxBus.gain.value = 1; this.fxBus.connect(this.master);
      this.musBus = this.ctx.createGain(); this.musBus.gain.value = 0.4; this.musBus.connect(this.master);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume(); }
  setMusic(on: boolean) { this.musicOn = on; }
  setSfx(on: boolean) { this.sfxOn = on; }
  setVibe(on: boolean) { this.vibOn = on; }

  vibrate(ms: number | number[]) {
    if (!this.vibOn) return;
    try { if ("vibrate" in navigator) navigator.vibrate(ms); } catch { /* ignore */ }
  }

  tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.25, slide = 0, bus: GainNode | null = null, when = 0) {
    if (!this.ctx || !this.fxBus) return;
    if (!this.sfxOn && bus === null) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(bus || this.fxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur: number, vol = 0.3, filterFreq = 1200, when = 0, bus: GainNode | null = null) {
    if (!this.ctx || !this.fxBus || !this.noiseBuf) return;
    if (!this.sfxOn && bus === null) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || this.fxBus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  sfx(name: string) {
    if (!this.ctx || !this.sfxOn) return;
    switch (name) {
      case "shot": case "rifle": this.noise(0.11, 0.32, 2400); this.tone(260, .12, "square", .14, -160); break;
      case "shotgun": this.noise(0.22, 0.5, 1600); this.tone(120, .2, "square", .2, -70); break;
      case "sniper": this.noise(0.3, 0.5, 3200); this.tone(90, .3, "sawtooth", .22, -50); break;
      case "slash": this.noise(0.1, 0.22, 5200); this.tone(1100, .09, "triangle", .12, 500); break;
      case "dashslash": this.noise(0.3, .4, 3600); this.tone(1000, .25, "sawtooth", .25, -700); break;
      case "hit": this.noise(0.06, 0.18, 900); break;
      case "hurt": this.tone(180, .18, "sawtooth", .28, -90); this.noise(0.12, .2, 700); this.vibrate(60); break;
      case "death": this.tone(300, .5, "sawtooth", .3, -240); this.noise(0.4, .3, 600); break;
      case "kill": this.tone(660, .09, "square", .12, 200); break;
      case "coin": this.tone(920, .07, "square", .16); this.tone(1310, .1, "square", .14, 0, null, .07); break;
      case "reload": this.tone(420, .06, "square", .14); this.tone(620, .06, "square", .14, 0, null, .08); this.noise(0.06, .12, 3000, .15); break;
      case "empty": this.tone(180, .08, "square", .14, -40); break;
      case "grenade": this.noise(0.3, .2, 800); this.tone(140, .2, "triangle", .18, 60); break;
      case "explosion": this.noise(0.7, .55, 500); this.tone(70, .5, "sawtooth", .35, -40); this.vibrate(80); break;
      case "dash": this.noise(0.2, .25, 2400); this.tone(700, .16, "sine", .16, -420); break;
      case "wave": this.tone(520, .12, "triangle", .2); this.tone(780, .14, "triangle", .18, 0, null, .1); break;
      case "boss": this.tone(110, .5, "sawtooth", .3, -50); this.tone(160, .4, "square", .2, -40, null, .2); this.vibrate([90, 40, 90]); break;
      case "buy": this.tone(780, .09, "square", .15); this.tone(1040, .12, "square", .13, 0, null, .08); break;
      case "deny": this.tone(180, .16, "square", .18, -60); break;
      case "zdie": this.tone(220, .4, "sawtooth", .2, -170); this.noise(0.35, .25, 700); break;
      case "bite": this.noise(0.15, .35, 500); this.tone(200, .12, "square", .15, -60); break;
      case "shop": this.tone(620, .1, "triangle", .2); this.tone(830, .1, "triangle", .2, 0, null, .09); this.tone(1040, .16, "triangle", .2, 0, null, .18); break;
      case "over": this.tone(392, .3, "triangle", .2); this.tone(330, .3, "triangle", .2, 0, null, .28); this.tone(262, .6, "triangle", .22, 0, null, .56); break;
      case "heal": this.tone(520, .1, "sine", .18); this.tone(700, .14, "sine", .16, 0, null, .09); break;
      case "switch": this.tone(340, .05, "square", .1, 120); break;
    }
  }

  /* music sequencer */
  startMusic(zombie = false) {
    this.zombieMode = zombie;
    this.stopMusic();
    if (!this.ctx) return;
    this.seqStep = 0;
    this.seqNext = this.ctx.currentTime + 0.1;
    this.bass = zombie ? [0, 0, 7, 0, 3, 3, 10, 7] : [0, 0, 7, 0, 5, 5, 3, 3];
    this.lead = zombie ? [0, -1, 0, -1, 3, -1, 2, 3] : [7, 99, 7, 99, 10, 99, 12, 99];
    this.musicTimer = setInterval(() => this.tick(), 60);
    this.tick();
  }

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  private tick() {
    if (!this.ctx || !this.musBus || !this.musicOn) return;
    const stepDur = this.zombieMode ? 0.23 : 0.19;
    while (this.seqNext < this.ctx.currentTime + 0.25) {
      const when = this.seqNext - this.ctx.currentTime;
      const s = this.seqStep % 8;
      const root = this.zombieMode ? 55 : 110;
      const b = this.bass[s] ?? 0;
      const bassF = root * Math.pow(2, b / 12);
      this.tone(bassF, stepDur * 0.9, this.zombieMode ? "sawtooth" : "triangle", 0.3, 0, this.musBus, when);
      if (s % 4 === 2) this.tone(bassF * 1.5, stepDur * 0.5, "sine", 0.18, 0, this.musBus, when);
      if (this.zombieMode && s % 2 === 0) this.tone(root * Math.pow(2, 1.5 / 12), stepDur * 0.4, "sine", 0.12, -10, this.musBus, when);
      const l = this.lead[s] ?? 99;
      if (l !== 99) this.tone(root * 4 * Math.pow(2, l / 12), stepDur * 0.7, "square", 0.1, 0, this.musBus, when);
      if (!this.zombieMode && Math.random() < 0.25) {
        const note = U_pick([0, 3, 5, 7]);
        this.tone(root * 6 * Math.pow(2, note / 12), stepDur * 1.4, "sine", 0.05, 0, this.musBus, when);
      }
      this.seqNext += stepDur;
      this.seqStep++;
    }
  }
}

function U_pick<T>(arr: T[]): T { return arr[(Math.random() * arr.length) | 0]; }

export const AudioSys = new AudioSysClass();
