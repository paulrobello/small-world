# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page Three.js "terrarium" that procedurally generates a small floating-island world (biome, terrain, flora, creatures, birds, particles) from a 16-bit seed. Vite provides the dev server (HMR) and optimized production builds. Three.js and simplex-noise are npm packages, bundled and tree-shaken. Live site: https://small-world.pardev.net/

## Navigation quick start

Start with `README.md` for the user-facing product shape, then `index.html` for CDN/importmap dependencies and HUD markup, `main.js` for renderer/camera/animation-loop wiring, and `src/world.js` for the deterministic world-generation orchestration. Use `src/state.js` to understand shared mutable state before changing cross-cutting behavior. Feature work usually lands in one concern module under `src/` plus, when visible in the HUD/settings, `src/ui.js`, `index.html`, and `style.css`.

Source-of-truth docs/backlog:

- `CLAUDE.md` (this file) — architecture/conventions/gotchas for agents.
- `ideas.md` — curated enhancement backlog; completed items should be removed.
- `AUDIT.md` — performance/bug audit notes from 2026-05-13. Verify against current code before acting; some audit items may become stale as fixes land.

## Running it

`make dev` starts the Vite dev server in the foreground with hot reload on `http://localhost:2001`; `make dev-start` / `make dev-stop` / `make dev-restart` manage the same Vite server in the background. Edits to `main.js` / `src/*.js` / `style.css` / `index.html` are reflected instantly without a full reload when possible.

`make build` produces an optimized production bundle in `dist/` (minified, tree-shaken, content-hashed assets). `make preview` serves the built output locally.

```
make dev          # Vite dev server with HMR in the foreground
make dev-start    # Vite dev server with HMR in the background
make dev-stop     # stop the background dev server, or any process on PORT
make dev-restart  # restart the background dev server
make build        # production build → dist/
make preview      # preview production build
make lint         # ESLint over main.js and src/
make checkall     # all JS/Python tests + lint + production build
make clean        # rm -rf dist
```

Runtime dependencies (three.js, simplex-noise) are installed via npm and bundled by Vite — they're no longer loaded from CDN. `node_modules/` is gitignored; run `npm install` before `make dev` or `make build`.

## Browser debugging

When working from Codex Desktop, use the built-in browser debugging tools for local web app inspection, screenshots, console/network checks, and visual verification. Start the app with `make dev-start` if needed, open `http://localhost:2001` in the Codex browser tooling, and inspect the live app there.

`agentchrome` is primarily for Codex CLI / Claude-style workflows. Do not use it from Codex Desktop for this repo unless the user explicitly asks for it or the built-in browser tooling cannot handle the task. If `agentchrome` is used as a fallback, shut it down with `agentchrome shutdown` when finished.

## Version

The app version is defined in `package.json` (`"version"` field). It's injected into the app at build time via Vite's `define` config and appears in the header eyebrow as "vol. X.Y.Z".

**Always bump `version` in `package.json` before pushing.** Use semantic versioning (major.minor.patch):
- **patch** — bug fixes, small tweaks
- **minor** — new features, new biomes, new creatures
- **major** — breaking changes, major reworks

CI reads `package.json` and passes the version to the build, so the deployed site always shows the correct version.

## Release/deploy

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`) which runs `npm ci && npm run build` and deploys the `dist/` output to GitHub Pages. The `CNAME` file (`small-world.pardev.net`) is copied into the build output for the custom domain. `dist/` is gitignored — only source files are tracked; the bundle is built fresh by CI on every push.

Before pushing, always:
1. Bump `version` in `package.json`
2. Commit the version bump alongside (or just before) the changes
3. Push to `main`

## Architecture

The app is one ES module graph loaded by `index.html` via an importmap. Entry point `main.js` wires the renderer, camera, OrbitControls, kicks off `generateWorld(seed)`, and runs the `animate()` loop. Everything else lives in `src/`:

- **`src/state.js`** — the shared module-scope singleton. `state` holds `world` (the THREE.Group that's disposed/rebuilt every regen), all entity arrays (`creatures`, `caterpillars`, `butterflies`, `bees`, `flocks`, `dirtPuffs`, `dustKicks`, `flowerSpots`), `heightFn`, `currentBiome`, `currentLayout`, `ISLAND_SIZE`/`ISLAND_RADIUS`, `windUniforms`, `userSettings`, plus refs for the visual-polish modules: `shadowDisks`, `waterReflection`, `mountainBasePos`, `postfx`, `renderer`, and `depthTexture` (set by `initPostFX` for depth-based post-processing). Also `obstacles` (entries `{x, z, r, top}` — `top` is the canopy world-Y consumed by the air-passing height filter in `avoidObstacles`) and `perchSpots` (entries `{x, z, y}` — mushroom-cap landing pads consumed by the flier landing code). Every other module imports from here rather than passing things around. Also exports `disposeGroup`, the night-palette constants, and the `ISLAND_SIZE_BASE` / `DENSITY_BASE` anchors (see "Density scaling" below). `userSettings` covers atmosphere knobs, five FX controls (`bloom`, `tiltShift`, `outline`, `ao`, `depthFog`) with `fxPanelOpen`, three wind controls (`windEnabled`, `windStrength`, `windNoiseScale`) with `windPanelOpen`, and three grass controls (`grassEnabled`, `grassDensity`, `grassHeight`) with `grassPanelOpen` — all persisted to localStorage by `ui.js`. `grassDensity` and `grassHeight` are internal multipliers (× biome stock, × blade geometry height); the settings sliders rebase the display so 100% on the slider corresponds to `DENSITY_BASE = 2.0` / `HEIGHT_BASE = 1.2` in those internal units.
- **`src/seed.js`** — `mulberry32`, `parseSeed`/`formatSeed`, `readSeedFromUrl`/`writeSeedToUrl`, `newRandomSeed({excludeBiomeId, allowedBiomeIds})`. Seeds are 16-bit hex (e.g. `0x3f2a`).
- **`src/biomes.js`** — the `BIOMES` config table (currently twelve entries) plus `WILDFLOWER_PALETTES` / `GRASS_DENSITY` / `FLOWER_DENSITY` / `PEBBLE_DENSITY` overrides. Each biome fully specifies palette, fog, accent/sun colors, allowed flora kinds + count, particle type, creature color palette + count range, plus optional dusk/night palette deltas. Optional flags (`water`, `cloudlike`, `glowFlowers`, `glowEyes`, `furProbability`, `creatureKind`) gate cross-cutting behavior — see "Biome-flag pattern" below. Adding visual variety usually means editing this table, not the builders.
- **`src/terrain.js`** — `makeHeightFn(noise2D, layout, amp)` returns a `(x,z) => y` closure combining three simplex-noise octaves with a per-center smoothstep falloff (`islandFalloff`) so each island has a defined edge that plunges into void past its radius. `makeTerrain` bakes that into a vertex-colored `PlaneGeometry`. `pickLayout()` and `pickGroundPoint(maxRadiusFrac)` / `nearestCenter(x,z)` live here.
- **`src/flora.js`** — `FLORA_BUILDERS` is a `{ kind: (biome) => THREE.Group }` registry; biomes reference these by string from their `flora` array. `jitterGeo` is the shared helper that welds an `IcosahedronGeometry`'s duplicate vertices via `mergeVertices` (after stripping UVs/normals so the merge works) and perturbs positions for a hand-modeled look. `resetFloraPool()` is called at the top of every regen since the previous-world materials/geometries were just disposed.
- **`src/fauna.js`** — barrel re-export of the per-entity modules under `src/fauna/`: `creature.js`, `caterpillar.js`, `butterfly.js`, `bee.js`, plus `shared.js` for cross-entity helpers (`WATER_AVOID_Y`, `avoidObstacles`, `colorsClose`). Each module exports its `makeX` / `stepX` pair and returns `{ group, …state }` with no base class; the animation loop iterates parallel arrays on `state`. Consumers always import from `./fauna.js`, never the per-entity files.
- **`src/birds.js`** — `makeFlock(biome)` + `stepFlock(flock, dt, t)`.
- **`src/grass.js`** — `makeGrassField` (instanced grass-blade rendering with per-biome density / baldness). Re-exported from `environment.js` for backward compatibility, so callers can keep importing it from there. The field pre-allocates `MAX_DENSITY_MULTIPLIER × biome stock` slots so the user's density slider can raise `mesh.count` past 100% without a regen; `state.grass = { mesh, uniforms, stockCount, maxPlaced }` exposes the bounds the UI clamps to. The shader has three runtime control points beyond the existing wind sway: `uHeightMul` (multiplies `transformed.y` for the height slider), `uPushers[MAX_PUSHERS]` + `uPusherCount` (creature → grass bend, see "Grass push system" below), and `uWindStrength` / `uWindScale` (live multipliers driven by the wind panel; freezing wind also stops `state.windUniforms.uTime` from advancing in `main.js`).
- **`src/environment.js`** — particles, instanced ground cover (`makeWildflowerField` / `makePebbleField`, both built on a shared `placeInstanced`), `makeWaterPlane`, footstep dust kicks (`makeDustKick` / `stepDustKicks`), and their per-frame `stepX` updaters. Also re-exports `makeGrassField` from `src/grass.js`. Particles use a single `ShaderMaterial` with per-kind `#define PARTICLE_KIND` and per-particle `aSeed`/`aLife` attributes so ember/spark fade with life, rain reads as streaks, firefly twinkles per-particle. Wildflowers return positions for butterflies to target via `state.flowerSpots`. The water material's `onBeforeCompile` is patched to sample `state.waterReflection.rt` and Fresnel-mix it into the surface color.
- **`src/sky.js`** — backdrop primitives: gradient sky dome, two-layer wobbled mountain ring, drifting cloud sprites, twinkling starfield, aurora curtains for cold/dreamy biomes, and `makeCloudSwirl` — a torus halo of shader-swirled clouds for the cloudlike biome. `updateSkyColors` re-tints the dome and mountains from the day/night palette; star/aurora opacity is driven by the night factor each frame. Per-biome cloud counts and aurora opt-ins live in the `CLOUD_COUNT` / `AURORA_BIOMES` / `AURORA_TINTS` tables in `biomes.js`.
- **`src/world.js`** — `generateWorld(seed)`, the orchestrator. Disposes the previous `state.world`, picks biome + layout deterministically, builds atmosphere → lights → terrain → optional water → flora → ground cover → creatures → birds → particles, writes HUD stats and the seed back to the URL. Also exports `updateDayNight(t)` (the day/night color/sun lerp called from `animate`) and the `setSceneRef` / `setControlsRef` / `setFollowReleaseCallback` wiring used by `main.js`.
- **`src/ui.js`** — all DOM wiring against the static HUD in `index.html`: settings panel (atmosphere, camera, share, wind, grass, fx, auto-regenerate), help panel, photo mode (P/S keys, save-to-png, freeze the sim), first-person stroll mode (F/WASD/mouse-look — eye height `groundY + 1.9` clears tall grass; `main.js` wakes any sleeper within ~2.5 units of the player while strolling), follow mode (raycaster-based creature pick from `state.creatures` + `state.caterpillars`; **empty-space clicks during selection mode are ignored** so the user can drag the camera without cancelling), spacebar manual pause, R/r regenerate, biome filter chips, bookmarks, copy-link, auto-regenerate timer, regen button. `generateWorld` calls `setFollowTarget(null)` on regen so a stale ref doesn't survive `disposeGroup`. Exports `isPhotoMode()`, `isSelectingCreature()`, and `isManualPaused()` for the animation loop to OR together — see "Sim pause" below. Wind and grass panels install `state._reapplyWindSettings` / `state._reapplyGrassSettings` hooks; the seed-watcher interval invokes them after every regen so live slider values survive across worlds (each regen rebuilds `state.grass.uniforms` from scratch).
- **`src/postfx.js`** — `initPostFX(renderer, scene, camera)` builds an `EffectComposer` chain (RenderPass → bloom composite → combined depth-FX pass → tilt-shift pass → custom sRGB-only output) and a **separate depth pre-pass RT** outside the composer's ping-pong. A second full-physical-resolution `bloomComposer` (layer-filtered scene render → separable 9-tap Gaussian H → V) feeds its output into the composite pass. The pre-pass renders the scene into `depthRT` (with an attached `DepthTexture`) before `composer.render()`, only when some depth-using FX is enabled. Keeping the depth attachment off the composer's own ping-pong RTs avoids a WebGL feedback loop (sampling a depth texture while writing to the FBO that owns it gives undefined/all-black output). The `depthTexture` is exposed on `state` for depth-based post-processing passes.
  - Bloom is layer-gated, not luminance-gated. Meshes that should glow call `mesh.layers.enable(BLOOM_LAYER)` at construction (glow eyes, glow flowers, crystal cores, lantern orbs, obsidian shards). The bloom render path saves the camera's layer mask, sets `cam.layers.set(BLOOM_LAYER)`, sets `renderer.autoClearDepth = false`, then renders into a **full-resolution HalfFloat** RT that **shares its depth attachment with the depth pre-pass's `depthTexture`** — emissives behind opaque geometry get culled naturally by depthTest against the preserved scene depth (a glow eye behind a tree doesn't shine through). `HalfFloatType` (the EffectComposer default) gives the halo HDR headroom — bright emissive materials >1.0 linear contribute to bloom in proportion to their true brightness — and 16-bit precision eliminates the 8-bit banding seen in soft falloffs with UnsignedByte. Bloom adds itself to `needsDepth()` so the pre-pass runs even when no other depth-FX is enabled. EffectComposer clones the supplied RT for its ping-pong RT2, which would clone the depth attachment too — `initPostFX` disposes that orphan and re-points RT2's `depthTexture` at the shared instance. A **multi-pass separable 5-tap linear-sampling Gaussian** (up to `BLOOM_MAX_PAIRS = 8` H+V pairs, each with `depthTest`/`depthWrite` disabled on the blur quads so the fullscreen blits always rasterize) blurs the result — each tap pairs two Gaussian samples by reading at their bilinear-weighted midpoint, so 5 fetches produce the same shape as a 9-tap kernel. Stacking N H+V pairs convolves to effective σ ≈ √N × σ_base. The bloom radius slider (`bloomRadius` in `userSettings`, 0–300%) calls `applyBloomRadiusSetting` which keeps per-pass radius ≤ 1 (the safe no-gap zone for the 5-tap kernel): 0–100% scales per-pass radius on the `BLOOM_BASE_PAIRS = 3` active pairs, and 100–300% pins per-pass radius at 1 and enables more pairs (up to `BLOOM_MAX_PAIRS`). Unused pairs are `enabled = false` so EffectComposer skips them — there's never a pointillist sample-grid because no individual pass ever runs with gappy taps. The shared `uRadius` uniform is re-pointed into each pass after construction (ShaderPass deep-clones uniforms via `UniformsUtils.clone`). The composite pass additively blends with strength `BLOOM_COMPOSITE_STRENGTH`; when bloom is off, the composite is `enabled = false` so the composer skips it (the bloom composer is also skipped in the render() body). The custom bloom RT pins `EffectComposer._pixelRatio = 1`, so `onResize` must multiply by `renderer.getPixelRatio()` itself when sizing the RT and the blur shaders' `uResolution`.
  - Tilt-shift is a **hybrid screen-Y band + depth-from-focus** blur. Blur radius is `max(bandMask, depthMask) * uBlurAmount`. `uFocus` (screen-Y of sharp band) and `uFocusZ` (view-space distance to the orbit target) are both updated each frame in `main.js`. The 9-tap rotational disc blur sums weights to exactly 1.0 and accumulates in **gamma-2.0 perceptual space** (`sqrt` encode each tap, square-decode the result) — linear-HDR blur lifts dark-on-light edges and reads as wash-out; gamma-space blur preserves perceived saturation.
  - The combined depth-FX pass runs three depth-driven effects in one fullscreen quad: sobel-on-linear-depth outlines (skipped on the sky/far-plane), 6-tap hex-ring contact AO, and painterly far-field fog (smoothstep mix toward the biome's fog color set by `world.js` on every regen). Each effect has its own `uXStrength` uniform that drops to 0 when its FX-panel checkbox is off; the pass auto-disables when all three are 0.
  - The custom sRGB output pass only does the linear → sRGB gamma encode (the renderer's tone mapping runs implicitly on the final canvas blit). Using three's standard `OutputPass` would apply ACES a second time and crush very dark biomes (obsidian, ashen) to pure black.
  - Returns a stub under `LOWFX` (no composer, no depth pre-pass, `state.depthTexture = null`). Skipped entirely in inspect mode — `main.js` calls `renderer.render(scene, camera)` directly there because the composer's neutral-gray studio backdrop would tonemap to black.
- **`src/fur.js`** — `applyShellFur(body, biome, opts)` adds N shells (8 / LOWFX 4) as children of a target mesh, sharing its geometry. Each shell uses a cloned `ShaderMaterial` differing only by `uShellLayer`. Vertex shader displaces along normal; fragment shader uses a 3D point hash on object-space cells to discard non-hair pixels. `sharedFurUniforms.uLightDir` is updated once per frame in `main.js`. Returns `null` under LOWFX. Each walker creature and (non-snail) caterpillar rolls `Math.random() < biome.furProbability` independently inside `generateWorld`'s seeded RNG window, so the same seed reproduces the same fuzzy/smooth mix; `furProbability` defaults to 0 when unset. Fur shells are children of the body mesh and inherit its squash on sleepers — they stay rendered, just compressed.
- **`src/shadows.js`** — `makeShadowDisks(biome)` builds a single `InstancedMesh` of soft circular gradient discs (cap = creatures + caterpillars + slack). `stepShadowDisks` updates each instance matrix per frame from `state.creatures` then `state.caterpillars`. Fliers cast a smaller disc that shrinks with `currentHover`; unused slots get a zero-scale matrix.
- **`src/reflection.js`** — `makeWaterReflection(biome)` builds a sky-only reflection scene by cloning `state.skyDome` / `state.starfield` / `state.aurora` with shared materials so day/night uniform updates flow through automatically. `updateWaterReflection` mirrors the main camera across y=0 and renders into a 256×256 (or 128×128 under LOWFX) render target each frame BEFORE the main render. Constructed only on biomes with `water` set. The RT is disposed at the top of `generateWorld` (it's not in `state.world` so `disposeGroup` doesn't reach it).
- **`src/inspect.js`** — `?inspect=1` URL gate. Replaces normal world-gen with a single specimen on a neutral studio backdrop (gradient dome + turntable disc + hemisphere/key/rim lights). Inspect cycles a **category** axis (`creature` ↔ `flora`) with `k`, and within each category cycles **variant** (`,`/`.`) — creatures: walker/flier/sleeper/burrower/caterpillar/snail; flora: every entry in `FLORA_BUILDERS` plus single-instance stand-ins for `wildflower` / `grassblade` / `pebble` / `water`. Also: biome (`[`/`]`), reroll seed (`r`), pause (Space), and frame-step bidirectionally (`←`/`→`, also rewinds integrated `c.bob` / `c.age` for creatures). URL params (`category`, `biome`, `variant`, `seed`, `paused`) are parsed at boot and written back via `history.replaceState` on every state change so the address bar always reflects the exact view.
- **`src/lowfx.js`** — `LOWFX` boolean (true on touch / small-screen / low DPR devices, or `?lowfx=1` URL param) and `LOWFX_DENSITY` multiplier. Honor both when adding new instanced fields or particle-heavy effects; `main.js` also caps `setPixelRatio` at 1 when `LOWFX` is set. Fur, post-FX, and the reflection RT are all gated to off (or smaller) under LOWFX.
- **`src/util.js`** — shared helpers: `jitterGeo` (geometry weld + perturb), `applyWindSway` (see "Wind sway" below — patched to preserve any previously-installed `onBeforeCompile`), `randInt`, and the `TRUNK` color constant.

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

The grass field in `grass.js` has its own self-contained wind shader (not via `applyWindSway`) with per-blade noise gusts and a swirling bend direction; its `uWindStrength` and `uWindScale` are live-multiplied by the settings panel via `state._reapplyWindSettings`. Disabling wind from the settings panel **freezes `state.windUniforms.uTime` advancement in `main.js`** (so applyWindSway-driven foliage settles to a still pose) AND zeros the grass `uWindStrength` (so its noise-based bend goes flat). The combination is what makes "wind off" actually look still.

### Grass push system

The grass shader runs a small **creature → blade bend** pass each frame, after wind and before the distance fade. Up to `MAX_PUSHERS` (currently 40, in both the JS const and the GLSL `#define`) circular pushers are written from `stepGrass` and consumed in the vertex stage:

- Each pusher is a `vec4 (worldX, worldZ, radius, strength)`. The shader tests each blade vertex against every active pusher (early-out on `radius < 0.001`), applies a `(1 − d/r)²` falloff, weights by `aTipFactor²` so roots stay anchored, and adds a radial bend outward from the pusher center plus a small Y dip so trampled grass reads as flattened rather than just splayed.
- `stepGrass` populates the array from `state.creatures` (skipping airborne fliers via `c.flies && c.landState !== "landed"`) and every segment of every caterpillar. Creature positions are mesh-local (under `state.world`); `stepGrass` multiplies by `worldScale` so the comparison happens in the shader's world-XZ frame.
- **Slot sizing matters.** Smaller than the entity count and creatures past the cap appear to "toggle" bending on and off as fliers take off / land and free up slots. 40 covers the worst-case biome (~18 walkers + ~5 caterpillars × up to 4 segments).
- **Bend direction is computed in world space, but applied to mesh-local `transformed.x/.z`.** Each blade instance has a random Y yaw in its `instanceMatrix`, so a world-space push has to be inverse-rotated through the instance's XZ basis before it can be added to `transformed`. The shader does this with `dot(axW, pushWorld) * invXZScaleSq` (and the same `axW`/`azW` for wind). Without this, every blade applies the bend along its own rotated local-X and the field reads as random instead of coherent. Any new world-space displacement on the grass needs the same treatment.

### Live grass density

The density slider operates on `mesh.count` of the existing `InstancedMesh` — no rebuild, no regen. `makeGrassField` over-allocates slots up to `MAX_DENSITY_MULTIPLIER × biome stock` and stores both bounds on `state.grass` as `stockCount` (slider = 100%) and `maxPlaced` (slider = max). `applyGrassSettings` in `ui.js` computes `mesh.count = clamp(0, maxPlaced, round(stockCount × grassDensity))` and updates the `uHeightMul` uniform. Per-instance attributes (`aWindSeed`, `instanceColor`) are sized to `maxPlaced` so increasing density at runtime still has valid data behind the new visible blades. The grass-enabled toggle just forces `mesh.count = 0` while leaving `grassDensity` untouched, so re-enabling restores the previous look exactly.

### Day/night cycle

`updateDayNight(t)` lerps the scene's sky/fog/sun/hemi colors between the current biome's palette (snapshotted into `dayNight` at world build) and a generic `NIGHT_*` palette, and arcs the sun across the sky. Driven by either `userSettings.autoCycle` (a 120s cycle) or `userSettings.manualDayFactor` (settings-panel slider). Fog density is also scaled by `userSettings.fogMultiplier`.

### Biome-flag pattern

Several per-biome behaviors are gated by optional flags rather than hardcoded biome ids. When adding a new per-biome behavior, prefer a flag over `if (biome.id === ...)`:

- `water` (color) — adds a translucent water plane.
- `cloudlike` — `makeIslandUnderside` perturbs more vertices for a puffball silhouette, and `makeCloudSwirl` (`sky.js`) adds a torus halo of shader-driven swirling clouds around the island. The swirl shader runs two-octave value noise scrolled in opposing directions plus a low-frequency UV warp; alpha tapers to 0 at the torus poles so the band has soft top/bottom edges. Time uniform is shared with `state.windUniforms.uTime`, so no dedicated per-frame step is needed.
- `glowFlowers` — wildflower instances get an emissive material.
- `glowEyes` — creature pupils render emissive in the accent color.
- `furProbability` (0..1) — per-creature fur roll. Each walker (non-flier, non-fish) and each non-snail caterpillar independently rolls `Math.random() < furProbability` at build time, so the same biome can mix fuzzy and smooth creatures. Defaults to 0 when unset.
- `creatureKind: "fish"` — `makeCreature` builds a non-landing flier with fin-like ears and a tail fin instead of wings; gentle fin sway in `stepCreature`.

### Sim pause

The animation loop in `main.js` derives a single `paused` boolean from `isPhotoMode() || isSelectingCreature() || isManualPaused()`. When `paused`, the loop holds `dt` at 0 and freezes the simulation time `t` at `state.lastSimT` — every `stepX` uses `sin(t * speed)`-style idle bobbing, so unfreezing `dt` alone is not enough (animations would still drift). Camera input and rendering keep running on the frozen state. Selection mode is paused so users can click on an otherwise-moving target; spacebar toggles `_manualPause` (suppressed while stroll/photo/selection are already paused, to keep their own exit semantics clean). The `#pause-banner` element shows "paused · press space to resume" while manual pause is on.

### Follow anchor (caterpillar gotcha)

Regular creatures store their position on `c.group.position` — the group transform is what moves. **Caterpillars and snails are the exception**: their group stays at the origin and the head + body segment *meshes* inside it are what get repositioned (so the trail-following code can work in world space). `main.js`'s follow camera therefore reads `(ft.segments ? ft.segments[0] : ft.group).position` — if you add a new follow-tracked entity that uses the caterpillar pattern (segments instead of a moving group), give it a `segments` array so the camera finds the head.

The caterpillar head mirrors the walker terrain-tilt pattern (`stepCreature`'s slope sampling): four `heightFn` samples around the head along heading × perpendicular, then eased pitch/roll into `head.rotation.x`/`.z`. `makeCaterpillar` sets `head.rotation.order = "YXZ"` once at construction so the pitch/roll resolve in the body frame after yaw — without that, a heading-changed caterpillar would roll around world-X. The idle nodding bob is folded into the pitch target so it stacks on top of the slope rather than overwriting it.

Yaw is slewed, not snapped. `c.heading` is the actual direction (used for movement, slope sampling, and visual yaw); `c.headingTarget` is the aim. Random thinks and edge avoidance write `headingTarget`; each frame `c.heading` rotates toward it at `c.turnRate` rad/s (caterpillar 3.0, snail 2.0) via shortest-angle diff. Obstacle slides snap both `heading` and `headingTarget` to `slide.heading` because the slide's `nx, nz` is already deflected and the values must match this frame. Any new logic that re-aims a caterpillar should set `headingTarget`, not `heading`, unless it also commits to a same-frame position change.

### Flier landing system

`makeCreature(flies=true)` creatures have a four-state landing FSM in `stepCreature`: `flying ↔ descending ↔ landed ↔ ascending`. The `landTimer` plus `c.currentHover` (lerping between `hoverCeil = hoverHeight*(1-0.7*sleepiness)` and `restH = 0.35*scale`) drive transitions. Three cross-cutting safeguards:

- **Water:** while `state.waterMesh && heightFn(pos.x, pos.z) < WATER_AVOID_Y`, the FSM is forced to `flying` (and `perchTarget` cleared). Sleepy-driven descents are also blocked over water so a drowsy flier won't ditch mid-lake.
- **Obstacles:** `avoidObstacles` accepts an optional `y` argument. Walkers pass `undefined` (full collision); fliers pass `pos.y` and obstacles with `top + 0.15 < y` are skipped — so a flier above the canopy can pass straight over a tree. It also accepts `skipX, skipZ` to ignore one specific obstacle (the perch's own mushroom).
- **Mushroom perches:** on `flying → descending`, `pickPerchForFlier(c)` rolls 55% chance to pick the nearest `state.perchSpots` entry within 6 units. If picked, the flier's heading is steered toward the perch (jitter from the random think is skipped while homing), speed is scaled down close in, `targetH` holds an approach altitude until xz < 1 unit, and the final `landed` commit requires xz² < 0.16. The `pos.y` floor is a smoothstep blend between `ground` and `perchTarget.y + perchLift` over a 0.5–4 unit XZ window, with `c.perchFloorWeight` low-pass filtering the blend factor so the rate of change is capped (jump-free approach AND takeoff). `perchTarget` persists through ascent and is cleared lazily once the floor weight has decayed back to ~0. The `perchLift` is **negative** (`-0.04 * c.scale`) — the body's half-Y is slightly larger than `restH`, so a small downward bias keeps the contact convincing instead of floating above the cap.

Mushroom builders attach `g.userData.capTopY` to expose the actual local cap-top Y; `world.js` uses `f.position.y + capTopY * scale` for the perch world-Y rather than the looser per-kind `OBSTACLE_TOP` table (which only needs to be approximate for the air-passing filter).

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

- **Runtime deps via npm.** three.js and simplex-noise are installed locally (`package.json`) and bundled/tree-shaken by Vite at build time. No CDN importmap needed. The `vite.config.js` configures minification, content hashing, and the dev server.
- **Adding a biome:** append to `BIOMES`. If a new flora kind is needed, add it to `FLORA_BUILDERS` first; the biome's `flora` array references it by string. Also extend the per-biome `WILDFLOWER_PALETTES` / `GRASS_DENSITY` / `FLOWER_DENSITY` / `PEBBLE_DENSITY` tables (they fall back to defaults via `??` but tuned values look better).
- **Adding a creature type:** follow the existing `makeX` + `stepX` split and push to the corresponding array inside `generateWorld`, then call its `stepX` from `animate()`.
- **Cross-cutting per-biome behavior:** add a flag on the biome (see "Biome-flag pattern" above) and check it in the relevant builder, rather than branching on `biome.id`.
- **Placement:** use `pickGroundPoint()` rather than raw XZ randomness so multi-island layouts work.
- **Disposal:** `disposeGroup` walks geometries/materials when the world is rebuilt. New mesh-allocating code that lives on the `world` group is covered automatically; new top-level scene additions are not.
- **Devtools handle:** `main.js` exposes `window.__sw = { state, controls, scene, camera, renderer }` for inspection from browser devtools. It's never read by the app itself — safe to leave, safe to remove. Useful for reading live uniform values, manipulating `state.grass.uniforms.uPushers`, or programmatically setting up tricky camera angles.

## Enhancement workflow

`ideas.md` is a running enhancement list, organized by category and tagged S/M/L. The convention at the top of that file: **implement the item, remove it from `ideas.md`, then commit and push** so the live GitHub Pages site reflects the work.
