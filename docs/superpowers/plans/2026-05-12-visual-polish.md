# Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all five `ideas.md` § "Rendering / Visual Polish" items plus four shader/density extensions (shell-fur, custom particle ShaderMaterial, denser grass with tip color, footstep dust kicks) in the small-world terrarium.

**Architecture:** Three-layer split: renderer-layer additions (post-FX, water reflection RT) wire into `main.js`; world-build-time additions (fur shells, shadow InstancedMesh, denser grass, mountain parallax base) wire into `generateWorld` in `world.js`; per-frame work (parallax push, shadow matrix updates, particle aLife) plugs into the existing `animate()` step pattern. New isolated modules: `src/postfx.js`, `src/fur.js`, `src/shadows.js`, `src/reflection.js`. LOWFX gates each new feature explicitly.

**Tech Stack:** Three.js r0.184 (CDN), simplex-noise@4 (CDN), vanilla ES modules, no build step. Verification via the `make` server and agentchrome against `localhost:1999`.

**Project verification context:** This project has no automated tests, no linter, and no type-checker. Per `CLAUDE.md`, verification is manual: `make restart`, open `http://localhost:1999/` in agentchrome, regenerate the world until the relevant biome/feature lands, and visually confirm with the browser console clear of errors. Each task ends with explicit verification steps + a commit.

**Reference spec:** `docs/superpowers/specs/2026-05-12-visual-polish-design.md`.

---

## File map

**New files:**
- `src/postfx.js` — `EffectComposer` wiring, `initPostFX(renderer)`, lazy bloom + tilt-shift.
- `src/fur.js` — `applyShellFur(body, biome, opts)` + shared shell shader.
- `src/shadows.js` — `makeShadowDisks()`, `stepShadowDisks(disks, heightFn)`.
- `src/reflection.js` — `makeWaterReflection()`, `updateWaterReflection(renderer, camera, controls)`.

**Modified files:**
- `src/state.js` — new state fields and `userSettings.bloom` / `userSettings.tiltShift`.
- `src/environment.js` — replace `PointsMaterial` with `ShaderMaterial`; grass density + tip color; water material `onBeforeCompile` reflection patch; dust-kick helpers.
- `src/biomes.js` — `fuzzy: true` on 4 biomes.
- `src/sky.js` — no logic change (parallax handled directly in `main.js`); leave alone unless a helper proves necessary.
- `src/fauna.js` — `applyShellFur` call in `makeCreature`; footstep rising-edge dust emit in `stepCreature`.
- `src/ui.js` — wire two new settings checkboxes with `localStorage` persistence.
- `index.html` — markup for the new "rendering" settings section.
- `src/world.js` — instantiate shadows, reflection, capture mountain base position.
- `main.js` — composer wiring, per-frame parallax / shadow / dust / reflection steps.
- `ideas.md` — remove the 5 implemented entries once everything lands.

---

## Conventions for every task

1. Before any edit, **re-read the file** you're about to change (context drift is real after 10+ messages).
2. After each commit, run **manual smoke**:
   - `make restart` from `/Users/probello/Repos/small-world`.
   - Open `http://localhost:1999/` in agentchrome.
   - `agentchrome console list --current` — confirm no red errors.
   - Click `regenerate world` ≥ 10× to cycle biomes; if the feature is biome-gated, regenerate until the relevant biome lands (or set `?seed=` via the URL).
3. Commit messages: lowercase summary in present tense matching existing repo style (`Add foo`, `Wire bar`).

---

### Task 1: State + UI scaffolding for new settings

**Files:**
- Modify: `src/state.js` (add fields + settings keys)
- Modify: `index.html` (new "rendering" settings section)
- Modify: `src/ui.js` (wire checkboxes, localStorage persistence)

- [ ] **Step 1: Re-read `src/state.js` and `src/ui.js`** so you see the latest content.

- [ ] **Step 2: Add new state fields and settings keys to `src/state.js`.**

In the `state` object literal, after `aurora: null,` insert:

```js
  // Visual polish additions
  shadowDisks: null,
  waterReflection: null,   // { rt, camera, scene } when active
  mountainBasePos: null,
  dustKicks: [],
  postfx: null,            // { composer, bloomPass, tiltShiftPass, ... } once initialised
```

Inside `userSettings`, after `autoRegenMinutes: 2,` insert:

```js
    bloom: true,
    tiltShift: false,
```

- [ ] **Step 3: Add the "rendering" section to `index.html`.**

Insert this `<section>` immediately before `<section class="settings-section"><div class="settings-section-label">auto-regenerate</div>` (so the order is atmosphere → camera → share → rendering → auto-regenerate → photo → bookmarks → biome filter):

```html
    <section class="settings-section">
      <div class="settings-section-label">rendering</div>

      <label class="setting setting-checkbox">
        <input type="checkbox" id="setting-bloom" checked />
        <span class="setting-label">bloom</span>
      </label>

      <label class="setting setting-checkbox">
        <input type="checkbox" id="setting-tiltshift" />
        <span class="setting-label">tilt-shift miniature</span>
      </label>

      <div class="setting-hint" id="setting-lowfx-hint" hidden>
        disabled on this device (lowfx mode)
      </div>
    </section>
```

- [ ] **Step 4: Wire the checkboxes in `src/ui.js`.**

Find the existing settings-panel wiring (look for `setting-fog`, `setting-ambient`, etc. — likely in `initUi` or a helper near it). After the existing setting handlers, add:

```js
  // Rendering — bloom + tilt-shift
  const SETTINGS_KEY = "small-world.settings";
  function loadStoredSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function persistSettings() {
    const data = {
      bloom: state.userSettings.bloom,
      tiltShift: state.userSettings.tiltShift,
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch {}
  }
  const stored = loadStoredSettings();
  if (typeof stored.bloom === "boolean") state.userSettings.bloom = stored.bloom;
  if (typeof stored.tiltShift === "boolean") state.userSettings.tiltShift = stored.tiltShift;

  const bloomEl = document.getElementById("setting-bloom");
  const tiltEl = document.getElementById("setting-tiltshift");
  const lowfxHint = document.getElementById("setting-lowfx-hint");

  bloomEl.checked = state.userSettings.bloom;
  tiltEl.checked = state.userSettings.tiltShift;

  if (LOWFX) {
    bloomEl.disabled = true;
    tiltEl.disabled = true;
    if (lowfxHint) lowfxHint.hidden = false;
  }

  bloomEl.addEventListener("change", () => {
    state.userSettings.bloom = bloomEl.checked;
    if (state.postfx) state.postfx.setBloom(bloomEl.checked);
    persistSettings();
  });
  tiltEl.addEventListener("change", () => {
    state.userSettings.tiltShift = tiltEl.checked;
    if (state.postfx) state.postfx.setTiltShift(tiltEl.checked);
    persistSettings();
  });
```

If `LOWFX` is not already imported in `ui.js`, add `import { LOWFX } from "./lowfx.js";` at the top.

If `state` is not already imported, add `import { state } from "./state.js";`.

- [ ] **Step 5: Verify in browser.**

- `make restart` from `/Users/probello/Repos/small-world`.
- Open `http://localhost:1999/` in agentchrome.
- Open the settings panel (`✦` button bottom-right).
- Confirm the new "rendering" section is visible with two checkboxes: "bloom" (checked) and "tilt-shift miniature" (unchecked).
- Toggle each, refresh the page, confirm state persists.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/state.js index.html src/ui.js
git commit -m "Add state + settings scaffolding for visual polish"
```

---

### Task 2: Mountain parallax

**Files:**
- Modify: `src/world.js` (capture base position after building mountains)
- Modify: `main.js` (per-frame parallax push)

- [ ] **Step 1: Re-read `src/world.js` (lines around the `makeMountainBackdrop` call) and `main.js`.**

- [ ] **Step 2: Capture mountain base position in `world.js`.**

In `generateWorld`, find:
```js
  const mountains = makeMountainBackdrop(biome);
  state.world.add(mountains);
  state.mountains = mountains;
```

Replace with:
```js
  const mountains = makeMountainBackdrop(biome);
  state.world.add(mountains);
  state.mountains = mountains;
  state.mountainBasePos = mountains.position.clone();
```

- [ ] **Step 3: Add per-frame parallax in `main.js`.**

In `animate()`, after the existing `if (state.skyDome) ...` / `if (state.starfield) ...` blocks (so it runs alongside the other camera-following sky code), insert:

```js
  // Subtle parallax: mountains drift opposite to camera azimuth so they read
  // as farther from the camera than the islands.
  if (state.mountains && state.mountainBasePos) {
    const az = Math.atan2(camera.position.x, camera.position.z);
    state.mountains.position.x = state.mountainBasePos.x - Math.sin(az) * 0.6;
    state.mountains.position.z = state.mountainBasePos.z - Math.cos(az) * 0.6;
  }
```

- [ ] **Step 4: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Drag to orbit the camera slowly around the island.
- Visual check: the mountain ring should subtly shift such that nearby flora moves more than the mountains relative to the camera (parallax). Amplitude is small (0.6 units against a 220-unit ring) — it should feel like depth, not be jarring.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/world.js main.js
git commit -m "Add subtle parallax to mountain backdrop"
```

---

### Task 3: Soft creature shadows

**Files:**
- Create: `src/shadows.js`
- Modify: `src/world.js` (instantiate after creatures/caterpillars)
- Modify: `main.js` (step each frame)

- [ ] **Step 1: Re-read `src/world.js` and `src/state.js` so the `disposeGroup` contract is clear.**

- [ ] **Step 2: Create `src/shadows.js`.**

```js
import * as THREE from "three";
import { state } from "./state.js";

// Shared soft-disc texture — radial gradient, white centre fading to alpha 0.
// Re-built once per session, never disposed (cheap, persistent across regens).
let _shadowTex = null;
function getShadowTexture() {
  if (_shadowTex) return _shadowTex;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.85)");
  g.addColorStop(0.55, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _shadowTex = new THREE.CanvasTexture(c);
  _shadowTex.colorSpace = THREE.SRGBColorSpace;
  return _shadowTex;
}

// One InstancedMesh holds all shadow discs. Slots are reassigned each frame so
// the buffer can outlive creature lifetimes (e.g. burrowers disappearing). Any
// unused slot gets a zero-scale matrix and is effectively invisible.
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function makeShadowDisks(biome) {
  const tex = getShadowTexture();
  // Sized to a generous upper bound — creatures + caterpillars + 16 slack.
  const cap = Math.max(64, state.creatures.length + state.caterpillars.length + 16);
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // Tint the shadow with a darkened biome fog so it feels grounded.
  const tint = new THREE.Color(biome.fog).offsetHSL(0, 0, -0.4);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: tint,
    transparent: true,
    depthWrite: false,
    opacity: 0.45,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5; // sit below most flora, above the terrain
  // Start with every slot zero-scaled so nothing flashes before the first step.
  for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, _ZERO);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.capacity = cap;
  return mesh;
}

export function stepShadowDisks(disks, heightFn) {
  if (!disks || !heightFn) return;
  const cap = disks.userData.capacity;
  let i = 0;

  for (const c of state.creatures) {
    if (i >= cap) break;
    if (!c.group || !c.group.visible) {
      disks.setMatrixAt(i++, _ZERO);
      continue;
    }
    const p = c.group.position;
    const y = heightFn(p.x, p.z);
    _v.set(p.x, y + 0.02, p.z);
    let scale = c.scale * 1.6;
    if (c.flies) {
      // Soaring fliers cast a small, faint disc. currentHover is animated
      // each frame in stepCreature.
      const t = Math.min(1, (c.currentHover ?? 0) / 3);
      scale *= 1 - 0.7 * t;
    }
    _s.set(scale, scale, scale);
    _q.identity();
    _m.compose(_v, _q, _s);
    disks.setMatrixAt(i++, _m);
  }

  for (const c of state.caterpillars) {
    if (i >= cap) break;
    if (!c.segments || c.segments.length === 0) {
      disks.setMatrixAt(i++, _ZERO);
      continue;
    }
    // Single disc beneath the head segment is enough — body follows trail.
    const seg = c.segments[0];
    const y = heightFn(seg.position.x, seg.position.z);
    _v.set(seg.position.x, y + 0.02, seg.position.z);
    const scale = c.scale * 0.7;
    _s.set(scale, scale, scale);
    _q.identity();
    _m.compose(_v, _q, _s);
    disks.setMatrixAt(i++, _m);
  }

  for (; i < cap; i++) disks.setMatrixAt(i, _ZERO);
  disks.instanceMatrix.needsUpdate = true;
}
```

- [ ] **Step 3: Instantiate in `src/world.js`.**

Add the import at the top of `src/world.js` alongside the other `src/*` imports:

```js
import { makeShadowDisks } from "./shadows.js";
```

In `generateWorld`, **after** the bee swarms / bird flocks block but **before** the HUD block (i.e. after `state.flocks.push(flock);` close brace and before the `// HUD` comment), add:

```js
  // Soft circular ground shadows under creatures + caterpillars.
  state.shadowDisks = makeShadowDisks(biome);
  state.world.add(state.shadowDisks);
```

- [ ] **Step 4: Step each frame in `main.js`.**

Add to the imports at the top:

```js
import { stepShadowDisks } from "./src/shadows.js";
```

In `animate()`, after the existing `stepDirtPuffs(state.dirtPuffs, dt);` line, add:

```js
  stepShadowDisks(state.shadowDisks, state.heightFn);
```

- [ ] **Step 5: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Regenerate a few times.
- Visual check: every walker creature should have a soft circular shadow beneath it. Flying creatures should have a smaller shadow that shrinks as they ascend.
- Click `regenerate world` 5× — no console errors, shadows still appear on each new world.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/shadows.js src/world.js main.js
git commit -m "Add soft circular shadows beneath creatures"
```

---

### Task 4: Grass density + tip color + per-blade hue variation

**Files:**
- Modify: `src/environment.js` (`makeGrassField`)

- [ ] **Step 1: Re-read `src/environment.js` around `makeGrassField` (lines ~368-401) and `src/util.js / applyWindSway`.**

- [ ] **Step 2: Rewrite `makeGrassField` with tip color + denser placement.**

Replace the existing `makeGrassField` body with:

```js
export function makeGrassField(biome, heightFn) {
  // Bump gain to 2.8 — visibly lusher meadows. Still scaled by LOWFX_DENSITY.
  const count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, 2.8);

  const blade = new THREE.PlaneGeometry(0.06, 0.34, 1, 3);
  const bp = blade.attributes.position;
  // Per-vertex tip factor — 0 at the base, 1 at the tip. The blade plane has
  // 4 vertex rows (3 height segments); after shifting so base=0, tip=0.34,
  // tipFactor = y / 0.34.
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
    vertexColors: true, // enables per-instance instanceColor uptake
  });

  // Patch the standard shader to read aTipFactor and mix toward tipCol in
  // the fragment. Done via a second onBeforeCompile (applyWindSway adds the
  // first); both compose because applyWindSway only edits the vertex shader
  // and we only edit the fragment shader (plus a varying declaration in vertex).
  const tipUniforms = {
    uTipColor: { value: tipCol },
  };
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
  // applyWindSway will add another onBeforeCompile-equivalent below; both
  // need to run, so we re-wrap rather than overwrite.
  applyWindSway(mat, 1.8);

  const mesh = placeInstanced(blade, mat, count, heightFn, {
    minScale: 0.6,
    maxScale: 1.4,
    tilt: 0.18,
  });

  // Per-blade hue jitter via instanceColor. Setting this attribute auto-
  // enables three's USE_INSTANCING_COLOR path; the standard fragment then
  // multiplies diffuseColor by the instance color.
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
  return mesh;
}
```

Note the key change in approach: rather than rewriting `applyWindSway` to compose, we call it last and rely on its `onBeforeCompile` running by itself; both wind-sway (vertex edits only) and tip-color (fragment edits + a single vertex varying assignment we pre-injected) coexist by editing different shader sections. **However**, `applyWindSway` *overwrites* `material.onBeforeCompile` directly — re-read `src/util.js` line 27. To make composition work, **patch `applyWindSway`** as part of this task:

In `src/util.js`, replace:

```js
export function applyWindSway(material, strength = 1.0) {
  material.onBeforeCompile = (shader) => {
```

with:

```js
export function applyWindSway(material, strength = 1.0) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev && prev !== material.onBeforeCompile) prev(shader);
```

(The added line preserves any previously-installed `onBeforeCompile` callback so multiple patches compose.)

- [ ] **Step 3: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Regenerate until `verdant grove` or `golden steppe` lands (high grass density).
- Visual check: grass is noticeably denser than before; blade tips read lighter than blade bases; small per-blade hue variation visible at close zoom.
- Pan the camera to check the wind sway still animates (the existing `applyWindSway` still runs).
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/environment.js src/util.js
git commit -m "Densify grass and add tip color + per-blade hue variation"
```

---

### Task 5: Custom particle ShaderMaterial

**Files:**
- Modify: `src/environment.js` (`makeParticles` and `stepParticles`)

- [ ] **Step 1: Re-read `src/environment.js / makeParticles` (lines ~18-103) and `stepParticles` (lines ~105-249).**

- [ ] **Step 2: Replace `makeParticles` with a ShaderMaterial-based version.**

Replace the entire existing `makeParticles` function with:

```js
const PARTICLE_KIND_ID = {
  pollen: 0, dust: 1, snow: 2, firefly: 3, ember: 4,
  lichenmote: 5, feather: 6, bubble: 7, leaf: 8, spark: 9, rain: 10,
};

const _particleVS = `
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
  #if PARTICLE_KIND == 4 || PARTICLE_KIND == 9
    size *= 1.0 - aLife * 0.7;
  #elif PARTICLE_KIND == 2
    size *= 0.7 + 0.3 * fract(aSeed);
  #endif
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio * (300.0 / max(0.001, -mv.z));
}
`;

const _particleFS = `
precision highp float;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uTime;
varying float vLife;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  #if PARTICLE_KIND == 10
    float a = smoothstep(0.5, 0.0, abs(c.x) * 2.0) * smoothstep(0.5, 0.0, abs(c.y));
  #else
    float a = smoothstep(0.5, 0.0, d);
  #endif
  vec3 col = uColor;
  #if PARTICLE_KIND == 4 || PARTICLE_KIND == 9
    col = mix(uColor, uColor2, vLife);
    a *= 1.0 - vLife;
  #elif PARTICLE_KIND == 3
    float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vSeed * 18.0);
    col *= 0.6 + 0.4 * pulse;
    a *= pulse;
  #elif PARTICLE_KIND == 5
    a *= 0.6 + 0.3 * sin(uTime * 1.4 + vSeed * 9.0);
  #endif
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

export function makeParticles(biome) {
  const kind = biome.particle;
  const baseCount = {
    pollen: 240, dust: 320, snow: 500, firefly: 90, ember: 180,
    lichenmote: 140, feather: 120, bubble: 140, leaf: 120, spark: 240, rain: 520,
  }[kind] || 200;
  const count = _lowfxScale(baseCount);

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const lifes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = Math.random() * 14;
    positions[i * 3 + 2] = Math.sin(a) * r;
    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    seeds[i] = Math.random() * 100;
    lifes[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("aLife", new THREE.BufferAttribute(lifes, 1));

  const colorMap = {
    pollen: biome.sun, dust: biome.fog, snow: "#ffffff",
    firefly: biome.accent, ember: biome.accent, lichenmote: biome.accent,
    feather: "#ffffff", bubble: biome.water || biome.sky,
    leaf: biome.accent, spark: biome.sun, rain: biome.sun,
  };
  // Ember/spark fade toward a smokier secondary colour over life.
  const color2Map = {
    ember: "#3a2018", spark: "#fff2b3",
  };
  const sizeMap = {
    firefly: 24, snow: 14, lichenmote: 18, feather: 28,
    bubble: 20, leaf: 24, spark: 12, rain: 8,
    pollen: 10, dust: 10, ember: 18,
  };
  const opacityMap = {
    dust: 0.35, feather: 0.7, bubble: 0.55, leaf: 0.85, spark: 0.95, rain: 0.55,
    pollen: 0.85, snow: 0.85, firefly: 0.85, ember: 0.85, lichenmote: 0.85,
  };
  const additive = new Set(["firefly", "ember", "lichenmote", "spark"]);

  const renderer = state.renderer; // set by main.js after init
  const pixelRatio = renderer ? renderer.getPixelRatio() : 1;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uBaseSize: { value: sizeMap[kind] ?? 14 },
      uColor: { value: new THREE.Color(colorMap[kind]) },
      uColor2: { value: new THREE.Color(color2Map[kind] ?? colorMap[kind]) },
      uOpacity: { value: opacityMap[kind] ?? 0.85 },
    },
    defines: { PARTICLE_KIND: PARTICLE_KIND_ID[kind] ?? 0 },
    vertexShader: _particleVS,
    fragmentShader: _particleFS,
    transparent: true,
    depthWrite: false,
    blending: additive.has(kind) ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind, velocities, seeds, lifes, count };
  return points;
}
```

- [ ] **Step 3: Update `stepParticles` to write `aLife`.**

In the existing `stepParticles`, change the destructuring near the top from:

```js
  const { kind, velocities, seeds, count } = points.userData;
```

to:

```js
  const { kind, velocities, seeds, lifes, count } = points.userData;
```

After the existing `points.geometry.attributes.position.needsUpdate = true;` line at the very end of `stepParticles`, insert:

```js
  // aLife — drives shader-side size/opacity ramps. Infinite-loop kinds use a
  // (t * speed + seed) % 1 cycle; recycle kinds use real elapsed-life
  // progress. We treat all kinds identically here (cheap one-pass loop).
  for (let i = 0; i < count; i++) {
    const s = seeds[i];
    if (kind === "ember" || kind === "spark") {
      lifes[i] = Math.min(1, (lifes[i] ?? 0) + dt * 0.6);
      if (lifes[i] >= 1) lifes[i] = 0;
    } else if (kind === "firefly" || kind === "lichenmote") {
      lifes[i] = (t * 0.3 + s * 0.01) % 1.0;
    } else if (kind === "rain" || kind === "snow" || kind === "leaf" || kind === "feather" || kind === "bubble") {
      // recycle handlers reset y; tie aLife to vertical position so it ramps
      // back to 0 naturally when wrapped.
      lifes[i] = Math.max(0, Math.min(1, 1 - (points.geometry.attributes.position.array[i * 3 + 1] / 14)));
    } else {
      lifes[i] = (t * 0.5 + s * 0.013) % 1.0;
    }
  }
  points.geometry.attributes.aLife.needsUpdate = true;

  // shader-side uTime
  if (points.material.uniforms && points.material.uniforms.uTime) {
    points.material.uniforms.uTime.value = t;
  }
```

Also **remove** the previous CPU-side opacity twinkles for firefly / lichenmote / spark, which are now in the shader. Find:

```js
  // firefly twinkle
  if (kind === "firefly") {
    points.material.opacity = 0.6 + Math.sin(t * 2) * 0.25;
  } else if (kind === "lichenmote") {
    points.material.opacity = 0.45 + Math.sin(t * 1.4) * 0.2;
  } else if (kind === "spark") {
    points.material.opacity = 0.75 + Math.sin(t * 4.5) * 0.2;
  }
```

and delete that block entirely. The shader's `uniforms.uOpacity` value is the base; per-particle pulse happens inside the shader.

- [ ] **Step 4: Expose `renderer` on `state`.**

In `src/state.js`, add `renderer: null,` to the state object (near `camera: null,`).

In `main.js`, immediately after `state.camera = camera;`, add:

```js
state.renderer = renderer;
```

(The `makeParticles` factory reads `state.renderer` for the pixel ratio.)

- [ ] **Step 5: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Regenerate to cycle particle kinds. Hit at least: `verdant` (leaf), `desert` (dust), `frozen` (snow), `marsh` (rain), `ashen` (ember), `twilight` (firefly), `obsidian` (spark).
- Visual checks:
  - Snow falls and looks soft.
  - Embers ramp down in size + fade out over their life (was constant before).
  - Firefly twinkles per-particle (no longer in lockstep across all of them).
  - Rain reads as vertical streaks rather than dots.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/environment.js src/state.js main.js
git commit -m "Replace particles with custom ShaderMaterial"
```

---

### Task 6: Footstep dust kicks

**Files:**
- Modify: `src/environment.js` (add `emitDustKick`, `stepDustKicks`)
- Modify: `src/fauna.js` (`stepCreature` rising-edge detection)
- Modify: `src/world.js` (reset `state.dustKicks` on regen — already empty after the scaffolding task; confirm)
- Modify: `main.js` (step each frame)

- [ ] **Step 1: Re-read `src/fauna.js / stepCreature` foot animation block (around lines 838-847) and `src/environment.js / stepDirtPuffs`.**

- [ ] **Step 2: Add dust-kick helpers to `src/environment.js`.**

After the existing `stepDirtPuffs` function, append:

```js
// ─── footstep dust kicks ───
const KICK_PARTICLES = 4;
const KICK_LIFE = 0.5;
export function makeDustKick(x, y, z, baseColor) {
  const positions = new Float32Array(KICK_PARTICLES * 3);
  const velocities = new Float32Array(KICK_PARTICLES * 3);
  for (let i = 0; i < KICK_PARTICLES; i++) {
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y + 0.02;
    positions[i * 3 + 2] = z;
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.4 + Math.random() * 0.5;
    velocities[i * 3 + 0] = Math.cos(ang) * sp;
    velocities[i * 3 + 1] = 0.5 + Math.random() * 0.4;
    velocities[i * 3 + 2] = Math.sin(ang) * sp;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(baseColor).offsetHSL(0, -0.1, 0.12),
    size: 0.08,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { velocities, age: 0 };
  return points;
}

export function stepDustKicks(kicks, dt) {
  if (!kicks || !kicks.length) return;
  for (let p = kicks.length - 1; p >= 0; p--) {
    const kick = kicks[p];
    const d = kick.userData;
    d.age += dt;
    const pos = kick.geometry.attributes.position.array;
    const v = d.velocities;
    for (let i = 0; i < KICK_PARTICLES; i++) {
      const ix = i * 3;
      pos[ix + 0] += v[ix + 0] * dt;
      pos[ix + 1] += v[ix + 1] * dt;
      pos[ix + 2] += v[ix + 2] * dt;
      v[ix + 1] -= 3.5 * dt;
      v[ix + 0] *= 0.9;
      v[ix + 2] *= 0.9;
    }
    kick.geometry.attributes.position.needsUpdate = true;
    kick.material.opacity = Math.max(0, 0.7 * (1 - d.age / KICK_LIFE));
    if (d.age >= KICK_LIFE) {
      if (kick.parent) kick.parent.remove(kick);
      kick.geometry.dispose();
      kick.material.dispose();
      kicks.splice(p, 1);
    }
  }
}
```

- [ ] **Step 3: Add rising-edge detection in `src/fauna.js / stepCreature`.**

At the top of `src/fauna.js`, add the import (alongside existing imports):

```js
import { makeDirtPuff, makeDustKick } from "./environment.js";
```

(replacing the existing single-name import line).

In `makeCreature`, where the return object is built, **inside** the `if (flies) { ... } else { ... }` branch's `else` block (walkers), after `feet.push(foot);` declarations — but easier: extend the **return object** by adding two new fields:

```js
    lastFootSin: [0, 0, 0, 0],
    lastDustAt: 0,
```

(Walkers have 4 feet; we always allocate four slots for simplicity.)

In `stepCreature`, locate the existing walker foot animation block:

```js
  } else if (moving) {
    // diagonal trot pattern: FL+BR phase, FR+BL counter-phase
    const phases = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < c.feet.length; i++) {
      const footY = -0.32 + Math.sin(c.bob + phases[i]) * 0.09;
      c.feet[i].position.y = footY;
      // leg top is at -0.1 in body space; scale.y = distance to foot
      c.legs[i].scale.y = -0.1 - footY;
    }
  }
```

Replace with:

```js
  } else if (moving) {
    // diagonal trot pattern: FL+BR phase, FR+BL counter-phase
    const phases = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < c.feet.length; i++) {
      const sVal = Math.sin(c.bob + phases[i]);
      const footY = -0.32 + sVal * 0.09;
      c.feet[i].position.y = footY;
      c.legs[i].scale.y = -0.1 - footY;
      // Rising-edge footstep detection — fires once when sVal crosses 0.85
      // upward. Emit a small dust kick on dry ground. Cooldown gates
      // multiple kicks per stride.
      const prev = c.lastFootSin[i] ?? 0;
      if (sVal > 0.85 && prev <= 0.85 && t - c.lastDustAt > 0.18) {
        const fx = c.group.position.x;
        const fz = c.group.position.z;
        const fy = heightFn(fx, fz);
        if (fy > 0.1) {
          const kick = makeDustKick(fx, fy, fz, c.dirtColor);
          state.world.add(kick);
          state.dustKicks.push(kick);
          c.lastDustAt = t;
        }
      }
      c.lastFootSin[i] = sVal;
    }
  }
```

- [ ] **Step 4: Step each frame in `main.js`.**

Add to the imports near `stepDirtPuffs`:

```js
import { stepParticles, stepWater, stepDirtPuffs, stepDustKicks } from "./src/environment.js";
```

(Update the existing import line; don't add a second.)

In `animate()`, after `stepDirtPuffs(state.dirtPuffs, dt);`, add:

```js
  stepDustKicks(state.dustKicks, dt);
```

- [ ] **Step 5: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Click the `follow a creature` button in settings, click a walker — camera follows it.
- Visual check: small puffs of dust appear under the feet on each footstep when walking on dry ground (skipped for fliers and for ground-level water sections).
- Regenerate ≥ 5×, ensure no errors over time.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/environment.js src/fauna.js main.js
git commit -m "Add footstep dust kicks under walking creatures"
```

---

### Task 7: Shader fur (shell technique)

**Files:**
- Create: `src/fur.js`
- Modify: `src/biomes.js` (add `fuzzy: true` to four biomes)
- Modify: `src/fauna.js` (`makeCreature` calls `applyShellFur` when applicable)
- Modify: `main.js` (per-frame uLightDir/uLightIntensity update on the shared fur material)

- [ ] **Step 1: Re-read `src/fauna.js / makeCreature` around the body construction (lines ~88-104).**

- [ ] **Step 2: Create `src/fur.js`.**

```js
import * as THREE from "three";
import { LOWFX } from "./lowfx.js";

// One material instance shared across every fur shell across every fuzzy
// creature in the world. Per-shell uniforms (uShellLayer) live on a clone, so
// they don't fight each other; the rest of the uniforms are shared via
// reference and updated once per frame from main.js.
//
// The shared uniforms object is mutated each frame; clone() preserves that
// reference automatically when we call material.clone() because ShaderMaterial
// clones uniforms shallowly.

const _furVS = `
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
`;

const _furFS = `
precision highp float;
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
`;

// Shared uniforms (one object reference, mutated each frame).
export const sharedFurUniforms = {
  uLightDir: { value: new THREE.Vector3(1, 1, 1) },
  uLightIntensity: { value: 1.0 },
  uLayers: { value: 8 },
};

// Build a fur material template. Clone()ing it gives per-shell instances
// that share the above uniforms (Three's ShaderMaterial.clone copies the
// uniforms object shallowly), and we then overwrite uShellLayer per clone.
function makeFurTemplate(baseColor, tipColor, furLength) {
  return new THREE.ShaderMaterial({
    vertexShader: _furVS,
    fragmentShader: _furFS,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      uShellLayer: { value: 0 },
      uLayers: sharedFurUniforms.uLayers,
      uFurLength: { value: furLength },
      uBaseColor: { value: baseColor.clone() },
      uTipColor: { value: tipColor.clone() },
      uLightDir: sharedFurUniforms.uLightDir,
      uLightIntensity: sharedFurUniforms.uLightIntensity,
    },
  });
}

// Attach `layers` shell meshes as children of `body`. Returns the array of
// shells so the caller can store them (disposeGroup handles cleanup when
// state.world is rebuilt, since shells parent into the world via body).
export function applyShellFur(body, biome, opts = {}) {
  const layers = LOWFX ? 4 : (opts.layers ?? 8);
  const furLength = opts.length ?? 0.05;
  const baseColor =
    opts.baseColor ?? (body.material && body.material.color
      ? body.material.color.clone()
      : new THREE.Color(0xffffff));
  const tipColor =
    opts.tipColor ?? new THREE.Color(biome.furTip ?? biome.accent ?? "#ffffff");

  sharedFurUniforms.uLayers.value = Math.max(sharedFurUniforms.uLayers.value, layers);

  const template = makeFurTemplate(baseColor, tipColor, furLength);
  const shells = [];
  for (let i = 1; i <= layers; i++) {
    const mat = template.clone();
    mat.uniforms.uShellLayer = { value: i };
    // Shared uniforms: re-bind so the clone reads the same object refs.
    mat.uniforms.uLayers = sharedFurUniforms.uLayers;
    mat.uniforms.uLightDir = sharedFurUniforms.uLightDir;
    mat.uniforms.uLightIntensity = sharedFurUniforms.uLightIntensity;
    const shell = new THREE.Mesh(body.geometry, mat);
    // Children of body inherit body's animated scale/rotation/squash.
    body.add(shell);
    shells.push(shell);
  }
  // Template was never added to the scene — release it.
  template.dispose();
  return shells;
}
```

- [ ] **Step 3: Mark four biomes `fuzzy: true` in `src/biomes.js`.**

Add `fuzzy: true,` to the biome objects with id `mossy`, `cloud`, `frozen`, `grove`. Example for `mossy` — add `fuzzy: true,` on a new line before its `dusk:` entry (other biomes follow the same pattern).

(Re-read the file before editing to be sure each entry is updated cleanly.)

- [ ] **Step 4: Call `applyShellFur` from `makeCreature` in `src/fauna.js`.**

At the top of `src/fauna.js`, add:

```js
import { applyShellFur } from "./fur.js";
```

In `makeCreature`, immediately after the `body` mesh is added to `group` (right after `group.add(body);`), insert:

```js
  let furShells = null;
  // Fuzzy biomes give walkers (and only walkers — fliers/fish read aquatic
  // or airborne) a shell-fur layer. Burrowers + sleepers count as walkers.
  if (biome.fuzzy && !flies) {
    furShells = applyShellFur(body, biome, {
      baseColor: bodyCol.clone().offsetHSL(0, -0.05, -0.05),
    });
  }
```

In the return object of `makeCreature`, append (alongside other entity fields, e.g. before `nextThink:`):

```js
    furShells,
```

- [ ] **Step 5: Update fur lighting uniforms each frame in `main.js`.**

Add to the imports at the top:

```js
import { sharedFurUniforms } from "./src/fur.js";
```

In `animate()`, immediately after `updateDayNight(t);`, add:

```js
    // Fur shells read these once per frame — shared across all fur instances.
    if (state.sunLight) {
      sharedFurUniforms.uLightDir.value
        .copy(state.sunLight.position)
        .normalize();
      sharedFurUniforms.uLightIntensity.value = state.sunLight.intensity;
    }
```

(That block is inside the `if (!paused) { ... }` body in `animate()` — re-read `main.js:93-97` to confirm placement.)

- [ ] **Step 6: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Set seed manually for a fuzzy biome: visit `http://localhost:1999/?seed=` and regenerate until a `mossy ruins`, `cloud island`, `frozen vale`, or `mushroom grove` lands (the HUD shows the biome name).
- Visual check: walker creatures in these biomes have a soft fuzz silhouette — shell layers visible as a haze of small dots around the body, especially at silhouette edges. Lighting on the fur shifts with the day/night cycle.
- Confirm fliers (with wings) in these biomes do NOT have fur.
- Regenerate to a non-fuzzy biome (e.g. `verdant`); confirm creatures look normal.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 7: Commit.**

```bash
git add src/fur.js src/biomes.js src/fauna.js main.js
git commit -m "Add shell-fur shader for fuzzy biome creatures"
```

---

### Task 8: Post-processing stack (bloom + tilt-shift)

**Files:**
- Create: `src/postfx.js`
- Modify: `main.js` (lazy init + branch render path)

- [ ] **Step 1: Re-read `main.js` (renderer setup + animate loop).**

- [ ] **Step 2: Create `src/postfx.js`.**

```js
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";

// Hand-rolled tilt-shift: 4-tap blur scaled by distance from a focus band.
// Focus band's screen-Y is updated each frame from main.js so it tracks the
// island origin as the camera orbits.
const _tiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.55 },        // 0..1 screen-Y
    uHalfWidth: { value: 0.18 },    // half-width of sharp band
    uBlurAmount: { value: 1.6 },    // px blur radius scale
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uFocus;
    uniform float uHalfWidth;
    uniform float uBlurAmount;
    varying vec2 vUv;
    void main() {
      float dy = abs(vUv.y - uFocus);
      float blur = smoothstep(uHalfWidth, uHalfWidth + 0.25, dy) * uBlurAmount;
      vec2 px = 1.0 / uResolution;
      vec3 c = vec3(0.0);
      c += texture2D(tDiffuse, vUv).rgb * 0.4;
      c += texture2D(tDiffuse, vUv + vec2( px.x * 2.0 * blur, 0.0)).rgb * 0.15;
      c += texture2D(tDiffuse, vUv + vec2(-px.x * 2.0 * blur, 0.0)).rgb * 0.15;
      c += texture2D(tDiffuse, vUv + vec2(0.0,  px.y * 2.0 * blur)).rgb * 0.15;
      c += texture2D(tDiffuse, vUv + vec2(0.0, -px.y * 2.0 * blur)).rgb * 0.15;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function initPostFX(renderer, scene, camera) {
  // LOWFX never builds a composer — returns a stub that always reports off.
  if (LOWFX) {
    return {
      isActive: () => false,
      render: () => renderer.render(scene, camera),
      onResize: () => {},
      setBloom: () => {},
      setTiltShift: () => {},
      updateTiltShiftFocus: () => {},
    };
  }

  const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(size.clone(), 0.55, 0.45, 0.85);
  bloomPass.enabled = state.userSettings.bloom;
  composer.addPass(bloomPass);

  const tiltShiftPass = new ShaderPass(_tiltShiftShader);
  tiltShiftPass.uniforms.uResolution.value.copy(size);
  tiltShiftPass.enabled = state.userSettings.tiltShift;
  composer.addPass(tiltShiftPass);

  composer.addPass(new OutputPass());

  return {
    composer,
    bloomPass,
    tiltShiftPass,
    isActive: () => bloomPass.enabled || tiltShiftPass.enabled,
    render: (s, cam) => {
      // Keep render pass + scene refs synced (scene/camera refs are stable
      // per session, but cheap to assign).
      renderPass.scene = s;
      renderPass.camera = cam;
      composer.render();
    },
    onResize: (w, h) => {
      composer.setSize(w, h);
      bloomPass.setSize(w, h);
      tiltShiftPass.uniforms.uResolution.value.set(w, h);
    },
    setBloom: (on) => { bloomPass.enabled = on; },
    setTiltShift: (on) => { tiltShiftPass.enabled = on; },
    // Caller computes focusY each frame from the camera; we just write it.
    updateTiltShiftFocus: (focusY) => {
      tiltShiftPass.uniforms.uFocus.value = focusY;
    },
  };
}
```

- [ ] **Step 3: Wire into `main.js`.**

Add imports at the top:

```js
import { initPostFX } from "./src/postfx.js";
```

After `state.renderer = renderer;` (from Task 5 — confirm it's there), insert:

```js
const postfx = initPostFX(renderer, scene, camera);
state.postfx = postfx;
```

Add a `window` resize listener (search for existing listener; if none, this is new). After the existing setup code (just before `function animate()`), add:

```js
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postfx.onResize(w, h);
});
```

(If a resize listener already exists in `main.js`, add the `postfx.onResize(w, h)` call inside it rather than duplicating.)

Replace the existing render line at the bottom of `animate()`:

```js
  renderer.render(scene, camera);
```

with:

```js
  // Update tilt-shift focus band: project the island origin to screen-Y so
  // the sharp band tracks the island as the camera orbits.
  if (postfx.isActive && postfx.isActive()) {
    const v = new THREE.Vector3(0, 1.5, 0).project(camera);
    // v.y is in NDC [-1, 1]; convert to UV [0, 1]. Three's UV origin is at
    // bottom-left, so (v.y * 0.5 + 0.5) gives the right vertical axis.
    postfx.updateTiltShiftFocus(v.y * 0.5 + 0.5);
    postfx.render(scene, camera);
  } else {
    renderer.render(scene, camera);
  }
```

Note: `THREE.Vector3` is already imported via `import * as THREE from "three";` at the top of `main.js` — no new import needed.

- [ ] **Step 4: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Open the settings panel → "rendering" section.
- Bloom should be ON by default. Regenerate to `twilight meadow` (glowFlowers) or `obsidian` (glowEyes) — confirm visible glow halo on emissive elements.
- Toggle bloom OFF — halo should disappear; rest of scene unaffected.
- Toggle tilt-shift ON — confirm the band around the island is sharp, areas above/below are blurred. Orbit the camera — band should follow the island.
- Toggle tilt-shift OFF — confirm scene returns to fully sharp.
- Test with `?lowfx=1` — both checkboxes should be disabled and a hint visible; no composer overhead.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/postfx.js main.js
git commit -m "Add post-processing stack: selective bloom + tilt-shift miniature"
```

---

### Task 9: Water reflection (sky-only RT)

**Files:**
- Create: `src/reflection.js`
- Modify: `src/environment.js / makeWaterPlane` (patch material with reflection sampling)
- Modify: `src/world.js` (build reflection after water + sky exist)
- Modify: `main.js` (update RT each frame before main render)

- [ ] **Step 1: Re-read `src/environment.js / makeWaterPlane`, `src/sky.js`, and the world-build order in `src/world.js`.**

- [ ] **Step 2: Create `src/reflection.js`.**

```js
import * as THREE from "three";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";
import { makeSkyDome, makeStarfield, makeAurora } from "./sky.js";

// Build a small dedicated scene containing clones of the sky elements so we
// can render a sky-only reflection into a low-res render target without
// reparenting the live sky each frame. Uniforms on the cloned materials
// share references with the live materials' uniforms, so day/night updates
// flow through naturally without any extra wiring.

function shareUniforms(srcMesh, dstMesh) {
  if (!srcMesh || !dstMesh) return;
  // Three's ShaderMaterial.clone deep-clones uniforms; reassign by reference
  // so the cloned reflection mesh picks up live uniform mutations.
  if (srcMesh.material && srcMesh.material.uniforms && dstMesh.material) {
    dstMesh.material.uniforms = srcMesh.material.uniforms;
  }
}

export function makeWaterReflection(biome) {
  const rt = new THREE.WebGLRenderTarget(
    LOWFX ? 128 : 256,
    LOWFX ? 128 : 256,
    { depthBuffer: false }
  );
  const scene = new THREE.Scene();

  // Clone the live sky dome / starfield / aurora into the reflection scene.
  // makeSkyDome / makeStarfield / makeAurora are factories — calling them
  // again here would give independent uniforms, so we instead clone the live
  // meshes and re-bind their uniforms to the live refs.
  if (state.skyDome) {
    const dome = state.skyDome.clone();
    dome.material = state.skyDome.material; // share material (and uniforms)
    scene.add(dome);
  }
  if (state.starfield) {
    const sf = state.starfield.clone();
    sf.material = state.starfield.material;
    scene.add(sf);
  }
  if (state.aurora) {
    // Aurora is a group; clone its children individually so uniforms persist.
    const grp = new THREE.Group();
    state.aurora.traverse((o) => {
      if (o.isMesh && o.material && o.material.uniforms) {
        const m = o.clone();
        m.material = o.material;
        grp.add(m);
      }
    });
    scene.add(grp);
  }

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 800);

  return { rt, scene, camera };
}

export function updateWaterReflection(refl, renderer, mainCamera, controls) {
  if (!refl) return;
  // Mirror across y=0 (water sits at y=-0.12; close enough for a stylized look).
  refl.camera.position.set(
    mainCamera.position.x,
    -mainCamera.position.y,
    mainCamera.position.z
  );
  refl.camera.up.set(0, -1, 0); // flipped because we're underneath
  refl.camera.lookAt(controls.target.x, -controls.target.y, controls.target.z);
  refl.camera.up.set(0, 1, 0); // restore for any other consumers
  refl.camera.aspect = mainCamera.aspect;
  refl.camera.projectionMatrix.copy(mainCamera.projectionMatrix);
  refl.camera.projectionMatrixInverse.copy(mainCamera.projectionMatrixInverse);

  renderer.setRenderTarget(refl.rt);
  renderer.clear();
  renderer.render(refl.scene, refl.camera);
  renderer.setRenderTarget(null);
}
```

- [ ] **Step 3: Patch the water material in `src/environment.js / makeWaterPlane`.**

Replace the current `makeWaterPlane` with:

```js
export function makeWaterPlane(biome) {
  const segs = 48;
  const size = state.ISLAND_SIZE * 1.05;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const base = new THREE.Color(biome.water || biome.fog);
  const mat = new THREE.MeshStandardMaterial({
    color: base,
    transparent: true,
    opacity: 0.55,
    roughness: 0.32,
    metalness: 0.18,
  });

  // Reflection patch — only kicks in if state.waterReflection is set later
  // by world.js. Until then, uReflTex stays null and the mix amount is 0.
  const reflUniforms = {
    uReflTex: { value: null },
    uInvViewport: { value: new THREE.Vector2(
      1 / window.innerWidth,
      1 / window.innerHeight
    )},
    uReflMix: { value: 0.0 },
  };
  mat.userData.reflectionUniforms = reflUniforms;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uReflTex = reflUniforms.uReflTex;
    shader.uniforms.uInvViewport = reflUniforms.uInvViewport;
    shader.uniforms.uReflMix = reflUniforms.uReflMix;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform sampler2D uReflTex;
         uniform vec2 uInvViewport;
         uniform float uReflMix;`
      )
      .replace(
        "#include <output_fragment>",
        `#include <output_fragment>
         if (uReflMix > 0.001) {
           vec2 ruv = gl_FragCoord.xy * uInvViewport;
           vec3 refl = texture2D(uReflTex, ruv).rgb;
           // Fresnel-ish: stronger at glancing angles. vViewPosition exists
           // because MeshStandardMaterial #include <normal_pars_fragment>
           // brings it; but we keep the math fixed here for stability.
           float f = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 2.0);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, refl, uReflMix * (0.4 + 0.6 * f));
         }`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.12;
  mesh.receiveShadow = true;
  const arr = geo.attributes.position.array;
  mesh.userData.basePositions = new Float32Array(arr);
  return mesh;
}
```

- [ ] **Step 4: Build the reflection in `src/world.js`.**

Add to the imports at the top of `src/world.js`:

```js
import { makeWaterReflection } from "./reflection.js";
```

In `generateWorld`, find the existing water-plane block:

```js
  if (biome.water) {
    state.waterMesh = makeWaterPlane(biome);
    state.world.add(state.waterMesh);
  }
```

Replace with:

```js
  if (biome.water) {
    state.waterMesh = makeWaterPlane(biome);
    state.world.add(state.waterMesh);
    // Build the reflection only after the sky dome / starfield / aurora are
    // in place. Sky elements were added a few lines above this block, so they
    // exist already.
    state.waterReflection = makeWaterReflection(biome);
    // Hand the RT to the water material.
    const u = state.waterMesh.material.userData.reflectionUniforms;
    if (u) {
      u.uReflTex.value = state.waterReflection.rt.texture;
      u.uReflMix.value = 0.3; // 30% blend
    }
  } else {
    state.waterReflection = null;
  }
```

- [ ] **Step 5: Update the RT each frame in `main.js`.**

Add to the imports at the top:

```js
import { updateWaterReflection } from "./src/reflection.js";
```

In `animate()`, **before** the post-processing / render block at the very end, add:

```js
  // Refresh sky-only reflection RT for water biomes. One extra render pass
  // per frame at 256x256 — cheap.
  if (state.waterReflection) {
    updateWaterReflection(state.waterReflection, renderer, camera, controls);
  }
```

Also extend the resize listener (from Task 8) to update the inverse-viewport uniform:

Inside the resize listener body, after `postfx.onResize(w, h);`, add:

```js
  if (state.waterMesh && state.waterMesh.material.userData.reflectionUniforms) {
    state.waterMesh.material.userData.reflectionUniforms.uInvViewport.value.set(1 / w, 1 / h);
  }
```

- [ ] **Step 6: Verify in browser.**

- `make restart`, open `http://localhost:1999/`.
- Regenerate until a water biome lands: `lavender marsh` or `coral atoll`.
- Visual check: water surface shows a soft reflection tinted to the sky — sky color visible on the water, blending stronger at glancing angles than head-on.
- Toggle day/night via the `time of day` slider in settings — water reflection should shift colour with the sky (because uniforms are shared).
- Resize the window (drag corner if running locally) — confirm reflection doesn't break.
- Regenerate to a non-water biome — confirm no reflection draw cost and no errors.
- `agentchrome console list --current` — confirm no errors.

- [ ] **Step 7: Commit.**

```bash
git add src/reflection.js src/environment.js src/world.js main.js
git commit -m "Add sky-only reflection for water biomes"
```

---

### Task 10: Idea-list cleanup + final sanity pass

**Files:**
- Modify: `ideas.md` (remove the 5 implemented bullets)

- [ ] **Step 1: Re-read `ideas.md`.**

- [ ] **Step 2: Remove the entire "Rendering / Visual Polish" section** (all five bullets). Keep the section header in only if other items remain; otherwise remove the header and the trailing horizontal rule as well, keeping the file structure tidy.

- [ ] **Step 3: Final sanity pass in the browser.**

- `make restart`, open `http://localhost:1999/`.
- Regenerate ≥ 15× — confirm every biome renders without console errors, no leaked objects between regenerations (open agentchrome perf and check that scene node count returns to baseline after regen).
- Toggle bloom + tilt-shift mid-session — confirm they don't interact poorly.
- Test `?lowfx=1` — confirm low-fx path still works (no fur, no post-FX, smaller reflection RT).
- Use photo mode (`P` then `S`) — confirm the saved PNG includes post-FX when enabled.

- [ ] **Step 4: Commit.**

```bash
git add ideas.md
git commit -m "Remove completed visual polish items from ideas list"
```

- [ ] **Step 5: Push to deploy.**

```bash
git push
```

(The project deploys via GitHub Pages on push, per the convention in `ideas.md` and `CLAUDE.md`.)

---

## Self-review (run after the plan is written, fix inline)

**Spec coverage** — each spec section maps to one or more tasks:

| Spec section | Task(s) |
|--------------|---------|
| 1 Architecture overview | 1 (scaffolding) |
| 2 Post-FX | 8 |
| 3 Shader fur | 7 |
| 4 Particle shader + dust kicks | 5 + 6 |
| 5 Grass density + tip color | 4 |
| 6 Soft shadows | 3 |
| 7 Water reflection | 9 |
| 8 Mountain parallax | 2 |
| 9 State additions | 1 + 5 (renderer field) |
| 10 Testing | per-task verification + Task 10 final pass |

No gaps detected.

**Placeholder scan** — none. All steps contain real code or real commands.

**Type / name consistency** — `applyShellFur`, `sharedFurUniforms`, `makeShadowDisks`, `stepShadowDisks`, `makeDustKick`, `stepDustKicks`, `makeWaterReflection`, `updateWaterReflection`, `initPostFX`, `state.postfx`, `state.waterReflection`, `state.shadowDisks`, `state.mountainBasePos`, `state.dustKicks` — all consistent across tasks.

**Known caveats:**
- Task 4 (`grass`) modifies `applyWindSway` in `src/util.js` to compose with other `onBeforeCompile` callbacks. The change is minimal and behavior-preserving for existing call sites.
- Task 5 (`particles`) drops CPU-side `points.material.opacity` writes for the twinkling kinds; the shader handles per-particle pulse now. Behavior is closer to the original intent (per-particle, not synchronized) — visible improvement.
- Task 9 (`reflection`) shares cloned-mesh materials by reassignment. This is intentional: it lets day/night uniform updates flow into the reflection without extra wiring. Disposing the reflection scene must NOT dispose the materials (handled implicitly because the reflection scene isn't fed to `disposeGroup`; it stays alive until the next regen, then `makeWaterReflection` builds a fresh clone scene).
