import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const skySource = readFileSync(new URL('../src/sky.js', import.meta.url), 'utf8');

assert.equal(
  htmlSource.includes('setting-terrain-smooth'),
  false,
  'Smooth terrain shading should not be exposed as a settings checkbox.'
);
assert.equal(
  htmlSource.includes('setting-grass-edge-discs'),
  false,
  'Grass edge disc display should not be exposed as a settings checkbox.'
);
assert.equal(
  uiSource.includes('"terrainSmoothShading"') || uiSource.includes('"grassEdgeDiscs"'),
  false,
  'Removed settings should not be persisted from older localStorage values.'
);
assert.equal(
  stateSource.includes('terrainSmoothShading') || stateSource.includes('grassEdgeDiscs'),
  false,
  'Removed settings should not remain in userSettings defaults.'
);
assert(
  worldSource.includes('terrain.material.flatShading = false;'),
  'Terrain should always force smooth shading after construction.'
);
assert.equal(
  worldSource.includes('state.userSettings.terrainSmoothShading'),
  false,
  'Terrain smooth shading should not depend on user settings.'
);
assert(
  skySource.includes('if (isGrassAura && LOWFX) return null;'),
  'Grass edge aura should only be suppressed by low-fx mode, not by a settings toggle.'
);
assert.equal(
  skySource.includes('grassEdgeDiscs'),
  false,
  'Grass edge aura should not read a user setting.'
);
assert(
  uiSource.includes('function syncBiomeOverrideSettings()'),
  'UI should have a sync hook for controls hidden by biome overrides.'
);
assert(
  uiSource.includes('const bloomOverridden = state.currentBiome?.bloom === false;'),
  'Bloom controls should be treated as overridden when the current biome disables bloom.'
);
assert(
  uiSource.includes('bloomEl.parentElement.hidden = bloomOverridden;'),
  'The bloom checkbox should be hidden while a biome disables bloom.'
);
assert(
  uiSource.includes('bloomRadiusEl.parentElement.hidden = bloomOverridden;'),
  'The bloom radius control should be hidden while a biome disables bloom.'
);
