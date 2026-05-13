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
