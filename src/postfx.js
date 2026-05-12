import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";

// Hand-rolled tilt-shift: 4-tap blur scaled by distance from a focus band.
// Focus band's screen-Y is updated each frame from main.js so it tracks the
// island origin as the camera orbits.
const _tiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.55 },        // 0..1 screen-Y
    uHalfWidth: { value: 0.18 },    // half-width of sharp band
    uBlurAmount: { value: 1.6 },    // px blur radius scale
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
    uniform float uFocus;
    uniform float uHalfWidth;
    uniform float uBlurAmount;
    varying vec2 vUv;
    void main() {
      float dy = abs(vUv.y - uFocus);
      float blur = smoothstep(uHalfWidth, uHalfWidth + 0.25, dy) * uBlurAmount;
      vec2 px = 1.0 / uResolution;
      vec3 c = vec3(0.0);
      c += texture2D(tDiffuse, vUv).rgb * 0.4;
      c += texture2D(tDiffuse, vUv + vec2( px.x * 2.0 * blur, 0.0)).rgb * 0.15;
      c += texture2D(tDiffuse, vUv + vec2(-px.x * 2.0 * blur, 0.0)).rgb * 0.15;
      c += texture2D(tDiffuse, vUv + vec2(0.0,  px.y * 2.0 * blur)).rgb * 0.15;
      c += texture2D(tDiffuse, vUv + vec2(0.0, -px.y * 2.0 * blur)).rgb * 0.15;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function initPostFX(renderer, scene, camera) {
  // LOWFX never builds a composer — returns a stub that always reports off.
  if (LOWFX) {
    return {
      isActive: () => false,
      render: () => renderer.render(scene, camera),
      onResize: () => {},
      setBloom: () => {},
      setTiltShift: () => {},
      updateTiltShiftFocus: () => {},
    };
  }

  const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Threshold 0.96: only true emissive surfaces (crystal lights, lantern orbs,
  // glowFlowers/glowEyes, the sun) bloom. Lit creature bodies with light
  // palette colours like cream (#fff2b3) hit ~0.9 luminance and would
  // otherwise glow as if emissive too.
  const bloomPass = new UnrealBloomPass(size.clone(), 0.55, 0.45, 0.96);
  bloomPass.enabled = state.userSettings.bloom;
  composer.addPass(bloomPass);

  const tiltShiftPass = new ShaderPass(_tiltShiftShader);
  tiltShiftPass.uniforms.uResolution.value.copy(size);
  tiltShiftPass.enabled = state.userSettings.tiltShift;
  composer.addPass(tiltShiftPass);

  composer.addPass(new OutputPass());

  return {
    composer,
    bloomPass,
    tiltShiftPass,
    isActive: () => bloomPass.enabled || tiltShiftPass.enabled,
    render: (s, cam) => {
      // Keep render pass + scene refs synced (scene/camera refs are stable
      // per session, but cheap to assign).
      renderPass.scene = s;
      renderPass.camera = cam;
      composer.render();
    },
    onResize: (w, h) => {
      composer.setSize(w, h);
      bloomPass.setSize(w, h);
      tiltShiftPass.uniforms.uResolution.value.set(w, h);
    },
    setBloom: (on) => { bloomPass.enabled = on; },
    setTiltShift: (on) => { tiltShiftPass.enabled = on; },
    // Caller computes focusY each frame from the camera; we just write it.
    updateTiltShiftFocus: (focusY) => {
      tiltShiftPass.uniforms.uFocus.value = focusY;
    },
  };
}
