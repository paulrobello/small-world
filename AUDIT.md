# small-world audit — 2026-05-13

## Executive summary

- `applyWindSway` (`src/util.js:26-58`) has a broken onBeforeCompile chain check AND applies wind in mesh-local axes for instanced foliage instead of world-space (same bug grass solved). Wildflower instances bend in inconsistent directions.
- The bloom RT shares its `DepthTexture` with the depth pre-pass, then the bloom layer-filtered scene render writes emissive depth into that same shared depth attachment. Values usually match the prepass and don't visibly corrupt downstream consumers (depthFX, tilt-shift, soft particles), but the design is fragile and only works because both passes rasterize the same geometry. Documented hazard; not currently breaking.
- The bloom comment block (`src/postfx.js:218-222`, repeated in `src/ui.js:774`) claims darkBiome biomes "interact poorly with UnrealBloomPass" — but the codebase no longer uses UnrealBloomPass. The text is stale; whether the darkBiome blackout still happens in the current custom multipass pipeline is unverified and the `setBloom(...!biome.darkBiome)` gate may be unnecessarily disabling bloom on obsidian/ashen.
- CLAUDE.md says `LOWFX` triggers on touch/small-screen/low-DPR devices; `src/lowfx.js:6` only checks `?lowfx=1`. Either the auto-detect was removed and the docs are stale, or it was never implemented — mobile users get the full FX pipeline and DPR-2 by default.
- Per-frame instanced-buffer updates (`shadows.instanceMatrix`, `grass.uniforms.uPushers`, particle `position`/`aLife`) never call `setUsage(THREE.DynamicDrawUsage)` — driver will heuristically migrate after a few frames but the documented best practice is explicit.
- `stepShadowDisks` (`src/shadows.js:58-104`) rewrites every slot every frame with `Matrix4.compose` even for stationary caterpillars and zero-scale unused slots — `~64×` matrix recomputes per frame regardless of motion.

## Critical issues

### 1. `applyWindSway` onBeforeCompile chain test is dead code
**File:** `src/util.js:26-29`

```js
const prev = material.onBeforeCompile;
material.onBeforeCompile = (shader) => {
  if (prev && prev !== material.onBeforeCompile) prev(shader);
```

`prev` captures the pre-assignment value, then the next line replaces `material.onBeforeCompile` with the new closure. By the time the closure runs (at first compile), `material.onBeforeCompile` IS the new function, so `prev !== material.onBeforeCompile` is **always true** (or `prev` is null/undefined). The guard does nothing. Either it should be removed for clarity, or the intent was to detect recursive self-reference (`prev === material.onBeforeCompile` shortcut at capture time) — in which case the guard should be `prev && prev !== arguments.callee` or just `if (prev) prev(shader);` because `prev` is guaranteed to be a different function than the new closure.

**Impact:** none today (no self-reference scenarios exist). But it's misleading; a future reader may assume the chain logic is doing something subtle.

**Fix:** replace with `if (prev) prev(shader);` and drop the comparison.

### 2. `applyWindSway` bends in mesh-local axes for InstancedMesh
**File:** `src/util.js:41-52`

The shader patch computes wind animation values `w1`, `w2` using world-space `wp.x/wp.z` (correct — wind noise is in world coords) but writes the displacement to `transformed.x` / `transformed.z`, which are mesh-local. For an `InstancedMesh` with random per-instance Y yaw (wildflower fields), `transformed.x` for one instance maps to a different world axis than for its neighbor. Each yawed wildflower bends along its own rotated local-X, so a field of 200 wildflowers reads as "every flower is swaying randomly" rather than "the wind is blowing in a coherent direction."

The grass shader solved exactly this in `src/grass.js:155-181` by inverse-rotating the world-space bend delta through the instance's XZ basis (`axW`/`azW`/`invXZScaleSq`). The same fix should be applied here.

**Impact:** wildflower fields look incoherent / busy. Probably reads as "lots of motion" rather than "wind blowing through" — cute-aesthetic risk per the project vibe ("smooth, easeful motion, never twitchy").

**Sketch:**

```glsl
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vec2 axW = vec2(instanceMatrix[0].x, instanceMatrix[0].z);
  vec2 azW = vec2(instanceMatrix[2].x, instanceMatrix[2].z);
  float invXZScaleSq = 1.0 / max(dot(axW, axW), 1e-6);
#else
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec2 axW = vec2(1.0, 0.0);
  vec2 azW = vec2(0.0, 1.0);
  float invXZScaleSq = 1.0;
#endif
// ...sin computation as before...
vec2 windWorld = vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05);
transformed.x += dot(axW, windWorld) * invXZScaleSq;
transformed.z += dot(azW, windWorld) * invXZScaleSq;
```

### 3. Stale `darkBiome` rationale + possibly-unneeded bloom gate
**Files:** `src/postfx.js:218-222`, `src/world.js:223`, `src/ui.js:774-778`

The justification comment ("UnrealBloomPass" precision loss on HalfFloat) refers to a pass that's no longer in this pipeline. The current pipeline does an additive composite (`base + bloom * uStrength` in `_bloomCompositeShader`) on the LDR-output side after tone mapping has already been applied by the RenderPass. For very dark biomes, the **base** values are small but non-negative; adding a bloom value (which is itself bounded to the emissive contribution) shouldn't crush anything to black.

Worth re-testing the obsidian/ashen biomes with `setBloom(true)` and confirming whether the blackout still happens. If not, drop the gate — currently the user can never see glow eyes / obsidian shard halos / volcanic-glass embers blooming, which is exactly the visual feature those biomes need.

**Impact:** medium — possibly a feature that's silently disabled by stale guard code.

### 4. `stepCaterpillar` early-returns on `dt <= 0` but caterpillar group rotation is also frozen
**File:** `src/fauna/caterpillar.js:258`

`if (dt <= 0) return;` is correct for trail / movement / slope tilt to not advance. But the head's `head.rotation.x/.z` (slope tilt) was already lerped to a previous frame's value. When the sim resumes, the slope-tilt re-targets and lerps over a few frames. Not a bug, just a thing to be aware of. No action needed.

### 5. Reflection scene has shared materials with `state.world` that get disposed mid-regen
**File:** `src/reflection.js:23-44`, `src/world.js:183-189`

In `generateWorld`:
1. `disposeGroup(state.world)` disposes the live sky dome material, starfield material, aurora curtain materials.
2. `state.waterReflection.rt.dispose()` disposes the RT.
3. `state.waterReflection = null` — drops the JS ref to the reflection scene. The reflection scene's cloned meshes still reference the now-disposed materials, but they'll be GC'd because nothing else holds them.

This works **only** because no frame renders between step 1 and step 3. If anything ever caused `updateWaterReflection` to run mid-regen (e.g. another async-rendered debug overlay), it would crash sampling disposed GPU resources. Not currently broken.

**Fix (optional, defensive):** explicitly null the reflection scene's contents at the top of dispose: `state.waterReflection.scene.clear(); state.waterReflection.scene = null;`. Or move the RT.dispose() into a helper that also clears the scene.

### 6. MAX_PUSHERS is duplicated between JS and GLSL
**File:** `src/grass.js:18` and `src/grass.js:129`

```js
const MAX_PUSHERS = 40;          // JS
#define MAX_PUSHERS 40           // GLSL
```

Changing one without the other gives a silent shader index-out-of-bounds (the JS side is the size of the uniform array; GLSL's `for (int pi = 0; pi < MAX_PUSHERS; pi++)` would walk past the end). Fix: inject the constant into the shader via string-replace from the single JS source.

```js
.replace("#define MAX_PUSHERS 40", `#define MAX_PUSHERS ${MAX_PUSHERS}`)
```

Or build the GLSL with template literals so `MAX_PUSHERS` from JS is the only declaration. Low-priority but cheap.

## High-value optimizations

### A. Use `THREE.DynamicDrawUsage` on per-frame-updated buffers
**Files:** `src/shadows.js`, `src/grass.js` (uPushers is a uniform array not buffer, so not applicable), `src/environment.js` (particles, puffs, kicks, fly swarms), `src/fauna/caterpillar.js` (none — segments move via mesh position, not buffer)

Three.js defaults BufferAttributes to `StaticDrawUsage`. WebGL drivers will heuristically migrate to streaming after a few frames of `needsUpdate = true`, but you eat a one-shot driver-side migration cost and possibly worse upload paths. Explicit `setUsage(THREE.DynamicDrawUsage)` at construction time documents intent and avoids the heuristic.

**Expected win:** ~0.1-0.3 ms on the first frame after world regen; negligible steady-state. Mostly a hygiene win.

```js
// shadows.js makeShadowDisks
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

// environment.js makeParticles
geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
geo.attributes.aLife.setUsage(THREE.DynamicDrawUsage);
```

### B. Skip `setMatrixAt` for zero-scale shadow disc slots
**File:** `src/shadows.js:102-103`

```js
for (; i < cap; i++) disks.setMatrixAt(i, _ZERO);
disks.instanceMatrix.needsUpdate = true;
```

This rewrites every unused slot to `_ZERO` every frame. The matrix data hasn't changed since the previous frame (still `_ZERO`). Track a high-water mark `maxUsedLastFrame` and only zero slots from `i` to `maxUsedLastFrame`, then advance `maxUsedLastFrame = i` for next frame.

**Expected win:** ~3-6 KB/frame of unnecessary matrix data and zero-fills. Tiny in absolute terms, but reduces shadow-disc CPU cost to roughly 1/3 when creature count is well below cap (the common case — 16-creature biome with cap=80+).

### C. The per-creature `MeshStandardMaterial` count is high
**File:** `src/fauna/creature.js`

Each creature builds 8-12 unique `MeshStandardMaterial` instances (body, belly, eye, pupil, antenna stalk, antenna tip, fin, leg, foot, wing, dangle, ...). With 6-18 creatures per world, that's roughly **100-200 unique materials** for fauna alone, each compiling its own program (Three.js caches by program key, so most actually share programs — but the material objects themselves are unique and each gets its own UniformsCache entry).

The materials differ only by `color` and `emissive`. A common pattern is to use `vertexColors` per-mesh and bake the tint into geometry colors, or to use a small set of pooled materials with the color varied via `mesh.userData` + `onBeforeCompile` uniform — but that's complex for a 30-line refactor.

**Cheaper win:** share the eye, pupil, leg, foot materials across all creatures of a single regen via the existing `_pool` pattern from `flora.js`. Eyes are always white, pupils always black (or biome-accent for glowEyes). Currently each creature builds independent ones.

**Expected win:** 60-100 fewer materials per regen, fewer ProgramCache misses on first frame after regen, marginally less GC pressure on disposeGroup.

### D. `EffectComposer` ping-pong RT2 may still leak its cloned DepthTexture
**File:** `src/postfx.js:440-444`

```js
if (bloomComposer.renderTarget2.depthTexture &&
    bloomComposer.renderTarget2.depthTexture !== depthTexture) {
  bloomComposer.renderTarget2.depthTexture.dispose();
  bloomComposer.renderTarget2.depthTexture = depthTexture;
}
```

Good — this disposes the orphan. But on `onResize`, `bloomComposer.setSize(pw, ph)` will internally call `renderTarget.setSize(pw, ph)` on both RTs. `setSize` does NOT re-clone the depth texture (it just resizes the existing one), so the shared `depthTexture` gets resized once for RT1 and once for RT2 — same texture, no leak, but two redundant resize calls. Fine.

However, `depthRT.setSize(pw, ph)` is also called in `onResize`. That resizes the same `depthTexture` a third time in the same call. Harmless but redundant. No fix needed.

### E. Bloom RT could be half-resolution
**File:** `src/postfx.js:418-434`, comments at `src/postfx.js:375-380`

The comment justifies full-resolution bloom RT because "shared depth attachments require matching dimensions." That's correct given the current design (depth-occluded emissives). But:

- The depth occlusion gives glow-eye-behind-tree a visible boundary. Could you instead render the layer-1 scene at half-res WITHOUT depth occlusion, accepting that emissives behind trees would bleed through? For a stylized, cute aesthetic this is often a feature, not a bug — distant glow flowers "shine through" intervening foliage and read as bright. Worth A/B testing.

- Half-resolution bloom would cut bandwidth ~4× and tap count linearly with res. At 1080p with DPR=2 → 4K physical, that's significant. Single biggest fragment-bound cost in the pipeline.

**Expected win:** -40% to -60% of the bloom pipeline's GPU time on integrated GPUs. Visual cost: distant emissives no longer occlude correctly. Probably an acceptable trade for the project's aesthetic.

**Risk:** changing this is non-trivial because the shared-depth design is woven into the depth pre-pass + bloom RT + composer chain.

### F. Camera/controls.update + tilt-shift focus allocate per-frame
**File:** `main.js:299`

```js
const v = focusPoint.clone().project(camera);
```

`.clone()` is a `new THREE.Vector3` per frame. Move to a module scratch vec3.

**Expected win:** -1 alloc/frame. Trivial — fix because it's in the hot path next to other scratch reuse patterns the project already follows everywhere else.

### G. Bloom multi-pass: at sliderUnit=3, 8 H+V pairs = 16 fullscreen blurs at physical resolution
**File:** `src/postfx.js:475-510`

At DPR=2, 1080p physical = 4K. 16 full-screen blur passes at 4K is real fragment work — 5 taps each = 80 texture reads per pixel, plus 16 ping-pong copies. On integrated GPUs this is the dominant cost at max bloom radius.

Two cheap options:
1. **Run bloom at half-res** (see E) — cuts the per-pixel cost 4×.
2. **Downsample progressively** (Kawase / dual-filter pattern) — N halving steps then N doubling steps gives a wide blur at far fewer samples. Industry standard for HDR bloom.

For now the slider's default range (≤100% = 3 pairs) is fine; the over-200% case is the expensive one.

## Medium / low priority

### M1. Stale comment about "shallow uniform clone"
**File:** `src/fur.js:7-11`

```js
// The shared uniforms object is mutated each frame; clone() preserves that
// reference automatically when we call material.clone() because ShaderMaterial
// clones uniforms shallowly.
```

Three.js `ShaderMaterial.clone()` calls `UniformsUtils.clone(uniforms)` which **deep-clones** uniforms (it creates new `{value: ...}` objects, but the inner value gets `.clone()`'d if cloneable, otherwise copied by reference). Vector3/Color values inside are deep-cloned. The code at `src/fur.js:118-120` correctly re-binds `uLayers` and `uLightDir` to the shared refs *after* `template.clone()`, which is exactly what's needed because clone broke the shared reference. The comment is wrong about what `clone()` does, but the code does the right thing anyway.

**Fix:** update the comment to: "ShaderMaterial.clone() deep-clones uniforms via UniformsUtils.clone, so we re-bind the shared uniform refs (uLayers, uLightDir) explicitly after cloning."

### M2. CLAUDE.md claims fur shells are hidden on sleepers
**Files:** docs say it; `src/fauna/creature.js` doesn't implement it

CLAUDE.md: "Hidden on sleepers via the wake-cycle paths in stepCreature." There's no `furShells` manipulation in the sleep/wake code paths. Fur shells are children of `body`, so they inherit body's squash (`scale.y = 0.55` while curled). The shells are still rendered, just deformed. May not be visually broken (squashed fur over a squashed body still reads as fur) but the docs over-promise.

**Action:** either implement (`for (const s of c.furShells) s.visible = !sleeping`) or update docs to "Inherit body squash, not explicitly hidden."

### M3. LOWFX is only `?lowfx=1`, not auto-detected
**File:** `src/lowfx.js:6`

CLAUDE.md says: "true on touch / small-screen / low DPR devices, or `?lowfx=1` URL param." Only the URL param is checked. Auto-detect would be:

```js
const auto =
  navigator.maxTouchPoints > 0 ||
  window.innerWidth < 768 ||
  (window.devicePixelRatio || 1) < 1;
export const LOWFX = _params.get("lowfx") === "1" || auto;
```

Whether to add this is a product call — mobile users currently get the full FX pipeline + DPR cap at 2, which on a mid-tier phone could be ~10 fps with bloom on. Either implement the auto-detect or update CLAUDE.md to remove the claim.

### M4. `disableFade = true` uses a magic `1e6` sentinel
**File:** `src/grass.js:92-93`

```js
uFadeStart: { value: disableFade ? 1.0e6 : (LOWFX ? 30.0 : 45.0) },
uFadeEnd:   { value: disableFade ? 1.0e6 + 1.0 : (LOWFX ? 55.0 : 85.0) },
```

`smoothstep(1e6, 1e6+1, dist)` is fine for any sub-million distance, but it's a slightly icky pattern. Cleaner: a separate `uFadeEnabled` uniform that gates the fade computation. Same cost, more readable.

### M5. Per-frame `controls.target.clone()` and tilt-shift focus allocation
**File:** `main.js:299`

Already mentioned in F. Trivial.

### M6. `_bloomCompositeShader` early-out on `uStrength <= 0.001`
**File:** `src/postfx.js:124-129`

When bloom is off, `bloomCompositePass.enabled = false` already skips the pass entirely (see `src/postfx.js:531`), so the shader's `uStrength <= 0.001` branch is unreachable in production. The branch is a defensive no-op. It's fine, but it costs a sample of `tBloom` regardless because the shader always does `texture2D(tBloom, vUv)` BEFORE the branch test — actually re-reading: the if-return is the FIRST thing, and `tBloom` is sampled only inside the branch after the strength check. OK, this is correctly written.

### M7. `Math.random` monkey-patch and async fragility
**File:** `src/world.js:169-171`, `:640`

`Math.random = mulberry32(seed)` and restore at the end. Any `Promise.resolve().then()` or queued microtask scheduled inside `generateWorld` that calls `Math.random` after restore would silently get non-deterministic values. There's no such code today; this is a future-proofing note. Worth a comment near the patch site.

### M8. `_zTexture` and `_shadowTex` are never disposed
**Files:** `src/fauna/creature.js:23-43`, `src/shadows.js:7-22`

Session-singleton textures. Held forever, by design (cheap, reused across regens). Fine — but flag as "intentional leak; one-time alloc per session."

### M9. Tilt-shift jitter uses `fract(sin(dot(...)) * 43758)`
**File:** `src/postfx.js:215`

```glsl
float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
```

This noise pattern is famous for producing banding on Adreno (mediump) and Mali GPUs due to precision loss in the multiply. The pass is declared `precision highp float;` so it's likely fine on those, but worth confirming on a real mobile device. If banding shows up, replace with a cheap stable noise (interleaved gradient noise, or hash-of-pixel-coord without the sin).

### M10. `if (biome.id === "desert")` instead of a flag
**File:** `src/world.js:557`

Per CLAUDE.md's biome-flag pattern, this should be `if (!biome.butterflies)` or `if (biome.noFlowers)`. Trivial.

### M11. Shadow disc has runtime-tinted material but no per-creature variation
**File:** `src/shadows.js:38-47`

The shadow tint is biome-fog-derived and uniform across creatures. Fine; not a bug. Mentioned just to note that if you ever want per-creature shadow color (e.g. darker for big creatures), the path is `mesh.color` per-instance via `instanceColor`.

### M12. `_particleVS` uses `varying float vViewZ` always, even when soft particles are off
**File:** `src/environment.js:25-48`

The vertex shader unconditionally computes `vViewZ`. The fragment shader only consumes it when `uSoftParticles > 0.5`. Vertex computation cost is minimal (already-computed `mv.z`); the varying interpolation is the only overhead. Could `#ifdef SOFT_PARTICLES` it, but particles are vertex-light, this is bikeshedding.

## Non-issues considered and ruled out

- **Feedback loop on bloom RT depth attachment:** I worried that the layer-filtered bloom render writing depth to a texture that's also read by depthFXPass would corrupt the depth values. In practice, the emissive meshes write the SAME Z values they did in the prepass (since they're the same geometry), so values are identical. Not currently visible. The design is fragile but works.

- **Tilt-shift gamma-space blur** (`src/postfx.js:188-191`): the `toGamma` / `fromGamma` (sqrt encode / square decode) is mathematically correct for the perceptual-blur goal and significantly cheaper than `pow(c, 1/2.2)`. The implementation is sound. Good call.

- **Bloom `HalfFloatType` choice:** correct for HDR headroom on emissive halos with linear values >1. Comment in `src/postfx.js:422-425` matches the implementation. Confirmed not a precision bug.

- **`UniformsUtils.clone` semantics in `_blurShader`:** the code correctly re-points `uRadius` to the shared reference (`src/postfx.js:480`) after `new ShaderPass(...)` deep-clones. Tested pattern.

- **Camera layer-mask save/restore for bloom:** correctly bracketed (`src/postfx.js:612-619`). The `prevLayerMask` capture and restore is the right idiom; no leak.

- **EffectComposer's `_pixelRatio = 1` when given a custom RT:** correctly handled — `onResize` multiplies dimensions by `renderer.getPixelRatio()` for the bloom RT, depth RT, and blur shader resolution uniforms (`src/postfx.js:625-637`).

- **Shared `windUniforms.uTime` freezing on wind off:** correctly implemented — `main.js:183-185` gates time advance; grass's `uWindStrength` separately zeroed via `_reapplyWindSettings`. CLAUDE.md's claim about needing both matches the code.

- **`onBeforeCompile` chain in `makeWaterPlane` (`src/environment.js:708-710`):** correctly captures `prev` before reassignment and calls it inside the new closure. Different pattern from the broken one in util.js — this one works because no second `onBeforeCompile` is added to the water material today, but if it were, the chain is correct.

- **Caterpillar `dt <= 0` early return:** correctly handles photo-mode pause; the comment at `src/fauna/caterpillar.js:253-258` explains why this matters specifically (trail would fill with duplicates if not). Good.

- **Sleep/wake `wakeProgress` reset for natural sleepers:** correctly reset in `wakeCreature` (`src/fauna/creature.js:519-522`); comment matches.

- **Mountain parallax position math:** correctly does base + camera-derived offset (`main.js:244-248`) without per-frame allocation.

- **Sky dome and starfield following camera:** correctly divides by worldScale (`main.js:234-240`).

- **Determinism window:** `generateWorld` patches `Math.random` synchronously, and all builders run synchronously before restore. Per-instance random scale/yaw inside `placeInstanced`, `pickGroundPoint`, etc. all happen inside the window. Verified.

## Open questions for the maintainer

1. **darkBiome bloom blackout** — is it actually still happening with the current custom multipass bloom (not UnrealBloomPass)? If not, the gate at `src/world.js:223` should drop the `!biome.darkBiome` clause, restoring bloom to obsidian and ashen biomes (where it would actually look great on glow eyes, obsidian shards, and ember particles).

2. **LOWFX auto-detect** — was the auto-detect intentionally removed, or never written? CLAUDE.md claims it exists. If it's not coming back, update docs; if it should exist, the implementation is one line in `src/lowfx.js`.

3. **Mobile testing budget** — what DPR / device class does the project actually target? Currently `renderer.setPixelRatio(Math.min(devicePixelRatio, LOWFX ? 1 : 2))` and a full bloom+depth-FX pipeline. On mid-tier phones at DPR=2 with 8 bloom passes at native res, this is likely sub-30fps. Worth confirming whether mobile users opt into `?lowfx=1` manually or are expected to.

4. **Fur shell on sleepers** — should they be hidden during sleep (per docs), or stay visible squashed (per current code)? Visually it might be fine either way; want to verify intent.

5. **Wildflower bend incoherence** — is the current per-instance random bend acceptable as "lots of motion," or should it be unified into a coherent wind direction (matching grass)? The grass-style fix is straightforward but changes the look.

6. **Per-creature material pooling** — willing to share eye/pupil/leg/foot materials across creatures within a regen? Reduces material count by ~60-100 per world. Tradeoff: kid creatures might get exactly the same eye shade as their parent, which is probably fine.

7. **Bloom at half-resolution** — willing to give up the depth-occluded emissive (glow-eye-behind-tree culling) in exchange for ~4× cheaper bloom on integrated GPUs? Big perf win on the FX pipeline's dominant cost.
