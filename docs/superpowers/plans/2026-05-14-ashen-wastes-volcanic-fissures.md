# Ashen Wastes Volcanic Fissures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cozy glowing lava fissures to the Ashen Wastes biome with subtle warm lighting, windblown glowing cinders, and obstacle avoidance.

**Architecture:** Implement `lavafissure` as a normal flora builder in `src/flora.js`, then opt Ashen Wastes into it from `src/biomes.js`. Integrate with existing flora placement in `src/world.js` by adding footprint/obstacle metadata and a capped warm point light, expose the variant in inspect mode, and reuse the existing particle system with a new subtle `cinder` particle kind.

**Tech Stack:** Browser ES modules, Three.js from importmap/CDN, existing no-build static app, Makefile/server.py for manual verification.

---

## Files

- Modify: `src/flora.js` — add `FLORA_BUILDERS.lavafissure`.
- Modify: `src/biomes.js` — add `lavafissure` to Ashen Wastes flora mix and tune palette/count if needed.
- Modify: `src/world.js` — add footprint/obstacle metadata and capped point lights for fissures.
- Modify: `src/inspect.js` — add `lavafissure` to flora inspect variants.
- Modify: `src/environment.js` — add subtle ground-hugging windblown `cinder` particles.
- No new runtime dependencies.

## Task 1: Lava fissure flora builder

**Files:**
- Modify: `src/flora.js`

- [ ] **Step 1: Locate the builder insertion point**

Open `src/flora.js` and insert the new builder inside `export const FLORA_BUILDERS = { ... }`, immediately before the existing `obsidianshard(biome)` builder near the end of the file. This keeps volcanic/glowing flora grouped together.

- [ ] **Step 2: Add the `lavafissure` builder**

Add this builder code as a sibling of the other flora builders:

```js
  lavafissure(biome) {
    const g = new THREE.Group();
    const ember = new THREE.Color(biome.accent);
    const hot = new THREE.Color("#ffd166");
    const stoneMat = pooled("lavafissure.stone.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, -0.05, 0.04),
        flatShading: true,
        roughness: 0.9,
      })
    );
    const lavaMat = pooled("lavafissure.lava.mat", () =>
      new THREE.MeshStandardMaterial({
        color: ember.clone().lerp(hot, 0.22),
        emissive: ember.clone().lerp(hot, 0.45),
        emissiveIntensity: 1.65,
        flatShading: true,
        roughness: 0.35,
      })
    );
    const haloMat = pooled("lavafissure.halo.mat", () =>
      new THREE.MeshBasicMaterial({
        color: ember,
        transparent: true,
        opacity: 0.20,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    const seamCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < seamCount; i++) {
      const geo = new THREE.BoxGeometry(0.32 + Math.random() * 0.22, 0.018, 0.055 + Math.random() * 0.025);
      const seam = new THREE.Mesh(geo, lavaMat);
      const a = (i / seamCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const off = Math.random() * 0.16;
      seam.position.set(Math.cos(a) * off, 0.035 + i * 0.002, Math.sin(a) * off);
      seam.rotation.y = a + (Math.random() - 0.5) * 0.55;
      seam.layers.enable(BLOOM_LAYER);
      g.add(seam);
    }

    const stoneGeo = pooled("lavafissure.stone.geo", () => new THREE.IcosahedronGeometry(0.08, 0));
    const stones = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < stones; i++) {
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      const a = (i / stones) * Math.PI * 2 + Math.random() * 0.35;
      const r = 0.18 + Math.random() * 0.22;
      const s = 0.55 + Math.random() * 0.75;
      stone.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
      stone.scale.set(s * (0.9 + Math.random() * 0.5), 0.35 + Math.random() * 0.35, s);
      stone.rotation.set(Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.4);
      stone.castShadow = true;
      g.add(stone);
    }

    const haloGeo = pooled("lavafissure.halo.geo", () => new THREE.IcosahedronGeometry(0.24, 1));
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = 0.018;
    halo.scale.set(1.65, 0.18, 1.0);
    halo.rotation.y = Math.random() * Math.PI;
    halo.layers.enable(BLOOM_LAYER);
    g.add(halo);

    if (Math.random() < 0.65) {
      const ventGeo = pooled("lavafissure.vent.geo", () => new THREE.IcosahedronGeometry(0.055, 1));
      const vent = new THREE.Mesh(ventGeo, lavaMat);
      vent.position.y = 0.085;
      vent.scale.set(1.25, 0.6, 1.25);
      vent.layers.enable(BLOOM_LAYER);
      g.add(vent);
    }

    return g;
  },
```

- [ ] **Step 3: Self-review the builder**

Check these points manually:

```bash
grep -n "lavafissure" src/flora.js
grep -n "layers.enable(BLOOM_LAYER)" src/flora.js | tail -20
```

Expected: the new builder exists, and its lava/halo/vent meshes opt into `BLOOM_LAYER`.

- [ ] **Step 4: Commit Task 1**

```bash
git add src/flora.js
git commit -m "feat: add lava fissure flora builder"
```

## Task 2: Biome and world placement integration

**Files:**
- Modify: `src/biomes.js`
- Modify: `src/world.js`

- [ ] **Step 1: Add fissures to Ashen Wastes**

In `src/biomes.js`, change the Ashen Wastes flora list from:

```js
    flora: ["deadtree", "deadtree", "rock", "rock", "skull", "crystal"],
    floraCount: 42,
```

to:

```js
    flora: ["lavafissure", "lavafissure", "deadtree", "rock", "rock", "skull", "crystal"],
    floraCount: 48,
```

This makes fissures visible on seed `0x7622` without overwhelming the biome.

- [ ] **Step 2: Add world placement metadata**

In `src/world.js`, update `FLORA_FOOTPRINT` to include `lavafissure`:

```js
    fern: 0.18, rock: 0.30, limestonerock: 0.30, reed: 0.10,
    seaweed: 0.12, beachsucculent: 0.20, lavafissure: 0.34,
```

Update `OBSTACLE_KINDS` to include `lavafissure`:

```js
    "pillar", "archstone", "balloontree", "crystal",
    "lantern", "obsidianshard", "skull", "lavafissure",
```

Update `OBSTACLE_TOP` to include a low top height:

```js
    crystal: 1.6, lantern: 1.7, obsidianshard: 2.2, skull: 1.5,
    lavafissure: 0.28,
```

- [ ] **Step 3: Add a capped fissure light counter**

Near the existing crystal count setup, change:

```js
  let crystalCount = 0;
  let coralPlaced = 0;
  const CRYSTAL_CAP = 4;
```

to:

```js
  let crystalCount = 0;
  let fissureLightCount = 0;
  let coralPlaced = 0;
  const CRYSTAL_CAP = 4;
  const FISSURE_LIGHT_CAP = LOWFX ? 2 : 5;
```

- [ ] **Step 4: Add warm point lights for a capped number of fissures**

Immediately after the existing crystal light block:

```js
    if (kind === "crystal") {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 1.4, 6.5, 1.8);
      glow.position.set(0, 0.6, 0); // sits inside the cluster
      f.add(glow);
      crystalCount++;
    }
```

add:

```js
    if (kind === "lavafissure" && fissureLightCount < FISSURE_LIGHT_CAP) {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 0.85, 4.2, 2.0);
      glow.position.set(0, 0.22, 0);
      f.add(glow);
      fissureLightCount++;
    }
```

- [ ] **Step 5: Self-review integration**

Run:

```bash
grep -n "lavafissure" src/biomes.js src/world.js
```

Expected: Ashen Wastes flora includes `lavafissure`, footprint/obstacle/top metadata exists, and capped light code exists.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/biomes.js src/world.js
git commit -m "feat: add lava fissures to ashen wastes"
```

## Task 3: Inspect-mode variant and manual verification

**Files:**
- Modify: `src/inspect.js`

- [ ] **Step 1: Add inspect variant**

In `src/inspect.js`, update the flora variant list from:

```js
    "lantern", "coral", "braincoral", "cupcoral", "balloontree",
    "obsidianshard",
```

to:

```js
    "lantern", "coral", "braincoral", "cupcoral", "balloontree",
    "lavafissure", "obsidianshard",
```

- [ ] **Step 2: Verify there are no syntax errors by serving the app**

Run:

```bash
make start
```

Expected: server starts or reports it is already running on port `1999`.

- [ ] **Step 3: Manual browser verification**

Open these URLs:

```text
http://localhost:1999/?seed=0x7622
http://localhost:1999/?inspect=1&category=flora&biome=ashen&variant=lavafissure
```

Expected:

- Seed `0x7622` shows Ashen Wastes with visible low glowing fissures.
- Fissures are cute, rounded, and low-profile.
- Fissures have warm glow/bloom when FX bloom is enabled.
- Creatures/flora do not sit directly on top of fissures.
- Inspect mode shows a `lavafissure` specimen.
- Browser console has no errors.

- [ ] **Step 4: Commit Task 3**

```bash
git add src/inspect.js
git commit -m "feat: expose lava fissures in inspect mode"
```

## Task 4: Final verification and cleanup

**Files:**
- Review all changed files.

- [ ] **Step 1: Review final diff**

Run:

```bash
git status --short
git log --oneline -5
git diff HEAD~3..HEAD -- src/flora.js src/biomes.js src/world.js src/inspect.js
```

Expected: only the planned files changed; commits are focused.

- [ ] **Step 2: Re-run manual verification if needed**

If the server is not running, run:

```bash
make start
```

Then re-open:

```text
http://localhost:1999/?seed=0x7622
```

Expected: no console errors and the Ashen Wastes update is visible.

- [ ] **Step 3: Stop the server only if it was started solely for this verification**

```bash
make stop
```

Expected: server stops cleanly. If it was already running before implementation, leave it running instead.
