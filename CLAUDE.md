# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page Three.js "terrarium" that procedurally generates a small floating-island world (biome, terrain, flora, creatures, birds, particles) from a 16-bit seed. No build step, no package manager — Three.js and simplex-noise are loaded from CDN via the `<script type="importmap">` in `index.html`.

## Running it

The Makefile wraps `server.py` (a stdlib `http.server` that disables caching) as a backgrounded process on `0.0.0.0:1999`. PID is tracked in `.server.pid`, output goes to `.server.log`.

```
make start     # start (idempotent — reports if already running)
make stop      # stop via PID file, falls back to lsof on :1999 for stray procs
make restart
make status
make logs      # tail -f the log
```

There are no tests, no linter, no build. Edits to `main.js` / `src/*.js` / `style.css` / `index.html` are picked up on browser reload — the server sends `Cache-Control: no-store` so a normal refresh is enough.

## Architecture

The app is one ES module graph loaded by `index.html` via an importmap. Entry point `main.js` (~130 lines) wires the renderer, camera, OrbitControls, kicks off `generateWorld(seed)`, and runs the `animate()` loop. Everything else lives in `src/`:

- **`src/state.js`** — the shared module-scope singleton. `state` holds `world` (the THREE.Group that's disposed/rebuilt every regen), all entity arrays (`creatures`, `caterpillars`, `butterflies`, `bees`, `flocks`, `dirtPuffs`, `flowerSpots`), `heightFn`, `currentBiome`, `currentLayout`, `ISLAND_SIZE`/`ISLAND_RADIUS`, `windUniforms`, `userSettings`. Every other module imports from here rather than passing things around. Also exports `disposeGroup`, the night-palette constants, and the `ISLAND_SIZE_BASE` / `DENSITY_BASE` anchors (see "Density scaling" below).
- **`src/seed.js`** — `mulberry32`, `parseSeed`/`formatSeed`, `readSeedFromUrl`/`writeSeedToUrl`, `newRandomSeed({excludeBiomeId, allowedBiomeIds})`. Seeds are 16-bit hex (e.g. `0x3f2a`).
- **`src/biomes.js`** — the `BIOMES` config table (currently twelve entries) plus `WILDFLOWER_PALETTES` / `GRASS_DENSITY` / `FLOWER_DENSITY` / `PEBBLE_DENSITY` overrides. Each biome fully specifies palette, fog, accent/sun colors, allowed flora kinds + count, particle type, creature color palette + count range, plus optional dusk/night palette deltas. Optional flags (`water`, `cloudlike`, `glowFlowers`, `glowEyes`, `creatureKind`) gate cross-cutting behavior — see "Biome-flag pattern" below. Adding visual variety usually means editing this table, not the builders.
- **`src/terrain.js`** — `makeHeightFn(noise2D, layout, amp)` returns a `(x,z) => y` closure combining three simplex-noise octaves with a per-center smoothstep falloff (`islandFalloff`) so each island has a defined edge that plunges into void past its radius. `makeTerrain` bakes that into a vertex-colored `PlaneGeometry`. `pickLayout()` and `pickGroundPoint(maxRadiusFrac)` / `nearestCenter(x,z)` live here.
- **`src/flora.js`** — `FLORA_BUILDERS` is a `{ kind: (biome) => THREE.Group }` registry; biomes reference these by string from their `flora` array. `jitterGeo` is the shared helper that welds an `IcosahedronGeometry`'s duplicate vertices via `mergeVertices` (after stripping UVs/normals so the merge works) and perturbs positions for a hand-modeled look. `resetFloraPool()` is called at the top of every regen since the previous-world materials/geometries were just disposed.
- **`src/fauna.js`** — `makeCreature` / `makeCaterpillar` / `makeButterfly` / `makeBee` constructors and their `stepX` updaters. Each entity returns `{ group, …state }` with no base class; the animation loop iterates parallel arrays on `state`.
- **`src/birds.js`** — `makeFlock(biome)` + `stepFlock(flock, dt, t)`.
- **`src/environment.js`** — particles, instanced ground cover (`makeGrassField` / `makeWildflowerField` / `makePebbleField`, all built on a shared `placeInstanced`), `makeWaterPlane`, `makeParallaxRing`, and their per-frame `stepX` updaters. Wildflowers return positions for butterflies to target via `state.flowerSpots`.
- **`src/world.js`** — `generateWorld(seed)`, the orchestrator. Disposes the previous `state.world`, picks biome + layout deterministically, builds atmosphere → lights → terrain → optional water → flora → ground cover → creatures → birds → particles, writes HUD stats and the seed back to the URL. Also exports `updateDayNight(t)` (the day/night color/sun lerp called from `animate`) and the `setSceneRef` / `setControlsRef` / `setFollowReleaseCallback` wiring used by `main.js`.
- **`src/ui.js`** — all DOM wiring against the static HUD in `index.html`: settings panel, help panel, photo mode (P/S keys, save-to-png, freeze the sim), first-person stroll mode (F/WASD/mouse-look), follow mode (raycaster-based creature pick from `state.creatures` + `state.caterpillars`), biome filter chips, bookmarks, copy-link, auto-regenerate timer, regen button. `generateWorld` calls `setFollowTarget(null)` on regen so a stale ref doesn't survive `disposeGroup`.
- **`src/lowfx.js`** — `LOWFX` boolean (true on touch / small-screen / low DPR devices) and `LOWFX_DENSITY` multiplier. Honor both when adding new instanced fields or particle-heavy effects; `main.js` also caps `setPixelRatio` at 1 when `LOWFX` is set.
- **`src/util.js`** — shared helpers: `jitterGeo` (geometry weld + perturb), `applyWindSway` (see "Wind sway" below), `randInt`, and the `TRUNK` color constant.

### The determinism trick (important when touching world-gen)

`generateWorld` monkey-patches `Math.random = mulberry32(seed)` for the duration of world construction, then restores the original. Every `Math.random()` call inside builders therefore reproduces from the seed, but per-frame `stepX` updaters (which run after the restore) keep natural variation. **If you add new world-gen code that needs to be deterministic, it must run synchronously inside `generateWorld` before `Math.random` is restored.** Async work, timers, or anything triggered by user interaction will use the real `Math.random`.

### Seed → biome → layout coupling

The biome is picked by the first `Math.random()` call inside `generateWorld`, and `pickLayout()` runs immediately after — both stay inside the deterministic window so the seed alone identifies the entire world. `newRandomSeed(excludeBiomeId)` rerolls up to 24 times to avoid landing on the same biome twice in a row when the user clicks regenerate.

### Layout system

`pickLayout()` returns `{ centers, planeSize, boundRadius, kind }` describing one island (round / oblong / kidney). It's always single-island today — archipelagos were tried but the creature roaming and silhouette didn't read well across disconnected chunks (see comment in `terrain.js`). The infrastructure is still multi-center though: `centers` is an array, `islandFalloff` is per-center, and `pickGroundPoint(maxRadiusFrac)` / `nearestCenter(x,z)` already weight by island area. **Anything that needs to place objects on solid ground must go through `pickGroundPoint`** rather than raw `Math.random()` over XZ, so re-enabling archipelagos later doesn't require rewriting every placement call.

### Density scaling

Biome `floraCount` and `creatureCount` values in `biomes.js` were tuned against a 38-unit base. The actual `ISLAND_SIZE_BASE` may be larger (currently 50); `src/state.js` exports a separate `DENSITY_BASE = 38` anchor, and `world.js` scales the per-world target counts by `state.ISLAND_SIZE / DENSITY_BASE` so larger or shape-stretched layouts stay cute-dense instead of going sparse. If you retune biome counts, update them at the `DENSITY_BASE` reference, not at the current base size.

### Wind sway

`applyWindSway(material, strength)` patches a `MeshStandardMaterial`'s vertex shader via `onBeforeCompile` so geometry bends more the higher its local Y (trunks at y≈0 stay put, leaves and grass tips sway). All instances share one `windUniforms.uTime` uniform advanced each frame. Apply it to any new flora that should bend in the wind; it works on both regular meshes and `InstancedMesh` (the shader checks `USE_INSTANCING`).

### Day/night cycle

`updateDayNight(t)` lerps the scene's sky/fog/sun/hemi colors between the current biome's palette (snapshotted into `dayNight` at world build) and a generic `NIGHT_*` palette, and arcs the sun across the sky. Driven by either `userSettings.autoCycle` (a 120s cycle) or `userSettings.manualDayFactor` (settings-panel slider). Fog density is also scaled by `userSettings.fogMultiplier`.

### Biome-flag pattern

Several per-biome behaviors are gated by optional flags rather than hardcoded biome ids. When adding a new per-biome behavior, prefer a flag over `if (biome.id === ...)`:

- `water` (color) — adds a translucent water plane.
- `cloudlike` — `makeIslandUnderside` perturbs more vertices for a puffball silhouette.
- `glowFlowers` — wildflower instances get an emissive material.
- `glowEyes` — creature pupils render emissive in the accent color.
- `creatureKind: "fish"` — `makeCreature` builds a non-landing flier with fin-like ears and a tail fin instead of wings; gentle fin sway in `stepCreature`.

### HUD

`index.html` defines the static HUD shell. `generateWorld` writes biome name, creature/flora/bird counts, seed, and computed max elevation into `#biome-name`, `#creature-count`, etc. Styling is purely in `style.css` (film grain, vignette, corner marks, fonts from Google Fonts).

## Vibe

This project is **cute**. That's a design constraint, not a vague aspiration — when adding or tweaking anything visible, keep it consistent with the existing feel:

- **Big eyes, small bodies.** Creatures have oversized white-sclera eyes with dark pupils set forward on the face. Don't shrink them, don't add realistic proportions, don't go menacing.
- **Rounded, blobby silhouettes.** Bodies are jittered icospheres, not boxes or sharp polys. Flora is chunky and stylized (cone-tiered pines, capsule cacti, hemisphere mushroom caps) — never photorealistic.
- **Smooth, easeful motion.** Movement is gentle drifts, bobs, and arcs — never linear, never twitchy. Look at `stepCreature` / `stepButterfly` for the reference cadence: soft acceleration, slight overshoot, idle breathing.
- **Cartoony, not gritty.** Even the "ashen wastes" and "crimson dunes" biomes are stylized and warm, not bleak. `skull` is the darkest motif and it's still rounded.
- **Saturated but soft palettes.** Biome colors lean painterly. Tone mapping is ACES Filmic with mild exposure; fog is heavy. Don't introduce harsh contrast or neon.

If a change would make something look scary, sharp, realistic, or twitchy, it's wrong for this project even if it's technically nicer.

## Conventions worth keeping

- **No build, no deps.** Keep it that way unless explicitly asked. New libraries go in the importmap; don't introduce npm/package.json/bundlers.
- **Adding a biome:** append to `BIOMES`. If a new flora kind is needed, add it to `FLORA_BUILDERS` first; the biome's `flora` array references it by string. Also extend the per-biome `WILDFLOWER_PALETTES` / `GRASS_DENSITY` / `FLOWER_DENSITY` / `PEBBLE_DENSITY` tables (they fall back to defaults via `??` but tuned values look better).
- **Adding a creature type:** follow the existing `makeX` + `stepX` split and push to the corresponding array inside `generateWorld`, then call its `stepX` from `animate()`.
- **Cross-cutting per-biome behavior:** add a flag on the biome (see "Biome-flag pattern" above) and check it in the relevant builder, rather than branching on `biome.id`.
- **Placement:** use `pickGroundPoint()` rather than raw XZ randomness so multi-island layouts work.
- **Disposal:** `disposeGroup` walks geometries/materials when the world is rebuilt. New mesh-allocating code that lives on the `world` group is covered automatically; new top-level scene additions are not.

## Enhancement workflow

`ideas.md` is a running enhancement list, organized by category and tagged S/M/L. The convention at the top of that file: **implement the item, remove it from `ideas.md`, then commit and push** so the live GitHub Pages site reflects the work.
