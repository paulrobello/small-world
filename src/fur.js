import * as THREE from "three";
import { LOWFX } from "./lowfx.js";

// One material instance shared across every fur shell across every fuzzy
// creature in the world. Per-shell uniforms (uShellLayer) live on a clone, so
// they don't fight each other; the rest of the uniforms are shared via
// reference and updated once per frame from main.js.
//
// ShaderMaterial.clone() runs `UniformsUtils.clone(uniforms)`, which DEEP-
// clones — each value gets a fresh wrapper object and inner Vector3/Color
// values are .clone()'d. That breaks the shared-reference behavior we want
// for uLayers / uLightDir, so the consumer (applyShellFur) explicitly
// re-binds those two uniforms back to the shared sharedFurUniforms refs
// after the clone. uShellLayer is intentionally left as a per-shell value.

const _furVS = `
uniform float uShellLayer;
uniform float uLayers;
uniform float uFurLength;
uniform float uHasVertexColor;
varying vec3 vPos;
varying float vLayerT;
varying vec3 vNormal;
varying vec3 vBodyColor;
attribute vec3 color;
void main() {
  vLayerT = uShellLayer / uLayers;
  vec3 p = position + normal * uFurLength * vLayerT;
  vPos = position;
  vNormal = normalMatrix * normal;
  // Inherit vertex colors from the body geometry when present
  // (e.g. bumblebee stripes). The attribute is always declared so the
  // shader compiles; uHasVertexColor gates whether it's actually used.
  vBodyColor = uHasVertexColor > 0.5 ? color : vec3(1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const _furFS = `
precision highp float;
uniform vec3 uBaseColor;
uniform vec3 uTipColor;
uniform vec3 uLightDir;
varying vec3 vPos;
varying float vLayerT;
varying vec3 vNormal;
varying vec3 vBodyColor;

// 3D point hash — irrational multipliers in each axis decorrelate the
// output so adjacent cells get visually random values. Returns [0, 1].
float hash13(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

void main() {
  // Sample a 3D grid in object space — cell size ~1/80 of a unit. The
  // floor() runs in the fragment so every fragment lands in a single
  // cell, giving point-distributed hairs instead of interpolated bands.
  vec3 cell = floor(vPos * 80.0);
  float h = hash13(cell);
  float threshold = 0.0 + vLayerT * 0.70;
  if (h < threshold) discard;
  vec3 N = normalize(vNormal);
  float lam = max(0.0, dot(N, normalize(uLightDir)));
  // Modulate base→tip gradient by the body vertex color so painted patterns
  // (e.g. bumblebee stripes) carry through into the fur.
  vec3 c = mix(uBaseColor * vBodyColor, uTipColor * vBodyColor, vLayerT);
  // flat lambert response — keep colour close to body PBR; avoid blowing out
  c *= 0.7 + 0.3 * lam;
  gl_FragColor = vec4(c, 1.0 - vLayerT * 0.35);
}
`;

// Shared uniforms (one object reference, mutated each frame).
export const sharedFurUniforms = {
  uLightDir: { value: new THREE.Vector3(1, 1, 1) },
  uLayers: { value: 8 },
};

// Build a fur material template. Clone()ing it gives per-shell instances
// that share the above uniforms (Three's ShaderMaterial.clone copies the
// uniforms object shallowly), and we then overwrite uShellLayer per clone.
function makeFurTemplate(baseColor, tipColor, furLength, hasVertexColor) {
  return new THREE.ShaderMaterial({
    vertexShader: _furVS,
    fragmentShader: _furFS,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      uShellLayer: { value: 0 },
      uLayers: sharedFurUniforms.uLayers,
      uFurLength: { value: furLength },
      uBaseColor: { value: baseColor.clone() },
      uTipColor: { value: tipColor.clone() },
      uLightDir: sharedFurUniforms.uLightDir,
      uHasVertexColor: { value: hasVertexColor ? 1.0 : 0.0 },
    },
  });
}

// Attach `layers` shell meshes as children of `body`. Returns the array of
// shells so the caller can store them (disposeGroup handles cleanup when
// state.world is rebuilt, since shells parent into the world via body).
export function applyShellFur(body, biome, opts = {}) {
  // Keep fur visible in LOWFX, but use a cheaper, shorter stack. The inspector
  // is often viewed full-size while the live world may auto-enter LOWFX on
  // smaller windows, so skipping fur entirely made the two modes disagree.
  const layers = opts.layers ?? (LOWFX ? 4 : 8);
  const furLength = opts.length ?? biome.furLength ?? (LOWFX ? 0.082 : 0.072);
  const hasVertexColor = !!(body.geometry && body.geometry.attributes && body.geometry.attributes.color);
  // When vertex colors are present, use white as base/tip so the vertex
  // colors pass through un-darkened (black base would zero out the pattern).
  const baseColor =
    opts.baseColor ?? (hasVertexColor
      ? new THREE.Color(0xffffff)
      : body.material && body.material.color
        ? body.material.color.clone()
        : new THREE.Color(0xffffff));
  const tipColor =
    opts.tipColor ?? (hasVertexColor
      ? new THREE.Color(0xffffff)
      : new THREE.Color(biome.furTip ?? biome.accent ?? "#ffffff"));

  sharedFurUniforms.uLayers.value = Math.max(sharedFurUniforms.uLayers.value, layers);

  const hasVertexColor = !!(body.geometry && body.geometry.attributes && body.geometry.attributes.color);
  const template = makeFurTemplate(baseColor, tipColor, furLength, hasVertexColor);
  const shells = [];
  for (let i = 1; i <= layers; i++) {
    const mat = template.clone();
    mat.uniforms.uShellLayer = { value: i };
    // Shared uniforms: re-bind so the clone reads the same object refs.
    mat.uniforms.uLayers = sharedFurUniforms.uLayers;
    mat.uniforms.uLightDir = sharedFurUniforms.uLightDir;
    const shell = new THREE.Mesh(body.geometry, mat);
    shell.userData.isFurShell = true;
    // Children of body inherit body's animated scale/rotation/squash.
    body.add(shell);
    shells.push(shell);
  }
  // Template was never added to the scene — release it.
  template.dispose();
  return shells;
}
