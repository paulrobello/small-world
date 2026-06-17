import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";

// Mip-chain bloom — the project's only bloom pipeline.
// Progressive filtered downsample + tent upsample à la Jimenez (SIGGRAPH 2014
// "Next Generation Post Processing in Call of Duty"): blur work happens at
// 1/2..1/32 resolution for a fraction of the stacked-pair Gaussian's fragment
// cost. The wide-footprint 13-tap downsample (+ Karis average on the first
// step, which kills single-pixel fireflies) and the 3×3 tent upsamples are
// what prevent the pixelation/shimmer that naive half-res bloom produces —
// no step ever point-samples, and no upsample ever magnifies more than 2×.
const _bloomDownsampleShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) }, // 1 / source resolution
    uKaris: { value: 0.0 },                     // 1.0 on the first (full→half) step
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
    uniform vec2 uTexel;
    uniform float uKaris;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      vec2 t = uTexel;
      // Jimenez 13-tap downsample: a 6x6 footprint sampled as 13 bilinear
      // fetches. Every source pixel contributes — that's the anti-aliasing
      // property a plain bilinear 2x2 downsample lacks.
      vec3 a = texture2D(tDiffuse, vUv + t * vec2(-2.0,  2.0)).rgb;
      vec3 b = texture2D(tDiffuse, vUv + t * vec2( 0.0,  2.0)).rgb;
      vec3 c = texture2D(tDiffuse, vUv + t * vec2( 2.0,  2.0)).rgb;
      vec3 d = texture2D(tDiffuse, vUv + t * vec2(-2.0,  0.0)).rgb;
      vec3 e = texture2D(tDiffuse, vUv).rgb;
      vec3 f = texture2D(tDiffuse, vUv + t * vec2( 2.0,  0.0)).rgb;
      vec3 g = texture2D(tDiffuse, vUv + t * vec2(-2.0, -2.0)).rgb;
      vec3 h = texture2D(tDiffuse, vUv + t * vec2( 0.0, -2.0)).rgb;
      vec3 i = texture2D(tDiffuse, vUv + t * vec2( 2.0, -2.0)).rgb;
      vec3 j = texture2D(tDiffuse, vUv + t * vec2(-1.0,  1.0)).rgb;
      vec3 k = texture2D(tDiffuse, vUv + t * vec2( 1.0,  1.0)).rgb;
      vec3 l = texture2D(tDiffuse, vUv + t * vec2(-1.0, -1.0)).rgb;
      vec3 m = texture2D(tDiffuse, vUv + t * vec2( 1.0, -1.0)).rgb;

      if (uKaris > 0.5) {
        // Karis average: weight the five overlapping 2x2 boxes by 1/(1+luma)
        // so an isolated ultra-bright pixel can't dominate its box — the
        // primary cause of temporal flicker in reduced-res bloom.
        vec3 g0 = (a + b + d + e) * 0.25;
        vec3 g1 = (b + c + e + f) * 0.25;
        vec3 g2 = (d + e + g + h) * 0.25;
        vec3 g3 = (e + f + h + i) * 0.25;
        vec3 g4 = (j + k + l + m) * 0.25;
        float w0 = 0.125 / (1.0 + luma(g0));
        float w1 = 0.125 / (1.0 + luma(g1));
        float w2 = 0.125 / (1.0 + luma(g2));
        float w3 = 0.125 / (1.0 + luma(g3));
        float w4 = 0.5   / (1.0 + luma(g4));
        vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4)
                 / (w0 + w1 + w2 + w3 + w4);
        gl_FragColor = vec4(col, 1.0);
      } else {
        vec3 col = e * 0.125
                 + (a + c + g + i) * 0.03125
                 + (b + d + f + h) * 0.0625
                 + (j + k + l + m) * 0.125;
        gl_FragColor = vec4(col, 1.0);
      }
    }
  `,
};

// 3x3 tent-filter upsample, rendered with additive blending into the next
// larger mip. Each step only magnifies 2x through the tent kernel, so
// bilinear texel blocks never become visible; uScatter weights each step's
// contribution (deeper mips contribute scatter^n — the radius control).
const _bloomUpsampleShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) }, // 1 / source (smaller mip) resolution
    uScatter: { value: 0.6 },
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
    uniform vec2 uTexel;
    uniform float uScatter;
    varying vec2 vUv;
    void main() {
      vec2 t = uTexel;
      vec3 col = texture2D(tDiffuse, vUv).rgb * 4.0;
      col += texture2D(tDiffuse, vUv + vec2( t.x, 0.0)).rgb * 2.0;
      col += texture2D(tDiffuse, vUv + vec2(-t.x, 0.0)).rgb * 2.0;
      col += texture2D(tDiffuse, vUv + vec2(0.0,  t.y)).rgb * 2.0;
      col += texture2D(tDiffuse, vUv + vec2(0.0, -t.y)).rgb * 2.0;
      col += texture2D(tDiffuse, vUv + t).rgb;
      col += texture2D(tDiffuse, vUv - t).rgb;
      col += texture2D(tDiffuse, vUv + vec2( t.x, -t.y)).rgb;
      col += texture2D(tDiffuse, vUv + vec2(-t.x,  t.y)).rgb;
      gl_FragColor = vec4(col * (1.0 / 16.0) * uScatter, 1.0);
    }
  `,
};

// Selective bloom render layer. Meshes opted-in to bloom (glow eyes, glow
// flowers, crystal cores, lantern orbs, obsidian shards) call
// `mesh.layers.enable(BLOOM_LAYER)` at construction time. The post-fx pipeline
// then runs a second scene render with the camera limited to this layer; the
// bloom pass operates on that bloom-only image, and the result is added back
// onto the main render. This decouples bloom from luminance — lit
// cream/pastel creature bodies can be as bright as they like and still won't
// bloom because they don't carry this layer flag.
export const BLOOM_LAYER = 1;

// Custom output pass: ACES tone-mapping + exposure, then sRGB OETF.
// Three.js r184 skips BOTH tone-mapping AND sRGB encoding when rendering to
// a non-screen render target (see WebGLProgram.js: outputColorSpace falls back
// to workingColorSpace=LinearSRGB, and toneMapping is set to NoToneMapping).
// Since the post-fx pipeline renders the scene to depthRT (an off-screen FBO),
// neither is applied during the scene render. This pass fills that gap by
// applying the same ACES Filmic tone-mapping + exposure used by the renderer,
// followed by linear → sRGB for display. Doing it here (once, at the end of
// the composer chain) instead of per-material ensures a single consistent
// tone-map pass regardless of how many intermediate shader passes ran.
const _srgbOutputShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.05 },
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
    uniform float uExposure;
    varying vec2 vUv;

    // ACES Filmic tone mapping (matches THREE.ACESFilmicToneMapping)
    vec3 ACESFilmic(vec3 x) {
      float a = 2.51;
      float b = 0.03;
      float c = 2.43;
      float d = 0.59;
      float e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 linearToSRGB(vec3 c) {
      vec3 lo = c * 12.92;
      vec3 hi = pow(c, vec3(1.0/2.4)) * 1.055 - 0.055;
      return mix(lo, hi, step(0.0031308, c));
    }

    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 color = t.rgb * uExposure;
      color = ACESFilmic(color);
      gl_FragColor = vec4(linearToSRGB(color), t.a);
    }
  `,
};

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
    uUnderwaterColor: { value: new THREE.Color(0x3f9fb5) },
    uUnderwaterStrength: { value: 0.0 },
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
    uniform vec3  uUnderwaterColor;
    uniform float uUnderwaterStrength;
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

      if (uUnderwaterStrength > 0.001) {
        base.rgb = mix(base.rgb, uUnderwaterColor, uUnderwaterStrength);
      }

      gl_FragColor = base;
    }
  `,
};

// Minimal passthrough shader for InputPass — copies an external render
// target's color into the composer's ping-pong chain without re-rendering
// the scene.
const _copyShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv);
    }
  `,
};

// Replacement for RenderPass in the main composer chain. It copies an
// external color target into the EffectComposer ping-pong buffers.
class InputPass extends Pass {
  constructor(sourceTexture) {
    super();
    this._sourceTexture = sourceTexture;
    this.uniforms = THREE.UniformsUtils.clone(_copyShader.uniforms);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: _copyShader.vertexShader,
      fragmentShader: _copyShader.fragmentShader,
    });
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this._scene.add(this._quad);
  }
  setSourceTexture(sourceTexture) {
    this._sourceTexture = sourceTexture;
  }
  // Ignores readBuffer — always reads from the external source texture.
  render(renderer, writeBuffer /* , readBuffer */) {
    this.uniforms.tDiffuse.value = this._sourceTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    renderer.render(this._scene, this._camera);
  }
}

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
      setOutline: () => {},
      setAo: () => {},
      setDepthFog: () => {},
      setDepthFogColor: () => {},
      setUnderwaterTint: () => {},
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

  // Depth pre-pass RT, kept OUTSIDE the composer's ping-pong.
  const depthTexture = new THREE.DepthTexture(
    Math.max(1, Math.round(size.x * pixelRatio)),
    Math.max(1, Math.round(size.y * pixelRatio))
  );
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;

  const depthRT = new THREE.WebGLRenderTarget(
    Math.max(1, Math.round(size.x * pixelRatio)),
    Math.max(1, Math.round(size.y * pixelRatio)),
    // HalfFloat stores un-tone-mapped linear HDR without clipping values >1,
    // preserving highlight detail for the ACES pass at the end of the
    // composer chain. UnsignedByte would clamp everything above 1.0 to white.
    { type: THREE.HalfFloatType, depthBuffer: true, depthTexture }
  );
  // Expose for depth-based post-processing passes.
  state.depthTexture = depthTexture;

  // Bloom emissive-capture RT. The camera is layer-filtered to BLOOM_LAYER
  // for this render (see renderBloomChain) so only emissive meshes
  // rasterize. Captured at full physical resolution so the depth attachment
  // can be shared with the depth pre-pass — the capture runs with
  // autoClearDepth=false, preserving the scene depth so emissives behind
  // opaque geometry are culled by depthTest instead of shining through.
  // The capture itself is cheap (sparse fragments); all blur work happens
  // down the mip chain at 1/2..1/32 resolution.
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

  // ── Mip-chain bloom resources ────────────────────────────────────────────
  const BLOOM_MAX_MIPS = 5;
  const bloomScatterUniform = { value: 0.6 };
  let bloomMips = [];
  function bloomMipsResize(pw, ph) {
    for (const m of bloomMips) m.dispose();
    bloomMips = [];
    let w = pw >> 1;
    let h = ph >> 1;
    for (let i = 0; i < BLOOM_MAX_MIPS && w >= 8 && h >= 8; i++) {
      bloomMips.push(new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType, // HDR headroom + no banding, same as bloomRT
        format: THREE.RGBAFormat,
        depthBuffer: false,
      }));
      w >>= 1;
      h >>= 1;
    }
  }
  bloomMipsResize(bloomPhysSize.x, bloomPhysSize.y);
  const bloomDownMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(_bloomDownsampleShader.uniforms),
    vertexShader: _bloomDownsampleShader.vertexShader,
    fragmentShader: _bloomDownsampleShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const bloomUpMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(_bloomUpsampleShader.uniforms),
    vertexShader: _bloomUpsampleShader.vertexShader,
    fragmentShader: _bloomUpsampleShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // accumulate into the larger mip
  });
  bloomUpMat.uniforms.uScatter = bloomScatterUniform; // share the live ref
  const bloomQuad = new FullScreenQuad(bloomDownMat);
  const _bloomClearColor = new THREE.Color(0, 0, 0);
  const _prevClearColor = new THREE.Color();

  // Capture emissives into bloomRT at full res (against the preserved scene
  // depth, exactly like the legacy path — occlusion is unchanged), then run
  // the down/up chain. Output lands in bloomMips[0] (half res); the
  // composite's bilinear fetch handles the final 2× — invisible on content
  // this blurred.
  function renderBloomChain(s, cam) {
    const prevBackground = s.background;
    const prevLayerMask = cam.layers.mask;
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(_prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    s.background = null;
    cam.layers.set(BLOOM_LAYER);
    renderer.setClearColor(_bloomClearColor, 1);
    renderer.autoClearDepth = false; // keep the pre-pass scene depth
    renderer.setRenderTarget(bloomRT);
    renderer.clear(true, false, false); // color only
    renderer.render(s, cam);
    renderer.autoClearDepth = true;
    cam.layers.mask = prevLayerMask;
    s.background = prevBackground;
    renderer.setClearColor(_prevClearColor, prevClearAlpha);

    // autoClear must be off: downsamples overwrite every pixel anyway, and
    // the additive upsamples must NOT clear the mip they accumulate into.
    renderer.autoClear = false;
    bloomQuad.material = bloomDownMat;
    let srcTex = bloomRT.texture;
    let srcW = bloomRT.width;
    let srcH = bloomRT.height;
    for (let i = 0; i < bloomMips.length; i++) {
      bloomDownMat.uniforms.tDiffuse.value = srcTex;
      bloomDownMat.uniforms.uTexel.value.set(1 / srcW, 1 / srcH);
      bloomDownMat.uniforms.uKaris.value = i === 0 ? 1.0 : 0.0;
      renderer.setRenderTarget(bloomMips[i]);
      bloomQuad.render(renderer);
      srcTex = bloomMips[i].texture;
      srcW = bloomMips[i].width;
      srcH = bloomMips[i].height;
    }
    bloomQuad.material = bloomUpMat;
    for (let i = bloomMips.length - 1; i >= 1; i--) {
      bloomUpMat.uniforms.tDiffuse.value = bloomMips[i].texture;
      bloomUpMat.uniforms.uTexel.value.set(
        1 / bloomMips[i].width, 1 / bloomMips[i].height
      );
      renderer.setRenderTarget(bloomMips[i - 1]);
      bloomQuad.render(renderer);
    }
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(null);
    return bloomMips[0]?.texture ?? bloomRT.texture;
  }

  function applyBloomRadiusSetting(sliderUnit) {
    // sliderUnit ∈ [0, 3]. Maps to the per-step upsample weight ("scatter") —
    // deeper mips contribute scatter^n, so higher values read as a wider,
    // softer halo.
    bloomScatterUniform.value = THREE.MathUtils.clamp(0.4 + 0.2 * sliderUnit, 0.2, 1.0);
  }
  applyBloomRadiusSetting(state.userSettings.bloomRadius ?? 1.0);

  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  // InputPass copies color from the depth pre-pass render target into the
  // composer's ping-pong chain. This replaces the old RenderPass that
  // re-rendered the entire scene — cutting scene renders from 2 to 1 when
  // any depth-dependent FX is active.
  const inputPass = new InputPass(depthRT.texture);
  composer.addPass(inputPass);

  // Composite the bloom-only blurred output onto the main render. Whole
  // pass is `enabled = false` when bloom is off so the composer skips it.
  const bloomCompositePass = new ShaderPass(_bloomCompositeShader);
  // Composite weight — tuned against the mip chain's accumulated pyramid.
  const BLOOM_COMPOSITE_STRENGTH = 1.8;
  bloomCompositePass.uniforms.uStrength.value =
    state.userSettings.bloom ? BLOOM_COMPOSITE_STRENGTH : 0.0;
  // Skip the composite pass entirely when bloom is off — one fewer
  // fullscreen pass and ping-pong copy every frame.
  bloomCompositePass.enabled = !!state.userSettings.bloom;

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
    state.userSettings.depthFog ||
    depthFXPass.uniforms.uUnderwaterStrength.value > 0.001;
  composer.addPass(depthFXPass);

  // Bloom composites after the depth-FX pass so depth outlines are part of
  // the base image below the halo instead of drawing over bright bloom.
  composer.addPass(bloomCompositePass);

  const tiltShiftPass = new ShaderPass(_tiltShiftShader);
  tiltShiftPass.uniforms.tDepth.value = depthTexture;
  tiltShiftPass.uniforms.uResolution.value.copy(size);
  tiltShiftPass.uniforms.uCameraNear.value = camera.near;
  tiltShiftPass.uniforms.uCameraFar.value = camera.far;
  tiltShiftPass.enabled = state.userSettings.tiltShift;
  composer.addPass(tiltShiftPass);

  composer.addPass(new ShaderPass(_srgbOutputShader));

  function refreshDepthFXEnabled() {
    depthFXPass.enabled =
      depthFXPass.uniforms.uOutlineStrength.value > 0.001 ||
      depthFXPass.uniforms.uAoStrength.value > 0.001 ||
      depthFXPass.uniforms.uFogStrength.value > 0.001 ||
      depthFXPass.uniforms.uUnderwaterStrength.value > 0.001;
  }

  return {
    composer,
    tiltShiftPass,
    depthFXPass,
    // Anything that reads depth keeps the depth pre-pass alive.
    isActive: () =>
      state.userSettings.bloom ||
      tiltShiftPass.enabled ||
      depthFXPass.enabled,
    render: (s, cam) => {
      // Render depthRT first so bloom and depth FX have a fresh depthTexture.
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(depthRT);
      renderer.clear();
      renderer.render(s, cam);
      inputPass.setSourceTexture(depthRT.texture);
      renderer.setRenderTarget(prevTarget);

      if (state.userSettings.bloom) {
        // Emissive capture + down/up mip pyramid; output lands at half res.
        bloomCompositePass.uniforms.tBloom.value = renderBloomChain(s, cam);
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
      // bloomRT shares its depth attachment with depthRT — BOTH must resize
      // to the same physical size, or three throws "Attached DepthTexture is
      // initialized to the incorrect size" on the next bind and every frame
      // after (black canvas). setSize() disposes the GL objects; the shared
      // depth texture re-initializes at the new size on next bind.
      bloomRT.setSize(pw, ph);
      bloomMipsResize(pw, ph);
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
    setUnderwaterTint: (color, strength) => {
      depthFXPass.uniforms.uUnderwaterColor.value.copy(color);
      depthFXPass.uniforms.uUnderwaterStrength.value = THREE.MathUtils.clamp(strength, 0, 1);
      refreshDepthFXEnabled();
    },
    updateTiltShiftFocus: (focusY, focusZ) => {
      tiltShiftPass.uniforms.uFocus.value = focusY;
      if (focusZ !== undefined) {
        tiltShiftPass.uniforms.uFocusZ.value = focusZ;
      }
    },
    // Tear down every RT/material/geometry allocated by initPostFX. Latent
    // today (called once per page load), but any future re-init path (LOWFX
    // toggle, hot-reload, scene rebuild) MUST call this first or every prior
    // RT and shader leaks. The hand-rolled bloom chain (bloomRT, bloomMips[],
    // bloom materials/quad) and the depth pre-pass (depthRT + depthTexture)
    // live outside the composer, so they need explicit disposal here.
    // composer.dispose() only frees its two ping-pong RTs + copyPass, so the
    // ShaderPasses are disposed by walking composer.passes. depthRT.depthTexture
    // === depthTexture, so a single depthTexture.dispose() covers both
    // attachments.
    dispose: () => {
      for (const p of composer?.passes ?? []) p?.dispose?.();
      for (const m of bloomMips) m?.dispose?.();
      bloomMips = [];
      bloomRT?.dispose?.();
      bloomQuad?.dispose?.();          // FullScreenQuad disposes its geometry + material
      bloomDownMat?.dispose?.();
      bloomUpMat?.dispose?.();
      // InputPass doesn't override Pass.dispose() — its material and quad
      // geometry need explicit teardown.
      inputPass?.material?.dispose?.();
      inputPass?._quad?.geometry?.dispose?.();
      depthRT?.dispose?.();
      depthTexture?.dispose?.();
      composer?.dispose?.();
      // Drop the depthTexture ref so any stale consumer doesn't sample a
      // disposed texture.
      if (state.depthTexture === depthTexture) state.depthTexture = null;
    },
  };
}
