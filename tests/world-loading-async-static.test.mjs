import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  htmlSource.includes('id="world-loading"')
    && htmlSource.includes('aria-live="polite"')
    && htmlSource.includes('Crafting new world'),
  'The page should include an accessible loading screen with the requested copy.'
);

assert(
  styleSource.includes('.world-loading')
    && styleSource.includes('.world-loading.is-visible')
    && styleSource.includes('z-index: 40'),
  'The loading screen should cover the viewport while world generation is active.'
);

assert(
  stateSource.includes('isGeneratingWorld: false'),
  'Shared state should expose whether async world generation is in progress.'
);

assert(
  worldSource.includes('export async function generateWorld(seed, context = createWorldBuildContext(), options = {})')
    && worldSource.includes('context.setLoading(true)')
    && worldSource.includes('context.setLoading(false)')
    && worldSource.includes('await nextGenerationFrame()')
    && worldSource.includes('async function yieldIfNeeded')
    && worldSource.includes('restoreRandom();\n    await nextGenerationFrame();')
    && worldSource.includes('installSeededRandom();')
    && worldSource.includes('const seededRandom = mulberry32(seed)'),
  'World generation should yield to the browser while preserving seeded RNG determinism.'
);

assert(
  mainSource.includes('state.isGeneratingWorld || isSelectingCreature() || isManualPaused()')
    && mainSource.includes('readBiomeFromUrl')
    && mainSource.includes('void generateWorld(initialSeed, undefined, { biomeId: readBiomeFromUrl() }).then'),
  'The animation loop should pause simulation during generation and boot should not block on generation or ignore URL biome overrides.'
);

assert(
  uiSource.includes('setTimeout(async () =>')
    && uiSource.includes('await generateWorld(pickSeed())')
    && uiSource.includes('text.addEventListener("click", async () =>')
    && uiSource.includes('await generateWorld(bm.seed)')
    && uiSource.includes('void generateWorld(s, undefined, { biomeId: readBiomeFromUrl() }).catch'),
  'Regenerate, bookmarks, and browser history should use the async generation API and preserve URL biome overrides.'
);
