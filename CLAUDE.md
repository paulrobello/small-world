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

There are no tests, no linter, no build. Edits to `main.js` / `style.css` / `index.html` are picked up on browser reload — the server sends `Cache-Control: no-store` so a normal refresh is enough.

## Architecture

Everything client-side lives in `main.js` (~2000 lines, single module). The file is organized top-to-bottom in the order it executes; section dividers (`// ──`) mark logical regions:

1. **Seeded PRNG + URL plumbing** — `mulberry32`, `parseSeed`/`formatSeed`, `readSeedFromUrl`/`writeSeedToUrl`. Seeds are 16-bit hex (e.g. `0x3f2a`).
2. **`BIOMES`** — the six-entry config table. Each entry fully specifies a biome's palette, fog, accent/sun colors, allowed flora kinds + count, particle type, and creature color palette + count range. Adding visual variety usually means editing this table, not the builders.
3. **Renderer / scene / camera / OrbitControls** — module-scope singletons. `autoRotate` is on by default.
4. **Terrain** — `makeHeightFn` returns a `(x,z) => y` closure combining three simplex-noise octaves with a smoothstep radial falloff so the island has a defined edge that plunges into void past `ISLAND_RADIUS`. `makeTerrain` bakes that into a vertex-colored `PlaneGeometry`; `makeIslandUnderside` is the craggy inverted cone beneath.
5. **Flora builders** — `FLORA_BUILDERS` is a `{ kind: (biome) => THREE.Group }` registry (`tree`, `pine`, `cactus`, `mushroom`, `fern`, `reed`, `grass`, `deadtree`, `rock`, `skull`). Biomes reference these by string from their `flora` array. `jitterGeo` is the shared helper that welds an `IcosahedronGeometry`'s duplicate vertices via `mergeVertices` (after stripping UVs/normals so the merge works) and perturbs positions for a hand-modeled look.
6. **Creatures / caterpillars / butterflies / birds** — each entity has a `makeX(biome)` constructor returning `{ group, …state }` and a separate `stepX(entity, dt, t, …)` updater. They share no base class; the animation loop just iterates four parallel arrays.
7. **Instanced ground cover** — `placeInstanced` is the shared helper used by `makeGrassField` / `makeWildflowerField` / `makePebbleField`. Wildflowers return positions for butterflies to target via `flowerSpots`.
8. **`generateWorld(seed)`** — the orchestrator. Disposes the previous `world` group, picks a biome from the seed, builds terrain → flora → creatures → birds → particles, updates the HUD, and writes the seed back to the URL.
9. **`animate()`** — `requestAnimationFrame` loop that fans out to each `stepX`.

### The determinism trick (important when touching world-gen)

`generateWorld` monkey-patches `Math.random = mulberry32(seed)` for the duration of world construction, then restores the original. Every `Math.random()` call inside builders therefore reproduces from the seed, but per-frame `stepX` updaters (which run after the restore) keep natural variation. **If you add new world-gen code that needs to be deterministic, it must run synchronously inside `generateWorld` before `Math.random` is restored.** Async work, timers, or anything triggered by user interaction will use the real `Math.random`.

### Seed → biome coupling

The biome is picked by the first `Math.random()` call inside `generateWorld`, so the seed alone identifies the entire world. `newRandomSeed(excludeBiomeId)` rerolls up to 24 times to avoid landing on the same biome twice in a row when the user clicks regenerate.

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
- **Adding a biome:** append to `BIOMES`. If a new flora kind is needed, add it to `FLORA_BUILDERS` first; the biome's `flora` array references it by string.
- **Adding a creature type:** follow the existing `makeX` + `stepX` split and push to the corresponding array inside `generateWorld`, then call its `stepX` from `animate()`.
- **Disposal:** `disposeGroup` walks geometries/materials when the world is rebuilt. New mesh-allocating code that lives on the `world` group is covered automatically; new top-level scene additions are not.
