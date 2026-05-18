import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

const ashen = BIOMES.find((biome) => biome.id === 'ashen');
assert(ashen, 'ashen wastes biome should exist.');
assert(ashen.edgeAura, 'ashen wastes should define an edge aura.');
assert.equal(ashen.edgeAura.pattern, 'mist', 'ashen wastes edge aura should be a mist ring.');
assert.deepEqual(
  ashen.edgeAura.colors,
  ['#0c0a12', '#5a3a4a', '#e63946'],
  'ashen wastes mist ring should use smoky ember contrast colors.'
);
