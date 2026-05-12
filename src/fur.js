import * as THREE from "three";
import { LOWFX } from "./lowfx.js";

// One material instance shared across every fur shell across every fuzzy
// creature in the world. Per-shell uniforms (uShellLayer) live on a clone, so
// they don't fight each other; the rest of the uniforms are shared via
// reference and updated once per frame from main.js.
//
// The shared uniforms object is mutated each frame; clone() preserves that
// reference automatically when we call material.clone() because ShaderMaterial
// clones uniforms shallowly.

const _furVS = `
uniform float uShellLayer;
uniform float uLayers;
uniform float uFurLength;
varying vec2 vHairUv;
varying float vLayerT;
varying vec3 vNormal;
void main() {
  vLayerT = uShellLayer / uLayers;
  vec3 p = position + normal * uFurLength * vLayerT;
  vHairUv = position.xy * 75.0 + position.zx * 50.0;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const _furFS = `
precision highp float;
uniform vec3 uBaseColor;
uniform vec3 uTipColor;
uniform vec3 uLightDir;
varying vec2 vHairUv;
varying float vLayerT;
varying vec3 vNormal;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float h = hash21(floor(vHairUv));
  float threshold = 0.62 + vLayerT * 0.34;
  if (h < threshold) discard;
  vec3 N = normalize(vNormal);
  float lam = max(0.0, dot(N, normalize(uLightDir)));
  vec3 c = mix(uBaseColor, uTipColor, vLayerT);
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
function makeFurTemplate(baseColor, tipColor, furLength) {
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
    },
  });
}

// Attach `layers` shell meshes as children of `body`. Returns the array of
// shells so the caller can store them (disposeGroup handles cleanup when
// state.world is rebuilt, since shells parent into the world via body).
export function applyShellFur(body, biome, opts = {}) {
  const layers = LOWFX ? 4 : (opts.layers ?? 8);
  const furLength = opts.length ?? 0.018;
  const baseColor =
    opts.baseColor ?? (body.material && body.material.color
      ? body.material.color.clone()
      : new THREE.Color(0xffffff));
  const tipColor =
    opts.tipColor ?? new THREE.Color(biome.furTip ?? biome.accent ?? "#ffffff");

  sharedFurUniforms.uLayers.value = Math.max(sharedFurUniforms.uLayers.value, layers);

  const template = makeFurTemplate(baseColor, tipColor, furLength);
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
