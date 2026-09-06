import { useCallback, useEffect, useRef, useState } from "react";
import { Game, type GameState, type HudSnap } from "./game/engine";
import { MAPS, DEFAULT_MAP, type Mode } from "./game/level";
import { WEAPONS, sanitizeLoadout, weaponDef, type WeaponKind } from "./game/player";
import {
  SLOTS,
  applyBuild,
  attachmentsFor,
  modLines,
  sanitizeGunsmith,
  type GunBuild,
  type Gunsmith,
} from "./game/attachments";
import { SKILLS, SKILL_ORDER, sanitizeSkill, type SkillKind } from "./game/skills";
import { EMOTES, EMOTE_ORDER, type EmoteKind } from "./game/emotes";
import { nextTier, sanitizeSr, tierOf, tierProgress } from "./game/rank";
import { BINDABLE, currentBindings, keyLabel, resetBindings, setBinding } from "./game/input";
import {
  CAMOS,
  CHARMS,
  STICKERS,
  enforceUnlocks,
  nextCamo,
  sanitizeKills,
  sanitizeWardrobe,
  type KillLog,
  type Wardrobe,
  type WeaponSkin,
} from "./game/cosmetics";
import { SCORE_TARGET, type MatchMode, type MatchNet } from "./game/match";
import type { BotSkill } from "./game/bot";
import { WeaponIcon } from "./WeaponIcon";
import { QUALITY, isQuality, type Quality } from "./game/renderer";
import * as account from "./game/account";

type Screen = "menu" | "modes" | "howto" | "settings" | "loadout" | "game";

const GUNS = WEAPONS.filter((w) => w.isGun);
const MELEE = WEAPONS.filter((w) => !w.isGun);
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

function loadGunsmith(): Gunsmith {
  try {
    return sanitizeGunsmith(JSON.parse(localStorage.getItem("doodle_gunsmith") || "null"));
  } catch {
    return {};
  }
}

function loadKills(): KillLog {
  try {
    return sanitizeKills(JSON.parse(localStorage.getItem("doodle_wkills") || "null"));
  } catch {
    return {};
  }
}

function loadWardrobe(kills: KillLog): Wardrobe {
  try {
    return enforceUnlocks(sanitizeWardrobe(JSON.parse(localStorage.getItem("doodle_skins") || "null")), kills);
  } catch {
    return {};
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
  radarWalls: [],
  radarSelf: { x: 0, z: 0, yaw: 0 },
  radarHalf: 40,
  grappleStam: 1,
  grappleOn: false,
  grappleAim: false,
  skill: "grappler",
  skillCharge: 0,
  skillActive: 0,
  skillReady: false,
  night: false,
  goggles: false,
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
  const [gunsmith, setGunsmith] = useState<Gunsmith>(loadGunsmith);
  const [skill, setSkill] = useState<SkillKind>(() => sanitizeSkill(localStorage.getItem("doodle_skill")));
  const [weaponKills, setWeaponKills] = useState<KillLog>(loadKills);
  const [wardrobe, setWardrobe] = useState<Wardrobe>(() => loadWardrobe(loadKills()));
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("doodle_name") || "");
  const [matchMode, setMatchMode] = useState<MatchMode>("ffa");
  // MatchNet lives outside React; bump this to re-read it
  const [netTick, setNetTick] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
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
  const [fpsCap, setFpsCap] = useState(() => Number(localStorage.getItem("doodle_fps") || 0));
  const [night, setNight] = useState(() => localStorage.getItem("doodle_night") === "1");
  const [ranked, setRanked] = useState(() => localStorage.getItem("doodle_ranked") === "1");
  const [sr, setSr] = useState(() => sanitizeSr(localStorage.getItem("doodle_sr")));
  const [srSwing, setSrSwing] = useState(0);
  const [playerUid, setPlayerUid] = useState(() => account.uid());
  const [bestD, setBestD] = useState(Number(localStorage.getItem("doodle_best") || 0));
  const [bestZ, setBestZ] = useState(Number(localStorage.getItem("doodle_zbest") || 0));
  const [runId, setRunId] = useState(0);
  const [locked, setLocked] = useState(false);
  const hudLatest = useRef(hud);
  // Read through a ref when building the Game. If `loadout` were a dependency of
  // that effect, swapping kit mid-match would tear the whole match down.
  const loadoutRef = useRef(loadout);
  loadoutRef.current = loadout;
  const gunsmithRef = useRef(gunsmith);
  gunsmithRef.current = gunsmith;
  const wardrobeRef = useRef(wardrobe);
  wardrobeRef.current = wardrobe;
  const skillRef = useRef(skill);
  skillRef.current = skill;
  const nightRef = useRef(night);
  nightRef.current = night;
  const rankedRef = useRef(ranked);
  rankedRef.current = ranked;
  const srRef = useRef(sr);
  srRef.current = sr;
  const killsRef = useRef(weaponKills);
  killsRef.current = weaponKills;

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
      const st = r.profile?.settings as
        | { gunsmith?: unknown; skins?: unknown; wkills?: unknown; skill?: unknown; sr?: unknown }
        | undefined;
      if (st?.sr !== undefined) {
        const banked = sanitizeSr(st.sr);
        setSr(banked);
        localStorage.setItem("doodle_sr", String(banked));
      }
      const saved = sanitizeGunsmith(st?.gunsmith);
      if (Object.keys(saved).length) setGunsmith(saved);
      const log = sanitizeKills(st?.wkills);
      if (Object.keys(log).length) {
        setWeaponKills(log);
        localStorage.setItem("doodle_wkills", JSON.stringify(log));
      }
      const worn = enforceUnlocks(sanitizeWardrobe(st?.skins), log);
      if (Object.keys(worn).length) setWardrobe(worn);
      if (typeof (st as { skill?: unknown })?.skill === "string") {
        setSkill(sanitizeSkill((st as { skill?: unknown }).skill));
      }
      if (!localStorage.getItem("doodle_name")) setPlayerName(r.user.username);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Weapon kills accumulate through a match; push them to the profile once, on
  // the way out. Saving per kill would be one API call every second or two.
  useEffect(() => {
    if (screen === "game") return;
    if (!Object.keys(killsRef.current).length) return;
    account.saveProfileSoon(loadoutRef.current, {
      gunsmith: gunsmithRef.current,
      skins: wardrobeRef.current,
      wkills: killsRef.current,
    });
  }, [screen]);

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
    const g = new Game(
      canvas,
      mode,
      mapKey,
      loadoutRef.current,
      gunsmithRef.current,
      wardrobeRef.current,
      skillRef.current,
      nightRef.current,
      rankedRef.current,
      srRef.current,
    );
    g.setFpsCap(Number(localStorage.getItem("doodle_fps") || 0));
    g.onRanked = (delta) => {
      setSrSwing(delta);
      setSr((prev) => {
        const next = Math.max(0, prev + delta);
        localStorage.setItem("doodle_sr", String(next));
        account.saveProfileSoon(loadoutRef.current, {
          gunsmith: gunsmithRef.current,
          skins: wardrobeRef.current,
          wkills: killsRef.current,
          skill: skillRef.current,
          sr: next,
        });
        return next;
      });
    };
    g.onWeaponKill = (k) => {
      setWeaponKills((prev) => {
        const next = { ...prev, [k]: (prev[k] ?? 0) + 1 };
        localStorage.setItem("doodle_wkills", JSON.stringify(next));
        return next;
      });
    };
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
          onPlay={() => setScreen("modes")}
          onHow={() => setScreen("howto")}
          onSettings={() => setScreen("settings")}
          onLoadout={() => setScreen("loadout")}
          me={me}
        />
      )}
      {screen === "modes" && (
        <ModePicker
          mapKey={mapKey}
          onMap={(k) => {
            setMapKey(k);
            localStorage.setItem("doodle_map", k);
          }}
          matchMode={matchMode}
          onMatchMode={setMatchMode}
          night={night}
          onNight={(v) => {
            setNight(v);
            localStorage.setItem("doodle_night", v ? "1" : "0");
          }}
          ranked={ranked}
          onRanked={(v) => {
            setRanked(v);
            localStorage.setItem("doodle_ranked", v ? "1" : "0");
          }}
          sr={sr}
          bestD={bestD}
          bestZ={bestZ}
          onSolo={(m) => launch(m)}
          onMultiplayer={() => launch("arena")}
          onBack={() => setScreen("menu")}
        />
      )}
      {screen === "howto" && <HowTo onBack={() => setScreen("menu")} touch={touch} />}
      {screen === "loadout" && (
        <LoadoutScreen
          loadout={loadout}
          gunsmith={gunsmith}
          wardrobe={wardrobe}
          weaponKills={weaponKills}
          skill={skill}
          onSkill={(k) => {
            setSkill(k);
            localStorage.setItem("doodle_skill", k);
            account.saveProfileSoon(loadout, { gunsmith, skins: wardrobe, wkills: weaponKills, skill: k });
          }}
          onChange={(l) => {
            setLoadout(l);
            localStorage.setItem("doodle_loadout", JSON.stringify(l));
            // coalesced: tapping through chips must not be one API call each
            account.saveProfileSoon(l, { gunsmith, skins: wardrobe, wkills: weaponKills });
          }}
          onGunsmith={(g) => {
            setGunsmith(g);
            localStorage.setItem("doodle_gunsmith", JSON.stringify(g));
            account.saveProfileSoon(loadout, { gunsmith: g, skins: wardrobe, wkills: weaponKills });
          }}
          onWardrobe={(w) => {
            setWardrobe(w);
            localStorage.setItem("doodle_skins", JSON.stringify(w));
            account.saveProfileSoon(loadout, { gunsmith, skins: w, wkills: weaponKills });
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
          fps={fpsCap}
          onFps={(v) => {
            setFpsCap(v);
            localStorage.setItem("doodle_fps", String(v));
            gameRef.current?.setFpsCap(v);
          }}
          me={me}
          stats={stats}
          uid={playerUid}
          onSignedIn={(user, profile, s) => {
            setMe(user);
            setStats(s);
            account.adoptUid(user.id);
            setPlayerUid(user.id);
            if (profile?.loadout?.length) setLoadout(sanitizeLoadout(profile.loadout));
            const st = profile?.settings as
              | { gunsmith?: unknown; skins?: unknown; wkills?: unknown; skill?: unknown; sr?: unknown }
              | undefined;
            if (st?.sr !== undefined) {
              const banked = sanitizeSr(st.sr);
              setSr(banked);
              localStorage.setItem("doodle_sr", String(banked));
            }
            const kits = sanitizeGunsmith(st?.gunsmith);
            if (Object.keys(kits).length) setGunsmith(kits);
            const log = sanitizeKills(st?.wkills);
            if (Object.keys(log).length) setWeaponKills(log);
            const worn = enforceUnlocks(sanitizeWardrobe(st?.skins), log);
            if (Object.keys(worn).length) setWardrobe(worn);
            if (typeof st?.skill === "string") setSkill(sanitizeSkill(st.skill));
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

      {screen === "game" && (
        <>
          <HUD hud={hud} hidden={gstate === "paused" || gstate === "dead"} touch={touch} preset={hudPreset} />
          {!touch && gstate === "playing" && !locked && !emoteOpen && (
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
          {gstate === "playing" && (
            <EmoteWheel gameRef={gameRef} touch={touch} open={emoteOpen} setOpen={setEmoteOpen} />
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
                gunsmith={gunsmith}
                wardrobe={wardrobe}
                weaponKills={weaponKills}
                skill={skill}
                onSkill={(k) => {
                  setSkill(k);
                  localStorage.setItem("doodle_skill", k);
                  account.saveProfileSoon(loadout, { gunsmith, skins: wardrobe, wkills: weaponKills, skill: k });
                  gameRef.current?.setSkill(k);
                }}
                onChange={(l) => {
                  setLoadout(l);
                  localStorage.setItem("doodle_loadout", JSON.stringify(l));
                  account.saveProfileSoon(l, { gunsmith, skins: wardrobe, wkills: weaponKills });
                  gameRef.current?.applyLoadout(l, gunsmith, wardrobe);
                }}
                onGunsmith={(g) => {
                  setGunsmith(g);
                  localStorage.setItem("doodle_gunsmith", JSON.stringify(g));
                  account.saveProfileSoon(loadout, { gunsmith: g, skins: wardrobe, wkills: weaponKills });
                  gameRef.current?.applyLoadout(loadout, g, wardrobe);
                }}
                onWardrobe={(w) => {
                  setWardrobe(w);
                  localStorage.setItem("doodle_skins", JSON.stringify(w));
                  account.saveProfileSoon(loadout, { gunsmith, skins: w, wkills: weaponKills });
                  gameRef.current?.applyLoadout(loadout, gunsmith, w);
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
              ranked={ranked}
              sr={sr}
              srSwing={srSwing}
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
  onPlay,
  onHow,
  onSettings,
  onLoadout,
  me,
}: {
  bestD: number;
  bestZ: number;
  onPlay: () => void;
  onHow: () => void;
  onSettings: () => void;
  onLoadout: () => void;
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

        <button className="ink-btn big mt-8 px-16 text-4xl" onClick={onPlay}>
          play
        </button>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button className="ink-btn" onClick={onLoadout}>
            loadout
          </button>
          <button className="ink-btn" onClick={onHow}>
            how to play
          </button>
          <button className="ink-btn" onClick={onSettings}>
            settings
          </button>
        </div>
        <p className="mt-5 text-base opacity-60">
          {me ? `signed in as ${me.username}` : "playing as a guest · sign in from settings"}
          {" · best "}
          {bestD}/{bestZ}
        </p>
      </div>
    </div>
  );
}

/** Tier name, SR, and how far through the tier you are. */
function RankBadge({ sr, swing }: { sr: number; swing?: number }) {
  const tier = tierOf(sr);
  const next = nextTier(sr);
  return (
    <div className="rank-badge">
      <b>{tier.name}</b>
      <span className="sr">
        {sr} SR
        {swing ? <em className={swing > 0 ? "up" : "down"}>{swing > 0 ? `+${swing}` : swing}</em> : null}
      </span>
      <span className="bar">
        <i style={{ width: `${tierProgress(sr) * 100}%` }} />
      </span>
      <span className="text-[11px] opacity-60">{next ? `${next.at - sr} to ${next.name.toLowerCase()}` : "top of the ladder"}</span>
    </div>
  );
}

/** Pick a mode, and for the multiplayer ones a map, before anything connects. */
function ModePicker({
  mapKey,
  onMap,
  matchMode,
  onMatchMode,
  night,
  onNight,
  ranked,
  onRanked,
  sr,
  bestD,
  bestZ,
  onSolo,
  onMultiplayer,
  onBack,
}: {
  mapKey: string;
  onMap: (k: string) => void;
  matchMode: MatchMode;
  onMatchMode: (m: MatchMode) => void;
  night: boolean;
  onNight: (v: boolean) => void;
  ranked: boolean;
  onRanked: (v: boolean) => void;
  sr: number;
  bestD: number;
  bestZ: number;
  onSolo: (m: Mode) => void;
  onMultiplayer: (m: MatchMode) => void;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto p-4 paper-bg">
      <div className="ink-panel mx-auto w-full max-w-[920px] px-6 py-8 text-center sm:px-10">
        <h2 className="m-0 font-[Caveat,cursive] text-5xl">pick a mode</h2>

        <div className="mt-6 text-lg uppercase tracking-widest opacity-60">on your own</div>
        <div className="mt-2 flex flex-col items-stretch justify-center gap-4 sm:flex-row">
          <button className="ink-panel mode-card p-5 text-left" onClick={() => onSolo("district")}>
            <div className="text-sm opacity-70">WAVE SURVIVAL</div>
            <div className="font-[Caveat,cursive] text-4xl">DISTRICT</div>
            <p className="mt-2 text-lg leading-snug opacity-80">
              doodle goons, rooftops, rifles and a blade. clear waves. don&apos;t get sketched out.
            </p>
            <div className="mt-3 text-lg">
              best <b className="text-[var(--red)]">{bestD}</b>
            </div>
          </button>
          <button className="ink-panel mode-card p-5 text-left" onClick={() => onSolo("zombies")}>
            <div className="text-sm text-[var(--red)]">ENDLESS HORDES</div>
            <div className="font-[Caveat,cursive] text-4xl text-[var(--red)]">ZOMBIES</div>
            <p className="mt-2 text-lg leading-snug opacity-80">
              the margin bleeds. shamblers, runners, tanks. they never stop. keep moving.
            </p>
            <div className="mt-3 text-lg">
              best <b className="text-[var(--red)]">{bestZ}</b>
            </div>
          </button>
        </div>

        <div className="mt-8 text-lg uppercase tracking-widest opacity-60">against people</div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {(
            [
              [false, "casual"],
              [true, "ranked"],
            ] as [boolean, string][]
          ).map(([v, label]) => (
            <button key={label} className={`gun-chip ${ranked === v ? "on" : ""}`} onClick={() => onRanked(v)}>
              {label}
            </button>
          ))}
          {ranked && <RankBadge sr={sr} />}
        </div>
        <div className="mt-3 flex flex-wrap items-stretch justify-center gap-3">
          {(
            [
              ["ffa", "FREE-FOR-ALL", "everyone against everyone, first to the target score"],
              ["tdm", "TEAM DEATHMATCH", "five a side, shared score, watch your corners"],
              ["br", "BATTLE ROYALE", "no respawns, a closing circle, loot on the floor"],
            ] as [MatchMode, string, string][]
          ).map(([k, name, blurb]) => (
            <button
              key={k}
              className={`ink-panel mode-card p-5 text-left ${matchMode === k ? "picked" : ""}`}
              onClick={() => {
                onMatchMode(k);
                onMultiplayer(k);
              }}
            >
              <div className="font-[Caveat,cursive] text-3xl">{name}</div>
              <p className="mt-2 text-lg leading-snug opacity-80">{blurb}</p>
            </button>
          ))}
        </div>

        <div className="mt-8">
          <div className="mb-2 text-lg uppercase tracking-widest opacity-60">pick a page</div>
          <div className="flex flex-wrap items-stretch justify-center gap-2">
            {MAPS.map((m) => (
              <button key={m.key} className={`map-chip ${m.key === mapKey ? "on" : ""}`} onClick={() => onMap(m.key)}>
                <div className="text-xl leading-tight">{m.name}</div>
                <div className="text-sm leading-tight opacity-70">{m.blurb}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {(
              [
                [false, "daylight"],
                [true, "after dark"],
              ] as [boolean, string][]
            ).map(([v, label]) => (
              <button key={label} className={`gun-chip ${night === v ? "on" : ""}`} onClick={() => onNight(v)}>
                {label}
              </button>
            ))}
            {night && <span className="text-base opacity-60">bring the goggles · N</span>}
          </div>
        </div>

        <button className="ink-btn mt-7" onClick={onBack}>
          back
        </button>
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
                <b>click</b> fire · <b>right mouse</b> aim · <b>R</b> reload · <b>1–4</b> weapons · <b>G</b> grenade · <b>Q</b> grapple · <b>X</b> dash
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
  fps,
  onFps,
  me,
  stats,
  uid,
  onSignedIn,
  onSignedOut,
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
  fps: number;
  onFps: (v: number) => void;
  me: account.Account | null;
  stats: account.Stats | null;
  uid: string;
  onSignedIn: (u: account.Account, p: account.Profile | null, s: account.Stats | null) => void;
  onSignedOut: () => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"controls" | "video" | "audio" | "account">("controls");

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto p-4 paper-bg">
      <div className="ink-panel mx-auto w-full max-w-[720px] px-8 py-7">
        <h2 className="m-0 text-center font-[Caveat,cursive] text-5xl">settings</h2>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {(
            [
              ["controls", "controls"],
              ["video", "video"],
              ["audio", "audio"],
              ["account", me ? me.username : "account"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`gun-chip ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "controls" && (
          <div className="mt-6 flex flex-col gap-5 text-xl">
            <label className="flex flex-col gap-2">
              look sensitivity {sens}%
              <input
                className="ink-range"
                type="range"
                min={40}
                max={200}
                value={sens}
                onChange={(e) => onSens(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={adsToggle} onChange={(e) => onAdsToggle(e.target.checked)} />
              aim is a toggle, not a hold
            </label>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={invert} onChange={(e) => onInvert(e.target.checked)} />
              invert look y
            </label>
            <Rebinder />
          </div>
        )}

        {tab === "video" && (
          <div className="mt-6 flex flex-col gap-5 text-xl">
            <div className="flex flex-col gap-2">
              <span>graphics</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(QUALITY) as Quality[]).map((q) => (
                  <button key={q} className={`gun-chip ${quality === q ? "on" : ""}`} onClick={() => onQuality(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <span className="text-base opacity-60">higher draws at more of your screen&apos;s real pixels</span>
            </div>
            <div className="flex flex-col gap-2">
              <span>frame rate</span>
              <div className="flex flex-wrap gap-2">
                {[30, 60, 90, 120, 0].map((v) => (
                  <button key={v} className={`gun-chip ${fps === v ? "on" : ""}`} onClick={() => onFps(v)}>
                    {v === 0 ? "uncapped" : `${v} fps`}
                  </button>
                ))}
              </div>
              <span className="text-base opacity-60">a cap your phone can hold beats a number it cannot</span>
            </div>
            <div className="flex flex-col gap-2">
              <span>hud layout</span>
              <div className="flex flex-wrap gap-2">
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
            <InkPicker label="hit colour" value={hitInk} onChange={onHitInk} />
            <InkPicker label="fire projection" value={tracerInk} onChange={onTracerInk} />
          </div>
        )}

        {tab === "audio" && (
          <div className="mt-6 flex flex-col gap-5 text-xl">
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={music} onChange={(e) => onMusic(e.target.checked)} />
              doodle tune
            </label>
          </div>
        )}

        {tab === "account" && (
          <AccountPanel me={me} stats={stats} uid={uid} onSignedIn={onSignedIn} onSignedOut={onSignedOut} />
        )}

        <div className="mt-8 text-center">
          <button className="ink-btn" onClick={onBack}>
            back
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Key rebinding. Clicking a row arms it; the next key press takes the slot and
 * is stripped from wherever else it was bound, because two actions on one key
 * is never what anyone meant.
 */
function Rebinder() {
  const [arming, setArming] = useState<string | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!arming) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== "Escape") setBinding(arming, e.code);
      setArming(null);
      bump((n) => n + 1);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [arming]);

  const binds = currentBindings();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span>keys</span>
        <button
          className="ink-btn ml-auto text-base"
          onClick={() => {
            resetBindings();
            bump((n) => n + 1);
          }}
        >
          reset
        </button>
      </div>
      <div className="bind-grid">
        {BINDABLE.map((b) => (
          <button
            key={b.id}
            className={`bind-row ${arming === b.id ? "arming" : ""}`}
            onClick={() => setArming(b.id)}
          >
            <span>{b.name}</span>
            <kbd>{arming === b.id ? "press a key" : keyLabel(binds[b.id]?.[0] ?? "")}</kbd>
          </button>
        ))}
      </div>
      <span className="text-base opacity-60">esc cancels · mouse buttons stay fire and aim</span>
    </div>
  );
}

function AccountPanel({
  me,
  stats,
  uid,
  onSignedIn,
  onSignedOut,
}: {
  me: account.Account | null;
  stats: account.Stats | null;
  uid: string;
  onSignedIn: (u: account.Account, p: account.Profile | null, s: account.Stats | null) => void;
  onSignedOut: () => void;
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const uidRow = (
    <div className="mt-4 flex items-center justify-between gap-3 border-2 border-dashed border-[var(--ink)] px-3 py-2">
      <span className="text-base opacity-70">player id</span>
      <code className="tracking-[0.14em]">{uid}</code>
    </div>
  );

  if (me) {
    return (
      <div className="mt-6 text-xl">
        <div className="text-center">
          <div className="font-[Caveat,cursive] text-4xl">{me.username}</div>
          <p className="mt-1 text-lg opacity-70">your loadout and scores follow you to any device</p>
        </div>
        {uidRow}
        {stats && (
          <div className="mt-4">
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
        <button
          className="ink-btn mt-5 w-full"
          onClick={async () => {
            await account.logout();
            onSignedOut();
          }}
        >
          sign out
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 text-xl">
      <p className="text-center text-lg opacity-70">optional — the game plays fine without an account</p>
      {uidRow}
      <form
        className="mt-4 flex flex-col gap-3"
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
      <button
        className="ink-btn mt-3 w-full"
        onClick={() => {
          setMode(mode === "register" ? "login" : "register");
          setErr("");
        }}
      >
        {mode === "register" ? "I already have one" : "make a new account"}
      </button>
    </div>
  );
}

function Online({
  gameRef,
  tick,
  name,
  onName,
  matchMode,
  ranked,
  sr,
  srSwing,
  onMenu,
}: {
  gameRef: React.RefObject<Game | null>;
  tick: number;
  name: string;
  onName: (n: string) => void;
  matchMode: MatchMode;
  ranked: boolean;
  sr: number;
  srSwing: number;
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
    const board = m.scoreboard();
    const mvp = board[0];
    const mine = board.find((r) => r.id === m.myId);
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(246,243,230,0.72)] p-4">
        <div className="ink-panel max-w-[640px] px-10 py-8 text-center">
          <h2 className="m-0 font-[Caveat,cursive] text-5xl text-[var(--red)]">{m.winner} wins</h2>

          {ranked && (
            <div className="mt-4 flex justify-center">
              <RankBadge sr={sr} swing={srSwing} />
            </div>
          )}

          {mvp && (
            <div className="mvp-card mt-5">
              <div className="text-sm uppercase tracking-[0.2em] opacity-60">
                {mvp.id === m.myId ? "that was you" : "top of the page"}
              </div>
              <div className="font-[Caveat,cursive] text-5xl leading-tight">{mvp.name}</div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-5 text-xl">
                <span>
                  <b className="text-3xl">{mvp.kills}</b> kills
                </span>
                <span>
                  <b className="text-3xl">{mvp.deaths}</b> deaths
                </span>
                <span>
                  <b className="text-3xl">{mvp.best ?? 0}</b> best run
                </span>
              </div>
              {mine && mine.id !== mvp.id && (
                <div className="mt-3 text-lg opacity-70">
                  you finished #{board.indexOf(mine) + 1} · {mine.kills}/{mine.deaths}, best run {mine.best ?? 0}
                </div>
              )}
            </div>
          )}

          <div className="mt-5 text-left text-xl">
            {board.map((r, i) => (
              <div key={r.id} className="flex justify-between gap-6 border-b border-[var(--ink)] py-0.5">
                <span className={r.id === m.myId ? "text-[var(--red)]" : ""}>
                  <span className="opacity-50">{i + 1}.</span> {r.name}
                  {r.id === m.myId ? " (you)" : ""}
                </span>
                <span className="opacity-70">
                  {r.kills} K · {r.deaths} D · {r.best ?? 0} run
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
        <h2 className="m-0 font-[Caveat,cursive] text-5xl">
          {matchMode === "ffa" ? "free-for-all" : matchMode === "tdm" ? "team deathmatch" : "battle royale"}
        </h2>
        {ranked && (
          <div className="mt-3 flex justify-center">
            <RankBadge sr={sr} />
          </div>
        )}
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

        {err && <p className="mt-4 text-lg text-[var(--red)]">{err}</p>}
        {busy && <p className="mt-4 text-lg opacity-70">{busy}…</p>}

        <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row">
          <button
            className="ink-panel lobby-card p-4 text-left"
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
            <div className="font-[Caveat,cursive] text-3xl">public</div>
            <p className="mt-1 text-base leading-snug opacity-75">
              matched with anyone looking. bots fill the empty seats and stand down when someone joins.
            </p>
          </button>
          <button
            className="ink-panel lobby-card p-4 text-left"
            disabled={!!busy}
            onClick={() => run("opening a lobby", () => m.host(false, m.mapKey, matchMode))}
          >
            <div className="font-[Caveat,cursive] text-3xl">private</div>
            <p className="mt-1 text-base leading-snug opacity-75">
              your own room with a code to share. nobody joins unless you give it to them.
            </p>
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <input
            className="ink-input flex-1 tracking-[0.2em] uppercase"
            value={code}
            maxLength={5}
            placeholder="JOIN WITH A CODE"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="ink-btn" disabled={!!busy || code.length < 5} onClick={() => run("joining", () => m.join(code))}>
            join
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2">
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
          <button className="ink-btn" onClick={onMenu}>
            back
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The eight numbers the gunsmith reports back. Each is normalised to 0–1 on a
 * fixed scale so a bar means the same thing on a pistol as on an LMG, and so
 * the base and built bars can be drawn on top of one another.
 */
const STAT_ROWS: { name: string; of: (d: ReturnType<typeof weaponDef>) => number }[] = [
  { name: "damage", of: (d) => d.damage / 60 },
  { name: "fire rate", of: (d) => 1 / d.interval / 14 },
  { name: "range", of: (d) => (d.falloff ? d.falloff[1] / 45 : 1) },
  { name: "control", of: (d) => 1 - d.camKick[0] / 0.08 },
  { name: "mobility", of: (d) => (d.moveMul - 0.85) / 0.35 },
  { name: "aim speed", of: (d) => (d.adsSpeed - 6) / 12 },
  { name: "magazine", of: (d) => d.magSize / 60 },
  { name: "reload", of: (d) => 1 - (d.reloadDur - 0.3) / 2.2 },
];

const pct = (v: number) => `${Math.round(Math.max(0.02, Math.min(1, v)) * 100)}%`;

/**
 * The gunsmith: four rails, one part each. Every chip spells out what it costs
 * you as well as what it buys, because an attachment that was pure upside
 * would just be a stat the gun should have had.
 */
/** One locked-or-earned cosmetic chip. */
function CosChip({
  name,
  blurb,
  need,
  kills,
  on,
  onPick,
}: {
  name: string;
  blurb: string;
  need: number;
  kills: number;
  on: boolean;
  onPick: () => void;
}) {
  const locked = kills < need;
  return (
    <button
      className={`att-chip ${on ? "on" : ""} ${locked ? "locked" : ""}`}
      disabled={locked}
      onClick={onPick}
      title={locked ? `${need - kills} more kills with this weapon` : blurb}
    >
      <b>{name}</b>
      <em>{blurb}</em>
      <span className="mods">
        {locked ? (
          <i className="down">locked · {need - kills} more kills</i>
        ) : (
          <i className="up">{need ? `earned at ${need} kills` : "always yours"}</i>
        )}
      </span>
    </button>
  );
}

function Gunsmith({
  kind,
  build,
  skin,
  kills,
  onChange,
  onSkin,
  onClose,
}: {
  kind: WeaponKind;
  build: GunBuild;
  skin: WeaponSkin;
  kills: number;
  onChange: (b: GunBuild) => void;
  onSkin: (s: WeaponSkin) => void;
  onClose: () => void;
}) {
  const base = weaponDef(kind);
  const built = applyBuild(base, build);
  const fitted = SLOTS.filter((s) => build[s.id]).length;
  // a blade has no rails to hang anything off, so it only gets the cosmetics
  const rails = !!WEAPONS.find((w) => w.kind === kind)?.isGun;
  const [tab, setTab] = useState<"rails" | "camo" | "charm" | "sticker">(rails ? "rails" : "camo");
  const goal = nextCamo(kills);

  const setPart = (part: keyof WeaponSkin, id: string | undefined) => {
    const next = { ...skin };
    if (id) next[part] = id;
    else delete next[part];
    onSkin(next);
  };

  return (
    <div className="gs-panel">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-[var(--ink)] pb-2">
        <WeaponIcon kind={kind} className="wicon big" />
        <b className="text-2xl">{base.name}</b>
        <span className="text-lg opacity-60">
          {kills} kills{goal ? ` · ${goal.left} to ${goal.camo.name.toLowerCase()}` : " · every camo earned"}
        </span>
        <button className="ink-btn ml-auto text-base" onClick={onClose}>
          done
        </button>
      </div>

      <div className="gs-tabs">
        {(
          [
            ...(rails ? ([["rails", `rails · ${fitted}/4`]] as const) : []),
            ["camo", "camo"],
            ["charm", "charm"],
            ["sticker", "sticker"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`gun-chip ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "camo" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {CAMOS.map((c) => (
            <CosChip
              key={c.id}
              name={c.name}
              blurb={c.blurb}
              need={c.need}
              kills={kills}
              on={(skin.camo ?? CAMOS[0].id) === c.id}
              onPick={() => setPart("camo", c.id)}
            />
          ))}
        </div>
      )}

      {tab === "charm" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={`att-chip ${!skin.charm ? "on" : ""}`} onClick={() => setPart("charm", undefined)}>
            <b>NONE</b>
            <em>nothing dangling</em>
          </button>
          {CHARMS.map((c) => (
            <CosChip
              key={c.id}
              name={c.name}
              blurb={c.blurb}
              need={c.need}
              kills={kills}
              on={skin.charm === c.id}
              onPick={() => setPart("charm", c.id)}
            />
          ))}
        </div>
      )}

      {tab === "sticker" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={`att-chip ${!skin.sticker ? "on" : ""}`} onClick={() => setPart("sticker", undefined)}>
            <b>NONE</b>
            <em>bare receiver</em>
          </button>
          {STICKERS.map((c) => (
            <CosChip
              key={c.id}
              name={c.name}
              blurb={c.blurb}
              need={c.need}
              kills={kills}
              on={skin.sticker === c.id}
              onPick={() => setPart("sticker", c.id)}
            />
          ))}
        </div>
      )}

      {tab !== "rails" || !rails ? null : (
        <>

      <div className="gs-stats">
        {STAT_ROWS.map((row) => {
          const a = row.of(base);
          const b = row.of(built);
          const diff = Math.round((b - a) * 100);
          return (
            <div key={row.name} className="stat-row">
              <span className="stat-name">{row.name}</span>
              <span className="stat-bar">
                <i className="base" style={{ width: pct(a) }} />
                <i className={`built ${b >= a ? "up" : "down"}`} style={{ width: pct(b) }} />
              </span>
              <span className={`stat-delta ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`}>
                {diff ? (diff > 0 ? `+${diff}` : diff) : "–"}
              </span>
            </div>
          );
        })}
      </div>

      {SLOTS.map((slot) => (
        <div key={slot.id} className="mt-4">
          <div className="mb-2 text-xl">
            {slot.name} <span className="text-base opacity-60">· {slot.blurb}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={`att-chip ${!build[slot.id] ? "on" : ""}`}
              onClick={() => {
                const next = { ...build };
                delete next[slot.id];
                onChange(next);
              }}
            >
              <b>NONE</b>
              <em>rail left bare</em>
            </button>
            {attachmentsFor(slot.id).map((a) => (
              <button
                key={a.id}
                className={`att-chip ${build[slot.id] === a.id ? "on" : ""}`}
                onClick={() => onChange({ ...build, [slot.id]: a.id })}
              >
                <b>{a.name}</b>
                <em>{a.blurb}</em>
                <span className="mods">
                  {modLines(a).map((m) => (
                    <i key={m.text} className={m.good ? "up" : "down"}>
                      {m.text}
                    </i>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
        </>
      )}
    </div>
  );
}

function LoadoutScreen({
  loadout,
  gunsmith,
  wardrobe,
  weaponKills,
  skill,
  onChange,
  onSkill,
  onGunsmith,
  onWardrobe,
  onBack,
}: {
  loadout: WeaponKind[];
  gunsmith: Gunsmith;
  wardrobe: Wardrobe;
  weaponKills: KillLog;
  skill: SkillKind;
  onChange: (l: WeaponKind[]) => void;
  onSkill: (k: SkillKind) => void;
  onGunsmith: (g: Gunsmith) => void;
  onWardrobe: (w: Wardrobe) => void;
  onBack: () => void;
}) {
  const carried = loadout.filter(isGun);
  const melee = loadout.find((k) => !isGun(k)) ?? "knife";
  const [tuning, setTuning] = useState<WeaponKind | null>(null);

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
        <p className="mt-1 text-center text-lg opacity-70">three guns on 1–3, a blade on 4</p>

        {[0, 1, 2].map((slot) => (
          <div key={slot} className="mt-5">
            <div className="mb-2 flex items-center gap-3 border-b-2 border-[var(--ink)] text-2xl">
              <span>slot {slot + 1}</span>
              <WeaponIcon kind={carried[slot]} className="wicon big" />
              <span className="text-lg opacity-60">{WEAPONS.find((w) => w.kind === carried[slot])?.name}</span>
              <button
                className="ink-btn ml-auto text-base"
                onClick={() => setTuning(tuning === carried[slot] ? null : carried[slot])}
              >
                gunsmith
                {SLOTS.filter((s) => gunsmith[carried[slot]]?.[s.id]).length > 0 &&
                  ` · ${SLOTS.filter((s) => gunsmith[carried[slot]]?.[s.id]).length}`}
              </button>
            </div>
            {tuning === carried[slot] && (
              <Gunsmith
                kind={carried[slot]}
                build={gunsmith[carried[slot]] ?? {}}
                skin={wardrobe[carried[slot]] ?? {}}
                kills={weaponKills[carried[slot]] ?? 0}
                onChange={(b) => onGunsmith({ ...gunsmith, [carried[slot]]: b })}
                onSkin={(sk) => onWardrobe({ ...wardrobe, [carried[slot]]: sk })}
                onClose={() => setTuning(null)}
              />
            )}
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

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-3 border-b-2 border-[var(--ink)] text-2xl">
            <span>slot 4</span>
            <WeaponIcon kind={melee} className="wicon big" />
            <span className="text-lg opacity-60">{WEAPONS.find((w) => w.kind === melee)?.name}</span>
            <button className="ink-btn ml-auto text-base" onClick={() => setTuning(tuning === melee ? null : melee)}>
              cosmetics
            </button>
          </div>
          {tuning === melee && (
            <Gunsmith
              kind={melee}
              build={{}}
              skin={wardrobe[melee] ?? {}}
              kills={weaponKills[melee] ?? 0}
              onChange={() => {}}
              onSkin={(sk) => onWardrobe({ ...wardrobe, [melee]: sk })}
              onClose={() => setTuning(null)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {MELEE.map((w) => (
              <button
                key={w.kind}
                className={`gun-chip withicon ${melee === w.kind ? "on" : ""}`}
                onClick={() => onChange([...carried, w.kind])}
                aria-label={w.name}
                title={`${w.name} — ${w.hint}`}
              >
                <WeaponIcon kind={w.kind} />
                <span className="wname">{w.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-3 border-b-2 border-[var(--ink)] text-2xl">
            <span>operator skill</span>
            <span className="text-lg opacity-60">{SKILLS[skill].name}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SKILL_ORDER.map((k) => (
              <button
                key={k}
                className={`att-chip ${skill === k ? "on" : ""}`}
                onClick={() => onSkill(k)}
                title={SKILLS[k].blurb}
              >
                <b>{SKILLS[k].name}</b>
                <em>{SKILLS[k].blurb}</em>
                <span className="mods">
                  <i className="up">
                    {SKILLS[k].charge
                      ? `${SKILLS[k].duration}s · recharges in ${SKILLS[k].charge}s`
                      : "always on"}
                  </i>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 text-lg leading-snug opacity-80">
          {[...carried, melee].map((k) => {
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
 * Minimap. Up is always the way you are facing, so the whole map rotates around
 * you rather than the other way about. The walls ride in one rotated group, so
 * turning costs a transform rather than a pass over every rect.
 */
function Minimap({ hud }: { hud: HudSnap }) {
  const R = 50;
  // how much world fits in the disc: closer in than the whole map, or a big map
  // shrinks to an unreadable smudge
  const half = Math.min(hud.radarHalf || 40, 34);
  const scale = R / half;
  const me = hud.radarSelf;
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

  // only the walls that could land inside the disc are worth drawing
  const reach = half + 12;
  const walls = hud.radarWalls.filter(
    (w) => Math.abs(w.x + w.w / 2 - me.x) < reach && Math.abs(w.z + w.d / 2 - me.z) < reach,
  );
  const spin = `rotate(${(me.yaw * 180) / Math.PI}) scale(${scale}) translate(${-me.x} ${-me.z})`;

  return (
    <div className="minimap hud-bit">
      <svg viewBox="-58 -58 116 116" width="100%" height="100%" aria-hidden="true">
        <defs>
          <clipPath id="mm-disc">
            <circle cx="0" cy="0" r="52" />
          </clipPath>
        </defs>
        <circle cx="0" cy="0" r="53" fill="rgba(246,243,230,0.82)" stroke="var(--ink)" strokeWidth="2.5" />
        <g clipPath="url(#mm-disc)">
          <g transform={spin}>
            {walls.map((w, i) => (
              <rect
                key={i}
                x={w.x}
                y={w.z}
                width={w.w}
                height={w.d}
                fill={w.tall ? "rgba(26,48,192,0.34)" : "rgba(26,48,192,0.14)"}
                stroke="var(--ink)"
                strokeWidth={w.tall ? 0.5 : 0.35}
                strokeOpacity="0.75"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        </g>
        <line x1="0" y1="-53" x2="0" y2="-44" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
        {blips.map((b, i) => (
          <circle
            key={i}
            cx={b.x}
            cy={b.y}
            r="4.2"
            fill={b.hostile ? "var(--red)" : "var(--ink)"}
            stroke="rgba(246,243,230,0.9)"
            strokeWidth="1"
            opacity={b.hostile ? 0.95 : 0.6}
          />
        ))}
        {/* you, always dead centre, always pointing up */}
        <path d="M0 -8 L6 7 L0 3.5 L-6 7 Z" fill="var(--ink)" stroke="rgba(246,243,230,0.9)" strokeWidth="1" />
      </svg>
    </div>
  );
}

/**
 * The emote wheel. Opening it releases the pointer lock, because picking a
 * segment with a locked cursor is impossible; closing it takes the lock back.
 */
function EmoteWheel({
  gameRef,
  touch,
  open,
  setOpen,
}: {
  gameRef: React.RefObject<Game | null>;
  touch: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      if (e.code === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (currentBindings().emote?.includes(e.code)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gameRef, open, setOpen]);

  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    if (open) g.input.exitLock();
    else if (!touch) g.input.requestLock();
  }, [open, gameRef, touch]);

  const pick: (k: EmoteKind) => void = (k) => {
    gameRef.current?.player.playEmote(k);
    setOpen(false);
  };

  if (!open) {
    return touch ? (
      <button className="tbtn emote" aria-label="emotes" onClick={() => setOpen(true)}>
        <Icon name="emote" />
      </button>
    ) : null;
  }

  const n = EMOTE_ORDER.length;
  return (
    <div className="emote-wheel" onClick={() => setOpen(false)}>
      <div className="ew-hub" onClick={(e) => e.stopPropagation()}>
        {EMOTE_ORDER.map((k, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          return (
            <button
              key={k}
              className="ew-seg"
              style={{ left: `${50 + Math.cos(a) * 36}%`, top: `${50 + Math.sin(a) * 36}%` }}
              onClick={() => pick(k)}
            >
              <b>{EMOTES[k].name}</b>
              <em>{EMOTES[k].blurb}</em>
            </button>
          );
        })}
        <div className="ew-centre">emotes</div>
      </div>
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

      {hud.skill === "grappler" ? (
        <div className={`grapple-meter hud-bit ${hud.grappleOn ? "on" : ""} ${hud.grappleAim ? "aimed" : ""}`}>
          <div className="text-[10px] tracking-widest">ROPE</div>
          <div className="fm-tube">
            <div className="fm-fill" style={{ height: `${hud.grappleStam * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className={`grapple-meter hud-bit ${hud.skillActive > 0 ? "on" : ""} ${hud.skillReady ? "aimed" : ""}`}>
          <div className="text-[10px] tracking-widest">{hud.skill.slice(0, 5).toUpperCase()}</div>
          <div className="fm-tube">
            <div
              className="fm-fill"
              style={{
                height: `${(hud.skillActive > 0 ? hud.skillActive / (SKILLS[hud.skill as SkillKind]?.duration || 1) : hud.skillCharge) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {hud.night && (
        <div className={`nvg-pip hud-bit ${hud.goggles ? "on" : ""}`}>
          <svg viewBox="0 0 30 20" width="30" height="20" aria-hidden="true">
            <circle cx="9" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="21" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M15 8v4" stroke="currentColor" strokeWidth="2" />
          </svg>
          <em>N</em>
        </div>
      )}

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
  grapple: (
    <>
      {/* a hook on a line */}
      <path d="M4 4l9 9" />
      <path d="M17 11a4 4 0 1 1-4 4V9" />
    </>
  ),
  emote: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 10.5h.01M15.5 10.5h.01" />
      <path d="M8.5 15a5 5 0 0 0 7 0" />
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
      <button className={`tbtn grapple ${held.grapple ? "held" : ""}`} aria-label="grapple" {...hold("grapple")}>
        <Icon name="grapple" />
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