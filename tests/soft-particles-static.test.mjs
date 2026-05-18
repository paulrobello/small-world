import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const postfxSource = readFileSync(new URL('../src/postfx.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

const softKindStart = environmentSource.indexOf('const SOFT_PARTICLE_KINDS = new Set(');
const softKindEnd = environmentSource.indexOf(');', softKindStart);
const softKindBlock = softKindStart >= 0 && softKindEnd > softKindStart
  ? environmentSource.slice(softKindStart, softKindEnd)
  : '';

assert(
  softKindBlock.includes('"dust"')
    && softKindBlock.includes('"rain"')
    && !softKindBlock.includes('"leaf"')
    && !softKindBlock.includes('"sand"'),
  'Soft particle depth fading should be opt-in by particle kind; leaves and sand should not use it.'
);

assert(
  environmentSource.includes('const softOn = SOFT_PARTICLE_KINDS.has(kind) && !!(state.depthTexture && state.userSettings.softParticles);'),
  'Particle materials should enable uSoftParticles only for particle kinds that benefit from depth fading.'
);

assert(
  environmentSource.includes('softParticlesSupported: SOFT_PARTICLE_KINDS.has(kind)'),
  'Particle instances should expose whether their kind supports depth softening.'
);

assert(
  uiSource.includes('p.material.uniforms.uSoftParticles.value =')
    && uiSource.includes('softParticlesEl.checked && p.userData.softParticlesSupported ? 1.0 : 0.0'),
  'The FX-panel toggle should not re-enable soft particles for unsupported particle kinds like leaves.'
);

assert(
  postfxSource.includes('function particlesUseSoftDepth()')
    && postfxSource.includes('return (state.particles?.material?.uniforms?.uSoftParticles?.value ?? 0) > 0.001;')
    && postfxSource.includes('particlesUseSoftDepth()'),
  'Post-FX should keep the soft-particle render path active only when the live particle material is actually depth-softened.'
);
