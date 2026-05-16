# Fern Flora Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current crossed-cone fern with a cute, lacy, fern-like clump using arcing fronds and paired leaflets.

**Architecture:** Keep the change inside the existing `FLORA_BUILDERS.fern(biome)` builder. Reuse the existing flora resource pool, seeded `Math.random()` variations, Three.js primitive geometries, and `applyWindSway` material patching so the fern remains deterministic, disposable, and animated like other flora.

**Tech Stack:** Plain ES modules, Three.js r0.184 from CDN, no build step, local static server on port 1999.

---

## File Structure

- Modify: `src/flora.js`
  - Replace the `fern(biome)` builder with a lacy frond clump.
  - Add no new exports and no new modules.
  - Keep pooled geometry/material usage local to the builder through existing `pooled()`.
- No expected changes: `src/world.js`
  - Keep fern footprint unchanged unless browser verification shows obvious overlap problems.
- No automated test files:
  - This repository has no test runner or package manager, and this is a visual art/geometry change. Verification is browser-based visual inspection plus console smoke checks.

---

### Task 1: Replace fern geometry with lacy frond clump

**Files:**
- Modify: `src/flora.js:819-842`

- [ ] **Step 1: Capture the current baseline visually**

Run the local app if it is not already running:

```bash
make start
```

Open the current fern inspect URL:

```bash
open 'http://localhost:1999/?inspect=1&category=flora&biome=grove&variant=fern&seed=0x1398&view=default&fur=0&paused=1'
```

Expected: the current fern appears as a few crossed cone blades, matching the user's screenshot. This establishes the visual behavior to replace.

- [ ] **Step 2: Replace the `fern(biome)` builder**

In `src/flora.js`, replace the entire current `fern(biome) { ... }` block with this implementation:

```js
  fern(biome) {
    const g = new THREE.Group();
    const baseColor = new THREE.Color(biome.ground[0]).offsetHSL(0.02, 0.10, 0.16);
    const ribMat = pooled("fern.rib.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: baseColor.clone().offsetHSL(0.01, -0.02, -0.08),
          flatShading: true,
          roughness: 0.78,
        }),
        1.25
      )
    );
    const leafletMat = pooled("fern.leaflet.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: baseColor,
          flatShading: true,
          roughness: 0.82,
        }),
        1.55
      )
    );
    const ribGeo = pooled("fern.rib.geo", () => {
      const geo = new THREE.CylinderGeometry(0.012, 0.018, 1, 5);
      geo.translate(0, 0.5, 0);
      return geo;
    });
    const leafletGeo = pooled("fern.leaflet.geo", () => {
      const geo = new THREE.SphereGeometry(0.09, 8, 5);
      geo.scale(1.55, 0.18, 0.42);
      return geo;
    });
    const heartGeo = pooled("fern.heart.geo", () =>
      jitterGeo(new THREE.IcosahedronGeometry(0.105, 0), 0.018).scale(1.25, 0.55, 1.0)
    );

    const heart = new THREE.Mesh(heartGeo, leafletMat);
    heart.position.y = 0.035;
    heart.castShadow = true;
    g.add(heart);

    const fronds = 5 + Math.floor(Math.random() * 3);
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < fronds; i++) {
      const t = fronds <= 1 ? 0 : i / (fronds - 1);
      const radial = start + t * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
      const lean = -0.62 + t * 1.24 + (Math.random() - 0.5) * 0.16;
      const length = 0.48 + Math.random() * 0.20;
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.scale.set(0.85, length, 0.85);
      rib.position.set(Math.cos(radial) * 0.045, 0.035, Math.sin(radial) * 0.045);
      rib.rotation.order = "YXZ";
      rib.rotation.y = radial;
      rib.rotation.x = 0.18 + Math.random() * 0.20;
      rib.rotation.z = lean;
      rib.castShadow = true;
      g.add(rib);

      const pairs = 4 + Math.floor(Math.random() * 3);
      for (let j = 0; j < pairs; j++) {
        const u = (j + 1) / (pairs + 1);
        const sideTaper = 1 - u;
        const leafletScale = 0.72 + sideTaper * 0.58;
        const y = 0.08 + u * length * 0.86;
        const sideOffset = 0.045 + sideTaper * 0.030;
        for (const side of [-1, 1]) {
          const leaflet = new THREE.Mesh(leafletGeo, leafletMat);
          leaflet.position.set(side * sideOffset, y, 0);
          leaflet.scale.set(leafletScale, 0.82 + Math.random() * 0.22, 0.72 + sideTaper * 0.25);
          leaflet.rotation.y = side * (0.18 + u * 0.12);
          leaflet.rotation.z = side * (0.38 + sideTaper * 0.22);
          leaflet.rotation.x = (Math.random() - 0.5) * 0.16;
          leaflet.castShadow = true;
          rib.add(leaflet);
        }
      }
    }
    return g;
  },
```

- [ ] **Step 3: Reload inspect mode and check for runtime errors**

Reload:

```bash
open 'http://localhost:1999/?inspect=1&category=flora&biome=grove&variant=fern&seed=0x1398&view=default&fur=0&paused=1'
```

Check the browser console with agentchrome or DevTools.

Expected:
- No JavaScript errors.
- Fern renders as a lacy clump with paired leaflets.
- No curled fiddleheads appear.

- [ ] **Step 4: Verify visual requirements across palettes**

Inspect these URLs:

```text
http://localhost:1999/?inspect=1&category=flora&biome=grove&variant=fern&seed=0x1398&view=default&fur=0&paused=1
http://localhost:1999/?inspect=1&category=flora&biome=mossy&variant=fern&seed=0x1398&view=default&fur=0&paused=1
http://localhost:1999/?inspect=1&category=flora&biome=mushroom&variant=fern&seed=0x1398&view=default&fur=0&paused=1
http://localhost:1999/?inspect=1&category=flora&biome=twilight&variant=fern&seed=0x1398&view=default&fur=0&paused=1
http://localhost:1999/?inspect=1&category=flora&biome=frozen&variant=fern&seed=0x1398&view=default&fur=0&paused=1
```

Expected:
- The fern remains readable in each biome's palette.
- The silhouette is rounded and cute, not spiky.
- Leaflet density does not look too heavy for inspect mode.

- [ ] **Step 5: Verify full-world readability**

Open the grove world normally:

```bash
open 'http://localhost:1999/?biome=grove&seed=0x1398'
```

Expected:
- Fern clumps read as ferns at normal camera distance.
- Creature pathing is unchanged; ferns remain low-profile visual ground cover.
- No obvious mesh-count performance issue appears.

- [ ] **Step 6: Commit implementation**

```bash
git add src/flora.js
git commit -m "feat: overhaul fern flora silhouette"
```

Expected: one focused implementation commit after visual verification.

---

## Self-Review

- Spec coverage: Task 1 replaces crossed cones with lacy fronds, uses chunkier base and finer tips, excludes fiddleheads, preserves deterministic variation, and defines browser verification across requested biome palettes.
- Placeholder scan: no TBD/TODO/fill-in-later steps remain.
- Type consistency: all referenced helpers (`THREE`, `pooled`, `applyWindSway`, `jitterGeo`) already exist in `src/flora.js` scope.
