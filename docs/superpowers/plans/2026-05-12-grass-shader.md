# Grass Shader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `makeGrassField` with a custom-shader `InstancedMesh` that supports per-blade procedural-noise wind (no lockstep), camera-distance fade (so total density can rise without paying full fragment cost everywhere), and CPU-side density/clump noise for clumping and bald spots.

**Architecture:** New module `src/grass.js` owns the grass material, geometry, placement, and `stepGrass(camera)` per-frame uniform updater. `environment.js` re-exports `makeGrassField` from there so existing imports keep working. `state.grass` holds the field reference for per-frame access. `applyWindSway` in `util.js` is untouched — only grass gets the new shader.

**Tech Stack:** Three.js (CDN, importmap, no build), `simplex-noise` (already in importmap), `MeshStandardMaterial.onBeforeCompile` for shader patching. No tests — this project has no test framework. Verification is visual via `agentchrome` against `make start` on `http://localhost:1999`.

**No-test note:** Each task ends with an explicit visual verification step (loading a URL in a headless Chrome via agentchrome, screenshotting, and checking for the named visual property). Reload is enough — server returns `Cache-Control: no-store`.

---

## File Structure

| File                | Role                                                                               |
|---------------------|------------------------------------------------------------------------------------|
| `src/grass.js`      | NEW. Owns `makeGrassField`, `stepGrass`, the patched material, and placement noise. |
| `src/environment.js`| Remove `makeGrassField` body; re-export from `grass.js`.                            |
| `src/state.js`      | Add `grass: null` to state singleton.                                              |
| `src/world.js`      | Clear `state.grass = null` at top of `generateWorld`; assign after build.          |
| `src/biomes.js`     | Add `BALD_THRESHOLD` table next to `GRASS_DENSITY`.                                |
| `main.js`           | Import `stepGrass`; call once per frame in `animate()`.                            |

---

## Task 1: Add `BALD_THRESHOLD` table to biomes.js

**Files:**
- Modify: `src/biomes.js` (add new export adjacent to `GRASS_DENSITY`)

- [ ] **Step 1: Locate `GRASS_DENSITY` and add `BALD_THRESHOLD` just below it**

Find the `GRASS_DENSITY` export block. After it, add:

```js
// Per-biome rejection threshold for the grass density noise. Blades whose
// underlying noise sample at world XZ falls below this threshold are not
// placed, producing bald patches. Range [0, 1]. Higher = balder. Biomes
// without an override use 0.32. Lush biomes go lower; sparse/dry biomes
// go higher so the field reads as patchy.
export const BALD_THRESHOLD = {
  verdant: 0.22,
  meadow: 0.24,
  twilight: 0.30,
  glacial: 0.42,
  dunes: 0.50,
  ashen: 0.55,
  obsidian: 0.50,
};
```

(Biome ids referenced match existing `BIOMES` entries — verify each id exists; if a listed id has been renamed since this plan was written, drop that entry rather than reach for the renamer.)

- [ ] **Step 2: Visual sanity (no functional change yet — just confirm the file still parses)**

Run: `make restart && make logs | head -20`
Expected: server starts, no syntax error on page load.

Then in a fresh shell:
```bash
agentchrome connect --launch --headless
agentchrome navigate "http://localhost:1999/" 2>&1 | tail -1
agentchrome page screenshot --file /tmp/grass-t1.png
```
Expected: page loads (`status: 200`), screenshot shows a normal world. No console errors.

Optional console check:
```bash
agentchrome console history --max 20 2>&1 | tail -20
```
Expected: no `BALD_THRESHOLD` import error (the import doesn't happen yet — this is just confirming the new export doesn't break the existing parse).

- [ ] **Step 3: Commit**

```bash
git add src/biomes.js
git commit -m "Biomes: BALD_THRESHOLD table for upcoming grass density noise"
```

---

## Task 2: Add `grass: null` to state.js

**Files:**
- Modify: `src/state.js` (add a field to the `state` singleton)

- [ ] **Step 1: Add the field**

In `src/state.js`, inside the `state` object, add `grass: null` near the other module refs. The cleanest spot is just below `dustKicks: []` and above `postfx: null` (any spot works — match the existing comment grouping). Concretely add:

```js
  // Set by makeGrassField in src/grass.js. Holds { mesh, uniforms } so
  // stepGrass can update uCameraXZ each frame and disposeGroup-style
  // teardown can null it out on regen. Mesh itself is parented to
  // state.world so disposeGroup handles its GPU resources.
  grass: null,
```

- [ ] **Step 2: Visual sanity (no behavior change yet)**

```bash
agentchrome navigate "http://localhost:1999/" 2>&1 | tail -1
agentchrome page screenshot --file /tmp/grass-t2.png
```
Expected: page loads cleanly, screenshot identical to Task 1.

- [ ] **Step 3: Commit**

```bash
git add src/state.js
git commit -m "State: add grass ref slot for upcoming grass shader module"
```

---

## Task 3: Create `src/grass.js` skeleton — same behavior as today, but in its own module

This is intentionally a parity step: move the existing grass logic into the new file with the existing shader (still using `applyWindSway`). No new features yet. This isolates the move from the shader rewrite so any regression is bisectable.

**Files:**
- Create: `src/grass.js`
- Modify: `src/environment.js:530-608` (remove `makeGrassField` body, leave a re-export)

- [ ] **Step 1: Create `src/grass.js`**

```js
import * as THREE from "three";
import { state, DENSITY_BASE } from "./state.js";
import { pickGroundPoint } from "./terrain.js";
import { GRASS_DENSITY } from "./biomes.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";
import { applyWindSway } from "./util.js";

const _lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);
const _coverScale = (n, gain = 1) =>
  _lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));

export function makeGrassField(biome, heightFn) {
  const count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, 2.8);

  const blade = new THREE.PlaneGeometry(0.06, 0.34, 1, 3);
  const bp = blade.attributes.position;
  const tipCount = bp.count;
  const tipFactors = new Float32Array(tipCount);
  for (let i = 0; i < tipCount; i++) {
    const y = bp.getY(i) + 0.17;
    bp.setY(i, y);
    const taper = 1 - Math.min(1, y / 0.34) * 0.6;
    bp.setX(i, bp.getX(i) * taper);
    tipFactors[i] = Math.min(1, y / 0.34);
  }
  blade.setAttribute("aTipFactor", new THREE.BufferAttribute(tipFactors, 1));
  blade.computeVertexNormals();

  const baseCol = new THREE.Color(biome.ground[1]).offsetHSL(
    (Math.random() - 0.5) * 0.04, 0.1, -0.08
  );
  const tipCol = baseCol.clone().offsetHSL(0.0, -0.15, 0.18);

  const mat = new THREE.MeshStandardMaterial({
    color: baseCol,
    roughness: 0.95,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const tipUniforms = { uTipColor: { value: tipCol } };
  const prevOnBeforeCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prevOnBeforeCompile) prevOnBeforeCompile(shader);
    shader.uniforms.uTipColor = tipUniforms.uTipColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aTipFactor;\nvarying float vTipFactor;"
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvTipFactor = aTipFactor;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTipColor;\nvarying float vTipFactor;"
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTipColor, vTipFactor * 0.85);"
      );
  };
  applyWindSway(mat, 1.8);

  const mesh = new THREE.InstancedMesh(blade, mat, count);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 5) {
    attempts++;
    const p = pickGroundPoint(0.88);
    const x = p.x;
    const z = p.z;
    const y = heightFn(x, z);
    if (y < -0.15) continue;
    v.set(x, y, z);
    s.setScalar(0.6 + Math.random() * 0.8);
    e.set(
      (Math.random() - 0.5) * 0.18,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.18
    );
    q.setFromEuler(e);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed, m);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;

  const colors = new Float32Array(mesh.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    tmp.copy(baseCol).offsetHSL(
      (Math.random() - 0.5) * 0.08,
      0,
      (Math.random() - 0.5) * 0.10
    );
    colors[i * 3 + 0] = tmp.r / baseCol.r || 1;
    colors[i * 3 + 1] = tmp.g / baseCol.g || 1;
    colors[i * 3 + 2] = tmp.b / baseCol.b || 1;
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  mesh.instanceColor.needsUpdate = true;

  state.grass = { mesh, uniforms: tipUniforms };
  return mesh;
}

export function stepGrass(_camera) {
  // No-op in skeleton task — uniforms aren't camera-dependent yet.
  // Real implementation lands in Task 5.
}
```

- [ ] **Step 2: In `src/environment.js`, delete the body of `makeGrassField` (lines ~530-608 inclusive) and replace with a re-export**

The block to delete starts at `export function makeGrassField(biome, heightFn) {` and ends at the closing `}` of that function (the next function `makeWildflowerField` should remain untouched).

Replace the deleted block with:

```js
export { makeGrassField } from "./grass.js";
```

Place that re-export wherever the function was. Confirm no other code in `environment.js` references locals that were used only by `makeGrassField`.

- [ ] **Step 3: World cleanup — clear `state.grass` at top of regen**

In `src/world.js`, inside `generateWorld`, find where other state refs are nulled at the top (look for `state.waterMesh = null`, `state.particles = null`, etc.). Add `state.grass = null;` next to them. If no such block exists, add one just after the `disposeGroup(state.world)` call.

- [ ] **Step 4: Add `stepGrass` import in `main.js` (no-op call this task)**

In `main.js`, add to the existing `environment.js` import line:

```js
import { stepParticles, stepWater, stepDirtPuffs, stepDustKicks } from "./src/environment.js";
import { stepGrass } from "./src/grass.js";
```

Then in `animate()`, after the existing `state.windUniforms.uTime.value = t;` line in the non-INSPECT branch (~line 163), add:

```js
    stepGrass(camera);
```

It's a no-op for now but wiring it in this task means Task 5's change is a one-line uniform update only.

- [ ] **Step 5: Visual parity verification**

```bash
make restart
sleep 2
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t3-after.png
```

Open `/tmp/grass-t3-after.png` and confirm the grass looks identical to a screenshot of the pre-refactor build. If you didn't capture a "before" screenshot, regenerate a few seeds (`?seed=0x12ee`, `?seed=0x3f2a`, `?seed=0x7b00`) and confirm:
- Grass blades present.
- No visible bald spots from the noise (we haven't added density noise yet).
- Wind sway looks like today's sway (a soft uniform rocking).
- No console errors.

Console check:
```bash
agentchrome console history --max 30 2>&1 | tail -30
```
Expected: no errors related to `grass.js` or `makeGrassField`.

- [ ] **Step 6: Commit**

```bash
git add src/grass.js src/environment.js src/state.js src/world.js main.js
git commit -m "Grass: extract makeGrassField into src/grass.js (no behavior change)"
```

---

## Task 4: Replace `applyWindSway` patch with grass-specific procedural-noise wind

This task switches grass from the shared `applyWindSway` to a custom shader injection with 2D value noise sampled at world XZ, traveling over time. Distance fade still NOT in this task — it lands in Task 5. Density/clump noise NOT in this task — lands in Task 6.

**Files:**
- Modify: `src/grass.js`

- [ ] **Step 1: Replace the material setup block**

In `src/grass.js`, find the block that creates `tipUniforms`, sets `mat.onBeforeCompile`, and calls `applyWindSway(mat, 1.8)`. Replace the entire block (from `const tipUniforms = ...` through `applyWindSway(mat, 1.8);`) with:

```js
  // Per-world deterministic wind direction. Drawn inside generateWorld's
  // seeded Math.random window so the same seed reproduces the same wind.
  const wdAngle = Math.random() * Math.PI * 2;
  const uniforms = {
    uTime: state.windUniforms.uTime,                   // shared with rest of world
    uTipColor: { value: tipCol },
    uWindScale: { value: 0.15 },
    uWindSpeed: { value: 0.6 },
    uWindDir: { value: new THREE.Vector2(Math.cos(wdAngle), Math.sin(wdAngle)) },
    uWindStrength: { value: LOWFX ? 0.8 : 1.2 },
    // Camera fade uniforms — wired in Task 5. Carried now so the shader
    // structure stays stable across tasks.
    uCameraXZ: { value: new THREE.Vector2(0, 0) },
    uFadeStart: { value: 9999 },  // disabled in this task
    uFadeEnd: { value: 9999 },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uTipColor = uniforms.uTipColor;
    shader.uniforms.uWindScale = uniforms.uWindScale;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uCameraXZ = uniforms.uCameraXZ;
    shader.uniforms.uFadeStart = uniforms.uFadeStart;
    shader.uniforms.uFadeEnd = uniforms.uFadeEnd;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aTipFactor;
        attribute float aWindSeed;
        varying float vTipFactor;
        uniform float uTime;
        uniform float uWindScale;
        uniform float uWindSpeed;
        uniform vec2  uWindDir;
        uniform float uWindStrength;
        uniform vec2  uCameraXZ;
        uniform float uFadeStart;
        uniform float uFadeEnd;
        float gHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i),             gHash(i + vec2(1.0, 0.0)), u.x),
                     mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vTipFactor = aTipFactor;
        {
          #ifdef USE_INSTANCING
            vec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
          #endif
          vec2 worldXZ = wp4.xz;
          vec2 windFlow = uTime * uWindSpeed * uWindDir;
          float a = gNoise(worldXZ * uWindScale - windFlow);
          float b = gNoise(worldXZ * uWindScale * 2.3 - windFlow * 1.7);
          float gust = 0.7 * a + 0.3 * b;
          float swirl = (gust - 0.5) * 0.6;
          float cs = cos(swirl), sn = sin(swirl);
          vec2 bendDir = vec2(
            uWindDir.x * cs - uWindDir.y * sn,
            uWindDir.x * sn + uWindDir.y * cs
          );
          float amp = aTipFactor * aTipFactor
                    * uWindStrength
                    * gust
                    * (0.75 + 0.5 * aWindSeed);
          transformed.x += bendDir.x * amp * 0.18;
          transformed.z += bendDir.y * amp * 0.18;
        }`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTipColor;\nvarying float vTipFactor;"
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTipColor, vTipFactor * 0.85);"
      );
  };
  mat.needsUpdate = true;
```

- [ ] **Step 2: Pack `aWindSeed` per-instance attribute**

In the same file, after the placement loop completes (right after `mesh.count = placed;` and `mesh.instanceMatrix.needsUpdate = true;`), and before the instanceColor block, insert:

```js
  const windSeeds = new Float32Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) windSeeds[i] = Math.random();
  blade.setAttribute("aWindSeed", new THREE.InstancedBufferAttribute(windSeeds, 1));
```

`InstancedBufferAttribute` on a non-instanced geometry attribute slot works because Three.js automatically treats it as per-instance during instanced draws.

- [ ] **Step 3: Update `state.grass` payload to carry the new uniforms**

Find:
```js
  state.grass = { mesh, uniforms: tipUniforms };
```
Replace with:
```js
  state.grass = { mesh, uniforms };
```

(`tipUniforms` no longer exists as a separate object — it's merged into `uniforms`.)

- [ ] **Step 4: Visual verification — wind variation**

```bash
make restart
sleep 2
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t4-frame1.png
sleep 2
agentchrome page screenshot --file /tmp/grass-t4-frame2.png
```

Open the two screenshots and confirm:
- Grass is still present (same density).
- Wind motion is non-uniform across the field: at any moment, some patches are leaning hard, others are nearly upright. (This is the key qualitative change. With the old shader the whole field swayed nearly in unison.)
- Frame-to-frame motion is smooth (no jitter, no twitching).
- No console errors.

Console:
```bash
agentchrome console history --max 30 2>&1 | tail -30
```
Expected: no GLSL compile errors. If you see "ERROR: 0:N: ..." messages, the shader injection is broken — re-check the injected `<common>` and `<begin_vertex>` strings for missing semicolons or duplicated declarations.

- [ ] **Step 5: Commit**

```bash
git add src/grass.js
git commit -m "Grass: procedural 2D noise wind, per-blade seed for non-lockstep sway"
```

---

## Task 5: Wire camera-distance fade

**Files:**
- Modify: `src/grass.js`

- [ ] **Step 1: Enable real fade values in the uniforms initializer**

In `src/grass.js`, find the placeholder uniforms:
```js
    uFadeStart: { value: 9999 },
    uFadeEnd: { value: 9999 },
```
Replace with:
```js
    uFadeStart: { value: LOWFX ? 12.0 : 18.0 },
    uFadeEnd: { value: LOWFX ? 18.0 : 28.0 },
```

- [ ] **Step 2: Add fade math to the vertex shader**

In the same `mat.onBeforeCompile` block, in the `<begin_vertex>` replacement, after the `transformed.z += bendDir.y * amp * 0.18;` line and before the closing `}`, insert:

```glsl
          float dist = length(worldXZ - uCameraXZ);
          float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
          transformed.y *= fade;
          transformed.x *= mix(1.0, fade, 0.5);  // light XZ pull-in so the fade doesn't leave a flat sliver
          transformed.z *= mix(1.0, fade, 0.5);
```

(The `transformed.y *= fade` line collapses the blade vertically to its base past `uFadeEnd`; the XZ pull-in just keeps the few remaining ground-level fragments tight.)

- [ ] **Step 3: Implement `stepGrass`**

In `src/grass.js`, replace the no-op body of `stepGrass`:

```js
export function stepGrass(camera) {
  if (!state.grass || !camera) return;
  const u = state.grass.uniforms.uCameraXZ.value;
  u.x = camera.position.x;
  u.y = camera.position.z;
}
```

- [ ] **Step 4: Visual verification — orbit reveal**

```bash
make restart
sleep 2
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t5-orbit1.png
```

Then orbit the camera by dispatching a pointer drag and screenshot again:

```bash
agentchrome js exec "const c=document.querySelector('canvas');const r=c.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;c.dispatchEvent(new PointerEvent('pointerdown',{clientX:cx,clientY:cy,bubbles:true,cancelable:true,pointerType:'mouse',button:0,buttons:1}));for(let i=1;i<=20;i++){c.dispatchEvent(new PointerEvent('pointermove',{clientX:cx+i*15,clientY:cy,bubbles:true,cancelable:true,pointerType:'mouse',button:0,buttons:1}));}c.dispatchEvent(new PointerEvent('pointerup',{clientX:cx+300,clientY:cy,bubbles:true,cancelable:true,pointerType:'mouse',button:0,buttons:0}));'done'"
sleep 1
agentchrome page screenshot --file /tmp/grass-t5-orbit2.png
```

Open both screenshots. Confirm:
- Grass is dense in the foreground (close to the orbit center) and dramatically sparser at the far rim of the island.
- Orbiting the camera causes the dense band to follow — the side of the island closer to the camera shows more blade height than the far side.
- The fade is a smooth gradient, not a hard cliff.

If the dense band does NOT track the camera, `stepGrass` isn't being called or `uCameraXZ` isn't reaching the shader. Check `main.js`'s `animate()` for the `stepGrass(camera)` call and confirm the uniform reference in `onBeforeCompile` matches the object on `uniforms`.

- [ ] **Step 5: Commit**

```bash
git add src/grass.js
git commit -m "Grass: camera-distance fade so distant tips skip the rasterizer"
```

---

## Task 6: Density rejection and clump-height noise

**Files:**
- Modify: `src/grass.js`

- [ ] **Step 1: Import `createNoise2D` and `BALD_THRESHOLD`**

At the top of `src/grass.js`, add to the imports:

```js
import { createNoise2D } from "simplex-noise";
import { GRASS_DENSITY, BALD_THRESHOLD } from "./biomes.js";
```

(`GRASS_DENSITY` may already be imported — merge into the existing import line if so.)

- [ ] **Step 2: Replace the placement loop with density rejection + clump-height scaling**

In `makeGrassField`, find the existing placement loop:

```js
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 5) {
    attempts++;
    const p = pickGroundPoint(0.88);
    const x = p.x;
    const z = p.z;
    const y = heightFn(x, z);
    if (y < -0.15) continue;
    v.set(x, y, z);
    s.setScalar(0.6 + Math.random() * 0.8);
    e.set(
      (Math.random() - 0.5) * 0.18,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.18
    );
    q.setFromEuler(e);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed, m);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
```

Replace with:

```js
  // Density and clump noise — two independent fields, both seeded by the
  // monkey-patched Math.random inside generateWorld so the patchwork is
  // deterministic from the seed.
  const densityNoise = createNoise2D();
  const clumpNoise = createNoise2D();
  const baldThreshold = BALD_THRESHOLD[biome.id] ?? 0.32;

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  let placed = 0;
  let attempts = 0;
  // Candidate budget is the configured count * overshoot to absorb the
  // density-mask rejections. Final placed count lands around count * (1 - reject%).
  const candidateAttempts = Math.floor(count * 5);
  while (placed < count && attempts < candidateAttempts) {
    attempts++;
    const p = pickGroundPoint(0.88);
    const x = p.x;
    const z = p.z;
    const y = heightFn(x, z);
    if (y < -0.15) continue;

    // Density rejection — simplex returns [-1, 1], remap to [0, 1].
    const d = densityNoise(x * 0.18, z * 0.18) * 0.5 + 0.5;
    if (d < baldThreshold) continue;

    // Clump-height modulation — taller blades in lush patches, stubbier in thin.
    const cN = clumpNoise(x * 0.35, z * 0.35) * 0.5 + 0.5;
    const baseScale = 0.6 + Math.random() * 0.8;
    const heightMul = 0.55 + 0.9 * cN;

    v.set(x, y, z);
    s.set(baseScale, baseScale * heightMul, baseScale);
    e.set(
      (Math.random() - 0.5) * 0.18,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.18
    );
    q.setFromEuler(e);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed, m);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
```

The candidate-attempts factor of `5` matches the existing `placeInstanced` behavior — covers up to ~80% rejection without starving the field on extreme biomes.

- [ ] **Step 3: Increase candidate count to compensate for rejections + camera fade**

Find:
```js
  const count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, 2.8);
```
Replace with:
```js
  // Overshoot factor bumped from 2.8 → 4.4: covers ~35-50% density-mask
  // rejection and the camera-fade savings let us draw more blades total.
  // LOWFX uses a lower overshoot since the fade band closes in earlier
  // and the GPU budget is tighter.
  const overshoot = LOWFX ? 2.5 : 4.4;
  const count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, overshoot);
```

- [ ] **Step 4: Visual verification — patchiness and seed determinism**

```bash
make restart
sleep 2
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t6a.png
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t6b.png
agentchrome navigate "http://localhost:1999/?seed=0x3f2a" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t6c.png
```

Open the three screenshots. Confirm:
- `t6a` and `t6b` (same seed, two reloads) show the **same** patchwork. Bald spots in identical positions. This validates determinism.
- `t6c` (different seed) shows a **different** patchwork.
- Visible clumps (taller blades) and bald spots (no blades) are present and roughly the size of an in-world creature (~3-6 units across).
- The dense band still tracks the camera (from Task 5).

If determinism fails, the noise instances are being created outside the seeded `Math.random` window — confirm `makeGrassField` is called from inside `generateWorld` (it is, via `world.js:375`) and that no `createNoise2D` calls happen at module load.

- [ ] **Step 5: Cross-biome sanity check**

```bash
agentchrome navigate "http://localhost:1999/?biome=ashen" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t6-ashen.png
agentchrome navigate "http://localhost:1999/?biome=verdant" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t6-verdant.png
```

Confirm:
- `ashen` reads as sparse (high BALD_THRESHOLD → more bald patches).
- `verdant` reads as lush (low BALD_THRESHOLD → fewer bald patches, more density).
- Other biome systems (water, flora, creatures) still look correct in both.

- [ ] **Step 6: Commit**

```bash
git add src/grass.js
git commit -m "Grass: density-noise patchiness, clump-height modulation, higher overshoot"
```

---

## Task 7: LOWFX confirmation pass

This task is verification-only — no code change. Confirms the LOWFX path still hits a sensible budget after all the changes.

- [ ] **Step 1: Load with `?lowfx=1`**

```bash
agentchrome navigate "http://localhost:1999/?lowfx=1&seed=0x12ee" 2>&1 | tail -1
sleep 2
agentchrome page screenshot --file /tmp/grass-t7-lowfx.png
```

Confirm:
- Grass present at reduced density (visibly thinner than non-LOWFX).
- Wind motion still readable (`uWindStrength = 0.8` should give softer but visible sway).
- Fade band closes in tighter (`uFadeEnd = 18` vs. `28`).
- No console errors.

- [ ] **Step 2: FPS spot check via the HUD**

The settings panel has a `showFps` toggle. Load with `?fps=1` *or* toggle the panel via the UI before screenshotting:

```bash
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 3
agentchrome js exec "(async()=>{const s=await import('/src/state.js');s.state.userSettings.showFps=true;return 'ok';})()" 2>&1 | tail -1
sleep 3
agentchrome page screenshot --file /tmp/grass-t7-fps.png
```

Open `/tmp/grass-t7-fps.png` and read the FPS counter (in the HUD). Goal: comfortably above 30 fps on a desktop GPU, ideally above 50. If FPS is unexpectedly low (< 25 on a desktop), the overshoot factor needs trimming — drop `4.4` to `3.5` in Task 6 and re-verify.

- [ ] **Step 3: No commit (verification-only task)**

Mark the task complete; nothing to commit.

---

## Task 8: Final sweep — follow mode, photo mode, day/night

This is the integration sanity check — confirm the new shader doesn't break the existing modes.

- [ ] **Step 1: Follow mode**

```bash
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 3
agentchrome js exec "(async()=>{const ui=await import('/src/ui.js');const s=await import('/src/state.js');if(s.state.creatures.length>0){ui.setFollowTarget(s.state.creatures[0]);return 'following ' + s.state.creatures[0].group.uuid;}return 'no creatures';})()" 2>&1 | tail -1
sleep 3
agentchrome page screenshot --file /tmp/grass-t8-follow.png
```

Confirm: dense grass band sits around the followed creature, not the orbit center. (If `setFollowTarget` isn't exported from ui.js, skip this verification — the manual UI path covers it.)

- [ ] **Step 2: Photo mode (freeze)**

```bash
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 3
agentchrome interact key --key p
sleep 2
agentchrome page screenshot --file /tmp/grass-t8-photo1.png
sleep 2
agentchrome page screenshot --file /tmp/grass-t8-photo2.png
```

Open `t8-photo1` and `t8-photo2`. Confirm they look identical (grass frozen mid-sway because `uTime` isn't advancing).

- [ ] **Step 3: Day/night**

```bash
agentchrome navigate "http://localhost:1999/?seed=0x12ee" 2>&1 | tail -1
sleep 3
agentchrome js exec "(async()=>{const s=await import('/src/state.js');s.state.userSettings.manualDayFactor=0.0;return 'night';})()" 2>&1 | tail -1
sleep 3
agentchrome page screenshot --file /tmp/grass-t8-night.png
agentchrome js exec "(async()=>{const s=await import('/src/state.js');s.state.userSettings.manualDayFactor=1.0;return 'day';})()" 2>&1 | tail -1
sleep 3
agentchrome page screenshot --file /tmp/grass-t8-day.png
```

Confirm grass color shifts with the day/night palette (darker at night, normal during day) — the `MeshStandardMaterial` should respond to the scene lights automatically. If it doesn't, the `onBeforeCompile` patch has unintentionally severed the lighting chunks — re-check that no `#include <lights_*>` chunks were replaced.

- [ ] **Step 4: Cleanup**

```bash
kill $(pgrep -f "agentchrome.*chromium" | head -1) 2>/dev/null || true
```

Or `agentchrome` connection management per the operator's preference.

- [ ] **Step 5: No commit unless a bug was fixed during the sweep**

If a bug surfaced and was fixed, commit the fix; otherwise mark complete.

---

## Self-Review

**Spec coverage check** (against `docs/superpowers/specs/2026-05-12-grass-shader-design.md`):

| Spec section / requirement              | Implementing task |
|------------------------------------------|--------------------|
| New `src/grass.js` module                | Task 3             |
| `environment.js` re-export               | Task 3             |
| `state.grass: null` field                | Task 2             |
| `world.js` clear on regen, assign on build | Task 3 (clear), Task 3 (assign via `state.grass = …` inside `makeGrassField`) |
| `main.js` per-frame `stepGrass(camera)`  | Task 3 (wire), Task 5 (real body) |
| `biomes.js` `BALD_THRESHOLD` table       | Task 1             |
| MeshStandardMaterial + onBeforeCompile   | Task 3, 4          |
| `aWindSeed` per-instance attribute       | Task 4             |
| Uniforms (`uTime`/`uWindScale`/`uWindSpeed`/`uWindDir`/`uWindStrength`/`uCameraXZ`/`uFadeStart`/`uFadeEnd`/`uTipColor`) | Task 4 (defined), Task 5 (camera fade activated) |
| 2D value-noise GLSL function             | Task 4             |
| Two-octave gust sampling + swirl         | Task 4             |
| Squared `aTipFactor` bend + `aWindSeed` jitter | Task 4         |
| Camera distance fade math                | Task 5             |
| `stepGrass` updater                      | Task 5             |
| CPU density rejection + clump height     | Task 6             |
| Overshoot factor 4.4 / LOWFX 2.5         | Task 6             |
| LOWFX uniform overrides (strength, fade) | Task 4 (strength), Task 5 (fade) |
| Day/night via existing lighting          | Task 8 verification |
| Photo / follow mode compatibility        | Task 8             |
| Inspect-mode untouched                   | Inherently — `inspect.js` builds its own stand-ins |

No gaps.

**Placeholder scan:**
- No "TBD", "TODO", "implement later" in any task.
- No "add appropriate error handling" — error states are explicit (e.g., "if determinism fails, …").
- Every code step shows the full code to write.
- Every shell step shows the exact command.

**Type / name consistency:**
- `state.grass` is the same name everywhere (Task 2, 3, 5).
- `stepGrass(camera)` signature consistent (Task 3 import, Task 5 body, main.js call site).
- `uniforms` object name consistent across `state.grass = { mesh, uniforms }`, `state.grass.uniforms.uCameraXZ`, and the `onBeforeCompile` body.
- `aWindSeed` attribute name matches between JS (`InstancedBufferAttribute`) and GLSL (`attribute float aWindSeed`).
- `aTipFactor` reused unchanged from existing code.

Plan ready.

---

## Execution

Per the operator's standing preference, execution proceeds via `superpowers:subagent-driven-development` immediately after this plan is approved — no "ready to start?" prompt. Task 1 begins as soon as the plan-review gate clears.
