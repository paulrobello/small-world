# Twilight Edge Aura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable island edge-aura configuration and make twilight meadow use a lightweight wind-swept grass ring with slight inward overlap.

**Architecture:** Keep the existing single transparent `RingGeometry` approach in `src/sky.js`, but drive its dimensions, colors, alpha, and shader pattern from `biome.edgeAura`. Biomes without `edgeAura` keep the current mist behavior through explicit default values; twilight sets `pattern: "grass"` in `src/biomes.js`.

**Tech Stack:** Browser-native ES modules, Three.js `ShaderMaterial`, existing `state.windUniforms.uTime`, no build step and no automated test suite.

---

## File Structure

- Modify `src/biomes.js`: add `edgeAura` config only to the `twilight` biome.
- Modify `src/sky.js`: refactor `makeIslandEdgeMist(biome)` to read `biome.edgeAura`, preserve default mist fallback values, and add a grass fragment-shader branch.
- No new files.

---

### Task 1: Add twilight biome edge-aura config

**Files:**
- Modify: `src/biomes.js`

- [ ] **Step 1: Re-read the twilight biome block before editing**

Run:

```bash
sed -n '155,185p' src/biomes.js
```

Expected: the block contains `id: "twilight"`, `glowFlowers: true`, and existing `dusk` / `night` palette objects.

- [ ] **Step 2: Add `edgeAura` after `glowFlowers: true`**

Change this section:

```js
    furProbability: 0.45,
    glowFlowers: true,
    dusk: { sky: "#3a3470", fog: "#2c285a", sun: "#ffb070", ground: "#1a204a" },
```

To this:

```js
    furProbability: 0.45,
    glowFlowers: true,
    edgeAura: {
      pattern: "grass",
      colors: ["#32386f", "#c9a8e8", "#ffd97a"],
      alpha: 0.82,
      innerSoft: 2.7,
      outerSoft: 22.0,
      inwardOverlap: 1.9,
      outwardFadeStart: 0.58,
      y: 0.46,
      noiseScale: 0.092,
      streakScale: 18.0,
      windStrength: 1.0,
    },
    dusk: { sky: "#3a3470", fog: "#2c285a", sun: "#ffb070", ground: "#1a204a" },
```

- [ ] **Step 3: Verify the biome file has the new config**

Run:

```bash
sed -n '155,195p' src/biomes.js
```

Expected: the `twilight` biome includes `edgeAura.pattern = "grass"` and no other biome is changed.

---

### Task 2: Refactor the edge mist builder into a configurable edge aura

**Files:**
- Modify: `src/sky.js`

- [ ] **Step 1: Re-read the existing edge mist function**

Run:

```bash
sed -n '520,650p' src/sky.js
```

Expected: the output begins at `export function makeIslandEdgeMist(biome)` and ends before `export function updateSkyColors`.

- [ ] **Step 2: Replace the full `makeIslandEdgeMist` function with this implementation**

Replace the existing `makeIslandEdgeMist(biome)` function with:

```js
// Low perimeter aura for round layouts. By default this preserves the soft
// island-edge mist, while biomes can tune `edgeAura` for reusable variants such
// as grass, water, swamp, or denser fog without adding extra per-frame state.
export function makeIslandEdgeMist(biome) {
  const centers = state.currentLayout?.centers ?? [];
  const center = centers.find((c) => (c.shape?.kind ?? "round") === "round");
  if (!center) return null;

  const radius = center.visualRadius ?? center.radius;
  const aura = biome.edgeAura ?? {};
  const pattern = aura.pattern ?? "mist";
  const innerSoft = aura.innerSoft ?? Math.max(1.0, radius * 0.04);
  const outerSoft = aura.outerSoft ?? Math.max(24.0, center.radius * 1.36);
  const inwardOverlap = aura.inwardOverlap ?? innerSoft;
  const innerRadius = Math.max(0.1, radius - inwardOverlap);
  const outerRadius = radius + outerSoft;
  const geo = new THREE.RingGeometry(
    innerRadius,
    outerRadius,
    LOWFX ? 96 : 160,
    LOWFX ? 4 : 7
  );

  const colors = aura.colors ?? [];
  const colA = colors[0]
    ? new THREE.Color(colors[0])
    : new THREE.Color("#8f8f9a").lerp(new THREE.Color(biome.fog), 0.25);
  const colB = colors[1]
    ? new THREE.Color(colors[1])
    : new THREE.Color("#d4d0c2").lerp(new THREE.Color(biome.fog), 0.18);
  const colC = colors[2]
    ? new THREE.Color(colors[2])
    : new THREE.Color(biome.accent ?? biome.sun ?? "#ffffff");

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: state.windUniforms.uTime,
      uRadius: { value: radius },
      uInnerSoft: { value: innerSoft },
      uOuterSoft: { value: outerSoft },
      uOutwardFadeStart: { value: aura.outwardFadeStart ?? 0.62 },
      uPattern: { value: pattern === "grass" ? 1 : 0 },
      uColA: { value: colA },
      uColB: { value: colB },
      uColC: { value: colC },
      uAlpha: { value: aura.alpha ?? 1.0 },
      uNoiseScale: { value: aura.noiseScale ?? 0.058 },
      uStreakScale: { value: aura.streakScale ?? 12.0 },
      uWindStrength: { value: aura.windStrength ?? 0.65 },
    },
    vertexShader: `
      varying vec2 vLocalXZ;
      void main() {
        vLocalXZ = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uRadius;
      uniform float uInnerSoft;
      uniform float uOuterSoft;
      uniform float uOutwardFadeStart;
      uniform float uPattern;
      uniform vec3 uColA;
      uniform vec3 uColB;
      uniform vec3 uColC;
      uniform float uAlpha;
      uniform float uNoiseScale;
      uniform float uStreakScale;
      uniform float uWindStrength;
      varying vec2 vLocalXZ;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float a = vnoise(p);
        float b = vnoise(p * 2.17 + vec2(4.2, -1.7));
        float c = vnoise(p * 4.03 + vec2(-2.6, 3.1));
        return a * 0.55 + b * 0.30 + c * 0.15;
      }

      void main() {
        float d = length(vLocalXZ);
        float inward = smoothstep(uRadius - uInnerSoft, uRadius + 0.25, d);
        float outward = 1.0 - smoothstep(uRadius + uOuterSoft * uOutwardFadeStart, uRadius + uOuterSoft, d);
        float edge = inward * outward;
        float seam = 1.0 - smoothstep(0.0, uInnerSoft * 0.55, abs(d - uRadius));
        vec2 base = vLocalXZ * uNoiseScale;
        vec2 driftA = vec2(uTime * 0.032, -uTime * 0.021) * uWindStrength;
        vec2 driftB = vec2(-uTime * 0.018, uTime * 0.027) * uWindStrength;
        vec2 domainWarp = vec2(
          fbm(base * 1.7 + driftA + vec2(2.4, -1.1)),
          fbm(base * 1.5 + driftB + vec2(-3.2, 2.7))
        ) - 0.5;
        vec2 p = base + domainWarp * 1.85;
        float waveA = fbm(p + driftA);
        float waveB = fbm(p * 1.85 - driftB + vec2(3.1, -2.4));
        float waveC = fbm(p * 3.2 + domainWarp * 0.75 + vec2(-1.7, 4.0));
        float n = waveA * 0.50 + waveB * 0.33 + waveC * 0.17;

        if (uPattern > 0.5) {
          float angle = atan(vLocalXZ.y, vLocalXZ.x);
          float radial = d - uRadius;
          float gust = fbm(vec2(angle * 2.8 + uTime * 0.035 * uWindStrength, radial * 0.10));
          float bladeWave = sin(angle * uStreakScale + radial * 0.82 + gust * 4.5 + uTime * 0.42 * uWindStrength);
          float bladeMask = smoothstep(0.28, 0.95, bladeWave * 0.5 + 0.5);
          float fine = smoothstep(0.40, 0.86, fbm(vec2(angle * 34.0, radial * 0.18) + domainWarp * 1.6));
          float highlight = bladeMask * fine;
          float tufts = smoothstep(0.18, 0.78, n + highlight * 0.22);
          float overlapBoost = 1.0 - smoothstep(0.0, uInnerSoft * 1.5, max(0.0, uRadius - d));
          float a = (edge * mix(0.32, 0.82, tufts) + seam * 0.24 + highlight * edge * 0.26) * overlapBoost * uAlpha;
          if (a < 0.006) discard;
          vec3 fieldCol = mix(uColA, uColB, tufts * 0.62 + highlight * 0.18);
          fieldCol = mix(fieldCol, uColC, highlight * 0.38 + seam * 0.08);
          gl_FragColor = vec4(fieldCol, a);
          return;
        }

        float tufts = smoothstep(0.20, 0.82, n);
        float wisps = smoothstep(0.10, 0.70, waveA * 0.6 + waveB * 0.4);
        float a = (edge * mix(0.58, 0.95, tufts) + seam * 0.38) * mix(0.82, 1.0, wisps) * uAlpha;
        if (a < 0.006) discard;
        vec3 col = mix(uColA, uColB, tufts * 0.34 + seam * 0.10);
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = pattern === "grass" ? "island-edge-grass-aura" : "island-edge-mist";
  mesh.userData.inspect = { category: "atmosphere", variant: mesh.name };
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.cx, aura.y ?? 0.38, center.cz);
  mesh.frustumCulled = false;
  mesh.renderOrder = aura.renderOrder ?? -16;
  return mesh;
}
```

- [ ] **Step 3: Verify syntax by importing the app module in a browser through the local server**

Run:

```bash
make start
```

Expected: server reports it is running on port 1999, or says it was already running.

Then open:

```text
http://localhost:1999/?seed=0xb415
```

Expected: the page loads without a module syntax error in the browser console.

---

### Task 3: Visual verification and tuning

**Files:**
- Modify if needed: `src/biomes.js`
- Modify if needed: `src/sky.js`

- [ ] **Step 1: Check twilight target seed**

Open:

```text
http://localhost:1999/?seed=0xb415
```

Expected visual result:

- the island-edge aura reads as wind-swept field streaks, not cloud mist.
- the ring overlaps slightly inward over the terrain edge.
- purple-blue dominates, with gold highlights visible but not neon.
- the effect remains soft and cute, not sharp or realistic.

- [ ] **Step 2: Check default mist fallback**

Use the app regenerate button or a known non-twilight round seed and inspect the edge aura.

Expected visual result:

- biomes without `edgeAura` still use the mist pattern.
- mist color and opacity are close to the previous default.
- no obvious hard ring appears in the sky.

- [ ] **Step 3: Check wind behavior**

In the app settings, turn wind off.

Expected visual result: the aura stops visibly drifting because it uses the shared `state.windUniforms.uTime` value, which the main loop freezes when wind is disabled.

- [ ] **Step 4: If twilight needs minor tuning, adjust only numeric config values**

Prefer tuning these values in `src/biomes.js` before changing shader logic:

```js
alpha: 0.82,
innerSoft: 2.7,
outerSoft: 22.0,
inwardOverlap: 1.9,
outwardFadeStart: 0.58,
y: 0.46,
noiseScale: 0.092,
streakScale: 18.0,
windStrength: 1.0,
```

Use these bounds:

- `alpha`: 0.65–0.95.
- `innerSoft`: 2.0–3.8.
- `outerSoft`: 18.0–26.0.
- `inwardOverlap`: 1.2–2.6.
- `outwardFadeStart`: 0.50–0.68.
- `y`: 0.40–0.55.
- `noiseScale`: 0.075–0.110.
- `streakScale`: 14.0–24.0.
- `windStrength`: 0.7–1.2.

- [ ] **Step 5: Capture final diff**

Run:

```bash
git diff -- src/biomes.js src/sky.js
```

Expected: only `twilight.edgeAura` and `makeIslandEdgeMist` changed.

- [ ] **Step 6: Commit implementation**

Run:

```bash
git add src/biomes.js src/sky.js
git commit -m "feat: add twilight grass edge aura"
```

Expected: a commit is created containing only the implementation files.
