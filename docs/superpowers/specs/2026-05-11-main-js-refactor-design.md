# Design: Split `main.js` into multiple modules

**Date:** 2026-05-11
**Status:** Approved (brainstorming)

## Goal

Split the single 3316-line `main.js` into ~11 focused ES modules under `src/`, keeping `main.js` as a thin entry point. Pure code reorganization — no behavior, rendering, or determinism changes.

## Constraints

- **No build step, no bundler, no package manager.** Files load directly via `<script type="module" src="./main.js">`. Inter-module imports use relative paths. The `<script type="importmap">` in `index.html` (which only maps `three` and `simplex-noise`) is unchanged.
- **Deterministic world-gen must be preserved.** Inside `generateWorld`, `Math.random` is monkey-patched with a seeded `mulberry32` PRNG, then restored after the world is built. Because `Math.random` is a global, builders called inside `generateWorld` will hit the patched version regardless of which module they live in. The refactor must not change the call ordering inside `generateWorld`.
- **Shared `windUniforms.uTime`.** All sway shaders share one uniform object advanced per frame. The split must keep a single instance shared by reference, not duplicate it per module.
- **`pickGroundPoint` must read live layout state.** It depends on `currentLayout` / `ISLAND_SIZE` / `ISLAND_RADIUS`, which are mutated by `pickLayout` inside `generateWorld`. The split must guarantee `pickGroundPoint` reads the just-mutated values, not stale captures.
- **Cute vibe constraints** from `CLAUDE.md` continue to apply, though this refactor changes no visible output.

## Target file structure

```
main.js                  # entry point — renderer, camera, scene, controls, lights,
                         # animate loop, top-level wiring
src/
  state.js               # shared mutable state object, NIGHT_* palette constants,
                         # disposeGroup helper
  seed.js                # mulberry32, formatSeed, parseSeed, readSeedFromUrl,
                         # writeSeedToUrl, newRandomSeed
  biomes.js              # BIOMES table + WILDFLOWER_PALETTES, GRASS_DENSITY,
                         # FLOWER_DENSITY, PEBBLE_DENSITY
  terrain.js             # smoothstep, islandFalloff, makeHeightFn, pickGroundPoint,
                         # pickLayout, makeTerrain, makeIslandUnderside
  util.js                # jitterGeo, applyWindSway, TRUNK color, randInt
  flora.js               # FLORA_BUILDERS registry (~750 lines)
  fauna.js               # makeCreature/stepCreature, makeCaterpillar/stepCaterpillar
                         # (+ findTrailPointAt), makeButterfly/stepButterfly
                         # (+ pickFlower)  (~750 lines)
  birds.js               # makeBird, pickBirdColor, makeFlock, stepFlock
  environment.js         # makeParticles/stepParticles, makeWaterPlane/stepWater,
                         # makeParallaxRing, placeInstanced, makeGrassField,
                         # makeWildflowerField, makePebbleField
  world.js               # generateWorld orchestrator + updateDayNight + day/night
                         # palette snapshotting
  ui.js                  # settings panel, follow-creature, regen button, resize,
                         # popstate, keydown wiring
```

## Shared state contract

`src/state.js` exports a single mutable object `state` that other modules read and write directly. This is intentional: it preserves the current "module-scope variable" semantics with minimal signature churn.

Fields on `state`:

- **World contents:** `world` (THREE.Group), `creatures` (array), `caterpillars` (array), `butterflies` (array), `flowerSpots` (array), `flocks` (array), `particles` (Points or null), `waterMesh` (Mesh or null), `parallaxRingMesh` (Mesh or null).
- **World metadata:** `heightFn` (function), `currentBiome` (object), `currentSeed` (number), `maxElev` (number).
- **Layout:** `currentLayout` (object), `ISLAND_SIZE` (number), `ISLAND_RADIUS` (number).
- **Lighting:** `sunLight` (DirectionalLight), `hemiLight` (HemisphereLight), `dayNight` (palette snapshot object or null).
- **Shared uniforms:** `windUniforms` (object `{ uTime: { value: 0 } }`) — exported as a single instance, never reassigned.
- **User settings:** `userSettings` (object — `autoRotate`, `autoCycle`, `manualDayFactor`, `fogMultiplier`).

Also exported from `state.js`:

- `NIGHT_SKY`, `NIGHT_FOG`, `NIGHT_SUN`, `NIGHT_HEMI_GROUND` — `THREE.Color` constants.
- `DAY_NIGHT_PERIOD_S` — number.
- `disposeGroup(g)` — walks a Group's children disposing geometries/materials.

**Rule for the determinism trick:** because `Math.random` is a global, no special plumbing is needed across modules — every builder call sees the patched PRNG so long as it runs synchronously inside `generateWorld`. The refactor must not introduce async builders.

**Rule for `pickGroundPoint`:** `pickLayout` mutates `state.currentLayout`, `state.ISLAND_SIZE`, `state.ISLAND_RADIUS` before any placement helpers run. `pickGroundPoint` reads them via `state.currentLayout` (live lookup), not via destructured locals captured at import time.

## Module dependency graph

```
                 state.js  ←──────────────── (imported by everything)
                    ▲
   seed.js          │
   biomes.js  ──→  state                          (biomes is data-only)
   util.js   ──→  state                           (windUniforms)
   terrain.js ──→ state, util                     (jitterGeo, randInt)
   flora.js  ──→  state, util                     (jitterGeo, applyWindSway, TRUNK)
   fauna.js  ──→  state, util, biomes, terrain    (heightFn, pickGroundPoint via state)
   birds.js  ──→  state, biomes
   environment.js → state, util, biomes, terrain
   world.js  ──→  state, seed, biomes, terrain, flora, fauna, birds, environment
   ui.js     ──→  state, seed, world              (regen calls generateWorld)
   main.js   ──→  state, seed, world, ui          (+ fauna/butterflies for animate loop)
```

`main.js` imports the per-frame steppers it needs (`stepCreature`, `stepCaterpillar`, `stepButterfly`, `stepFlock`, `stepParticles`, `stepWater`, `updateDayNight`) and the entity arrays from `state`.

## Phasing

Per global "PHASED EXECUTION" rule: ≤5 files per phase, verify after each.

1. **Phase 1 — leaves (3 new files).** Create `src/state.js`, `src/seed.js`, `src/biomes.js`. Replace the corresponding top-of-file sections in `main.js` with imports. Verify world loads + URL seed roundtrips.
2. **Phase 2 — utils + terrain (2 new files).** Extract `src/util.js`, `src/terrain.js`. Verify worlds regenerate, multi-island layouts still place objects correctly.
3. **Phase 3 — big blocks (2 new files).** Extract `src/flora.js`, `src/fauna.js`. Verify all biomes render correct flora, creatures roam, caterpillars trail, butterflies target wildflowers.
4. **Phase 4 — remaining builders (2 new files).** Extract `src/birds.js`, `src/environment.js`. Verify birds fly, particles drift, water ripples in marsh biome, parallax ring tints with day/night.
5. **Phase 5 — orchestrator + UI (2 new files).** Extract `src/world.js`, `src/ui.js`. `main.js` collapses to a thin entry point. Final verify: regenerate worlds, click-to-follow a creature, toggle auto-rotate, scrub day/night slider, adjust fog.

## Verification per phase

Manual checks against `http://localhost:1999`:

1. Page loads with no console errors.
2. World generates from URL seed; copy/paste a known seed (e.g. `?seed=0x3f2a`) and confirm same biome/layout.
3. Click "Regenerate" — new world appears, URL updates.
4. Click a creature — follow mode engages.
5. Open settings — toggle auto-rotate, auto-cycle, fog slider, day/night slider.
6. Watch for ~30s — no stuttering, no broken animations.

No automated tests exist in this repo; manual verification is the only check.

## Out of scope

- No behavior changes, no new features, no visual tweaks.
- No package.json, no bundler, no TypeScript.
- No renaming of public symbols beyond what's needed to make exports work.
- No reorganization of CSS or HTML.
- No changes to `server.py`, `Makefile`, or CI.
- `ideas.md` enhancements are deferred — this refactor is its own commit series.

## Risks

- **Stale captures of layout state.** If a module destructures `ISLAND_SIZE` at import time, it'll see `38` forever. Mitigation: always reference `state.ISLAND_SIZE` at call time, never destructure.
- **Multiple `windUniforms` instances.** If `util.js` re-creates its own `windUniforms`, shaders won't share time. Mitigation: `windUniforms` lives on `state`, `applyWindSway` reads `state.windUniforms`.
- **Circular imports.** The dependency graph above is a DAG. Mitigation: review it before each phase; if a circular import is needed, factor the shared bit into `state.js` or `util.js`.
- **Determinism regression.** If any builder is accidentally moved out of the synchronous `generateWorld` call tree (e.g. queued via `requestAnimationFrame`), seeds will diverge. Mitigation: phase 5 diff-review the `generateWorld` body to confirm call ordering is preserved.
