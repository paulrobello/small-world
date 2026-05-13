# `src/fauna.js` Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/fauna.js` (1901 lines) into a `src/fauna/` directory of per-entity modules without changing any runtime behavior.

**Architecture:** Pure move/rename. Each entity (creature, caterpillar, butterfly, bee) becomes its own module under `src/fauna/`. The three shared collision/water helpers move to `src/fauna/shared.js`. `src/fauna.js` is rewritten as a barrel that re-exports the same public API so no consumer file (`main.js`, `world.js`, `ui.js`, `inspect.js`) needs editing. No new abstractions, no behavior changes, no RNG-order changes.

**Tech Stack:** ES modules loaded via the `<script type="importmap">` in `index.html`. No build step. No tests. Verification is a browser smoke test on the dev server (`make restart`).

**Spec:** `docs/superpowers/specs/2026-05-13-fauna-split-design.md`.

**Determinism contract (read before starting):** `generateWorld` patches `Math.random` to a seeded `mulberry32` for the duration of world construction. The refactor must not change the order, count, or location of `Math.random()` calls inside any `makeX` constructor. The shared helpers being moved (`avoidObstacles`, `pushOutOfObstacles`, `colorsClose`) make zero RNG calls today — verified by reading lines 533-635 of the current `src/fauna.js`. The refactor copies them verbatim.

**Verification model:** No tests. Each task that creates a new module is "complete" once a syntax-grep + import-resolution check passes. End-to-end verification (browser smoke test) is the final task — a regression there is bisectable to the per-task commits.

---

### Task 1: Create `src/fauna/shared.js`

**Files:**
- Create: `src/fauna/shared.js`

This module holds the three helpers (and one constant) that more than one entity uses. It depends only on `state` (for `state.obstacles`).

- [ ] **Step 1: Create `src/fauna/shared.js` with the full contents below**

```js
import { state } from "../state.js";

// Terrain Y below which ground creatures are considered underwater. The water
// plane sits a touch below 0 and oscillates ~±0.08; clamping walkers to
// ground above 0 keeps them clear of waves and out of the shallow draft.
export const WATER_AVOID_Y = 0.0;

// Color similarity test for the herding check. Cheap RGB distance — fine for
// the small biome palettes used here.
export function colorsClose(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db < 0.04;
}

// Tangent-slide obstacle avoidance for grounded movers (walkers and
// caterpillars). Probes state.obstacles against the candidate next step. If
// the step would penetrate an obstacle, projects motion onto the perimeter
// tangent that best matches the current heading and returns the slid
// position plus a heading aligned with the tangent (so subsequent frames
// don't keep re-tripping the same collision and wobble in place). If the
// slide candidate is itself wedged into another obstacle, returns the
// creature's current position with a heading pointing outward from the
// first hit, deferring real movement to the next think cycle.
//
// Returns null when the path is clear — caller commits the straight step.
export function avoidObstacles(px, pz, nx, nz, heading, step, cr, y, skipX, skipZ) {
  const obs = state.obstacles;
  if (!obs || obs.length === 0) return null;
  const skipping = skipX !== undefined && skipZ !== undefined;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    // Skip the specific obstacle we're trying to land on (the perch's
    // mushroom). Without this, a flier descending toward its own perch
    // would get pushed away by the cap's collision disc.
    if (skipping && Math.abs(o.x - skipX) < 0.4 && Math.abs(o.z - skipZ) < 0.4) continue;
    // Height filter — fliers above the canopy can pass over freely.
    if (y !== undefined && o.top !== undefined && y > o.top + 0.15) continue;
    const ox = nx - o.x;
    const oz = nz - o.z;
    const minD = o.r + cr;
    if (ox * ox + oz * oz >= minD * minD) continue;
    const rx = px - o.x;
    const rz = pz - o.z;
    const rlen = Math.sqrt(rx * rx + rz * rz) || 1;
    const nrx = rx / rlen;
    const nrz = rz / rlen;
    let tx = -nrz;
    let tz = nrx;
    if (tx * Math.cos(heading) + tz * Math.sin(heading) < 0) {
      tx = nrz;
      tz = -nrx;
    }
    const sx = px + tx * step;
    const sz = pz + tz * step;
    for (let j = 0; j < obs.length; j++) {
      if (j === i) continue;
      const o2 = obs[j];
      if (skipping && Math.abs(o2.x - skipX) < 0.4 && Math.abs(o2.z - skipZ) < 0.4) continue;
      if (y !== undefined && o2.top !== undefined && y > o2.top + 0.15) continue;
      const dx2 = sx - o2.x;
      const dz2 = sz - o2.z;
      const md = o2.r + cr;
      if (dx2 * dx2 + dz2 * dz2 < md * md) {
        return {
          nx: px,
          nz: pz,
          heading: Math.atan2(nrz, nrx) + (Math.random() - 0.5) * 0.5,
        };
      }
    }
    return { nx: sx, nz: sz, heading: Math.atan2(tz, tx) };
  }
  return null;
}

// Velocity-based obstacle push for fliers that steer via velocity rather
// than heading (butterflies, bees). Mutates pos + vel in place: nudges the
// position outside any trunk it has entered, and damps the velocity
// component pointing into the trunk so it glances off instead of stalling.
export function pushOutOfObstacles(pos, vel, bodyR) {
  const obs = state.obstacles;
  if (!obs || obs.length === 0) return;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (o.top !== undefined && pos.y > o.top + 0.15) continue;
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const minD = o.r + bodyR;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD) continue;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d;
    const nz = dz / d;
    pos.x = o.x + nx * minD;
    pos.z = o.z + nz * minD;
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= vn * nx * 1.6;
      vel.z -= vn * nz * 1.6;
    }
  }
}
```

> **Note on `Math.random()` inside `avoidObstacles`:** the `(Math.random() - 0.5) * 0.5` call on the wedged-fallback branch is a *runtime* call (not a world-gen call) — it happens during `stepCreature`, after `generateWorld` has restored the real `Math.random`. Moving it does not affect determinism.

- [ ] **Step 2: Verify the file parses**

Run: `node --check src/fauna/shared.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify no consumers reference these symbols yet**

Run: `grep -rn "from \"./fauna/shared.js\"\|from \"./shared.js\"" src/ main.js`
Expected: no matches. (No file imports from it yet — that comes in Tasks 2-5.)

- [ ] **Step 4: Commit**

```bash
git add src/fauna/shared.js
git commit -m "fauna: extract shared helpers (water threshold, obstacle avoidance) into fauna/shared.js"
```

---

### Task 2: Create `src/fauna/creature.js`

**Files:**
- Create: `src/fauna/creature.js`
- Reference: `src/fauna.js` (existing — lines to copy verbatim)

This is the largest module (~1140 lines). It owns `makeCreature`, `stepCreature`, `lookAtCreature`, `wakeCreature`, plus all the creature-specific private helpers: `PERSONALITIES`, `PERSONALITY_NAMES`, `getZTexture`, `makeZSprite`, `nearestBuzzer`, `herdInfluence`, `pickPerchForFlier`.

- [ ] **Step 1: Read the current source for the line ranges to copy**

Run: `wc -l src/fauna.js`
Expected: `1901 src/fauna.js`.

Open `src/fauna.js` and identify these ranges (already verified during spec writing):
- Lines 17-23 — `PERSONALITIES` + `PERSONALITY_NAMES`
- Lines 25-60 — `_zTexture`, `getZTexture`, `makeZSprite`
- Lines 77-429 — `makeCreature`
- Lines 433-437 — `lookAtCreature`
- Lines 442-498 — `nearestBuzzer` + `herdInfluence`
- Lines 507-520 — `wakeCreature`
- Lines 588-606 — `pickPerchForFlier`
- Lines 636-1214 — `stepCreature`

> `colorsClose` (lines 64-69) is **not** copied — `herdInfluence` will import it from `./shared.js`.
> `WATER_AVOID_Y` (line 12) is **not** copied — it comes from `./shared.js`.
> `avoidObstacles` (lines 533-581) and `pushOutOfObstacles` (lines 612-634) are **not** copied — they live in `./shared.js`.

- [ ] **Step 2: Create `src/fauna/creature.js`**

Start the file with this exact import block + leading comment:

```js
import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo } from "../util.js";
import { makeDirtPuff, makeDustKick } from "../environment.js";
import { applyShellFur } from "../fur.js";
import { BLOOM_LAYER } from "../postfx.js";
import { WATER_AVOID_Y, avoidObstacles, colorsClose } from "./shared.js";

// Personality presets — picked once per creature at spawn, tweak how it walks,
// thinks, hops, herds, and sleeps. Subtle multipliers; the cute baseline is
// still recognisable.
```

Then append, in this exact order, copying **verbatim from `src/fauna.js`** (preserving comments, whitespace, and JSDoc):

1. The `PERSONALITIES` object literal and `PERSONALITY_NAMES` array (lines 17-23).
2. A blank line, then the `_zTexture` / `getZTexture` / `makeZSprite` block (lines 25-60).
3. A blank line, then the `makeCreature` function (lines 71-429 including its leading `// opts:` JSDoc comment block at lines 71-76). Change the `function` declaration to `export function`.
4. A blank line, then the `lookAtCreature` function (lines 431-437 including its leading `// Trigger a brief...` comment). Keep the `export` keyword.
5. A blank line, then the `nearestBuzzer` function (lines 439-463 including its leading `// Find distance...` comment). No `export`.
6. A blank line, then the `herdInfluence` function (lines 465-498 including its leading `// Nudge \`c.heading\`...` comment). No `export`.
7. A blank line, then the `wakeCreature` function (lines 500-520 including its leading `// Wake a sleeping...` comment). Keep the `export` keyword.
8. A blank line, then the `pickPerchForFlier` function (lines 583-606 including its leading `// Pick a mushroom...` comment). No `export`.
9. A blank line, then the `stepCreature` function (lines 636-1214 including any leading section divider comment). Keep the `export` keyword.

> The two big helpers between `wakeCreature` and `stepCreature` in the original (`avoidObstacles` lines 533-581, `pushOutOfObstacles` lines 612-634) are skipped — they're in `shared.js`. `pickPerchForFlier` (lines 588-606) sits between them and IS copied.

- [ ] **Step 3: Verify the file parses**

Run: `node --check src/fauna/creature.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify no forbidden symbols leaked in**

Run: `grep -n "^const WATER_AVOID_Y\|^function avoidObstacles\|^function pushOutOfObstacles\|^function colorsClose" src/fauna/creature.js`
Expected: no matches. (These are imports now, not local definitions.)

- [ ] **Step 5: Verify the expected exports are present**

Run: `grep -n "^export " src/fauna/creature.js`
Expected exactly four matches:
```
export function makeCreature(biome, opts = {}) {
export function lookAtCreature(c) {
export function wakeCreature(c) {
export function stepCreature(c, dt, t, heightFn) {
```

- [ ] **Step 6: Verify line count is roughly right**

Run: `wc -l src/fauna/creature.js`
Expected: between 1100 and 1180 lines. (Sanity check that nothing was truncated.)

- [ ] **Step 7: Verify `pushOutOfObstacles` is not referenced inside creature.js**

Run: `grep -n "pushOutOfObstacles" src/fauna/creature.js`
Expected: no matches. (`stepCreature` does not use it — only butterflies and bees do.)

- [ ] **Step 8: Commit**

```bash
git add src/fauna/creature.js
git commit -m "fauna: extract creature module (make/step/look/wake) into fauna/creature.js"
```

---

### Task 3: Create `src/fauna/caterpillar.js`

**Files:**
- Create: `src/fauna/caterpillar.js`
- Reference: `src/fauna.js` lines 1219-1519

- [ ] **Step 1: Create `src/fauna/caterpillar.js`**

Start with this exact import block:

```js
import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo } from "../util.js";
import { pickGroundPoint, nearestCenter } from "../terrain.js";
import { applyShellFur } from "../fur.js";
import { BLOOM_LAYER } from "../postfx.js";
import { WATER_AVOID_Y, avoidObstacles } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Caterpillar — head + 3-6 body spheres, body segments follow head's trail
// ─────────────────────────────────────────────────────────────────────────────
```

Then append, copying **verbatim from `src/fauna.js`**:

1. The `findTrailPointAt` function (lines 1219-1242 including any leading comment). No `export`.
2. A blank line, then the `makeCaterpillar` function (lines 1244-1446 including the leading `// opts.kind: undefined | "snail"...` comment block at lines 1244-1245). Keep `export`.
3. A blank line, then the `stepCaterpillar` function (lines 1448-1519). Keep `export`.

> `WATER_AVOID_Y` and `avoidObstacles` references inside `stepCaterpillar` (and `makeCaterpillar`'s water-retry loop) now resolve to the `./shared.js` imports — no source edits needed.

- [ ] **Step 2: Verify parse**

Run: `node --check src/fauna/caterpillar.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify exports**

Run: `grep -n "^export " src/fauna/caterpillar.js`
Expected exactly two matches:
```
export function makeCaterpillar(biome, opts = {}) {
export function stepCaterpillar(c, dt, t, heightFn) {
```

- [ ] **Step 4: Verify no stray helper definitions**

Run: `grep -n "^const WATER_AVOID_Y\|^function avoidObstacles" src/fauna/caterpillar.js`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/fauna/caterpillar.js
git commit -m "fauna: extract caterpillar/snail module into fauna/caterpillar.js"
```

---

### Task 4: Create `src/fauna/butterfly.js`

**Files:**
- Create: `src/fauna/butterfly.js`
- Reference: `src/fauna.js` lines 1521-1714

- [ ] **Step 1: Create `src/fauna/butterfly.js`**

Start with this exact import block:

```js
import * as THREE from "three";
import { state } from "../state.js";
import { nearestCenter } from "../terrain.js";
import { WATER_AVOID_Y, pushOutOfObstacles } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Butterflies — small bright fliers that flutter between flowers
// ─────────────────────────────────────────────────────────────────────────────
```

Then append, copying **verbatim from `src/fauna.js`**:

1. The `makeButterfly` function (lines 1524-1608). Keep `export`.
2. A blank line, then the `pickFlower` function (lines 1610-1619 including its leading `// Mutates b.target...` comment). No `export`.
3. A blank line, then `const _bflyTarget = new THREE.Vector3();` (line 1621) — module-level cached vector. **Do not** call `Math.random()` here (and the line doesn't).
4. A blank line, then the `stepButterfly` function (lines 1622-1714). Keep `export`.

- [ ] **Step 2: Verify parse**

Run: `node --check src/fauna/butterfly.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify exports**

Run: `grep -n "^export " src/fauna/butterfly.js`
Expected exactly two matches:
```
export function makeButterfly(palette, biome) {
export function stepButterfly(b, dt, t, flowerSpots, heightFn) {
```

- [ ] **Step 4: Commit**

```bash
git add src/fauna/butterfly.js
git commit -m "fauna: extract butterfly module into fauna/butterfly.js"
```

---

### Task 5: Create `src/fauna/bee.js`

**Files:**
- Create: `src/fauna/bee.js`
- Reference: `src/fauna.js` lines 1716-1899

- [ ] **Step 1: Create `src/fauna/bee.js`**

Start with this exact import block:

```js
import * as THREE from "three";
import { state } from "../state.js";
import { nearestCenter } from "../terrain.js";
import { WATER_AVOID_Y, pushOutOfObstacles } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Bee swarms — small fast fliers that orbit a shared flower target.
// A "swarm" is a shared object { target, retargetAt }; each bee references
// it so they all migrate together when the swarm picks a new flower.
// ─────────────────────────────────────────────────────────────────────────────
```

Then append, copying **verbatim from `src/fauna.js`**:

1. The `makeSwarm` function (lines 1721-1728). Keep `export`.
2. A blank line, then the `makeBee` function (lines 1730-1801). Keep `export`.
3. A blank line, then the `pickBeeFlower` function (lines 1803-1810 including its leading `// Mutates swarm.target...` comment). No `export`.
4. A blank line, then `const _beeTarget = new THREE.Vector3();` and `const _beeOffset = new THREE.Vector3();` (lines 1812-1813). Module-level cached vectors — no RNG.
5. A blank line, then the `stepBee` function (lines 1814-1899). Keep `export`.

- [ ] **Step 2: Verify parse**

Run: `node --check src/fauna/bee.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify exports**

Run: `grep -n "^export " src/fauna/bee.js`
Expected exactly three matches:
```
export function makeSwarm() {
export function makeBee(swarm, biome) {
export function stepBee(b, dt, t, flowerSpots, heightFn) {
```

- [ ] **Step 4: Commit**

```bash
git add src/fauna/bee.js
git commit -m "fauna: extract bee/swarm module into fauna/bee.js"
```

---

### Task 6: Replace `src/fauna.js` with a barrel and smoke-test

**Files:**
- Overwrite: `src/fauna.js`

This is the cutover. Until this step, the new files exist but nothing imports them — consumers still load the old monolithic `src/fauna.js`. After this step, the old contents are gone and the barrel re-exports from the new modules.

- [ ] **Step 1: Overwrite `src/fauna.js` with the barrel**

```js
// Barrel — fauna entity modules live under src/fauna/. This file preserves
// the public import path "./fauna.js" used by main.js, world.js, ui.js, and
// inspect.js so consumers don't need to know about the per-entity split.
export {
  makeCreature,
  stepCreature,
  lookAtCreature,
  wakeCreature,
} from "./fauna/creature.js";
export { makeCaterpillar, stepCaterpillar } from "./fauna/caterpillar.js";
export { makeButterfly, stepButterfly } from "./fauna/butterfly.js";
export { makeBee, makeSwarm, stepBee } from "./fauna/bee.js";
```

- [ ] **Step 2: Verify the barrel parses**

Run: `node --check src/fauna.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify line count collapsed**

Run: `wc -l src/fauna.js`
Expected: between 10 and 20 lines (was 1901).

- [ ] **Step 4: Confirm every consumer still resolves**

Run: `grep -n "from \"\./fauna\.js\"\|from \"\./src/fauna\.js\"\|from \"\./fauna/" src/ main.js -r`
Expected: hits in `main.js`, `src/world.js`, `src/ui.js`, `src/inspect.js` — all pointing at `./fauna.js` (the barrel). No consumer should be importing from a `./fauna/X.js` path directly.

- [ ] **Step 5: Confirm the eight public symbols are reachable**

Run: `grep -E "^export " src/fauna.js`
Expected output includes (order may vary, depending on grep flags):
```
makeCreature,
stepCreature,
lookAtCreature,
wakeCreature,
} from "./fauna/creature.js";
export { makeCaterpillar, stepCaterpillar } from "./fauna/caterpillar.js";
export { makeButterfly, stepButterfly } from "./fauna/butterfly.js";
export { makeBee, makeSwarm, stepBee } from "./fauna/bee.js";
```

- [ ] **Step 6: Restart the dev server**

Run: `make restart`
Expected: server reports running on `0.0.0.0:1999`. PID written to `.server.pid`.

Then check the log for any startup errors:

Run: `tail -20 .server.log`
Expected: standard stdlib `http.server` startup log, no Python tracebacks.

- [ ] **Step 7: Browser smoke test — load and inspect console**

Open `http://localhost:1999/` in a browser. Watch for:
- The page loads (HUD visible, world rendered).
- DevTools Console: **no red errors**, especially no `SyntaxError`, no `Failed to resolve module specifier`, no `Cannot find name`.
- HUD shows a biome name, non-zero creature count, non-zero flora count.

If errors appear: revert the cutover commit (this task only) with `git revert HEAD --no-edit`. The five new module files remain unused on disk but the site is back on the old monolithic `src/fauna.js`. Investigate before re-applying.

- [ ] **Step 8: Browser smoke test — behavior pass**

In the browser, walk through these checks. Hit `R` to regenerate between biomes until each is covered:

| Behavior | Where to look | Pass condition |
|---|---|---|
| Walker creatures wander | any grounded biome | Bodies move; legs animate; squash-stretch visible. |
| Herding | a biome with several same-color creatures | Pairs / trios drift together over ~30s. |
| Hover-look | hover any creature with the mouse | Body briefly turns toward camera. |
| Sleep + wake | wait for night auto-cycle (or use the dial) | Creatures curl; `zZz` sprite fades in; click/hover wakes them. |
| Burrower biome | regenerate until you find one (small mole-like creatures) | They sink, vanish, re-emerge nearby with a dirt puff. |
| Flier landing | any biome with fliers | Fliers descend, prefer mushroom caps when nearby, sit on them, take off again. |
| Caterpillars | any biome that spawns them | Head moves; body segments follow head's trail without gaps. |
| Snails | snail-capable biomes | Carry a shell on the back segment. |
| Butterflies | any flowery biome | Flit between wildflowers, hover briefly on each. |
| Bees | any biome with `bee` swarms | All bees of a swarm migrate to the same flower together. |

- [ ] **Step 9: Determinism sanity check**

Open `http://localhost:1999/?seed=0x3f2a`. Note the biome name, creature count, and rough island shape. Reload the page. Confirm identical biome, count, and layout — if the RNG sequence had drifted by even one call, the count or biome would change.

If something changed: revert the cutover commit, then diff each new module against the original `src/fauna.js` line ranges to find where a `Math.random()` was added, removed, or reordered.

- [ ] **Step 10: Inspect mode smoke test**

Open `http://localhost:1999/?inspect=1`. Use `k` to cycle category, `,`/`.` to cycle variant. Confirm:
- Creature variants render (walker / flier / sleeper / burrower / caterpillar / snail).
- No console errors.

`inspect.js` imports `makeCreature`, `makeCaterpillar`, `stepCreature`, `stepCaterpillar` from `./fauna.js` — this is the second consumer path through the barrel.

- [ ] **Step 11: Commit**

```bash
git add src/fauna.js
git commit -m "fauna: replace monolithic src/fauna.js with barrel over fauna/ modules"
```

- [ ] **Step 12: Final sanity check — directory structure**

Run: `ls src/fauna/ && wc -l src/fauna.js src/fauna/*.js`
Expected:
```
bee.js
butterfly.js
caterpillar.js
creature.js
shared.js
```
with line counts roughly:
- `src/fauna.js` — 10-20 lines
- `src/fauna/shared.js` — 75-90 lines
- `src/fauna/creature.js` — 1100-1180 lines
- `src/fauna/caterpillar.js` — 270-290 lines
- `src/fauna/butterfly.js` — 190-210 lines
- `src/fauna/bee.js` — 180-200 lines
- Total — within ~30 lines of the original 1901 (the deltas are the new import blocks and section comments).

---

## Self-review notes

- **Spec coverage:** Each module in the spec's target layout maps to a task (shared → T1, creature → T2, caterpillar → T3, butterfly → T4, bee → T5, barrel → T6). The determinism contract is enforced by "copy verbatim" instructions, the line-count sanity checks, and the explicit seeded-reload check in T6 Step 9.
- **Placeholder scan:** No TBDs, no "implement later", no "similar to" cross-references. Every module's contents are pinned to exact line ranges in the existing source plus an exact import block.
- **Type / signature consistency:** Public API symbol names match exactly across the spec, tasks, and consumer imports. The barrel's re-export names match the function declarations in each module.
- **Risk surface:** The most likely failure modes are (a) a wrong import path in one of the new modules (caught by `node --check` in each task) and (b) a behavior-changing copy edit (caught by the determinism reload + the behavior pass in T6). Both are recoverable via a single-commit revert because each task is its own commit.
