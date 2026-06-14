import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert(
  htmlSource.includes('id="setting-catalog"')
    && htmlSource.includes('id="catalog-panel"')
    && htmlSource.includes('id="catalog-list"'),
  'Markup should expose a settings entry point and catalog panel.'
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
  uiSource.includes('findPhotoCatalogSubject({ camera, root: state.world })'),
  'Photo capture should resolve the reticle catalog subject from the current world.'
);

assert(
  uiSource.includes('new catalog entry')
    && uiSource.includes('already in catalog')
    && uiSource.includes('photo-review-keep')
    && uiSource.includes('photo-review-replace'),
  'Photo review should render new-entry and existing-entry catalog actions.'
);

assert(
  uiSource.includes('async function renderCatalogPanel')
    && uiSource.includes('URL.createObjectURL')
    && uiSource.includes('visit seed'),
  'Catalog panel should render stored thumbnails and seed revisit actions.'
);

assert(
  cssSource.includes('.catalog-panel')
    && cssSource.includes('.catalog-grid')
    && cssSource.includes('.catalog-card')
    && cssSource.includes('.photo-review-compare'),
  'Catalog and compare UI should have dedicated styles.'
);
