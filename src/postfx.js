import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";

// Selective bloom render layer. Meshes opted-in to bloom (glow eyes, glow
// flowers, crystal cores, lantern orbs, obsidian shards) call
// `mesh.layers.enable(BLOOM_LAYER)` at construction time. The post-fx pipeline
// then runs a second scene render with the camera limited to this layer; the
// bloom pass operates on that bloom-only image, and the result is added back
// onto the main render. This decouples bloom from luminance — lit
// cream/pastel creature bodies can be as bright as they like and still won't
// bloom because they don't carry this layer flag.
export const BLOOM_LAYER = 1;

// Custom output: sRGB OETF only, no tone-mapping. The standard OutputPass
// would apply ACES a second time on top of RenderPass's tone-mapped output,
// crushing very dark biomes (obsidian) to pure black. Tone-mapping is already
// applied by the renderer during RenderPass, so this pass only needs to do
// the linear → sRGB gamma encode for display.
const _srgbOutputShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    vec3 linearToSRGB(vec3 c) {
      // sRGB OETF, mirrors three's built-in sRGBTransferOETF
      vec3 lo = c * 12.92;
      vec3 hi = pow(c, vec3(1.0/2.4)) * 1.055 - 0.055;
      return mix(lo, hi, step(0.0031308, c));
    }
    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(linearToSRGB(t.rgb), t.a);
    }
  `,
};

// Separable 5-tap linear-sampling Gaussian for the bloom blur. Each tap
// between center and edge pairs two adjacent Gaussian samples by reading at
// their weighted midpoint, letting hardware bilinear filtering sum them in
// one fetch — same shape as a 9-tap kernel with ~half the fetches.
//
// Weights / base offsets derived from a 9-tap Gaussian (sigma ≈ 2):
//   center            : 0.227
//   pair (taps 1,2)   : combined 0.315, weighted offset ≈ 1.384
//   pair (taps 3,4)   : combined 0.070, weighted offset ≈ 3.229
//
// Offsets are multiplied by `uRadius` (in physical pixels) at draw time so
// the settings panel can scale the halo live. Weights stay sigma=2-shaped —
// stretching the offsets is mathematically a non-Gaussian kernel, but for
// tight isolated emissives the visual result is indistinguishable from a
// wider sigma.
function _blurShader(axis, radiusUniform) {
  const dirExpr = axis === "h" ? "vec2(px.x, 0.0)" : "vec2(0.0, px.y)";
  return {
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uStrength: { value: 1.0 },
      uRadius: radiusUniform,
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uStrength;
      uniform float uRadius;
      varying vec2 vUv;
      void main() {
        vec2 px = 1.0 / uResolution;
        vec2 d = ${dirExpr};
        vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227;
        c += texture2D(tDiffuse, vUv + d * 1.384 * uRadius).rgb * 0.315;
        c += texture2D(tDiffuse, vUv - d * 1.384 * uRadius).rgb * 0.315;
        c += texture2D(tDiffuse, vUv + d * 3.229 * uRadius).rgb * 0.070;
        c += texture2D(tDiffuse, vUv - d * 3.229 * uRadius).rgb * 0.070;
        gl_FragColor = vec4(c * uStrength, 1.0);
      }
    `,
  };
}

// Additive composite of the bloom-only blurred image on top of the main
// render. tBloom is the bloom composer's output (layer-1 scene blurred by
// UnrealBloomPass); when bloom is disabled the strength uniform is 0 and the
// shader passes through unchanged.
const _bloomCompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uStrength: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.001) { gl_FragColor = base; return; }
      vec3 bloom = texture2D(tBloom, vUv).rgb;
      gl_FragColor = vec4(base.rgb + bloom * uStrength, base.a);
    }
  `,
};

// Hybrid tilt-shift: blur radius is max(screen-Y band, depth-from-focus).
// 13-tap hexagonal-disc blur (center + 6 inner hex + 6 outer hex with the
// outer rotated 30°), with a per-pixel random rotation to dissolve any
// residual ring alignment into film-grain noise. Weights sum to exactly
// 1.0 so the in-focus band is pixel-identity (no color shift). Blur
// happens in *perceptual* (gamma-2.0) space — sqrt encode each tap,
// square-decode the average. Blurring in linear HDR lifts dark-on-light
// boundaries brighter than expected (a real "wash-out"); gamma-space
// blur matches how the eye expects soft edges to look.
const _tiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.55 },           // 0..1 screen-Y of sharp band
    uBandHalfWidth: { value: 0.10 },   // half-width of in-focus band (UV)
    uBandFalloff: { value: 0.18 },     // transition width above/below
    uFocusZ: { value: 20.0 },          // view-space distance to focus point
    uDepthHalfRange: { value: 6.0 },   // depth in-focus range (world units)
    uDepthFalloff: { value: 16.0 },    // transition width
    uBlurAmount: { value: 7.0 },       // peak blur radius in pixels
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 400.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform float uFocus;
    uniform float uBandHalfWidth;
    uniform float uBandFalloff;
    uniform float uFocusZ;
    uniform float uDepthHalfRange;
    uniform float uDepthFalloff;
    uniform float uBlurAmount;
    uniform float uCameraNear;
    uniform float uCameraFar;
    varying vec2 vUv;

    float readViewDist(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      // perspectiveDepthToViewZ inlined: returns negative viewZ in front of
      // camera. Sign-flipped here so larger = farther.
      float viewZ = (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * d - uCameraFar);
      return -viewZ;
    }

    // Gamma-2.0 perceptual encode/decode — cheap stand-in for sRGB OETF/EOTF
    // that's accurate enough for blur weighting and avoids 9× pow() per pixel.
    vec3 toGamma(vec3 c)   { return sqrt(max(c, 0.0)); }
    vec3 fromGamma(vec3 c) { return c * c; }

    void main() {
      float dy = abs(vUv.y - uFocus);
      float bandMask = smoothstep(uBandHalfWidth, uBandHalfWidth + uBandFalloff, dy);

      float dist = readViewDist(vUv);
      float dz = abs(dist - uFocusZ);
      float depthMask = smoothstep(uDepthHalfRange, uDepthHalfRange + uDepthFalloff, dz);

      float mask = max(bandMask, depthMask);
      float radius = mask * uBlurAmount;

      if (radius < 0.5) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 px = (1.0 / uResolution) * radius;
      // 13-tap hexagonal-disc blur: center + 6 inner hex (r=0.5) + 6 outer
      // hex (r=1.0, rotated 30°). Hex point distribution is rotationally
      // smoother than the old 4-cardinal + 4-diagonal pattern at the same
      // tap count. Per-pixel random rotation breaks any residual ring
      // alignment into film-grain noise rather than visible sample ghosts.
      float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      float cj = cos(jitter), sj = sin(jitter);
      mat2 rot = mat2(cj, -sj, sj, cj);
      vec3 g = vec3(0.0);
      g += toGamma(texture2D(tDiffuse, vUv).rgb) * 0.20;
      // inner hex, r = 0.5, weights 0.08 each → 0.48 total
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2( 0.5000,  0.0000) * px).rgb) * 0.08;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2( 0.2500,  0.4330) * px).rgb) * 0.08;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2(-0.2500,  0.4330) * px).rgb) * 0.08;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2(-0.5000,  0.0000) * px).rgb) * 0.08;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2(-0.2500, -0.4330) * px).rgb) * 0.08;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2( 0.2500, -0.4330) * px).rgb) * 0.08;
      // outer hex, r = 1.0, rotated 30°, weights 0.0533 each → 0.32 total
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2( 0.8660,  0.5000) * px).rgb) * 0.0533;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2( 0.0000,  1.0000) * px).rgb) * 0.0533;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2(-0.8660,  0.5000) * px).rgb) * 0.0533;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2(-0.8660, -0.5000) * px).rgb) * 0.0533;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2( 0.0000, -1.0000) * px).rgb) * 0.0533;
      g += toGamma(texture2D(tDiffuse, vUv + rot * vec2( 0.8660, -0.5000) * px).rgb) * 0.0535;

      gl_FragColor = vec4(fromGamma(g), 1.0);
    }
  `,
};

// Combined depth-driven effects: edge outlines, contact AO, and painterly
// far-field fog. Each strength uniform goes to 0 when its checkbox is off,
// so a single pass covers all three with one tDepth sample per neighbour.
const _depthFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 400.0 },
    uOutlineStrength: { value: 1.0 },    // 0..1
    uOutlineThickness: { value: 1.0 },   // px
    uAoStrength: { value: 1.0 },         // 0..1
    uAoRadius: { value: 4.0 },           // px
    uFogStrength: { value: 1.0 },        // 0..1
    uFogColor: { value: new THREE.Color(0x9fb6c4) },
    uFogNear: { value: 30.0 },           // world units — sharp here
    uFogFar: { value: 160.0 },           // fully fogged here
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uOutlineStrength;
    uniform float uOutlineThickness;
    uniform float uAoStrength;
    uniform float uAoRadius;
    uniform float uFogStrength;
    uniform vec3  uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    varying vec2 vUv;

    float linDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      float viewZ = (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * d - uCameraFar);
      return -viewZ;
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float depth = linDepth(vUv);
      vec2 px = 1.0 / uResolution;

      // ── outlines: sobel-on-linear-depth, normalized so close edges read
      // the same as distant ones. Skip the sky (far plane) — its depth
      // discontinuity to foreground would draw a hard line around the world.
      float skyMask = step(depth, uCameraFar * 0.95);
      if (uOutlineStrength > 0.001 && skyMask > 0.5) {
        float t = uOutlineThickness;
        float dL = linDepth(vUv + vec2(-t, 0.0) * px);
        float dR = linDepth(vUv + vec2( t, 0.0) * px);
        float dU = linDepth(vUv + vec2( 0.0,  t) * px);
        float dD = linDepth(vUv + vec2( 0.0, -t) * px);
        // Per-pixel scale: contrast as a fraction of local depth so far
        // objects don't out-edge near ones.
        float scale = max(depth, 0.1) * 0.04;
        float edge = (abs(dL - dR) + abs(dU - dD)) / scale;
        edge = clamp(edge - 1.0, 0.0, 1.0); // ignore mild slope, keep cliffs/silhouettes
        float k = edge * uOutlineStrength * 0.6;
        base.rgb *= (1.0 - k);
      }

      // ── contact AO: 6-tap ring of depth comparisons. If a neighbour is
      // closer to the camera than this fragment by more than a small
      // threshold, accumulate occlusion. Approximate, stylized, cheap.
      if (uAoStrength > 0.001 && skyMask > 0.5) {
        float r = uAoRadius;
        float occ = 0.0;
        // hex ring
        vec2 dirs[6];
        dirs[0] = vec2( 1.000,  0.000);
        dirs[1] = vec2( 0.500,  0.866);
        dirs[2] = vec2(-0.500,  0.866);
        dirs[3] = vec2(-1.000,  0.000);
        dirs[4] = vec2(-0.500, -0.866);
        dirs[5] = vec2( 0.500, -0.866);
        for (int i = 0; i < 6; i++) {
          float nd = linDepth(vUv + dirs[i] * r * px);
          float diff = depth - nd;
          // Only neighbours that are clearly closer count; clamp the upper
          // range so a giant depth gap (object vs sky) doesn't max out AO.
          occ += smoothstep(0.05, 0.6, diff);
        }
        occ /= 6.0;
        float k = occ * uAoStrength * 0.5;
        base.rgb *= (1.0 - k);
      }

      // ── painterly far-field fog: smoothstep mix toward uFogColor based
      // on linear view-distance. Augments the existing FogExp2 with a
      // tunable, more aggressive far-field tint. Gated on skyMask so it
      // doesn't smother distant sky-layer geometry (cloud sprites,
      // mountain backdrop) by replacing their color with fog tint.
      if (uFogStrength > 0.001 && skyMask > 0.5) {
        float f = smoothstep(uFogNear, uFogFar, depth) * uFogStrength;
        base.rgb = mix(base.rgb, uFogColor, f);
      }

      gl_FragColor = base;
    }
  `,
};

export function initPostFX(renderer, scene, camera) {
  // LOWFX never builds a composer — returns a stub that always reports off.
  if (LOWFX) {
    state.depthTexture = null;
    return {
      isActive: () => false,
      render: () => renderer.render(scene, camera),
      onResize: () => {},
      setBloom: () => {},
      setTiltShift: () => {},
      setSoftParticles: () => {},
      setOutline: () => {},
      setAo: () => {},
      setDepthFog: () => {},
      setDepthFogColor: () => {},
      updateTiltShiftFocus: () => {},
      setBloomRadius: () => {},
    };
  }

  const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const pixelRatio = renderer.getPixelRatio();

  // Bloom is rendered at full resolution because it shares its depth
  // attachment with the depth pre-pass (see bloomRT below) for proper depth
  // occlusion — bloom emissives behind opaque geometry get culled by depth
  // test rather than shining through. Shared depth attachments require
  // matching dimensions, so we cannot downscale the bloom RT. The cost is
  // bounded: layer-filtering means only emissive meshes get rasterized.

  // Depth pre-pass RT, kept OUTSIDE the composer's ping-pong. Sampling a
  // depth texture while writing to the FBO that owns it is a feedback loop
  // (WebGL undefined behaviour → all-black output). We render the scene
  // once into depthRT to capture color + depth, then the composer chain
  // reads from depthRT.texture and samples depthTexture as a regular
  // sampler without conflict.
  const depthTexture = new THREE.DepthTexture(
    Math.max(1, Math.round(size.x * pixelRatio)),
    Math.max(1, Math.round(size.y * pixelRatio))
  );
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;

  const depthRT = new THREE.WebGLRenderTarget(
    Math.max(1, Math.round(size.x * pixelRatio)),
    Math.max(1, Math.round(size.y * pixelRatio)),
    { depthBuffer: true, depthTexture }
  );

  // Expose for consumers (environment.js soft particles).
  state.depthTexture = depthTexture;

  // Bloom-only composer. The camera is layer-filtered to BLOOM_LAYER for
  // the bloom render (see the render() body) so only emissive meshes
  // rasterize. RT is UnsignedByte (not the EffectComposer default
  // HalfFloat) — HalfFloat is ~2× the bandwidth per sample on integrated
  // GPUs and bloom doesn't need HDR (emissives are near-1.0 already).
  // depthTexture is shared with the depth pre-pass: the bloom render runs
  // with autoClearDepth=false (see render() body) so the scene depth from
  // the pre-pass is preserved, and emissives' depthTest culls anything
  // behind opaque geometry. EffectComposer.clone()s the RT for its
  // ping-pong RT2, which would clone the depth attachment too — we then
  // re-point RT2's depthTexture back to the shared one so the final blur
  // pass (which writes into RT2 or RT1 depending on pass count) doesn't
  // diverge from the pre-pass depth. Custom RT pins the composer's
  // _pixelRatio to 1, so size args here are physical pixels.
  const bloomPhysSize = new THREE.Vector2(
    Math.max(1, Math.round(size.x * pixelRatio)),
    Math.max(1, Math.round(size.y * pixelRatio))
  );
  // HalfFloat for HDR headroom — emissives with linear values >1 (very
  // bright glow flowers / lantern orbs) contribute to bloom in proportion
  // to their true brightness instead of being clamped at 1, and 16-bit
  // precision eliminates the 8-bit gradient banding in soft halo falloffs.
  const bloomRT = new THREE.WebGLRenderTarget(
    bloomPhysSize.x, bloomPhysSize.y,
    {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      depthTexture,
    }
  );
  const bloomComposer = new EffectComposer(renderer, bloomRT);
  bloomComposer.renderToScreen = false;
  // EffectComposer.clone() produced an orphan DepthTexture on RT2 — dispose
  // it and share the pre-pass depth so depth is consistent across the
  // ping-pong.
  if (bloomComposer.renderTarget2.depthTexture &&
      bloomComposer.renderTarget2.depthTexture !== depthTexture) {
    bloomComposer.renderTarget2.depthTexture.dispose();
    bloomComposer.renderTarget2.depthTexture = depthTexture;
  }

  const bloomRenderPass = new RenderPass(scene, camera);
  // Black background for the bloom-only pass — non-layer-1 meshes are clipped
  // out, so we don't want the regular sky/biome BG bleeding in.
  bloomRenderPass.clearColor = new THREE.Color(0, 0, 0);
  bloomRenderPass.clearAlpha = 1;
  bloomRenderPass.clear = true;
  bloomComposer.addPass(bloomRenderPass);
  // Tight halo: separable 5-tap linear-sampling Gaussian (H then V). Disable
  // depthTest/depthWrite on the blur quads — the RTs have a preserved depth
  // attachment, and we want the fullscreen quad to always rasterize.
  // Shared radius uniform so both blur passes resize together. Default 1.0
  // keeps the 5 taps overlapping (no visible "pointillist" gaps); values
  // above ~1.5 start to space the taps apart and a sample-hit dot grid
  // appears. The settings panel slider stays within that no-gap range.
  //
  // ShaderPass constructor deep-clones the supplied uniforms via
  // UniformsUtils.clone, so each pass would get its own disconnected
  // {value: 1.0}. After construction we re-point uRadius back at the
  // shared reference so setBloomRadius can update both passes at once.
  const bloomRadiusUniform = { value: state.userSettings.bloomRadius ?? 1.0 };
  // Multi-pass blur — 3 H+V pairs convolve to effective sigma ≈ √3 × σ
  // base ≈ 3.5px at radius=1, giving a wide soft halo. Each individual
  // pass stays at the safe tap spacing, so widening the radius slider can't
  // produce pointillist gaps the way a single big-radius pass would.
  // Pre-allocate up to BLOOM_MAX_PAIRS H+V pairs. Slider beyond 100% enables
  // more pairs rather than widening per-pass offsets — each pass stays at
  // radius ≤ 1 (the safe no-gap zone for the 5-tap kernel), and stacked
  // convolutions give effective σ ≈ √N × σ_base. Unused pairs are
  // `enabled = false` so EffectComposer skips them.
  const BLOOM_BASE_PAIRS = 3;   // active at slider ≤ 100%
  const BLOOM_MAX_PAIRS = 8;    // active at slider 300%
  const bloomBlurPasses = [];
  function makeBlurPass(axis) {
    const pass = new ShaderPass(_blurShader(axis, bloomRadiusUniform));
    pass.uniforms.uRadius = bloomRadiusUniform; // ShaderPass clones uniforms
    pass.material.depthTest = false;
    pass.material.depthWrite = false;
    pass.uniforms.uResolution.value.copy(bloomPhysSize);
    bloomBlurPasses.push(pass);
    return pass;
  }
  for (let i = 0; i < BLOOM_MAX_PAIRS; i++) {
    bloomComposer.addPass(makeBlurPass("h"));
    bloomComposer.addPass(makeBlurPass("v"));
  }
  function applyBloomRadiusSetting(sliderUnit) {
    // sliderUnit ∈ [0, 3]. ≤1: scale per-pass radius on base pair count;
    // >1: clamp per-pass radius at 1 and grow the active pair count linearly
    // up to BLOOM_MAX_PAIRS at sliderUnit=3.
    let activePairs, perPass;
    if (sliderUnit <= 1.0) {
      activePairs = BLOOM_BASE_PAIRS;
      perPass = sliderUnit;
    } else {
      perPass = 1.0;
      activePairs = Math.min(
        BLOOM_MAX_PAIRS,
        Math.round(BLOOM_BASE_PAIRS + (sliderUnit - 1) * 2.5)
      );
    }
    bloomRadiusUniform.value = perPass;
    for (let i = 0; i < bloomBlurPasses.length; i++) {
      bloomBlurPasses[i].enabled = Math.floor(i / 2) < activePairs;
    }
  }
  applyBloomRadiusSetting(state.userSettings.bloomRadius ?? 1.0);

  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Composite the bloom-only blurred output onto the main render. Whole
  // pass is `enabled = false` when bloom is off so the composer skips it.
  const bloomCompositePass = new ShaderPass(_bloomCompositeShader);
  // Composite weight. Multi-pass blur spreads energy thinner across more
  // pixels — at BLOOM_PASS_PAIRS=3 the peak halo pixel sits roughly 3× dimmer
  // than a single H+V pass, so the strength compensates. Dial up if the
  // halo reads as washed out; down if it bleeds across the frame.
  const BLOOM_COMPOSITE_STRENGTH = 4.5;
  bloomCompositePass.uniforms.uStrength.value =
    state.userSettings.bloom ? BLOOM_COMPOSITE_STRENGTH : 0.0;
  // Skip the composite pass entirely when bloom is off — one fewer
  // fullscreen pass and ping-pong copy every frame.
  bloomCompositePass.enabled = !!state.userSettings.bloom;
  composer.addPass(bloomCompositePass);

  const depthFXPass = new ShaderPass(_depthFXShader);
  depthFXPass.uniforms.tDepth.value = depthTexture;
  depthFXPass.uniforms.uResolution.value.copy(size);
  depthFXPass.uniforms.uCameraNear.value = camera.near;
  depthFXPass.uniforms.uCameraFar.value = camera.far;
  depthFXPass.uniforms.uOutlineStrength.value = state.userSettings.outline ? 1.0 : 0.0;
  depthFXPass.uniforms.uAoStrength.value = state.userSettings.ao ? 1.0 : 0.0;
  depthFXPass.uniforms.uFogStrength.value = state.userSettings.depthFog ? 1.0 : 0.0;
  // enabled flag tracks whether ANY sub-effect is on, so the composer can
  // skip the pass entirely when all three are off.
  depthFXPass.enabled =
    state.userSettings.outline ||
    state.userSettings.ao ||
    state.userSettings.depthFog;
  composer.addPass(depthFXPass);

  const tiltShiftPass = new ShaderPass(_tiltShiftShader);
  tiltShiftPass.uniforms.tDepth.value = depthTexture;
  tiltShiftPass.uniforms.uResolution.value.copy(size);
  tiltShiftPass.uniforms.uCameraNear.value = camera.near;
  tiltShiftPass.uniforms.uCameraFar.value = camera.far;
  tiltShiftPass.enabled = state.userSettings.tiltShift;
  composer.addPass(tiltShiftPass);

  composer.addPass(new ShaderPass(_srgbOutputShader));

  function needsDepth() {
    return (
      tiltShiftPass.enabled ||
      depthFXPass.enabled ||
      state.userSettings.softParticles ||
      // Bloom shares the pre-pass depth attachment for depth-occluded
      // emissives (a glow eye behind a tree gets culled), so it needs the
      // pre-pass to fill depth before the bloom render runs.
      state.userSettings.bloom
    );
  }

  function renderDepthPrePass(s, cam) {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(depthRT);
    renderer.clear();
    renderer.render(s, cam);
    renderer.setRenderTarget(prevTarget);
  }

  function refreshDepthFXEnabled() {
    depthFXPass.enabled =
      depthFXPass.uniforms.uOutlineStrength.value > 0.001 ||
      depthFXPass.uniforms.uAoStrength.value > 0.001 ||
      depthFXPass.uniforms.uFogStrength.value > 0.001;
  }

  return {
    composer,
    tiltShiftPass,
    depthFXPass,
    // Anything that reads depth keeps the depth pre-pass alive (and the
    // composer chain — soft particles need a composer-rendered scene so
    // they read fresh depth from this frame's pre-pass, not last frame's).
    isActive: () =>
      state.userSettings.bloom ||
      tiltShiftPass.enabled ||
      depthFXPass.enabled ||
      state.userSettings.softParticles,
    render: (s, cam) => {
      if (needsDepth()) renderDepthPrePass(s, cam);
      renderPass.scene = s;
      renderPass.camera = cam;
      bloomRenderPass.scene = s;
      bloomRenderPass.camera = cam;
      if (state.userSettings.bloom) {
        // Bloom render: restrict the camera to BLOOM_LAYER so only emissive
        // meshes are rasterized, and freeze the depth attachment (shared
        // with the depth pre-pass) so emissives behind opaque geometry get
        // culled by depthTest. scene.background would render as a full-frame
        // fill otherwise, so null it for this pass.
        const prevBackground = s.background;
        const prevLayerMask = cam.layers.mask;
        const prevAutoClearDepth = renderer.autoClearDepth;
        s.background = null;
        cam.layers.set(BLOOM_LAYER);
        renderer.autoClearDepth = false;
        bloomComposer.render();
        renderer.autoClearDepth = prevAutoClearDepth;
        cam.layers.mask = prevLayerMask;
        s.background = prevBackground;
        bloomCompositePass.uniforms.tBloom.value = bloomComposer.readBuffer.texture;
      }
      composer.render();
    },
    onResize: (w, h) => {
      composer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      // Bloom RT shares depth with depthRT — keep them locked at the same
      // physical-pixel size. Custom RT pins the composer's _pixelRatio to 1,
      // so we pass physical pixels directly.
      const pw = Math.max(1, Math.round(w * pr));
      const ph = Math.max(1, Math.round(h * pr));
      bloomComposer.setSize(pw, ph);
      for (const p of bloomBlurPasses) p.uniforms.uResolution.value.set(pw, ph);
      tiltShiftPass.uniforms.uResolution.value.set(w, h);
      depthFXPass.uniforms.uResolution.value.set(w, h);
      depthRT.setSize(pw, ph);
    },
    setBloom: (on) => {
      bloomCompositePass.uniforms.uStrength.value = on ? BLOOM_COMPOSITE_STRENGTH : 0.0;
      bloomCompositePass.enabled = !!on;
    },
    setBloomRadius: (r) => { applyBloomRadiusSetting(r); },
    setTiltShift: (on) => { tiltShiftPass.enabled = on; },
    setSoftParticles: () => { /* particle shader reads userSettings directly */ },
    setOutline: (on) => {
      depthFXPass.uniforms.uOutlineStrength.value = on ? 1.0 : 0.0;
      refreshDepthFXEnabled();
    },
    setAo: (on) => {
      depthFXPass.uniforms.uAoStrength.value = on ? 1.0 : 0.0;
      refreshDepthFXEnabled();
    },
    setDepthFog: (on) => {
      depthFXPass.uniforms.uFogStrength.value = on ? 1.0 : 0.0;
      refreshDepthFXEnabled();
    },
    // Match the biome's atmosphere — called from world.js on every regen.
    setDepthFogColor: (color) => {
      depthFXPass.uniforms.uFogColor.value.copy(color);
    },
    updateTiltShiftFocus: (focusY, focusZ) => {
      tiltShiftPass.uniforms.uFocus.value = focusY;
      if (focusZ !== undefined) {
        tiltShiftPass.uniforms.uFocusZ.value = focusZ;
      }
    },
  };
}
