import assert from 'node:assert/strict';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const { BIOMES } = await import('../src/biomes.js');
const { makeCreature } = await import('../src/fauna/creature.js');

const coral = BIOMES.find((biome) => biome.id === 'coral');
assert.ok(coral, 'coral fish biome should exist');

const originalRandom = Math.random;
Math.random = () => 0;
const fish = makeCreature(coral);
Math.random = originalRandom;

assert.equal(fish.isFish, true, 'coral creatures should use the fish movement path');
assert.equal(fish.flies, true, 'fish should keep the flier-style swimming path');
assert.equal(
  fish.speed,
  0.41250000000000003,
  'fish should swim at 50% of the previous flier-speed baseline for the same deterministic roll'
);
