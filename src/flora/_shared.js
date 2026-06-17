// Shared flora helpers and the per-regen resource pool.
//
// This module owns the SINGLE flora pool instance. Every per-kind flora
// builder module imports `pooled` (the get-or-create factory) and
// `resetFloraPool` from here, so `resetFloraPool()` (called at the top of
// every generateWorld by way of src/flora.js) resets the same pool the
// builders use. Pool contract: only resources fully derived from the biome
// (no per-instance Math.random) are safe to pool, and reset() MUST run every
// regen — pooled handles are disposed when the previous world's group is
// torn down, so a stale get() would return disposed objects.
import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo, TRUNK } from "../util.js";
import { BLOOM_LAYER } from "../postfx.js";
import { makePool } from "../pool.js";
import {
  makeMushroomCapPBRMaterial,
  makeMushroomUndersideMaterial,
} from "../pbr.js";

// Cactus needles. Each spine is a real little cone mesh sitting on the
// capsule's surface, oriented along the outward normal — the shell-fur
// approach we use for fuzzy creatures renders frosted square columns at
// sparse densities, which reads as ice crystals rather than thin spikes.
// One InstancedMesh per cactus part keeps the draw count down (a single
// 3-arm cactus is at most 3 draws regardless of needle count).
const NEEDLE_TIP_COLOR = new THREE.Color("#f5ead0");
const NEEDLE_LENGTH = 0.085;
const NEEDLE_DENSITY = 95; // needles per local-unit² of capsule surface area
export function addCapsuleNeedles(parent, radius, length) {
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
export const pooled = _floraPool.get;

export function applyLeafPlateWind(material, strength = 0.16) {
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

export function applyLeafPlateGradient(
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

export function applySporeDrift(material, strength = 0.035) {
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

export function applyBalloonPuffWisps(material, strength = 0.34) {
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

export function applyDandylionHeadWind(material, strength, headY) {
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

export function makeInstancedLeafBatch(geometry, material, matrices, castShadow = true) {
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

export function shouldCastMicroFloraShadow(biome) {
  return biome.shadowLod?.microFloraShadows !== false;
}

export function shouldUseLeafballCanopyShadowProxy(biome) {
  return biome.shadowLod?.leafballCanopyProxy === true;
}

export function makeLeafballCanopyShadowProxy(canopyCenter, canopyRadius) {
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

export function getLeafballTreePalette(biome) {
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

export function getLeafballOutlineColor(leaves, trunk) {
  return new THREE.Color(leaves[0])
    .lerp(new THREE.Color(trunk), 0.34)
    .offsetHSL(0.0, -0.05, -0.18);
}

export function getFlyerNestPalette(biome) {
  const ground0 = new THREE.Color(biome.ground[0]);
  const ground1 = new THREE.Color(biome.ground[1] ?? biome.ground[0]);
  const ground2 = new THREE.Color(biome.ground[2] ?? biome.ground[1] ?? biome.ground[0]);
  const cliff = new THREE.Color(biome.cliff);
  const accent = new THREE.Color(biome.accent ?? biome.sun ?? biome.cliff);
  const base = cliff.clone().lerp(ground0, 0.48).lerp(ground1, biome.cloudlike ? 0.28 : 0.12);
  const light = ground2.clone().lerp(accent, biome.cloudlike ? 0.40 : 0.20).lerp(base, 0.38);
  return { base, light };
}

export function getDandylionFloraPalette(biome) {
  const ground0 = new THREE.Color(biome.ground[0]);
  const ground1 = new THREE.Color(biome.ground[1] ?? biome.ground[0]);
  const ground2 = new THREE.Color(biome.ground[2] ?? biome.ground[1] ?? biome.ground[0]);
  const cliff = new THREE.Color(biome.cliff);
  return {
    stem: ground0.clone().lerp(cliff, 0.32).offsetHSL(0, -0.04, -0.02),
    leaf: ground1.clone().lerp(ground2, 0.38).offsetHSL(0, 0.04, 0.00),
  };
}

export function makeMushroomStemGeometry(
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

export function makeMushroomUndersideGeometry(
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

export function enableMushroomCapShadowUnderside(material) {
  material.shadowSide = THREE.DoubleSide;
  return material;
}

export function addGroveMushroomFamily(group, biome, { radius = 0.44, count = 3, capY = 0.35 } = {}) {
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

export function addPillarSurfaceMarks(drum, topRadius, bottomRadius, height, baseColor) {
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

export function makePlainRockGeometry(radius, { shoulder = false } = {}) {
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
