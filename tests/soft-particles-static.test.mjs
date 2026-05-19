import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const postfxSource = readFileSync(new URL('../src/postfx.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const biomesSource = readFileSync(new URL('../src/biomes.js', import.meta.url), 'utf8');

for (const [label, source] of [
  ['environment', environmentSource],
  ['postfx', postfxSource],
  ['ui', uiSource],
  ['state', stateSource],
  ['html', htmlSource],
  ['biomes', biomesSource],
]) {
  assert.equal(source.includes('softParticles'), false, `${label} should not reference softParticles.`);
  assert.equal(source.includes('Soft particles'), false, `${label} should not reference Soft particles.`);
  assert.equal(source.includes('soft-particle'), false, `${label} should not reference soft-particle.`);
  assert.equal(source.includes('uSoftParticles'), false, `${label} should not reference uSoftParticles.`);
}

assert.equal(htmlSource.includes('setting-softparticles'), false, 'The FX panel should not expose a soft-particles checkbox.');
assert.equal(postfxSource.includes('const colorRT = new THREE.WebGLRenderTarget'), false, 'Post-FX should not keep the extra soft-particle color render target.');
assert.equal(postfxSource.includes('particlesUseSoftDepth'), false, 'Post-FX should not keep soft-particle activation checks.');
assert.equal(environmentSource.includes('uniform sampler2D tDepth;'), false, 'Particle shaders should not sample scene depth.');
