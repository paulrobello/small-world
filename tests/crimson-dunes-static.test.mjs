import assert from 'node:assert/strict';
import { BIOMES, FLOWER_DENSITY, WILDFLOWER_PALETTES } from '../src/biomes.js';

const desert = BIOMES.find((biome) => biome.id === 'desert');
assert(desert, 'crimson dunes biome should exist.');

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
