import assert from 'node:assert/strict';
import { FLOWER_DENSITY, GRASS_DENSITY, GRASS_HEIGHT, WILDFLOWER_PALETTES } from '../src/biomes.js';

assert.deepEqual(
  GRASS_DENSITY,
  { ashen: 0, desert: 0, frozen: 0, coral: 0, obsidian: 0 },
  'Bare biomes should override grass density, disabling their instanced grass fields.'
);

assert.equal(FLOWER_DENSITY.frozen, 0, 'frozen vale should not spawn wildflower ground cover.');
assert.equal(FLOWER_DENSITY.coral, 0, 'coral atoll should not spawn wildflower ground cover.');
assert.equal(FLOWER_DENSITY.cloud, 0, 'cloud island should not spawn wildflower ground cover.');
assert.equal(
  Object.hasOwn(WILDFLOWER_PALETTES, 'cloud'),
  false,
  'cloud island should not keep a wildflower palette when flowers are disabled.'
);

assert.deepEqual(
  GRASS_HEIGHT,
  {},
  'No biome should currently override grass height; leave GRASS_HEIGHT exported for future overrides.'
);
