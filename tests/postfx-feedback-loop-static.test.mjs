import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const postfxSource = readFileSync(new URL('../src/postfx.js', import.meta.url), 'utf8');

assert(
  postfxSource.includes('setSourceTexture(sourceTexture)')
    && postfxSource.includes('const colorRT = new THREE.WebGLRenderTarget')
    && postfxSource.includes('particleDepthUniform.value = null')
    && postfxSource.includes('particleSoftUniform.value = 0.0')
    && postfxSource.includes('inputPass.setSourceTexture(colorRT.texture)')
    && postfxSource.includes('inputPass.setSourceTexture(depthRT.texture)')
    && postfxSource.includes('colorRT.setSize(pw, ph)'),
  'Post-FX should avoid binding particle depth sampling while rendering into the target that owns depthTexture.'
);

assert(
  postfxSource.includes('try {')
    && postfxSource.includes('finally {')
    && postfxSource.includes('particleDepthUniform.value = prevParticleDepth')
    && postfxSource.includes('particleSoftUniform.value = prevParticleSoft'),
  'Particle depth uniforms should be restored even if the depth pre-pass render exits early.'
);
