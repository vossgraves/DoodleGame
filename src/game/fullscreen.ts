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
  }
}

function lockLandscape() {
  const o = screen.orientation as (ScreenOrientation & { lock?: (s: string) => Promise<void> }) | undefined;
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
  }
}

const isLandscape = () => window.matchMedia("(orientation: landscape)").matches;

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
  window.addEventListener("pointerdown", spend, { capture: true, passive: true });
  document.addEventListener("fullscreenchange", report);
  document.addEventListener("webkitfullscreenchange", report);

  arm();
  report();

  return () => {
    mq.removeEventListener("change", onOrientation);
    window.removeEventListener("pointerdown", spend, { capture: true });
    document.removeEventListener("fullscreenchange", report);
    document.removeEventListener("webkitfullscreenchange", report);
  };
}
