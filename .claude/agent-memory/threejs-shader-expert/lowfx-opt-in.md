---
name: lowfx-opt-in
description: src/lowfx.js only honors ?lowfx=1 URL param, but CLAUDE.md claims auto-detect on touch/small-screen/low-DPR devices
metadata:
  type: project
---

`src/lowfx.js:6`:
```js
export const LOWFX = _params.get("lowfx") === "1";
```

CLAUDE.md describes: "true on touch / small-screen / low DPR devices, or `?lowfx=1` URL param."

The auto-detect doesn't exist. Mobile users get the full FX pipeline (bloom + depth-FX + tilt-shift if enabled) plus DPR capped at 2.

**Why this matters:** at DPR=2 on a mid-tier phone, 1080p physical pixels = 4K equivalent. With bloom slider at default (3 H+V pairs = 6 blur passes at full res), this is ~30 fps on integrated mobile GPUs. Performance-conscious users can pass `?lowfx=1`, but the default experience on phones is bad.

**How to apply:** if/when fixing, the standard heuristic is:
```js
const auto =
  navigator.maxTouchPoints > 0 ||
  window.innerWidth < 768 ||
  (window.devicePixelRatio || 1) < 1;
export const LOWFX = _params.get("lowfx") === "1" || auto;
```

Update CLAUDE.md either way — currently the docs over-promise.

**Note for any LOWFX-related work:** under LOWFX, `state.depthTexture = null` and `state.postfx` is a no-op stub. Any code that reads `state.depthTexture` must null-check (`environment.js:175` does this correctly for soft particles).
