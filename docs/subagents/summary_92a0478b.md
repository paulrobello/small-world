# Small-World Engine/Shader/Render Audit Report

**Date:** 2026-05-16  
**Scope:** 11 source files, ~192KB total — full codebase audit of all engine, shader, and render patterns.

---

## Table of Contents
1. [main.js — Render Loop & Pipeline Orchestrator](#1-mainjs)
2. [src/postfx.js — Post-FX Pipeline](#2-srcpostfxjs)
3. [src/grass.js — Instanced Grass System](#3-srcgrassjs)
4. [src/environment.js — Particles, Ground Cover, Water, Ground Marks](#4-srcenvironmentjs)
5. [src/reflection.js — Water Reflection](#5-srcreflectionjs)
6. [src/fur.js — Shell Textured Fur](#6-srcfurjs)
7. [src/util.js — Shared Utilities](#7-srcutiljs)
8. [src/sky.js — Sky Dome, Mountains, Clouds, Stars, Aurora, Cloud Swirl, Edge Mist](#8-srcskyjs)
9. [src/shadows.js — Shadow Disk System](#9-srcshadowsjs)
10. [src/terrain.js — Terrain Generation](#10-srcterrainjs)
11. [src/pool.js — Resource Pool Factory](#11-srcpooljs)
12. [src/state.js — Global State (referenced throughout)](#12-srcstatejs)
13. [src/lowfx.js — Low-FX Mode](#13-srclowfxjs)
14. [Cross-Cutting Patterns](#14-cross-cutting-patterns)

---

## 1. main.js

### Render Configuration
| Setting | Value |
|---------|-------|
| Renderer | `THREE.WebGLRenderer` with `antialias: true`, `powerPreference: "high-performance"`, `preserveDrawingBuffer: true` |
| Pixel Ratio | `Math.min(window.devicePixelRatio, LOWFX ? 1 : 2)` |
| Shadow Map | `THREE.PCFShadowMap` (PCFSoftShadowMap deprecated in r180) |
| Tone Mapping | `THREE.ACESFilmicToneMapping`, exposure 1.05 |
| Output Color Space | `THREE.SRGBColorSpace` |
| Camera | `PerspectiveCamera(38, aspect, 0.03, 400)` |
| OrbitControls | damping 0.06, distance [14, 72], polar [π/6, π/2.15] |
| Timer | `THREE.Timer` with `connect(document)` for Page Visibility API |

### Render Loop Order (per frame)
1. `timer.update()` → compute `dt` (clamped to 0.05s), `t`
2. FPS EMA counter (α=0.08, update every 0.25s)
3. Pause check: photo mode, creature selection, manual pause → freeze `dt=0` and `t=lastSimT`
4. `sharedFurUniforms.uLightDir` ← sun position normalized
5. **INSPECT mode**: render directly, bypass composer
6. **Normal mode** (if not paused):
   - `state.windUniforms.uTime.value = t` (frozen if wind disabled)
   - `stepGrass(camera, stroll ? camera.position : controls.target)`
   - `updateDayNight(t)`
7. Build dynamic obstacles pool (walkers + caterpillar segments)
8. Step all fauna: `stepCreature`, `stepCaterpillar`, `stepButterfly`, `stepBee`, `stepFlock`, `stepWillOWisp`
9. Step environment: `stepParticles`, `stepWater`, `stepDirtPuffs`, `stepDustKicks`, `stepGroundMarks`, `stepFlySwarms`
10. `stepShadowDisks`
11. `stepClouds`
12. Sky positioning: `skyDome.position`, `starfield.position` ← camera position × invWorldScale
13. Mountain parallax: position offset by `sin/cos(camera azimuth) * 0.6`
14. Stroll mode: `stepStroll(dt)` + walk-up wake (WAKE_DIST_SQ = 2.5²)
15. Follow target: smooth track (k = dt×4)
16. Water reflection: `updateWaterReflection()` — extra render pass at 256×256
17. **Post-FX**: project focus point → update tilt-shift focus → `postfx.render(scene, camera)`
18. Fallback (no postfx): direct `renderer.render(scene, camera)`

### Resize Handler
- Camera aspect update
- `renderer.setSize(w, h)`
- `postfx.onResize(w, h)`
- Water reflection: `uInvViewport` update
- Particles: `uResolution` update

### NEW/NOTABLE Patterns
- **Page Visibility integration**: `THREE.Timer.connect(document)` prevents huge dt on tab switch
- **Dual-freeze pause**: both `dt=0` AND `t=frozen` so sin-based idle animations freeze too
- **Walk-up wake**: creatures within 2.5 mesh-local units of strolling camera get woken
- **Dynamic obstacle pool**: pre-allocated object pool (`_dynPool`) grows but never shrinks, avoids GC

---

## 2. src/postfx.js

### Constants
| Constant | Value | Purpose |
|----------|-------|---------|
| `BLOOM_LAYER` | `1` | Scene layer for selective bloom meshes |
| `BLOOM_BASE_PAIRS` | `3` | Active blur H+V pairs at slider ≤100% |
| `BLOOM_MAX_PAIRS` | `8` | Max blur pairs at slider 300% |
| `BLOOM_COMPOSITE_STRENGTH` | `4.5` | Additive weight compensating for multi-pass blur dimming |

### Pipeline Architecture

**Key insight**: Single scene render to depthRT, then InputPass copies into composer chain. Previously rendered twice (depth pre-pass + composer RenderPass); now once.

```
[Scene] → depthRT (HalfFloat + DepthTexture)
  ↓
[InputPass] → copies depthRT.texture into composer ping-pong
  ↓
[Bloom Composite Pass] (optional) → adds blurred bloom-only image
  ↓
[Depth FX Pass] (optional) → outlines + contact AO + depth fog
  ↓
[Tilt-Shift Pass] (optional) → hybrid screen-Y + depth bokeh
  ↓
[sRGB Output Pass] → ACES tone-map + linear→sRGB
```

**Bloom sub-pipeline** (separate composer):
```
[Bloom RenderPass] → layer-1 only, black BG, shared depthTexture
  ↓
[5-tap Gaussian H blur] × up to 8 pairs
[5-tap Gaussian V blur] × up to 8 pairs
```

### Render Targets
| RT | Format | Type | Size | Depth | Notes |
|----|--------|------|------|-------|-------|
| `depthRT` | RGBA | `HalfFloatType` | physical pixels | `DepthTexture(UnsignedIntType)` | Scene color + depth, outside composer ping-pong |
| `bloomRT` | RGBA | `HalfFloatType` | physical pixels | Shared with depthRT | Bloom-only scene, black background |

### Shader Details

#### _srgbOutputShader
- **Uniforms**: `tDiffuse`, `uExposure` (default 1.05)
- **Technique**: ACES Filmic (a=2.51, b=0.03, c=2.43, d=0.59, e=0.14) → linearToSRGB (threshold 0.0031308)
- **Why**: Three.js r184 skips tone-mapping AND sRGB for off-screen RTs

#### _blurShader(axis, radiusUniform)
- **Uniforms**: `tDiffuse`, `uResolution`, `uStrength`, `uRadius` (shared reference)
- **Technique**: Separable 5-tap linear-sampling Gaussian (sigma≈2), bilinear trick: weights 0.227/0.315/0.070, offsets 1.384/3.229 × radius
- **Multi-pass stacking**: 3 base pairs → effective σ ≈ √3 × σ_base. Adding pairs up to 8 widens halo without per-pass gap artifacts.

#### _bloomCompositeShader
- **Uniforms**: `tDiffuse`, `tBloom`, `uStrength`
- **Technique**: Additive blend, early-out at strength ≤ 0.001

#### _tiltShiftShader
- **Uniforms** (15 total):
  - `tDiffuse`, `tDepth`, `uResolution`
  - `uFocus` (0.55), `uBandHalfWidth` (0.10), `uBandFalloff` (0.18)
  - `uFocusZ` (20.0), `uDepthHalfRange` (6.0), `uDepthFalloff` (16.0)
  - `uBlurAmount` (7.0 px)
  - `uCameraNear` (0.1), `uCameraFar` (400.0)
- **Technique**: Hybrid max(screen-Y band, depth-from-focus) mask
- **Blur**: 13-tap hexagonal disc (center 0.20 + inner hex 6×0.08 + outer hex 6×0.0533) with per-pixel jitter rotation via `sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453`
- **Color space**: Blur in **gamma-2.0 perceptual space** (sqrt encode, square decode) — avoids linear HDR wash-out
- **Depth**: Inlined `perspectiveDepthToViewZ` with sign flip

#### _depthFXShader
- **Uniforms** (12):
  - `tDiffuse`, `tDepth`, `uResolution`
  - `uCameraNear`, `uCameraFar`
  - `uOutlineStrength`, `uOutlineThickness` (1.0 px)
  - `uAoStrength`, `uAoRadius` (4.0 px)
  - `uFogStrength`, `uFogColor` (#9fb6c4), `uFogNear` (30), `uFogFar` (160)
- **Techniques**:
  - **Outlines**: Sobel on linear depth, per-pixel scale `max(depth, 0.1) * 0.04`, clamp edge - 1.0, sky mask excludes far plane
  - **Contact AO**: 6-tap hex ring, `smoothstep(0.05, 0.6, diff)`, divide by 6, multiply strength × 0.5
  - **Far-field fog**: `smoothstep(30, 160, depth)`, gated on sky mask

#### InputPass (custom Pass subclass)
- Copies external source texture into composer's ping-pong chain
- Replaces RenderPass to eliminate second scene render
- Uses `_copyShader` passthrough

### LOWFX Behavior
- Returns stub object: `isActive() → false`, `render() → renderer.render(scene, camera)`, no composer built
- `state.depthTexture = null`

---

## 3. src/grass.js

### Constants
| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_PUSHERS` | `40` | Creature pusher vec4 uniform slots |
| `PUSH_RADIUS_SCALE` | `0.9` | Scales creature push radius |
| `MAX_DENSITY_MULTIPLIER` | `4.0` | Max density slider value (200% = 4× stock) |

### Blade Geometry
- Two `PlaneGeometry(0.10, 0.34, 1, 3)` crossed at 90° (merged)
- Quadratic taper: `1.0 - t*t` (full base → point tip)
- Custom attribute: `aTipFactor` (Float32, y/0.34)
- Per-instance: `aWindSeed` (InstancedBufferAttribute)

### InstancedMesh
- `count = maxCount = ceil(nominalCount * MAX_DENSITY_MULTIPLIER)`
- Live density via `mesh.count` scaling (0 to maxPlaced, no rebuild)
- Overshoot factor: LOWFX ? 22.0 : 55.0
- Placement: `pickGroundPoint` with density noise rejection (0.55 freq), clump-height modulation (0.35 freq)
- Bald threshold per biome: `BALD_THRESHOLD[biome.id] ?? 0.18`

### Grass Shader (via `onBeforeCompile` on MeshStandardMaterial)

**Vertex Shader Patches:**
- Custom `aTipFactor`, `aWindSeed` attributes
- `gHash` / `gNoise` (value noise with sin-hash)
- Wind: two-octave noise (0.7/0.3 blend), swirl rotation, `amp = tip² × windStrength × gust × (0.75 + 0.5 × seed)`
- **Instance-aware inverse rotation**: extracts XZ basis from `instanceMatrix`, inverse-rotates world-space bend into mesh-local coords
- Creature push: loop over `MAX_PUSHERS` vec4 slots, radial outward bend with `tip² × pushFalloff × strength`, Y dip -0.35
- Distance fade: `smoothstep(45, 85)` (LOWFX: 30/55), applied to Y, 50% to XZ
- Height multiplier: `uHeightMul`

**Fragment Shader Patches:**
- Color: `mix(diffuseColor.rgb, uTipColor, vTipFactor * 0.85)`

### Uniforms
| Uniform | Type | Default | Notes |
|---------|------|---------|-------|
| `uTime` | float | shared | from `state.windUniforms` |
| `uTipColor` | vec3 | biome-dependent | Grass tip color |
| `uWindScale` | float | 0.15 | Noise sampling frequency |
| `uWindSpeed` | float | 0.6 | Noise scroll speed |
| `uWindDir` | vec2 | random angle | Wind direction |
| `uWindStrength` | float | LOWFX ? 0.8 : 1.2 | Global wind amplitude |
| `uCameraXZ` | vec2 | (0,0) | Updated per frame for fade |
| `uFadeEnabled` | float | 0 or 1 | Disabled in inspect mode |
| `uFadeStart` | float | 45 (LOWFX: 30) | Fade start distance |
| `uFadeEnd` | float | 85 (LOWFX: 55) | Fade end distance |
| `uPusherCount` | int | 0 | Active pusher count |
| `uPushers` | vec4[40] | zeros | xy=worldXZ, z=radius, w=strength |
| `uHeightMul` | float | 1.0 | Grass height slider |

### stepGrass
- Updates `uCameraXZ` from camera/follow target
- Builds pusher array from creatures + caterpillar segments
- Skips airborne fliers (`c.flies && c.landState !== "landed"`)
- Push radius: `max(1.0 * ws, 1.3 * c.scale * ws) * PUSH_RADIUS_SCALE`
- Caterpillar segments: radius `max(0.45 * ws, 0.6 * c.scale * ws)`

---

## 4. src/environment.js

### Particle System

**Particle Kinds** (13 types with integer IDs):
```js
PARTICLE_KIND_ID = {
  pollen: 0, dust: 1, snow: 2, firefly: 3, ember: 4,
  lichenmote: 5, feather: 6, bubble: 7, leaf: 8, spark: 9, rain: 10,
  sand: 11, cinder: 12,
}
```

**Base Counts** (before LOWFX scaling):
| Kind | Count |
|------|-------|
| rain | 520 |
| cinder | 520 |
| snow | 500 |
| sand | 420 |
| dust | 320 |
| spark | 240 |
| pollen | 240 |
| ember | 180 |
| lichenmote | 140 |
| bubble | 140 |
| leaf | 120 |
| feather | 120 |
| firefly | 90 |

**Particle Vertex Shader** (`_particleVS`):
- Attributes: `aSeed`, `aLife`
- Varyings: `vLife`, `vSeed`, `vViewZ`
- Uniforms: `uTime`, `uPixelRatio`, `uBaseSize`
- Size variation by `PARTICLE_KIND` (cinder scales by seed, ember/spark shrink with life, snow varies)
- Point size: `size * pixelRatio * (300 / max(0.001, -mv.z))`

**Particle Fragment Shader** (`_particleFS`):
- Soft particles: samples `tDepth`, fades alpha over 1.2 world-unit window
- Shape variations by kind: rain = streak, sand/cinder = horizontal streak, default = circle
- Color ramps: ember/spark/cinder fade `uColor → uColor2` over life; firefly pulse via `sin(t*2 + seed*18)`
- Blending: additive for firefly/ember/lichenmote/spark/cinder
- **Soft particle depth test**: `perspectiveDepthToViewZ` inlined, `clamp((sceneDist - vViewZ) / 1.2, 0, 1)`

**Particle Uniforms** (12):
| Uniform | Type | Notes |
|---------|------|-------|
| `uTime` | float | Frame time |
| `uPixelRatio` | float | Device pixel ratio |
| `uBaseSize` | float | Per-kind (0.06 rain → 0.19 cinder) |
| `uColor` | vec3 | Primary color from biome |
| `uColor2` | vec3 | Fade target (ember/spark/cinder) |
| `uOpacity` | float | Per-kind (0.35 dust → 0.95 spark) |
| `tDepth` | sampler2D | From depth pre-pass |
| `uResolution` | vec2 | Window size |
| `uCameraNear` | float | 0.1 |
| `uCameraFar` | float | 400.0 |
| `uSoftParticles` | float | 0/1 toggle |

### stepParticles — Movement Behaviors
Each kind has unique physics in `stepParticles`:
- **snow**: y -= (0.6–1.2)×dt, horizontal sine drift, recycle at y < -2
- **ember**: rises, sine drift, recycle at y > 12
- **firefly**: 3D sine drift, bounded to radius, y [0.5, 6]
- **sand**: dominant horizontal wind (5.5 × gust), terrain-hugging, wraps at island edge
- **cinder**: slower sand-like wind, floatier, terrain-clamped
- **rain**: near-vertical streaks (8.5–11 ×dt), fast recycle

### Dirt Puffs
- `PUFF_PARTICLES = 24`, `PUFF_LIFE = 1.7s`
- Burst velocity: outward 1.2–2.6, upward 1.6–2.8, gravity -6.5
- Damping: 0.94 horizontal

### Dust Kicks
- `KICK_PARTICLES = 4`, `KICK_LIFE = 0.5s`
- Smaller, subtler than puffs
- Configurable: `count`, `velocityScale`, `size`, `opacity`, `life`, `poof`

### Ground Marks (Terrain-Painted)
- **Canvas**: `GROUND_MARK_TEX_SIZE` = LOWFX ? 256 : 512
- **Max marks**: LOWFX ? 192 : 512
- **Stamp**: radial gradient with heading rotation
- **Interpolation**: stamps along path from `fromX/Z` to `x/z` at spacing `max(0.04, min(width, length) * 0.42)`
- **Shader patch**: injected into terrain material's `onBeforeCompile` — `vGroundMarkXZ` varying, `uGroundMarkColor`, `uGroundMarkTex`, `uGroundMarkInvSize`
- **Life**: per-mark with `groundMarkLifeScale` user setting

### Fly Swarms
- `FLY_COUNT = 9` (LOWFX-scaled)
- Tight irregular orbit: slow circular + fast jitter (sin(t×6 + seed))
- `PointsMaterial`, color 0x141014

### Wildflower Field
- Instanced geometry: stem (tapered cylinder), leaf (parametric mesh), petal (teardrop mesh), pistil (flattened sphere)
- Clusters of 2–4 flowers per position
- Bloom layer enabled on petals when `biome.glowFlowers` is truthy
- Per-color InstancedMesh batches for petals

### placeInstanced
- Generic instanced placement with obstacle avoidance, excluded circles, height range, tilt
- Returns mesh with `userData.positions` for creature targeting

### Water Plane
- `PlaneGeometry(ISLAND_SIZE * 1.05, ..., 48, 48)` at y = -0.12
- `MeshStandardMaterial`: transparent, opacity 0.55, roughness 0.32, metalness 0.18, depthWrite false
- **Reflection patch via `onBeforeCompile`**:
  - Uniforms: `uReflTex` (sampler2D), `uInvViewport` (vec2), `uReflMix` (float)
  - Fresnel-ish: `pow(1 - dot(normalize(vNormal), vec3(0,1,0)), 2.0)`
  - Mix: `base, refl, uReflMix * (0.4 + 0.6 * f)`
- **Wave animation**: two-sine displacement `sin(t*0.9 + x*0.5 + z*0.4) * 0.05 + sin(t*1.4 + x*0.3 - z*0.6) * 0.03`
- Round clip shader for non-circular islands

### Cloud Puff Field
- Cloudlike biomes only
- Icosahedron(0.34, 1) scaled (1.7, 0.32, 1.25)
- Ground pads + floating cloudlets

### Pebble Field / Beachcomb Field
- Icosahedron-based pebbles with jitterGeo
- Beach: shells (squashed spheres) + starfish (10-point ShapeGeometry)

---

## 5. src/reflection.js

### Water Reflection RT
| Property | Value |
|----------|-------|
| Size | LOWFX ? 128×128 : 256×256 |
| Depth Buffer | `false` |
| Far Plane | 1200 (extended beyond camera's 400 for sky dome radius 380) |

### Implementation Details
- **Scene cloning**: Sky dome, starfield, aurora, clouds each cloned into reflection scene
- **Uniform sharing**: Cloned materials re-bind to live uniform references so day/night flows through
- **Dome side**: Changed to `DoubleSide` (reflection mirrors winding order)
- **Camera**: `PerspectiveCamera(38, 1, 0.1, 800)`
- **Mirror technique**: `_reflectMat = Matrix4().makeScale(1, -1, 1)` composed with main camera's world matrix
  - `matrixAutoUpdate = false`
  - Manual `decompose` and `matrixWorld`/`matrixWorldInverse` update
  - Avoids old `lookAt(up=-1)` approach which had degeneracy when looking straight down
- **Position sync**: Each frame copies positions from live sky elements to clones
- **Cloud sync**: Per-sprite position tracking via `cloudPairs` array
- **Dispose**: Clears scene first, nulls refs to prevent post-dispose GPU reads

---

## 6. src/fur.js

### Shell Fur System

**Shared Uniforms** (`sharedFurUniforms`):
| Uniform | Default | Notes |
|---------|---------|-------|
| `uLightDir` | `Vector3(1,1,1)` | Updated from sun light each frame |
| `uLayers` | `8` | Max layers across all creatures (LOWFX: 4) |

### Vertex Shader (`_furVS`)
- `vLayerT = uShellLayer / uLayers`
- Displacement: `position + normal × uFurLength × vLayerT`
- `vPos = position` (original, for stable cell hash across shells)

### Fragment Shader (`_furFS`)
- **Cell hash**: `floor(vPos * 80.0)` → `hash13` (irrational multipliers 443.897/441.423/437.195)
- **Discard threshold**: `0.0 + vLayerT * 0.70` — shells get sparser toward tips
- **Base→Tip gradient**: `mix(uBaseColor, uTipColor, vLayerT)`
- **Lighting**: Lambertian `max(0, dot(N, normalize(uLightDir)))` × (0.7 + 0.3 × lam)
- **Alpha**: `1.0 - vLayerT * 0.35`
- **Pattern Types** (3):
  - **0 = none**
  - **1 = stripes**: Z-axis bands, configurable count/width/offset
  - **2 = spots**: Scattered discs via grid of random centers
  - **3 = patches**: Smooth 3D noise threshold (`noise3` — value noise with trilinear interpolation)

### Per-Shell Uniforms
| Uniform | Type | Notes |
|---------|------|-------|
| `uShellLayer` | float | Per-shell (1 to layers) |
| `uLayers` | float | Shared reference |
| `uFurLength` | float | LOWFX ? 0.082 : 0.072 |
| `uBaseColor` | vec3 | From body material |
| `uTipColor` | vec3 | `biome.furTip ?? biome.accent` |
| `uLightDir` | vec3 | Shared reference |
| `uStripeColor` | vec3 | Pattern color |
| `uStripeBandCount` | float | Stripe frequency |
| `uStripeBandWidth` | float | Band/spot width |
| `uStripeOffset` | float | Phase offset |
| `uPatternType` | float | 0/1/2/3 |
| `uPatternScale` | float | Pattern spatial scale (default 6.0) |

### applyShellFur
- Creates `layers` shells as children of `body` mesh
- Each shell: `template.clone()` with `uShellLayer` overwritten
- Re-binds shared uniforms after clone (Three.js deep-clones)
- Pattern uniforms optionally set per creature
- Template disposed after spawning (never added to scene)

---

## 7. src/util.js

### jitterGeo(geo, amount = 0.05)
- Strips UV and normal attributes
- `mergeVertices(geo, 1e-4)` — welds by position only
- Random perturbation × amount
- Recomputes normals

### applyWindSway(material, strength = 1.0)
- **Chains** `onBeforeCompile` handlers (captures `prev`)
- **Uniforms injected**: `uTime` (shared), `uWindStrength`, `uFoliageWind` (0/1 from state)
- **Vertex shader patch**: world-space wind via two sine waves:
  - `w1 = sin(t*1.4 + wp.x*0.30 + wp.z*0.40)`
  - `w2 = sin(t*0.9 + wp.x*0.15 - wp.z*0.25)`
  - Amplitude: `windY² × strength × uFoliageWind`
- **Instance-aware inverse rotation**: same pattern as grass shader
  - Extracts XZ basis from `instanceMatrix`, computes `invXZScaleSq`
  - Inverse-rotates world-space wind delta into mesh-local coords

### buildLeafGeo(opts)
- Parametric leaf mesh builder with configurable:
  - `lengthSegs=7`, `widthSegs=4`, `length=0.42`, `maxWidth=0.165`
  - `profileExp=0.72` — sin-based width profile exponent
  - `centerLift=0.010`, `tipCurlStrength=0.060`, `edgeCurlStrength=0.010`
  - Generates indexed BufferGeometry with computed normals

### TRUNK constant
- `new THREE.Color("#3a2818")` — brown trunk color

---

## 8. src/sky.js

### Sky Dome
- `SphereGeometry(380, 32, 20)`, `BackSide`, `depthWrite: false`, `depthTest: false`
- `renderOrder = -100`
- **Shader**: zenith/horizon gradient via `pow(clamp(dir.y + 0.05, 0, 1), uExp)` where `uExp = 1.6`
- **Uniforms**: `uZenith`, `uHorizon`, `uExp`

### Mountain Backdrop
- Two concentric wobbled cylinders (open-ended)
- Far ring: radius 220, height 36, peak amplitude 7, 96 segments
- Near ring: radius 115, height 24, peak amplitude 4
- **Wobble**: 3-octave angular sin: `sin(a*f1) + sin(a*f2+p2)*0.6 + sin(a*f3-p3)*1.2`
- `renderOrder`: far=-50, near=-40
- Far: fog=false, opacity=0.75. Near: fog=true, opacity=0.85
- Day/night re-tinting via `updateSkyColors`

### Cloud Layer
- Procedural cloud texture: 128×128 canvas with 5 radial gradient blobs
- `SpriteMaterial` with per-sprite cloned material
- **Placement**: hemisphere clusters, radius 180–240, theta 25°–82° from zenith
- **Cluster distribution**: `ceil(count/4)` clusters, even-share allocation
- **Drift**: per-sprite `driftSpeed` (0.012–0.03), `angle += speed * dt`
- Scale: 14–24 × (2.0–2.65 width, 0.72–0.98 height)
- `renderOrder = -30`

### Starfield
- Count: LOWFX ? 220 : 600
- Upper hemisphere biased (v = 0.15–1.0), radius 350
- Custom attribute: `aBright` (0.4–1.0)
- **Shader**: twinkle via `sin(uTime * 2.3 + vBright * 18.0)`, alpha controlled by `uAlpha`
- Warm white: `vec3(1.0, 0.96, 0.9)`
- `renderOrder = -90`

### Aurora
- Biome-gated: `AURORA_BIOMES.has(biome.id)`
- 3 overlapping curtain planes (`PlaneGeometry(220, 70, 32, 1)`)
- Each at 120° offset via pivot group
- Position: (0, 40, -150)
- **Shader**:
  - Vertex: horizontal ripple `sin(x*0.04 + t*0.3 + seed) * 4.0`
  - Fragment: feathered edges, value noise, layered rays, shimmer, color flow
  - Two noise octaves at different scales scrolled in opposing directions
  - 3 color tints (uA, uB, uC) with noise-driven blending
  - Additive blending
- `renderOrder = -70`

### Cloud Swirl
- Cloudlike biomes only (unless `cloudSwirl === false`)
- `TorusGeometry(30, 7, 14, 96)`, rotated flat (π/2 around X), y=6
- **Shader**: two-octave value noise scrolled in opposing directions
  - Domain warping via low-frequency noise
  - `smoothstep(0.30, 0.95, n)` density
  - Pole fade: `smoothstep(0, 0.18, v) * smoothstep(1, 0.82, v)`
  - Colors: `mix(colA, colB, density * 0.55)`
- `renderOrder = -65`
- Shares `state.windUniforms.uTime`

### Island Edge Mist / Grass Aura
- **Mist mode**: `RingGeometry` with FBM-driven shader (3 octaves)
  - Domain warping, inward/outward fade
  - Configurable: `noiseScale`, `streakScale`, `windStrength`
- **Grass mode**: Ring ground disc + `LineSegments` for grass blades
  - Up to LOWFX ? 1100 : 3200 × 1000 × lineDensity line segments
  - Line vertex shader: wind sway via radial/tangent decomposition
  - Line fragment: root→tip gradient with light highlights

### updateSkyColors
- Blends zenith/horizon through dusk: `night → dusk → day` based on `dayFactor`
- Mountain materials: lerp toward `nightFog` by `nightAmt`

### blendDuskDayNight
- If f >= 0.5: `dusk → day`
- If f < 0.5: `night → dusk`

---

## 9. src/shadows.js

### Shadow Disk System
- **Texture**: 128×128 canvas, radial gradient (0.85 center → 0 at edge, midpoint 0.45 at 55%)
- **Shared**: `_shadowTex` cached once per session, never disposed
- **InstancedMesh**: `PlaneGeometry(1,1)` rotated flat, capacity = `max(64, creatures + caterpillars + 16)`
- **Material**: `MeshBasicMaterial` with texture, tinted by darkened biome fog
  - Cloudlike biomes: tint `offsetHSL(0, 0, -0.18)`, opacity 0.26
  - Normal biomes: tint `offsetHSL(0, 0, -0.4)`, opacity 0.45
- **Dynamic**: `instanceMatrix.setUsage(DynamicDrawUsage)`, rewritten every frame
- **renderOrder = -5** (below flora, above terrain)
- **Optimization**: High-water mark (`prevActive`) — only zeros newly-empty slots

### stepShadowDisks
- Creature shadow: ground Y from `heightFn`, scale = `c.scale * 1.6`
- Flying creatures: scale shrinks with hover height (factor `1 - 0.7 * t`)
- Caterpillars: single disc under head segment, scale `c.scale * 0.7`
- Unused slots: zero-scale matrix

---

## 10. src/terrain.js

### Height Function
- `makeHeightFn(noise2D, layout, amp = 3.0)`
- Three octaves: `×0.06/amp`, `×0.14/(amp*0.45)`, `×0.32/(amp*0.18)`
- Smoothstep falloff per island center (0.45×radius → radius)
- Supports round, oblong, and kidney shapes

### Island Shapes
- **Round**: standard circular
- **Oblong**: rotated ellipse with `stretch` factor (1.22–1.50)
- **Kidney**: circular with carved bite (biteCx = radius×0.6, biteR = radius×0.42, configurable strength)

### pickLayout
- Size: 78% (27%), 100% (51%), 115% (22%)
- Shape: round (50%), oblong (32%), kidney (18%)
- `visualRadius = radius + max(3.0, radius*0.18)` for round, else `radius`

### Terrain Mesh
- `PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE, segs, segs)` where `segs = 140 × (ISLAND_SIZE/50)`
- Height-band coloring: 3 ground colors blended by `(y+1)/4.5`
- Slope coloring: `1 - abs(normal.y)` → cliff color
- Cloudlike: cottony highlights via `sin(x*0.34+z*0.19)*sin(x*0.12-z*0.31)`, reduced cliff mix
- **Round clip shader** (via `onBeforeCompile`):
  - `vClipXZ` varying, `uClipCenter` vec2, `uClipRadius` float
  - Fragment: `if (distance(vClipXZ, uClipCenter) > uClipRadius) discard;`
- **Custom depth material**: Same clip shader applied to `MeshDepthMaterial(RGBADepthPacking)`
- `flatShading: !cloudlike`, roughness 0.92 (cloudlike: 0.78)

---

## 11. src/pool.js

### makePool()
- Factory function returning `{ get(key, factory), reset() }`
- Independent namespace per call (flora/fauna each get one)
- `reset()` creates new Map — old entries expected to be disposed separately

---

## 12. src/state.js (key constants and structures)

| Constant | Value | Notes |
|----------|-------|-------|
| `ISLAND_SIZE_BASE` | 50 | Base terrain size |
| `ISLAND_RADIUS_BASE` | 23.1 | 50 × 0.462 |
| `DENSITY_BASE` | 38 | Biome tuning anchor |
| `NIGHT_SKY` | `#0a0d24` | Night zenith |
| `NIGHT_FOG` | `#070a1f` | Night horizon |
| `NIGHT_SUN` | `#7a89b8` | Night directional |
| `NIGHT_HEMI_GROUND` | `#06070d` | Night ground ambient |
| `DAY_NIGHT_PERIOD_S` | 120 | Full cycle in seconds |

### windUniforms
```js
windUniforms: { 
  uTime: { value: 0 },        // shared across all wind-driven shaders
  uFoliageWind: { value: 1 }  // 0/1 toggle for non-grass foliage
}
```

### userSettings defaults (shader-relevant):
```js
bloom: true, tiltShift: false, softParticles: true,
outline: true, ao: true, depthFog: true,
bloomRadius: 1.0, grassDensity: 2.0, grassHeight: 1.2,
windEnabled: true, windStrength: 1.0, foliageWindEnabled: true,
```

---

## 13. src/lowfx.js

### LOWFX Detection
- `?lowfx=1`: force on
- `?lowfx=0`: force off
- Auto-detect: touch-only device OR short side < 768px OR DPR < 1.0
- `LOWFX_DENSITY = 0.4` — particle/cover count multiplier

### LOWFX Impacts
| System | Impact |
|--------|--------|
| PostFX | No composer built, direct render, `depthTexture = null` |
| Grass | Overshoot 22 vs 55, fade 30/55 vs 45/85, wind strength 0.8 vs 1.2 |
| Particles | Counts × 0.4 |
| Fur | 4 layers vs 8, length 0.082 vs 0.072 |
| Reflection | 128×128 vs 256×256 RT |
| Stars | 220 vs 600 |
| Ground marks | 256 texture vs 512, 192 max vs 512 |
| Pixel ratio | Cap 1 vs 2 |

---

## 14. Cross-Cutting Patterns

### GLSL Techniques Used Across the Codebase
| Technique | Where Used |
|-----------|-----------|
| **Value noise (sin-hash)** | grass.js (gNoise), sky.js (aurora, cloud swirl, edge mist), fur.js (noise3) |
| **Domain warping** | sky.js (cloud swirl, edge mist FBM) |
| **Bilinear trick Gaussian** | postfx.js (5-tap = 9-tap equivalent) |
| **Hexagonal disc sampling** | postfx.js (tilt-shift 13-tap), environment.js (contact AO 6-tap) |
| **Jitter rotation** | postfx.js (tilt-shift per-pixel rotation breaks ring artifacts) |
| **Gamma-2.0 blur space** | postfx.js (tilt-shift: sqrt/square to avoid linear wash-out) |
| **Shell texturing (fur)** | fur.js (cellular discard with height-dependent threshold) |
| **Fresnel approximation** | environment.js (water reflection) |
| **Instance-aware wind** | grass.js, util.js (inverse-rotate through instanceMatrix XZ basis) |
| **Round plane clip** | terrain.js, environment.js (discard fragments outside island radius) |
| **onBeforeCompile chaining** | util.js (captures prev handler), environment.js (ground marks + water reflection) |
| **Perspective depth to view-Z** | postfx.js (tilt-shift, depth FX), environment.js (soft particles) — formula inlined: `(near*far) / ((far-near)*d - far)` |
| **Shared uniform references** | grass.js (windUniforms), fur.js (sharedFurUniforms), sky.js (windUniforms) — cloned materials re-bind to same objects |
| **DynamicDrawUsage** | shadows.js (shadow disks), environment.js (particles, dirt puffs, fly swarms) |

### Pipeline Render Order
| Order | System |
|-------|--------|
| -100 | Sky dome |
| -90 | Starfield |
| -70 | Aurora |
| -65 | Cloud swirl |
| -50 | Far mountains |
| -40 | Near mountains |
| -30 | Clouds |
| -16 | Island edge mist / grass aura |
| -14 | Grass aura line segments |
| -5 | Shadow disks |
| default | Terrain, flora, creatures, particles, water |

### Shared Uniform Patterns
- **Wind**: `state.windUniforms.uTime` / `.uFoliageWind` — shared across grass, applyWindSway, cloud swirl, edge mist, grass aura
- **Fur light**: `sharedFurUniforms.uLightDir` / `.uLayers` — updated once per frame in main.js
- **Depth**: `state.depthTexture` — shared between postfx (tilt-shift, depth FX) and environment (soft particles)

### Performance Optimizations
1. **Single scene render** to depthRT → InputPass copies into composer (was 2 renders)
2. **Shared depth attachment** between scene RT and bloom RT (depth occlusion for bloom)
3. **Instance-aware wind** inverse rotation avoids per-frame JS matrix computation
4. **Dynamic obstacle pool** avoids per-frame GC pressure
5. **High-water mark** for shadow disks (zeros only newly-empty slots)
6. **Bloom layer filtering** — only emissive meshes rasterize in bloom pass
7. **Enabled flag gating** — entire passes skipped when effects off
8. **Streaming buffer hints** (`DynamicDrawUsage`) on per-frame updated geometries
9. **Gamma-2.0 blur** avoids pow() (uses sqrt/square — 9× fewer ops per pixel than sRGB OETF)
10. **Bloom UnsignedByte consideration** noted but ultimately HalfFloat for HDR headroom

### NEW/NOTABLE vs Standard Three.js
1. **Custom InputPass** replaces RenderPass in EffectComposer — single scene render
2. **Bloom via scene layers** — `mesh.layers.enable(BLOOM_LAYER)` instead of luminance threshold
3. **Multi-pass bloom scaling** — adds blur passes rather than widening offsets (avoids pointillist gaps)
4. **Shell fur with 3D cellular patterns** — stripes/spots/patches applied per-cell across all shells
5. **Ground marks via canvas texture** painted into terrain shader — not geometry
6. **Grass density slider** via `mesh.count` adjustment (no rebuild)
7. **Cloud swirl torus** with domain-warped noise for cloudlike biomes
8. **Reflection mirror matrix** instead of lookAt-based camera (avoids degeneracy)
9. **Chained onBeforeCompile** — multiple patches compose cleanly on same material
10. **Round clip shader** applied to both terrain material and custom depth material
