import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

const ashen = BIOMES.find((biome) => biome.id === 'ashen');
assert(ashen, 'ashen wastes biome should exist.');
assert(ashen.edgeAura, 'ashen wastes should define an edge aura.');
assert.equal(ashen.edgeAura.pattern, 'mist', 'ashen wastes edge aura should be a mist ring.');
assert.deepEqual(
  ashen.edgeAura.colors,
  [ashen.cliff, ashen.ground[0], ashen.ground[1]],
  'ashen wastes mist ring should match the darker terrain-edge palette, not the bright upper ground highlight.'
);
