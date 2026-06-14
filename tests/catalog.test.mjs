import assert from 'node:assert/strict';

globalThis.__APP_VERSION__ = 'test';

const {
  buildCatalogKey,
  buildCatalogSubject,
  filterCatalogEntriesForWorld,
  getBiomeCatalogEntries,
  makeCatalogStore,
} = await import('../src/catalog.js');
const { BIOMES } = await import('../src/biomes.js');

const verdant = BIOMES.find((biome) => biome.id === 'verdant');
const coral = BIOMES.find((biome) => biome.id === 'coral');
const desert = BIOMES.find((biome) => biome.id === 'desert');
const ashen = BIOMES.find((biome) => biome.id === 'ashen');

assert.equal(
  buildCatalogKey({ category: 'fauna', variant: 'snail', biomeId: 'grove' }),
  'fauna:snail:grove',
  'Catalog keys should include category, variant, and biome id.'
);

assert.deepEqual(
  buildCatalogSubject({ category: 'flora', variant: 'snowpine', biomeId: 'frozen' }),
  {
    key: 'flora:snowpine:frozen',
    category: 'flora',
    variant: 'snowpine',
    biomeId: 'frozen',
    label: 'Snow Pine',
  },
  'Catalog subjects should normalize label and key from category, variant, and biome id.'
);

const verdantEntries = getBiomeCatalogEntries(verdant);
const verdantKeys = new Set(verdantEntries.map((entry) => entry.key));
assert(verdantKeys.has('flora:leafballtree:verdant'), 'Verdant catalog should include biome flora.');
assert(verdantKeys.has('flora:wildflower:verdant'), 'Verdant catalog should include wildflowers where flower density exists.');
assert(verdantKeys.has('flora:grassfield:verdant'), 'Verdant catalog should include grassfield where grass can exist.');
assert(verdantKeys.has('flora:fairyring:verdant'), 'Verdant catalog should include biome-specific fairy rings.');
assert(verdantKeys.has('fauna:walker:verdant'), 'Verdant catalog should include ground walkers.');
assert(verdantKeys.has('fauna:bumblebee:verdant'), 'Verdant catalog should include configured flyer variants.');
assert(verdantKeys.has('fauna:willowisp:verdant'), 'Verdant catalog should include will-o-wisps from the giant leafball tree.');
assert(verdantKeys.has('fauna:bird:verdant'), 'Every biome catalog should include birds.');

const coralKeys = new Set(getBiomeCatalogEntries(coral).map((entry) => entry.key));
assert(coralKeys.has('fauna:fish:coral'), 'Fish biomes should include fish instead of walkers.');
assert(coralKeys.has('fauna:snail:coral'), 'Coral still spawns snails and should list them.');
assert(!coralKeys.has('fauna:walker:coral'), 'Fish biomes should not list impossible walkers.');
assert(coralKeys.has('flora:shell:coral'), 'Beachcomb biomes should include shell catalog entries.');
assert(coralKeys.has('flora:starfish:coral'), 'Beachcomb biomes should include starfish catalog entries.');
assert(!coralKeys.has('flora:water:coral'), 'Water should not be catalogable even in water biomes.');

const desertKeys = new Set(getBiomeCatalogEntries(desert).map((entry) => entry.key));
assert(!desertKeys.has('fauna:butterfly:desert'), 'Biomes with noButterflies should not list butterflies.');
assert(!desertKeys.has('fauna:bee:desert'), 'Biomes without nectar should not list bees.');

const ashenKeys = new Set(getBiomeCatalogEntries(ashen).map((entry) => entry.key));
assert(!ashenKeys.has('fauna:butterfly:ashen'), 'Ashen Wastes should not ask for impossible butterfly photos.');

const marsh = BIOMES.find((biome) => biome.id === 'marsh');
const marshEntries = getBiomeCatalogEntries(marsh);
const filteredMarshKeys = new Set(filterCatalogEntriesForWorld(marshEntries, {
  availableKeys: new Set(['fauna:walker:marsh', 'fauna:flier:marsh']),
  savedKeys: new Set(['fauna:sleeper:marsh']),
}).map((entry) => entry.key));
assert(filteredMarshKeys.has('fauna:walker:marsh'), 'Current-world filtering should keep fauna present in this seed.');
assert(filteredMarshKeys.has('fauna:sleeper:marsh'), 'Current-world filtering should keep saved entries from prior seeds.');
assert(!filteredMarshKeys.has('fauna:burrower:marsh'), 'Current-world filtering should hide unavailable locked fauna.');

const store = makeCatalogStore({
  now: () => 1000,
  metadataStorage: new Map(),
  blobStorage: new Map(),
});
const snail = buildCatalogSubject({ category: 'fauna', variant: 'snail', biomeId: 'grove' });

const first = await store.savePhoto({
  subject: snail,
  seed: 0x9708,
  blob: 'first-blob',
});
assert.equal(first.status, 'created', 'First catalog save should create an entry.');
assert.equal(first.entry.photoCount, 1, 'First catalog save should start photoCount at 1.');
assert.equal(first.entry.seed, '0x9708', 'Catalog entries should persist formatted seed strings.');
assert.equal(await store.getPhotoBlob(snail.key), 'first-blob', 'First catalog save should persist the photo blob.');

const kept = await store.keepCurrent(snail.key);
assert.equal(kept.key, snail.key, 'Keeping current should return the unchanged entry.');
assert.equal(kept.photoCount, 1, 'Keeping current should not increment photoCount.');
assert.equal(await store.getPhotoBlob(snail.key), 'first-blob', 'Keeping current should not replace the blob.');

const replaced = await store.replacePhoto({
  subject: snail,
  seed: 0x9709,
  blob: 'replacement-blob',
  now: 2500,
});
assert.equal(replaced.status, 'replaced', 'Replacing an existing entry should report replaced status.');
assert.equal(replaced.entry.discoveredAt, 1000, 'Replacing should preserve first discovery time.');
assert.equal(replaced.entry.updatedAt, 2500, 'Replacing should update the updatedAt timestamp.');
assert.equal(replaced.entry.photoCount, 2, 'Replacing should increment photoCount.');
assert.equal(replaced.entry.seed, '0x9709', 'Replacing should update the saved seed.');
assert.equal(await store.getPhotoBlob(snail.key), 'replacement-blob', 'Replacing should update the saved photo blob.');
