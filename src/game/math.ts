export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const choose = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
export const angleLerp = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Spring {
  value = 0;
  vel = 0;
  constructor(
    public k = 180,
    public d = 16,
  ) {}
  kick(v: number) {
    this.vel += v;
  }
  reset() {
    this.value = 0;
    this.vel = 0;
  }
  update(dt: number) {
    this.vel += (-this.k * this.value - this.d * this.vel) * dt;
    this.value += this.vel * dt;
  }
}
