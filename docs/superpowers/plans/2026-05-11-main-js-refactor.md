# main.js → src/ Refactor — Implementation Plan

> **For agentic workers:** This plan executes inline (no subagent dispatch). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 3316-line `main.js` into 11 focused ES modules under `src/`, with `main.js` becoming a thin entry point. Pure code reorganization — no behavior change, no determinism change.

**Architecture:** Shared mutable `state` object (in `src/state.js`) exported and imported by every module that needs runtime world state. Layered modules in a strict DAG: `state` → `seed`/`biomes`/`util` → `terrain` → `flora`/`fauna`/`birds`/`environment` → `world` → `ui` → `main`.

**Tech Stack:** Three.js + simplex-noise via CDN importmap. ES modules. No build, no bundler, no tests.

**Source spec:** `docs/superpowers/specs/2026-05-11-main-js-refactor-design.md`.

---

## Verification protocol (used after every task)

The repo has no automated tests. The "test" is manual: load the page, watch for console errors, exercise the features the just-extracted module touches.

Standard verification checklist:

1. `make restart` (ensures server is serving the latest files).
2. Tail logs: `tail -n 20 .server.log` — no errors.
3. Open `http://localhost:1999/?seed=0x3f2a` in a headless browser via agentchrome, snapshot console.
4. Console must be empty of errors. HUD must show a biome name + seed + non-zero counts.
5. Reload with no seed param — a different world appears.
6. Click "regenerate world" once — overlay fades, new biome, URL gets new `?seed=…`.

If any of those fail, do not commit. Diagnose and fix the import or extraction error first.

---

## File line-number map (snapshot of `main.js` before refactor)

| Block | Lines |
|---|---|
| imports | 1–4 |
| seed/PRNG utilities | 6–54 |
| `BIOMES` table | 56–282 |
| renderer / scene / camera / controls | 284–325 |
| terrain math (consts, `smoothstep`, `islandFalloff`, `makeHeightFn`, `pickGroundPoint`, `pickLayout`) | 327–479 |
| terrain meshes (`makeTerrain`, `makeIslandUnderside`) | 481–585 |
| `TRUNK`, `jitterGeo` | 587–609 |
| `windUniforms`, `applyWindSway` | 611–648 |
| `FLORA_BUILDERS` | 650–1385 |
| creatures (`makeCreature`, `stepCreature`) | 1387–1782 |
| caterpillars (`findTrailPointAt`, `makeCaterpillar`, `stepCaterpillar`) | 1784–1981 |
| butterflies (`makeButterfly`, `pickFlower`, `_bflyTarget`, `stepButterfly`) | 1983–2156 |
| particles (`makeParticles`, `stepParticles`) | 2158–2323 |
| ground cover (density tables, `placeInstanced`, `makeGrassField`, `makeWildflowerField`, `makePebbleField`) | 2325–2500 |
| water (`makeWaterPlane`, `stepWater`) | 2502–2543 |
| parallax ring (`makeParallaxRing`) | 2545–2594 |
| birds (`makeBird`, `pickBirdColor`, `makeFlock`, `_flockTarget`, `stepFlock`) | 2596–2787 |
| world state vars + `disposeGroup` + NIGHT_* + `userSettings` + `updateDayNight` + `randInt` | 2789–2886 |
| `generateWorld` | 2888–3112 |
| animate loop | 3114–3149 |
| wiring (regen, popstate, resize, settings panel, follow, keydown, kickoff) | 3151–3316 |

---

## Phase 1 — Foundations: state object + leaf modules (3 new files)

### Task 1: Prep — collapse module-scope mutable state into one `state` object

This task does not split files. It rewrites `main.js` so that every mutable shared variable lives on one `state` object. After this, subsequent tasks just move `state` (and the helpers around it) to `src/state.js`.

**Files:**
- Modify: `main.js`

- [ ] Step 1: Replace lines 334–343 (the `ISLAND_SIZE_BASE`, `ISLAND_SIZE`, `ISLAND_RADIUS`, `currentLayout` block) and lines 2789–2810 (world state vars) with a single `state` const object at the top of the "Terrain height function" section. The object must carry every field listed below:

```js
const ISLAND_SIZE_BASE = 38;
const ISLAND_RADIUS_BASE = ISLAND_SIZE_BASE * 0.42;

const state = {
  // layout
  ISLAND_SIZE: ISLAND_SIZE_BASE,
  ISLAND_RADIUS: ISLAND_RADIUS_BASE,
  currentLayout: {
    centers: [{ cx: 0, cz: 0, radius: ISLAND_RADIUS_BASE, shape: { kind: "round" } }],
    planeSize: ISLAND_SIZE_BASE,
    boundRadius: ISLAND_RADIUS_BASE,
    kind: "single",
  },
  // world contents
  world: new THREE.Group(),
  creatures: [],
  caterpillars: [],
  butterflies: [],
  flowerSpots: [],
  flocks: [],
  particles: null,
  waterMesh: null,
  parallaxRingMesh: null,
  // metadata
  heightFn: () => 0,
  currentBiome: null,
  currentSeed: 0,
  maxElev: 0,
  // lighting
  sunLight: null,
  hemiLight: null,
  dayNight: null,
  // shared uniforms
  windUniforms: { uTime: { value: 0 } },
  // user settings
  userSettings: {
    fogMultiplier: 1.0,
    autoCycle: false,
    manualDayFactor: 0.75,
  },
};
scene.add(state.world);
```

- [ ] Step 2: Delete the old `let world = new THREE.Group(); scene.add(world);` and all subsequent `let creatures = [] ...` declarations (lines 2792–2810). Delete the old `const windUniforms = ...` (line 617) and the old `const userSettings = ...` (lines 2832–2836).

- [ ] Step 3: Search-and-replace inside `main.js` only (do not change other files yet) — bind each bare identifier to `state.<field>`. Use `grep -n` to find every occurrence first. Mappings to apply:

| Bare → state.field |
|---|
| `world` → `state.world` |
| `creatures` → `state.creatures` |
| `caterpillars` → `state.caterpillars` |
| `butterflies` → `state.butterflies` |
| `flowerSpots` → `state.flowerSpots` |
| `flocks` → `state.flocks` |
| `particles` → `state.particles` |
| `waterMesh` → `state.waterMesh` |
| `parallaxRingMesh` → `state.parallaxRingMesh` |
| `heightFn` → `state.heightFn` |
| `currentBiome` → `state.currentBiome` |
| `currentSeed` → `state.currentSeed` |
| `maxElev` → `state.maxElev` |
| `sunLight` → `state.sunLight` |
| `hemiLight` → `state.hemiLight` |
| `dayNight` → `state.dayNight` |
| `ISLAND_SIZE` → `state.ISLAND_SIZE` |
| `ISLAND_RADIUS` → `state.ISLAND_RADIUS` |
| `currentLayout` → `state.currentLayout` |
| `windUniforms` → `state.windUniforms` |
| `userSettings` → `state.userSettings` |

Do not touch occurrences inside string literals or comments. `ISLAND_SIZE_BASE` and `ISLAND_RADIUS_BASE` are constants used at init — leave them as locals.

- [ ] Step 4: Inside `generateWorld`, change `world = new THREE.Group(); scene.add(world);` to `state.world = new THREE.Group(); scene.add(state.world);`. Change all reassignments (`creatures = []`, `flocks = []`, etc.) to `state.creatures = []` etc.

- [ ] Step 5: Verify per the verification protocol above. Then commit:

```bash
git add main.js
git commit -m "Collapse main.js module state into single state object (refactor prep)"
```

### Task 2: Extract `src/state.js`

**Files:**
- Create: `src/state.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/state.js` with the `state` object, `NIGHT_*` constants, `DAY_NIGHT_PERIOD_S`, and `disposeGroup`. Note: `state.world` cannot be a fresh `THREE.Group()` initialized at module load if `main.js`'s `scene.add(state.world)` happens later in startup — but it can; THREE.Group exists without a renderer. The first `generateWorld` will replace it anyway.

```js
import * as THREE from "three";

export const ISLAND_SIZE_BASE = 38;
export const ISLAND_RADIUS_BASE = ISLAND_SIZE_BASE * 0.42;

export const state = {
  ISLAND_SIZE: ISLAND_SIZE_BASE,
  ISLAND_RADIUS: ISLAND_RADIUS_BASE,
  currentLayout: {
    centers: [{ cx: 0, cz: 0, radius: ISLAND_RADIUS_BASE, shape: { kind: "round" } }],
    planeSize: ISLAND_SIZE_BASE,
    boundRadius: ISLAND_RADIUS_BASE,
    kind: "single",
  },
  world: new THREE.Group(),
  creatures: [],
  caterpillars: [],
  butterflies: [],
  flowerSpots: [],
  flocks: [],
  particles: null,
  waterMesh: null,
  parallaxRingMesh: null,
  heightFn: () => 0,
  currentBiome: null,
  currentSeed: 0,
  maxElev: 0,
  sunLight: null,
  hemiLight: null,
  dayNight: null,
  windUniforms: { uTime: { value: 0 } },
  userSettings: {
    fogMultiplier: 1.0,
    autoCycle: false,
    manualDayFactor: 0.75,
  },
};

export const NIGHT_SKY = new THREE.Color("#0a0d24");
export const NIGHT_FOG = new THREE.Color("#070a1f");
export const NIGHT_SUN = new THREE.Color("#7a89b8");
export const NIGHT_HEMI_GROUND = new THREE.Color("#06070d");
export const DAY_NIGHT_PERIOD_S = 120;

export function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}
```

- [ ] Step 2: In `main.js`, add `import { state, NIGHT_SKY, NIGHT_FOG, NIGHT_SUN, NIGHT_HEMI_GROUND, DAY_NIGHT_PERIOD_S, disposeGroup, ISLAND_SIZE_BASE, ISLAND_RADIUS_BASE } from "./src/state.js";` at the top. Delete the local `state` definition, NIGHT_* constants, DAY_NIGHT_PERIOD_S, disposeGroup, ISLAND_SIZE_BASE, ISLAND_RADIUS_BASE from `main.js`.

- [ ] Step 3: Verify per protocol. Commit:

```bash
git add main.js src/state.js
git commit -m "Extract src/state.js (shared state, night palette, disposeGroup)"
```

### Task 3: Extract `src/biomes.js`

**Files:**
- Create: `src/biomes.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/biomes.js`. Cut the `BIOMES` array (currently lines 59–282 of `main.js`) and the four density/palette tables (`WILDFLOWER_PALETTES`, `GRASS_DENSITY`, `FLOWER_DENSITY`, `PEBBLE_DENSITY`, currently lines 2328–2360). Prepend `export` to each:

```js
// src/biomes.js
export const BIOMES = [ /* …unchanged contents from main.js lines 59–282… */ ];

export const WILDFLOWER_PALETTES = { /* …unchanged contents from main.js lines 2328–2341… */ };
export const GRASS_DENSITY = { /* …unchanged… */ };
export const FLOWER_DENSITY = { /* …unchanged… */ };
export const PEBBLE_DENSITY = { /* …unchanged… */ };
```

No THREE import needed — these are plain data.

- [ ] Step 2: In `main.js`, add `import { BIOMES, WILDFLOWER_PALETTES, GRASS_DENSITY, FLOWER_DENSITY, PEBBLE_DENSITY } from "./src/biomes.js";`. Delete the corresponding blocks from `main.js`.

- [ ] Step 3: Verify per protocol — extra check: regenerate worlds 3 times and confirm three different biomes can appear. Commit:

```bash
git add main.js src/biomes.js
git commit -m "Extract src/biomes.js (BIOMES table + density/palette tables)"
```

### Task 4: Extract `src/seed.js`

**Files:**
- Create: `src/seed.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/seed.js`. Cut `mulberry32`, `formatSeed`, `parseSeed`, `readSeedFromUrl`, `writeSeedToUrl`, `newRandomSeed` (currently lines 10–54 of `main.js`). `newRandomSeed` references `BIOMES`, so import it.

```js
// src/seed.js
import { BIOMES } from "./biomes.js";

export function mulberry32(seed) { /* unchanged */ }
export function formatSeed(seed) { /* unchanged */ }
export function parseSeed(str) { /* unchanged */ }
export function readSeedFromUrl() { /* unchanged */ }
export function writeSeedToUrl(seed) { /* unchanged */ }
export function newRandomSeed(excludeBiomeId) { /* unchanged */ }
```

- [ ] Step 2: In `main.js`, add `import { mulberry32, formatSeed, parseSeed, readSeedFromUrl, writeSeedToUrl, newRandomSeed } from "./src/seed.js";`. Delete the corresponding block from `main.js`.

- [ ] Step 3: Verify per protocol — extra check: load `/?seed=0x3f2a` twice and confirm same biome both times (determinism intact). Use back-button after regenerate to confirm popstate handler still triggers regeneration. Commit:

```bash
git add main.js src/seed.js
git commit -m "Extract src/seed.js (PRNG + URL seed plumbing)"
```

---

## Phase 2 — Utils + Terrain (2 new files)

### Task 5: Extract `src/util.js`

**Files:**
- Create: `src/util.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/util.js` containing `TRUNK`, `jitterGeo`, `applyWindSway`, and `randInt`. `applyWindSway` uses the shared wind uniform — it must read from `state.windUniforms.uTime`, not a local copy.

```js
// src/util.js
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { state } from "./state.js";

export const TRUNK = new THREE.Color("#3a2818");

export function jitterGeo(geo, amount = 0.05) { /* unchanged body from main.js */ }

export function applyWindSway(material, strength = 1.0) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uWindStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uWindStrength;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float windY = max(transformed.y, 0.0);
          float windAmp = windY * windY * uWindStrength;
          #ifdef USE_INSTANCING
            vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 wp = modelMatrix * vec4(transformed, 1.0);
          #endif
          float w1 = sin(uTime * 1.4 + wp.x * 0.30 + wp.z * 0.40);
          float w2 = sin(uTime * 0.9 + wp.x * 0.15 - wp.z * 0.25);
          transformed.x += w1 * windAmp * 0.06;
          transformed.z += w2 * windAmp * 0.05;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}

export function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
```

- [ ] Step 2: In `main.js`, add the import; delete the bodies that were cut. The line `state.windUniforms.uTime.value = t;` inside `animate()` stays unchanged.

- [ ] Step 3: Verify per protocol — extra check: watch flora/grass sway for ~10s in marsh biome (`/?seed=0x0042` or whichever yields marsh). Commit:

```bash
git add main.js src/util.js
git commit -m "Extract src/util.js (jitterGeo, applyWindSway, TRUNK, randInt)"
```

### Task 6: Extract `src/terrain.js`

**Files:**
- Create: `src/terrain.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/terrain.js` containing `smoothstep`, `islandFalloff`, `makeHeightFn`, `pickGroundPoint`, `pickLayout`, `makeTerrain`, `makeIslandUnderside`. `pickGroundPoint` reads `state.currentLayout` (live each call). `pickLayout` mutates `state.currentLayout` / `state.ISLAND_SIZE` / `state.ISLAND_RADIUS` — actually no, looking at the source `pickLayout` returns a layout and `generateWorld` does the mutation. Keep that pattern.

```js
// src/terrain.js
import * as THREE from "three";
import { state, ISLAND_SIZE_BASE, ISLAND_RADIUS_BASE } from "./state.js";
import { jitterGeo } from "./util.js";

export function smoothstep(e0, e1, x) { /* unchanged */ }
export function islandFalloff(center, x, z) { /* unchanged */ }
export function makeHeightFn(noise2D, layout, amp = 3.0) { /* unchanged */ }
export function pickGroundPoint(maxRadiusFrac = 0.88) {
  // body unchanged but uses state.currentLayout, state.ISLAND_SIZE, state.ISLAND_RADIUS where the original used the bare names
}
export function pickLayout() { /* unchanged — references ISLAND_SIZE_BASE/ISLAND_RADIUS_BASE which are now imported */ }
export function makeTerrain(biome, heightFn) { /* unchanged — uses state.ISLAND_SIZE */ }
export function makeIslandUnderside(biome, center) { /* unchanged */ }
```

- [ ] Step 2: Before moving, audit the cut region (lines 327–585) for any reference to the bare names that we already converted to `state.X` in Task 1. There should be none in that region since Task 1's rename was applied across the whole file. Double-check by grepping `main.js` for `\bISLAND_SIZE\b` etc. in the cut region — must all already be `state.ISLAND_SIZE`.

- [ ] Step 3: In `main.js`, add `import { makeHeightFn, pickGroundPoint, pickLayout, makeTerrain, makeIslandUnderside } from "./src/terrain.js";`. (`smoothstep` and `islandFalloff` are not called from `main.js`.) Delete the cut blocks.

- [ ] Step 4: Verify per protocol — extra check: load `/?seed=0x0001` through `/?seed=0x0004` looking for at least one archipelago layout (multi-island). Confirm objects place on islands and not in the void. Commit:

```bash
git add main.js src/terrain.js
git commit -m "Extract src/terrain.js (height fn, layout, terrain meshes)"
```

---

## Phase 3 — Big blocks (2 new files)

### Task 7: Extract `src/flora.js`

**Files:**
- Create: `src/flora.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/flora.js` containing the `FLORA_BUILDERS` registry. The registry uses `THREE`, `jitterGeo`, `applyWindSway`, `TRUNK`. None of the builders reference `state.*` directly — they only read the passed-in `biome` object — so this is a clean cut.

```js
// src/flora.js
import * as THREE from "three";
import { jitterGeo, applyWindSway, TRUNK } from "./util.js";

export const FLORA_BUILDERS = {
  /* unchanged contents from main.js lines 650–1385 */
};
```

- [ ] Step 2: In `main.js`, add `import { FLORA_BUILDERS } from "./src/flora.js";`. Delete the corresponding block.

- [ ] Step 3: Verify per protocol — extra check: regenerate worlds across at least three biomes (verdant/desert/mossy) and confirm flora renders. Watch wind sway. Commit:

```bash
git add main.js src/flora.js
git commit -m "Extract src/flora.js (FLORA_BUILDERS registry)"
```

### Task 8: Extract `src/fauna.js`

**Files:**
- Create: `src/fauna.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/fauna.js` containing creatures, caterpillars, and butterflies (lines 1387–2156: `makeCreature`, `stepCreature`, `findTrailPointAt`, `makeCaterpillar`, `stepCaterpillar`, `makeButterfly`, `pickFlower`, `_bflyTarget`, `stepButterfly`). These builders reference only `biome` + `THREE` + `Math.random`. Steppers receive `heightFn`/`flowerSpots` as parameters.

```js
// src/fauna.js
import * as THREE from "three";
import { jitterGeo } from "./util.js";

export function makeCreature(biome) { /* unchanged */ }
export function stepCreature(c, dt, t, heightFn) { /* unchanged */ }

function findTrailPointAt(trail, distance) { /* unchanged — internal helper */ }
export function makeCaterpillar(biome) { /* unchanged */ }
export function stepCaterpillar(c, dt, t, heightFn) { /* unchanged */ }

export function makeButterfly(palette, biome) { /* unchanged */ }
function pickFlower(flowerSpots) { /* unchanged — internal helper */ }
const _bflyTarget = new THREE.Vector3();
export function stepButterfly(b, dt, t, flowerSpots, heightFn) { /* unchanged */ }
```

- [ ] Step 2: In `main.js`, add `import { makeCreature, stepCreature, makeCaterpillar, stepCaterpillar, makeButterfly, stepButterfly } from "./src/fauna.js";`. Delete the cut blocks.

- [ ] Step 3: Verify per protocol — extra checks: (a) watch a creature walk for ~10s, (b) watch a caterpillar trail for ~10s, (c) butterflies should hover near wildflowers. Click a creature in follow mode to confirm raycast still works. Commit:

```bash
git add main.js src/fauna.js
git commit -m "Extract src/fauna.js (creatures, caterpillars, butterflies)"
```

---

## Phase 4 — Remaining builders (2 new files)

### Task 9: Extract `src/birds.js`

**Files:**
- Create: `src/birds.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/birds.js` containing `makeBird`, `pickBirdColor`, `makeFlock`, `_flockTarget`, `stepFlock` (lines 2596–2787).

```js
// src/birds.js
import * as THREE from "three";

export function makeBird(color) { /* unchanged */ }
function pickBirdColor(biome) { /* unchanged — internal */ }
export function makeFlock(biome) { /* unchanged */ }
const _flockTarget = new THREE.Vector3();
export function stepFlock(flock, dt, t) { /* unchanged */ }
```

- [ ] Step 2: In `main.js`, add `import { makeFlock, stepFlock } from "./src/birds.js";`. Delete cut blocks.

- [ ] Step 3: Verify — birds appear and fly. Commit:

```bash
git add main.js src/birds.js
git commit -m "Extract src/birds.js (bird flocks)"
```

### Task 10: Extract `src/environment.js`

**Files:**
- Create: `src/environment.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/environment.js` containing particles, water, parallax ring, and ground cover instanced fields (lines 2158–2594, excluding the biome density tables which moved to biomes.js in Task 3). `placeInstanced` calls `pickGroundPoint`, which now lives in `terrain.js`. Water and parallax read `state.ISLAND_SIZE` — actually water uses `ISLAND_SIZE` directly (now `state.ISLAND_SIZE` after Task 1).

```js
// src/environment.js
import * as THREE from "three";
import { state } from "./state.js";
import { jitterGeo, applyWindSway } from "./util.js";
import { pickGroundPoint } from "./terrain.js";
import { WILDFLOWER_PALETTES, GRASS_DENSITY, FLOWER_DENSITY, PEBBLE_DENSITY } from "./biomes.js";

export function makeParticles(biome) { /* unchanged */ }
export function stepParticles(points, dt, t) { /* unchanged */ }

export function placeInstanced(geo, mat, count, heightFn, opts = {}) { /* unchanged — calls pickGroundPoint */ }
export function makeGrassField(biome, heightFn) { /* unchanged */ }
export function makeWildflowerField(biome, heightFn) { /* unchanged */ }
export function makePebbleField(biome, heightFn) { /* unchanged */ }

export function makeWaterPlane(biome) { /* unchanged — references state.ISLAND_SIZE */ }
export function stepWater(water, dt, t) { /* unchanged */ }

export function makeParallaxRing(biome) { /* unchanged */ }
```

- [ ] Step 2: In `main.js`, add `import { makeParticles, stepParticles, makeGrassField, makeWildflowerField, makePebbleField, makeWaterPlane, stepWater, makeParallaxRing } from "./src/environment.js";`. Delete cut blocks.

- [ ] Step 3: Verify — load marsh biome seed, see water ripple. Load a glowFlowers biome (mossy, twilight, grove), see emissive flowers. Particles drift. Commit:

```bash
git add main.js src/environment.js
git commit -m "Extract src/environment.js (particles, water, parallax, ground cover)"
```

---

## Phase 5 — Orchestrator + UI (2 new files); `main.js` becomes tiny

### Task 11: Extract `src/world.js`

**Files:**
- Create: `src/world.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/world.js` containing `updateDayNight` and `generateWorld`. `generateWorld` calls a lot of imported builders; collect imports at the top. It also needs a `scene` reference and a way to release the follow target — receive these via a setup function or import from main.js. Simplest: export `setSceneRef(scene)` and `setFollowReleaseCallback(fn)`; main.js calls both at startup.

```js
// src/world.js
import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import {
  state,
  NIGHT_SKY, NIGHT_FOG, NIGHT_SUN, NIGHT_HEMI_GROUND, DAY_NIGHT_PERIOD_S,
  disposeGroup,
} from "./state.js";
import { BIOMES, WILDFLOWER_PALETTES, FLOWER_DENSITY } from "./biomes.js";
import { mulberry32, formatSeed, writeSeedToUrl } from "./seed.js";
import { randInt } from "./util.js";
import { makeHeightFn, pickGroundPoint, pickLayout, makeTerrain, makeIslandUnderside } from "./terrain.js";
import { FLORA_BUILDERS } from "./flora.js";
import { makeCreature, makeCaterpillar, makeButterfly } from "./fauna.js";
import { makeFlock } from "./birds.js";
import {
  makeParticles, makeGrassField, makeWildflowerField, makePebbleField,
  makeWaterPlane, makeParallaxRing,
} from "./environment.js";

let _scene = null;
let _releaseFollow = () => {};
export function setSceneRef(scene) { _scene = scene; }
export function setFollowReleaseCallback(fn) { _releaseFollow = fn; }

export function updateDayNight(t) {
  if (!state.dayNight || !state.sunLight || !state.hemiLight || !_scene) return;
  /* body unchanged but reads state.* and _scene */
}

export function generateWorld(seed) {
  /* body unchanged: opens by patching Math.random, picks biome+layout, builds world, closes by restoring Math.random */
  /* must call _releaseFollow() instead of the global setFollowTarget reference */
}
```

Inside `generateWorld`, the line `if (typeof setFollowTarget === "function") setFollowTarget(null);` becomes `_releaseFollow();`. HUD writes (`document.getElementById("biome-name").textContent = …`) stay as-is — they touch the DOM directly, which is fine.

Also: `generateWorld` currently calls `controls.autoRotate = true;` near the bottom. The `controls` reference lives in main.js. Move that line out — main.js can pass a callback or simpler: keep `controls.autoRotate = true` reset in main.js's regen click handler instead. Cleanest: remove the line from `generateWorld` and add it in the regen handler.

- [ ] Step 2: In `main.js`, add `import { generateWorld, updateDayNight, setSceneRef, setFollowReleaseCallback } from "./src/world.js";`. After creating `scene`, call `setSceneRef(scene)`. After defining `setFollowTarget` in main.js (Task 12 will move it), call `setFollowReleaseCallback(() => setFollowTarget(null))`. For now (before Task 12), pass an inline closure that calls the current `setFollowTarget`. Delete the `generateWorld`, `updateDayNight`, `disposeGroup`, NIGHT_* constants, `randInt`, and `userSettings`/state-block remnants from `main.js`.

- [ ] Step 3: Verify per protocol — full regression: load, regenerate 5 times, follow a creature, scrub time slider, toggle auto-cycle, scrub fog. Commit:

```bash
git add main.js src/world.js
git commit -m "Extract src/world.js (generateWorld orchestrator + updateDayNight)"
```

### Task 12: Extract `src/ui.js` and shrink `main.js`

**Files:**
- Create: `src/ui.js`
- Modify: `main.js`

- [ ] Step 1: Create `src/ui.js` containing settings panel wiring, follow-creature wiring, regen button, popstate, resize, keydown, and the initial HUD sync. `ui.js` needs references to `camera`, `controls`, `canvas`, and `renderer` for: resize (camera+renderer), follow tracking (controls — actually that's in `animate()` which stays in main.js), regen reset (controls.autoRotate), raycaster (camera). The cleanest way: export an `initUi({ scene, camera, canvas, controls, renderer })` setup function that wires everything when called.

```js
// src/ui.js
import * as THREE from "three";
import { state } from "./state.js";
import { newRandomSeed, readSeedFromUrl } from "./seed.js";
import { generateWorld, setFollowReleaseCallback } from "./world.js";

export let followTarget = null;
let selectingCreature = false;

export function setFollowTarget(creatureOrNull) {
  followTarget = creatureOrNull;
  /* rest unchanged */
}

export function initUi({ scene, camera, canvas, controls, renderer }) {
  // Hand world.js a release callback so generateWorld() can drop a stale follow.
  setFollowReleaseCallback(() => setFollowTarget(null));

  /* paste settings panel wiring (settingsPanel, settingsToggle, settingsClose, autoRotateInput, autoCycleInput, timeSlider, fogSlider, follow button, reset camera) */
  /* paste regen click handler (calls generateWorld(newRandomSeed(state.currentBiome?.id)); controls.autoRotate = true) */
  /* paste popstate handler */
  /* paste resize handler (uses camera, renderer) */
  /* paste click-to-pick raycaster handler (uses camera, canvas) */
  /* paste keydown handler */
  /* call syncTimeUi() once at the end */
}

export function getFollowTarget() { return followTarget; }
```

- [ ] Step 2: Rewrite `main.js` to be the thin entry point. Final structure:

```js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { state } from "./src/state.js";
import { readSeedFromUrl, newRandomSeed } from "./src/seed.js";
import { generateWorld, updateDayNight, setSceneRef } from "./src/world.js";
import { stepCreature, stepCaterpillar, stepButterfly } from "./src/fauna.js";
import { stepFlock } from "./src/birds.js";
import { stepParticles, stepWater } from "./src/environment.js";
import { initUi, getFollowTarget, setFollowTarget } from "./src/ui.js";

// renderer / scene / camera / controls (unchanged 287–325 block)
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ /* … */ });
/* … */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(/* … */);
const controls = new OrbitControls(camera, canvas);
/* … */
scene.add(state.world);
setSceneRef(scene);

// animation loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  state.windUniforms.uTime.value = t;
  updateDayNight(t);
  for (const c of state.creatures) stepCreature(c, dt, t, state.heightFn);
  for (const c of state.caterpillars) stepCaterpillar(c, dt, t, state.heightFn);
  for (const b of state.butterflies) stepButterfly(b, dt, t, state.flowerSpots, state.heightFn);
  for (const f of state.flocks) stepFlock(f, dt, t);
  stepParticles(state.particles, dt, t);
  stepWater(state.waterMesh, dt, t);

  const ft = getFollowTarget();
  if (ft && ft.group && ft.group.parent) {
    const p = ft.group.position;
    const k = Math.min(1, dt * 4);
    controls.target.x += (p.x - controls.target.x) * k;
    controls.target.y += (p.y + 0.6 - controls.target.y) * k;
    controls.target.z += (p.z - controls.target.z) * k;
  } else if (ft) {
    setFollowTarget(null);
  }
  controls.update();
  renderer.render(scene, camera);
}

initUi({ scene, camera, canvas, controls, renderer });
const initialSeed = readSeedFromUrl() ?? newRandomSeed();
generateWorld(initialSeed);
animate();
```

- [ ] Step 3: Verify per protocol — full regression (every interaction): load with seed, load without seed, regen 5x, follow creature, escape to release, scrub time/fog, toggle auto-cycle, toggle auto-rotate, reset camera, back/forward navigation in browser. No console errors. Commit:

```bash
git add main.js src/ui.js
git commit -m "Extract src/ui.js; main.js becomes thin entry point"
```

---

## Final step: push

- [ ] After Task 12 verifies clean, push to origin:

```bash
git push origin main
```

---

## Self-review checklist (after writing, before executing)

- [x] Every task lists exact files to create/modify.
- [x] Imports for each new module are spelled out.
- [x] Determinism trick preserved: `Math.random` patching stays inside `generateWorld` in `world.js`; nothing async added.
- [x] `windUniforms` is a single object on `state`, read live by `applyWindSway`.
- [x] `pickGroundPoint` reads `state.currentLayout` live, not via destructure.
- [x] `setFollowTarget` reference cycle (world.js → ui.js) broken via setter callback (`setFollowReleaseCallback`).
- [x] `controls.autoRotate = true` reset moved from `generateWorld` to the regen click handler so `world.js` doesn't need a `controls` ref.
- [x] HUD `document.getElementById(...)` writes stay inside `generateWorld` (still in `world.js`) — that's fine; the DOM is a global.
- [x] No phase touches more than 5 files (`main.js` + ≤4 new modules per phase).
