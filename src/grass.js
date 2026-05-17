import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { state, DENSITY_BASE } from "./state.js";
import { pickGroundPoint } from "./terrain.js";
import { GRASS_DENSITY, GRASS_HEIGHT, BALD_THRESHOLD } from "./biomes.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";

// Max number of creatures that can perturb the grass at once. Each slot is a
// vec4 uniform; the vertex shader early-outs on `radius < 0.001`, so unused
// slots cost a single compare per blade vertex.
// Sized for the worst-case biome: ~18 walkers + ~5 caterpillars × up to 4
// segments ≈ 38, rounded up. The vertex shader early-outs on `radius < 0.001`
// for unused slots so the cost of empty slots is one compare per blade
// vertex — cheap. Sized too small and creatures past the cap will appear to
// "toggle" bending on and off as the array reshuffles (e.g. fliers taking
// off frees a slot for a previously-skipped walker).
const MAX_PUSHERS = 40;
const PUSH_RADIUS_SCALE = 0.9;

// Upper bound on the user's grass-density slider. Sets how much headroom
// makeGrassField pre-allocates so the slider can go past 100% without
// needing a regen. The slider labels 100% as the user's preferred lush
// look (internally a 2.0× multiplier on biome stock); slider max 300%
// corresponds to a 6.0× internal multiplier, so the cap here matches.
const MAX_DENSITY_MULTIPLIER = 6.0;

const _lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);
const _coverScale = (n, gain = 1) =>
  _lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));

// Build the blade geometry + grass shader material. Shared between the
// production world field (placed by pickGroundPoint across an island) and
// the inspect-mode disc fill (placed by rejection-sampling a unit disc).
// `opts.disableFade = true` pushes uFadeStart/End past any plausible
// inspect-distance so all blades stay full-height regardless of camera.
export function makeGrassMaterial(biome, opts = {}) {
  const { disableFade = false } = opts;

  // Build a single tapered blade plane, then merge two copies rotated 90°
  // apart into a single "crossed" geometry. Each instance draws both
  // planes, so the blade reads as a thick silhouette from any side angle
  // (a single plane disappears edge-on at orbit distance).
  function makeBladePlane() {
    const g = new THREE.PlaneGeometry(0.10, 0.34, 1, 3);
    const pos = g.attributes.position;
    const tipFactors = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + 0.17;
      pos.setY(i, y);
      // Quadratic taper: full width at base, pinches to a point at the tip.
      const t = Math.min(1, y / 0.34);
      const taper = 1.0 - t * t;
      pos.setX(i, pos.getX(i) * taper);
      tipFactors[i] = t;
    }
    g.setAttribute("aTipFactor", new THREE.BufferAttribute(tipFactors, 1));
    return g;
  }
  const planeA = makeBladePlane();
  const planeB = makeBladePlane();
  planeB.rotateY(Math.PI / 2);
  const blade = mergeGeometries([planeA, planeB], false);
  planeA.dispose();
  planeB.dispose();
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

  const wdAngle = Math.random() * Math.PI * 2;
  // Pre-allocate the creature-pusher slots once; stepGrass mutates them in
  // place each frame. xy = world XZ, z = radius, w = bend strength.
  const pushers = new Array(MAX_PUSHERS);
  for (let i = 0; i < MAX_PUSHERS; i++) pushers[i] = new THREE.Vector4(0, 0, 0, 0);
  const uniforms = {
    uTime: state.windUniforms.uTime,
    uTipColor: { value: tipCol },
    uWindScale: { value: 0.15 },
    uWindSpeed: { value: 0.6 },
    uWindDir: { value: new THREE.Vector2(Math.cos(wdAngle), Math.sin(wdAngle)) },
    uWindStrength: { value: LOWFX ? 0.8 : 1.2 },
    uCameraXZ: { value: new THREE.Vector2(0, 0) },
    uFadeEnabled: { value: disableFade ? 0.0 : 1.0 },
    uFadeStart: { value: LOWFX ? 30.0 : 45.0 },
    uFadeEnd:   { value: LOWFX ? 55.0 : 85.0 },
    uPusherCount: { value: 0 },
    uPushers: { value: pushers },
    uHeightMul: { value: 1.0 },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uTipColor = uniforms.uTipColor;
    shader.uniforms.uWindScale = uniforms.uWindScale;
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uCameraXZ = uniforms.uCameraXZ;
    shader.uniforms.uFadeEnabled = uniforms.uFadeEnabled;
    shader.uniforms.uFadeStart = uniforms.uFadeStart;
    shader.uniforms.uFadeEnd = uniforms.uFadeEnd;
    shader.uniforms.uPusherCount = uniforms.uPusherCount;
    shader.uniforms.uPushers = uniforms.uPushers;
    shader.uniforms.uHeightMul = uniforms.uHeightMul;

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
        uniform float uFadeEnabled;
        uniform float uFadeStart;
        uniform float uFadeEnd;
        uniform float uHeightMul;
        #define MAX_PUSHERS ${MAX_PUSHERS}
        uniform int  uPusherCount;
        uniform vec4 uPushers[MAX_PUSHERS];
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
            // World-space images of mesh-local X and Z axes (instanceMatrix
            // is the source of the per-blade random Y yaw + uniform XZ
            // scale). Used below to inverse-rotate world-space bend deltas
            // into mesh-local coords — otherwise each yawed blade applies
            // the bend along its own rotated local-X and the field reads as
            // random instead of coherent wind.
            vec2 axW = vec2(instanceMatrix[0].x, instanceMatrix[0].z);
            vec2 azW = vec2(instanceMatrix[2].x, instanceMatrix[2].z);
            float invXZScaleSq = 1.0 / max(dot(axW, axW), 1e-6);
          #else
            vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
            vec2 axW = vec2(1.0, 0.0);
            vec2 azW = vec2(0.0, 1.0);
            float invXZScaleSq = 1.0;
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
          vec2 windWorld = bendDir * amp * 0.18;
          transformed.x += dot(axW, windWorld) * invXZScaleSq;
          transformed.z += dot(azW, windWorld) * invXZScaleSq;
          // Creature push: bend blades radially outward from each pusher's
          // XZ. Roots stay anchored, while the under-body core lets mid-blade
          // vertices participate and compresses height so grass lays flatter
          // without being sunk below the ground.
          for (int pi = 0; pi < MAX_PUSHERS; pi++) {
            if (pi >= uPusherCount) break;
            vec4 push = uPushers[pi];
            float pr = push.z;
            if (pr < 0.001) continue;
            vec2 pd = worldXZ - push.xy;
            float pd2 = dot(pd, pd);
            float pr2 = pr * pr;
            if (pd2 > pr2) continue;
            float pdl = sqrt(pd2);
            vec2 pdir = pdl > 0.0001 ? pd / pdl : vec2(1.0, 0.0);
            float ft = 1.0 - pdl / pr;
            float pushFalloff = ft * ft;
            float pushCore = smoothstep(0.35, 0.85, ft);
            float pushBladeWeight = mix(aTipFactor * aTipFactor, aTipFactor * (0.45 + 0.55 * aTipFactor), pushCore);
            float pushAmp = pushBladeWeight * pushFalloff * push.w;
            vec2 pushWorld = pdir * pushAmp * mix(1.0, 1.15, pushCore);
            float pushFlatten = pushFalloff * pushCore * 0.65;
            transformed.x += dot(axW, pushWorld) * invXZScaleSq;
            transformed.z += dot(azW, pushWorld) * invXZScaleSq;
            transformed.y *= 1.0 - pushFlatten;
          }
          float dist = length(worldXZ - uCameraXZ);
          float fade = mix(1.0, 1.0 - smoothstep(uFadeStart, uFadeEnd, dist), uFadeEnabled);
          transformed.y *= fade * uHeightMul;
          transformed.x *= mix(1.0, fade, 0.5);
          transformed.z *= mix(1.0, fade, 0.5);
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

  return { blade, material: mat, uniforms, baseCol };
}

export function makeGrassField(biome, heightFn, excludedCircles = []) {
  // Per-biome 0 = no grass field at all (burnt/volcanic biomes). Caller
  // handles the null and skips the .add() rather than allocating an empty
  // InstancedMesh.
  const density = GRASS_DENSITY[biome.id] ?? 300;
  if (density <= 0) return null;
  // Overshoot factor produces a dense carpet visible at orbit distance.
  // Combined with the crossed-plane blade geometry, each instance now
  // contributes meaningful screen area regardless of viewing angle.
  // LOWFX trims the count to stay inside a smaller GPU budget.
  const overshoot = LOWFX ? 22.0 : 55.0;
  const nominalCount = _coverScale(density, overshoot);
  // Allocate headroom so the user's density slider can push above the
  // biome's stock count without needing a regen. The slider's visible
  // range is [0, MAX_DENSITY_MULTIPLIER]; live changes just shift
  // mesh.count between 0 and the allocated maximum.
  const maxCount = Math.ceil(nominalCount * MAX_DENSITY_MULTIPLIER);
  const count = maxCount;

  const { blade, material: mat, uniforms, baseCol } = makeGrassMaterial(biome);

  const mesh = new THREE.InstancedMesh(blade, mat, count);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;

  // Density and clump noise — two independent fields, both seeded by the
  // monkey-patched Math.random inside generateWorld so the patchwork is
  // deterministic from the seed.
  const densityNoise = createNoise2D();
  const clumpNoise = createNoise2D();
  const baldThreshold = BALD_THRESHOLD[biome.id] ?? 0.18;
  const biomeHeightMul = GRASS_HEIGHT[biome.id] ?? 1.0;

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
    const p = pickGroundPoint(1.0, { visualRadius: true });
    const x = p.x;
    const z = p.z;
    const y = heightFn(x, z);
    // -4.0 = "void zone past the island falloff", not "natural valley".
    // pickGroundPoint(... visualRadius) already keeps us inside the visible island;
    // the inner noise amplitude is ±3.2 so any negative under -4 is the
    // edge plunge. Don't reject mid-island dips.
    if (y < -4.0) continue;

    // Exclude fairy-ring circles — mushrooms should sit on bare earth.
    let excluded = false;
    for (const c of excludedCircles) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) { excluded = true; break; }
    }
    if (excluded) continue;

    // Density rejection — simplex returns [-1, 1], remap to [0, 1].
    // Noise frequency 0.55 gives bald patches ~1-2 units across (small,
    // texture-scale), not the 5-unit patches the old 0.18 scale produced —
    // valleys and other terrain features no longer line up with whole
    // bald zones.
    const d = densityNoise(x * 0.55, z * 0.55) * 0.5 + 0.5;
    if (d < baldThreshold) continue;

    // Clump-height modulation — taller blades in lush patches, stubbier in thin.
    const cN = clumpNoise(x * 0.35, z * 0.35) * 0.5 + 0.5;
    const baseScale = 0.7 + Math.random() * 0.7;
    const heightMul = 0.75 + 0.7 * cN;

    v.set(x, y, z);
    s.set(baseScale, baseScale * heightMul * biomeHeightMul, baseScale);
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
  // `placed` is the actual filled-slot count; `nominalCount` is the
  // biome's stock density (slider value 1.0). Live density changes set
  // mesh.count between 0 and `placed` so the slider scales how many of
  // the placed blades are drawn each frame without rebuilding the mesh.
  const maxPlaced = placed;
  const stockCount = Math.min(nominalCount, maxPlaced);
  const initialDensity = state.userSettings.grassDensity ?? 1.0;
  mesh.count = Math.min(maxPlaced, Math.max(0, Math.round(stockCount * initialDensity)));
  mesh.instanceMatrix.needsUpdate = true;

  // Per-instance attributes (wind seed, color) are sized to the allocated
  // slot count so any future `mesh.count` raise still has valid data.
  const windSeeds = new Float32Array(maxPlaced);
  for (let i = 0; i < maxPlaced; i++) windSeeds[i] = Math.random();
  blade.setAttribute("aWindSeed", new THREE.InstancedBufferAttribute(windSeeds, 1));

  const colors = new Float32Array(maxPlaced * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < maxPlaced; i++) {
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

  // Apply the user's initial height multiplier (the uniform default is
  // 1.0, but settings may have been persisted from a previous session).
  uniforms.uHeightMul.value = state.userSettings.grassHeight ?? 1.0;

  state.grass = { mesh, uniforms, stockCount, maxPlaced };
  mesh.userData.inspect = { category: "flora", variant: "grassfield" };
  return mesh;
}

export function stepGrass(camera, fadeCenter = camera?.position) {
  if (!state.grass || !camera || !fadeCenter) return;
  const u = state.grass.uniforms.uCameraXZ.value;
  u.x = fadeCenter.x;
  u.y = fadeCenter.z;

  // Creature → grass push. The grass shader compares against world-space XZ
  // (modelMatrix is applied before the test), but creature.group.position is
  // in state.world's local space, so scale both position and radius by
  // worldScale to match. Caterpillars/snails animate per-segment inside a
  // root group pinned at the origin; we push from each segment so the whole
  // worm's path bends grass, not just the head's logical anchor.
  const pushers = state.grass.uniforms.uPushers.value;
  const MAX = pushers.length;
  const ws = state.userSettings.worldScale ?? 1;
  let n = 0;

  for (const c of state.creatures) {
    if (n >= MAX) break;
    // Skip airborne fliers — their shadow disc shrinks with hover already,
    // and we don't want grass laying over below an in-flight insect.
    if (c.flies && c.landState !== "landed") continue;
    const p = c.group.position;
    // Body silhouette is ~0.5*c.scale. Radius is ~2.6× that — tighter
    // than before so the trampled patch matches the creature's footprint
    // rather than reading as a wide invisible bubble. Min radius keeps
    // tiny creatures from pushing a sub-unit halo at default zoom.
    const r = Math.max(1.0 * ws, 1.3 * c.scale * ws) * PUSH_RADIUS_SCALE;
    pushers[n].set(p.x * ws, p.z * ws, r, 0.5 * c.scale * ws);
    n++;
  }
  for (const c of state.caterpillars) {
    if (!c.segments) continue;
    // Skinnier than walkers — segment radius is ~0.22*c.scale. Push
    // radius keeps the bend right around each segment, so the whole worm
    // reads as a flattened narrow trail rather than a wide swath. Slot
    // budget is high enough (MAX_PUSHERS=40) that every segment of every
    // caterpillar fits without competing with walkers.
    const r = Math.max(0.45 * ws, 0.6 * c.scale * ws) * PUSH_RADIUS_SCALE;
    const str = 0.4 * c.scale * ws;
    for (let i = 0; i < c.segments.length; i++) {
      if (n >= MAX) break;
      const sp = c.segments[i].position;
      pushers[n].set(sp.x * ws, sp.z * ws, r, str);
      n++;
    }
    if (n >= MAX) break;
  }

  for (let i = n; i < MAX; i++) pushers[i].set(0, 0, 0, 0);
  state.grass.uniforms.uPusherCount.value = n;
}
