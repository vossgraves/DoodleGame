/**
 * Fullscreen on a phone.
 *
 * The Fullscreen API needs a transient user activation, so nothing can put the
 * page fullscreen from an orientationchange handler — the browser drops the
 * request. What works is to arm the intent the moment the phone turns landscape
 * and spend it on the very next touch, which in this game is the touch that
 * starts playing anyway. From the player's side it looks automatic.
 *
 * iPhone Safari has no Fullscreen API at all, so there this quietly does
 * nothing and the manifest carries it instead: added to the home screen, the
 * app launches fullscreen and landscape with no gesture involved.
 */

const PREF = "doodle_fullscreen";

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

export function supported() {
  const el = document.documentElement as FsElement;
  return typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function";
}

export function isFull() {
  const d = document as FsDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Whether the player wants this at all. On by default; settings can turn it off. */
export function wanted() {
  try {
    return localStorage.getItem(PREF) !== "0";
  } catch {
    return true;
  }
}

export function setWanted(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "1" : "0");
  } catch {
    // a locked-down browser costs you the preference, not the game
  }
}

function lockLandscape() {
  const o = screen.orientation as (ScreenOrientation & { lock?: (s: string) => Promise<void> }) | undefined;
  // only permitted once fullscreen, which is why this follows the request
  o?.lock?.("landscape").catch(() => {});
}

export async function enter() {
  if (isFull() || !supported()) return isFull();
  const el = document.documentElement as FsElement;
  try {
    await (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.());
  } catch {
    return false;
  }
  lockLandscape();
  return true;
}

export async function exit() {
  if (!isFull()) return;
  const d = document as FsDocument;
  try {
    await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
  } catch {
    // already gone, or the browser took it back itself
  }
}

const isLandscape = () => window.matchMedia("(orientation: landscape)").matches;

/**
 * Watch for the phone turning landscape and take fullscreen on the next touch.
 * Returns a cleanup. `onState` fires whenever fullscreen or the armed intent
 * changes, so the UI can offer a tap target while one is pending.
 */
export function install(onState: (s: { full: boolean; pending: boolean }) => void) {
  let pending = false;

  const report = () => onState({ full: isFull(), pending });

  const arm = () => {
    if (!wanted() || !supported() || isFull() || !isLandscape()) return;
    pending = true;
    report();
  };

  const spend = () => {
    if (!pending) return;
    pending = false;
    void enter().then(report);
    report();
  };

  const onOrientation = () => {
    if (isLandscape()) arm();
    else {
      pending = false;
      report();
    }
  };

  const mq = window.matchMedia("(orientation: landscape)");
  mq.addEventListener("change", onOrientation);
  // The gesture has to be a real one, so listen for the press rather than the
  // click: a click synthesised later has no activation left to spend.
  window.addEventListener("pointerdown", spend, { capture: true, passive: true });
  document.addEventListener("fullscreenchange", report);
  document.addEventListener("webkitfullscreenchange", report);

  // already sideways when the page loaded
  arm();
  report();

  return () => {
    mq.removeEventListener("change", onOrientation);
    window.removeEventListener("pointerdown", spend, { capture: true });
    document.removeEventListener("fullscreenchange", report);
    document.removeEventListener("webkitfullscreenchange", report);
  };
}
