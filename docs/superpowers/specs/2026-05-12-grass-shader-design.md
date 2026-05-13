# Grass Shader: Adaptive Density, Procedural Wind, Patchy Placement

**Status:** Spec — awaiting user review before plan
**Date:** 2026-05-12

## Goal

Replace the current grass field with a custom-shaded `InstancedMesh` that supports (a) higher effective density via per-blade distance fade, (b) per-blade wind sway driven by traveling 2D noise gusts so neighbors don't move in lockstep, and (c) patchy, clumped placement with bald spots, sampled from a separate density noise at world XZ.

## Non-goals

- No tessellation or dynamic blade subdivision per-distance. Vertex count per blade stays at 3 segments.
- No grass interactions with creatures (no trampling, no bend-around).
- No texture-based wind. Wind is analytic 2D value noise computed in the vertex shader.
- Wildflowers, trees, and other flora keep using the existing `applyWindSway` patch — only grass gets the new shader.
- The inspect-mode `grassblade` single-blade stand-in stays static for now. Polishing it can be a follow-up item.

## Architecture

### New module `src/grass.js`

Pulls grass out of `environment.js`, which today mixes grass / wildflowers / pebbles / water / particles / dust. Single-purpose module, smaller files to reason about.

Public surface:

```js
// src/grass.js
export function makeGrassField(biome, heightFn);  // returns InstancedMesh
export function stepGrass(camera);                 // per-frame uniform update
```

`environment.js` adds `export { makeGrassField } from "./grass.js"` so `world.js`'s import path keeps working unchanged.

### State

`src/state.js` gains:

```js
grass: null,   // { mesh, uniforms } once built, null otherwise
```

`world.js` clears `state.grass = null` at the top of `generateWorld` alongside the other refs, and assigns it after `makeGrassField` succeeds. The mesh itself is parented to `state.world`, so `disposeGroup` handles GPU teardown automatically.

### Per-frame wiring

`main.js` adds one call inside `animate()`:

```js
state.windUniforms.uTime.value = t;   // existing
stepGrass(camera);                     // new
```

`stepGrass` reads `camera.position.x` / `.z` into the grass field's `uCameraXZ` uniform. No-op if `state.grass` is null.

## Shader

### Base material

`MeshStandardMaterial` patched via `onBeforeCompile`. Keeps scene lighting, fog, shadows, and the existing tip-color injection. Not a raw `ShaderMaterial`.

### Vertex attributes

- `aTipFactor` — existing, 0 at blade base → 1 at tip.
- `aWindSeed` — new per-instance float ∈ [0, 1), one value per blade, packed at build time as an `InstancedBufferAttribute`. Gives near-collocated blades distinct amplitude jitter so they don't lock-step inside a gust.

### Uniforms

| Name           | Type   | Source                                           |
|----------------|--------|--------------------------------------------------|
| `uTime`        | float  | shared with `state.windUniforms.uTime`           |
| `uWindScale`   | float  | constant ~0.15 (gust wavelength ≈ 6 world units) |
| `uWindSpeed`   | float  | constant ~0.6 (units/sec gusts travel)           |
| `uWindDir`     | vec2   | per-world deterministic random unit vector       |
| `uWindStrength`| float  | constant ~1.2 (LOWFX ~0.8)                       |
| `uCameraXZ`    | vec2   | updated per frame by `stepGrass`                 |
| `uFadeStart`   | float  | 18 (LOWFX 12)                                    |
| `uFadeEnd`     | float  | 28 (LOWFX 18)                                    |
| `uTipColor`    | vec3   | existing                                         |

### Noise function (vertex, GLSL)

Value-noise, ~15 lines, no asset:

```glsl
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i),             hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
```

### Vertex transform (injected at `<begin_vertex>`)

1. Compute `worldXZ` from `modelMatrix * instanceMatrix * vec4(transformed, 1.0)`.
2. Sample two octaves:
   - `a = vnoise(worldXZ * uWindScale - uTime * uWindSpeed * uWindDir)`
   - `b = vnoise(worldXZ * uWindScale * 2.3 - uTime * uWindSpeed * uWindDir * 1.7)`
   - `gust = 0.7 * a + 0.3 * b` ∈ ~[0, 1]
3. Bend direction = `uWindDir` rotated by `(gust - 0.5) * 0.6` radians — gusts swirl rather than march straight.
4. Bend amount = `aTipFactor² * uWindStrength * gust * (0.75 + 0.5 * aWindSeed)`. Squared tip factor anchors the base; `aWindSeed` decouples near-neighbors.
5. Apply offset to `transformed.xz` along the rotated bend direction.

### Distance fade (the adaptive part)

```glsl
float dist = length(worldXZ - uCameraXZ);
float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
transformed.y *= fade;        // blade collapses to its base past uFadeEnd
// also scale the bend offset by `fade` so collapsing blades don't flail
```

Past `uFadeEnd`, the tip sits on the ground and the rasterizer skips most of the blade.

### Fragment shader

Unchanged from today. Same `uTipColor` mix on `aTipFactor`. Shader work is entirely vertex-side.

## Placement

### CPU-side noise (deterministic, inside `generateWorld`)

Two `simplex-noise` `createNoise2D` instances, each seeded off the world seed:

- **Density mask:** `densityNoise(x * 0.18, z * 0.18)` ∈ [0, 1]. Below per-biome threshold → reject (bald spot). Default threshold `0.32`, with per-biome overrides via a new `BALD_THRESHOLD[biome.id]` table in `biomes.js`. Scale 0.18 → patches roughly 3–6 world units across.
- **Clump height:** `clumpNoise(x * 0.35, z * 0.35)` ∈ [0, 1]. Multiplies blade height: `instanceScale.y = baseRand * (0.55 + 0.9 * clumpNoise)`. Lush patches → taller blades; thin patches → stubbier.

Both noise instances are constructed *inside* the seeded `Math.random` window of `generateWorld` so the patchwork reproduces from the seed alone.

### Count budget

- Today: `count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, 2.8)`.
- New: candidate count = `floor(today × 2.5)`. After ~35–50% rejection from the density mask, actual placed count ≈ `today × 1.5`.
- Overshoot factor `2.5` lives in `grass.js` as a constant — biome `GRASS_DENSITY` values are *not* retuned, keeping them anchored to `DENSITY_BASE = 38` per CLAUDE.md.
- `LOWFX`: overshoot factor → `1.6`; total post-rejection count roughly matches today's LOWFX count.

### Per-instance attributes at build time

| Attribute        | Source                                                |
|------------------|--------------------------------------------------------|
| `instanceMatrix` | position via `pickGroundPoint`, rotation, scale.y absorbs clump noise |
| `instanceColor`  | existing per-blade hue jitter, kept as-is              |
| `aWindSeed`      | new `Float32Array(count)`, one random per blade        |

No per-frame placement work. Build once.

## Day/night, photo, follow, first-person modes

- Day/night: `MeshStandardMaterial` so existing `updateDayNight` light/fog/sun updates flow through automatically. No grass-specific palette wiring.
- Photo mode: simulation freeze still applies (no `uTime` advance), so the field freezes mid-gust. Expected.
- Follow mode: camera moves with the followed creature → `uCameraXZ` tracks → dense band follows. Free.
- First-person stroll: camera close to ground → fade band reveals blades around the player as expected.

## Inspect mode

Inspect mode doesn't call `makeGrassField` (it builds its own stand-ins for category=flora variants). The single-blade `grassblade` stand-in in `inspect.js` stays untouched. No code path change required there.

## LOWFX summary

| Tunable          | Normal | LOWFX  |
|------------------|--------|--------|
| Overshoot factor | 2.5    | 1.6    |
| `uFadeStart`     | 18     | 12     |
| `uFadeEnd`       | 28     | 18     |
| `uWindStrength`  | 1.2    | 0.8    |

Shader is identical in both — only uniforms differ. No branching at compile time.

## Files touched

- `src/grass.js` — new
- `src/environment.js` — remove `makeGrassField` body, add re-export
- `src/state.js` — add `grass: null`
- `src/world.js` — clear/set `state.grass`, no other changes
- `main.js` — call `stepGrass(camera)` in `animate()`
- `src/biomes.js` — add optional `BALD_THRESHOLD` table with sparse defaults

## Verification

This project has no test suite. Verification is visual, performed via `agentchrome` against a running `make start` instance:

1. **Cross-biome regen check** — regen 5 distinct biomes (verdant, meadow, dunes, ashen, plus one cold), confirm: bald patches and clumps are visually present, wind moves blades non-uniformly across the field, distant blades collapse near the fade band.
2. **Seed determinism** — same seed → same patchwork. Reload at the same `?seed=` URL, expect identical bald-spot layout.
3. **LOWFX** — load with `?lowfx=1`, confirm reduced count and softer wind, fade band closes in.
4. **Follow mode** — enter follow mode (`F` then click a creature), confirm the dense band tracks the camera.
5. **Photo mode** — press `P` (freeze), confirm field freezes mid-sway.
6. **FPS** — rough informal frame-rate check before/after on a verdant biome (the densest case). Goal: not worse than today on a 2x-target overshoot.

## Open risks

- Two `simplex-noise` instances inside the seeded window: confirm `createNoise2D` accepts a custom RNG (or seed via `Math.random` which is already monkey-patched). The existing terrain noise path is the precedent here — match it.
- `uWindDir` deterministic random: must be drawn from `Math.random` inside the seeded window so it reproduces from the seed.
- `aWindSeed` per-instance buffer adds ~`count * 4` bytes of GPU memory. At 1.5× current count this is bounded — single-digit KB total.
