import { clamp, choose, rand } from "./math";

type OscType = OscillatorType;

function envGain(ctx: AudioContext, t: number, a: number, s: number, r: number, peak = 0.3) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.4), t + a + s);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + s + r);
  return g;
}

export class AudioSys {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfx: GainNode | null = null;
  mus: GainNode | null = null;
  musicWanted = localStorage.getItem("doodle_music") !== "0";
  musicOn = false;
  private tune: "district" | "zombies" = "district";
  private musicTimer = 0;
  private noise: AudioBuffer | null = null;
  muted = false;

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.sfx.connect(this.master);
      this.mus = this.ctx.createGain();
      this.mus.gain.value = this.musicWanted ? 0.22 : 0;
      this.mus.connect(this.master);
      this.noise = this.makeNoise(1.2);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMusic(on: boolean) {
    this.musicWanted = on;
    localStorage.setItem("doodle_music", on ? "1" : "0");
    if (this.mus) this.mus.gain.value = on && this.musicOn ? 0.22 : 0;
  }

  setTune(t: "district" | "zombies") {
    this.tune = t;
  }

  startMusic() {
    this.ensure();
    this.musicOn = true;
    if (this.mus) this.mus.gain.value = this.musicWanted ? 0.22 : 0;
  }

  stopMusic() {
    this.musicOn = false;
    if (this.mus) this.mus.gain.value = 0;
  }

  private makeNoise(seconds: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noiseBurst(dur: number, freq: number, q: number, peak: number, type: BiquadFilterType = "bandpass") {
    if (!this.ctx || !this.sfx || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.35), t + dur);
    f.Q.value = q;
    const g = envGain(this.ctx, t, 0.004, dur * 0.25, dur * 0.7, peak);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private beep(freq: number, dur: number, type: OscType, peak: number, slide = 1) {
    if (!this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    const g = envGain(this.ctx, t, 0.006, dur * 0.2, dur * 0.75, peak);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot() {
    this.ensure();
    this.noiseBurst(0.09, 1800, 1.2, 0.22);
    this.beep(220, 0.07, "square", 0.08, 0.45);
  }
  suppressed() {
    this.ensure();
    this.noiseBurst(0.05, 520, 0.8, 0.07, "lowpass");
    this.beep(150, 0.05, "triangle", 0.03, 0.6);
  }
  shotgun() {
    this.ensure();
    this.noiseBurst(0.18, 700, 0.7, 0.38, "lowpass");
    this.beep(90, 0.16, "sawtooth", 0.12, 0.4);
  }
  sniper() {
    this.ensure();
    this.noiseBurst(0.22, 2400, 0.9, 0.32);
    this.beep(140, 0.2, "square", 0.14, 0.3);
  }
  blade() {
    this.ensure();
    this.noiseBurst(0.1, 3200, 2.4, 0.12, "highpass");
    this.beep(880, 0.08, "triangle", 0.06, 0.5);
  }
  reload() {
    this.ensure();
    this.beep(420, 0.05, "square", 0.05, 1.4);
    setTimeout(() => this.beep(280, 0.06, "square", 0.05, 0.7), 90);
  }
  switchWeapon() {
    this.ensure();
    this.beep(360, 0.05, "triangle", 0.05);
  }
  hit() {
    this.ensure();
    this.noiseBurst(0.05, 900, 1.4, 0.12);
  }
  crit() {
    this.ensure();
    this.beep(720, 0.07, "square", 0.08, 1.6);
  }
  hurt() {
    this.ensure();
    this.noiseBurst(0.12, 280, 0.8, 0.2, "lowpass");
    this.beep(110, 0.14, "sawtooth", 0.1, 0.5);
  }
  die() {
    this.ensure();
    this.beep(180, 0.4, "sawtooth", 0.16, 0.25);
    this.noiseBurst(0.4, 200, 0.5, 0.2, "lowpass");
  }
  jump() {
    this.ensure();
    this.beep(240, 0.08, "triangle", 0.05, 1.8);
  }
  land() {
    this.ensure();
    this.noiseBurst(0.06, 180, 0.6, 0.08, "lowpass");
  }
  pickup() {
    this.ensure();
    this.beep(520, 0.08, "triangle", 0.08, 1.8);
    this.beep(780, 0.1, "triangle", 0.06, 1.2);
  }
  explode() {
    this.ensure();
    this.noiseBurst(0.32, 220, 0.5, 0.4, "lowpass");
    this.beep(70, 0.28, "sawtooth", 0.14, 0.3);
  }
  nade() {
    this.ensure();
    this.beep(200, 0.06, "square", 0.05);
  }
  wave() {
    this.ensure();
    this.beep(330, 0.1, "triangle", 0.08, 1.5);
    setTimeout(() => this.beep(440, 0.12, "triangle", 0.08, 1.4), 120);
  }
  groan() {
    this.ensure();
    this.beep(rand(70, 110), 0.28, "sawtooth", 0.05, 0.7);
  }
  parry() {
    this.ensure();
    this.beep(1400, 0.06, "square", 0.1, 0.6);
    this.noiseBurst(0.08, 4000, 2, 0.1, "highpass");
  }
  slide() {
    this.ensure();
    this.noiseBurst(0.42, 900, 0.35, 0.16, "bandpass");
  }
  wallJump() {
    this.ensure();
    this.noiseBurst(0.1, 1500, 0.5, 0.14, "bandpass");
    this.beep(320, 0.1, "triangle", 0.06, 1.6);
  }
  mantle() {
    this.ensure();
    this.noiseBurst(0.16, 700, 0.6, 0.13, "lowpass");
    this.beep(180, 0.14, "sawtooth", 0.05, 1.5);
  }
  grappleFire() {
    this.ensure();
    this.noiseBurst(0.08, 2600, 1.6, 0.1, "highpass");
    this.beep(520, 0.09, "square", 0.05, 0.5);
  }
  grappleHit() {
    this.ensure();
    this.noiseBurst(0.09, 500, 1.2, 0.16, "lowpass");
    this.beep(240, 0.1, "square", 0.08, 1.5);
  }
  dash() {
    this.ensure();
    this.noiseBurst(0.1, 600, 1, 0.1, "highpass");
  }
  step() {
    this.ensure();
    this.noiseBurst(0.04, 160, 0.7, 0.05, "lowpass");
  }
  ui() {
    this.ensure();
    this.beep(500, 0.05, "triangle", 0.06);
  }

  update(dt: number, moving: boolean, sprint: boolean) {
    if (!this.ctx || !this.mus || !this.musicOn || !this.musicWanted) return;
    this.musicTimer += dt;
    const bpm = this.tune === "zombies" ? 92 : 118;
    const beat = 60 / bpm;
    if (this.musicTimer >= beat) {
      this.musicTimer -= beat;
      this.tickMusic();
    }
    void moving;
    void sprint;
  }

  private tickMusic() {
    if (!this.ctx || !this.mus) return;
    const t = this.ctx.currentTime;
    const scale =
      this.tune === "zombies"
        ? [110, 130.8, 146.8, 164.8, 196, 220, 261.6]
        : [196, 220, 246.9, 261.6, 293.7, 329.6, 392];
    const note = choose(scale);
    const o = this.ctx.createOscillator();
    o.type = this.tune === "zombies" ? "sawtooth" : "triangle";
    o.frequency.value = note * (Math.random() < 0.15 ? 0.5 : 1);
    const g = this.ctx.createGain();
    const peak = this.tune === "zombies" ? 0.07 : 0.09;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = this.tune === "zombies" ? 900 : 1800;
    o.connect(f);
    f.connect(g);
    g.connect(this.mus);
    o.start(t);
    o.stop(t + 0.25);
    if (Math.random() < 0.35) {
      const o2 = this.ctx.createOscillator();
      o2.type = "square";
      o2.frequency.value = note * 2;
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.03, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o2.connect(g2);
      g2.connect(this.mus);
      o2.start(t);
      o2.stop(t + 0.14);
    }
  }

  setListener(_x: number, _y: number, _z: number) {
  }

  rumblePad(input: { rumble: (a: number, b: number, ms: number) => void }, a: number, b: number, ms: number) {
    input.rumble(clamp(a, 0, 1), clamp(b, 0, 1), ms);
  }
}
