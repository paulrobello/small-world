import * as THREE from "three";
import { state } from "./state.js";
import { jitterGeo, applyWindSway, TRUNK, buildLeafGeo } from "./util.js";
import { BLOOM_LAYER } from "./postfx.js";
import { makePool } from "./pool.js";
import {
  makeDeadTreePBRMaterial,
  makeFlyerNestPBRMaterial,
  makeLeafballTreeLeafPBRMaterial,
  makeLeafballTreeTrunkPBRMaterial,
  makeMushroomCapPBRMaterial,
  makeMushroomUndersideMaterial,
  makePlainRockPBRMaterial,
  makeStonePBRMaterial,
} from "./pbr.js";

// Cactus needles. Each spine is a real little cone mesh sitting on the
// capsule's surface, oriented along the outward normal — the shell-fur
// approach we use for fuzzy creatures renders frosted square columns at
// sparse densities, which reads as ice crystals rather than thin spikes.
// One InstancedMesh per cactus part keeps the draw count down (a single
// 3-arm cactus is at most 3 draws regardless of needle count).
const NEEDLE_TIP_COLOR = new THREE.Color("#f5ead0");
const NEEDLE_LENGTH = 0.085;
const NEEDLE_DENSITY = 95; // needles per local-unit² of capsule surface area
function addCapsuleNeedles(parent, radius, length) {
  // One needle geo + material are pooled per regen — disposeGroup runs on
  // state.world before resetFloraPool(), so the disposed cone gets re-built
  // by the pool factory on the next world. (A module-scoped singleton would
  // hand back a stale, already-disposed geometry handle.)
  const needleGeo = pooled("cactus.needle.geo", () => {
    const g = new THREE.ConeGeometry(0.0112, NEEDLE_LENGTH, 4);
    g.translate(0, NEEDLE_LENGTH / 2, 0);
    return g;
  });
  const needleMat = pooled("cactus.needle.mat", () =>
    new THREE.MeshStandardMaterial({
      color: NEEDLE_TIP_COLOR,
      flatShading: true,
      roughness: 0.55,
    })
  );
  // CapsuleGeometry(radius, length, ...) defines `length` as the cylinder run
  // between the two hemispherical caps, with the local Y-axis as the spine.
  // We sample uniformly by surface area across cylinder + caps.
  const cylArea = 2 * Math.PI * radius * length;
  const capArea = 4 * Math.PI * radius * radius;
  const totalArea = cylArea + capArea;
  const count = Math.max(8, Math.round(totalArea * NEEDLE_DENSITY));
  const inst = new THREE.InstancedMesh(needleGeo, needleMat, count);
  inst.castShadow = false; // shadow per-needle would shimmer and is invisible at this scale
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const norm = new THREE.Vector3();
  const halfL = length / 2;
  for (let i = 0; i < count; i++) {
    if (Math.random() * totalArea < cylArea) {
      const a = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * length;
      norm.set(Math.cos(a), 0, Math.sin(a));
      pos.set(norm.x * radius, y, norm.z * radius);
    } else {
      // sample a unit hemisphere normal (theta ∈ [0, π/2]) using
      // u = cos(theta) uniformly distributed → uniform area on the sphere
      const upper = Math.random() < 0.5;
      const u = Math.random();
      const phi = Math.random() * Math.PI * 2;
      const sinT = Math.sqrt(Math.max(0, 1 - u * u));
      norm.set(
        sinT * Math.cos(phi),
        upper ? u : -u,
        sinT * Math.sin(phi),
      );
      pos.set(norm.x * radius, (upper ? halfL : -halfL) + norm.y * radius, norm.z * radius);
    }
    q.setFromUnitVectors(up, norm);
    // Slight per-needle length jitter — uniform spikes would read mechanical.
    const sy = 0.65 + Math.random() * 0.7;
    scl.set(1, sy, 1);
    m.compose(pos, q, scl);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  // Parent into the capsule mesh so needles inherit its world transform —
  // body needles ride the body's y=0.6 offset, arm needles ride the arm's
  // rotation.z without any extra bookkeeping.
  parent.add(inst);
  return inst;
}

// Per-world resource pool. Each generateWorld() call resets it via
// resetFloraPool(), so two trees in the same biome share one trunk
// CylinderGeometry / MeshStandardMaterial, but rebuilding (which disposes
// the previous world) starts fresh resources. Only colors that are
// fully derived from the biome (no per-instance Math.random) are pooled —
// `rock`, `pillar`, and `archstone` keep their per-instance jitter.
const _floraPool = makePool();
export const resetFloraPool = _floraPool.reset;
const pooled = _floraPool.get;

function applyLeafPlateWind(material, strength = 0.16) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uFoliageWind = state.windUniforms.uFoliageWind;
    shader.uniforms.uLeafPlateWind = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uFoliageWind;\nuniform float uLeafPlateWind;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 leafOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 leafOrigin = vec3(modelMatrix[3].x, modelMatrix[3].y, modelMatrix[3].z);
          #endif
          float phase = leafOrigin.x * 2.1 + leafOrigin.z * 1.6 + leafOrigin.y * 0.7;
          float tipFlex = smoothstep(-0.04, -0.42, position.y);
          float gust = sin(uTime * 1.15 + phase) * 0.65 + sin(uTime * 2.05 + phase * 1.37) * 0.35;
          float flutter = sin(uTime * 3.2 + phase * 1.9 + position.x * 8.0) * 0.45;
          float wind = uLeafPlateWind * uFoliageWind * tipFlex;
          transformed.x += (gust * 0.090 + flutter * 0.026) * wind;
          transformed.y += flutter * 0.018 * wind;
          transformed.z += (gust * 0.125 + flutter * 0.038) * wind;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}

function applyLeafPlateGradient(
  material,
  { tipLift = 0.10, baseShade = 0.10, veinShade = 0.08, sideShade = 0.10, ribShade = 0.11 } = {}
) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uLeafTipLift = { value: tipLift };
    shader.uniforms.uLeafBaseShade = { value: baseShade };
    shader.uniforms.uLeafVeinShade = { value: veinShade };
    shader.uniforms.uLeafSideShade = { value: sideShade };
    shader.uniforms.uLeafRibShade = { value: ribShade };
    shader.uniforms.uLeafRibHighlight = { value: ribShade * 0.80 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vLeafPlateGradient;
        varying float vLeafPlateVein;
        varying float vLeafPlateSide;
        varying vec2 vLeafPlateUv;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLeafPlateGradient = smoothstep(-0.42, 0.0, position.y);
        vLeafPlateVein = 1.0 - smoothstep(0.0, 0.035, abs(position.x));
        vLeafPlateSide = smoothstep(-0.16, 0.16, position.x);
        vLeafPlateUv = vec2(clamp(position.x / 0.34 + 0.5, 0.0, 1.0), clamp(-position.y / 0.42, 0.0, 1.0));`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uLeafTipLift;
        uniform float uLeafBaseShade;
        uniform float uLeafVeinShade;
        uniform float uLeafSideShade;
        uniform float uLeafRibShade;
        uniform float uLeafRibHighlight;
        varying float vLeafPlateGradient;
        varying float vLeafPlateVein;
        varying float vLeafPlateSide;
        varying vec2 vLeafPlateUv;
        float leafRibMask(vec2 leafUv) {
          float side = abs(leafUv.x - 0.5) * 2.0;
          float body = smoothstep(0.04, 0.16, leafUv.y) * (1.0 - smoothstep(0.88, 1.0, leafUv.y));
          float ribs = 1.0 - smoothstep(0.0, 0.14, abs(fract(leafUv.y * 7.0 + side * 1.10) - 0.5));
          return ribs * smoothstep(0.10, 0.30, side) * (1.0 - smoothstep(0.82, 1.0, side)) * body;
        }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float leafRibs = leafRibMask(vLeafPlateUv);
        diffuseColor.rgb *= 1.0 - uLeafBaseShade * (1.0 - vLeafPlateGradient);
        diffuseColor.rgb += diffuseColor.rgb * uLeafTipLift * vLeafPlateGradient;
        diffuseColor.rgb *= 1.0 - uLeafSideShade * (1.0 - vLeafPlateSide);
        diffuseColor.rgb += diffuseColor.rgb * uLeafSideShade * 0.45 * vLeafPlateSide;
        diffuseColor.rgb *= 1.0 - uLeafVeinShade * 1.45 * vLeafPlateVein;
        diffuseColor.rgb *= 1.0 - uLeafRibShade * leafRibs;
        diffuseColor.rgb += diffuseColor.rgb * uLeafRibHighlight * (leafRibs + vLeafPlateVein * 0.35) * vLeafPlateSide;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - uLeafRibHighlight * leafRibMask(vLeafPlateUv) * 0.26, 0.16, 1.0);`
      );
  };
  material.needsUpdate = true;
  return material;
}

function applySporeDrift(material, strength = 0.035) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uSporeDrift = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uSporeDrift;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float phase = wp.x * 0.72 + wp.z * 0.57;
          transformed.x += sin(uTime * 1.1 + phase) * uSporeDrift;
          transformed.y += sin(uTime * 1.6 + phase * 1.3) * uSporeDrift * 0.85;
          transformed.z += cos(uTime * 1.0 + phase * 0.8) * uSporeDrift;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}

function applyBalloonPuffWisps(material, strength = 0.34) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uBalloonWispTime = state.windUniforms.uTime;
    shader.uniforms.uBalloonWispStrength = { value: strength };
    shader.uniforms.uBalloonWispContrast = { value: 0.62 };
    shader.uniforms.uBalloonWispShadow = { value: 0.44 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBalloonLocalPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBalloonLocalPos = position;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uBalloonWispTime;
        uniform float uBalloonWispStrength;
        uniform float uBalloonWispContrast;
        uniform float uBalloonWispShadow;
        varying vec3 vBalloonLocalPos;
        float balloonWispSoftNoise(vec3 p) {
          return sin(p.x * 2.1 + p.y * 1.4 - p.z * 1.7) * 0.5 + 0.5;
        }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float angle = atan(vBalloonLocalPos.z, vBalloonLocalPos.x);
          float radius = length(vBalloonLocalPos.xz);
          float shell = smoothstep(0.015, 0.22, radius) * (1.0 - smoothstep(0.58, 0.76, radius));
          float drift = uBalloonWispTime * 0.46;
          float softWarp = (balloonWispSoftNoise(vBalloonLocalPos * 4.2 + vec3(drift, -drift * 0.35, drift * 0.5)) - 0.5) * 0.34;
          float spiralPhase = atan(vBalloonLocalPos.z, vBalloonLocalPos.x) * 2.8
            + vBalloonLocalPos.y * 9.5
            - radius * 3.8
            + drift
            + softWarp;
          float spiralRibbon = 1.0 - smoothstep(0.16, 0.54, abs(sin(spiralPhase)));
          float secondaryPhase = spiralPhase + 2.35 + radius * 2.2;
          float secondaryRibbon = 1.0 - smoothstep(0.12, 0.48, abs(sin(secondaryPhase)));
          float brightWisps = (spiralRibbon * 0.86 + secondaryRibbon * 0.38) * shell * uBalloonWispStrength;
          float shadowWisps = (1.0 - smoothstep(0.20, 0.64, abs(sin(spiralPhase + 1.30))))
            * shell * uBalloonWispStrength;
          vec3 wispColor = vec3(1.0, 0.985, 0.94);
          vec3 shadowColor = vec3(0.55, 0.55, 0.62);
          diffuseColor.rgb = mix(diffuseColor.rgb, shadowColor, shadowWisps * uBalloonWispShadow);
          diffuseColor.rgb = mix(diffuseColor.rgb, wispColor, brightWisps * uBalloonWispContrast);
        }`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - uBalloonWispStrength * 0.08, 0.18, 1.0);`
      );
  };
  material.needsUpdate = true;
  return material;
}

function applyDandylionHeadWind(material, strength, headY) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uWindStrength = { value: strength };
    shader.uniforms.uFoliageWind = state.windUniforms.uFoliageWind;
    shader.uniforms.uDandylionHeadY = { value: headY };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uWindStrength;\nuniform float uFoliageWind;\nuniform float uDandylionHeadY;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float windY = uDandylionHeadY;
          float windAmp = windY * windY * uWindStrength * uFoliageWind;
          vec4 wp = modelMatrix * vec4(vec3(0.0, uDandylionHeadY, 0.0), 1.0);
          float w1 = sin(uTime * 1.4 + wp.x * 0.30 + wp.z * 0.40);
          float w2 = sin(uTime * 0.9 + wp.x * 0.15 - wp.z * 0.25);
          vec2 windWorld = vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05);
          transformed.xz += windWorld;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}

function makeInstancedLeafBatch(geometry, material, matrices, castShadow = true) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.computeBoundingSphere();
  return mesh;
}

function shouldCastMicroFloraShadow(biome) {
  return biome.shadowLod?.microFloraShadows !== false;
}

function shouldUseLeafballCanopyShadowProxy(biome) {
  return biome.shadowLod?.leafballCanopyProxy === true;
}

function makeLeafballCanopyShadowProxy(canopyCenter, canopyRadius) {
  const geo = pooled("leafballtree.canopy.shadowProxy.geo", () => new THREE.SphereGeometry(1, 16, 10));
  const mat = pooled(
    "leafballtree.canopy.shadowProxy.mat",
    () =>
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
      })
  );
  const proxy = new THREE.Mesh(geo, mat);
  proxy.position.copy(canopyCenter);
  proxy.scale.copy(canopyRadius);
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  proxy.userData.inspect = { category: "flora", variant: "leafballtree" };
  return proxy;
}

function getLeafballTreePalette(biome) {
  const override = biome.leafballTreePalette || {};
  const fallbackLeaves = [
    new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#1d4f29"), 0.30),
    new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#69b85b"), 0.34),
    new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#64ad58"), 0.18),
  ];
  const leaves = fallbackLeaves.map((color, index) => override.leaves?.[index] || color);
  const trunk = override.trunk || new THREE.Color(TRUNK).lerp(new THREE.Color("#c38b45"), 0.52);

  return {
    trunk,
    outline: getLeafballOutlineColor(leaves, trunk),
    leaves,
  };
}

function getLeafballOutlineColor(leaves, trunk) {
  return new THREE.Color(leaves[0])
    .lerp(new THREE.Color(trunk), 0.34)
    .offsetHSL(0.0, -0.05, -0.18);
}

function getDandylionFloraPalette(biome) {
  const ground0 = new THREE.Color(biome.ground[0]);
  const ground1 = new THREE.Color(biome.ground[1] ?? biome.ground[0]);
  const ground2 = new THREE.Color(biome.ground[2] ?? biome.ground[1] ?? biome.ground[0]);
  const cliff = new THREE.Color(biome.cliff);
  return {
    stem: ground0.clone().lerp(cliff, 0.32).offsetHSL(0, -0.04, -0.02),
    leaf: ground1.clone().lerp(ground2, 0.38).offsetHSL(0, 0.04, 0.00),
  };
}

function makeMushroomStemGeometry(
  height,
  { baseRadius, topRadius, bulbRadius = baseRadius * 0.35, curve = height * 0.028, radialSegments = 7, heightSegments = 9 } = {}
) {
  const positions = [];
  const indices = [];
  for (let iy = 0; iy <= heightSegments; iy++) {
    const t = iy / heightSegments;
    const y = t * height;
    const sCurve = Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI);
    const bulbBase = Math.pow(1 - t, 3.2) * bulbRadius;
    const neckTuck = Math.sin(t * Math.PI) * baseRadius * 0.10;
    const radius = baseRadius + (topRadius - baseRadius) * t + bulbBase - neckTuck;
    const cx = sCurve * curve;
    const cz = Math.sin(t * Math.PI * 2 + Math.PI * 0.5) * Math.sin(t * Math.PI) * curve * 0.22;
    for (let ix = 0; ix < radialSegments; ix++) {
      const a = (ix / radialSegments) * Math.PI * 2;
      const verticalRidge = Math.sin(a * 5 + t * Math.PI * 1.5) * baseRadius * 0.035;
      const surfaceRipple = Math.sin(t * Math.PI * 8 + a * 2) * baseRadius * 0.018;
      const r = radius + verticalRidge + surfaceRipple;
      positions.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    }
  }

  for (let iy = 0; iy < heightSegments; iy++) {
    const row = iy * radialSegments;
    const next = (iy + 1) * radialSegments;
    for (let ix = 0; ix < radialSegments; ix++) {
      const a = row + ix;
      const b = row + ((ix + 1) % radialSegments);
      const c = next + ix;
      const d = next + ((ix + 1) % radialSegments);
      indices.push(a, c, b, b, c, d);
    }
  }

  const bottomCenter = positions.length / 3;
  positions.push(0, 0, 0);
  const topCenter = positions.length / 3;
  positions.push(0, height, 0);
  const topRow = heightSegments * radialSegments;
  for (let ix = 0; ix < radialSegments; ix++) {
    indices.push(bottomCenter, (ix + 1) % radialSegments, ix);
    indices.push(topCenter, topRow + ix, topRow + ((ix + 1) % radialSegments));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeMushroomUndersideGeometry(
  radiusX,
  radiusZ,
  y,
  segments,
  { rimOverlap = 1.004, yOffset = -0.001, innerRimInset = 0.965, bevelDrop = 0.008 } = {}
) {
  const rimY = y + yOffset;
  const undersideY = rimY - bevelDrop;
  const rimRadiusX = radiusX * rimOverlap;
  const rimRadiusZ = radiusZ * rimOverlap;
  const innerRadiusX = radiusX * innerRimInset;
  const innerRadiusZ = radiusZ * innerRimInset;
  const positions = [0, undersideY, 0];
  const normals = [0, -1, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * innerRadiusX;
    const z = Math.sin(a) * innerRadiusZ;
    positions.push(x, undersideY, z);
    normals.push(0, -1, 0);
    uvs.push(0.5 + x / (rimRadiusX * 2), 0.5 + z / (rimRadiusZ * 2));
  }
  const outerStart = positions.length / 3;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * rimRadiusX;
    const z = Math.sin(a) * rimRadiusZ;
    positions.push(x, rimY, z);
    normals.push(0, -1, 0);
    uvs.push(0.5 + x / (rimRadiusX * 2), 0.5 + z / (rimRadiusZ * 2));
  }
  for (let i = 0; i < segments; i++) {
    indices.push(0, i + 1, ((i + 1) % segments) + 1);
    indices.push(i + 1, outerStart + i, ((i + 1) % segments) + 1);
    indices.push(((i + 1) % segments) + 1, outerStart + i, outerStart + ((i + 1) % segments));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.userData.normalsFaceDown = true;
  return geo;
}

function enableMushroomCapShadowUnderside(material) {
  material.shadowSide = THREE.DoubleSide;
  return material;
}

function addGroveMushroomFamily(group, biome, { radius = 0.44, count = 3, capY = 0.35 } = {}) {
  if (!biome.groveDetails?.mushroomFamilies) return;
  const stemGeo = pooled("grove.babyMushroom.stem.geo", () =>
    new THREE.CylinderGeometry(0.025, 0.04, 0.18, 5).translate(0, 0.09, 0)
  );
  const capGeo = pooled("grove.babyMushroom.cap.geo", () =>
    new THREE.SphereGeometry(0.085, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1.25, 0.72, 1.25)
      .translate(0, 0.18, 0)
  );
  const stemMat = pooled("grove.babyMushroom.stem.mat.smooth", () =>
    new THREE.MeshStandardMaterial({ color: "#f4e6c9", roughness: 0.95 })
  );
  const undersideGeo = pooled("grove.babyMushroom.underside.geo", () =>
    makeMushroomUndersideGeometry(0.085 * 1.25, 0.085 * 1.25, 0.18, 10)
  );
  const undersideMat = pooled("grove.babyMushroom.underside.mat.lit", () => makeMushroomUndersideMaterial());
  const baseCapColor = new THREE.Color(biome.accent).lerp(new THREE.Color("#b85f2a"), 0.18);
  const babies = count + Math.floor(Math.random() * 3);
  for (let i = 0; i < babies; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.35 + Math.random() * 0.65);
    const scale = 0.72 + Math.random() * 0.62;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(x, 0, z);
    stem.scale.setScalar(scale);
    stem.userData.surfaceLift = 0;
    stem.castShadow = true;
    group.add(stem);
    const babyCapColor = baseCapColor.clone().offsetHSL(
      (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.10
    );
    const cap = new THREE.Mesh(capGeo, enableMushroomCapShadowUnderside(makeMushroomCapPBRMaterial({
      color: babyCapColor,
      roughness: 0.68,
    })));
    cap.position.set(x, 0, z);
    cap.scale.setScalar(scale);
    cap.rotation.y = Math.random() * Math.PI * 2;
    cap.userData.surfaceLift = 0;
    cap.castShadow = true;
    group.add(cap);
    const underside = new THREE.Mesh(undersideGeo, undersideMat);
    underside.position.set(x, 0, z);
    underside.scale.setScalar(scale);
    underside.rotation.y = cap.rotation.y;
    underside.userData.surfaceLift = 0;
    group.add(underside);
  }

  if (!biome.groveDetails?.sporeGlow) return;
  const sporeGeo = pooled("grove.spore.geo", () => new THREE.SphereGeometry(0.0195, 6, 5));
  const sporeMat = pooled("grove.spore.mat", () => {
    const color = new THREE.Color("#ffc36b");
    return applySporeDrift(new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(1.35),
      emissiveIntensity: 1.05,
      flatShading: true,
      roughness: 0.45,
    }));
  });
  const spores = 1 + Math.floor(Math.random() * 2); // 1–2 (was 3–6)
  for (let i = 0; i < spores; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.18 + Math.random() * 0.62);
    const spore = new THREE.Mesh(sporeGeo, sporeMat);
    spore.position.set(Math.cos(a) * r, capY * (0.55 + Math.random() * 0.75), Math.sin(a) * r);
    spore.layers.enable(BLOOM_LAYER);
    group.add(spore);
  }
}

function addPillarSurfaceMarks(drum, topRadius, bottomRadius, height, baseColor) {
  const points = [];
  const markCount = 9 + Math.floor(Math.random() * 5);
  const scratchColor = baseColor.clone().offsetHSL(0, -0.05, -0.18);
  const sideCount = 7;
  const facePad = 0.08;

  const pointOnFace = (face, sideT, y) => {
    const yT = y / height + 0.5;
    const radius = bottomRadius + (topRadius - bottomRadius) * yT;
    const a0 = (face / sideCount) * Math.PI * 2;
    const a1 = ((face + 1) / sideCount) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * radius, y, Math.sin(a0) * radius);
    const p1 = new THREE.Vector3(Math.cos(a1) * radius, y, Math.sin(a1) * radius);
    const mid = (a0 + a1) * 0.5;
    const normal = new THREE.Vector3(Math.cos(mid), 0, Math.sin(mid));
    return p0.lerp(p1, sideT).addScaledVector(normal, 0.0015);
  };

  for (let i = 0; i < markCount; i++) {
    const vertical = Math.random() < 0.58;
    const face = Math.floor(Math.random() * sideCount);
    let sideT = facePad + Math.random() * (1 - facePad * 2);
    let y = (Math.random() - 0.5) * height * 0.72;
    const steps = vertical ? 3 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 3);
    const yStep = height * (vertical ? 0.12 : 0.07);
    const sideStep = (Math.random() - 0.5) * (vertical ? 0.08 : 0.26);
    let prev = null;

    for (let j = 0; j <= steps; j++) {
      sideT = Math.max(facePad, Math.min(1 - facePad, sideT + sideStep + (Math.random() - 0.5) * 0.05));
      y += (vertical ? -1 : Math.random() < 0.5 ? -1 : 1) * yStep * (0.55 + Math.random() * 0.55);
      y = Math.max(-height * 0.43, Math.min(height * 0.43, y));
      const next = pointOnFace(face, sideT, y);
      if (prev) points.push(prev.x, prev.y, prev.z, next.x, next.y, next.z);
      prev = next;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({
    color: scratchColor,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const marks = new THREE.LineSegments(geometry, material);
  marks.renderOrder = 1;
  drum.add(marks);
}

function makePlainRockGeometry(radius, { shoulder = false } = {}) {
  const detail = shoulder ? 0 : 1;
  const geometry = jitterGeo(
    new THREE.IcosahedronGeometry(radius, detail),
    radius * (shoulder ? 0.14 : 0.18),
    { sphericalUvs: true }
  );
  const position = geometry.attributes.position;
  const squash = shoulder ? 0.62 : 0.74;
  const xScale = 1.12 + Math.random() * 0.28;
  const zScale = 0.86 + Math.random() * 0.24;
  const chipAngle = Math.random() * Math.PI * 2;
  const chipX = Math.cos(chipAngle);
  const chipZ = Math.sin(chipAngle);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const side = (x * chipX + z * chipZ) / radius;
    const top = Math.max(0, y / radius);
    const bottom = Math.max(0, -y / radius);
    const chip = Math.max(0, side - 0.38) * (shoulder ? 0.18 : 0.34);
    const ledge = Math.max(0, Math.sin((x - z) * 7.5)) * 0.035 * radius;

    position.setXYZ(
      i,
      (x * xScale - chipX * chip * radius) * (1 + top * 0.07 - bottom * 0.10),
      Math.max(y * squash - bottom * 0.11 * radius + ledge, -radius * 0.30),
      (z * zScale - chipZ * chip * radius) * (1 + top * 0.04 - bottom * 0.08)
    );
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export const FLORA_BUILDERS = {
  tree(biome) {
    const g = new THREE.Group();
    const trunkGeo = pooled("tree.trunk.geo", () =>
      new THREE.CylinderGeometry(0.13, 0.18, 1.1, 6).translate(0, 0.55, 0)
    );
    const trunkMat = pooled("tree.trunk.mat", () =>
      new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true, roughness: 1 })
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    g.add(trunk);
    // Canopy geometry is pre-positioned so transformed.y measures height above
    // the ground rather than the canopy's center. With windAmp = y²·strength,
    // the bottom of the canopy stays put and only the top tilts — the whole
    // crown reads as bending in the wind rather than just smearing upward.
    const leafGeo = pooled("tree.leaves.geo", () => {
      const geo = jitterGeo(new THREE.IcosahedronGeometry(0.75, 0), 0.12);
      geo.scale(1, 1.15, 1);
      geo.translate(0, 1.45, 0);
      return geo;
    });
    const leafMat = pooled("tree.leaves.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[0]).offsetHSL(0, 0.05, 0.08),
          flatShading: true,
          roughness: 0.85,
        }),
        0.18
      )
    );
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.castShadow = true;
    g.add(leaves);
    return g;
  },

  leafballtree(biome) {
    const g = new THREE.Group();
    const palette = getLeafballTreePalette(biome);
    const trunkMat = pooled("leafballtree.trunk.mat", () =>
      makeLeafballTreeTrunkPBRMaterial({
        color: palette.trunk,
        flatShading: false,
        roughness: 0.95,
        vertexColors: true,
      })
    );
    const trunkGeo = pooled("leafballtree.trunk.geo", () => {
      const geo = new THREE.CylinderGeometry(0.12, 0.24, 1.45, 12, 12).translate(0, 0.725, 0);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const ringCount = 7;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = y / 1.45;
        const bend = Math.sin(t * Math.PI) * 0.07;
        const taperTwist = Math.sin(t * Math.PI * 2.2) * 0.026;
        pos.setX(i, pos.getX(i) + bend);
        pos.setZ(i, pos.getZ(i) + taperTwist);
        // Bark-ring shading: horizontal bands with soft edges.
        const ring = 0.5 + 0.5 * Math.sin(t * ringCount * Math.PI * 2);
        const band = 0.82 + ring * 0.18;
        // Slight per-vertex noise to break up uniformity.
        const noise = 0.96 + Math.sin(pos.getX(i) * 13.7 + pos.getZ(i) * 9.3) * 0.04;
        colors[i * 3] = band * noise;
        colors[i * 3 + 1] = band * noise;
        colors[i * 3 + 2] = band * noise;
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      return geo;
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    const leafballtreeTrunkHeightMul = 1 + Math.random() * 0.25;
    const canopyYOffset = 1.45 * (leafballtreeTrunkHeightMul - 1);
    trunk.scale.y = leafballtreeTrunkHeightMul;
    trunk.castShadow = true;
    g.add(trunk);

    const leafMats = [
      pooled("leafballtree.leaf.mat.shadow", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            makeLeafballTreeLeafPBRMaterial({
              color: palette.leaves[0],
              side: THREE.DoubleSide,
              flatShading: false,
              roughness: 0.82,
            }),
            { tipLift: 0.08, baseShade: 0.12, veinShade: 0.18, sideShade: 0.11, ribShade: 0.26 }
          ),
          0.10
        )
      ),
      pooled("leafballtree.leaf.mat.mid", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            makeLeafballTreeLeafPBRMaterial({
              color: palette.leaves[1],
              side: THREE.DoubleSide,
              flatShading: false,
              roughness: 0.78,
            }),
            { tipLift: 0.10, baseShade: 0.10, veinShade: 0.20, sideShade: 0.12, ribShade: 0.28 }
          ),
          0.13
        )
      ),
      pooled("leafballtree.leaf.mat.light", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            makeLeafballTreeLeafPBRMaterial({
              color: palette.leaves[2],
              side: THREE.DoubleSide,
              flatShading: false,
              roughness: 0.82,
            }),
            { tipLift: 0.045, baseShade: 0.08, veinShade: 0.16, sideShade: 0.10, ribShade: 0.24 }
          ),
          0.12
        )
      ),
    ];
    // Curved, anchored leaf. Local y=0 is the upper attachment point and
    // local -Y is the tip. Local +Z bows outward, so upper-row tips sit in
    // front of lower-row bases like overlapping shingles.
    const leafGeo = pooled("leafballtree.leaf.geo", () =>
      buildLeafGeo({
        lengthSegs: 14,
        widthSegs: 8,
        length: 0.42,
        maxWidth: 0.165,
        minWidth: 0.006,
        profileExp: 0.72,
        taperEnd: 0.16,
        centerLift: 0.012,
        centerLiftFade: 0.35,
        tipCurlStrength: 0.060,
        tipCurlExp: 1.45,
        edgeCurlStrength: 0.010,
        centerRibLift: 0.030,
        secondaryRibLift: 0.018,
        secondaryRibFrequency: 8.5,
      })
    );
    const leafOutlineGeo = pooled("leafballtree.leaf.outline.geo", () => {
      const geo = leafGeo.clone();
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        pos.setX(i, pos.getX(i) * 1.075);
        pos.setY(i, y < 0 ? y * 1.04 : y);
        pos.setZ(i, pos.getZ(i) - 0.006);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const leafOutlineMat = pooled("leafballtree.leaf.outline.mat", () =>
      applyLeafPlateWind(
        new THREE.MeshBasicMaterial({
          name: "leafballtree.leaf.outline.mat",
          color: palette.outline,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
        0.12
      )
    );

    const canopyCenter = new THREE.Vector3(0, 1.46 + canopyYOffset, 0);
    const canopyRadius = new THREE.Vector3(0.88, 0.68, 0.88);
    const useCanopyShadowProxy = shouldUseLeafballCanopyShadowProxy(biome);
    const up = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4();
    const leafBuckets = leafMats.map(() => []);
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    const orientLeaf = (leaf, normal, shingleLift = 0.10) => {
      const tangentDown = up.clone().sub(normal.clone().multiplyScalar(up.dot(normal)));
      if (tangentDown.lengthSq() < 0.0001) tangentDown.set(0, 0, 1);
      tangentDown.normalize().multiplyScalar(-1);
      // Point each teardrop down the dome, then tip its face slightly outward.
      // That shingle lift gives rows visible overlap without leaf planes
      // slicing through each other like a flat shell.
      const faceNormal = normal.clone().addScaledVector(tangentDown, shingleLift).normalize();
      // ShapeGeometry leaf tip is local -Y; map local -Y to tangentDown so
      // upper leaves point down over lower leaves, not underneath them.
      const yAxis = tangentDown.clone().multiplyScalar(-1);
      const xAxis = yAxis.clone().cross(faceNormal).normalize();
      basis.makeBasis(xAxis, yAxis, faceNormal);
      leaf.quaternion.setFromRotationMatrix(basis);
    };

    const rowCounts = [9, 14, 18, 22, 26, 26, 24, 20, 17, 13, 10];
    const addLeafRing = ({ count, phi, shell = 1, scale = 0.8, matIndex = 1, phase = 0, lift = 0.12, yOffset = 0, pitchOffset = 0 }) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + phase + (Math.random() - 0.5) * 0.04;
        const normal = new THREE.Vector3(
          Math.sin(phi) * Math.cos(a),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(a)
        ).normalize();
        const leaf = new THREE.Object3D();
        leaf.position.set(
          canopyCenter.x + normal.x * canopyRadius.x * shell,
          canopyCenter.y + normal.y * canopyRadius.y * shell + yOffset,
          canopyCenter.z + normal.z * canopyRadius.z * shell
        );
        orientLeaf(leaf, normal, lift);
        leaf.rotateX(0.02 + lift * 0.18 + pitchOffset);
        leaf.rotateZ((Math.random() - 0.5) * 0.08);
        const s = scale * (0.92 + Math.random() * 0.16);
        scaleVec.set(s * 0.94, s * 1.18, s);
        matrix.compose(leaf.position, leaf.quaternion, scaleVec);
        leafBuckets[matIndex].push(matrix.clone());
      }
    };

    const topHighlightRows = 3;
    const topMotionTuckRows = 4;
    const topMotionTuckAngle = -(0.045 + THREE.MathUtils.degToRad(2));
    const firstTopRowBackoffAngle = THREE.MathUtils.degToRad(2);
    addLeafRing({ count: 6, phi: 0.07, shell: 0.54, scale: 0.72, matIndex: 2, phase: 0.18, lift: 0.32, yOffset: 0.40, pitchOffset: topMotionTuckAngle });
    const earlyRowPhaseOffsets = [0.16, 0.48, -0.08, 0.31];
    let staggerPhase = earlyRowPhaseOffsets[earlyRowPhaseOffsets.length - 1] + Math.PI / rowCounts[earlyRowPhaseOffsets.length - 1];
    for (let row = 0; row < rowCounts.length; row++) {
      const t = row / (rowCounts.length - 1);
      const phi = 0.18 + t * 2.50;
      const rowScale = 0.76 + Math.sin((1 - t) * Math.PI * 0.5) * 0.16;
      const matIndex = row < topHighlightRows ? 2 : row > 6 ? 0 : 1;
      const rowPhase = row < earlyRowPhaseOffsets.length ? earlyRowPhaseOffsets[row] : staggerPhase;
      addLeafRing({
        count: rowCounts[row],
        phi,
        shell: 1.09 - t * 0.15 + (Math.random() - 0.5) * 0.01,
        scale: rowScale,
        matIndex,
        phase: rowPhase,
        lift: row === rowCounts.length - 2 ? 0.48 - t * 0.08 : row === rowCounts.length - 1 ? 0.35 - t * 0.08 : 0.22 - t * 0.10,
        pitchOffset: row === 0 ? topMotionTuckAngle + firstTopRowBackoffAngle : row < topMotionTuckRows ? topMotionTuckAngle : 0,
      });
      if (row >= earlyRowPhaseOffsets.length) staggerPhase += Math.PI / rowCounts[row];
    }

    for (let i = 0; i < leafBuckets.length; i++) {
      const outline = makeInstancedLeafBatch(leafOutlineGeo, leafOutlineMat, leafBuckets[i]);
      if (outline) {
        outline.castShadow = false;
        outline.renderOrder = -1;
        g.add(outline);
      }
    }
    for (let i = 0; i < leafBuckets.length; i++) {
      const leaves = makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i], !useCanopyShadowProxy);
      if (leaves) g.add(leaves);
    }
    if (useCanopyShadowProxy) {
      g.add(makeLeafballCanopyShadowProxy(canopyCenter, canopyRadius));
    }

    const branchGeo = pooled("leafballtree.branch.geo", () => new THREE.CylinderGeometry(0.045, 0.075, 1, 6));
    const yAxis = new THREE.Vector3(0, 1, 0);
    const branchReach = 0.62;
    const minLeafMotionGap = 0.20;
    const branchTipRadius = Math.min(branchReach, canopyRadius.x - minLeafMotionGap);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.24;
      const start = new THREE.Vector3(0.03 * Math.cos(a), 1.10 + canopyYOffset + i * 0.025, 0.03 * Math.sin(a));
      const end = new THREE.Vector3(Math.cos(a) * branchTipRadius, 1.34 + canopyYOffset + (i % 2) * 0.10, Math.sin(a) * branchTipRadius);
      const delta = end.clone().sub(start);
      const branch = new THREE.Mesh(branchGeo, trunkMat);
      branch.position.copy(start).add(end).multiplyScalar(0.5);
      branch.quaternion.setFromUnitVectors(yAxis, delta.clone().normalize());
      branch.scale.set(1, delta.length(), 1);
      branch.castShadow = true;
      g.add(branch);
    }
    g.userData.obstacleTopY = 2.25 + canopyYOffset;
    return g;
  },

  pine(biome) {
    const g = new THREE.Group();
    // Pine is built so every piece's local y matches its height above ground:
    // trunk geo translated up by half its height, each cone tier translated to
    // its final stack position, and every mesh placed at y=0. Both trunkMat
    // and coneMat share the same wind strength so the entire silhouette sways
    // as one shape, with applyWindSway's y² term giving the downward falloff
    // (trunk barely moves, top cone moves most).
    const PINE_WIND = 0.18;
    const trunkGeo = pooled("pine.trunk.geo", () =>
      new THREE.CylinderGeometry(0.08, 0.12, 0.4, 6).translate(0, 0.2, 0)
    );
    const trunkMat = pooled("pine.trunk.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true }),
        PINE_WIND
      )
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    g.add(trunk);
    const coneMat = pooled("pine.cone.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent).lerp(new THREE.Color("#0d2c1f"), 0.35),
          flatShading: true,
        }),
        PINE_WIND
      )
    );
    const tiers = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < tiers; i++) {
      const coneGeo = pooled("pine.cone.geo." + i, () =>
        new THREE.ConeGeometry(0.65 - i * 0.13, 0.65, 6).translate(0, 0.45 + i * 0.42, 0)
      );
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.castShadow = true;
      g.add(cone);
    }
    return g;
  },

  snowpine(biome) {
    const g = new THREE.Group();
    // Snow-covered pine — stacked low-poly bough skirts with scalloped snow
    // rims, closer to the chunky frozen-forest reference than simple cones.
    const PINE_WIND = 0.18;
    const boughSegments = 28;
    const coneGreen = new THREE.Color(biome.accent).lerp(new THREE.Color("#0d3342"), 0.38);

    const trunkGeo = pooled("snowpine.trunk.geo", () =>
      new THREE.CylinderGeometry(0.075, 0.13, 0.62, 6).translate(0, 0.31, 0)
    );
    const trunkMat = pooled("snowpine.trunk.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(TRUNK).lerp(new THREE.Color("#8ba4b8"), 0.12),
          flatShading: true,
        }),
        PINE_WIND
      )
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    g.add(trunk);

    function applySnowMaskShader(material) {
      material.userData.snowpineSnowShader = true;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uSnowColor = { value: new THREE.Color("#e4edf7") };
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nattribute float aSnow;\nvarying float vSnow;"
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvSnow = aSnow;"
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform vec3 uSnowColor;\nvarying float vSnow;"
          )
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
            float snowMask = smoothstep(0.46, 0.52, vSnow);
            diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, snowMask);`
          );
      };
      return material;
    }

    const boughMat = pooled("snowpine.bough.mat", () =>
      applyWindSway(
        applySnowMaskShader(
          new THREE.MeshStandardMaterial({
            color: coneGreen,
            flatShading: false,
            roughness: 0.82,
            vertexColors: true,
          })
        ),
        PINE_WIND
      )
    );

    function makeBoughGeometry(radius, height, tierY) {
      const topY = tierY + height * 0.52;
      const skirtY = tierY - height * 0.32;
      const vertices = [];
      const snowMask = [];
      const colors = [];
      const innerRing = [];
      const outerRing = [];
      const undersideRing = [];
      function pushVertex(x, y, z, snow) {
        const index = vertices.length / 3;
        vertices.push(x, y, z);
        snowMask.push(snow);
        const color = snow > 0.5 ? new THREE.Color("#e4edf7") : coneGreen;
        colors.push(color.r, color.g, color.b);
        return index;
      }
      const apex = pushVertex(0, topY, 0, 0);
      const undersideCenter = pushVertex(0, skirtY + height * 0.02, 0, 0);
      for (let j = 0; j < boughSegments; j++) {
        const a = (j / boughSegments) * Math.PI * 2;
        const point = j % 2 === 0;
        const innerR = radius * (point ? 0.86 : 0.78);
        const outerR = radius * (point ? 1.08 : 0.96);
        const innerY = skirtY + height * 0.035;
        const outerY = skirtY - (point ? height * 0.04 : height * 0.14);
        const ox = Math.cos(a) * outerR;
        const oz = Math.sin(a) * outerR;
        innerRing.push(pushVertex(Math.cos(a) * innerR, innerY, Math.sin(a) * innerR, 0));
        outerRing.push(pushVertex(ox, outerY, oz, 1));
        undersideRing.push(pushVertex(ox, outerY, oz, 0));
      }
      const indices = [];
      for (let j = 0; j < boughSegments; j++) {
        const next = (j + 1) % boughSegments;
        const innerA = innerRing[j];
        const innerB = innerRing[next];
        const outerA = outerRing[j];
        const outerB = outerRing[next];
        indices.push(
          apex, innerB, innerA,
          innerA, innerB, outerB,
          innerA, outerB, outerA
        );
      }
      for (let j = 0; j < boughSegments; j++) {
        const next = (j + 1) % boughSegments;
        const underA = undersideRing[j];
        const underB = undersideRing[next];
        indices.push(undersideCenter, underA, underB);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geo.setAttribute("aSnow", new THREE.Float32BufferAttribute(snowMask, 1));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.userData.snowpineUpperFaceCount = boughSegments * 3;
      geo.computeVertexNormals();
      return geo;
    }

    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const tierRadius = 0.82 - i * 0.095;
      const tierHeight = 0.62 - i * 0.03;
      const tierY = 0.48 + i * 0.36;

      const boughGeo = pooled("snowpine.bough.geo." + i, () =>
        makeBoughGeometry(tierRadius, tierHeight, tierY)
      );
      const bough = new THREE.Mesh(boughGeo, boughMat);
      bough.castShadow = true;
      bough.userData.snowpinePart = "bough";
      bough.userData.tierRadius = tierRadius;
      bough.userData.tierY = tierY;
      bough.userData.zigZagPoints = boughSegments;
      g.add(bough);
    }

    g.userData.obstacleTopY = 1.95;
    return g;
  },

  dandylion(biome) {
    const g = new THREE.Group();
    const castMicroShadow = shouldCastMicroFloraShadow(biome);
    const DANDYLION_STEM_H = 0.92;
    const DANDYLION_WIND = 1.15;
    function dandylionStemOffset(t) {
      return new THREE.Vector3(
        Math.sin(t * Math.PI * 0.88) * 0.026,
        t * DANDYLION_STEM_H,
        Math.sin(t * Math.PI * 1.7 + 0.6) * 0.008
      );
    }
    const stemGeo = pooled("dandylion.stem.geo", () => {
      const geo = new THREE.CylinderGeometry(0.011, 0.022, DANDYLION_STEM_H, 12, 8).translate(0, DANDYLION_STEM_H / 2, 0);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / DANDYLION_STEM_H;
        const stemOffset = dandylionStemOffset(t);
        pos.setX(i, pos.getX(i) + stemOffset.x);
        pos.setZ(i, pos.getZ(i) + stemOffset.z);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const dandyPalette = getDandylionFloraPalette(biome);
    const stemMat = pooled("dandylion.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: dandyPalette.stem, flatShading: false, roughness: 0.88 }),
        DANDYLION_WIND
      )
    );
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.castShadow = castMicroShadow;
    g.add(stem);

    const leafGeo = pooled("dandylion.baseleaf.geo", () =>
      buildLeafGeo({
        lengthSegs: 8,
        widthSegs: 5,
        length: 0.44,
        maxWidth: 0.115,
        minWidth: 0.010,
        profileExp: 0.54,
        taperEnd: 0.34,
        centerLift: 0.018,
        centerLiftFade: 0.42,
        tipCurlStrength: 0.045,
        tipCurlExp: 1.25,
        edgeCurlStrength: 0.018,
        centerRibLift: 0.018,
        secondaryRibLift: 0.010,
        secondaryRibFrequency: 6.0,
      })
    );
    const leafMat = pooled("dandylion.baseleaf.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: dandyPalette.leaf,
          side: THREE.DoubleSide,
          flatShading: false,
          roughness: 0.86,
        }),
        0.72
      )
    );
    const baseLeafCount = 5;
    const leafHeightStart = 0.20;
    const leafHeightGap = 0.18 / Math.max(1, baseLeafCount - 1);
    const basis = new THREE.Matrix4();
    for (let i = 0; i < baseLeafCount; i++) {
      const a = (i / baseLeafCount) * Math.PI * 2 + Math.random() * 0.35;
      const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const tipDir = outward.clone().multiplyScalar(0.96).add(new THREE.Vector3(0, -0.28, 0)).normalize();
      const yAxis = tipDir.clone().multiplyScalar(-1);
      const zAxis = new THREE.Vector3(0, 1, 0).addScaledVector(outward, 0.18);
      zAxis.addScaledVector(yAxis, -zAxis.dot(yAxis)).normalize();
      const xAxis = yAxis.clone().cross(zAxis).normalize();
      zAxis.copy(xAxis).cross(yAxis).normalize();
      basis.makeBasis(xAxis, yAxis, zAxis);

      const leaf = new THREE.Mesh(leafGeo, leafMat);
      const attachT = leafHeightStart + i * leafHeightGap + Math.random() * 0.012;
      const attachPos = dandylionStemOffset(attachT);
      leaf.position.copy(attachPos);
      leaf.quaternion.setFromRotationMatrix(basis);
      const leafPitchVariation = (Math.random() - 0.5) * 0.34;
      const leafYawVariation = (Math.random() - 0.5) * 0.18;
      const leafRollVariation = (Math.random() - 0.5) * 0.28;
      leaf.rotateX(leafPitchVariation);
      leaf.rotateY(leafYawVariation);
      leaf.rotateZ(leafRollVariation);
      leaf.scale.setScalar(0.82 + Math.random() * 0.28);
      leaf.castShadow = castMicroShadow;
      g.add(leaf);
    }

    const coreGeo = pooled("dandylion.core.geo", () =>
      new THREE.SphereGeometry(0.070, 16, 12).scale(1, 0.82, 1).translate(0, DANDYLION_STEM_H, 0)
    );
    const glow = !!biome.glowFlowers;
    const coreMat = pooled("dandylion.core.mat.smooth", () =>
      applyDandylionHeadWind(
        new THREE.MeshStandardMaterial({
          color: "#ece0b8",
          emissive: glow ? new THREE.Color(biome.accent).multiplyScalar(0.32) : 0x000000,
          emissiveIntensity: glow ? 0.55 : 0,
          flatShading: false,
          roughness: 0.78,
        }),
        DANDYLION_WIND,
        DANDYLION_STEM_H
      )
    );
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.castShadow = castMicroShadow;
    g.add(core);

    const sporeCount = 288;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const fuzzInnerRadius = 0.050;
    const fuzzOuterRadius = 0.152;
    const linePositions = new Float32Array(sporeCount * 2 * 3);
    const lineSeeds = new Float32Array(sporeCount * 2);
    const sporePositions = new Float32Array(sporeCount * 3);
    const sporeSeeds = new Float32Array(sporeCount);
    const sporeSizes = new Float32Array(sporeCount);
    const detachedSporeCount = 6;
    const detachedSporePositions = new Float32Array(detachedSporeCount * 3);
    const detachedSporeSeeds = new Float32Array(detachedSporeCount);
    const detachedSporeSizes = new Float32Array(detachedSporeCount);
    const v = new THREE.Vector3();
    for (let i = 0; i < sporeCount; i++) {
      const y = 1 - (i / (sporeCount - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * goldenAngle;
      const wobble = 0.92 + Math.random() * 0.18;
      v.set(Math.cos(a) * r, y * 0.92, Math.sin(a) * r).normalize();
      const root = v.clone().multiplyScalar(fuzzInnerRadius);
      const tip = v.clone().multiplyScalar(fuzzOuterRadius * wobble);
      root.y += DANDYLION_STEM_H;
      tip.y += DANDYLION_STEM_H;

      linePositions.set([root.x, root.y, root.z, tip.x, tip.y, tip.z], i * 6);
      lineSeeds[i * 2] = i * 0.173;
      lineSeeds[i * 2 + 1] = i * 0.173 + 0.37;
      sporePositions.set([tip.x, tip.y, tip.z], i * 3);
      sporeSeeds[i] = i * 0.173 + 0.71;
      sporeSizes[i] = 4.2 + Math.random() * 4.2;
    }
    for (let i = 0; i < detachedSporeCount; i++) {
      const y = 0.2 + Math.random() * 0.6;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * goldenAngle + Math.random() * 0.28;
      v.set(Math.cos(a) * r, y * 0.86, Math.sin(a) * r).normalize();
      const start = v.multiplyScalar(fuzzOuterRadius * (0.72 + Math.random() * 0.20));
      start.y += DANDYLION_STEM_H;
      detachedSporePositions.set([start.x, start.y, start.z], i * 3);
      detachedSporeSeeds[i] = Math.random();
      detachedSporeSizes[i] = 4.0 + Math.random() * 3.1;
    }

    const lineGeo = pooled("dandylion.fuzz.line.geo", () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
      geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(lineSeeds, 1));
      return geo;
    });
    const sporeGeo = pooled("dandylion.spore.point.geo", () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(sporePositions, 3));
      geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(sporeSeeds, 1));
      geo.setAttribute("aSize", new THREE.Float32BufferAttribute(sporeSizes, 1));
      return geo;
    });
    const detachedSporeGeo = pooled("dandylion.detached.spore.point.geo", () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(detachedSporePositions, 3));
      geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(detachedSporeSeeds, 1));
      geo.setAttribute("aSize", new THREE.Float32BufferAttribute(detachedSporeSizes, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, DANDYLION_STEM_H + 0.35, 0), 12.5);
      return geo;
    });
    const fuzzVertexShader = `
      attribute float aSeed;
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uFoliageWind;
      uniform float uDandylionHeadY;
      varying float vSeed;
      vec2 dandylionHeadWindOffset() {
        float windY = uDandylionHeadY;
        float windAmp = windY * windY * uWindStrength * uFoliageWind;
        vec4 wp = modelMatrix * vec4(vec3(0.0, uDandylionHeadY, 0.0), 1.0);
        float w1 = sin(uTime * 1.4 + wp.x * 0.30 + wp.z * 0.40);
        float w2 = sin(uTime * 0.9 + wp.x * 0.15 - wp.z * 0.25);
        vec2 windWorld = vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05);
        return windWorld;
      }
      void main() {
        vSeed = aSeed;
        vec3 p = position;
        p.xz += dandylionHeadWindOffset();
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `;
    const lineMat = pooled("dandylion.fuzz.line.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: state.windUniforms.uTime,
          uWindStrength: { value: DANDYLION_WIND },
          uFoliageWind: state.windUniforms.uFoliageWind,
          uDandylionHeadY: { value: DANDYLION_STEM_H },
          uColor: { value: new THREE.Color("#f9f0d8") },
          uOpacity: { value: glow ? 0.46 : 0.34 },
        },
        vertexShader: fuzzVertexShader,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vSeed;
          void main() {
            float twinkle = 0.84 + 0.16 * sin(vSeed * 11.0);
            gl_FragColor = vec4(uColor * twinkle, uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
      })
    );
    const sporeMat = pooled("dandylion.spore.point.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: state.windUniforms.uTime,
          uWindStrength: { value: DANDYLION_WIND },
          uFoliageWind: state.windUniforms.uFoliageWind,
          uDandylionHeadY: { value: DANDYLION_STEM_H },
          uColor: { value: new THREE.Color("#fff8e8") },
          uOpacity: { value: glow ? 0.58 : 0.44 },
        },
        vertexShader: fuzzVertexShader.replace(
          "void main() {",
          "attribute float aSize;\nvoid main() {"
        ).replace(
          "gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);",
          "vec4 mv = modelViewMatrix * vec4(p, 1.0);\n        gl_Position = projectionMatrix * mv;\n        gl_PointSize = aSize;"
        ),
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vSeed;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            float soft = smoothstep(0.5, 0.08, d);
            float twinkle = 0.82 + 0.18 * sin(vSeed * 13.0);
            gl_FragColor = vec4(uColor * twinkle, soft * uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
      })
    );
    const detachedSporeMat = pooled("dandylion.detached.spore.point.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: state.windUniforms.uTime,
          uWindStrength: { value: DANDYLION_WIND },
          uFoliageWind: state.windUniforms.uFoliageWind,
          uDandylionHeadY: { value: DANDYLION_STEM_H },
          uColor: { value: new THREE.Color("#fffaf0") },
          uOpacity: { value: glow ? 0.62 : 0.48 },
        },
        vertexShader: `
          attribute float aSeed;
          attribute float aSize;
          uniform float uTime;
          uniform float uWindStrength;
          uniform float uFoliageWind;
          uniform float uDandylionHeadY;
          varying float vSeed;
          varying float vDriftAlpha;
          void main() {
            vSeed = aSeed;
            float cycle = fract(uTime * 0.037 + aSeed);
            float rise = smoothstep(0.03, 0.18, cycle);
            float fade = rise * (1.0 - smoothstep(0.62, 0.96, cycle)) * uFoliageWind;
            vec4 headWp = modelMatrix * vec4(vec3(0.0, uDandylionHeadY, 0.0), 1.0);
            vec2 windDir = normalize(vec2(
              0.72 + sin(headWp.z * 0.23 + aSeed * 8.0) * 0.28,
              0.44 + cos(headWp.x * 0.19 + aSeed * 7.0) * 0.24
            ));
            vec3 p = position;
            float lift = smoothstep(0.0, 0.72, cycle);
            vec2 crossWind = vec2(-windDir.y, windDir.x);
            float lateralLane = (fract(aSeed * 17.0) - 0.5) * 0.055;
            float forwardGust = 0.92 + 0.16 * sin(aSeed * 37.0);
            float modelScale = max(length(modelMatrix[0].xyz), 0.001);
            float travel = 10.0 / modelScale;
            p.xz += windDir * cycle * cycle * forwardGust * uWindStrength * uFoliageWind * travel;
            p.xz += crossWind * lateralLane * lift * uFoliageWind;
            p.y += cycle * (0.18 + sin(aSeed * 19.0) * 0.045);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * (1.0 - cycle * 0.35);
            vDriftAlpha = fade;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vSeed;
          varying float vDriftAlpha;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            float soft = smoothstep(0.5, 0.08, d);
            float twinkle = 0.86 + 0.14 * sin(vSeed * 41.0);
            gl_FragColor = vec4(uColor * twinkle, soft * uOpacity * vDriftAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
      })
    );
    const fuzzLines = new THREE.LineSegments(lineGeo, lineMat);
    const spores = new THREE.Points(sporeGeo, sporeMat);
    const detachedSpores = new THREE.Points(detachedSporeGeo, detachedSporeMat);
    fuzzLines.renderOrder = 1;
    spores.renderOrder = 2;
    detachedSpores.renderOrder = 3;
    g.add(fuzzLines);
    g.add(spores);
    g.add(detachedSpores);

    g.userData.flowerSpotY = DANDYLION_STEM_H;
    return g;
  },

  cactus() {
    const g = new THREE.Group();
    const m = pooled("cactus.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#3d5a2e", flatShading: true, roughness: 0.8 })
    );
    const bodyGeo = pooled("cactus.body.geo", () => new THREE.CapsuleGeometry(0.18, 0.7, 4, 8));
    const body = new THREE.Mesh(bodyGeo, m);
    body.position.y = 0.6;
    body.castShadow = true;
    g.add(body);
    addCapsuleNeedles(body, 0.18, 0.7);
    if (Math.random() > 0.4) {
      const armGeo = pooled("cactus.arm1.geo", () => new THREE.CapsuleGeometry(0.1, 0.4, 4, 8));
      const arm = new THREE.Mesh(armGeo, m);
      arm.position.set(0.22, 0.7, 0);
      arm.rotation.z = -Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
      addCapsuleNeedles(arm, 0.1, 0.4);
    }
    if (Math.random() > 0.5) {
      const armGeo = pooled("cactus.arm2.geo", () => new THREE.CapsuleGeometry(0.1, 0.35, 4, 8));
      const arm = new THREE.Mesh(armGeo, m);
      arm.position.set(-0.22, 0.55, 0);
      arm.rotation.z = Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
      addCapsuleNeedles(arm, 0.1, 0.35);
    }
    return g;
  },

  mushroom(biome) {
    const g = new THREE.Group();
    // Stem geo is shifted so its base sits at y=0 (mesh at the origin) — that
    // makes applyWindSway's y² bend anchor at the ground and grow toward the
    // cap. Cap and underside use the same shared wind strength so they
    // translate along with the stem's top instead of warping on their own:
    // their geometry spans only ~0.2 in y near the stem's top, so windY² is
    // nearly uniform across each piece and the cap reads as rigid.
    const MUSH_WIND = 0.9;
    const STEM_TOP = 0.35;
    const stemGeo = pooled("mushroom.stem.geo", () =>
      makeMushroomStemGeometry(0.35, { baseRadius: 0.095, topRadius: 0.066, bulbRadius: 0.040, radialSegments: 7 })
    );
    const stemMat = pooled("mushroom.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#f1e8d8" }),
        MUSH_WIND
      )
    );
    const undersideMat = pooled("mushroom.underside.mat.lit", () =>
      applyWindSway(makeMushroomUndersideMaterial(), MUSH_WIND)
    );
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.castShadow = true;
    g.add(stem);
    const capGeo = pooled("mushroom.cap.geo", () =>
      new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(1.4, 0.9, 1.4)
        .translate(0, STEM_TOP + 0.01, 0)
    );
    const capColor = new THREE.Color(biome.accent).offsetHSL(
      (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.10
    );
    const capMat = applyWindSway(
      makeMushroomCapPBRMaterial({ color: capColor, roughness: 0.6 }),
      MUSH_WIND
    );
    enableMushroomCapShadowUnderside(capMat);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.castShadow = true;
    g.add(cap);
    // Underside disc — closes the hemisphere so looking up under the cap
    // from first-person stroll doesn't see through into empty space.
    // Rotation/scale are baked into the geometry so the wind shader sees a
    // uniform transformed.y = STEM_TOP across every vertex.
    const undersideGeo = pooled("mushroom.underside.geo", () =>
      makeMushroomUndersideGeometry(0.22 * 1.4, 0.22 * 1.4, STEM_TOP + 0.01, 12)
    );
    const underside = new THREE.Mesh(undersideGeo, undersideMat);
    g.add(underside);
    // Local Y of the cap top so world.js can register an accurate perch
    // spot for fliers. Sphere radius 0.22 with Y-scale 0.9 puts the apex at
    // cap.position.y + 0.22*0.9.
    g.userData.capTopY = 0.36 + 0.22 * 0.9;
    g.userData.perchWind = { strength: MUSH_WIND, localY: g.userData.capTopY };
    addGroveMushroomFamily(g, biome, { radius: 0.42, count: 2, capY: g.userData.capTopY });
    return g;
  },

  fern(biome) {
    const g = new THREE.Group();
    const castMicroShadow = shouldCastMicroFloraShadow(biome);
    const stemMat = pooled("fern.frond.stem.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[0]).offsetHSL(0, 0.04, -0.06),
          flatShading: false,
          roughness: 0.92,
        }),
        1.0
      )
    );
    const leafMat = pooled("fern.frond.leaflet.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[1] ?? biome.ground[0]).offsetHSL(0, 0.10, 0.02),
          side: THREE.DoubleSide,
          flatShading: false,
          roughness: 0.84,
        }),
        1.45
      )
    );
    const stemGeo = pooled("fern.frond.stem.geo", () => new THREE.CylinderGeometry(0.007, 0.014, 1, 5));
    const leafletGeo = pooled("fern.frond.leaflet.geo", () => {
      const geo = buildLeafGeo({
        lengthSegs: 8,
        widthSegs: 4,
        length: 0.18,
        maxWidth: 0.030,
        minWidth: 0.003,
        profileExp: 0.72,
        taperEnd: 0.28,
        centerLift: 0.006,
        centerLiftFade: 0.45,
        tipCurlStrength: 0.035,
        tipCurlExp: 1.35,
        edgeCurlStrength: 0.012,
        centerRibLift: 0.004,
        secondaryRibLift: 0.0025,
        secondaryRibFrequency: 5.8,
      });
      geo.rotateZ(Math.PI);
      return geo;
    });
    const yAxis = new THREE.Vector3(0, 1, 0);
    const fronds = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < fronds; i++) {
      const frond = new THREE.Group();
      const a = (i / fronds) * Math.PI * 2 + (Math.random() - 0.5) * 0.42;
      const lean = 0.40 + Math.random() * 0.34;
      const frondLength = 0.44 + Math.random() * 0.20;
      const dir = new THREE.Vector3(
        Math.cos(a) * Math.sin(lean),
        Math.cos(lean),
        Math.sin(a) * Math.sin(lean)
      ).normalize();
      frond.quaternion.setFromUnitVectors(yAxis, dir);
      frond.position.set(Math.cos(a) * 0.025, 0, Math.sin(a) * 0.025);

      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.y = frondLength * 0.5;
      stem.scale.y = frondLength;
      stem.castShadow = castMicroShadow;
      frond.add(stem);

      const leafletPairs = 5 + Math.floor(Math.random() * 2);
      for (let j = 0; j < leafletPairs; j++) {
        const t = (j + 1) / (leafletPairs + 1);
        const y = frondLength * (0.14 + t * 0.70);
        const leafletScale = 0.72 + t * 0.46 + Math.random() * 0.08;
        for (const side of [-1, 1]) {
          const leaflet = new THREE.Mesh(leafletGeo, leafMat);
          leaflet.position.set(side * (0.006 + t * 0.010), y, (Math.random() - 0.5) * 0.010);
          leaflet.rotation.z = side * (0.82 + t * 0.34 + Math.random() * 0.12);
          leaflet.rotation.y = side * (0.10 + Math.random() * 0.18);
          leaflet.rotation.x = -0.14 + t * 0.20 + (Math.random() - 0.5) * 0.08;
          leaflet.scale.setScalar(leafletScale);
          leaflet.castShadow = castMicroShadow;
          frond.add(leaflet);
        }
      }

      const tip = new THREE.Mesh(leafletGeo, leafMat);
      tip.position.y = frondLength * 0.90;
      tip.rotation.z = (Math.random() - 0.5) * 0.16;
      tip.rotation.x = 0.08 + Math.random() * 0.10;
      tip.scale.setScalar(0.80 + Math.random() * 0.16);
      tip.castShadow = castMicroShadow;
      frond.add(tip);

      g.add(frond);
    }
    return g;
  },

  rock(biome) {
    const g = new THREE.Group();
    const r = 0.18 + Math.random() * 0.35;
    const baseCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      0,
      0.05 + Math.random() * 0.1
    );
    const mat = makePlainRockPBRMaterial({
      color: baseCol,
      flatShading: true,
      roughness: 1,
    });
    const mesh = new THREE.Mesh(makePlainRockGeometry(r), mat);
    mesh.castShadow = true;
    g.add(mesh);

    const shoulders = 2;
    const shoulderPhase = Math.random() * Math.PI * 2;
    for (let i = 0; i < shoulders; i++) {
      const a = shoulderPhase + i * Math.PI * 0.82;
      const chipRadius = r * (0.46 + Math.random() * 0.18);
      const chipColor = baseCol.clone().offsetHSL(0, -0.02, -0.03 + Math.random() * 0.08);
      const chip = new THREE.Mesh(
        makePlainRockGeometry(chipRadius, { shoulder: true }),
        makePlainRockPBRMaterial({
          color: chipColor,
          flatShading: true,
          roughness: 1,
        })
      );
      chip.position.set(Math.cos(a) * r * 0.74, -r * 0.14, Math.sin(a) * r * 0.62);
      chip.rotation.y = a + Math.PI * (0.25 + Math.random() * 0.5);
      chip.castShadow = true;
      g.add(chip);
    }

    return g;
  },

  limestonerock(biome) {
    const g = new THREE.Group();
    const r = 0.2 + Math.random() * 0.32;
    const geo = jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.25, { sphericalUvs: true });
    const baseCol = new THREE.Color(biome.ground[0])
      .lerp(new THREE.Color("#fff4dc"), 0.45)
      .offsetHSL(0.02, -0.08, Math.random() * 0.08);
    const mesh = new THREE.Mesh(
      geo,
      makeStonePBRMaterial({
        color: baseCol,
        flatShading: true,
        roughness: 1,
      })
    );
    mesh.scale.set(1.15, 0.45 + Math.random() * 0.25, 0.9 + Math.random() * 0.35);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  },

  reed() {
    const g = new THREE.Group();
    const mat = pooled("reed.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#6d4f8a", flatShading: true }),
        1.6
      )
    );
    const count = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const h = 0.6 + Math.random() * 0.5;
      const blade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.025, h, 4),
        mat
      );
      blade.position.set(
        (Math.random() - 0.5) * 0.18,
        h / 2,
        (Math.random() - 0.5) * 0.18
      );
      blade.rotation.z = (Math.random() - 0.5) * 0.3;
      g.add(blade);
    }
    return g;
  },

  seaweed(biome) {
    const g = new THREE.Group();
    const SEAWEED_BASE_HEIGHT = 0.8;
    const SEAWEED_SEGMENTS = 6;
    const base = new THREE.Color(biome.underside || "#3aa8b8");
    const matA = pooled("seaweed.mat.a", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: base.clone().offsetHSL(0.08, 0.1, -0.08),
          side: THREE.DoubleSide,
          flatShading: true,
          roughness: 0.75,
        }),
        2.2
      )
    );
    const matB = pooled("seaweed.mat.b", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent).offsetHSL(-0.08, -0.15, -0.02),
          side: THREE.DoubleSide,
          flatShading: true,
          roughness: 0.75,
        }),
        2.2
      )
    );
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const h = SEAWEED_BASE_HEIGHT * (0.78 + Math.random() * 0.22);
      const w = 0.055 + Math.random() * 0.035;
      const geo = new THREE.PlaneGeometry(w, h, 1, SEAWEED_SEGMENTS);
      const position = geo.attributes.position;
      const bow = (Math.random() - 0.5) * 2;
      for (let i = 0; i < position.count; i++) {
        const y = position.getY(i) + h / 2;
        const t = y / h;
        const x = position.getX(i);
        const z = position.getZ(i);
        position.setX(i, x + bow * 0.025 * Math.sin(t * Math.PI * 1.5));
        position.setZ(i, z + bow * 0.018 * Math.sin(t * Math.PI * 2.0 + 0.6));
      }
      position.needsUpdate = true;
      geo.translate(0, h / 2, 0);
      geo.computeVertexNormals();
      const blade = new THREE.Mesh(geo, i % 2 ? matA : matB);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      blade.position.set(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
      blade.rotation.y = a + Math.PI / 2;
      blade.rotation.z = (Math.random() - 0.5) * 0.45;
      g.add(blade);
    }
    g.userData.surfaceReachRange = [0.5, 0.95];
    g.userData.baseHeight = SEAWEED_BASE_HEIGHT;
    return g;
  },

  grass(biome) {
    const g = new THREE.Group();
    const mat = pooled("grass.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[2]).offsetHSL(0, 0, -0.1),
          flatShading: true,
        }),
        1.8
      )
    );
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.3 + Math.random() * 0.2, 3),
        mat
      );
      blade.position.set(
        (Math.random() - 0.5) * 0.2,
        0.15,
        (Math.random() - 0.5) * 0.2
      );
      blade.rotation.z = (Math.random() - 0.5) * 0.6;
      g.add(blade);
    }
    return g;
  },

  beachsucculent(biome) {
    const g = new THREE.Group();
    const leafMat = pooled("beachsucculent.leaf.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.underside || biome.fog).lerp(new THREE.Color("#d7fff3"), 0.35),
          flatShading: true,
          roughness: 0.8,
        }),
        0.7
      )
    );
    const budMat = pooled("beachsucculent.bud.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent).lerp(new THREE.Color("#fff2b3"), 0.35),
        flatShading: true,
        roughness: 0.65,
      })
    );
    const leafGeo = pooled("beachsucculent.leaf.geo", () => {
      const geo = jitterGeo(new THREE.IcosahedronGeometry(0.11, 0), 0.025);
      geo.scale(0.65, 0.28, 1.35);
      return geo;
    });
    const leaves = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + Math.random() * 0.25;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(a) * 0.11, 0.08, Math.sin(a) * 0.11);
      leaf.rotation.y = a;
      leaf.rotation.z = 0.55 + Math.random() * 0.25;
      leaf.castShadow = true;
      g.add(leaf);
    }
    const bud = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(0.09, 0), 0.02), budMat);
    bud.position.y = 0.18;
    bud.scale.set(1.1, 0.75, 1.1);
    bud.castShadow = true;
    g.add(bud);
    return g;
  },

  flyer_nest(biome) {
    const g = new THREE.Group();
    const FLYER_NEST_PERCH_RADIUS = 0.612;
    const nestColor = new THREE.Color(TRUNK).lerp(new THREE.Color(biome.cliff), 0.28);
    const bowlMat = makeFlyerNestPBRMaterial({
      color: nestColor,
      flatShading: true,
      roughness: 0.96,
      side: THREE.DoubleSide,
    });
    const mat = makeFlyerNestPBRMaterial({
      color: nestColor,
      flatShading: true,
      roughness: 0.96,
    });
    const lightTwigColor = nestColor.clone().lerp(new THREE.Color(0xc99a63), 0.72);
    const twigLightMat = makeFlyerNestPBRMaterial({
      color: lightTwigColor,
      flatShading: true,
      roughness: 0.94,
    });
    const outerRingGeo = pooled("flyer_nest.outerRing.geo", () => {
      const geo = new THREE.TorusGeometry(0.558, 0.252, 8, 24);
      geo.rotateX(Math.PI / 2);
      geo.scale(1, 0.62, 1);
      geo.computeVertexNormals();
      return geo;
    });
    const innerBowlGeo = pooled("flyer_nest.innerBowl.geo", () => {
      const geo = new THREE.CircleGeometry(0.558, 28);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const r = Math.min(1, Math.sqrt(x * x + z * z) / 0.558);
        pos.setY(i, 0.117 + r * r * 0.108);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const bowl = new THREE.Mesh(innerBowlGeo, bowlMat);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    g.add(bowl);
    const ring = new THREE.Mesh(outerRingGeo, mat);
    ring.position.y = 0.225;
    ring.castShadow = true;
    ring.receiveShadow = true;
    g.add(ring);

    const twigGeo = pooled("flyer_nest.twig.geo", () => {
      const geo = new THREE.CylinderGeometry(0.0432, 0.0612, 1, 5);
      geo.computeVertexNormals();
      return geo;
    });
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.20;
      const len = 0.342 + Math.random() * 0.306;
      const radius = 0.378 + Math.random() * 0.162;
      const tangent = new THREE.Vector3(-Math.sin(a), 0.10 + Math.random() * 0.10, Math.cos(a)).normalize();
      const twig = new THREE.Mesh(twigGeo, i % 4 === 1 || i % 7 === 3 ? twigLightMat : mat);
      twig.position.set(Math.cos(a) * radius, 0.207 + Math.random() * 0.072, Math.sin(a) * radius);
      twig.quaternion.setFromUnitVectors(up, tangent);
      twig.rotateY((Math.random() - 0.5) * 0.65);
      twig.scale.setScalar(0.9 + Math.random() * 0.25);
      twig.scale.y = len;
      twig.castShadow = true;
      g.add(twig);
    }

    g.userData.capTopY = 0.387;
    g.userData.obstacleTopY = 0.432;
    g.userData.perchRadius = FLYER_NEST_PERCH_RADIUS;
    return g;
  },

  deadtree(biome) {
    const g = new THREE.Group();
    const mat = pooled("deadtree.mat.smooth", () =>
      makeDeadTreePBRMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, -0.1, 0.05),
        flatShading: false,
        roughness: 0.98,
      })
    );
    const trunkGeo = pooled("deadtree.trunk.geo", () => {
      const geo = new THREE.CylinderGeometry(0.06, 0.13, 1.2, 5);
      geo.computeVertexNormals();
      return geo;
    });
    const branchGeo = pooled("deadtree.branch.geo", () => {
      const geo = new THREE.CylinderGeometry(0.025, 0.04, 0.45, 4);
      geo.translate(0, 0.225, 0);
      geo.computeVertexNormals();
      return geo;
    });
    const trunk = new THREE.Mesh(trunkGeo, mat);
    trunk.position.y = 0.6;
    trunk.rotation.z = (Math.random() - 0.5) * 0.15;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const branch = new THREE.Mesh(branchGeo, mat);
      const yaw = Math.random() * Math.PI * 2;
      const tilt = 0.5 + Math.random() * 0.7;
      branch.position.set(0, 0.9 + i * 0.08, 0);
      branch.rotation.set(0, yaw, 0);
      branch.rotateX(tilt);
      branch.castShadow = true;
      g.add(branch);
    }
    return g;
  },

  skull() {
    const g = new THREE.Group();
    const mat = pooled("skull.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#f1ead8", roughness: 0.8 })
    );
    const skullGeo = pooled("skull.geo", () => new THREE.SphereGeometry(0.18, 10, 8));
    const skull = new THREE.Mesh(skullGeo, mat);
    skull.scale.set(1, 0.85, 1.1);
    skull.position.y = 0.18;
    skull.castShadow = true;
    g.add(skull);
    const eyeMat = pooled("skull.eye.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#1a1a1a" })
    );
    const eyeGeo = pooled("skull.eye.geo", () => new THREE.SphereGeometry(0.04, 6, 6));
    [-0.06, 0.06].forEach((x) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, 0.2, 0.15);
      g.add(eye);
    });
    return g;
  },

  pillar(biome) {
    const g = new THREE.Group();
    const stoneCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      -0.1,
      0.12 + Math.random() * 0.08
    );
    const lichenCol = new THREE.Color(biome.ground[0]).offsetHSL(0, 0.05, 0.1);
    const stoneMat = makeStonePBRMaterial({
      color: stoneCol,
      flatShading: true,
      roughness: 1,
    });
    const lichenMat = makeStonePBRMaterial({
      color: lichenCol,
      flatShading: true,
      roughness: 1,
    });
    const segments = 2 + Math.floor(Math.random() * 3); // 2–4 stacked drums
    let y = 0;
    for (let i = 0; i < segments; i++) {
      const h = 0.45 + Math.random() * 0.25;
      const r = 0.22 - i * 0.015;
      // lichen-tinted on the first segment ~half the time
      const useLichen = i === 0 && Math.random() < 0.5;
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.05, h, 7),
        useLichen ? lichenMat : stoneMat
      );
      drum.position.y = y + h / 2;
      drum.rotation.y = Math.random() * Math.PI * 2;
      drum.rotation.z = (Math.random() - 0.5) * 0.08;
      drum.castShadow = true;
      addPillarSurfaceMarks(drum, r, r * 1.05, h, useLichen ? lichenCol : stoneCol);
      g.add(drum);
      y += h - 0.02;
    }
    // broken cap — jittered chunk
    if (Math.random() < 0.7) {
      const cap = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(0.22, 0), 0.08, { sphericalUvs: true }),
        stoneMat
      );
      cap.position.y = y + 0.1;
      cap.scale.set(1.1, 0.5, 1.1);
      cap.rotation.y = Math.random() * Math.PI * 2;
      cap.castShadow = true;
      g.add(cap);
    }
    return g;
  },

  archstone(biome) {
    const g = new THREE.Group();
    const stoneCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      -0.1,
      0.12 + Math.random() * 0.06
    );
    const mat = makeStonePBRMaterial({
      color: stoneCol,
      flatShading: true,
      roughness: 1,
    });
    // two short pillars
    const pillarH = 0.7 + Math.random() * 0.2;
    const gap = 0.55;
    for (const sign of [-1, 1]) {
      const p = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.16, pillarH, 7),
        mat
      );
      p.position.set(sign * gap, pillarH / 2, 0);
      p.castShadow = true;
      g.add(p);
    }
    // curved arch — partial torus
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(gap, 0.11, 5, 10, Math.PI),
      mat
    );
    arc.position.y = pillarH;
    arc.rotation.z = 0;
    arc.castShadow = true;
    g.add(arc);
    // crumbled keystone or missing chunk — break the arch occasionally
    if (Math.random() < 0.5) {
      const fragment = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(0.18, 0), 0.06, { sphericalUvs: true }),
        mat
      );
      fragment.position.set(
        (Math.random() - 0.5) * 0.4,
        0.05,
        (Math.random() - 0.5) * 0.3
      );
      fragment.scale.y = 0.5;
      fragment.castShadow = true;
      g.add(fragment);
    }
    return g;
  },

  crystal(biome) {
    const g = new THREE.Group();
    const mat = pooled("crystal.mat", () => {
      const tint = new THREE.Color(biome.accent);
      return new THREE.MeshStandardMaterial({
        color: tint,
        emissive: tint.clone().multiplyScalar(0.4),
        flatShading: true,
        roughness: 0.35,
        metalness: 0.1,
      });
    });
    const shards = 3 + Math.floor(Math.random() * 3); // 3–5
    for (let i = 0; i < shards; i++) {
      const r = 0.1 + Math.random() * 0.12;
      const geo = new THREE.IcosahedronGeometry(r, 0);
      geo.translate(0, r, 0); // pivot at the base so tilted shards stay rooted together
      const shard = new THREE.Mesh(geo, mat);
      const a = (i / shards) * Math.PI * 2 + Math.random() * 0.5;
      const isCenter = i === 0;
      const tilt = isCenter ? 0.04 : 0.34 + Math.random() * 0.32;
      const rootOff = isCenter ? 0 : 0.025 + Math.random() * 0.035;
      const heightScale = isCenter ? 1.95 + Math.random() * 0.45 : 1.35 + Math.random() * 0.65;
      // Tilt side shards outward from nearby shared roots so the bases touch
      // and the whole cluster reads as one faceted crystal instead of posts.
      shard.position.set(Math.cos(a) * rootOff, 0.02, Math.sin(a) * rootOff);
      shard.scale.set(0.55, heightScale, 0.55);
      shard.rotation.order = "YXZ";
      shard.rotation.y = a;
      shard.rotation.x = -tilt;
      shard.rotation.z = (Math.random() - 0.5) * 0.10;
      shard.castShadow = true;
      shard.layers.enable(BLOOM_LAYER);
      g.add(shard);
    }
    return g;
  },

  bigmushroom(biome) {
    const g = new THREE.Group();
    // tall stem — creatures could pass beneath the cap
    const stemH = 1.4 + Math.random() * 0.5;
    // Big mushroom uses the same trick as the small one — geometry is shifted
    // so each piece's local y matches its world height above the group's
    // anchor, and every mesh sits at y=0. Because stemH is per-instance, the
    // stem/cap/underside geometries can't be pooled. Wind on all three at the
    // same strength keeps the stem-bend coherent: the y² bend grows from the
    // ground up so the slim stem flexes more than the cap (whose vertices
    // share nearly identical y ~ stemH and so move as a rigid block).
    const BIG_WIND = 0.34;
    const stemMat = pooled("bigmushroom.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#f1e8d8", roughness: 0.95 }),
        BIG_WIND
      )
    );
    const undersideMat = pooled("bigmushroom.underside.mat.lit", () =>
      applyWindSway(makeMushroomUndersideMaterial(), BIG_WIND)
    );
    const stemGeo = makeMushroomStemGeometry(stemH, {
      baseRadius: 0.17,
      topRadius: 0.12,
      bulbRadius: 0.090,
      curve: stemH * 0.024,
      radialSegments: 9,
      heightSegments: 12,
    });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.rotation.z = (Math.random() - 0.5) * 0.025;
    stem.castShadow = true;
    g.add(stem);
    const capGeo = new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, 0.55, 1)
      .translate(0, stemH, 0);
    const capColor = new THREE.Color(biome.accent).offsetHSL(
      (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.10
    );
    const capMat = applyWindSway(
      makeMushroomCapPBRMaterial({ color: capColor, roughness: 0.55 }),
      BIG_WIND
    );
    enableMushroomCapShadowUnderside(capMat);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.castShadow = true;
    g.add(cap);
    // Local Y of the cap top — varies with this instance's random stemH,
    // so world.js needs to read it off userData rather than guess from a
    // static per-kind table.
    g.userData.capTopY = stemH + 0.8 * 0.55;
    g.userData.perchWind = { strength: BIG_WIND, localY: g.userData.capTopY };
    // Underside disc — closes the hemisphere so walking under the cap in
    // first-person doesn't see through into empty space above. Uses the
    // stem material (cream) which reads as a fresh mushroom gill plate.
    // Rotation baked into geometry so wind shader sees a uniform y near stemH.
    const undersideGeo = makeMushroomUndersideGeometry(0.8, 0.8, stemH, 12);
    const underside = new THREE.Mesh(undersideGeo, undersideMat);
    g.add(underside);
    // Spots share the cap's wind strength so they sway with it. Each spot's
    // orientation + world position is baked into its geometry — the mesh sits
    // at the group origin so applyWindSway's transformed.y reads the spot's
    // actual world-y above ground. Without this the spots float free of the
    // cap whenever wind nudges the cap material.
    const spotBaseColor = new THREE.Color("#fbf3df");
    const spots = 3 + Math.floor(Math.random() * 3);
    const capR = 0.8;
    const capSY = 0.55;
    const capA2 = capR * capR;
    const capB2 = (capR * capSY) * (capR * capSY);
    const up = new THREE.Vector3(0, 1, 0);
    const tmpQuat = new THREE.Quaternion();
    const tmpMat = new THREE.Matrix4();
    const placedSpots = []; // {x, z, r} to enforce minimum separation
    for (let i = 0; i < spots; i++) {
      // Try to find a non-overlapping position
      let x, z, r, attempts = 0;
      do {
        const a = Math.random() * Math.PI * 2;
        r = 0.25 + Math.random() * 0.4;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        attempts++;
      } while (attempts < 12 && placedSpots.some(s => {
        const dx = x - s.x, dz = z - s.z;
        return dx * dx + dz * dz < (s.r + 0.18) * (s.r + 0.18);
      }));
      const spotRadius = 0.08 + Math.random() * 0.05;
      placedSpots.push({ x, z, r: spotRadius });
      const yLocal = Math.sqrt(Math.max(0, capA2 - r * r)) * capSY;
      const n = new THREE.Vector3(x / capA2, yLocal / capB2, z / capA2).normalize();
      const sink = 0.02;
      const spotGeo = new THREE.SphereGeometry(spotRadius, 20, 12);
      spotGeo.scale(1, 0.35, 1);
      tmpQuat.setFromUnitVectors(up, n);
      tmpMat.makeRotationFromQuaternion(tmpQuat);
      spotGeo.applyMatrix4(tmpMat);
      spotGeo.translate(x - n.x * sink, stemH + yLocal - n.y * sink, z - n.z * sink);
      const spotColor = spotBaseColor.clone().offsetHSL(
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 0.08
      );
      const spotMat = applyWindSway(
        new THREE.MeshStandardMaterial({ color: spotColor, roughness: 0.9 }),
        BIG_WIND
      );
      const spot = new THREE.Mesh(spotGeo, spotMat);
      g.add(spot);
    }
    addGroveMushroomFamily(g, biome, { radius: 1.15, count: 4, capY: stemH });
    return g;
  },

  fairyring(biome) {
    const g = new THREE.Group();
    const stumpMat = new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true, roughness: 1 });
    const stump = new THREE.Mesh(
      jitterGeo(new THREE.CylinderGeometry(0.18, 0.24, 0.38, 8).translate(0, 0.19, 0), 0.025),
      stumpMat
    );
    stump.scale.set(1.2, 0.82, 0.9);
    stump.castShadow = true;
    g.add(stump);
    const hollow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.07, 0.018, 8).translate(0, 0.325, 0),
      new THREE.MeshStandardMaterial({ color: "#22150e", flatShading: true, roughness: 1 })
    );
    hollow.scale.set(1.25, 1, 0.8);
    g.add(hollow);

    const stemGeo = new THREE.CylinderGeometry(0.026, 0.04, 0.18, 5).translate(0, 0.09, 0);
    const capGeo = new THREE.SphereGeometry(0.09, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1.28, 0.72, 1.28)
      .translate(0, 0.18, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: "#f4e6c9", roughness: 0.95 });
    const undersideGeo = makeMushroomUndersideGeometry(0.09 * 1.28, 0.09 * 1.28, 0.18, 10);
    undersideGeo.name = "fairyring.underside.geo";
    const undersideMat = makeMushroomUndersideMaterial();
    const capBaseColor = new THREE.Color(biome.accent).lerp(new THREE.Color("#b85f2a"), 0.18);
    const mushrooms = 10 + Math.floor(Math.random() * 4);
    for (let i = 0; i < mushrooms; i++) {
      const a = (i / mushrooms) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
      const r = 0.9 + (Math.random() - 0.5) * 0.16;
      const scale = 0.75 + Math.random() * 0.55;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(x, 0, z);
      stem.scale.setScalar(scale);
      stem.castShadow = true;
      g.add(stem);
      const capColor = capBaseColor.clone().offsetHSL(
        (Math.random() - 0.5) * 0.06,
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.10
      );
      const cap = new THREE.Mesh(capGeo, enableMushroomCapShadowUnderside(makeMushroomCapPBRMaterial({
        color: capColor,
        roughness: 0.68,
      })));
      cap.position.set(x, 0, z);
      cap.rotation.y = a + Math.PI / 2;
      cap.scale.setScalar(scale);
      cap.castShadow = true;
      g.add(cap);
      const underside = new THREE.Mesh(undersideGeo, undersideMat);
      underside.position.set(x, 0, z);
      underside.rotation.y = cap.rotation.y;
      underside.scale.setScalar(scale);
      g.add(underside);
    }

    // Will-o-wisps replace the old static spores.
    // Store how many to spawn (1-3); the world placement code
    // creates the actual WillOWisp objects and parents them to
    // the scene so they can move independently.
    if (biome.groveDetails?.sporeGlow) {
      g.userData.willowispCount = 1 + Math.floor(Math.random() * 3);
    }

    g.userData.capTopY = 0.32;
    return g;
  },

  berrybush(biome) {
    const g = new THREE.Group();
    const castMicroShadow = shouldCastMicroFloraShadow(biome);

    // --- Leaf plates (layered dome, like the leafball tree but smaller/bushy) ---
    const leafMats = [
      pooled("berrybush.leaf.mat.shadow", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#2a5e2e"), 0.25),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.82,
            }),
            { tipLift: 0.22, baseShade: 0.25, veinShade: 0.18, sideShade: 0.24 }
          ),
          0.14
        )
      ),
      pooled("berrybush.leaf.mat.mid", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#5aad4a"), 0.28),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.78,
            }),
            { tipLift: 0.28, baseShade: 0.22, veinShade: 0.16, sideShade: 0.26 }
          ),
          0.16
        )
      ),
      pooled("berrybush.leaf.mat.light", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#72c462"), 0.18),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.82,
            }),
            { tipLift: 0.20, baseShade: 0.18, veinShade: 0.14, sideShade: 0.22 }
          ),
          0.15
        )
      ),
    ];

    // Wider, rounder leaf shape for bush foliage (not the teardrop leaf of the tree)
    const leafGeo = pooled("berrybush.leaf.geo", () =>
      buildLeafGeo({
        lengthSegs: 5,
        widthSegs: 3,
        length: 0.28,
        maxWidth: 0.165,
        minWidth: 0.005,
        profileExp: 0.55,
        taperEnd: null,
        centerLift: 0.028,
        centerLiftFade: 0.3,
        tipCurlStrength: 0.040,
        tipCurlExp: 1.3,
        edgeCurlStrength: 0.028,
      })
    );
    const leafOutlineGeo = pooled("berrybush.leaf.outline.geo", () => {
      const geo = leafGeo.clone();
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) * 1.08);
        pos.setZ(i, pos.getZ(i) - 0.004);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const leafOutlineMat = pooled("berrybush.leaf.outline.mat", () =>
      applyLeafPlateWind(
        new THREE.MeshBasicMaterial({
          name: "berrybush.leaf.outline.mat",
          color: "#0e1e12",
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
        0.14
      )
    );

    // Bush dome placement: hemisphere centered at (0, 0.30, 0)
    const bushCenter = new THREE.Vector3(0, 0.30, 0);
    const bushRadius = new THREE.Vector3(0.34, 0.28, 0.34);
    const up = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    const leafBuckets = leafMats.map(() => []);

    const orientLeaf = (leaf, normal, shingleLift = 0.08) => {
      const tangentDown = up.clone().sub(normal.clone().multiplyScalar(up.dot(normal)));
      if (tangentDown.lengthSq() < 0.0001) tangentDown.set(0, 0, 1);
      tangentDown.normalize().multiplyScalar(-1);
      const faceNormal = normal.clone().addScaledVector(tangentDown, shingleLift).normalize();
      const yAxis = tangentDown.clone().multiplyScalar(-1);
      const xAxis = yAxis.clone().cross(faceNormal).normalize();
      basis.makeBasis(xAxis, yAxis, faceNormal);
      leaf.quaternion.setFromRotationMatrix(basis);
    };

    // Dome rows — upper hemisphere only, tighter than the tree
    const addLeafRing = ({ count, phi, shell = 1, scale = 0.7, matIndex = 1, phase = 0, lift = 0.10 }) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + phase + (Math.random() - 0.5) * 0.06;
        const normal = new THREE.Vector3(
          Math.sin(phi) * Math.cos(a),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(a)
        ).normalize();
        const leaf = new THREE.Object3D();
        leaf.position.set(
          bushCenter.x + normal.x * bushRadius.x * shell,
          bushCenter.y + normal.y * bushRadius.y * shell,
          bushCenter.z + normal.z * bushRadius.z * shell
        );
        orientLeaf(leaf, normal, lift);
        leaf.rotateX(0.02 + lift * 0.15);
        leaf.rotateZ((Math.random() - 0.5) * 0.10);
        const s = scale * (0.90 + Math.random() * 0.20);
        scaleVec.set(s * 0.96, s * 1.12, s);
        matrix.compose(leaf.position, leaf.quaternion, scaleVec);
        leafBuckets[matIndex].push(matrix.clone());
      }
    };

    // Cap cluster — tight rosette with tips converging at center.
    // Use orientLeaf with a tilted normal so the tangent is valid near the pole.
    const capCount = 4;
    const capY = bushCenter.y + bushRadius.y * 1.18;
    const capBaseR = 0.02;
    for (let i = 0; i < capCount; i++) {
      const a = (i / capCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.04;
      // Normal mostly up but tilted outward enough for a valid tangent
      const capNormal = new THREE.Vector3(
        Math.cos(a) * 0.35,
        1.0,
        Math.sin(a) * 0.35
      ).normalize();
      const leaf = new THREE.Object3D();
      leaf.position.set(
        bushCenter.x + Math.cos(a) * capBaseR,
        capY,
        bushCenter.z + Math.sin(a) * capBaseR
      );
      orientLeaf(leaf, capNormal, 0.44);
      const s = 0.45 * (0.92 + Math.random() * 0.16);
      scaleVec.set(s * 0.96, s * 1.12, s);
      matrix.compose(leaf.position, leaf.quaternion, scaleVec);
      leafBuckets[1].push(matrix.clone());
    }
    // Dome rings (upper hemisphere phi 0..PI/2)
    const rowCounts = [7, 9, 12, 12, 9, 13];
    for (let row = 0; row < rowCounts.length; row++) {
      const t = row / (rowCounts.length - 1);
      const phi = 0.20 + t * 1.35;
      const rowScale = 0.68 + Math.sin((1 - t) * Math.PI * 0.5) * 0.12;
      const matIndex = row === 0 ? 2 : row > 3 ? 0 : 1;
      const rowLift = row === 0 ? 0.28 : 0.18 - t * 0.08;
      addLeafRing({
        count: rowCounts[row],
        phi,
        shell: 1.05 - t * 0.08 + (Math.random() - 0.5) * 0.02,
        scale: rowScale,
        matIndex,
        phase: (row % 2) * (Math.PI / rowCounts[row]),
        lift: rowLift,
      });
    }

    // Instanced leaf batches
    for (let i = 0; i < leafBuckets.length; i++) {
      const outline = makeInstancedLeafBatch(leafOutlineGeo, leafOutlineMat, leafBuckets[i]);
      if (outline) {
        outline.castShadow = false;
        outline.renderOrder = -1;
        g.add(outline);
      }
    }
    for (let i = 0; i < leafBuckets.length; i++) {
      const leaves = makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i], castMicroShadow);
      if (leaves) g.add(leaves);
    }

    // --- Shiny berries with per-bush color variation ---
    // Pick a berry color variant per bush
    const BERRY_PALETTES = [
      { color: "#e63946", hsl: [0.98, 0.72, 0.45] },   // bright red
      { color: "#d62839", hsl: [0.97, 0.65, 0.40] },   // deep crimson
      { color: "#f4845f", hsl: [0.06, 0.80, 0.58] },   // coral-orange
      { color: "#9b2335", hsl: [0.95, 0.60, 0.32] },   // dark wine
      { color: "#ff6b6b", hsl: [0.0, 0.78, 0.62] },    // cherry pink
      { color: "#c1440e", hsl: [0.06, 0.72, 0.35] },   // burnt orange
      { color: "#8b1a4a", hsl: [0.92, 0.65, 0.30] },   // plum
      { color: "#e85d75", hsl: [0.95, 0.72, 0.55] },    // rose
    ];
    const berryVariant = BERRY_PALETTES[Math.floor(Math.random() * BERRY_PALETTES.length)];
    const berryBaseColor = new THREE.Color(berryVariant.color);

    const berryMat = pooled("berrybush.berry.mat." + berryVariant.color, () =>
      new THREE.MeshStandardMaterial({
        color: berryBaseColor,
        roughness: 0.18,
        metalness: 0.05,
      })
    );
    const berryGeo = pooled("berrybush.berry.geo", () => new THREE.SphereGeometry(0.028, 8, 6));

    // Place berries on the dome surface so they poke out between leaves.
    // Reject placements that overlap an existing berry (min center-to-center gap).
    const berryCount = 12 + Math.floor(Math.random() * 12);
    const berryR = 0.37; // just outside the leaf shell so berries read on the surface
    const minBerryGap = 0.15; // minimum distance between berry centers
    const berryPositions = [];
    for (let i = 0; i < berryCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = 0.1 + Math.random() * 1.47;
      const c = Math.cos(elev);
      const s = Math.sin(elev);
      const bx = Math.cos(a) * c * berryR;
      const by = 0.30 + s * berryR * 0.85;
      const bz = Math.sin(a) * c * berryR;
      // Skip if too close to an existing berry
      const tooClose = berryPositions.some(p =>
        (p.x - bx) ** 2 + (p.y - by) ** 2 + (p.z - bz) ** 2 < minBerryGap * minBerryGap
      );
      if (tooClose) continue;
      berryPositions.push({ x: bx, y: by, z: bz });
      const berry = new THREE.Mesh(berryGeo, berryMat);
      berry.position.set(bx, by, bz);
      const bs = 0.85 + Math.random() * 0.20;
      berry.scale.setScalar(bs);
      berry.castShadow = castMicroShadow;
      g.add(berry);
    }
    return g;
  },

  lantern(biome) {
    const g = new THREE.Group();
    const tetherH = 1.3 + Math.random() * 0.4;
    const tetherMat = pooled("lantern.tether.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, 0, 0.1),
        flatShading: true,
        roughness: 1,
      })
    );
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, tetherH, 4),
      tetherMat
    );
    tether.position.y = tetherH / 2;
    g.add(tether);
    const orbGeo = pooled("lantern.orb.geo", () => new THREE.IcosahedronGeometry(0.12, 1));
    const orbMat = pooled("lantern.orb.mat", () => {
      const glowCol = new THREE.Color(biome.accent);
      return new THREE.MeshStandardMaterial({
        color: glowCol,
        emissive: glowCol.clone().multiplyScalar(0.9),
        flatShading: true,
        roughness: 0.4,
      });
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = tetherH + 0.05;
    orb.layers.enable(BLOOM_LAYER);
    g.add(orb);
    const haloGeo = pooled("lantern.halo.geo", () => new THREE.IcosahedronGeometry(0.2, 1));
    const haloMat = pooled("lantern.halo.mat", () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(biome.accent),
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(orb.position);
    halo.layers.enable(BLOOM_LAYER);
    g.add(halo);
    return g;
  },

  coral(biome) {
    const g = new THREE.Group();
    const baseCol = new THREE.Color(biome.accent);
    const altCol = baseCol.clone().offsetHSL(0.04, -0.05, 0.1);
    const trunkMat = pooled("coral.trunk.mat", () =>
      new THREE.MeshStandardMaterial({
        color: baseCol.clone().offsetHSL(0, 0, -0.1),
        flatShading: true,
        roughness: 0.55,
      })
    );
    const baseGeo = pooled("coral.base.geo", () => new THREE.SphereGeometry(0.18, 8, 6));
    const base = new THREE.Mesh(baseGeo, trunkMat);
    base.position.y = 0.12;
    base.scale.set(1.1, 0.55, 1.1);
    base.castShadow = true;
    g.add(base);
    const branchMatBase = pooled("coral.branch.mat.base", () =>
      new THREE.MeshStandardMaterial({ color: baseCol, flatShading: true, roughness: 0.5 })
    );
    const branchMatAlt = pooled("coral.branch.mat.alt", () =>
      new THREE.MeshStandardMaterial({ color: altCol, flatShading: true, roughness: 0.5 })
    );
    const branches = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * Math.PI * 2 + Math.random() * 0.4;
      const len = 0.7 + Math.random() * 0.4;
      const branchMat = i % 2 === 0 ? branchMatBase : branchMatAlt;

      const branch = new THREE.Group();
      // anchor the branch group at the base, pointing along the group's local +Y
      branch.position.set(Math.cos(a) * 0.05, 0.15, Math.sin(a) * 0.05);
      // tilt outward — rotation is applied to the group, all children follow
      branch.rotation.z = Math.cos(a) * 0.55;
      branch.rotation.x = -Math.sin(a) * 0.55;
      g.add(branch);

      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.07, len, 5),
        branchMat
      );
      stalk.position.y = len / 2;
      stalk.castShadow = true;
      branch.add(stalk);

      // little blob at the tip — coral polyp, parented to the branch so it
      // tracks the rotated stalk's end.
      const tip = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(0.11, 0), 0.04),
        branchMat
      );
      tip.position.y = len + 0.02;
      tip.scale.set(1.2, 0.7, 1.2);
      tip.castShadow = true;
      branch.add(tip);

      // 2 tiny side blobs along the branch
      for (let k = 0; k < 2; k++) {
        const u = 0.4 + k * 0.3;
        const knob = new THREE.Mesh(
          new THREE.SphereGeometry(0.05 + Math.random() * 0.025, 6, 5),
          branchMat
        );
        knob.position.set(
          (Math.random() - 0.5) * 0.06,
          len * u,
          (Math.random() - 0.5) * 0.06
        );
        branch.add(knob);
      }
    }
    return g;
  },

  braincoral(biome) {
    const g = new THREE.Group();
    const baseCol = new THREE.Color(biome.accent).lerp(new THREE.Color("#fff0a8"), 0.28);
    const mat = pooled("braincoral.mat", () =>
      new THREE.MeshStandardMaterial({ color: baseCol, flatShading: true, roughness: 0.58 })
    );
    const grooveMat = pooled("braincoral.groove.mat", () =>
      new THREE.MeshStandardMaterial({
        color: baseCol.clone().offsetHSL(0, -0.08, -0.16),
        flatShading: true,
        roughness: 0.7,
      })
    );
    const lobes = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const r = 0.11 + Math.random() * 0.05;
      const lobe = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(r, 0), 0.025), mat);
      const ring = i === 0 ? 0 : 0.12 + Math.random() * 0.08;
      lobe.position.set(Math.cos(a) * ring, 0.12 + Math.random() * 0.05, Math.sin(a) * ring);
      lobe.scale.set(1.4, 0.65, 1.15);
      lobe.castShadow = true;
      g.add(lobe);
    }
    for (let i = 0; i < 4; i++) {
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.13 + i * 0.035, 0.008, 5, 24), grooveMat);
      ridge.rotation.x = Math.PI / 2;
      ridge.position.y = 0.22 + i * 0.005;
      ridge.scale.z = 0.55;
      g.add(ridge);
    }
    return g;
  },

  cupcoral(biome) {
    const g = new THREE.Group();
    const baseCol = new THREE.Color(biome.accent).offsetHSL(-0.05, -0.08, 0.08);
    const mat = pooled("cupcoral.mat", () =>
      new THREE.MeshStandardMaterial({
        color: baseCol,
        side: THREE.DoubleSide,
        flatShading: true,
        roughness: 0.55,
      })
    );
    const cups = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < cups; i++) {
      const h = 0.24 + Math.random() * 0.24;
      const top = 0.11 + Math.random() * 0.05;
      const bottom = top * 0.45;
      const a = (i / cups) * Math.PI * 2 + Math.random() * 0.35;
      const cup = new THREE.Group();
      cup.position.set(Math.cos(a) * 0.13, h / 2, Math.sin(a) * 0.13);
      cup.rotation.z = Math.cos(a) * 0.18;
      cup.rotation.x = -Math.sin(a) * 0.18;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 8, 1, true), mat);
      wall.castShadow = true;
      cup.add(wall);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(top * 0.92, 0.014, 5, 18), mat);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = h / 2;
      cup.add(lip);
      g.add(cup);
    }
    return g;
  },

  balloontree(biome) {
    const g = new THREE.Group();
    const trunkH = 1.1 + Math.random() * 0.5;
    const trunkMat = biome.cloudlike
      ? pooled("balloontree.trunk.cloud.mat", () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color("#e1e8f8"),
          flatShading: false,
          roughness: 0.88,
        })
      )
      : pooled("balloontree.trunk.mat", () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.cliff).offsetHSL(0, 0, 0.15),
          flatShading: true,
          roughness: 1,
        })
      );
    const trunkTopR = biome.cloudlike ? 0.032 : 0.07;
    const trunkBaseR = biome.cloudlike ? 0.052 : 0.1;
    const trunkSegments = biome.cloudlike ? 8 : 6;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkTopR, trunkBaseR, trunkH, trunkSegments),
      trunkMat
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);
    if (biome.cloudlike) {
      const ribbonMat = pooled("balloontree.trunk.ribbon.cloud.mat", () =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color("#f7fbff"),
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
        })
      );
      for (const side of [-1, 1]) {
        const ribbon = new THREE.Mesh(
          new THREE.PlaneGeometry(0.012, trunkH * 0.94, 1, 3),
          ribbonMat
        );
        ribbon.position.set(side * trunkTopR * 0.72, trunkH * 0.52, 0.002);
        ribbon.rotation.y = side * 0.18;
        g.add(ribbon);
      }
    }
    const puffMat = pooled("balloontree.puff.mat", () =>
      applyBalloonPuffWisps(
        applyWindSway(
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(biome.ground[2]).lerp(new THREE.Color("#ffffff"), 0.6),
            flatShading: false,
            roughness: 0.95,
          }),
          0.3
        ),
        biome.cloudlike ? 1.08 : 0.48
      )
    );
    const puffs = biome.cloudlike ? 7 + Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < puffs; i++) {
      const r = biome.cloudlike ? 0.22 + Math.random() * 0.34 : 0.32 + Math.random() * 0.18;
      const puff = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.12),
        puffMat
      );
      const a = (i / puffs) * Math.PI * 2;
      const ring = 0.2 + Math.random() * 0.15;
      puff.position.set(
        Math.cos(a) * ring,
        trunkH + 0.1 + Math.random() * 0.25,
        Math.sin(a) * ring
      );
      puff.castShadow = true;
      g.add(puff);
    }
    // crowning puff
    const crown = new THREE.Mesh(
      jitterGeo(new THREE.IcosahedronGeometry(0.45, 1), 0.055),
      puffMat
    );
    crown.position.y = trunkH + 0.5;
    crown.castShadow = true;
    g.add(crown);
    const detailPuffs = biome.cloudlike ? 8 + Math.floor(Math.random() * 5) : 0;
    if (detailPuffs) {
      const detailPuffMat = pooled("balloontree.puff.detail.mat", () =>
        applyBalloonPuffWisps(
          applyWindSway(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color("#ffffff"),
              flatShading: false,
              roughness: 0.9,
              transparent: true,
              opacity: 0.82,
            }),
            0.34
          ),
          1.18
        )
      );
      const tetherMat = pooled("balloontree.tether.cloud.mat", () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color("#f5f9ff"),
          flatShading: false,
          roughness: 0.86,
        })
      );
      const yAxis = new THREE.Vector3(0, 1, 0);
      const tetherRoot = new THREE.Vector3(0, trunkH * 0.92, 0);
      for (let i = 0; i < detailPuffs; i++) {
        const r = 0.055 + Math.random() * 0.055;
        const puff = new THREE.Mesh(
          jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.08),
          detailPuffMat
        );
        const a = (i / detailPuffs) * Math.PI * 2 + Math.random() * 0.32;
        const ring = 0.18 + Math.random() * 0.38;
        puff.position.set(
          Math.cos(a) * ring,
          trunkH + 0.34 + Math.random() * 0.56,
          Math.sin(a) * ring
        );
        puff.castShadow = true;
        g.add(puff);

        const tetherEnd = puff.position.clone();
        const tetherDelta = tetherEnd.clone().sub(tetherRoot);
        const tetherLength = tetherDelta.length();
        const tether = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.004, tetherLength, 5),
          tetherMat
        );
        tether.position.copy(tetherRoot).add(tetherEnd).multiplyScalar(0.5);
        tether.quaternion.setFromUnitVectors(yAxis, tetherDelta.normalize());
        g.add(tether);
      }
    }
    const satellitePuffs = biome.cloudlike ? 5 + Math.floor(Math.random() * 4) : 0;
    for (let i = 0; i < satellitePuffs; i++) {
      const r = 0.12 + Math.random() * 0.12;
      const puff = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.10),
        puffMat
      );
      const a = Math.random() * Math.PI * 2;
      const ring = 0.34 + Math.random() * 0.22;
      puff.position.set(
        Math.cos(a) * ring,
        trunkH + 0.32 + Math.random() * 0.46,
        Math.sin(a) * ring
      );
      puff.castShadow = true;
      g.add(puff);
    }
    return g;
  },

  lavafissure(biome) {
    const g = new THREE.Group();
    const ember = new THREE.Color(biome.accent);
    const hot = new THREE.Color("#ffd166");
    const rim = new THREE.Color("#000000");
    const ribbonMat = pooled("lavafissure.ribbon.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uRim: { value: rim },
          uLava: { value: ember.clone().lerp(hot, 0.25) },
          uCore: { value: hot },
        },
        vertexShader: `
          attribute float aAcross;
          attribute float aAlong;
          attribute float aHeat;
          varying float vAcross;
          varying float vAlong;
          varying float vHeat;
          void main() {
            vAcross = abs(aAcross);
            vAlong = aAlong;
            vHeat = aHeat;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          precision highp float;
          uniform vec3 uRim;
          uniform vec3 uLava;
          uniform vec3 uCore;
          varying float vAcross;
          varying float vAlong;
          varying float vHeat;
          float hash(float n) { return fract(sin(n) * 43758.5453123); }
          void main() {
            float edge = smoothstep(0.62, 0.92, vAcross);
            float redBand = smoothstep(0.0084375, 0.285, vAcross);
            float coreMask = 1.0 - smoothstep(0.00625, 0.01875, vAcross);
            float flicker = 0.82 + 0.18 * hash(floor(vAlong * 34.0) + vHeat * 19.0);
            vec3 redGlow = uLava * vec3(0.95, 0.28, 0.16);
            vec3 lava = mix(uCore, redGlow * flicker, redBand);
            vec3 col = mix(lava, uRim, edge);
            float alpha = smoothstep(1.0, 0.92, vAcross);
            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    const pointCount = 18 + Math.floor(Math.random() * 8);
    const totalLen = 3.4 + Math.random() * 1.2;
    const step = totalLen / (pointCount - 1);
    const centers = [];
    let wanderZ = (Math.random() - 0.5) * 0.08;
    for (let i = 0; i < pointCount; i++) {
      if (i > 0) wanderZ += (Math.random() - 0.5) * 0.42;
      centers.push({
        x: -totalLen * 0.5 + step * i,
        z: Math.max(-0.85, Math.min(0.85, wanderZ)),
        halfW: 0.144 + Math.random() * 0.063,
        heat: Math.random(),
      });
    }

    const across = [-1, -0.72, -0.38, -0.14, 0, 0.14, 0.38, 0.72, 1];
    const positions = [];
    const acrossAttr = [];
    const alongAttr = [];
    const heatAttr = [];
    for (let i = 0; i < pointCount; i++) {
      const prev = centers[Math.max(0, i - 1)];
      const next = centers[Math.min(pointCount - 1, i + 1)];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const tl = Math.max(0.001, Math.sqrt(tx * tx + tz * tz));
      const nx = -tz / tl;
      const nz = tx / tl;
      const taper = Math.sin((i / (pointCount - 1)) * Math.PI);
      const halfW = centers[i].halfW * taper;
      for (const a of across) {
        positions.push(
          centers[i].x + nx * a * halfW,
          0.07,
          centers[i].z + nz * a * halfW
        );
        acrossAttr.push(a);
        alongAttr.push(i / (pointCount - 1));
        heatAttr.push(centers[i].heat);
      }
    }

    const cols = across.length;
    const indices = [];
    for (let i = 0; i < pointCount - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = a + 1;
        const c = (i + 1) * cols + j;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    g.userData.fissureObstaclePoints = centers.map(({ x, z, halfW }) => ({
      x,
      z,
      r: Math.max(0.22, halfW * 1.5),
    }));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("aAcross", new THREE.BufferAttribute(new Float32Array(acrossAttr), 1));
    geo.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array(alongAttr), 1));
    geo.setAttribute("aHeat", new THREE.BufferAttribute(new Float32Array(heatAttr), 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const ribbon = new THREE.Mesh(geo, ribbonMat);
    ribbon.userData.surfaceLift = 0.07;
    ribbon.userData.surfaceConformVertices = true;
    ribbon.layers.enable(BLOOM_LAYER);
    g.add(ribbon);
    return g;
  },

  obsidianglass() {
    const g = new THREE.Group();
    const glassGeo = pooled("obsidianglass.fin.geo", () => {
      const geo = new THREE.ConeGeometry(0.22, 1, 5, 1);
      geo.scale(0.74, 1, 0.14);
      geo.translate(0, 0.5, 0);
      return geo;
    });
    const glassMat = pooled("obsidianglass.glass.mat", () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#020204"),
        emissive: new THREE.Color("#000000"),
        flatShading: true,
        roughness: 0.035,
        metalness: 0.88,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        specularIntensity: 1.0,
        specularColor: new THREE.Color("#b9c7d8"),
        reflectivity: 1.0,
      })
    );
    const fins = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < fins; i++) {
      const a = (i / fins) * Math.PI * 2 + Math.random() * 0.34;
      const height = 0.42 + Math.random() * 0.78;
      const off = 0.03 + Math.random() * 0.22;
      const fin = new THREE.Mesh(glassGeo, glassMat);
      fin.position.set(Math.cos(a) * off, 0.015, Math.sin(a) * off);
      fin.scale.set(0.55 + Math.random() * 0.34, height, 0.72 + Math.random() * 0.28);
      fin.rotation.order = "YXZ";
      fin.rotation.y = a + Math.PI * 0.5;
      fin.rotation.x = -Math.sin(a) * (0.18 + Math.random() * 0.24);
      fin.rotation.z = Math.cos(a) * (0.18 + Math.random() * 0.28);
      fin.castShadow = true;
      g.add(fin);
    }
    const base = new THREE.Mesh(
      pooled("obsidianglass.base.geo", () => jitterGeo(new THREE.IcosahedronGeometry(0.22, 0), 0.05)),
      glassMat
    );
    base.scale.set(1.35, 0.28, 1.05);
    base.position.y = 0.04;
    base.rotation.y = Math.random() * Math.PI * 2;
    base.castShadow = true;
    g.add(base);
    g.userData.inspect = { category: "flora", variant: "obsidianglass" };
    return g;
  },

  obsidianshard(biome) {
    const g = new THREE.Group();
    const ember = new THREE.Color(biome.accent);
    const glassMat = pooled("obsidianshard.glass.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#0d0a14"),
        emissive: ember.clone().multiplyScalar(0.18),
        flatShading: true,
        roughness: 0.25,
        metalness: 0.35,
      })
    );
    const shards = 3 + Math.floor(Math.random() * 3); // 3–5
    for (let i = 0; i < shards; i++) {
      const r = 0.1 + Math.random() * 0.13;
      const shard = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        glassMat
      );
      const a = (i / shards) * Math.PI * 2 + Math.random() * 0.4;
      const off = 0.04 + Math.random() * 0.1;
      shard.position.set(
        Math.cos(a) * off,
        r * (0.85 + Math.random() * 1.5),
        Math.sin(a) * off
      );
      shard.scale.set(0.5, 1.6 + Math.random() * 0.8, 0.5);
      shard.rotation.y = Math.random() * Math.PI * 2;
      shard.rotation.z = (Math.random() - 0.5) * 0.4;
      shard.castShadow = true;
      shard.layers.enable(BLOOM_LAYER);
      g.add(shard);
    }
    // warm halo near the base — small additive sphere reading as crack-light
    const haloGeo = pooled("obsidianshard.halo.geo", () => new THREE.IcosahedronGeometry(0.18, 1));
    const haloMat = pooled("obsidianshard.halo.mat", () =>
      new THREE.MeshBasicMaterial({
        color: ember,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = 0.05;
    halo.scale.set(1.2, 0.4, 1.2);
    halo.layers.enable(BLOOM_LAYER);
    g.add(halo);
    return g;
  },
};
