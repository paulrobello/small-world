# Marsh Angler Fish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a few cute glowing angler fish to lavender marsh water areas, including seed `0x35c2`, without replacing existing marsh creatures.

**Architecture:** Reuse the existing `makeCreature` fish path and `stepCreature` underwater movement instead of adding a new entity type. Add an `opts.angler` fish variant that builds a soft glowing lure, then opt the marsh biome into a small deterministic angler top-up during `generateWorld`.

**Tech Stack:** Plain ES modules, Three.js from CDN, seeded `Math.random` inside `generateWorld`, no build step, no npm.

---

## File Structure

- Modify `src/fauna/creature.js`: add the `opts.angler` fish variant, lure mesh, and gentle lure animation inside the existing creature builder/stepper.
- Modify `src/biomes.js`: add `anglerFish: true` to the lavender marsh biome only.
- Modify `src/world.js`: spawn 2–4 extra angler fish in opted-in water biomes using the existing underwater placement constraints.
- Modify `src/inspect.js`: add an `angler` inspect variant so the model can be viewed directly.

---

### Task 1: Add angler fish model variant

**Files:**
- Modify: `src/fauna/creature.js`

- [ ] **Step 1: Update fish/angler flags and inspect variant label**

In `src/fauna/creature.js`, change the start of `makeCreature` from:

```js
export function makeCreature(biome, opts = {}) {
  const isFish = biome.creatureKind === "fish";
```

to:

```js
export function makeCreature(biome, opts = {}) {
  const isAngler = !!opts.angler;
  const isFish = biome.creatureKind === "fish" || isAngler;
```

Then change the fish inspect label block from:

```js
        : isFish
          ? "fish"
```

to:

```js
        : isAngler
          ? "angler"
          : isFish
            ? "fish"
```

- [ ] **Step 2: Add angler lure variables before fish fin construction**

Find this block:

```js
  const feet = [];
  const legs = [];
  const wings = [];
  let tailFin = null;
```

Change it to:

```js
  const feet = [];
  const legs = [];
  const wings = [];
  let tailFin = null;
  let lureStalk = null;
  let lureOrb = null;
```

- [ ] **Step 3: Add the lure mesh inside the fish branch**

Inside `if (flies) { if (isFish) { ... } }`, immediately after:

```js
      tailFin = new THREE.Mesh(tailGeo, finMat);
      tailFin.position.set(0, 0.02, -0.58);
      tailFin.castShadow = true;
      group.add(tailFin);
```

insert:

```js
      if (isAngler) {
        const lureMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          emissive: new THREE.Color(biome.accent),
          emissiveIntensity: 1.55,
          roughness: 0.25,
        });
        const stalkMat = new THREE.MeshStandardMaterial({
          color: bodyCol.clone().offsetHSL(0, -0.08, -0.08),
          roughness: 0.65,
          flatShading: true,
        });
        lureStalk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.018, 0.52, 6),
          stalkMat
        );
        lureStalk.position.set(0, 0.38, 0.2);
        lureStalk.rotation.x = -0.72;
        group.add(lureStalk);

        lureOrb = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 10, 8),
          lureMat
        );
        lureOrb.position.set(0, 0.27, 0);
        lureOrb.layers.enable(BLOOM_LAYER);
        lureStalk.add(lureOrb);
      }
```

- [ ] **Step 4: Return lure references in the creature state**

In the object returned by `makeCreature`, after:

```js
    tailFin,
```

insert:

```js
    lureStalk,
    lureOrb,
    isAngler,
```

- [ ] **Step 5: Animate the lure gently**

Inside `stepCreature`, in the `if (c.flies) { if (c.isFish) { ... } }` branch, after:

```js
      if (c.tailFin) c.tailFin.rotation.y = Math.sin(phase * 1.15) * 0.55;
      c.body.rotation.z = wave * 0.04;
```

insert:

```js
      if (c.isAngler && c.lureStalk && c.lureOrb) {
        c.lureStalk.rotation.z = Math.sin(t * 1.9 + c.flapPhase) * 0.12;
        c.lureOrb.scale.setScalar(1 + Math.sin(t * 3.1 + c.flapPhase) * 0.12);
      }
```

- [ ] **Step 6: Syntax check and commit**

Run:

```bash
node --check src/fauna/creature.js
```

Expected: no output and exit code 0.

Commit:

```bash
git add src/fauna/creature.js
git commit -m "Add angler fish creature variant"
```

---

### Task 2: Spawn marsh angler fish in water

**Files:**
- Modify: `src/biomes.js`
- Modify: `src/world.js`

- [ ] **Step 1: Opt lavender marsh into angler fish**

In `src/biomes.js`, in the `id: "marsh"` biome object, add the flag after the existing `water` property:

```js
    water: "#1b1230",
    anglerFish: true,
```

- [ ] **Step 2: Add deterministic angler top-up in world generation**

In `src/world.js`, after the creature spawning `while (budget > 0 && creatureAttempts < ncreatures * 10) { ... }` loop and before the `// caterpillars` comment, insert:

```js
  if (biome.anglerFish && biome.water) {
    const nAnglers = 2 + Math.floor(Math.random() * 3);
    let anglersPlaced = 0;
    let anglerAttempts = 0;
    while (anglersPlaced < nAnglers && anglerAttempts < nAnglers * 20) {
      anglerAttempts++;
      const angler = makeCreature(biome, { angler: true });
      if (placeFishUnderwater(angler)) {
        anglersPlaced++;
      } else {
        disposeGroup(angler.group);
      }
    }
  }
```

This keeps normal marsh creatures intact and adds 2–4 extra underwater anglers using the same depth rules as coral-atoll fish.

- [ ] **Step 3: Syntax check and commit**

Run:

```bash
node --check src/biomes.js
node --check src/world.js
```

Expected: both commands exit 0 with no output.

Commit:

```bash
git add src/biomes.js src/world.js
git commit -m "Spawn angler fish in marsh water"
```

---

### Task 3: Add inspect-mode angler variant

**Files:**
- Modify: `src/inspect.js`

- [ ] **Step 1: Add variant entry**

In `src/inspect.js`, in the `CREATURE_VARIANTS` array, immediately after the existing fish entry:

```js
  { name: "fish",     kind: "creature",    build: (biome) => makeCreature({ ...biome, creatureKind: "fish" }) },
```

insert:

```js
  { name: "angler",   kind: "creature",    build: (biome) => makeCreature({ ...biome, creatureKind: "fish", anglerFish: true }, { angler: true }) },
```

- [ ] **Step 2: Syntax check and commit**

Run:

```bash
node --check src/inspect.js
```

Expected: no output and exit code 0.

Commit:

```bash
git add src/inspect.js
git commit -m "Add angler fish inspect variant"
```

---

### Task 4: Runtime verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Start or reuse the local server**

Run:

```bash
make status || true
make start
```

Expected: server is running on port `1999`. If `make start` reports it is already running, that is acceptable.

- [ ] **Step 2: Verify the target seed manually**

Open:

```text
http://localhost:1999/?seed=0x35c2
```

Expected visual results:
- HUD biome is `lavender marsh`.
- Existing marsh creatures still appear on land/air.
- 2–4 angler fish swim below the water surface.
- Each angler has a soft glowing lure; it does not look sharp, scary, or neon-harsh.
- Fish stay under the waterline and do not clip far below the underwater shelf.

- [ ] **Step 3: Verify inspect mode**

Open:

```text
http://localhost:1999/?inspect=1&category=creature&variant=angler&biome=marsh
```

Expected: inspect mode shows the angler fish variant with body, fins, eyes, and glowing lure.

- [ ] **Step 4: Final status check**

Run:

```bash
git status --short
```

Expected: no uncommitted source changes except any intentionally ignored local runtime files such as `.server.pid` or `.server.log`.
