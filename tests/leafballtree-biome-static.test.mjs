import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

const generatedTreeKinds = new Set(['tree', 'pine', 'snowpine', 'balloontree']);
const biomeTreeSlots = new Map([
  ['verdant', 2],
  ['frozen', 3],
  ['golden', 2],
  ['mossy', 1],
  ['twilight', 1],
  ['cloud', 3],
  ['obsidian', 1],
]);

for (const biome of BIOMES) {
  const oldTreeKind = biome.flora.find((kind) => generatedTreeKinds.has(kind));
  assert.equal(
    oldTreeKind,
    undefined,
    `${biome.id} generated flora should use leafballtree instead of ${oldTreeKind}.`
  );
}

for (const [biomeId, leafballCount] of biomeTreeSlots) {
  const biome = BIOMES.find(({ id }) => id === biomeId);
  assert(biome, `${biomeId} biome should exist.`);
  assert.equal(
    biome.flora.filter((kind) => kind === 'leafballtree').length,
    leafballCount,
    `${biomeId} should preserve its living tree slot count with leafballtree entries.`
  );
  assert.equal(
    typeof biome.leafballTreePalette?.trunk,
    'string',
    `${biomeId} leafball trees should define a biome-specific trunk color.`
  );
  assert.equal(
    biome.leafballTreePalette?.leaves?.length,
    3,
    `${biomeId} leafball trees should define shadow, mid, and highlight leaf colors.`
  );
}
