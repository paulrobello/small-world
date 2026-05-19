import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const skySource = readFileSync(new URL('../src/sky.js', import.meta.url), 'utf8');
const goldenSteppe = BIOMES.find((biome) => biome.id === 'golden');
const mossyRuins = BIOMES.find((biome) => biome.id === 'mossy');
const twilightMeadow = BIOMES.find((biome) => biome.id === 'twilight');
const coralAtoll = BIOMES.find((biome) => biome.id === 'coral');
const cloudIsland = BIOMES.find((biome) => biome.id === 'cloud');
const mushroomGrove = BIOMES.find((biome) => biome.id === 'grove');
const volcanicGlass = BIOMES.find((biome) => biome.id === 'obsidian');
const verdantGrove = BIOMES.find((biome) => biome.id === 'verdant');
const crimsonDunes = BIOMES.find((biome) => biome.id === 'desert');
const lavenderMarsh = BIOMES.find((biome) => biome.id === 'marsh');

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
assert(goldenSteppe, 'Golden steppe biome should exist.');
assert.equal(goldenSteppe.bloom, false, 'Golden steppe should opt out of bloom post-processing.');
assert.equal(goldenSteppe.softParticles, false, 'Golden steppe should opt out of soft particles.');
assert(mossyRuins, 'Mossy ruins biome should exist.');
assert.equal(mossyRuins.bloom, false, 'Mossy ruins should opt out of bloom post-processing.');
assert.equal(mossyRuins.softParticles, false, 'Mossy ruins should opt out of soft particles.');
assert(twilightMeadow, 'Twilight meadow biome should exist.');
assert.notEqual(twilightMeadow.bloom, false, 'Twilight meadow should keep bloom controlled by user settings.');
assert.equal(twilightMeadow.softParticles, false, 'Twilight meadow should opt out of soft particles.');
assert(coralAtoll, 'Coral atoll biome should exist.');
assert.equal(coralAtoll.bloom, false, 'Coral atoll should opt out of bloom post-processing.');
assert.equal(coralAtoll.softParticles, false, 'Coral atoll should opt out of soft particles.');
assert(cloudIsland, 'Cloud island biome should exist.');
assert.equal(cloudIsland.bloom, false, 'Cloud island should opt out of bloom post-processing.');
assert.equal(cloudIsland.softParticles, false, 'Cloud island should opt out of soft particles.');
assert(mushroomGrove, 'Mushroom grove biome should exist.');
assert.notEqual(mushroomGrove.bloom, false, 'Mushroom grove should keep bloom controlled by user settings.');
assert.equal(mushroomGrove.softParticles, false, 'Mushroom grove should opt out of soft particles.');
assert(volcanicGlass, 'Volcanic glass biome should exist.');
assert.notEqual(volcanicGlass.bloom, false, 'Volcanic glass should keep bloom controlled by user settings.');
assert.equal(volcanicGlass.softParticles, false, 'Volcanic glass should opt out of soft particles.');
assert(verdantGrove, 'Verdant grove biome should exist.');
assert.notEqual(verdantGrove.bloom, false, 'Verdant grove should keep bloom controlled by user settings.');
assert.equal(verdantGrove.softParticles, false, 'Verdant grove should opt out of soft particles.');
assert(crimsonDunes, 'Crimson dunes biome should exist.');
assert.equal(crimsonDunes.bloom, false, 'Crimson dunes should opt out of bloom post-processing.');
assert.equal(crimsonDunes.softParticles, false, 'Crimson dunes should opt out of soft particles.');
assert(lavenderMarsh, 'Lavender marsh biome should exist.');
assert.notEqual(lavenderMarsh.bloom, false, 'Lavender marsh should keep bloom controlled by user settings.');
assert.equal(lavenderMarsh.softParticles, false, 'Lavender marsh should opt out of soft particles.');
assert(
  environmentSource.includes('biome.softParticles !== false'),
  'Particle creation should keep soft particles disabled for biomes that opt out.'
);
assert(
  uiSource.includes('const softParticlesOverridden = state.currentBiome?.softParticles === false;'),
  'Soft particles controls should be treated as overridden when the current biome disables them.'
);
assert(
  uiSource.includes('softParticlesEl.parentElement.hidden = softParticlesOverridden;'),
  'The soft particles checkbox should be hidden while a biome disables soft particles.'
);
assert(
  uiSource.includes('state.currentBiome?.softParticles !== false'),
  'The FX toggle should not re-enable soft particles while the current biome opts out.'
);
