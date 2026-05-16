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
varying vec3 vPos;
varying float vLayerT;
varying vec3 vNormal;
void main() {
  vLayerT = uShellLayer / uLayers;
  vec3 p = position + normal * uFurLength * vLayerT;
  // Pass the ORIGINAL (un-displaced) position so the fragment shader can
  // compute a stable per-cell hash that matches across all shells — that's
  // what makes a single hair appear as one column running through every
  // layer instead of disconnected stripes.
  vPos = position;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const _furFS = `
precision highp float;
uniform vec3 uBaseColor;
uniform vec3 uTipColor;
uniform vec3 uLightDir;
uniform vec3 uStripeColor;
uniform float uStripeBandCount;
uniform float uStripeBandWidth;
uniform float uStripeOffset;
uniform float uPatternType;  // 0=none, 1=stripes, 2=spots, 3=patches
uniform float uPatternScale;
varying vec3 vPos;
varying float vLayerT;
varying vec3 vNormal;

// 3D point hash — irrational multipliers in each axis decorrelate the
// output so adjacent cells get visually random values. Returns [0, 1].
float hash13(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

// Value noise for smooth patches.
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1,0,0));
  float c = hash13(i + vec3(0,1,0));
  float d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1));
  float f2 = hash13(i + vec3(1,0,1));
  float g = hash13(i + vec3(0,1,1));
  float h = hash13(i + vec3(1,1,1));
  return mix(
    mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
    mix(mix(e, f2, f.x), mix(g, h, f.x), f.y),
    f.z
  );
}

void main() {
  vec3 cell = floor(vPos * 80.0);
  float h = hash13(cell);
  float threshold = 0.0 + vLayerT * 0.70;
  if (h < threshold) discard;
  vec3 N = normalize(vNormal);
  float lam = max(0.0, dot(N, normalize(uLightDir)));

  vec3 baseCol = uBaseColor;
  float patType = floor(uPatternType + 0.5);

  if (patType > 0.5) {
    float scale = uPatternScale > 0.5 ? uPatternScale : 6.0;

    if (patType < 1.5) {
      // Stripes — continuous bands along the Z axis
      float z = vPos.z + uStripeOffset;
      float period = 1.0 / uStripeBandCount;
      float phase = mod(z, period);
      float halfBand = uStripeBandWidth * period * 0.5;
      if (phase < halfBand || phase > period - halfBand) {
        baseCol = uStripeColor;
      }
    } else if (patType < 2.5) {
      // Spots — scattered discs using a grid of random centres
      vec3 sp = vPos * scale;
      vec3 cell3 = floor(sp);
      float rnd = hash13(cell3 + 0.5);
      vec3 centre = cell3 + vec3(
        fract(rnd * 127.1),
        fract(rnd * 269.5),
        fract(rnd * 419.2)
      );
      float d = length(sp - centre);
      if (d < uStripeBandWidth * 0.55) {
        baseCol = uStripeColor;
      }
    } else {
      // Patches — smooth noise threshold for organic blobs
      float n = noise3(vPos * scale * 0.5 + uStripeOffset);
      if (n > (1.0 - uStripeBandWidth)) {
        baseCol = uStripeColor;
      }
    }
  }

  vec3 c = mix(baseCol, uTipColor, vLayerT);
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
      uStripeColor: { value: new THREE.Color(0xffd13b) },
      uStripeBandCount: { value: 0.0 },
      uStripeBandWidth: { value: 0.0 },
      uStripeOffset: { value: 0.0 },
      uPatternType: { value: 0.0 },
      uPatternScale: { value: 6.0 },
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
    // Pattern uniforms — all shells share the same pattern
    if (opts.patternColor) {
      mat.uniforms.uStripeColor = { value: new THREE.Color(opts.patternColor) };
    } else if (opts.stripeColor) {
      mat.uniforms.uStripeColor = { value: new THREE.Color(opts.stripeColor) };
    }
    if (opts.patternType) {
      mat.uniforms.uPatternType = { value: opts.patternType };
      mat.uniforms.uPatternScale = { value: opts.patternScale ?? 6.0 };
    }
    if (opts.stripeBandCount != null) {
      mat.uniforms.uStripeBandCount = { value: opts.stripeBandCount };
    }
    if (opts.stripeBandWidth != null) {
      mat.uniforms.uStripeBandWidth = { value: opts.stripeBandWidth };
    }
    if (opts.stripeOffset != null) {
      mat.uniforms.uStripeOffset = { value: opts.stripeOffset };
    }
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
