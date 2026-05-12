// Optional low-effects mode — opt in with ?lowfx=1 in the URL. Drops the
// pixel ratio, particle count, and instanced ground-cover density so slow
// devices stay smooth. Read once at import time so every module sees the
// same flag without parsing the URL repeatedly.
const _params = new URLSearchParams(window.location.search);
export const LOWFX = _params.get("lowfx") === "1";

// Multiplier applied to particle counts and ground-cover instance counts when
// LOWFX is on. ~40% keeps the world readable while halving most per-frame work.
export const LOWFX_DENSITY = 0.4;
