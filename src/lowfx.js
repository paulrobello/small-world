// Optional low-effects mode — drops the pixel ratio, particle count, and
// instanced ground-cover density so slow devices stay smooth.
//
// Three ways in:
//   ?lowfx=1   force on
//   ?lowfx=0   force off (overrides auto-detect)
//   neither    auto-detect from touch / small-screen / low-DPR signals
//
// Auto-detect heuristics: any of (a) a real touch device with no hover, (b)
// short side under 768 CSS px, (c) device pixel ratio < 1.0. These match the
// common "phone/tablet that can't sustain 60fps with the full pipeline"
// category without false-positiving high-DPR laptops or hybrid pen devices.
// Read once at import time so every module sees the same flag without
// parsing the URL or re-querying media queries repeatedly.
const _params = new URLSearchParams(window.location.search);
const _forceLowfx = _params.get("lowfx");
function _autoLowfx() {
  if (typeof window === "undefined") return false;
  const touchOnly =
    "ontouchstart" in window &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const smallScreen = shortSide > 0 && shortSide < 768;
  const lowDPR = (window.devicePixelRatio || 1) < 1.0;
  return touchOnly || smallScreen || lowDPR;
}
export const LOWFX =
  _forceLowfx === "1" ? true :
  _forceLowfx === "0" ? false :
  _autoLowfx();

// Multiplier applied to particle counts and ground-cover instance counts when
// LOWFX is on. ~40% keeps the world readable while halving most per-frame work.
export const LOWFX_DENSITY = 0.4;
