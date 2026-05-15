# Creature Footprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cute biome-tuned soft-ground footprints for walkers and landing fliers, continuous trails for caterpillars/snails, and tiny sand poofs on flier touchdown.

**Architecture:** Add a bounded `GroundMarks` instanced overlay system in `src/environment.js`, store it on `state.groundMarks`, wire it into world generation and the animation loop, then have fauna modules emit marks from existing movement events. Biome config controls where marks appear and how strong they look.

**Tech Stack:** No-build ES modules, Three.js from CDN, Python `unittest` static invariants, Node static test.

---

## File Structure

- `tests/test_ground_marks_static.py` — static invariants proving the new system is exported, wired, and emitted by the right fauna modules.
- `src/state.js` — add `groundMarks` to shared state.
- `src/biomes.js` — add `groundMarks` config to soft-ground biomes.
- `src/environment.js` — add ground-mark renderer, optional tiny dust-kick controls, and mark stepper.
- `src/world.js` — create/reset/add `state.groundMarks` during regeneration.
- `main.js` — import and call `stepGroundMarks` each frame.
- `src/fauna/creature.js` — emit walker footprints and flier touchdown marks/poofs.
- `src/fauna/caterpillar.js` — emit throttled continuous crawler trail marks.

## Verification Commands

Use these after each implementation task unless a task gives a narrower command:

```bash
python3 -m unittest tests/test_ground_marks_static.py tests/test_sky_rendering_invariants.py
node tests/follow-mode-static.test.mjs
```

Expected final result: all tests pass and `node` exits with status 0.

---

### Task 1: Add failing static coverage

**Files:**
- Create: `tests/test_ground_marks_static.py`

- [ ] **Step 1: Create the static test file**

Write this complete file to `tests/test_ground_marks_static.py`:

```python
#!/usr/bin/env python3
"""Static invariants for soft-ground creature footprint/trail wiring."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
STATE_JS = ROOT / "src" / "state.js"
BIOMES_JS = ROOT / "src" / "biomes.js"
ENVIRONMENT_JS = ROOT / "src" / "environment.js"
WORLD_JS = ROOT / "src" / "world.js"
MAIN_JS = ROOT / "main.js"
CREATURE_JS = ROOT / "src" / "fauna" / "creature.js"
CATERPILLAR_JS = ROOT / "src" / "fauna" / "caterpillar.js"


class GroundMarksStaticTest(unittest.TestCase):
    def test_ground_mark_system_exports_and_shader_alpha(self) -> None:
        source = ENVIRONMENT_JS.read_text()

        self.assertIn("export function makeGroundMarks", source)
        self.assertIn("export function emitGroundMark", source)
        self.assertIn("export function stepGroundMarks", source)
        self.assertIn("attribute float aAlpha", source)
        self.assertIn("depthWrite: false", source)
        self.assertIn("polygonOffset: true", source)

    def test_state_world_and_main_wire_ground_marks(self) -> None:
        state_source = STATE_JS.read_text()
        world_source = WORLD_JS.read_text()
        main_source = MAIN_JS.read_text()

        self.assertIn("groundMarks: null", state_source)
        self.assertIn("makeGroundMarks", world_source)
        self.assertIn("state.groundMarks = null", world_source)
        self.assertIn("state.groundMarks = makeGroundMarks(biome)", world_source)
        self.assertIn("stepGroundMarks", main_source)
        self.assertIn("stepGroundMarks(state.groundMarks, dt, state.heightFn)", main_source)

    def test_soft_ground_biomes_are_configured(self) -> None:
        source = BIOMES_JS.read_text()

        self.assertGreaterEqual(source.count("groundMarks:"), 6)
        self.assertIn('poof: "sand"', source)
        self.assertIn('id: "desert"', source)
        self.assertIn('id: "golden"', source)
        self.assertIn('id: "mossy"', source)

    def test_walkers_and_fliers_emit_marks(self) -> None:
        source = CREATURE_JS.read_text()

        self.assertIn("emitGroundMark", source)
        self.assertIn("emitWalkerFootprint", source)
        self.assertIn("emitFlierLandingMarks", source)
        self.assertIn("groundMarkOffset", source)
        self.assertIn("poof: true", source)
        self.assertIn("makeDustKick", source)

    def test_crawlers_emit_continuous_trails(self) -> None:
        source = CATERPILLAR_JS.read_text()

        self.assertIn("emitGroundMark", source)
        self.assertIn("emitCrawlerGroundMark", source)
        self.assertIn("lastGroundMarkX", source)
        self.assertIn("groundMarkDistance", source)
        self.assertIn('c.type === "snail"', source)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
python3 -m unittest tests/test_ground_marks_static.py
```

Expected: FAIL, with missing strings such as `export function makeGroundMarks` and `groundMarks: null`.

- [ ] **Step 3: Commit the failing coverage**

```bash
git add tests/test_ground_marks_static.py
git commit -m "test: cover creature ground marks wiring"
```

---

### Task 2: Add ground-mark state, biome config, renderer, and tiny poof options

**Files:**
- Modify: `src/state.js`
- Modify: `src/biomes.js`
- Modify: `src/environment.js`
- Test: `tests/test_ground_marks_static.py`

- [ ] **Step 1: Add shared state**

In `src/state.js`, insert this property after `dustKicks: [],`:

```js
  groundMarks: null,
```

- [ ] **Step 2: Add soft-ground biome config**

In `src/biomes.js`, add these `groundMarks` objects inside the matching biome objects.

For `id: "verdant"`, after `furLength: 0.075,` add:

```js
    groundMarks: { color: "#20341f", opacity: 0.16, life: 5.5, softness: 1.15 },
```

For `id: "desert"`, after `noButterflies: true,` add:

```js
    groundMarks: { color: "#5f2424", opacity: 0.34, life: 7.0, softness: 1.1, poof: "sand" },
```

For `id: "frozen"`, after `furProbability: 0.85,` add:

```js
    groundMarks: { color: "#5d6d78", opacity: 0.14, life: 6.0, softness: 1.25 },
```

For `id: "golden"`, after `furProbability: 0.15,` add:

```js
    groundMarks: { color: "#704218", opacity: 0.22, life: 6.2, softness: 1.0 },
```

For `id: "mossy"`, after `furProbability: 0.70,` add:

```js
    groundMarks: { color: "#1f2d16", opacity: 0.18, life: 5.8, softness: 1.2 },
```

For `id: "twilight"`, after the `creatureCount` line add:

```js
    groundMarks: { color: "#171d48", opacity: 0.16, life: 5.5, softness: 1.15 },
```

For `id: "grove"`, after its `creatureCount` line add:

```js
    groundMarks: { color: "#263016", opacity: 0.17, life: 5.8, softness: 1.2 },
```

- [ ] **Step 3: Make dust kicks configurable for tiny landing poofs**

In `src/environment.js`, replace the existing `makeDustKick` and `stepDustKicks` functions with this complete block:

```js
export function makeDustKick(x, y, z, baseColor, opts = {}) {
  const count = opts.count ?? KICK_PARTICLES;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const velocityScale = opts.velocityScale ?? 1;
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y + 0.02;
    positions[i * 3 + 2] = z;
    const ang = Math.random() * Math.PI * 2;
    const sp = (0.4 + Math.random() * 0.5) * velocityScale;
    velocities[i * 3 + 0] = Math.cos(ang) * sp;
    velocities[i * 3 + 1] = (0.5 + Math.random() * 0.4) * velocityScale;
    velocities[i * 3 + 2] = Math.sin(ang) * sp;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(baseColor).offsetHSL(0, -0.1, 0.12),
    size: opts.size ?? 0.08,
    transparent: true,
    opacity: opts.opacity ?? 0.7,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = {
    velocities,
    age: 0,
    count,
    life: opts.life ?? KICK_LIFE,
    opacity: opts.opacity ?? 0.7,
  };
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
    const count = d.count ?? KICK_PARTICLES;
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      pos[ix + 0] += v[ix + 0] * dt;
      pos[ix + 1] += v[ix + 1] * dt;
      pos[ix + 2] += v[ix + 2] * dt;
      v[ix + 1] -= 3.5 * dt;
      v[ix + 0] *= 0.9;
      v[ix + 2] *= 0.9;
    }
    kick.geometry.attributes.position.needsUpdate = true;
    const life = d.life ?? KICK_LIFE;
    const opacity = d.opacity ?? 0.7;
    kick.material.opacity = Math.max(0, opacity * (1 - d.age / life));
    if (d.age >= life) {
      if (kick.parent) kick.parent.remove(kick);
      kick.geometry.dispose();
      kick.material.dispose();
      kicks.splice(p, 1);
    }
  }
}
```

- [ ] **Step 4: Add the ground-mark system**

In `src/environment.js`, insert this block after `stepDustKicks`:

```js
// ─── soft-ground creature marks ───
const GROUND_MARK_LIFT = 0.035;
const GROUND_MARK_MIN_Y = 0.04;
const GROUND_MARK_CAP = LOWFX ? 80 : 240;

const _groundMarkVS = `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const _groundMarkFS = `
precision highp float;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(vec2(p.x * 0.82, p.y * 1.18));
  float oval = smoothstep(0.5, 0.18, d);
  float center = smoothstep(0.36, 0.04, d);
  float alpha = oval * (0.72 + center * 0.28) * vAlpha;
  if (alpha <= 0.005) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const _markM = new THREE.Matrix4();
const _markQ = new THREE.Quaternion();
const _markP = new THREE.Vector3();
const _markS = new THREE.Vector3();
const _markHiddenScale = new THREE.Vector3(0, 0, 0);

function _hideGroundMark(system, i) {
  const d = system.userData;
  d.active[i] = 0;
  d.alphas[i] = 0;
  _markP.set(0, -999, 0);
  _markQ.identity();
  _markM.compose(_markP, _markQ, _markHiddenScale);
  system.setMatrixAt(i, _markM);
}

function _writeGroundMark(system, i, alphaScale) {
  const d = system.userData;
  const y = d.ys[i] + GROUND_MARK_LIFT;
  _markP.set(d.xs[i], y, d.zs[i]);
  _markQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.headings[i]);
  _markS.set(d.widths[i], 1, d.lengths[i]);
  _markM.compose(_markP, _markQ, _markS);
  system.setMatrixAt(i, _markM);
  d.alphas[i] = d.opacities[i] * alphaScale;
}

export function makeGroundMarks(biome) {
  const cfg = biome.groundMarks;
  if (!cfg) return null;

  const capacity = Math.max(1, Math.round(cfg.capacity ?? GROUND_MARK_CAP));
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
  const alphas = new Float32Array(capacity);
  geo.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(cfg.color) },
    },
    vertexShader: _groundMarkVS,
    fragmentShader: _groundMarkFS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData = {
    capacity,
    cursor: 0,
    active: new Uint8Array(capacity),
    xs: new Float32Array(capacity),
    ys: new Float32Array(capacity),
    zs: new Float32Array(capacity),
    headings: new Float32Array(capacity),
    widths: new Float32Array(capacity),
    lengths: new Float32Array(capacity),
    ages: new Float32Array(capacity),
    lifes: new Float32Array(capacity),
    opacities: new Float32Array(capacity),
    alphas,
    alphaAttr: geo.getAttribute("aAlpha"),
    cfg,
  };

  for (let i = 0; i < capacity; i++) _hideGroundMark(mesh, i);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.alphaAttr.needsUpdate = true;
  return mesh;
}

export function emitGroundMark(system, opts = {}) {
  if (!system || !system.userData) return;
  const d = system.userData;
  const x = opts.x;
  const z = opts.z;
  const y = opts.y ?? (state.heightFn ? state.heightFn(x, z) : 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (state.waterMesh && y < GROUND_MARK_MIN_Y) return;

  const softness = d.cfg.softness ?? 1;
  const i = d.cursor;
  d.cursor = (d.cursor + 1) % d.capacity;
  d.active[i] = 1;
  d.xs[i] = x;
  d.ys[i] = y;
  d.zs[i] = z;
  d.headings[i] = opts.heading ?? 0;
  d.widths[i] = Math.max(0.01, (opts.width ?? 0.18) * softness);
  d.lengths[i] = Math.max(0.01, (opts.length ?? 0.32) * softness);
  d.ages[i] = 0;
  d.lifes[i] = opts.life ?? d.cfg.life ?? 6;
  d.opacities[i] = opts.opacity ?? d.cfg.opacity ?? 0.2;
  _writeGroundMark(system, i, 1);
  system.instanceMatrix.needsUpdate = true;
  d.alphaAttr.needsUpdate = true;
}

export function stepGroundMarks(system, dt, heightFn) {
  if (!system || !system.userData || dt <= 0) return;
  const d = system.userData;
  let matrixDirty = false;
  let alphaDirty = false;
  for (let i = 0; i < d.capacity; i++) {
    if (!d.active[i]) continue;
    d.ages[i] += dt;
    if (d.ages[i] >= d.lifes[i]) {
      _hideGroundMark(system, i);
      matrixDirty = true;
      alphaDirty = true;
      continue;
    }
    if (heightFn) d.ys[i] = heightFn(d.xs[i], d.zs[i]);
    const u = d.ages[i] / Math.max(0.001, d.lifes[i]);
    const fade = 1 - u * u * (3 - 2 * u);
    _writeGroundMark(system, i, fade);
    matrixDirty = true;
    alphaDirty = true;
  }
  if (matrixDirty) system.instanceMatrix.needsUpdate = true;
  if (alphaDirty) d.alphaAttr.needsUpdate = true;
}
```

- [ ] **Step 5: Run static tests and record the expected partial failure**

Run:

```bash
python3 -m unittest tests/test_ground_marks_static.py
```

Expected: still FAIL because `world.js`, `main.js`, and fauna emitters are not wired yet. The export/config assertions should now pass.

- [ ] **Step 6: Commit foundation changes**

```bash
git add src/state.js src/biomes.js src/environment.js
git commit -m "feat: add soft ground mark renderer"
```

---

### Task 3: Wire ground marks into world generation and animation

**Files:**
- Modify: `src/world.js`
- Modify: `main.js`
- Test: `tests/test_ground_marks_static.py`

- [ ] **Step 1: Import ground-mark builder in world generation**

In `src/world.js`, add `makeGroundMarks` to the import from `./environment.js`:

```js
  makeGroundMarks,
```

- [ ] **Step 2: Reset ground mark state on regeneration**

In `generateWorld`, after `state.dustKicks = [];`, insert:

```js
  state.groundMarks = null;
```

- [ ] **Step 3: Create the mark layer after ground cover is built**

In `src/world.js`, after this block:

```js
  const pebbles = makePebbleField(biome, state.heightFn);
  if (pebbles) state.world.add(pebbles);
```

insert:

```js
  state.groundMarks = makeGroundMarks(biome);
  if (state.groundMarks) state.world.add(state.groundMarks);
```

- [ ] **Step 4: Import the mark stepper in the animation loop**

In `main.js`, update the environment import to include `stepGroundMarks`:

```js
import {
  stepParticles,
  stepWater,
  stepDirtPuffs,
  stepDustKicks,
  stepFlySwarms,
  stepGroundMarks,
} from "./src/environment.js";
```

Keep the existing one-line import style if preferred, but the imported names must include `stepGroundMarks`.

- [ ] **Step 5: Step marks after dust kicks**

In `main.js`, after:

```js
  stepDustKicks(state.dustKicks, dt);
```

insert:

```js
  stepGroundMarks(state.groundMarks, dt, state.heightFn);
```

- [ ] **Step 6: Run static tests and record the expected partial failure**

Run:

```bash
python3 -m unittest tests/test_ground_marks_static.py
```

Expected: still FAIL because `creature.js` and `caterpillar.js` do not emit marks yet. State/world/main assertions should now pass.

- [ ] **Step 7: Commit wiring**

```bash
git add src/world.js main.js
git commit -m "feat: wire soft ground marks"
```

---

### Task 4: Emit walker footprints and flier landing marks

**Files:**
- Modify: `src/fauna/creature.js`
- Test: `tests/test_ground_marks_static.py`

- [ ] **Step 1: Import the mark emitter**

In `src/fauna/creature.js`, change the environment import to:

```js
import { makeDirtPuff, makeDustKick, emitGroundMark } from "../environment.js";
```

- [ ] **Step 2: Store each walker's local foot offset**

Inside the walker foot creation loop, after:

```js
      foot.scale.set(1.15, 0.55, 1.3);
```

insert:

```js
      foot.userData.groundMarkOffset = { x: fx, z: fz };
```

- [ ] **Step 3: Add footprint helper functions**

In `src/fauna/creature.js`, insert these helpers after `nearestBuzzer`:

```js
function _localFootToWorld(c, localX, localZ) {
  const rot = -c.heading + Math.PI / 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const lx = localX * c.scale;
  const lz = localZ * c.scale;
  return {
    x: c.group.position.x + cr * lx + sr * lz,
    z: c.group.position.z - sr * lx + cr * lz,
  };
}

function emitWalkerFootprint(c, footIndex, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg || c.flies || c.isFish) return;
  const foot = c.feet[footIndex];
  const off = foot?.userData?.groundMarkOffset;
  if (!off) return;
  const p = _localFootToWorld(c, off.x, off.z);
  const y = heightFn(p.x, p.z);
  if (y <= 0.04) return;
  const side = off.x < 0 ? -1 : 1;
  emitGroundMark(marks, {
    x: p.x,
    y,
    z: p.z,
    heading: c.heading + side * 0.16,
    width: Math.max(0.08, 0.14 * c.scale),
    length: Math.max(0.14, 0.26 * c.scale),
    opacity: cfg.opacity,
    life: cfg.life,
  });
}

function emitFlierLandingMarks(c, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg || !c.flies || c.isFish || c.perchTarget) return;
  const y = heightFn(c.group.position.x, c.group.position.z);
  if (y <= 0.04) return;
  const offsets = [
    [-0.16, 0.10],
    [0.16, 0.10],
    [-0.12, -0.12],
    [0.12, -0.12],
  ];
  for (const [lx, lz] of offsets) {
    const p = _localFootToWorld(c, lx, lz);
    emitGroundMark(marks, {
      x: p.x,
      y: heightFn(p.x, p.z),
      z: p.z,
      heading: c.heading + (lx < 0 ? -0.12 : 0.12),
      width: Math.max(0.07, 0.12 * c.scale),
      length: Math.max(0.13, 0.24 * c.scale),
      opacity: cfg.opacity * 0.9,
      life: cfg.life,
    });
  }
  if (cfg.poof === "sand") {
    const kick = makeDustKick(c.group.position.x, y, c.group.position.z, cfg.color, {
      count: 3,
      size: 0.045,
      opacity: 0.35,
      velocityScale: 0.45,
      life: 0.32,
      poof: true,
    });
    state.world.add(kick);
    state.dustKicks.push(kick);
  }
}
```

- [ ] **Step 4: Emit flier landing marks when touchdown commits**

In `stepCreature`, inside the `if (canLand) { ... }` block that sets `c.landState = "landed"`, change the block to:

```js
      if (canLand) {
        c.landState = "landed";
        c.landTimer = 4 + Math.random() * 10;
        emitFlierLandingMarks(c, heightFn);
      }
```

- [ ] **Step 5: Replace center dust kicks with per-foot marks plus soft dust**

In the walker footstep detection block, replace:

```js
        const fx = c.group.position.x;
        const fz = c.group.position.z;
        const fy = heightFn(fx, fz);
        if (fy > 0.1) {
          const kick = makeDustKick(fx, fy, fz, c.dirtColor);
          state.world.add(kick);
          state.dustKicks.push(kick);
          c.lastDustAt = t;
        }
```

with:

```js
        emitWalkerFootprint(c, i, heightFn);
        const fx = c.group.position.x;
        const fz = c.group.position.z;
        const fy = heightFn(fx, fz);
        if (fy > 0.1 && state.currentBiome?.groundMarks?.poof === "sand") {
          const kick = makeDustKick(fx, fy, fz, c.dirtColor, {
            count: 2,
            size: 0.045,
            opacity: 0.28,
            velocityScale: 0.35,
            life: 0.28,
          });
          state.world.add(kick);
          state.dustKicks.push(kick);
        }
        c.lastDustAt = t;
```

This preserves a tiny sand poof for desert walkers while the visible long-lived print comes from `emitWalkerFootprint`.

- [ ] **Step 6: Run static tests and record the expected partial failure**

Run:

```bash
python3 -m unittest tests/test_ground_marks_static.py
```

Expected: still FAIL because crawler trail emitters are not added. Creature assertions should now pass.

- [ ] **Step 7: Commit creature emitters**

```bash
git add src/fauna/creature.js
git commit -m "feat: emit walker and flier ground marks"
```

---

### Task 5: Emit caterpillar and snail continuous trails

**Files:**
- Modify: `src/fauna/caterpillar.js`
- Test: `tests/test_ground_marks_static.py`

- [ ] **Step 1: Import the mark emitter**

In `src/fauna/caterpillar.js`, add this import after the existing terrain import:

```js
import { emitGroundMark } from "../environment.js";
```

- [ ] **Step 2: Track crawler mark distance**

In the object returned by `makeCaterpillar`, after `headingTarget: startHeading,` insert:

```js
    lastGroundMarkX: startX,
    lastGroundMarkZ: startZ,
    groundMarkDistance: 0,
```

- [ ] **Step 3: Add crawler trail helper**

In `src/fauna/caterpillar.js`, insert this helper before `export function stepCaterpillar`:

```js
function emitCrawlerGroundMark(c, x, z, heading, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg) return;

  const dx = x - c.lastGroundMarkX;
  const dz = z - c.lastGroundMarkZ;
  const moved = Math.sqrt(dx * dx + dz * dz);
  c.groundMarkDistance += moved;
  const isSnail = c.type === "snail";
  const interval = (isSnail ? 0.16 : 0.20) * c.scale;
  if (c.groundMarkDistance < interval) return;

  const y = heightFn(x, z);
  if (y <= 0.04) return;
  c.groundMarkDistance = 0;
  c.lastGroundMarkX = x;
  c.lastGroundMarkZ = z;

  emitGroundMark(marks, {
    x,
    y,
    z,
    heading,
    width: (isSnail ? 0.34 : 0.22) * c.scale,
    length: (isSnail ? 0.46 : 0.36) * c.scale,
    opacity: cfg.opacity * (isSnail ? 0.82 : 0.66),
    life: cfg.life * (isSnail ? 1.15 : 0.9),
  });
}
```

- [ ] **Step 4: Emit a trail segment after moving the head**

In `stepCaterpillar`, after:

```js
  head.rotation.y = -c.heading + Math.PI / 2;
```

insert:

```js
  emitCrawlerGroundMark(c, nx, nz, c.heading, heightFn);
```

- [ ] **Step 5: Run the full static suite**

Run:

```bash
python3 -m unittest tests/test_ground_marks_static.py tests/test_sky_rendering_invariants.py
node tests/follow-mode-static.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Commit crawler emitters**

```bash
git add src/fauna/caterpillar.js
git commit -m "feat: emit crawler ground trails"
```

---

### Task 6: Browser verification and tuning pass

**Files:**
- Modify as needed: `src/biomes.js`, `src/environment.js`, `src/fauna/creature.js`, `src/fauna/caterpillar.js`
- Test: existing static tests plus manual browser checks

- [ ] **Step 1: Start the dev server**

Run:

```bash
make start
```

Expected: either `started ... listening on 0.0.0.0:1999` or `already running ... on 0.0.0.0:1999`.

- [ ] **Step 2: Verify crimson dunes seed**

Open:

```text
http://localhost:1999/?seed=0xa156
```

Expected visual result:

- Walkers leave four-legged soft oval marks, not a single center dot.
- Marks fade over several seconds.
- Fliers create a compact landing mark cluster when they touch down on sand.
- Fliers create a tiny sand poof on touchdown.
- Caterpillars/snails create a continuous soft trail rather than paired prints.

- [ ] **Step 3: Verify one non-desert soft biome**

Open at least one known soft biome seed, or regenerate until a soft biome appears. Use the HUD biome name to confirm one of these biomes: verdant grove, frozen vale, golden steppe, mossy ruins, twilight meadow, mushroom grove.

Expected visual result:

- Marks are visible but subtler than crimson dunes.
- There is no sand poof unless the biome is crimson dunes.

- [ ] **Step 4: Verify a non-soft biome**

Open or regenerate until a biome without `groundMarks` appears, such as lavender marsh, ashen wastes, coral atoll, cloud island, or volcanic glass.

Expected visual result:

- No ground marks are emitted.
- Existing dust, particles, shadows, and grass still work.

- [ ] **Step 5: Check browser console**

Open DevTools console on the running page.

Expected: no runtime errors from `GroundMarks`, shader compilation, fauna stepping, or material disposal.

- [ ] **Step 6: Run final verification**

Run:

```bash
python3 -m unittest tests/test_ground_marks_static.py tests/test_sky_rendering_invariants.py
node tests/follow-mode-static.test.mjs
```

Expected: all tests pass and `node` exits with status 0.

- [ ] **Step 7: Commit tuning changes if any were made**

If Step 2–5 required tuning, commit those changes:

```bash
git add src/biomes.js src/environment.js src/fauna/creature.js src/fauna/caterpillar.js
git commit -m "fix: tune soft ground marks"
```

If no tuning was needed, leave the tree unchanged.
