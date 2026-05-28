import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const perfProbeUrl = new URL('../src/perfProbe.js', import.meta.url);

assert(
  existsSync(perfProbeUrl),
  'A dedicated perf probe module should exist so the instrumentation is isolated from the render loop.'
);

const perfProbeSource = readFileSync(perfProbeUrl, 'utf8');

assert(
  mainSource.includes('from "./src/perfProbe.js";')
    && mainSource.includes('startPerfProbe')
    && mainSource.includes('startPerfProbe({ state, scene, renderer });'),
  'main.js should wire the perf probe into the existing scene debug surface.'
);

assert(
  perfProbeSource.includes('new URLSearchParams(window.location.search).get("perf")')
    && perfProbeSource.includes('if (!isPerfProbeEnabled()) return;'),
  'The perf probe should be URL-gated by ?perf=1 and do nothing during normal play.'
);

assert(
  perfProbeSource.includes('requestAnimationFrame')
    && perfProbeSource.includes('state.isGeneratingWorld')
    && perfProbeSource.includes('state.currentBiome'),
  'The perf probe should wait for generated worlds and collect frame timings through requestAnimationFrame.'
);

assert(
  perfProbeSource.includes('window.__swPerf')
    && perfProbeSource.includes('[small-world:perf]')
    && perfProbeSource.includes('shadowCastersByParentVariant')
    && perfProbeSource.includes('microFloraShadows')
    && perfProbeSource.includes('leafballCanopyProxy')
    && perfProbeSource.includes('staticCasterRadiusFrac'),
  'The perf report should expose a devtools object, console marker, shadow caster breakdown, and biome LOD flags.'
);

assert(
  perfProbeSource.includes('beginPerfFrame')
    && perfProbeSource.includes('measurePerfPhase')
    && perfProbeSource.includes('phaseTimings')
    && perfProbeSource.includes('summarizePhaseTimings'),
  'The perf probe should capture CPU-side phase timings, not just render-adjacent scene counts.'
);

assert(
  mainSource.includes('beginPerfFrame();')
    && mainSource.includes('endPerfFrame();')
    && mainSource.includes('measurePerfPhase("dynamicCollisionObstacles"')
    && mainSource.includes('measurePerfPhase("creatureMovement"')
    && mainSource.includes('measurePerfPhase("caterpillarMovement"')
    && mainSource.includes('measurePerfPhase("airborneMovement"')
    && mainSource.includes('measurePerfPhase("environmentAnimation"')
    && mainSource.includes('measurePerfPhase("render"'),
  'The animation loop should profile collision, movement, environment, and render buckets separately.'
);
