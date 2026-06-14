import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { BIOMES } = await import('../src/biomes.js');
const { makeCreature } = await import('../src/fauna/creature.js');
const { makeCaterpillar } = await import('../src/fauna/caterpillar.js');
const { makeButterfly } = await import('../src/fauna/butterfly.js');
const { makeBee, makeSwarm } = await import('../src/fauna/bee.js');
const { makeWillOWisp } = await import('../src/fauna/willowisp.js');
const { makeFlock } = await import('../src/birds.js');

const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');

const verdant = BIOMES.find((biome) => biome.id === 'verdant');
const coral = BIOMES.find((biome) => biome.id === 'coral');

const sleeper = makeCreature(verdant, { sleeper: true });
assert.equal(sleeper.group.userData.catalog?.key, 'fauna:sleeper:verdant', 'Sleeper creatures should carry biome-specific catalog metadata.');
assert.equal(sleeper.group.userData.catalog?.label, 'Sleeper', 'Creature catalog metadata should include a display label.');

const fish = makeCreature(coral);
assert.equal(fish.group.userData.catalog?.key, 'fauna:fish:coral', 'Fish biome creatures should be cataloged as fish.');

const bumblebee = makeCreature(verdant, { variant: 'bumblebee', stripeColors: ['#111111', '#ffd13b'] });
assert.equal(bumblebee.group.userData.catalog?.key, 'fauna:bumblebee:verdant', 'Configured flyer variants should carry their own catalog metadata.');

const caterpillar = makeCaterpillar(verdant);
assert.equal(caterpillar.group.userData.catalog?.key, 'fauna:caterpillar:verdant', 'Caterpillars should carry biome-specific catalog metadata.');

const snail = makeCaterpillar(verdant, { kind: 'snail' });
assert.equal(snail.group.userData.catalog?.key, 'fauna:snail:verdant', 'Snails should carry biome-specific catalog metadata.');

const butterfly = makeButterfly(['#ffffff'], verdant);
assert.equal(butterfly.group.userData.catalog?.key, 'fauna:butterfly:verdant', 'Butterflies should carry biome-specific catalog metadata.');

const bee = makeBee(makeSwarm(), verdant);
assert.equal(bee.group.userData.catalog?.key, 'fauna:bee:verdant', 'Bees should carry biome-specific catalog metadata.');

const wisp = makeWillOWisp(0, 0, 0, 1, verdant);
assert.equal(wisp.group.userData.catalog?.key, 'fauna:willowisp:verdant', 'Will-o-wisps should carry biome-specific catalog metadata.');

const flock = makeFlock(verdant);
assert.equal(flock.birds[0].group.userData.catalog?.key, 'fauna:bird:verdant', 'Birds should carry biome-specific catalog metadata.');

assert(
  worldSource.includes('catalogSubjectFromInspect')
    && worldSource.includes('object.userData.catalog = catalogSubjectFromInspect(object.userData.inspect, biome)')
    && worldSource.includes('attachCatalogMetadata(f)'),
  'World flora placement should attach catalog metadata from existing inspect metadata.'
);

assert(
  environmentSource.includes('mesh.userData.catalog = catalogSubjectFromInspect(mesh.userData.inspect, biome)')
    || worldSource.includes('attachCatalogMetadata(m)'),
  'Instanced inspect-tagged ground cover should receive catalog metadata for subject picking.'
);
