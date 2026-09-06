import { useCallback, useEffect, useRef, useState } from "react";
import { Game, type GameState, type HudSnap } from "./game/engine";
import { MAPS, DEFAULT_MAP, type Mode } from "./game/level";
import { WEAPONS, sanitizeLoadout, type WeaponKind } from "./game/player";
import { SCORE_TARGET, type MatchMode, type MatchNet } from "./game/match";
import type { BotSkill } from "./game/bot";
import { WeaponIcon } from "./WeaponIcon";
import { QUALITY, isQuality, type Quality } from "./game/renderer";
import * as account from "./game/account";

type Screen = "menu" | "howto" | "settings" | "loadout" | "account" | "game";

const GUNS = WEAPONS.filter((w) => w.isGun);
const isGun = (k: WeaponKind) => GUNS.some((g) => g.kind === k);

/** The six inks the art style is built from — indexes match INK in renderer.ts. */
const INK_SWATCHES = [
  { ink: 0, name: "blue", hex: "#1a30c0" },
  { ink: 1, name: "red", hex: "#d02030" },
  { ink: 2, name: "black", hex: "#2d3342" },
  { ink: 3, name: "orange", hex: "#eb8c14" },
  { ink: 4, name: "green", hex: "#1f9950" },
  { ink: 5, name: "pink", hex: "#e666a8" },
];

function readInkSetting(key: string, fallback: number) {
  const v = Number(localStorage.getItem(key));
  return Number.isInteger(v) && v >= 0 && v <= 5 ? v : fallback;
}

function loadLoadout(): WeaponKind[] {
  try {
    return sanitizeLoadout(JSON.parse(localStorage.getItem("doodle_loadout") || "null"));
  } catch {
    return sanitizeLoadout(null);
  }
}

const emptyHud = (): HudSnap => ({
  hp: 120,
  maxHp: 120,
  mag: "35",
  reserve: "/140",
  reloading: false,
  weapon: "RIFLE",
  hint: "",
  wave: 0,
  left: 0,
  score: 0,
  combo: 0,
  nades: 3,
  slots: [],
  spread: 10,
  ads: false,
  melee: false,
  boss: null,
  message: "",
  sub: "",
  tip: "",
  low: false,
  kills: 0,
  time: 0,
  best: 0,
  mode: "district",
  state: "playing",
  hitmarker: 0,
  hitKill: false,
  hitCrit: false,
  dmgAngle: null,
  killFeed: [],
  waveLabel: "WAVE",
  modifier: "",
  focusFrac: 0,
  focusReady: false,
  canSwap: false,
  streakReady: [],
  streak: 0,
  uav: false,
  piloting: false,
  radar: [],
  radarSelf: { x: 0, z: 0, yaw: 0 },
  radarHalf: 40,
});

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/** Portrait cannot fit a stick, a fire button and a readable HUD side by side. */
function RotatePrompt() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6 paper-bg">
      <div className="ink-panel px-8 py-9 text-center">
        <svg className="mx-auto mb-4 block" width="86" height="86" viewBox="0 0 48 48" aria-hidden="true">
          <g fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="17" y="6" width="14" height="24" rx="2.5" />
            <path d="M24 10.5v.01M24 26.5v.01" />
            <path d="M9 34a17 17 0 0 0 30 0" />
            <path d="M9 34l4.5-3M9 34l1 5" />
          </g>
        </svg>
        <h2 className="m-0 font-[Caveat,cursive] text-5xl">turn your phone</h2>
        <p className="mt-2 text-xl opacity-75">the stick and the fire button need the width</p>
      </div>
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [mode, setMode] = useState<Mode>("district");
  const [mapKey, setMapKey] = useState(() => localStorage.getItem("doodle_map") || DEFAULT_MAP);
  const [loadout, setLoadout] = useState<WeaponKind[]>(loadLoadout);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("doodle_name") || "");
  const [matchMode, setMatchMode] = useState<MatchMode>("ffa");
  // MatchNet lives outside React; bump this to re-read it
  const [netTick, setNetTick] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [me, setMe] = useState<account.Account | null>(null);
  const [stats, setStats] = useState<account.Stats | null>(null);
  const [hud, setHud] = useState<HudSnap>(emptyHud);
  const [gstate, setGstate] = useState<GameState>("playing");
  const [touch, setTouch] = useState(false);
  const [sens, setSens] = useState(Number(localStorage.getItem("doodle_sens") || 100));
  const [invert, setInvert] = useState(localStorage.getItem("doodle_invert") === "1");
  const [music, setMusic] = useState(localStorage.getItem("doodle_music") !== "0");
  const [adsToggle, setAdsToggle] = useState(localStorage.getItem("doodle_ads_toggle") === "1");
  const [hudPreset, setHudPreset] = useState(() => localStorage.getItem("doodle_hud") || "codm");
  const [hitInk, setHitInk] = useState(() => readInkSetting("doodle_hit_ink", 1));
  const [tracerInk, setTracerInk] = useState(() => readInkSetting("doodle_tracer_ink", 3));
  const [quality, setQuality] = useState<Quality>(() => {
    const s = localStorage.getItem("doodle_quality");
    return isQuality(s) ? s : "high";
  });
  const [bestD, setBestD] = useState(Number(localStorage.getItem("doodle_best") || 0));
  const [bestZ, setBestZ] = useState(Number(localStorage.getItem("doodle_zbest") || 0));
  const [runId, setRunId] = useState(0);
  const [locked, setLocked] = useState(false);
  const hudLatest = useRef(hud);
  // Read through a ref when building the Game. If `loadout` were a dependency of
  // that effect, swapping kit mid-match would tear the whole match down.
  const loadoutRef = useRef(loadout);
  loadoutRef.current = loadout;

  useEffect(() => {
    setTouch(isTouchDevice());
  }, []);

  // The controls assume landscape — the thumb zones need the width. Track
  // orientation so portrait gets a rotate prompt instead of a broken layout.
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Best effort: most browsers only honour this in fullscreen, hence the prompt.
  useEffect(() => {
    if (screen !== "game" || !touch) return;
    const o = window.screen?.orientation as (ScreenOrientation & { lock?: (s: string) => Promise<void> }) | undefined;
    o?.lock?.("landscape").catch(() => {
      /* not permitted outside fullscreen; the prompt covers it */
    });
  }, [screen, touch]);

  // the window can lapse while the menu is open; do not leave it stranded
  useEffect(() => {
    if (swapping && !hud.canSwap) setSwapping(false);
  }, [swapping, hud.canSwap]);

  // the hitmarker is CSS, so the chosen hit colour rides in as a variable
  useEffect(() => {
    const hex = INK_SWATCHES[hitInk]?.hex;
    if (hex) document.documentElement.style.setProperty("--hit", hex);
  }, [hitInk]);

  // live-apply the colours and graphics preset without a restart
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    g.combat.hitInk = hitInk;
    g.combat.tracerInk = tracerInk;
    g.player.adsToggle = adsToggle;
    g.setQuality(quality);
  }, [hitInk, tracerInk, quality, adsToggle, runId, screen]);

  // Resume a saved session if there is one. No backend just means stay signed out.
  useEffect(() => {
    let cancelled = false;
    account.me().then((r) => {
      if (cancelled || !r) return;
      setMe(r.user);
      setStats(r.stats);
      if (Array.isArray(r.profile?.loadout) && r.profile.loadout.length) {
        setLoadout(sanitizeLoadout(r.profile.loadout));
      }
      if (!localStorage.getItem("doodle_name")) setPlayerName(r.user.username);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const killGame = useCallback(() => {
    gameRef.current?.dispose();
    gameRef.current = null;
  }, []);

  const launch = useCallback((m: Mode) => {
    setMode(m);
    setScreen("game");
    setGstate("playing");
    setHud(emptyHud());
    setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    if (screen !== "game") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = new Game(canvas, mode, mapKey, loadoutRef.current);
    gameRef.current = g;
    g.onHud = (h) => {
      hudLatest.current = h;
    };
    g.onState = (s) => setGstate(s);
    g.onNet = () => setNetTick((n) => n + 1);
    g.match.name = (playerName || "doodle").slice(0, 14);
    g.match.mapKey = mapKey;
    g.match.mode = matchMode;
    g.input.onLockChange = (l) => setLocked(l);
    // Opt-in inspection handle. A P2P lobby has no server to look at, so this is
    // the only way to see what your client actually believes about a live match.
    if (localStorage.getItem("doodle_debug") === "1") {
      (window as unknown as { __doodle?: Game }).__doodle = g;
    }
    g.start();
    const id = window.setInterval(() => setHud({ ...hudLatest.current }), 50);
    return () => {
      clearInterval(id);
      g.dispose();
      if (gameRef.current === g) gameRef.current = null;
    };
  }, [screen, mode, mapKey, playerName, matchMode, runId]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && screen === "game") gameRef.current?.pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [screen]);

  const toMenu = () => {
    killGame();
    setBestD(Number(localStorage.getItem("doodle_best") || 0));
    setBestZ(Number(localStorage.getItem("doodle_zbest") || 0));
    setScreen("menu");
  };

  if (touch && portrait) return <RotatePrompt />;

  return (
    <div className="relative h-full w-full overflow-hidden paper-bg">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        style={{ visibility: screen === "game" ? "visible" : "hidden" }}
        onClick={() => {
          if (gstate === "playing") gameRef.current?.input.requestLock();
        }}
      />

      {screen === "menu" && (
        <Menu
          bestD={bestD}
          bestZ={bestZ}
          mapKey={mapKey}
          onMap={(k) => {
            setMapKey(k);
            localStorage.setItem("doodle_map", k);
          }}
          onDistrict={() => launch("district")}
          onZombies={() => launch("zombies")}
          onHow={() => setScreen("howto")}
          onSettings={() => setScreen("settings")}
          onLoadout={() => setScreen("loadout")}
          onOnline={() => launch("arena")}
          onAccount={() => setScreen("account")}
          me={me}
        />
      )}
      {screen === "howto" && <HowTo onBack={() => setScreen("menu")} touch={touch} />}
      {screen === "account" && (
        <AccountScreen
          me={me}
          stats={stats}
          onSignedIn={(user, profile, s) => {
            setMe(user);
            setStats(s);
            if (profile?.loadout?.length) setLoadout(sanitizeLoadout(profile.loadout));
            if (!localStorage.getItem("doodle_name")) {
              setPlayerName(user.username);
              localStorage.setItem("doodle_name", user.username);
            }
          }}
          onSignedOut={() => {
            setMe(null);
            setStats(null);
          }}
          onBack={() => setScreen("menu")}
        />
      )}
      {screen === "loadout" && (
        <LoadoutScreen
          loadout={loadout}
          onChange={(l) => {
            setLoadout(l);
            localStorage.setItem("doodle_loadout", JSON.stringify(l));
            // coalesced: tapping through chips must not be one API call each
            account.saveProfileSoon(l);
          }}
          onBack={() => {
            account.flushProfile();
            setScreen("menu");
          }}
        />
      )}
      {screen === "settings" && (
        <Settings
          sens={sens}
          invert={invert}
          music={music}
          onSens={(v) => {
            setSens(v);
            localStorage.setItem("doodle_sens", String(v));
          }}
          onInvert={(v) => {
            setInvert(v);
            localStorage.setItem("doodle_invert", v ? "1" : "0");
          }}
          onMusic={(v) => {
            setMusic(v);
            localStorage.setItem("doodle_music", v ? "1" : "0");
          }}
          hitInk={hitInk}
          tracerInk={tracerInk}
          onHitInk={(v) => {
            setHitInk(v);
            localStorage.setItem("doodle_hit_ink", String(v));
          }}
          onTracerInk={(v) => {
            setTracerInk(v);
            localStorage.setItem("doodle_tracer_ink", String(v));
          }}
          hudPreset={hudPreset}
          onHudPreset={(v) => {
            setHudPreset(v);
            localStorage.setItem("doodle_hud", v);
          }}
          adsToggle={adsToggle}
          onAdsToggle={(v) => {
            setAdsToggle(v);
            localStorage.setItem("doodle_ads_toggle", v ? "1" : "0");
          }}
          quality={quality}
          onQuality={(q) => {
            setQuality(q);
            localStorage.setItem("doodle_quality", q);
          }}
          onBack={() => setScreen("menu")}
        />
      )}

      {screen === "game" && (
        <>
          <HUD hud={hud} hidden={gstate === "paused" || gstate === "dead"} touch={touch} preset={hudPreset} />
          {!touch && gstate === "playing" && !locked && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(246,243,230,0.35)]"
              onClick={() => gameRef.current?.input.requestLock()}
            >
              <div className="ink-panel px-10 py-6 text-center text-3xl blink">click to scribble</div>
            </div>
          )}
          {touch && gstate === "playing" && <TouchControls gameRef={gameRef} />}
          {gstate === "playing" && (
            <StreakTray
              hud={hud}
              onUse={(k) => gameRef.current?.useStreak(k as Parameters<Game["useStreak"]>[0])}
            />
          )}
          {hud.canSwap && !swapping && (
            <button className="swap-btn" onClick={() => setSwapping(true)} aria-label="change loadout">
              <span>⋯</span>
              <em>loadout</em>
            </button>
          )}
          {swapping && (
            <div className="absolute inset-0 z-40">
              <LoadoutScreen
                loadout={loadout}
                onChange={(l) => {
                  setLoadout(l);
                  localStorage.setItem("doodle_loadout", JSON.stringify(l));
                  account.saveProfileSoon(l);
                  gameRef.current?.applyLoadout(l);
                }}
                onBack={() => setSwapping(false)}
              />
            </div>
          )}
          {mode === "arena" && (
            <Online
              gameRef={gameRef}
              tick={netTick}
              name={playerName}
              onName={(n) => {
                setPlayerName(n);
                localStorage.setItem("doodle_name", n);
                if (gameRef.current) gameRef.current.match.name = (n || "doodle").slice(0, 14);
              }}
              matchMode={matchMode}
              onMatchMode={setMatchMode}
              onMenu={toMenu}
            />
          )}
          {gstate === "paused" && (
            <PauseOverlay
              onResume={() => gameRef.current?.resume()}
              onMenu={toMenu}
            />
          )}
          {gstate === "dead" && (
            <DeadOverlay
              hud={hud}
              onRetry={() => launch(mode)}
              onMenu={toMenu}
            />
          )}
        </>
      )}
    </div>
  );
}

function Menu({
  bestD,
  bestZ,
  mapKey,
  onMap,
  onDistrict,
  onZombies,
  onHow,
  onSettings,
  onLoadout,
  onOnline,
  onAccount,
  me,
}: {
  bestD: number;
  bestZ: number;
  mapKey: string;
  onMap: (k: string) => void;
  onDistrict: () => void;
  onZombies: () => void;
  onHow: () => void;
  onSettings: () => void;
  onLoadout: () => void;
  onOnline: () => void;
  onAccount: () => void;
  me: account.Account | null;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4 paper-bg">
      <DoodleDecor />
      <div className="ink-panel relative z-10 w-full max-w-[920px] px-6 py-8 text-center sm:px-12">
        <p className="mb-1 text-2xl opacity-70" style={{ transform: "rotate(1deg)" }}>
          ballpoint FPS · lined paper
        </p>
        <h1
          className="m-0 font-[Caveat,cursive] text-[64px] leading-[0.9] tracking-wide sm:text-[92px]"
          style={{ transform: "rotate(-1.5deg)" }}
        >
          DOODLE DISTRICT
        </h1>
        <p className="mt-2 text-xl opacity-80">erase them before they ink the page</p>

        <div className="mt-7">
          <div className="mb-2 text-lg uppercase tracking-widest opacity-60">pick a page</div>
          <div className="flex flex-wrap items-stretch justify-center gap-2">
            {MAPS.map((m) => (
              <button key={m.key} className={`map-chip ${m.key === mapKey ? "on" : ""}`} onClick={() => onMap(m.key)}>
                <div className="text-xl leading-tight">{m.name}</div>
                <div className="text-sm leading-tight opacity-70">{m.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-7 flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:items-stretch">
          <button className="ink-panel mode-card p-5 text-left" onClick={onDistrict}>
            <div className="text-sm opacity-70">WAVE SURVIVAL</div>
            <div className="font-[Caveat,cursive] text-4xl">DISTRICT</div>
            <p className="mt-2 text-lg leading-snug opacity-80">
              doodle goons, rooftops, rifles and a switchblade. clear waves. don&apos;t get sketched out.
            </p>
            <div className="mt-3 text-lg">
              best <b className="text-[var(--red)]">{bestD}</b>
            </div>
          </button>
          <button className="ink-panel mode-card p-5 text-left" onClick={onZombies} style={{ transform: "rotate(0.8deg)" }}>
            <div className="text-sm text-[var(--red)]">ENDLESS HORDES</div>
            <div className="font-[Caveat,cursive] text-4xl text-[var(--red)]">ZOMBIES</div>
            <p className="mt-2 text-lg leading-snug opacity-80">
              the margin bleeds. shamblers, runners, tanks. they never stop coming. keep moving.
            </p>
            <div className="mt-3 text-lg">
              best <b className="text-[var(--red)]">{bestZ}</b>
            </div>
          </button>
        </div>

        <button className="ink-btn big mt-6" onClick={onOnline}>
          play online
        </button>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button className="ink-btn" onClick={onLoadout}>
            loadout
          </button>
          <button className="ink-btn" onClick={onHow}>
            how to play
          </button>
          <button className="ink-btn" onClick={onSettings}>
            settings
          </button>
          <button className="ink-btn" onClick={onAccount}>
            {me ? me.username : "sign in"}
          </button>
        </div>
        <p className="mt-5 text-base opacity-60">click a card to scribble yourself in</p>
      </div>
    </div>
  );
}

function DoodleDecor() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-40" viewBox="0 0 1200 800" fill="none">
      <g stroke="#1a30c0" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="140" cy="160" r="38" />
        <line x1="140" y1="198" x2="140" y2="280" />
        <line x1="140" y1="230" x2="100" y2="250" />
        <line x1="140" y1="230" x2="190" y2="210" />
        <line x1="140" y1="280" x2="112" y2="340" />
        <line x1="140" y1="280" x2="172" y2="340" />
        <rect x="186" y="204" width="54" height="16" rx="3" transform="rotate(-12 186 204)" />
        <circle cx="128" cy="152" r="4" fill="#1a30c0" />
        <circle cx="152" cy="152" r="4" fill="#1a30c0" />
        <path d="M128 172 Q140 182 154 170" />
      </g>
      <g stroke="#d02030" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="1060" cy="520" r="42" />
        <line x1="1060" y1="562" x2="1060" y2="650" />
        <line x1="1060" y1="590" x2="1010" y2="630" />
        <line x1="1060" y1="590" x2="1115" y2="630" />
        <line x1="1060" y1="650" x2="1034" y2="720" />
        <line x1="1060" y1="650" x2="1090" y2="720" />
        <line x1="1046" cy="512" x2="1052" y2="528" />
        <line x1="1052" y1="512" x2="1046" y2="528" />
        <line x1="1070" y1="512" x2="1076" y2="528" />
        <line x1="1076" y1="512" x2="1070" y2="528" />
        <path d="M1046 542 Q1060 534 1076 544" />
      </g>
      <g stroke="#1a30c0" strokeWidth="1.6" opacity="0.5">
        <path d="M80 60 q40 20 80 0" />
        <path d="M900 80 q60 -30 120 10" />
        <path d="M200 700 q100 40 220 0" />
      </g>
    </svg>
  );
}

function HowTo({ onBack, touch }: { onBack: () => void; touch: boolean }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4 paper-bg">
      <div className="ink-panel w-full max-w-[760px] px-8 py-7 text-left">
        <h2 className="m-0 text-center font-[Caveat,cursive] text-5xl">how to scribble</h2>
        <div className="mt-5 grid gap-6 text-xl sm:grid-cols-2">
          <div>
            <div className="mb-1 border-b-2 border-[var(--ink)] text-2xl">move</div>
            {touch ? (
              <p>left stick walks. drag the right side of the screen to look around. JUMP and SPRINT sit near the stick.</p>
            ) : (
              <p>
                <b>WASD</b> walk · <b>mouse</b> look · <b>Shift</b> sprint · <b>Space</b> jump · <b>C</b> crouch / slide
              </p>
            )}
          </div>
          <div>
            <div className="mb-1 border-b-2 border-[var(--ink)] text-2xl">shoot</div>
            {touch ? (
              <p>
                hold the red target to fire — and slide that same thumb to keep aiming, no second finger needed. the
                scope tightens the shot, the arrow reloads, the pistol cycles guns.
              </p>
            ) : (
              <p>
                <b>click</b> fire · <b>right mouse</b> aim · <b>R</b> reload · <b>1–4</b> weapons · <b>G</b> grenade · <b>X</b> dash
              </p>
            )}
          </div>
          <div>
            <div className="mb-1 border-b-2 border-[var(--ink)] text-2xl">district</div>
            <p>waves of doodle goons. grunts shoot, rushers lunge, heavies soak ink, snipers lurk on roofs. a boss doodles in every five waves.</p>
          </div>
          <div>
            <div className="mb-1 border-b-2 border-[var(--red)] text-2xl text-[var(--red)]">zombies</div>
            <p>they do not stop. headshots erase faster. tanks shrug off pellets. spitters paint the page. ammo drops from the fallen.</p>
          </div>
        </div>
        <p className="mt-5 text-center text-lg opacity-80">the switchblade (slot 4) slashes. hold aim to guard. three kills charge a focus dash.</p>
        <div className="mt-6 text-center">
          <button className="ink-btn" onClick={onBack}>
            back
          </button>
        </div>
      </div>
    </div>
  );
}

function InkPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span>{label}</span>
      <div className="flex gap-2">
        {INK_SWATCHES.map((s) => (
          <button
            key={s.ink}
            className={`swatch ${value === s.ink ? "on" : ""}`}
            style={{ background: s.hex }}
            onClick={() => onChange(s.ink)}
            aria-label={s.name}
            title={s.name}
          />
        ))}
      </div>
    </div>
  );
}

function Settings({
  sens,
  invert,
  music,
  onSens,
  onInvert,
  onMusic,
  hitInk,
  tracerInk,
  onHitInk,
  onTracerInk,
  hudPreset,
  onHudPreset,
  adsToggle,
  onAdsToggle,
  quality,
  onQuality,
  onBack,
}: {
  sens: number;
  invert: boolean;
  music: boolean;
  onSens: (n: number) => void;
  onInvert: (v: boolean) => void;
  onMusic: (v: boolean) => void;
  hitInk: number;
  tracerInk: number;
  onHitInk: (v: number) => void;
  onTracerInk: (v: number) => void;
  hudPreset: string;
  onHudPreset: (v: string) => void;
  adsToggle: boolean;
  onAdsToggle: (v: boolean) => void;
  quality: Quality;
  onQuality: (q: Quality) => void;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto p-4 paper-bg">
      <div className="ink-panel mx-auto w-full max-w-[520px] px-8 py-7 text-center">
        <h2 className="m-0 font-[Caveat,cursive] text-5xl">settings</h2>
        <div className="mt-6 flex flex-col items-center gap-5 text-2xl">
          <div className="flex flex-col items-center gap-2">
            <span>hud layout</span>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                ["codm", "modern"],
                ["classic", "classic"],
              ].map(([k, label]) => (
                <button key={k} className={`gun-chip ${hudPreset === k ? "on" : ""}`} onClick={() => onHudPreset(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span>graphics</span>
            <div className="flex flex-wrap justify-center gap-2">
              {(Object.keys(QUALITY) as Quality[]).map((q) => (
                <button key={q} className={`gun-chip ${quality === q ? "on" : ""}`} onClick={() => onQuality(q)}>
                  {q}
                </button>
              ))}
            </div>
            <span className="text-base opacity-60">higher draws at more of your screen's real pixels</span>
          </div>
          <InkPicker label="hit colour" value={hitInk} onChange={onHitInk} />
          <InkPicker label="fire projection" value={tracerInk} onChange={onTracerInk} />
          <label className="flex flex-col items-center gap-2">
            look sensitivity {sens}%
            <input className="ink-range" type="range" min={40} max={200} value={sens} onChange={(e) => onSens(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={adsToggle} onChange={(e) => onAdsToggle(e.target.checked)} />
            aim is a toggle, not a hold
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={invert} onChange={(e) => onInvert(e.target.checked)} />
            invert look y
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={music} onChange={(e) => onMusic(e.target.checked)} />
            doodle tune
          </label>
        </div>
        <button className="ink-btn mt-8" onClick={onBack}>
          back
        </button>
      </div>
    </div>
  );
}

function AccountScreen({
  me,
  stats,
  onSignedIn,
  onSignedOut,
  onBack,
}: {
  me: account.Account | null;
  stats: account.Stats | null;
  onSignedIn: (u: account.Account, p: account.Profile | null, s: account.Stats | null) => void;
  onSignedOut: () => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const user = mode === "register" ? await account.register(username, password) : await account.login(username, password);
      const full = await account.me();
      onSignedIn(user, full?.profile ?? null, full?.stats ?? null);
      setPassword("");
      onBack();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (me) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center p-4 paper-bg">
        <div className="ink-panel w-full max-w-[520px] px-8 py-7 text-center">
          <h2 className="m-0 font-[Caveat,cursive] text-5xl">{me.username}</h2>
          <p className="mt-1 text-lg opacity-70">your loadout and scores follow you to any device</p>
          {stats && (
            <div className="mt-5 text-left text-xl">
              {(
                [
                  ["kills", stats.kills],
                  ["deaths", stats.deaths],
                  ["wins", stats.wins],
                  ["matches", stats.matches],
                  ["best · district", stats.best_district],
                  ["best · zombies", stats.best_zombies],
                ] as [string, number][]
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-[var(--ink)] py-1">
                  <span className="opacity-75">{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3">
            <button
              className="ink-btn"
              onClick={async () => {
                await account.logout();
                onSignedOut();
              }}
            >
              sign out
            </button>
            <button className="ink-btn" onClick={onBack}>
              back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4 paper-bg">
      <div className="ink-panel w-full max-w-[480px] px-8 py-7 text-center">
        <h2 className="m-0 font-[Caveat,cursive] text-5xl">{mode === "register" ? "new doodler" : "sign in"}</h2>
        <p className="mt-1 text-lg opacity-70">optional — the game plays fine without an account</p>

        <form
          className="mt-5 flex flex-col items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          <input
            className="ink-input w-full"
            placeholder="username"
            autoComplete="username"
            value={username}
            maxLength={14}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="ink-input w-full"
            placeholder="password"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {err && <p className="text-lg text-[var(--red)]">{err}</p>}
          <button className="ink-btn big" type="submit" disabled={busy || !username || !password}>
            {busy ? "…" : mode === "register" ? "create account" : "sign in"}
          </button>
        </form>

        <div className="mt-5 flex flex-col gap-3">
          <button
            className="ink-btn"
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setErr("");
            }}
          >
            {mode === "register" ? "I already have one" : "make a new account"}
          </button>
          <button className="ink-btn" onClick={onBack}>
            back
          </button>
        </div>
      </div>
    </div>
  );
}

function Online({
  gameRef,
  tick,
  name,
  onName,
  matchMode,
  onMatchMode,
  onMenu,
}: {
  gameRef: React.RefObject<Game | null>;
  tick: number;
  name: string;
  onName: (n: string) => void;
  matchMode: MatchMode;
  onMatchMode: (m: MatchMode) => void;
  onMenu: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [, setBump] = useState(0);
  const bump = () => setBump((n) => n + 1);
  const m: MatchNet | null = gameRef.current?.match ?? null;
  void tick; // re-render trigger; the match object itself is mutable
  if (!m) return null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  };

  // ---- in a match: a small, non-blocking score panel ----
  if (m.state === "playing") {
    const rows = m.scoreboard().slice(0, 4);
    const target = SCORE_TARGET[m.mode];
    const [blue, red] = m.teamScores();
    return (
      <div className="net-score hud-bit">
        {m.mode === "br" ? (
          <div className="justify-center text-2xl">
            <b>{m.aliveCount()}</b>
            <span className="text-base opacity-60">still on the page</span>
          </div>
        ) : m.mode === "tdm" ? (
          <div className="flex items-center justify-center gap-3 text-2xl">
            <b style={{ color: "var(--ink)" }}>{blue}</b>
            <span className="text-base opacity-60">to {target}</span>
            <b style={{ color: "var(--red)" }}>{red}</b>
          </div>
        ) : (
          rows.map((r, i) => (
            <div key={r.id} className={r.id === m.myId ? "me" : ""}>
              <span className="rank">{i + 1}.</span>
              <span>{r.name}</span>
              <b>{r.kills}</b>
            </div>
          ))
        )}
      </div>
    );
  }

  // ---- match over ----
  if (m.state === "over") {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(246,243,230,0.72)] p-4">
        <div className="ink-panel max-w-[520px] px-10 py-8 text-center">
          <h2 className="m-0 font-[Caveat,cursive] text-5xl text-[var(--red)]">{m.winner} wins</h2>
          <div className="mt-4 text-left text-xl">
            {m.scoreboard().map((r) => (
              <div key={r.id} className="flex justify-between gap-6">
                <span className={r.id === m.myId ? "text-[var(--red)]" : ""}>
                  {r.name}
                  {r.id === m.myId ? " (you)" : ""}
                </span>
                <span className="opacity-70">
                  {r.kills} K · {r.deaths} D
                </span>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {m.isHost && (
              <button className="ink-btn big" onClick={() => m.backToLobby()}>
                back to the lobby
              </button>
            )}
            <button className="ink-btn" onClick={onMenu}>
              leave
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- in a lobby, waiting to start ----
  if (m.state === "lobby") {
    const rows = [...m.roster.values()];
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(246,243,230,0.72)] p-4">
        <div className="ink-panel w-full max-w-[560px] px-8 py-7 text-center">
          <h2 className="m-0 font-[Caveat,cursive] text-5xl">lobby</h2>
          <p className="mt-1 text-2xl">
            code <b className="tracking-[0.25em] text-[var(--red)]">{m.code}</b>
          </p>
          <p className="text-lg opacity-70">
            {m.mode === "tdm" ? "team deathmatch" : m.mode === "br" ? "battle royale" : "free-for-all"} ·{" "}
            {MAPS.find((x) => x.key === m.mapKey)?.name}
          </p>

          <div className="mt-5 text-left text-xl">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-[var(--ink)] py-1 opacity-90">
                <span>
                  {r.name}
                  {r.id === m.myId ? " (you)" : ""}
                  {r.id === m.myId && m.isHost ? " · host" : ""}
                </span>
                {m.mode === "tdm" && (
                  <span style={{ color: r.team === 0 ? "var(--ink)" : "var(--red)" }}>{r.team === 0 ? "BLUE" : "RED"}</span>
                )}
              </div>
            ))}
            {rows.length < 2 && <p className="mt-3 text-lg opacity-70">waiting for someone else to scribble in…</p>}
          </div>

          {m.isHost && (
            <div className="mt-4">
              <div className="mb-1 text-lg uppercase tracking-widest opacity-60">bots</div>
              <div className="flex flex-wrap justify-center gap-2">
                {(["recruit", "regular", "veteran", "elite"] as BotSkill[]).map((k) => (
                  <button
                    key={k}
                    className={`gun-chip ${m.botSkill === k ? "on" : ""}`}
                    onClick={() => {
                      m.botSkill = k;
                      bump();
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-lg">
                <span className="opacity-70">fill to</span>
                {[0, 4, 6, 8, 10].map((n) => (
                  <button
                    key={n}
                    className={`gun-chip ${m.fillTo === n ? "on" : ""}`}
                    onClick={() => {
                      m.fillTo = n;
                      bump();
                    }}
                  >
                    {n === 0 ? "off" : n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {err && <p className="mt-3 text-lg text-[var(--red)]">{err}</p>}
          <div className="mt-6 flex flex-col gap-3">
            {m.isHost ? (
              <button className="ink-btn big red" onClick={() => m.requestStart()}>
                start the match
              </button>
            ) : (
              <p className="text-xl opacity-70">waiting for the host…</p>
            )}
            <button className="ink-btn" onClick={onMenu}>
              leave
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- not connected yet ----
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(246,243,230,0.72)] p-4">
      <div className="ink-panel w-full max-w-[560px] px-8 py-7 text-center">
        <h2 className="m-0 font-[Caveat,cursive] text-5xl">play online</h2>
        <p className="mt-1 text-lg opacity-70">no server — you connect straight to the other players</p>

        <label className="mt-5 flex flex-col items-center gap-2 text-xl">
          your name
          <input
            className="ink-input"
            value={name}
            maxLength={14}
            placeholder="doodle"
            onChange={(e) => onName(e.target.value)}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {(["ffa", "tdm", "br"] as MatchMode[]).map((k) => (
            <button
              key={k}
              className={`gun-chip ${matchMode === k ? "on" : ""}`}
              onClick={() => {
                onMatchMode(k);
                m.mode = k;
              }}
            >
              {k === "ffa" ? "FREE-FOR-ALL" : k === "tdm" ? "TEAM DEATHMATCH" : "BATTLE ROYALE"}
            </button>
          ))}
        </div>

        {err && <p className="mt-4 text-lg text-[var(--red)]">{err}</p>}
        {busy && <p className="mt-4 text-lg opacity-70">{busy}…</p>}

        <div className="mt-5 flex flex-col gap-3">
          <button
            className="ink-btn big"
            disabled={!!busy}
            onClick={async () => {
              setBusy("looking for a lobby");
              setErr("");
              try {
                // hunts for real players for 40s, then opens a bot lobby
                await m.quickPlay((s) => setBusy(s));
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
              setBusy("");
            }}
          >
            quick play
          </button>
          <button
            className="ink-btn"
            disabled={!!busy}
            onClick={() =>
              run("opening a lobby", async () => {
                await m.host(false, m.mapKey, matchMode);
                m.fillTo = matchMode === "ffa" ? 8 : 10;
              })
            }
          >
            practice vs bots
          </button>
          <div className="flex gap-2">
            <button className="ink-btn flex-1" disabled={!!busy} onClick={() => run("opening a lobby", () => m.host(true, m.mapKey, matchMode))}>
              host public
            </button>
            <button className="ink-btn flex-1" disabled={!!busy} onClick={() => run("opening a lobby", () => m.host(false, m.mapKey, matchMode))}>
              host private
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className="ink-input flex-1 tracking-[0.2em] uppercase"
              value={code}
              maxLength={5}
              placeholder="CODE"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="ink-btn" disabled={!!busy || code.length < 5} onClick={() => run("joining", () => m.join(code))}>
              join
            </button>
          </div>
          <button className="ink-btn" onClick={onMenu}>
            back
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadoutScreen({
  loadout,
  onChange,
  onBack,
}: {
  loadout: WeaponKind[];
  onChange: (l: WeaponKind[]) => void;
  onBack: () => void;
}) {
  const carried = loadout.filter(isGun);
  const melee = loadout.find((k) => !isGun(k)) ?? "knife";

  const setSlot = (slot: number, kind: WeaponKind) => {
    const next = [...carried];
    // if that gun already sits in another slot, swap them rather than carry it twice
    const existing = next.indexOf(kind);
    if (existing >= 0 && existing !== slot) next[existing] = next[slot];
    next[slot] = kind;
    onChange([...next, melee]);
  };

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto p-4 paper-bg">
      <div className="ink-panel mx-auto w-full max-w-[860px] px-7 py-6">
        <h2 className="m-0 text-center font-[Caveat,cursive] text-5xl">loadout</h2>
        <p className="mt-1 text-center text-lg opacity-70">
          three guns on 1–3, {WEAPONS.find((w) => w.kind === melee)?.name.toLowerCase()} always on 4
        </p>

        {[0, 1, 2].map((slot) => (
          <div key={slot} className="mt-5">
            <div className="mb-2 flex items-center gap-3 border-b-2 border-[var(--ink)] text-2xl">
              <span>slot {slot + 1}</span>
              <WeaponIcon kind={carried[slot]} className="wicon big" />
              <span className="text-lg opacity-60">{WEAPONS.find((w) => w.kind === carried[slot])?.name}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {GUNS.map((w) => (
                <button
                  key={w.kind}
                  className={`gun-chip withicon ${carried[slot] === w.kind ? "on" : ""}`}
                  onClick={() => setSlot(slot, w.kind)}
                  aria-label={w.name}
                  title={`${w.name} — ${w.hint}`}
                >
                  <WeaponIcon kind={w.kind} />
                  <span className="wname">{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-6 text-lg leading-snug opacity-80">
          {carried.map((k) => {
            const w = WEAPONS.find((x) => x.kind === k);
            return (
              <div key={k} className="flex items-center gap-3">
                <WeaponIcon kind={k} />
                <b className="text-base">{w?.name}</b>
                <span>{w?.hint}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-center">
          <button className="ink-btn" onClick={onBack}>
            back
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Minimap. Blips arrive in world space and get rotated into the player's frame
 * here, so "up" is always the way you are facing — which is what you actually
 * read a minimap for.
 */
function Minimap({ hud }: { hud: HudSnap }) {
  const R = 50;
  const half = hud.radarHalf || 40;
  const scale = R / half;
  const me = hud.radarSelf;
  // the player's own basis, straight out of the movement code
  const fwdX = -Math.sin(me.yaw);
  const fwdZ = -Math.cos(me.yaw);
  const rgtX = Math.cos(me.yaw);
  const rgtZ = -Math.sin(me.yaw);

  const blips = hud.radar
    .map((b) => {
      const dx = b.x - me.x;
      const dz = b.z - me.z;
      return {
        x: (dx * rgtX + dz * rgtZ) * scale,
        y: -(dx * fwdX + dz * fwdZ) * scale,
        hostile: b.hostile,
      };
    })
    .filter((b) => b.x * b.x + b.y * b.y < R * R);

  return (
    <div className="minimap hud-bit">
      <svg viewBox="-58 -58 116 116" width="100%" height="100%" aria-hidden="true">
        <circle cx="0" cy="0" r="53" fill="rgba(246,243,230,0.45)" stroke="var(--ink)" strokeWidth="2.5" />
        <line x1="0" y1="-53" x2="0" y2="-44" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
        {blips.map((b, i) => (
          <circle
            key={i}
            cx={b.x}
            cy={b.y}
            r="4.2"
            fill={b.hostile ? "var(--red)" : "var(--ink)"}
            opacity={b.hostile ? 0.95 : 0.55}
          />
        ))}
        {/* you, always dead centre, always pointing up */}
        <path d="M0 -8 L6 7 L0 3.5 L-6 7 Z" fill="var(--ink)" />
      </svg>
    </div>
  );
}

const STREAK_ICONS: Record<string, React.ReactNode> = {
  uav: (
    <>
      <path d="M4 15h20M14 15l-4-7 4 1 4-1z" />
      <path d="M8 19a8 8 0 0 1 12 0" />
    </>
  ),
  drone: (
    <>
      <rect x="10" y="11" width="8" height="5" rx="1" />
      <circle cx="6" cy="8" r="3" />
      <circle cx="22" cy="8" r="3" />
      <path d="M8.5 10l2 1.5M19.5 10l-2 1.5M12 16v3h4v-3" />
    </>
  ),
  missile: (
    <>
      <path d="M6 14c0-4 5-9 12-10-1 7-6 12-10 12z" />
      <path d="M8 16l-3 4 5-1" />
      <circle cx="14" cy="9" r="1.6" />
    </>
  ),
  swarm: (
    <>
      <circle cx="7" cy="8" r="2" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="21" cy="11" r="2" />
      <circle cx="10" cy="15" r="2" />
      <circle cx="18" cy="17" r="2" />
      <circle cx="5" cy="18" r="2" />
    </>
  ),
};

const STREAK_LABELS: Record<string, string> = {
  uav: "UAV",
  drone: "DRONE",
  missile: "PREDATOR",
  swarm: "SWARM",
};

/** Earned streaks, bottom-left, the way every shooter puts them. */
function StreakTray({ hud, onUse }: { hud: HudSnap; onUse: (k: string) => void }) {
  if (!hud.streakReady.length) return null;
  return (
    <div className="streak-tray">
      {hud.streakReady.map((k) => (
        <button key={k} className="streak" onClick={() => onUse(k)} aria-label={STREAK_LABELS[k] ?? k}>
          <svg viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
            {STREAK_ICONS[k]}
          </svg>
          <em>{STREAK_LABELS[k] ?? k}</em>
        </button>
      ))}
    </div>
  );
}

/** Rounded rifle round, PUBG-style, so the ammo count reads at a glance. */
function Bullet() {
  return (
    <svg className="bullet" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 1.5c2.7 2.2 4.2 4.9 4.2 7.6v9.6c0 1.1-1.2 1.8-4.2 1.8s-4.2-.7-4.2-1.8V9.1c0-2.7 1.5-5.4 4.2-7.6z"
        fill="currentColor"
      />
      <path d="M7.9 12.4h8.3" stroke="rgba(246,243,230,0.85)" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function HUD({ hud, hidden, touch, preset }: { hud: HudSnap; hidden: boolean; touch: boolean; preset: string }) {
  const magN = Number(hud.mag);
  const ticks = Number.isFinite(magN) ? Math.min(magN, 40) : 0;
  if (hidden) return null;
  return (
    <div className={`hud-root playing ${hud.low ? "low" : ""} ${touch ? "touch" : ""} ${preset}`}>
      <div className={`scope ${hud.ads && hud.weapon === "SNIPER" ? "on" : ""}`}>
        <div className="mask" />
        <div className="ring" />
        <div className="cx" />
        <div className="cy" />
      </div>
      <div
        className={`crosshair ${hud.melee ? "melee" : ""} ${hud.ads ? "ads" : ""}`}
        style={{ ["--s" as string]: `${hud.spread}px` }}
      >
        <i className="ch-t" />
        <i className="ch-b" />
        <i className="ch-l" />
        <i className="ch-r" />
        <i className="ch-dot" />
      </div>
      <div key={hud.hitmarker} className={`hitmarker show ${hud.hitKill ? "kill" : ""} ${hud.hitCrit ? "crit" : ""}`}>
        <i />
        <i />
      </div>
      {hud.dmgAngle != null && (
        <div className="dmg-ind" key={hud.hp}>
          <i style={{ transform: `rotate(${(hud.dmgAngle * 180) / Math.PI}deg)` }} />
        </div>
      )}

      <div className="hud-tl hud-bit">
        <div>
          SCORE <b>{hud.score}</b>
        </div>
        <div className="text-[var(--red)]">{hud.combo > 1 ? `combo x${hud.combo}` : ""}</div>
      </div>
      <Minimap hud={hud} />
      {hud.uav && <div className="uav-flag hud-bit">UAV</div>}
      {hud.piloting && <div className="pilot-flag hud-bit">steering · drag to fly</div>}

      {/* waves are a PvE idea; the arena has none */}
      {hud.mode !== "arena" && (
        <div className="hud-tr hud-bit">
          <div>
            {hud.waveLabel} <b>{hud.wave}</b>
          </div>
          <div className="text-[var(--red)]">{hud.modifier}</div>
          <div>
            <b>{hud.left}</b> {hud.mode === "zombies" ? "undead" : "enemies"} left
          </div>
        </div>
      )}

      {hud.boss && (
        <div className="bossbar hud-bit">
          <div>{hud.boss.name}</div>
          <div className="bar big">
            <div className="fill red" style={{ width: `${hud.boss.frac * 100}%` }} />
          </div>
        </div>
      )}

      {touch ? (
        /* Everything lives in the strip between the two thumb zones, so nothing
           can sit under the stick or the fire button. */
        <div className="m-deck hud-bit">
          <div className="m-weapons">
            {hud.slots.map((s, i) => (
              /* only the equipped gun is named; the rest stay as numbered stubs
                 so the row cannot outgrow the space between the thumbs */
              <div key={s.name} className={`m-wep ${s.active ? "on" : ""} ${s.empty ? "empty" : ""}`}>
                <span className="n">{i + 1}</span>
                <div className="stack">
                  <WeaponIcon kind={s.kind} className="wicon sm" />
                  {s.active && <span className="wname">{s.name}</span>}
                </div>
                <span className="am">{s.ammo}</span>
              </div>
            ))}
          </div>
          {/* one DOM, two arrangements: the preset only changes .m-row's axis */}
          <div className="m-row">
            <div className="m-hp">
              <div className="bar">
                <div className="fill" style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }} />
              </div>
              <span>{Math.ceil(hud.hp)}</span>
            </div>
            <div className="m-ammo">
              <Bullet />
              <b>{hud.mag}</b>
              <span>{hud.reserve}</span>
              {hud.reloading && <em>reloading…</em>}
              <span className="nades">
                {Array.from({ length: hud.nades }).map((_, i) => (
                  <i key={i} />
                ))}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="hud-bl hud-bit">
            <div className="mb-2 flex items-center gap-2 text-2xl">
              <span>HP</span>
              <div className="bar">
                <div className="fill" style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }} />
              </div>
              <span>{Math.ceil(hud.hp)}</span>
            </div>
            <div className="ammo">
              <b>{hud.mag}</b>
              <span>{hud.reserve}</span>
              {hud.reloading && <span className="ml-2 text-[var(--red)]">reloading…</span>}
              <span className="nades ml-3">
                {Array.from({ length: hud.nades }).map((_, i) => (
                  <i key={i} />
                ))}
              </span>
            </div>
            <div className="tally">
              {Array.from({ length: ticks }).map((_, i) => (
                <i key={i} />
              ))}
            </div>
          </div>
          <div className="hud-br hud-bit">
            <div className="mb-1 flex flex-col items-end">
              {hud.slots.map((s, i) => (
                <div key={s.name} className={`slot ${s.active ? "active" : ""} ${s.empty ? "empty" : ""}`} title={s.name}>
                  <span className="opacity-60">{i + 1}</span>
                  <WeaponIcon kind={s.kind} />
                  <span className="wname">{s.name}</span>
                  <span className="text-base opacity-70">{s.ammo}</span>
                </div>
              ))}
            </div>
            <WeaponIcon kind={hud.slots[hud.slots.findIndex((s) => s.active)]?.kind ?? "rifle"} className="wicon big" />
            <div className="text-lg opacity-70">{hud.hint}</div>
          </div>
        </>
      )}

      <div className={`focus-meter hud-bit ${hud.melee ? "on" : ""} ${hud.focusReady ? "ready" : ""}`}>
        <div className="text-[10px] tracking-widest">BLADE</div>
        <div className="fm-tube">
          <div className="fm-fill" style={{ height: `${hud.focusFrac * 100}%` }} />
        </div>
      </div>

      <div className="absolute left-0 right-0 top-[22%] pointer-events-none">
        {hud.message && <div className="msg-main show">{hud.message}</div>}
        {hud.sub && <div className="msg-sub">{hud.sub}</div>}
      </div>
      <div className="hud-tip absolute left-0 right-0 text-center text-2xl hud-bit">{hud.tip}</div>
      <div className="killfeed hud-bit">
        {hud.killFeed.map((k) => (
          <div key={k.id}>
            {k.text} <span className="pts">+{k.pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PauseOverlay({ onResume, onMenu }: { onResume: () => void; onMenu: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(246,243,230,0.62)] p-4">
      <div className="ink-panel px-12 py-8 text-center">
        <h2 className="m-0 font-[Caveat,cursive] text-6xl">paused</h2>
        <p className="mt-2 text-xl opacity-80">the doodles are waiting</p>
        <div className="mt-6 flex flex-col gap-3">
          <button className="ink-btn big" onClick={onResume}>
            resume
          </button>
          <button className="ink-btn" onClick={onMenu}>
            menu
          </button>
        </div>
      </div>
    </div>
  );
}

function DeadOverlay({ hud, onRetry, onMenu }: { hud: HudSnap; onRetry: () => void; onMenu: () => void }) {
  const t = Math.floor(hud.time);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(246,243,230,0.7)] p-4">
      <div className="ink-panel max-w-[560px] px-10 py-8 text-center">
        <h2 className="m-0 font-[Caveat,cursive] text-6xl text-[var(--red)]">ERASED</h2>
        <p className="mt-1 text-2xl">{hud.mode === "zombies" ? "the page is overrun" : "the doodles won"}</p>
        <div className="mt-5 text-2xl leading-relaxed">
          <div>
            score <b className="text-[var(--red)]">{hud.score}</b>
          </div>
          <div>
            {hud.waveLabel.toLowerCase()} <b>{hud.wave}</b> · kills <b>{hud.kills}</b>
          </div>
          <div>
            time <b>
              {Math.floor(t / 60)}:{(t % 60).toString().padStart(2, "0")}
            </b>
          </div>
          <div className="opacity-70">best {hud.best}</div>
        </div>
        <div className="mt-7 flex flex-col gap-3">
          <button className="ink-btn big red" onClick={onRetry}>
            scribble again
          </button>
          <button className="ink-btn" onClick={onMenu}>
            menu
          </button>
        </div>
      </div>
    </div>
  );
}

const LOOK_GAIN = 1.8;

const ICONS: Record<string, React.ReactNode> = {
  fire: (
    <>
      <circle cx="12" cy="12" r="6.6" />
      <line x1="12" y1="1.8" x2="12" y2="4.4" />
      <line x1="12" y1="19.6" x2="12" y2="22.2" />
      <line x1="1.8" y1="12" x2="4.4" y2="12" />
      <line x1="19.6" y1="12" x2="22.2" y2="12" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  aim: (
    <>
      <circle cx="12" cy="12" r="6.4" />
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </>
  ),
  jump: (
    <>
      <line x1="12" y1="17.5" x2="12" y2="4.5" />
      <polyline points="6.6 9.9 12 4.5 17.4 9.9" />
      <line x1="5" y1="21" x2="19" y2="21" />
    </>
  ),
  crouch: (
    <>
      <line x1="12" y1="4" x2="12" y2="16.5" />
      <polyline points="6.6 11.1 12 16.5 17.4 11.1" />
      <line x1="5" y1="21" x2="19" y2="21" />
    </>
  ),
  sprint: (
    <>
      <polyline points="5 6 10.5 12 5 18" />
      <polyline points="12.5 6 18 12 12.5 18" />
    </>
  ),
  reload: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </>
  ),
  nade: (
    <>
      <circle cx="11.5" cy="14.5" r="6" />
      <path d="M9.3 8.5V6.8h4.4v1.7" />
      <path d="M13.7 7.4c2.8-.4 4.3.8 4.5 3.1" />
      <circle cx="18.6" cy="5.5" r="1.6" />
    </>
  ),
  wep: (
    <>
      <path d="M2.5 8.5h15.5v3.2h-3.4l-2.1 4.4H9.2l1.5-4.4H2.5z" />
      <line x1="6" y1="11.7" x2="6" y2="14" />
    </>
  ),
  pause: (
    <>
      <line x1="9" y1="5" x2="9" y2="19" />
      <line x1="15" y1="5" x2="15" y2="19" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      className="tico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function TouchControls({ gameRef }: { gameRef: React.RefObject<Game | null> }) {
  const joyRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const lookId = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });
  const joyId = useRef<number | null>(null);
  // Pointers that began on an action button. They keep the button held AND steer
  // the camera, so one thumb can hold FIRE and aim without a second finger.
  const dragLook = useRef(new Map<number, { x: number; y: number }>());

  const setBtn = (name: string, down: boolean) => {
    gameRef.current?.input.setTouch(name, down);
    setHeld((h) => ({ ...h, [name]: down }));
  };

  const trackDrag = (e: React.PointerEvent) => {
    dragLook.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const dragToLook = (e: React.PointerEvent) => {
    const last = dragLook.current.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;
    if (dx || dy) gameRef.current?.input.addTouchLook(dx * LOOK_GAIN, dy * LOOK_GAIN);
  };
  const endDrag = (e: React.PointerEvent) => {
    dragLook.current.delete(e.pointerId);
  };

  useEffect(() => {
    const drags = dragLook.current;
    return () => {
      drags.clear();
      gameRef.current?.input.clearTouch();
    };
  }, [gameRef]);

  const onJoyDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    joyId.current = e.pointerId;
    moveJoy(e);
  };
  const moveJoy = (e: React.PointerEvent | PointerEvent) => {
    const base = joyRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width * 0.38;
    const mag = Math.hypot(dx, dy);
    if (mag > max) {
      dx = (dx / mag) * max;
      dy = (dy / mag) * max;
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    gameRef.current?.input.setTouchMove(dx / max, -dy / max);
  };
  const onJoyUp = (e: React.PointerEvent) => {
    if (joyId.current !== e.pointerId) return;
    joyId.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(0,0)";
    gameRef.current?.input.setTouchMove(0, 0);
  };

  const onLookDown = (e: React.PointerEvent) => {
    e.preventDefault();
    lookId.current = e.pointerId;
    lastLook.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (lookId.current !== e.pointerId) return;
    const dx = e.clientX - lastLook.current.x;
    const dy = e.clientY - lastLook.current.y;
    lastLook.current = { x: e.clientX, y: e.clientY };
    gameRef.current?.input.addTouchLook(dx * LOOK_GAIN, dy * LOOK_GAIN);
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (lookId.current === e.pointerId) lookId.current = null;
  };

  const hold = (name: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // capture on the button, not the <svg> icon inside it
      e.currentTarget.setPointerCapture(e.pointerId);
      trackDrag(e);
      setBtn(name, true);
    },
    onPointerMove: dragToLook,
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      endDrag(e);
      setBtn(name, false);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      endDrag(e);
      setBtn(name, false);
    },
  });

  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      trackDrag(e);
      fn();
    },
    onPointerMove: dragToLook,
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      endDrag(e);
    },
    onPointerCancel: endDrag,
  });

  return (
    <div className="touch-layer">
      <div
        className="look-pad"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />
      <div
        ref={joyRef}
        className="joy-base"
        onPointerDown={onJoyDown}
        onPointerMove={(e) => joyId.current === e.pointerId && moveJoy(e)}
        onPointerUp={onJoyUp}
        onPointerCancel={onJoyUp}
      >
        <div ref={knobRef} className="joy-knob" />
      </div>
      <button className={`tbtn fire ${held.fire ? "held" : ""}`} aria-label="fire" {...hold("fire")}>
        <Icon name="fire" />
      </button>
      <button className={`tbtn jump ${held.jump ? "held" : ""}`} aria-label="jump" {...hold("jump")}>
        <Icon name="jump" />
      </button>
      <button className={`tbtn aim ${held.aim ? "held" : ""}`} aria-label="aim" {...hold("aim")}>
        <Icon name="aim" />
      </button>
      <button className={`tbtn reload ${held.reload ? "held" : ""}`} aria-label="reload" {...hold("reload")}>
        <Icon name="reload" />
      </button>
      <button className={`tbtn sprint ${held.sprint ? "held" : ""}`} aria-label="sprint" {...hold("sprint")}>
        <Icon name="sprint" />
      </button>
      <button className={`tbtn crouch ${held.crouch ? "held" : ""}`} aria-label="crouch" {...hold("crouch")}>
        <Icon name="crouch" />
      </button>
      <button className={`tbtn nade ${held.grenade ? "held" : ""}`} aria-label="grenade" {...hold("grenade")}>
        <Icon name="nade" />
      </button>
      <button className="tbtn wep" aria-label="switch weapon" {...tap(() => gameRef.current?.player.nextWeapon(1))}>
        <Icon name="wep" />
      </button>
      <button
        className="tbtn pause"
        aria-label="pause"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          gameRef.current?.pause();
        }}
      >
        <Icon name="pause" />
      </button>
    </div>
  );
}