import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert(
  htmlSource.includes('id="setting-catalog"')
    && htmlSource.includes('id="catalog-toggle"')
    && htmlSource.includes('class="catalog-icon"')
    && htmlSource.includes('id="catalog-panel"')
    && htmlSource.includes('id="catalog-list"'),
  'Markup should expose settings and on-screen icon entry points plus the catalog panel.'
);

assert(
  !htmlSource.includes('<span class="catalog-glyph">FG</span>'),
  'Catalog HUD button should use an icon instead of visible FG text.'
);

assert(
  uiSource.includes('makeCatalogStore')
    && uiSource.includes('getBiomeCatalogEntries')
    && uiSource.includes('findPhotoCatalogSubject'),
  'ui.js should import catalog storage/checklist and photo subject helpers.'
);

assert(
  uiSource.includes('const catalogStore = makeCatalogStore()'),
  'ui.js should create one catalog store for photo review and catalog rendering.'
);

assert(
  uiSource.includes('const catalogToggle = document.getElementById("catalog-toggle");')
    && uiSource.includes('catalogToggle.addEventListener("click"')
    && uiSource.includes('e.key === "g" || e.key === "G"'),
  'Catalog should be available from a visible HUD button and the G hotkey.'
);

assert(
  uiSource.includes('findPhotoCatalogSubject({ camera, root: state.world })'),
  'Photo capture should resolve the reticle catalog subject from the current world.'
);

assert(
  uiSource.includes('new catalog entry')
    && uiSource.includes('already in catalog')
    && uiSource.includes('emptyStatus.className = "photo-review-catalog-status photo-review-catalog-empty-status"')
    && uiSource.includes('emptyStatus.textContent = "no catalog subject in reticle"')
    && uiSource.includes('frameLabel.className = "photo-review-frame-label"')
    && uiSource.includes('frameLabel.textContent = subject.label')
    && uiSource.includes('photo-review-keep')
    && uiSource.includes('photo-review-replace'),
  'Photo review should render styled no-subject, frame-label, new-entry, and existing-entry catalog states.'
);

assert(
  uiSource.includes('async function renderCatalogPanel')
    && uiSource.includes('URL.createObjectURL')
    && uiSource.includes('visit seed'),
  'Catalog panel should render stored thumbnails and seed revisit actions.'
);

assert(
  uiSource.includes('async function loadCatalogBiome(biome)')
    && uiSource.includes('await generateWorld(state.currentSeed, undefined, { biomeId: biome.id })')
    && uiSource.includes('const title = document.createElement("button");')
    && uiSource.includes('const card = document.createElement("button");')
    && uiSource.includes('card.addEventListener("click", () => {\n              void loadCatalogBiome(biome);'),
  'Catalog biome titles and locked photo slots should load that biome with the current seed.'
);

assert(
  uiSource.includes('await generateWorld(seed, undefined, { biomeId: saved.biomeId })'),
  'Saved catalog entries should revisit their saved seed and biome together.'
);

assert(
  uiSource.includes('const LOCATOR_HIDDEN_FLORA_VARIANTS = new Set([')
    && uiSource.includes('"pebble"')
    && uiSource.includes('if (inspect?.category === "flora" && LOCATOR_HIDDEN_FLORA_VARIANTS.has(inspect.variant)) return;')
    && uiSource.includes('const GROUND_COVER = LOCATOR_HIDDEN_FLORA_VARIANTS;'),
  'Current-biome locked catalog entries should use the same hidden ground-cover exclusions as the locator.'
);

assert(
  cssSource.includes('.catalog-panel')
    && cssSource.includes('.catalog-grid')
    && cssSource.includes('.catalog-card')
    && cssSource.includes('.catalog-biome-title:hover')
    && cssSource.includes('.photo-review-frame-label')
    && cssSource.includes('.photo-review-catalog-empty-status')
    && cssSource.includes('.photo-review-catalog .photo-action:hover')
    && cssSource.includes('.photo-review-compare'),
  'Catalog, frame label, action contrast, and compare UI should have dedicated styles.'
);
