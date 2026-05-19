import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const postfxSource = readFileSync(new URL('../src/postfx.js', import.meta.url), 'utf8');

assert(
  postfxSource.includes('setSourceTexture(sourceTexture)')
    && postfxSource.includes('inputPass.setSourceTexture(depthRT.texture)')
    && !postfxSource.includes('const colorRT = new THREE.WebGLRenderTarget')
    && !postfxSource.includes('particleDepthUniform')
    && !postfxSource.includes('particleSoftUniform'),
  'Post-FX should not keep the removed soft-particle feedback-loop workaround.'
);

assert(
  postfxSource.includes('renderer.setRenderTarget(depthRT);')
    && postfxSource.includes('renderer.render(s, cam);')
    && postfxSource.includes('inputPass.setSourceTexture(depthRT.texture);'),
  'The depth pre-pass render should feed the composer directly after soft-particle removal.'
);

const inputAdd = postfxSource.indexOf('composer.addPass(inputPass)');
const depthFXAdd = postfxSource.indexOf('composer.addPass(depthFXPass)');
const bloomAdd = postfxSource.indexOf('composer.addPass(bloomCompositePass)');

assert(
  inputAdd >= 0
    && depthFXAdd > inputAdd
    && bloomAdd > depthFXAdd,
  'Depth outlines/AO/fog should be composited before bloom so bloom can soften bright edges instead of outlines drawing over the halo.'
);
