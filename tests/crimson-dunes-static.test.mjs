import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, FLOWER_DENSITY, WILDFLOWER_PALETTES } from '../src/biomes.js';

const desert = BIOMES.find((biome) => biome.id === 'desert');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
assert(desert, 'crimson dunes biome should exist.');
assert.equal(desert.particle, 'sand', 'crimson dunes should use wind-blown sand particles.');

assert(desert.edgeAura, 'crimson dunes should define a terrain-colored mist ring.');
assert.equal(desert.edgeAura.pattern, 'mist', 'crimson dunes edge aura should be a mist ring.');
assert.deepEqual(
  desert.edgeAura.colors,
  desert.ground,
  'crimson dunes mist ring should match the terrain ground colors.'
);

assert.equal(
  FLOWER_DENSITY.desert,
  0,
  'crimson dunes should not spawn wildflower ground cover.'
);
assert.equal(
  Object.hasOwn(WILDFLOWER_PALETTES, 'desert'),
  false,
  'crimson dunes should not keep a wildflower palette when flowers are disabled.'
);

assert(
  environmentSource.includes('sand: 3120')
    && environmentSource.includes('PARTICLE_KIND == 11')
    && environmentSource.includes('windBand')
    && environmentSource.includes('groundY + 0.08')
    && environmentSource.includes('kind !== "sand" && !!(state.depthTexture')
    && environmentSource.includes('if (length(c) > 0.34) discard;')
    && environmentSource.includes('kind === "sand" ? _sandParticleVS : _particleVS')
    && environmentSource.includes('kind === "sand" ? _sandParticleFS : _particleFS')
    && environmentSource.includes('sand: 0.28')
    && environmentSource.includes('sand: 0.58')
    && environmentSource.includes('depthTest: true'),
  'sand particles should be dense, tiny, low grit that does not depth-fade away.'
);

assert(
  environmentSource.includes('if (total <= 0) return [];'),
  'zero flower density should prevent fallback wildflower meshes from spawning.'
);
