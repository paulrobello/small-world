import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const { makeCaterpillar } = await import('../src/fauna.js');
const { BLOOM_LAYER } = await import('../src/postfx.js');

const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

const coral = BIOMES.find((biome) => biome.id === 'coral');
assert(coral, 'coral atoll biome should exist.');

assert.equal(coral.noCaterpillars, true, 'coral atoll should not spawn caterpillars.');
assert.equal(coral.snailCountMultiplier, 2, 'coral atoll should double its snail count.');
assert.equal(coral.snailAntennaGlow, false, 'coral atoll snails should not glow at the antenna tips.');

assert(
  worldSource.includes('const ncats = biome.noCaterpillars ? 0 : 1 + Math.floor(Math.random() * 3)'),
  'world generation should allow biomes to opt out of caterpillar spawns.'
);

assert(
  worldSource.includes('const nsnails = Math.round(baseSnails * (biome.snailCountMultiplier ?? 1))'),
  'world generation should apply a biome-level snail count multiplier.'
);

const snail = makeCaterpillar(coral, { kind: 'snail' });
const antennaTips = snail.segments[0].children
  .filter((child) => child.geometry?.type === 'CylinderGeometry')
  .flatMap((stalk) => stalk.children);

assert.equal(antennaTips.length, 2, 'coral snail should have two antenna tips.');
for (const tip of antennaTips) {
  assert.equal(tip.material.emissive.getHex(), 0, 'coral snail antenna tips should not be emissive.');
  assert.equal(tip.layers.isEnabled(BLOOM_LAYER), false, 'coral snail antenna tips should not render in bloom.');
}
