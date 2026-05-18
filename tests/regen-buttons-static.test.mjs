import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert(
  htmlSource.includes('id="regen-same-biome"') && htmlSource.includes('same biome'),
  'HUD should include a same-biome regenerate button.'
);
assert(
  htmlSource.includes('id="regen-random-biome"') && htmlSource.includes('next biome'),
  'HUD should include a next-biome regenerate button.'
);
assert(
  !htmlSource.includes('id="regen"'),
  'The old single regenerate button id should be replaced by explicit split-button ids.'
);
assert(
  uiSource.includes('function pickSameBiomeSeed()')
    && uiSource.includes('allowedBiomeIds: state.currentBiome ? [state.currentBiome.id] : undefined'),
  'Same-biome regeneration should constrain newRandomSeed to the current biome id.'
);
assert(
  uiSource.includes('function pickRandomBiomeSeed()')
    && uiSource.includes('function nextEnabledBiomeId(currentBiomeId)')
    && uiSource.includes('const nextId = nextEnabledBiomeId(state.currentBiome?.id);')
    && uiSource.includes('allowedBiomeIds: nextId ? [nextId] : undefined'),
  'Next-biome regeneration should step through enabled biomes in BIOMES order and wrap.'
);
assert(
  uiSource.includes('wireRegenButton("regen-same-biome", pickSameBiomeSeed)')
    && uiSource.includes('wireRegenButton("regen-random-biome", pickRandomBiomeSeed)'),
  'Both regenerate buttons should be wired through the shared guarded regen flow.'
);
assert(
  uiSource.includes('document.getElementById("regen-random-biome").click()'),
  'Keyboard and auto-regenerate flows should use the ordered next-biome button behavior.'
);
assert(
  htmlSource.includes('next biome steps through enabled biomes; same biome stays current'),
  'Biome filter hint should explain that next-biome regeneration steps through enabled biome filters.'
);
assert(
  htmlSource.includes('stays in the current biome, ignoring biome-filter chips')
    && htmlSource.includes('steps to the next enabled biome')
    && htmlSource.includes('regenerate with the next-biome button behavior'),
  'Help panel should explain how same-biome, next-biome, and keyboard regeneration differ.'
);
assert(
  styleSource.includes('.regen-label { display: none; }'),
  'Very narrow viewports should hide regenerate button labels to avoid overflowing the controls row.'
);
