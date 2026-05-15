# Bumblebee Flyer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bumblebee normal-flyer variant exclusive to Verdant Grove that flies between and lands on tree-like things.

**Architecture:** Extend `makeCreature()` with a `bumblebee` variant option gated by a new `flyerVariants` biome config. Expand `state.perchSpots` to include leafballtree canopies so bumblebees naturally land on trees. All anatomy changes live inside `makeCreature`; world.js only passes variant intent.

**Tech Stack:** Three.js r0.184, vanilla ES modules, no build/test runner. Verification is browser-based.

---

### Task 1: Add bumblebee config to Verdant Grove biome

**Files:**
- Modify: `src/biomes.js` (Verdant Grove entry, around lines 3–33)

- [ ] **Step 1: Add `flyerVariants` to the Verdant Grove biome object**

In `src/biomes.js`, inside the first biome entry (`id: "verdant"`), add a new field after `furLength: 0.075,`:

```js
    flyerVariants: [
      {
        kind: "bumblebee",
        stripeOverride: ["#111111", "#ffd13b"],
      },
    ],
```

- [ ] **Step 2: Commit**

```bash
git add src/biomes.js
git commit -m "feat: add bumblebee flyerVariants config to verdant grove biome"
```

---

### Task 2: Register leafballtree canopies as perch spots

**Files:**
- Modify: `src/world.js` (perch spot registration, around lines 654–670)

- [ ] **Step 1: Expand perch spot registration to include leafballtree**

In `src/world.js`, find the block that registers mushroom perch spots (the `if (kind === "mushroom" || kind === "bigmushroom")` block around line 659). Change the condition to also include `leafballtree`:

```js
      if (kind === "mushroom" || kind === "bigmushroom" || kind === "leafballtree") {
```

The leafballtree builder already sets `userData.obstacleTopY = 2.25 + canopyYOffset` (in `flora.js` line 562). The existing code reads `f.userData.capTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT`, so for leafballtree it will fall through to `OBSTACLE_TOP.leafballtree` (2.25) unless we also write `capTopY`. Since leafballtree uses `obstacleTopY` instead of `capTopY`, add a fallback:

Change the `capLocal` line from:
```js
        const capLocal = f.userData.capTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT;
```
to:
```js
        const capLocal = f.userData.capTopY ?? f.userData.obstacleTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT;
```

This also benefits bigmushroom which already sets `capTopY` — no behavior change for existing perches.

Also set `perchWind` data on leafballtree perches so fliers track canopy sway. The leafballtree builder applies `applyWindSway` to leaf materials but doesn't expose a `perchWind` on the group. For now the perch spot will use static position (no `perchWind`), which is fine — the canopy sway amplitude on leafballtree is subtle and a static perch point still reads well. The existing `currentPerchPoint()` already handles missing `perchWind` by returning the perch as-is.

- [ ] **Step 2: Commit**

```bash
git add src/world.js
git commit -m "feat: register leafballtree canopies as perch spots for fliers"
```

---

### Task 3: Add bumblebee anatomy to makeCreature

**Files:**
- Modify: `src/fauna/creature.js` (makeCreature function, body/wings/legs/antennae/fur sections)

This is the largest task. It adds bumblebee-specific visual anatomy inside the existing `makeCreature` builder.

- [ ] **Step 1: Detect bumblebee variant at the top of makeCreature**

At the top of `makeCreature`, after the existing `const isAngler = !!opts.angler;` line (~line 153), add:

```js
  const isBumblebee = opts.variant === "bumblebee";
```

- [ ] **Step 2: Force flies=true for bumblebee**

The existing `flies` assignment (~line 156):
```js
  const flies = isFish ? true : forceWalk ? false : Math.random() < 0.3;
```

Change to:
```js
  const flies = isFish ? true : isBumblebee ? true : forceWalk ? false : Math.random() < 0.3;
```

- [ ] **Step 3: Force fur on for bumblebee**

Find the fur roll section (~line 164):
```js
  const wantsFur = !isFish && (opts.furry ?? (furProb > 0 && furRoll < furProb));
```

Change to:
```js
  const wantsFur = isBumblebee || (!isFish && (opts.furry ?? (furProb > 0 && furRoll < furProb)));
```

- [ ] **Step 4: Override body color with stripe colors and elongate body**

After the body scale is set (~line 179 `body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);`), add bumblebee body modifications:

```js
  if (isBumblebee) {
    // Bumblebee body: 25% longer, use stripe colors instead of random palette
    const stripes = opts.stripeColors || ["#111111", "#ffd13b"];
    body.material.color.set(stripes[0]);
    body.material.name = "bumblebee.body.mat";
    // Override body scale: elongate Z by 25%, keep X/Y as flier defaults
    bodyBaseX = 1.05;
    bodyBaseY = 0.92;
    bodyBaseZ = 1.05 * 1.25; // flier Z × 1.25 elongation
    body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
  }
```

Note: `bodyBaseX/Y/Z` are declared with `const` (~line 176-178). They need to change to `let`:

```js
  let bodyBaseY = isFish ? 0.72 : flies ? 0.92 : 0.82;
  let bodyBaseX = isFish ? 0.9 : flies ? 1.05 : 1;
  let bodyBaseZ = isFish ? 1.45 : flies ? 1.05 : 1.25;
```

Then add stripe band geometry right after the body mesh is added to the group. Add alternating stripe ring meshes as children of the body:

```js
  if (isBumblebee) {
    const stripes = opts.stripeColors || ["#111111", "#ffd13b"];
    body.material.color.set(stripes[0]);
    body.material.name = "bumblebee.body.mat";
    let bodyBaseY = isFish ? 0.72 : flies ? 0.92 : 0.82;
    let bodyBaseX = isFish ? 0.9 : flies ? 1.05 : 1;
    let bodyBaseZ = isFish ? 1.45 : flies ? 1.05 : 1.25;
    bodyBaseZ *= 1.25;
    body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
    // Stripe bands — small flat rings around the body in the second stripe color
    const stripeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(stripes[1]),
      flatShading: true,
      roughness: 0.45,
    });
    const bandGeo = new THREE.CylinderGeometry(0.40, 0.40, 0.08, 8);
    bandGeo.rotateX(Math.PI / 2);
    for (let bi = -1; bi <= 1; bi++) {
      const band = new THREE.Mesh(bandGeo, stripeMat);
      band.position.z = bi * 0.18;
      band.scale.set(1.02, 1.02, 1);
      body.add(band);
    }
  }
```

Actually, simpler approach: instead of separate ring meshes, use the same technique as the existing bee.js — small flattened icospheres positioned as bands. But since the bumblebee body is an icosphere, flat rings as children will work. The bands should be slightly larger than the body radius at their position so they read as colored stripes wrapping around.

Wait — looking at the existing bee.js approach, it uses a separate mesh for the stripe band. Let me use a simpler approach: multiple thin disc-like meshes parented to the body group.

Actually, the simplest cute approach is to use the same icosahedron-based body but with vertex colors or multiple small band meshes. Given the existing code style, let me use band meshes.

- [ ] **Step 5: Force antennae on for bumblebee**

Find the antennae section (~line 253-284). The current code:
```js
  const antennae = [];
  if (!isFish && Math.random() > 0.55) {
```

Change to:
```js
  const antennae = [];
  if (!isFish && (isBumblebee || Math.random() > 0.55)) {
```

- [ ] **Step 6: Add six legs instead of dangling feet for bumblebee fliers**

Find the flier legs/feet section (~line 378-392, the "two dangling feet" block). Wrap the existing dangling feet in an else branch and add bumblebee six-leg anatomy:

Replace the dangling feet block:
```js
      // two dangling feet for charm (no legs, just little nubs hanging)
      const dangleMat = ...
      for (const sign of [-1, 1]) {
        const dangle = ...
        ...
      }
```

With:
```js
      if (isBumblebee) {
        // Six tiny legs — three pairs along the underside
        const legMat = new THREE.MeshStandardMaterial({
          color: bodyCol.clone().offsetHSL(0, 0, -0.3),
          flatShading: true,
        });
        const legGeo = new THREE.CylinderGeometry(0.018, 0.015, 0.2, 4);
        legGeo.translate(0, -0.1, 0);
        const positions = [
          [-0.14, 0.08],   // front-left
          [ 0.14, 0.08],   // front-right
          [-0.14, 0.00],   // mid-left
          [ 0.14, 0.00],   // mid-right
          [-0.14,-0.08],   // back-left
          [ 0.14,-0.08],   // back-right
        ];
        for (const [fx, fz] of positions) {
          const leg = new THREE.Mesh(legGeo, legMat);
          leg.position.set(fx, -0.18, fz);
          leg.castShadow = true;
          group.add(leg);
          legs.push(leg);
          // tiny foot nub
          const foot = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 4, 4),
            legMat
          );
          foot.position.set(fx, -0.38, fz);
          group.add(foot);
          feet.push(foot);
        }
      } else {
        // two dangling feet for charm (no legs, just little nubs hanging)
        const dangleMat = new THREE.MeshStandardMaterial({
          color: bodyCol.clone().offsetHSL(0, 0, -0.25),
          flatShading: true,
        });
        for (const sign of [-1, 1]) {
          const dangle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.04, 0.16, 5),
            dangleMat
          );
          dangle.position.set(sign * 0.11, -0.36, 0.02);
          dangle.castShadow = true;
          group.add(dangle);
        }
      }
```

Note: the bumblebee legs go into the same `legs` and `feet` arrays, so the existing sleeper/curl animation code (which iterates those arrays) will handle them automatically.

- [ ] **Step 7: Add stinger for bumblebee**

After the wings section and before the scale/return block, add a stinger mesh for bumblebees. Find the end of the wings block (around line 392) and add before the walker `else` branch:

Inside the `if (flies)` block, after the bumblebee legs / dangling feet section, add:

```js
      // Stinger — small rounded cone at the rear
      if (isBumblebee) {
        const stingerGeo = new THREE.ConeGeometry(0.06, 0.22, 6);
        stingerGeo.rotateX(Math.PI / 2);
        stingerGeo.translate(0, 0, -0.5);
        const stinger = new THREE.Mesh(stingerGeo, new THREE.MeshStandardMaterial({
          color: 0x201610,
          flatShading: true,
          roughness: 0.6,
        }));
        stinger.castShadow = true;
        group.add(stinger);
      }
```

- [ ] **Step 8: Halve the final scale for bumblebee**

Find the scale calculation (~line 436):
```js
  const scale = baseScale * sizeMul * burrowScale * (isFish ? 0.5625 : 1);
```

Change to:
```js
  const scale = baseScale * sizeMul * burrowScale * (isFish ? 0.5625 : 1) * (isBumblebee ? 0.5 : 1);
```

- [ ] **Step 9: Set inspect variant metadata for bumblebee**

Find the `group.userData.inspect` assignment (~line 159-167). The variant name currently uses `flies ? "flier" : "walker"` etc. Add bumblebee:

Change:
```js
            : flies
              ? "flier"
              : "walker",
```

To:
```js
            : isBumblebee
              ? "bumblebee"
              : flies
                ? "flier"
                : "walker",
```

- [ ] **Step 10: Commit**

```bash
git add src/fauna/creature.js
git commit -m "feat: add bumblebee anatomy to makeCreature (stripes, 6 legs, stinger, forced fur/antennae)"
```

---

### Task 4: Spawn bumblebee variants during Verdant Grove creature generation

**Files:**
- Modify: `src/world.js` (creature generation loop, around lines 745–851)

- [ ] **Step 1: Add bumblebee spawning logic**

In the creature generation loop, find the `else` branch at line ~848 where plain creatures are spawned:
```js
    } else {
      if (placeOnGround(makeCreature(biome))) budget--;
    }
```

Change to:
```js
    } else {
      const bumbleConfig = biome.flyerVariants?.[0]; // first variant for now
      if (bumbleConfig && Math.random() < 0.35) {
        // Spawn as bumblebee variant — will be forced to flies=true
        if (placeOnGround(makeCreature(biome, {
          variant: bumbleConfig.kind,
          stripeColors: bumbleConfig.stripeOverride,
        }))) budget--;
      } else {
        if (placeOnGround(makeCreature(biome))) budget--;
      }
    }
```

The 35% roll means roughly a third of Verdant Grove creatures will be bumblebees, keeping normal creature variety. Since the bumblebee is forced `flies=true`, the existing `placeOnGround` logic will place it at flier height automatically.

- [ ] **Step 2: Commit**

```bash
git add src/world.js
git commit -m "feat: spawn bumblebee variants in verdant grove creature generation"
```

---

### Task 5: Add bumblebee to inspect mode

**Files:**
- Modify: `src/inspect.js` (variant list, around lines 40–65)

- [ ] **Step 1: Add bumblebee variant to the inspect variant cycle**

Find the variant list in inspect.js (~line 42). After the flier entry, add a bumblebee entry:

```js
  { name: "bumblebee", kind: "creature", build: (biome, opts = {}) => {
      const stripeOverride = biome.flyerVariants?.find(v => v.kind === "bumblebee")?.stripeOverride;
      return makeCreature(biome, { ...opts, variant: "bumblebee", stripeColors: stripeOverride });
    }},
```

This goes between the `flier` and `sleeper` entries in the variants array.

- [ ] **Step 2: Commit**

```bash
git add src/inspect.js
git commit -m "feat: add bumblebee variant to inspect mode"
```

---

### Task 6: Browser verification

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

```bash
make start
```

- [ ] **Step 2: Load a known Verdant Grove seed**

Open http://localhost:1999/?seed=0xcfff (known Verdant Grove seed from README screenshots).

- [ ] **Step 3: Visual checklist**

Confirm:
- [ ] At least one bumblebee-style creature appears (smaller than normal fliers, striped black/yellow body, fuzzy, antennaed, six tiny legs, stinger at rear)
- [ ] Bumblebees fly between tree canopies and land on them
- [ ] Other creatures in the scene are unaffected (normal walkers, normal fliers, caterpillars, etc.)
- [ ] Existing bee swarms still orbit flowers normally
- [ ] No console errors

- [ ] **Step 4: Test a non-Verdant-Grove biome**

Load any non-verdant seed and confirm no bumblebee variants appear.

- [ ] **Step 5: Test inspect mode**

Open http://localhost:1999/?inspect=1&variant=bumblebee&biome=verdant and confirm the bumblebee renders correctly on the studio backdrop.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: bumblebee variant polish after browser verification"
```
