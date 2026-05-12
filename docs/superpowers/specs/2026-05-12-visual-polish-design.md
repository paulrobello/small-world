# Visual Polish — Design Spec

**Date:** 2026-05-12
**Scope:** Implement all items in `ideas.md` § "Rendering / Visual Polish" plus four shader/density extensions: shell-fur on fuzzy biomes, custom particle ShaderMaterial, denser grass with tip color, and footstep dust kicks.
**Status:** Approved (sections 1–6 reviewed in chat)

---

## 1. Architecture

Work splits into three concerns, each wired in at one well-defined spot.

- **Renderer-layer changes** (post-processing, water reflection RT) live in `main.js`. The animation loop branches once on "any PP enabled?" — if yes call `composer.render()`, else fall through to `renderer.render(scene, camera)`. Water reflection updates a shared RT each frame *before* the main render.
- **World-build-time changes** (fur shells, soft-shadow InstancedMesh, denser grass with tip color, mountain parallax base) all happen inside `generateWorld` in `world.js`. Same disposal contract — everything new is parented to `state.world`, so `disposeGroup` handles cleanup at regen.
- **Per-frame changes** (mountain parallax push, soft-shadow matrix updates, particle aLife advection) plug into the existing `animate()` step pattern in `main.js`. No new top-level loops.

### New files

- `src/postfx.js` — `EffectComposer` setup, `makeTiltShiftPass()`, bloom config, `renderPostFX(scene, camera, dt)` entrypoint, `isPostFXActive()` predicate.
- `src/fur.js` — `applyShellFur(body, biome, opts)` plus the shared shell ShaderMaterial.
- `src/shadows.js` — `makeShadowDisks()` (one InstancedMesh) and `stepShadowDisks()`.
- `src/reflection.js` — `makeWaterReflection()` (RenderTarget + reflection camera + clone-scene wiring) and `updateWaterReflection(renderer)`.

### Modified files

- `src/environment.js` — particle `ShaderMaterial` replacement, grass density + tip color, water material reflection patch via `onBeforeCompile`, footstep dust-kick emit/step helpers.
- `src/biomes.js` — add `fuzzy: true` to ~4 biomes (mossy/cloud/snow-leaning).
- `src/sky.js` — accept a mountain parallax offset; expose a setter or update on a stored base position.
- `src/state.js` — new fields: `shadowDisks`, `waterReflection`, `mountainBasePos`, `dustKicks`, and two new `userSettings` flags (`bloom`, `tiltShift`).
- `src/ui.js` — two new checkboxes (bloom, tilt-shift) under a new "rendering" settings section, plus `localStorage` persistence for them.
- `index.html` — markup for the new settings section.
- `main.js` — composer wiring, reflection update, parallax update, shadow + dust-kick step calls.
- `src/fauna.js` — `applyShellFur` call site in `makeCreature`, dust-kick rising-edge emit in `stepCreature`.

### LOWFX behavior

- `postfx.js` — composer never built, both toggles disabled in the UI.
- `fur.js` — `layers = 4` instead of 8; skip fur on fliers/fish regardless of biome.
- `reflection.js` — RT becomes 128×128, mix factor halved.
- `shadows.js` — kept (one draw call, cheap).
- Particles — keep the new shader (same draw cost as before, just better looking).
- Grass — keep tip color; density still scaled by `LOWFX_DENSITY`.

---

## 2. Post-processing stack

**File:** `src/postfx.js`

```js
export function initPostFX(renderer) // -> { composer, bloomPass, tiltShiftPass, setBloom(on), setTiltShift(on), render(scene, camera), onResize(w,h), isActive() }
```

Built lazily on first enable (LOWFX never pays the cost).

### Stack

1. `RenderPass(scene, camera)` — base scene.
2. `UnrealBloomPass` — params tuned for painterly look: `strength = 0.55`, `radius = 0.45`, `threshold = 0.85`. Threshold ≥ 0.85 means only emissive surfaces (glowFlowers, glowEyes, crystals, sun) bloom — non-emissive scene stays clean.
3. `ShaderPass(TiltShiftShader)` — custom 1-pass DOF: two horizontal + two vertical blur taps, weighted by `smoothstep(focusBand, vUv.y)`. Focus band centered at the screen-space y of `state.world` origin projected through the camera (follows the island during orbit), half-width `0.18`. When toggled off, set `enabled = false` (cheaper than rebuilding).
4. `OutputPass` — final tone-map / color-space terminator.

### Toggle plumbing

- `userSettings.bloom` default `true`; `userSettings.tiltShift` default `false`. Persist to `localStorage` (`small-world.settings`).
- `index.html` gets a new "rendering" section with two checkboxes (wired in `ui.js`).
- LOWFX forces both off and disables the checkboxes (greyed with "disabled on this device" hint).

### Main-loop integration

```js
const postfx = initPostFX(renderer);
function animate() {
  ...
  if (postfx.isActive()) postfx.render(scene, camera);
  else renderer.render(scene, camera);
}
```

`postfx.isActive()` returns true if either pass is enabled. Single conditional, no per-frame overhead in the off path.

### Resize and photo mode

- Existing `window.resize` listener calls `postfx.onResize(w, h)` after `renderer.setSize`.
- Photo-mode `toDataURL()` continues to work via `preserveDrawingBuffer: true` — no change.

---

## 3. Shader fur (shell technique)

**File:** `src/fur.js`

```js
export function applyShellFur(body, biome, opts = {}) // -> Mesh[] (shells), for tracking only — disposal goes through disposeGroup
```

### Shell construction

When a biome has `fuzzy: true` and a creature is being built in `makeCreature`:

1. Reads the body's geometry (the jittered icosphere).
2. Builds N shell `Mesh` objects (default `layers = 8`, LOWFX → 4) sharing the same geometry reference.
3. Each shell uses a clone of a shared `ShaderMaterial`, only `uShellLayer` uniform differs.
4. Shells are added as **children of `body`** so they inherit body squash/breath/bob animation automatically. Fur length stays proportional to body size as `body.scale` animates.

### Shared shader

```glsl
// vertex
attribute vec3 normal;
uniform float uShellLayer;
uniform float uLayers;
uniform float uFurLength;
varying vec2 vHairUv;
varying float vLayerT;
varying vec3 vNormal;

void main() {
  vLayerT = uShellLayer / uLayers;
  vec3 p = position + normal * uFurLength * vLayerT;
  vHairUv = position.xy * 18.0 + position.zx * 11.0;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}

// fragment
uniform vec3 uBaseColor;
uniform vec3 uTipColor;
uniform vec3 uLightDir;
uniform float uLightIntensity;
varying vec2 vHairUv;
varying float vLayerT;
varying vec3 vNormal;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float h = hash21(floor(vHairUv));
  float threshold = 0.32 + vLayerT * 0.55;
  if (h < threshold) discard;
  vec3 N = normalize(vNormal);
  float lam = max(0.0, dot(N, normalize(uLightDir)));
  float rim = pow(1.0 - max(0.0, dot(N, vec3(0.0, 0.0, 1.0))), 2.0);
  vec3 c = mix(uBaseColor, uTipColor, vLayerT);
  c *= 0.45 + 0.6 * lam * uLightIntensity + 0.15 * rim;
  gl_FragColor = vec4(c, 1.0 - vLayerT * 0.15);
}
```

### Global light uniforms

`uLightDir` and `uLightIntensity` updated once per frame in `animate()` from `state.sunLight.position` (subtract world origin, normalize) and `state.sunLight.intensity`. Shared across all fur instances via uniform reference.

### Biome opt-in

Add `fuzzy: true` to four biomes — selected from the existing `BIOMES` list at implementation time, biased toward biomes that read fluffy (mossy / cloud-like / snow / lichen-tundra). Tip color defaults from biome accent (`biome.furTip ?? biome.accent`).

### Cost

A 4-creature fuzzy biome with 8 shells adds ≤32 extra draws. Well within budget. LOWFX → 4 shells, fliers/fish always skipped.

### Disposal

`applyShellFur` returns the shell array. Creatures store them as `c.furShells`. Shells parent to `body`, so `disposeGroup` covers material/geometry cleanup at regen.

---

## 4. Custom particle shader

**File:** `src/environment.js`

Replace `THREE.PointsMaterial` with a single `THREE.ShaderMaterial`. Per-kind appearance selected by `defines.PARTICLE_KIND = <int>` so the shader compiles once per kind.

### Attribute layout

| Attr       | Stride | Meaning                                                                 |
|------------|--------|-------------------------------------------------------------------------|
| `position` | vec3   | World-space particle position (existing CPU advection writes this)      |
| `aSeed`    | float  | Per-particle stable seed (already exists as `seeds`)                    |
| `aLife`    | float  | 0..1 lifetime fraction (NEW). 0 = just born, 1 = about to recycle       |

`stepX` advection keeps its current per-kind logic but also writes `aLife`:

- Infinite-loop kinds (firefly, dust, pollen, lichenmote): `aLife = (t * speed + seed) % 1.0`.
- Recycle-on-bounds kinds (snow, ember, rain, leaf, spark, feather, bubble): `aLife = 0` on recycle, otherwise increment by `dt / lifespan`.

### Vertex shader

```glsl
attribute float aSeed;
attribute float aLife;
varying float vLife;
varying float vSeed;
uniform float uTime;
uniform float uPixelRatio;
uniform float uBaseSize;

void main() {
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = uBaseSize;
  #if PARTICLE_KIND == KIND_EMBER || PARTICLE_KIND == KIND_SPARK
    size *= 1.0 - aLife * 0.7;
  #elif PARTICLE_KIND == KIND_SNOW
    size *= 0.7 + 0.3 * fract(aSeed);
  #endif
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio * (300.0 / -mv.z);
}
```

### Fragment shader

```glsl
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uTime;
varying float vLife;
varying float vSeed;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  #if PARTICLE_KIND == KIND_RAIN
    float a = smoothstep(0.5, 0.0, abs(c.x) * 2.0) * smoothstep(0.5, 0.0, abs(c.y));
  #else
    float a = smoothstep(0.5, 0.0, d);
  #endif
  vec3 col = uColor;
  #if PARTICLE_KIND == KIND_EMBER || PARTICLE_KIND == KIND_SPARK
    col = mix(uColor, uColor2, vLife);
    a *= 1.0 - vLife;
  #elif PARTICLE_KIND == KIND_FIREFLY
    float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vSeed * 18.0);
    col *= 0.6 + 0.4 * pulse;
    a *= pulse;
  #elif PARTICLE_KIND == KIND_LICHENMOTE
    a *= 0.6 + 0.3 * sin(uTime * 1.4 + vSeed * 9.0);
  #endif
  gl_FragColor = vec4(col, a * uOpacity);
}
```

### Material factory

```js
function makeParticleMaterial(kind, params, renderer) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uBaseSize: { value: params.size },
      uColor: { value: new THREE.Color(params.color) },
      uColor2: { value: new THREE.Color(params.color2 ?? params.color) },
      uOpacity: { value: params.opacity },
    },
    defines: { PARTICLE_KIND: PARTICLE_KIND_IDS[kind], /* KIND_EMBER..KIND_DEFAULT enum */ },
    transparent: true,
    depthWrite: false,
    blending: ADDITIVE_KINDS.has(kind) ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader, fragmentShader,
  });
}
```

`uTime` advanced once per frame in `stepParticles`. Existing per-Points `material.opacity` writes (firefly / lichenmote / spark twinkle) move into the shader; behavior unchanged.

### Dust kicks (new effect)

Cheap once the infra is in place.

- `stepCreature` detects rising-edge footsteps **per foot index**. For each foot `i`, compute `s = Math.sin(c.bob + phases[i])`. Track previous value as `c.lastFootSin[i]`; emit when `s > 0.85 && c.lastFootSin[i] <= 0.85` and the foot is on dry ground (`heightFn(x, z) > 0.1`). Then `c.lastFootSin[i] = s`. This way emissions are tied to individual foot strikes, not the body's overall bob phase.
- `emitDustKick` pushes a small `THREE.Points` (4 particles, 0.5s life, low spread, biome-tinted) to a new `state.dustKicks` array.
- `stepDustKicks` mirrors `stepDirtPuffs` exactly — gravity, fade, dispose on expiry.
- Only fires for walkers (not fliers/fish). Cooldown per-creature to avoid bursts (`c.lastDustAt = t; only emit if t - lastDustAt > 0.18`).

---

## 5. Grass density + tip color

**File:** `src/environment.js / makeGrassField`

- Bump grass `_coverScale` gain from `1.7` → `2.8`.
- Add a per-vertex `aTipFactor` BufferAttribute on the blade geometry: base verts get `0.0`, top verts get `1.0`. (The blade plane already has 3 height segments — bottom row gets 0, top row gets 1, interpolating naturally.)
- Patch the standard material via `onBeforeCompile` alongside `applyWindSway` to mix tip color in the fragment based on `vTipFactor`. Tip color = base offset by HSL `+0.0, -0.15, +0.18` (sun-bleached).
- Per-blade hue variation via `InstancedMesh.setColorAt` with HSL jitter (±0.04H, ±0.05L). Material gets `vertexColors: true` and three's instancing pipeline picks up `instanceColor` automatically.

---

## 6. Soft creature shadows

**File:** `src/shadows.js`

### Shared texture

Module-level `CanvasTexture` (128×128 radial gradient, white → transparent, mirrors the cloud-texture pattern in `sky.js`).

### Constructor

`makeShadowDisks()`:
- `PlaneGeometry(1, 1).rotateX(-Math.PI / 2)`.
- `InstancedMesh` sized to `Math.max(64, state.creatures.length + state.caterpillars.length + 16)` for slack.
- Material: `MeshBasicMaterial` with the shared texture, `transparent: true`, `depthWrite: false`, `opacity: 0.45`, color = `biome.fog` darkened by `-0.4 L` so shadows tint with biome.
- Built in `generateWorld` after creatures/caterpillars are placed, parented to `state.world`. `disposeGroup` covers cleanup.

### Per-frame step

`stepShadowDisks(disks, heightFn)` runs in `animate()` after creature/caterpillar steps:

1. For each `c` in `state.creatures` then `state.caterpillars`:
   - pos = `(c.group.position.x, heightFn(x, z) + 0.02, c.group.position.z)`
   - For walkers / caterpillars: `scale = c.scale * 1.6` (caterpillar uses `0.7 * c.scale` for head segment, smaller per body segment).
   - For fliers: hover-aware scale: `c.scale * 1.6 * (1 - clamp(c.currentHover / 3, 0, 0.7))` — soaring creatures cast a tiny, faint disc; perched ones cast a full one.
2. Write `instance.setMatrixAt(i, m)` for each slot. Unused slots get a zero-scale matrix (effectively invisible).
3. `disks.instanceMatrix.needsUpdate = true` at the end.

---

## 7. Water reflection

**File:** `src/reflection.js`

### Approach: clone-scene with shared uniforms

Constructed only when `generateWorld` builds a water plane.

- `THREE.WebGLRenderTarget(256, 256)`. LOWFX → 128×128.
- A dedicated `THREE.Scene reflectionScene` built at init.
- At world-build time, the sky dome / starfield / aurora are **cloned** into the reflection scene. Cloned meshes share `material.uniforms` with their main-scene counterparts so updates flow through naturally.
- A `PerspectiveCamera` mirrored across `y = 0` each frame (position.y negated; rotation around X axis flipped).

### Material patch

The water material in `environment.js` gets an `onBeforeCompile` patch:
- New uniforms: `uReflTex` (the RT texture), `uInvViewport` (1 / screen size, updated on resize).
- Fragment samples `texture2D(uReflTex, gl_FragCoord.xy * uInvViewport)`, mixes 30% into the base color via Fresnel factor `pow(1.0 - max(0.0, dot(N, V)), 2.0)` so the reflection is strongest at glancing angles.

### Per-frame update

`updateWaterReflection(renderer, camera, controls)` called in `animate()` *before* the main render. Mirror the camera across the y=0 plane (matches the water plane at `y = -0.12`; close enough for a stylized reflection):

```js
// position: mirror across y=0
reflectionCamera.position.set(camera.position.x, -camera.position.y, camera.position.z);
// look at the mirrored orbit target
reflectionCamera.up.set(0, -1, 0); // up vector flips because we're underneath
reflectionCamera.lookAt(controls.target.x, -controls.target.y, controls.target.z);
reflectionCamera.up.set(0, 1, 0); // restore for any other consumers
// copy projection from the main camera so FOV/aspect/near/far match
reflectionCamera.projectionMatrix.copy(camera.projectionMatrix);
reflectionCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

renderer.setRenderTarget(rt);
renderer.clear();
renderer.render(reflectionScene, reflectionCamera);
renderer.setRenderTarget(null);
```

One extra render pass per frame, sky-only at 256² — cheap.

---

## 8. Mountain parallax

**Files:** `src/world.js` (capture base position), `main.js` (per-frame update)

- In `generateWorld`, after `state.mountains = makeMountainBackdrop(biome)`, store `state.mountainBasePos = state.mountains.position.clone()`.
- In `animate()`:

```js
if (state.mountains && state.mountainBasePos) {
  const az = Math.atan2(camera.position.x, camera.position.z);
  state.mountains.position.x = state.mountainBasePos.x - Math.sin(az) * 0.6;
  state.mountains.position.z = state.mountainBasePos.z - Math.cos(az) * 0.6;
}
```

The negative sign creates parallax: mountains drift opposite to camera orbit, reading as "farther away" than the islands. Amplitude `0.6` is subtle — tunable.

---

## 9. State additions

`src/state.js`:

```js
shadowDisks: null,
waterReflection: null,   // { rt, camera, scene }
mountainBasePos: null,
dustKicks: [],
userSettings: {
  ...existing,
  bloom: true,
  tiltShift: false,
},
```

`localStorage` persistence in `ui.js` extends the existing settings save/restore pattern.

---

## 10. Testing & verification

No automated tests in this project (per `CLAUDE.md`). Verification:

1. `make restart`, open `localhost:1999` in agentchrome.
2. Regenerate ≥ 15× to cycle biomes and hit every flag combination (`water`, `glowFlowers`, `glowEyes`, `fuzzy`).
3. Per-feature checks:
   - **Post-FX**: toggle each — bloom visible on emissive biomes, tilt-shift sharpness band centered on the island.
   - **Fur**: regenerate until a `fuzzy: true` biome lands; visible fur layers on walkers, no fur on fliers/fish, no leaked geometry on regen.
   - **Particles**: each kind renders, embers fade-and-shrink, rain reads as streaks, firefly twinkles.
   - **Grass**: density bump visible, tip color reads as lighter, per-blade hue variation subtle.
   - **Shadows**: walkers cast a soft disc, fliers cast a smaller one, no z-fighting.
   - **Reflection**: water shows tinted sky color shifting at dusk/dawn, sun visible as a soft bright patch.
   - **Parallax**: orbit slowly — mountains drift opposite to islands.
4. LOWFX (`?lowfx=1`): everything still renders, no fur, no PP, reduced particle counts.
5. Photo mode: P then S — PNG includes PP effects.
6. Perf sanity in agentchrome DevTools: < 16 ms/frame on a fuzzy biome at default density.

---

## 11. Out of scope

- Caves / arches, procedural island names, hidden landmarks, weather systems, audio, time-of-day scrubber, postcard export, seasonal overlay (separate `ideas.md` sections).
- Volumetric fog, screen-space reflections, real fur with strand attributes.
- Editor / live-tuning UI for the new params.
- Removing existing items from `ideas.md` (handled at commit time per the enhancement workflow).
