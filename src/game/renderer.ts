import * as THREE from "three";

export const INK = { BLUE: 0, RED: 1, BLACK: 2, ORANGE: 3, GREEN: 4, PINK: 5 } as const;
export type InkId = (typeof INK)[keyof typeof INK];

const INK_COLORS = [
  new THREE.Vector3(0.1, 0.19, 0.76),
  new THREE.Vector3(0.86, 0.12, 0.2),
  new THREE.Vector3(0.18, 0.2, 0.26),
  new THREE.Vector3(0.92, 0.55, 0.08),
  new THREE.Vector3(0.12, 0.6, 0.3),
  new THREE.Vector3(0.9, 0.4, 0.66),
];

const shared = {
  uLightDir: { value: new THREE.Vector3(0.38, 0.82, 0.42).normalize() },
  uTime: { value: 0 },
};

const inkVert = /* glsl */ `
varying vec3 vNormalV;
uniform float uTime;
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vNormalV = normalize(normalMatrix * objectNormal);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const inkFrag = /* glsl */ `
precision highp float;
uniform float uInk;
uniform float uFill;
uniform float uShadeScale;
uniform float uShadeBias;
uniform vec3 uLightDir;
varying vec3 vNormalV;
void main() {
  vec3 n = normalize(vNormalV);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uLightDir) * 0.5 + 0.5;
  float shade = clamp(ndl * uShadeScale + uShadeBias, 0.0, 1.0);
  if (uFill > 0.5) shade = -1.0;
  gl_FragColor = vec4(shade, uInk, n.x * 0.5 + 0.5, n.y * 0.5 + 0.5);
}
`;

export function makeInkMaterial(
  opts: { ink?: number; fill?: boolean; shadeScale?: number; shadeBias?: number; side?: THREE.Side } = {},
) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInk: { value: opts.ink ?? INK.BLUE },
      uFill: { value: opts.fill ? 1 : 0 },
      uShadeScale: { value: opts.shadeScale ?? 1 },
      uShadeBias: { value: opts.shadeBias ?? 0 },
      uLightDir: shared.uLightDir,
      uTime: shared.uTime,
    },
    vertexShader: inkVert,
    fragmentShader: inkFrag,
    side: opts.side ?? THREE.FrontSide,
  });
}

const postVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const postFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform float uHurt;
uniform float uFlash;
uniform float uLowHp;
uniform float uNight;
uniform float uNvg;
uniform vec3 uPaper;
uniform vec3 uInks[6];

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float linDepth(float z) {
  float zn = z * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear));
}
vec3 inkColor(float id) {
  int i = int(id + 0.5);
  if (i <= 0) return uInks[0];
  if (i == 1) return uInks[1];
  if (i == 2) return uInks[2];
  if (i == 3) return uInks[3];
  if (i == 4) return uInks[4];
  return uInks[5];
}
float stripes(vec2 p, vec2 dir, float spacing, float width) {
  float t = dot(p, vec2(-dir.y, dir.x));
  float f = abs(fract(t / spacing) - 0.5) * spacing;
  float soft = width * 0.55;
  return 1.0 - smoothstep(width * 0.5 - soft, width * 0.5 + soft, f);
}

void main() {
  vec2 px = 1.0 / uRes;
  float sc = uRes.y / 900.0;
  // The paper wobble is four noise lookups a pixel. On a phone that is the most
  // expensive thing in the pass and the least visible, so CHEAP drops it.
#ifdef CHEAP
  vec2 wob = vec2(0.0);
#else
  vec2 wob = vec2(vnoise(vUv * vec2(uRes.x / uRes.y, 1.0) * 6.0 + 11.3), vnoise(vUv * 6.0 + 37.0)) - 0.5;
#endif
  vec2 suv = vUv + wob * 2.2 * sc * px;
  vec4 s = texture2D(tScene, suv);
  float z = texture2D(tDepth, suv).x;
  float d = linDepth(z);
  float o = 1.2 * sc;
  vec2 ox = vec2(o, 0.0) * px, oy = vec2(0.0, o) * px;
  float zl = texture2D(tDepth, suv - ox).x, zr = texture2D(tDepth, suv + ox).x;
  float zu = texture2D(tDepth, suv + oy).x, zd = texture2D(tDepth, suv - oy).x;
  vec4 sl = texture2D(tScene, suv - ox), sr = texture2D(tScene, suv + ox);
  vec4 su = texture2D(tScene, suv + oy), sd = texture2D(tScene, suv - oy);

  float iw = 1.0 / max(d, 0.0001);
  float lap = abs(1.0 / linDepth(zl) + 1.0 / linDepth(zr) - 2.0 * iw)
            + abs(1.0 / linDepth(zu) + 1.0 / linDepth(zd) - 2.0 * iw);
  float edge = smoothstep(0.07, 0.32, lap / (iw + 1e-7));
  vec2 nl = sl.ba * 2.0 - 1.0, nr = sr.ba * 2.0 - 1.0, nu = su.ba * 2.0 - 1.0, ndn = sd.ba * 2.0 - 1.0;
  float nEdge = length(nl - nr) + length(nu - ndn);
  edge = max(edge, smoothstep(0.35, 0.8, nEdge));

  float zmin = z; float inkId = s.g;
  if (zl < zmin) { zmin = zl; inkId = sl.g; }
  if (zr < zmin) { zmin = zr; inkId = sr.g; }
  if (zu < zmin) { zmin = zu; inkId = su.g; }
  if (zd < zmin) { zmin = zd; inkId = sd.g; }
  bool sky = z >= 0.9999;

  float shade = s.r;
  float hatch = 0.0;
  if (!sky) {
    if (shade < 0.0) hatch = 1.0;
    else {
      vec2 hp = gl_FragCoord.xy + wob * 6.0 * sc;
      float sp = 8.0 * sc;
      float w = 1.35 * sc;
      const vec2 d1 = vec2(0.7071, 0.7071);
      const vec2 d2 = vec2(-0.7071, 0.7071);
      float h1 = stripes(hp, d1, sp, w);
      float h2 = stripes(hp, d2, sp * 1.15, w);
      hatch = h1 * smoothstep(0.62, 0.48, shade);
      hatch = max(hatch, h2 * smoothstep(0.42, 0.28, shade));
      // the third pass only shows in the deepest shadow, so it is the one to lose
#ifndef CHEAP
      const vec2 d3 = vec2(0.2588, 0.9659);
      float h3 = stripes(hp, d3, sp * 0.72, w);
      hatch = max(hatch, h3 * smoothstep(0.24, 0.12, shade));
#endif
    }
  }

  vec3 paper = uPaper;
#ifdef CHEAP
  float grain = 0.0;
#else
  float grain = (vnoise(vUv * uRes * 0.35) - 0.5) * 0.045;
#endif
  float lines = abs(fract((vUv.y * uRes.y) / (28.0 * sc)) - 0.5);
  float ruled = 1.0 - smoothstep(0.42, 0.48, lines);
  paper += vec3(0.07, 0.1, 0.22) * ruled * 0.12;
  float margin = smoothstep(0.072, 0.068, vUv.x) * smoothstep(0.055, 0.06, vUv.x);
  paper = mix(paper, mix(paper, vec3(0.82, 0.18, 0.22), 0.55), margin * 0.8);
  paper += grain;

  vec3 col = paper;
  if (!sky) {
    vec3 ink = inkColor(inkId);
    float fillAmt = hatch * 0.55;
    col = mix(paper, ink, 0.18 + fillAmt);
    col = mix(col, ink, edge * 0.92);
    if (shade < 0.0) col = mix(paper, ink, 0.72);
  } else {
    col = paper;
  }

  col = mix(col, vec3(0.78, 0.12, 0.16), uHurt * 0.45 * (0.35 + 0.65 * length(vUv - 0.5)));
  col = mix(col, vec3(1.0, 0.95, 0.85), uFlash * 0.55);
  float vig = smoothstep(0.95, 0.35, length((vUv - 0.5) * vec2(1.15, 1.0)));
  col *= 0.78 + 0.22 * vig;
  // Night dims the page towards a cold blue-grey rather than tinting it, so
  // seeing anything at range is genuinely harder and the goggles are worth a slot.
  col = mix(col, col * vec3(0.30, 0.32, 0.52) + vec3(0.02, 0.025, 0.05), uNight * 0.92);
  col = mix(col, vec3(0.55, 0.08, 0.1), uLowHp * 0.18 * (1.0 - vig));
#ifndef CHEAP
  float fleck = step(0.996, hash21(floor(vUv * uRes * 0.25)));
  col = mix(col, inkColor(0.0), fleck * 0.25);
#endif

  // Goggles: everything through one green channel, lifted hard, with the tube's
  // own vignette and a little sensor noise.
  if (uNvg > 0.001) {
    // stretch the darks without crushing the lights, or every shape washes out
    float lum = dot(col, vec3(0.34, 0.5, 0.16));
    lum = pow(clamp((lum - 0.06) * 2.2, 0.0, 1.0), 0.85);
    float tube = smoothstep(0.74, 0.28, length((vUv - 0.5) * vec2(1.25, 1.0)));
    float grain = hash21(floor(vUv * uRes * 0.6) + floor(uTime * 24.0)) * 0.1;
    vec3 nvg = vec3(0.05, 0.9, 0.3) * (lum * 0.85 + grain) * tube;
    nvg += vec3(0.0, 0.04, 0.015) * tube;
    col = mix(col, nvg, uNvg);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export type Quality = "low" | "medium" | "high" | "ultra";

/**
 * `pr` caps the pixel ratio, which decides both how crisp the ink lines are and
 * how much of the phone's battery the post pass eats — it is by far the biggest
 * lever here, since the pass costs ten texture fetches per pixel. `fx` scales
 * particle counts, and `cheap` compiles the pass without its noise lookups.
 */
export const QUALITY: Record<Quality, { pr: number; fx: number; cheap: boolean }> = {
  low: { pr: 0.85, fx: 0.3, cheap: true },
  medium: { pr: 1.2, fx: 0.65, cheap: true },
  high: { pr: 1.75, fx: 1, cheap: false },
  ultra: { pr: 2.5, fx: 1.4, cheap: false },
};

/** Below about this many device pixels per CSS pixel the ink lines turn to mush. */
const MIN_PR = 0.72;

export const isQuality = (v: unknown): v is Quality => typeof v === "string" && v in QUALITY;

/** A phone that draws at three device pixels per CSS pixel cooks itself for nothing. */
export function defaultQuality(): Quality {
  if (typeof navigator === "undefined") return "high";
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!touch) return "high";
  // start somewhere reasonable and let the adaptive scaler shed what the phone
  // cannot actually sustain, rather than guessing low and looking soft forever
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 4 ? "medium" : "low";
}

export class InkRenderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rt: THREE.WebGLRenderTarget;
  postScene: THREE.Scene;
  postCam: THREE.OrthographicCamera;
  postMat: THREE.ShaderMaterial;
  private _hurt = 0;
  private _flash = 0;
  night = 0;
  /** 0..1, eased so the tubes fade up rather than snapping on */
  nvg = 0;
  quality: Quality = "high";
  private lastW = 1;
  private lastH = 1;
  /**
   * Adaptive resolution. A fixed pixel ratio either wastes a fast phone or melts
   * a slow one, and nobody reads a settings screen before their hands get hot —
   * so the render target follows the frame time instead. Only the 3D pass
   * shrinks; the HUD is DOM and stays sharp.
   */
  private resScale = 1;
  private budget = 1 / 60;
  private acc = 0;
  private accN = 0;

  constructor(canvas: HTMLCanvasElement, quality: Quality = "high") {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.quality = quality;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(82, 1, 0.12, 160);
    this.camera.rotation.order = "YXZ";

    const depth = new THREE.DepthTexture(1, 1);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthTexture: depth,
      depthBuffer: true,
    });

    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture },
        tDepth: { value: depth },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uNear: { value: 0.12 },
        uFar: { value: 160 },
        uHurt: { value: 0 },
        uFlash: { value: 0 },
        uLowHp: { value: 0 },
        uNight: { value: 0 },
        uNvg: { value: 0 },
        uPaper: { value: new THREE.Vector3(0.965, 0.953, 0.902) },
        uInks: { value: INK_COLORS },
      },
      defines: QUALITY[quality].cheap ? { CHEAP: "1" } : {},
      vertexShader: postVert,
      fragmentShader: postFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  /** Change quality without rebuilding the renderer. */
  setQuality(q: Quality) {
    if (!isQuality(q) || q === this.quality) return;
    this.quality = q;
    this.postMat.defines = QUALITY[q].cheap ? { CHEAP: "1" } : {};
    this.postMat.needsUpdate = true;
    this.resScale = 1;
    this.resize(this.lastW, this.lastH);
  }

  /** The frame time to aim at, in seconds. 0 means "whatever 60fps is". */
  setBudget(fps: number) {
    this.budget = 1 / (fps > 0 ? fps : 60);
  }

  /**
   * Feed one frame's time in. Sustained overruns shed render resolution and
   * sustained headroom takes it back, a step at a time so the picture never
   * pulses; the target is only ever resized on a decision, not every frame.
   */
  pace(dt: number) {
    this.acc += dt;
    this.accN += 1;
    if (this.accN < 30) return;
    const mean = this.acc / this.accN;
    this.acc = 0;
    this.accN = 0;
    const before = this.resScale;
    const floor = Math.min(1, MIN_PR / Math.min(window.devicePixelRatio, QUALITY[this.quality].pr));
    // Meeting the target is itself the evidence of headroom: under a frame cap
    // the clock can never read faster than the cap, so a "well under budget"
    // test would only ever shed resolution and never take it back.
    if (mean > this.budget * 1.22) this.resScale = Math.max(floor, this.resScale - 0.1);
    else if (mean <= this.budget * 1.05) this.resScale = Math.min(1, this.resScale + 0.05);
    if (this.resScale !== before) this.resize(this.lastW, this.lastH);
  }

  resize(w: number, h: number) {
    this.lastW = w;
    this.lastH = h;
    // the whole pipeline shrinks, post pass included — that pass is the expensive
    // half, so scaling only the scene target would save almost nothing
    const pr = Math.min(window.devicePixelRatio, QUALITY[this.quality].pr) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const rw = Math.max(2, Math.floor(w * pr));
    const rh = Math.max(2, Math.floor(h * pr));
    this.rt.setSize(rw, rh);
    this.postMat.uniforms.uRes.value.set(rw, rh);
  }

  setHurt(v: number) {
    this._hurt = v;
  }
  setFlash(v: number) {
    this._flash = v;
  }
  setLowHp(v: number) {
    this.postMat.uniforms.uLowHp.value = v;
  }

  render(time: number) {
    shared.uTime.value = time;
    this.postMat.uniforms.uTime.value = time;
    this.postMat.uniforms.uHurt.value = this._hurt;
    this.postMat.uniforms.uFlash.value = this._flash;
    this.postMat.uniforms.uNight.value = this.night;
    this.postMat.uniforms.uNvg.value = this.nvg;
    this.postMat.uniforms.uNear.value = this.camera.near;
    this.postMat.uniforms.uFar.value = this.camera.far;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  dispose() {
    this.rt.dispose();
    this.rt.depthTexture?.dispose();
    this.renderer.dispose();
  }
}
