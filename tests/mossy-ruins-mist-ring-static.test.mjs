import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

const mossy = BIOMES.find((biome) => biome.id === 'mossy');
assert(mossy, 'mossy ruins biome should exist.');
assert(mossy.edgeAura, 'mossy ruins should define an edge aura.');
assert.equal(mossy.edgeAura.pattern, 'mist', 'mossy ruins edge aura should use the mist ring.');
assert.deepEqual(
  mossy.edgeAura.colors,
  [mossy.cliff, mossy.ground[0], mossy.fog],
  'mossy ruins mist ring should use terrain and fog greens instead of the old black grass-ring palette.'
);
assert.equal(mossy.edgeAura.alpha, 0.82, 'mossy ruins mist ring should stay translucent.');
