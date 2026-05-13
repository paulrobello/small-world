# Flora / Scenery Inspect View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `?inspect=1` so a "flora" category, switchable via `k`, frames every entry in `FLORA_BUILDERS` plus single-instance stand-ins for wildflower, grass blade, pebble, and water on the existing turntable.

**Architecture:** Single-file change in `src/inspect.js`. The existing `VARIANTS` array is regrouped into `VARIANTS_BY_CATEGORY` keyed by `"creature"` / `"flora"`. A new module-scope `_categoryIdx` is read from `?category=` at boot and written back via `_syncUrl`. `spawnSpecimen` branches on `variant.kind`: `creature` / `caterpillar` keep the existing paths; `flora` builds via `FLORA_BUILDERS[name]` (or a small `INSPECT_SCENERY_BUILDERS` map for the four synthetic variants), wraps construction in the seeded `Math.random` swap, computes a bounding-box-based lift, and parents the group to the scene.

**Tech Stack:** Vanilla ES modules, Three.js r155+ via importmap. No build, no tests, no linter — manual verification via `agentchrome`.

**Project notes for the engineer:**
- This is a single-page app loaded from CDN. There is no `package.json`, no test runner, no formatter. The `make` targets (`start`/`restart`/`logs`/`status`) wrap a local `http.server` at `http://localhost:1999`.
- Read `CLAUDE.md` for the determinism rules — `generateWorld` monkey-patches `Math.random`. The inspect path does the same trick around the build call, so any new build path must also wrap with the seeded RNG.
- The "Vibe" section of `CLAUDE.md` is binding for any visible change. Keep flora at the same scale/center as the existing creature inspect view (~0.4–1.6 units tall, centered on the disc at y=0).
- Commits should be small and atomic — the project's history is one commit per logical change.

---

### Task 1: Add categories + URL parsing scaffolding (no behaviour change yet)

**Goal:** Introduce `CATEGORIES` and `_categoryIdx` alongside the existing biome/variant state, parse `?category=` from the URL, sync it back. Don't add any flora variants yet — this task should leave the user-visible behaviour identical to today.

**Files:**
- Modify: `src/inspect.js`

- [ ] **Step 1: Read current state of `src/inspect.js`**

Read the whole file. The relevant sections are the URL-param parsing block (around `_findBiomeIdx` / `_findVariantIdx` / `_parseSeed` / `_biomeIdx` / `_variantIdx`) and `_syncUrl`.

- [ ] **Step 2: Add `CATEGORIES` constant and `_findCategoryIdx`**

Insert immediately after the `VARIANTS` declaration:

```js
const CATEGORIES = ["creature", "flora"];

function _findCategoryIdx(id) {
  if (!id) return 0;
  const i = CATEGORIES.indexOf(id);
  return i >= 0 ? i : 0;
}
```

(`VARIANTS` is still the existing creature-only list at this point; we restructure in Task 2.)

- [ ] **Step 3: Add `_categoryIdx` module state**

Find the line:

```js
let _biomeIdx = _findBiomeIdx(_params.get("biome"));
```

Insert immediately before it:

```js
let _categoryIdx = _findCategoryIdx(_params.get("category"));
```

- [ ] **Step 4: Add `category` to `_syncUrl`**

In `_syncUrl`, find:

```js
sp.set("inspect", "1");
sp.set("biome", BIOMES[_biomeIdx].id);
sp.set("variant", VARIANTS[_variantIdx].name);
```

Replace with:

```js
sp.set("inspect", "1");
sp.set("category", CATEGORIES[_categoryIdx]);
sp.set("biome", BIOMES[_biomeIdx].id);
sp.set("variant", VARIANTS[_variantIdx].name);
```

- [ ] **Step 5: Manual smoke test**

Run `make restart`. Open `http://localhost:1999/?inspect=1` in a browser. Confirm the URL bar rewrites to include `&category=creature` and the creature studio still works exactly as before. Cycle biome/variant — `category=creature` must persist.

- [ ] **Step 6: Commit**

```bash
git add src/inspect.js
git commit -m "Inspect: add category URL param scaffold (no-op default)"
```

---

### Task 2: Restructure `VARIANTS` into `VARIANTS_BY_CATEGORY`

**Goal:** Move the existing 6-entry creature list into a `VARIANTS_BY_CATEGORY` map keyed by category. The current creature flow continues to work. Flora list is added in Task 3.

**Files:**
- Modify: `src/inspect.js`

- [ ] **Step 1: Replace the `VARIANTS` constant**

Find the block:

```js
const VARIANTS = [
  { name: "walker",   kind: "creature",    build: (biome) => makeCreature(biome) },
  { name: "flier",    kind: "creature",    build: (biome) => {
      // re-roll until we get a flier (or, on fish biomes, a fish — they always fly)
      for (let i = 0; i < 30; i++) {
        const c = makeCreature(biome);
        if (c.flies) return c;
        // dispose the rejected creature's geometry to avoid leaks
        c.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
            else o.material.dispose();
          }
        });
      }
      return makeCreature(biome);
    } },
  { name: "sleeper",  kind: "creature",    build: (biome) => makeCreature(biome, { sleeper: true }) },
  { name: "burrower", kind: "creature",    build: (biome) => makeCreature(biome, { burrower: true }) },
  { name: "caterpillar", kind: "caterpillar", build: (biome) => makeCaterpillar(biome) },
  { name: "snail",       kind: "caterpillar", build: (biome) => makeCaterpillar(biome, { kind: "snail" }) },
];
```

Replace with:

```js
const CREATURE_VARIANTS = [
  { name: "walker",   kind: "creature",    build: (biome) => makeCreature(biome) },
  { name: "flier",    kind: "creature",    build: (biome) => {
      // re-roll until we get a flier (or, on fish biomes, a fish — they always fly)
      for (let i = 0; i < 30; i++) {
        const c = makeCreature(biome);
        if (c.flies) return c;
        // dispose the rejected creature's geometry to avoid leaks
        c.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
            else o.material.dispose();
          }
        });
      }
      return makeCreature(biome);
    } },
  { name: "sleeper",  kind: "creature",    build: (biome) => makeCreature(biome, { sleeper: true }) },
  { name: "burrower", kind: "creature",    build: (biome) => makeCreature(biome, { burrower: true }) },
  { name: "caterpillar", kind: "caterpillar", build: (biome) => makeCaterpillar(biome) },
  { name: "snail",       kind: "caterpillar", build: (biome) => makeCaterpillar(biome, { kind: "snail" }) },
];

const VARIANTS_BY_CATEGORY = {
  creature: CREATURE_VARIANTS,
  flora: [], // populated in next task
};

function _currentVariants() {
  return VARIANTS_BY_CATEGORY[CATEGORIES[_categoryIdx]];
}
```

- [ ] **Step 2: Replace every `VARIANTS[_variantIdx]` reference**

Find these occurrences in the file and replace each one:

| Find | Replace with |
|---|---|
| `VARIANTS.findIndex` (inside `_findVariantIdx`) | `_currentVariants().findIndex` (also rename the function to accept the lookup correctly — see next step) |
| `VARIANTS.length` (in the `,` / `.` key handlers) | `_currentVariants().length` |
| `VARIANTS[_variantIdx]` (in `spawnSpecimen`, `updateHud`, `_syncUrl`) | `_currentVariants()[_variantIdx]` |

- [ ] **Step 3: Update `_findVariantIdx` to be category-aware**

Replace:

```js
function _findVariantIdx(name) {
  if (!name) return 0;
  const i = VARIANTS.findIndex((v) => v.name === name);
  return i >= 0 ? i : 0;
}
```

with:

```js
function _findVariantIdx(name) {
  if (!name) return 0;
  const i = _currentVariants().findIndex((v) => v.name === name);
  return i >= 0 ? i : 0;
}
```

Note: `_findVariantIdx` is called at module init via:

```js
let _variantIdx = _findVariantIdx(_params.get("variant"));
```

This must run *after* `_categoryIdx` is initialised. Verify ordering: `_categoryIdx` was added at Task 1 step 3 *before* `_biomeIdx`, so it's already before `_variantIdx`. Good.

- [ ] **Step 4: Manual smoke test**

`make restart`. Open `http://localhost:1999/?inspect=1`. Cycle `[/]` and `,/.` — should be unchanged from before. The URL still rewrites with `category=creature&biome=…&variant=walker` etc.

Specifically test: reload `?inspect=1&category=creature&variant=caterpillar` and confirm the caterpillar appears.

- [ ] **Step 5: Commit**

```bash
git add src/inspect.js
git commit -m "Inspect: restructure variants into VARIANTS_BY_CATEGORY"
```

---

### Task 3: Add flora variants from `FLORA_BUILDERS`

**Goal:** Populate `VARIANTS_BY_CATEGORY.flora` with all 16 entries from `FLORA_BUILDERS`. Add the spawn-time path for `variant.kind === "flora"`. After this task, switching category by editing the URL to `?inspect=1&category=flora&variant=tree` shows a tree on the disc; key bindings for category-switching come in Task 5.

**Files:**
- Modify: `src/inspect.js`

- [ ] **Step 1: Add imports**

At the top of `src/inspect.js`, after the existing fauna import, add:

```js
import { FLORA_BUILDERS, resetFloraPool } from "./flora.js";
```

(The existing imports already pull `BIOMES`, `mulberry32`, etc.)

- [ ] **Step 2: Build the flora variants list**

In the file, find `VARIANTS_BY_CATEGORY` and replace its `flora: []` value with:

```js
flora: [
  "tree", "pine", "mushroom", "fern", "rock", "grass", "deadtree",
  "pillar", "archstone", "crystal", "bigmushroom", "berrybush",
  "lantern", "coral", "balloontree", "obsidianshard",
].map((name) => ({
  name,
  kind: "flora",
  build: (biome) => FLORA_BUILDERS[name](biome),
})),
```

- [ ] **Step 3: Add `_lift` helper**

Above `spawnSpecimen`, add:

```js
// Compute a Y offset so a flora group rests on the turntable disc top.
// Disc top sits at y ≈ 0 (disc center is at y=-0.03 with height 0.05, so the
// top face is at y ≈ -0.005). Most flora builders author their geometry with
// the base at y=0, but some (crystal shards, obsidian shards) place their
// lowest geometry slightly below 0. Use the post-build bbox to lift up.
function _liftForFlora(group) {
  const bbox = new THREE.Box3().setFromObject(group);
  if (!isFinite(bbox.min.y)) return 0;
  return Math.max(0, -bbox.min.y);
}
```

- [ ] **Step 4: Branch `spawnSpecimen` on `variant.kind === "flora"`**

In `spawnSpecimen`, find the block that branches on `variant.kind === "caterpillar"`:

```js
  _specimen = c;
  _specimenKind = variant.kind;
  if (variant.kind === "caterpillar") {
```

Insert a new branch *before* the caterpillar branch. The full updated section reads:

```js
  _specimen = c;
  _specimenKind = variant.kind;
  if (variant.kind === "flora") {
    // Flora returns just a THREE.Group with no per-frame state. Lift so the
    // group sits on the disc; the wind-sway shader animates via the global
    // windUniforms.uTime advance in main.js.
    const lift = _liftForFlora(c);
    c.position.set(0, lift, 0);
    scene.add(c);
  } else if (variant.kind === "caterpillar") {
```

Wait — the caterpillar branch closes with `} else {` then the creature branch. After our insertion the structure becomes `if (flora) … else if (caterpillar) … else …`. Verify the closing braces in the file match this new structure.

- [ ] **Step 5: Handle the `c.group` vs `c` mismatch**

Note that for flora, `variant.build(biome)` returns a `THREE.Group` directly (no `{ group, … }` wrapper). The line earlier in `spawnSpecimen`:

```js
let c;
try {
  c = variant.build(biome);
} finally {
  Math.random = original;
}

_specimen = c;
_specimenKind = variant.kind;
```

…stores the raw group as `_specimen` for flora. That's fine for `spawnSpecimen` itself (we just need the bbox + add-to-scene), but the existing disposal at the top of `spawnSpecimen` does:

```js
if (_specimen && _specimen.group) {
  if (_specimen.group.parent) _specimen.group.parent.remove(_specimen.group);
  disposeObject(_specimen.group);
}
```

Update that block to handle both shapes:

```js
if (_specimen) {
  const grp = _specimen.group ?? _specimen;
  if (grp.parent) grp.parent.remove(grp);
  disposeObject(grp);
}
```

And `stepInspect` accesses `_specimen.group`:

```js
const g = _specimen.group;
g.position.x = 0;
g.position.z = 0;
```

Guard the creature path so it doesn't run for flora — already implicit because the existing branching is on `_specimenKind`, but let's verify the structure of `stepInspect`. Replace:

```js
export function stepInspect(dt, t) {
  if (!_specimen) return;
  // … pause/step logic …
  if (_specimenKind === "caterpillar") {
    stepInspectCaterpillar(_specimen, useDt);
  } else {
    stepCreature(_specimen, useDt, useT, _flatHeight);
    const g = _specimen.group;
    g.position.x = 0;
    g.position.z = 0;
  }
}
```

with:

```js
export function stepInspect(dt, t) {
  if (!_specimen) return;
  if (_specimenKind === "flora") return; // wind sway runs via global uTime; no per-frame work
  let useDt = dt;
  let useT = t;
  if (_paused) {
    if (_stepDt !== 0) {
      useDt = _stepDt;
      _frozenT += _stepDt;
      useT = _frozenT;
      _stepDt = 0;
    } else {
      useDt = 0;
      useT = _frozenT;
    }
  } else {
    _frozenT = t;
  }
  if (_specimenKind === "caterpillar") {
    stepInspectCaterpillar(_specimen, useDt);
  } else {
    stepCreature(_specimen, useDt, useT, _flatHeight);
    const g = _specimen.group;
    g.position.x = 0;
    g.position.z = 0;
  }
}
```

(The `flora` early-out goes above the pause logic. Pause/step is meaningless for flora.)

- [ ] **Step 6: Reset flora pool on each flora spawn**

`FLORA_BUILDERS` shares per-world materials via a `_pool` map keyed by material name (e.g. `tree.trunk.mat`). Cycling variants in inspect would keep growing the pool with stale entries. Call `resetFloraPool()` at the top of the flora branch — but **only** for flora, since creatures don't touch the pool:

Find the new flora branch added in Step 4 and update:

```js
  if (variant.kind === "flora") {
    resetFloraPool();
    const lift = _liftForFlora(c);
    c.position.set(0, lift, 0);
    scene.add(c);
  } else if (variant.kind === "caterpillar") {
```

- [ ] **Step 7: Reset entity arrays for flora spawns too**

The existing zeroing-out of `state.creatures` etc. at the top of `spawnSpecimen` is fine for flora — flora simply doesn't push to any of those arrays. Verify the existing block stays in place ahead of the new branch.

- [ ] **Step 8: Manual smoke test**

`make restart`. Open `http://localhost:1999/?inspect=1&category=flora&variant=tree`. Expected: a single tree centered on the turntable disc, framed by the camera.

Then test by edit-URL (no key bindings yet):
- `&variant=crystal` — shards visible above disc
- `&variant=lantern&biome=ashen` — lantern with orb visible
- `&variant=obsidianshard&biome=obsidian` — shards on disc
- `&variant=balloontree&biome=cloud` — balloon tree centered

Also test switching back to creature via URL: `&category=creature&variant=walker` — confirm the creature path still works.

- [ ] **Step 9: Commit**

```bash
git add src/inspect.js
git commit -m "Inspect: spawn flora variants on the turntable"
```

---

### Task 4: Add synthetic scenery variants (wildflower / grassblade / pebble / water)

**Goal:** Add four single-instance stand-ins to the flora category so wildflowers, grass blades, pebbles, and water can be inspected without standing up a full field/world.

**Files:**
- Modify: `src/inspect.js`

- [ ] **Step 1: Import wildflower palette + jitterGeo + applyWindSway**

Append to existing imports at the top of `src/inspect.js`:

```js
import { WILDFLOWER_PALETTES, PEBBLE_DENSITY } from "./biomes.js";
import { jitterGeo, applyWindSway } from "./util.js";
```

(Don't worry about `PEBBLE_DENSITY` being unused — actually skip it; pebble for inspect doesn't need density. Just import `WILDFLOWER_PALETTES`, `jitterGeo`, `applyWindSway`.)

So the final new import line is:

```js
import { WILDFLOWER_PALETTES } from "./biomes.js";
import { jitterGeo, applyWindSway } from "./util.js";
```

- [ ] **Step 2: Add `INSPECT_SCENERY_BUILDERS` map**

Above `VARIANTS_BY_CATEGORY`, add:

```js
// Single-instance stand-ins for things that exist only as InstancedMesh fields
// or world-spanning planes in normal worlds. Sized up so they read at the
// turntable distance (~1.5 units to camera) — actual field instances are
// 0.05–0.34 units tall, which would be invisible specks on the disc.
const INSPECT_SCENERY_BUILDERS = {
  wildflower(biome) {
    const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
    const g = new THREE.Group();
    const flowerGeo = new THREE.IcosahedronGeometry(0.05, 0);
    flowerGeo.scale(1, 0.7, 1);
    // 3 wildflowers in a tight cluster, each a different palette color, so
    // a multi-color biome (verdant, marsh) shows its range at a glance.
    for (let i = 0; i < Math.min(3, palette.length); i++) {
      const baseCol = new THREE.Color(palette[i]);
      const m = applyWindSway(
        new THREE.MeshStandardMaterial({
          color: baseCol,
          emissive: biome.glowFlowers ? baseCol.clone() : 0x000000,
          emissiveIntensity: biome.glowFlowers ? 1.1 : 0,
          flatShading: true,
          roughness: 0.4,
        }),
        1.2
      );
      const flower = new THREE.Mesh(flowerGeo, m);
      // ~6× the field-instance scale so the cluster reads at inspect distance.
      flower.scale.setScalar(6);
      const a = (i / 3) * Math.PI * 2;
      flower.position.set(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18);
      flower.castShadow = true;
      g.add(flower);
    }
    return g;
  },

  grassblade(biome) {
    const g = new THREE.Group();
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

    const baseCol = new THREE.Color(biome.ground[1]).offsetHSL(0, 0.1, -0.08);
    const tipCol = baseCol.clone().offsetHSL(0.0, -0.15, 0.18);
    const mat = new THREE.MeshStandardMaterial({
      color: baseCol,
      roughness: 0.95,
      side: THREE.DoubleSide,
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

    // Tuft of 5 blades fanning out from the center. Scale ~2× for inspect.
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(blade, mat);
      const a = (i / 5) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
      m.rotation.y = a;
      m.rotation.z = (Math.random() - 0.5) * 0.15;
      m.scale.setScalar(2);
      g.add(m);
    }
    return g;
  },

  pebble(biome) {
    const g = new THREE.Group();
    const pebbleGeo = jitterGeo(new THREE.IcosahedronGeometry(0.08, 0), 0.025);
    pebbleGeo.scale(1.3, 0.45, 1.3);
    const col = new THREE.Color(biome.cliff).offsetHSL(0, -0.05, 0.12);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      flatShading: true,
      roughness: 1,
    });
    // Single pebble, ~3× field-instance scale so it reads on the disc.
    const m = new THREE.Mesh(pebbleGeo, mat);
    m.scale.setScalar(3);
    m.position.y = 0.02 * 3;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return g;
  },

  water(biome) {
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1.8, 1.8);
    geo.rotateX(-Math.PI / 2);
    const col = new THREE.Color(biome.water || biome.fog);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      transparent: true,
      opacity: 0.55,
      roughness: 0.32,
      metalness: 0.18,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.001; // sit just above disc surface to avoid z-fighting
    g.add(m);
    return g;
  },
};
```

- [ ] **Step 3: Append the four synthetic variants to the flora list**

Find the `flora:` entry in `VARIANTS_BY_CATEGORY` and append the synthetic entries. The full updated value:

```js
flora: [
  "tree", "pine", "mushroom", "fern", "rock", "grass", "deadtree",
  "pillar", "archstone", "crystal", "bigmushroom", "berrybush",
  "lantern", "coral", "balloontree", "obsidianshard",
].map((name) => ({
  name,
  kind: "flora",
  build: (biome) => FLORA_BUILDERS[name](biome),
})).concat([
  { name: "wildflower", kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.wildflower(biome) },
  { name: "grassblade", kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.grassblade(biome) },
  { name: "pebble",     kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.pebble(biome) },
  { name: "water",      kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.water(biome) },
]),
```

- [ ] **Step 4: Manual smoke test**

`make restart`. Visit:
- `?inspect=1&category=flora&variant=wildflower&biome=verdant` — small cluster of warm-colored flowers on disc.
- `?inspect=1&category=flora&variant=wildflower&biome=marsh` — glow-on (`glowFlowers` flag), should emit.
- `?inspect=1&category=flora&variant=grassblade&biome=verdant` — green tuft of blades.
- `?inspect=1&category=flora&variant=pebble&biome=desert` — single warm-rust pebble.
- `?inspect=1&category=flora&variant=water&biome=marsh` — translucent dark-green water disc on the turntable.

- [ ] **Step 5: Commit**

```bash
git add src/inspect.js
git commit -m "Inspect: add wildflower/grassblade/pebble/water stand-ins"
```

---

### Task 5: Wire `k` key + update HUD

**Goal:** Add the category-switch key and surface the active category in the HUD.

**Files:**
- Modify: `src/inspect.js`

- [ ] **Step 1: Add the `k` key handler**

In the `keydown` listener inside `setupInspect`, find the existing key chain. Append a new branch *before* the closing `}` of the listener (after the `ArrowLeft` branch):

```js
    } else if (e.key === "k") {
      _categoryIdx = (_categoryIdx + 1) % CATEGORIES.length;
      _variantIdx = 0;
      _seedOverride = null;
      spawnSpecimen(scene);
```

So the chain looks like `… ArrowRight … ArrowLeft … k …`. Make sure indentation matches the surrounding `else if` blocks.

- [ ] **Step 2: Update `updateHud` to show category + per-category hints**

Replace the body of `updateHud` with:

```js
function updateHud() {
  if (!_hudEl) return;
  const biome = BIOMES[_biomeIdx];
  const variants = _currentVariants();
  const variant = variants[_variantIdx];
  const category = CATEGORIES[_categoryIdx];
  const pauseTag = _paused ? `<span class="ihud-paused">PAUSED</span>` : "";
  // Reroll has no visible effect for most flora; hide the hint there to
  // avoid implying we'll change something.
  const rerollHint = category === "flora" ? "" : " &nbsp; r reroll";
  _hudEl.innerHTML =
    `<span class="ihud-key">INSPECT</span>` +
    `<span class="ihud-val">${biome.name}</span>` +
    `<span class="ihud-sep">·</span>` +
    `<span class="ihud-val">${category}</span>` +
    `<span class="ihud-sep">·</span>` +
    `<span class="ihud-val">${variant.name}</span>` +
    pauseTag +
    `<span class="ihud-keys">[/] biome &nbsp; k category &nbsp; ,/. variant${rerollHint} &nbsp; space pause &nbsp; ←/→ step</span>`;
}
```

- [ ] **Step 3: Manual smoke test**

`make restart`. Visit `?inspect=1`. Press `k` — category flips to `flora`, the tree appears, HUD shows `category` field. Press `k` again — back to creature, walker appears. Cycle `,/.` within each category — different specimens. Cycle `[/]` — biome changes within either category.

Use `agentchrome` for the final visual check:

```bash
agentchrome connect --launch --headless=false
agentchrome navigate 'http://localhost:1999/?inspect=1'
agentchrome interact key 'k'
agentchrome page snapshot
```

Confirm a flora specimen is centered on the disc and the HUD is correct.

- [ ] **Step 4: Commit**

```bash
git add src/inspect.js
git commit -m "Inspect: 'k' key cycles category, HUD shows it"
```

---

### Task 6: Update CLAUDE.md and ideas.md

**Goal:** Reflect the new affordance in project docs and clear it off the ideas list if present.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ideas.md` (if it mentions this feature; otherwise skip)

- [ ] **Step 1: Update the `src/inspect.js` paragraph in `CLAUDE.md`**

Find the bullet that starts with **`src/inspect.js`** — `?inspect=1` URL gate. Replace the sentence that describes the keyboard with one that mentions the category axis. The full updated bullet:

```
- **`src/inspect.js`** — `?inspect=1` URL gate. Replaces normal world-gen with a single specimen on a neutral studio backdrop (gradient dome + turntable disc + hemisphere/key/rim lights). Inspect cycles a **category** axis (`creature` ↔ `flora`) with `k`, and within each category cycles **variant** (`,`/`.`) — creatures: walker/flier/sleeper/burrower/caterpillar/snail; flora: every entry in `FLORA_BUILDERS` plus single-instance stand-ins for `wildflower` / `grassblade` / `pebble` / `water`. Also: biome (`[`/`]`), reroll seed (`r`), pause (Space), and frame-step bidirectionally (`←`/`→`, also rewinds integrated `c.bob` / `c.age` for creatures). URL params (`category`, `biome`, `variant`, `seed`, `paused`) are parsed at boot and written back via `history.replaceState` on every state change so the address bar always reflects the exact view.
```

- [ ] **Step 2: Check `ideas.md`**

```bash
grep -ni 'inspect' /Users/probello/Repos/small-world/ideas.md
```

If a flora/scenery-inspect item exists in `ideas.md`, delete it (per the project's "implement it, remove it from `ideas.md`" convention). If no such item exists, skip this step.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md ideas.md
git commit -m "Docs: flora inspect category in CLAUDE.md"
```

(If `ideas.md` had no relevant entry, omit it from the `git add`.)

---

### Task 7: Final verification via agentchrome

**Goal:** Confirm the full feature works end-to-end with real rendered output. No code changes.

- [ ] **Step 1: Restart server and connect agentchrome**

```bash
make restart
agentchrome connect --launch --headless=false
```

- [ ] **Step 2: Visit each category × a sampling of variants × biomes**

Run, in order:

```bash
agentchrome navigate 'http://localhost:1999/?inspect=1&category=flora&biome=verdant&variant=tree'
agentchrome page snapshot
agentchrome navigate 'http://localhost:1999/?inspect=1&category=flora&biome=obsidian&variant=obsidianshard'
agentchrome page snapshot
agentchrome navigate 'http://localhost:1999/?inspect=1&category=flora&biome=marsh&variant=water'
agentchrome page snapshot
agentchrome navigate 'http://localhost:1999/?inspect=1&category=flora&biome=verdant&variant=wildflower'
agentchrome page snapshot
agentchrome navigate 'http://localhost:1999/?inspect=1&category=flora&biome=ashen&variant=lantern'
agentchrome page snapshot
agentchrome navigate 'http://localhost:1999/?inspect=1&category=creature&biome=verdant&variant=walker'
agentchrome page snapshot
```

Expected for each: the specimen is centered on the disc, framed by the camera, lit. The HUD reads with the correct category/biome/variant.

- [ ] **Step 3: Key cycling**

```bash
agentchrome navigate 'http://localhost:1999/?inspect=1'
agentchrome interact key 'k'   # → flora
agentchrome interact key '.'   # next flora variant
agentchrome interact key '.'   # again
agentchrome interact key 'k'   # → creature
agentchrome page snapshot
```

Confirm via snapshot that we're back in creature category.

- [ ] **Step 4: Shut down agentchrome**

```bash
agentchrome shutdown
```

- [ ] **Step 5: No commit needed**

Verification only. If any issue was found, file follow-up commits to the relevant earlier task's code; otherwise stop here.

---

## Self-Review Notes

**Spec coverage:**
- ✅ Categories axis + `_categoryIdx` — Task 1.
- ✅ `VARIANTS_BY_CATEGORY` — Task 2.
- ✅ 16 `FLORA_BUILDERS` entries + flora spawn path + lift + pool reset + stepInspect early-out — Task 3.
- ✅ 4 synthetic scenery variants (wildflower, grassblade, pebble, water) — Task 4.
- ✅ `k` key + HUD update + reroll hint hiding — Task 5.
- ✅ URL `category=` param round-trip — Task 1 (parse + sync).
- ✅ CLAUDE.md documentation — Task 6.
- ✅ Verification — Task 7.

**Placeholder scan:** none.

**Type consistency:** `_currentVariants()` returns the per-category array used everywhere (`spawnSpecimen`, `updateHud`, `_syncUrl`, key handlers, `_findVariantIdx`). `variant.kind` is one of `"creature"`, `"caterpillar"`, `"flora"` — branched on consistently in `spawnSpecimen` (Task 3 Step 4) and `stepInspect` (Task 3 Step 5). `_specimen` shape: `{ group, … }` for creature/caterpillar, raw `THREE.Group` for flora — disposal block handles both shapes (Task 3 Step 5).
