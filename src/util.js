import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { state } from "./state.js";

export const TRUNK = new THREE.Color("#3a2818");

export function jitterGeo(geo, amount = 0.05) {
  // IcosahedronGeometry stores 3 different UVs and normals per face-corner
  // even when positions coincide. mergeVertices hashes all attributes, so
  // those per-face UVs prevent welding. Strip them so the merge is by
  // position alone, then recompute normals after we've perturbed.
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  const welded = mergeVertices(geo, 1e-4);
  geo.dispose();
  const p = welded.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) + (Math.random() - 0.5) * amount);
    p.setY(i, p.getY(i) + (Math.random() - 0.5) * amount);
    p.setZ(i, p.getZ(i) + (Math.random() - 0.5) * amount);
  }
  welded.computeVertexNormals();
  return welded;
}

export function applyWindSway(material, strength = 1.0) {
  // Chain any prior onBeforeCompile so multiple patches on the same material
  // compose cleanly. `prev` is the previous handler captured before reassign;
  // it's necessarily a different function than the closure we install below.
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uWindStrength = { value: strength };
    shader.uniforms.uFoliageWind = state.windUniforms.uFoliageWind;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uWindStrength;\nuniform float uFoliageWind;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float windY = max(transformed.y, 0.0);
          float windAmp = windY * windY * uWindStrength * uFoliageWind;
          // World-space wind: noise is sampled in world coords so neighbouring
          // instances bend coherently. For InstancedMesh with random per-instance
          // Y yaw (wildflowers, etc.) the world-space bend has to be inverse-
          // rotated through the instance's XZ basis before being added to the
          // mesh-local transformed.xz — otherwise each yawed instance bends
          // along its own rotated local-X and the field reads as random
          // motion instead of "wind blowing through." Same trick the grass
          // shader uses.
          #ifdef USE_INSTANCING
            vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
            vec2 axW = vec2(instanceMatrix[0].x, instanceMatrix[0].z);
            vec2 azW = vec2(instanceMatrix[2].x, instanceMatrix[2].z);
            float invXZScaleSq = 1.0 / max(dot(axW, axW), 1e-6);
          #else
            vec4 wp = modelMatrix * vec4(transformed, 1.0);
            vec2 axW = vec2(1.0, 0.0);
            vec2 azW = vec2(0.0, 1.0);
            float invXZScaleSq = 1.0;
          #endif
          float w1 = sin(uTime * 1.4 + wp.x * 0.30 + wp.z * 0.40);
          float w2 = sin(uTime * 0.9 + wp.x * 0.15 - wp.z * 0.25);
          vec2 windWorld = vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05);
          transformed.x += dot(axW, windWorld) * invXZScaleSq;
          transformed.z += dot(azW, windWorld) * invXZScaleSq;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}

export function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Build a curved leaf BufferGeometry from a parametric grid.
 * Used by leafballtree, berrybush, and any other flora with flat leaf plates.
 *
 * @param {Object} opts
 * @param {number} opts.lengthSegs - Subdivisions along leaf length
 * @param {number} opts.widthSegs - Subdivisions across leaf width
 * @param {number} opts.length - Total leaf length (mapped to Y axis)
 * @param {number} opts.maxWidth - Maximum half-width of the leaf
 * @param {number} opts.minWidth - Minimum half-width before clamping
 * @param {number} opts.profileExp - Exponent for sin-based width profile
 * @param {number} [opts.taperEnd] - Width taper toward tip (0 = none)
 * @param {number} opts.centerLift - Center rises more than edges
 * @param {number} opts.centerLiftFade - How fast center lift fades toward tip
 * @param {number} opts.tipCurlStrength - Amount of forward curl at the tip
 * @param {number} opts.tipCurlExp - Exponent for tip curl falloff
 * @param {number} opts.edgeCurlStrength - Amount of edge curl inward
 */
export function buildLeafGeo({
  lengthSegs = 7,
  widthSegs = 4,
  length = 0.42,
  maxWidth = 0.165,
  minWidth = 0.006,
  profileExp = 0.72,
  taperEnd = 0.16,
  centerLift = 0.010,
  centerLiftFade = 0.35,
  tipCurlStrength = 0.060,
  tipCurlExp = 1.45,
  edgeCurlStrength = 0.010,
} = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= lengthSegs; iy++) {
    const v = iy / lengthSegs;
    const profile = Math.sin(Math.PI * v) ** profileExp;
    const taper = taperEnd != null ? (1 - v * taperEnd) : 1;
    const halfWidth = Math.max(minWidth, maxWidth * profile * taper);
    for (let ix = 0; ix <= widthSegs; ix++) {
      const u = ix / widthSegs;
      const side = u * 2 - 1;
      const cl = (1 - Math.abs(side)) * centerLift * (1 - v * centerLiftFade);
      const tc = tipCurlStrength * v ** tipCurlExp;
      const ec = -Math.abs(side) * edgeCurlStrength * Math.sin(Math.PI * v);
      positions.push(side * halfWidth, -v * length, tc + cl + ec);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < lengthSegs; iy++) {
    for (let ix = 0; ix < widthSegs; ix++) {
      const a = iy * (widthSegs + 1) + ix;
      const b = a + 1;
      const c = a + widthSegs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
