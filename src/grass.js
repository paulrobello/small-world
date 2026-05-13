import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { state, DENSITY_BASE } from "./state.js";
import { pickGroundPoint } from "./terrain.js";
import { GRASS_DENSITY, BALD_THRESHOLD } from "./biomes.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";

const _lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);
const _coverScale = (n, gain = 1) =>
  _lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));

export function makeGrassField(biome, heightFn) {
  // Overshoot factor covers ~35-50% density-mask rejection AND keeps a
  // visible carpet across the entire orbit-visible area despite the
  // camera-distance fade. LOWFX is half so the GPU budget stays sane.
  const overshoot = LOWFX ? 3.5 : 7.0;
  const count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, overshoot);

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
    // Distance is measured from camera XZ. Default orbit puts the camera
    // at XZ radius ~28 from origin and the far island edge ~51 from the
    // camera projection. Band sits past the far edge so the whole orbit
    // view shows tall blades, with a soft taper into the void; LOD savings
    // come from collapsing blades past the island, not on it.
    uFadeStart: { value: LOWFX ? 30.0 : 45.0 },
    uFadeEnd: { value: LOWFX ? 55.0 : 85.0 },
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
          float dist = length(worldXZ - uCameraXZ);
          float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
          transformed.y *= fade;
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

  const mesh = new THREE.InstancedMesh(blade, mat, count);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;

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
    const baseScale = 0.7 + Math.random() * 0.7;
    const heightMul = 0.75 + 0.7 * cN;

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

  const windSeeds = new Float32Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) windSeeds[i] = Math.random();
  blade.setAttribute("aWindSeed", new THREE.InstancedBufferAttribute(windSeeds, 1));

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

  state.grass = { mesh, uniforms };
  return mesh;
}

export function stepGrass(camera) {
  if (!state.grass || !camera) return;
  const u = state.grass.uniforms.uCameraXZ.value;
  u.x = camera.position.x;
  u.y = camera.position.z;
}
