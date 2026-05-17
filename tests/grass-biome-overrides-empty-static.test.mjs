import assert from 'node:assert/strict';
import { GRASS_DENSITY, GRASS_HEIGHT } from '../src/biomes.js';

assert.deepEqual(
  GRASS_DENSITY,
  { ashen: 0, desert: 0 },
  'Only ashen wastes and crimson dunes should override grass density, disabling their instanced grass fields.'
);

assert.deepEqual(
  GRASS_HEIGHT,
  {},
  'No biome should currently override grass height; leave GRASS_HEIGHT exported for future overrides.'
);
