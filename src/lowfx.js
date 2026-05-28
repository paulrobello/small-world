// Optional low-effects mode — drops the pixel ratio, particle count, and
// instanced ground-cover density so slow devices stay smooth.
//
// Three ways in:
//   ?lowfx=1   force on
//   ?lowfx=0   force off (overrides auto-detect)
//   neither    auto-detect from genuinely weak signals only
//
// Auto-detect heuristics: low device pixel ratio (< 1.5) combined with
// a small screen (< 480px short side). Modern phones (DPR 2–3) are
// powerful enough for the full pipeline even at small viewport sizes,
// so small screen alone is no longer a reliable weakness signal.
// Read once at import time so every module sees the same flag without
// parsing the URL or re-querying media queries repeatedly.
const _params = new URLSearchParams(window.location.search);
const _forceLowfx = _params.get("lowfx");
function _autoLowfx() {
  if (typeof window === "undefined") return false;
  const dpr = window.devicePixelRatio || 1;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  // Low DPR on a small screen = genuinely weak device (budget tablets,
  // old phones, embedded screens). High-DPR devices are assumed capable.
  const weakHardware = dpr < 1.5 && shortSide > 0 && shortSide < 768;
  return weakHardware;
}
export const LOWFX =
  _forceLowfx === "1" ? true :
  _forceLowfx === "0" ? false :
  _autoLowfx();

export function isMobileViewport() {
  if (typeof window === "undefined") return false;
  const forced = new URLSearchParams(window.location.search).get("mobile");
  if (forced === "1") return true;
  if (forced === "0") return false;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return coarsePointer && shortSide > 0 && shortSide <= 900;
}

export function rendererPixelRatioCap() {
  if (isMobileViewport()) return 1;
  return LOWFX ? 1 : 2;
}

// Multiplier applied to particle counts and ground-cover instance counts when
// LOWFX is on. ~40% keeps the world readable while halving most per-frame work.
export const LOWFX_DENSITY = 0.4;
