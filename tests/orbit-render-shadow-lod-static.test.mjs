import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const lowfxSource = readFileSync(new URL('../src/lowfx.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const shadowsSource = readFileSync(new URL('../src/shadows.js', import.meta.url), 'utf8');
const biomesSource = readFileSync(new URL('../src/biomes.js', import.meta.url), 'utf8');

assert(
  lowfxSource.includes('export function rendererPixelRatioCap()')
    && lowfxSource.includes('isMobileViewport()')
    && lowfxSource.includes('return 1;')
    && lowfxSource.includes('if (LOWFX) return 1;')
    && lowfxSource.includes('if (MIDFX) return 1.5;')
    && lowfxSource.includes('return 2;'),
  'Renderer pixel ratio limits should be centralized and force mobile viewports to DPR 1 without changing desktop caps.'
);

assert(
  mainSource.includes('rendererPixelRatioCap')
    && mainSource.includes('renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererPixelRatioCap()));')
    && uiSource.includes('rendererPixelRatioCap')
    && uiSource.includes('renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererPixelRatioCap()));'),
  'Initial renderer setup and resize handling should use the same mobile-aware pixel ratio cap.'
);

assert(
  mainSource.includes('function frameDefaultOrbitToIsland()')
    && mainSource.includes('state.currentLayout?.boundRadius')
    && mainSource.includes('const scale = Math.max(1, radius / DEFAULT_ORBIT_RADIUS_ANCHOR) * DEFAULT_ORBIT_CLOSENESS;')
    && mainSource.includes('controls.maxDistance = Math.max(DEFAULT_ORBIT_MAX_DISTANCE, radius * 2.4);')
    && mainSource.includes('frameDefaultOrbitToIsland();')
    && mainSource.indexOf('frameDefaultOrbitToIsland();') < mainSource.indexOf('enterPortalArrivalIfRequested();'),
  'Default orbit should frame the generated island from its actual layout radius before portal arrival overrides can run.'
);

assert(
  shadowsSource.includes('const CONTACT_SHADOW_LOD_DISTANCE')
    && shadowsSource.includes('export function stepShadowDisks(disks, heightFn, focus)')
    && shadowsSource.includes('isWithinContactShadowLod')
    && shadowsSource.includes('focus?.x')
    && mainSource.includes('const contactShadowFocus = isAnyFP() ? camera.position : controls.target;')
    && mainSource.includes('stepShadowDisks(state.shadowDisks, state.heightFn, contactShadowFocus);'),
  'Soft contact shadow discs should be culled to objects near the active camera/focus area.'
);

assert(
  worldSource.includes('function applyStaticShadowLod(worldState, biome)')
    && worldSource.includes('staticCasterRadiusFrac')
    && worldSource.includes('object.castShadow = false;')
    && worldSource.includes('applyStaticShadowLod(worldState, biome);'),
  'World generation should apply distance-based shadow-map LOD to static shadow casters.'
);

const verdantBlock = biomesSource.slice(
  biomesSource.indexOf('id: "verdant"'),
  biomesSource.indexOf('id: "desert"')
);
assert(
  verdantBlock.includes('staticCasterRadiusFrac: 0.55'),
  'Verdant grove should opt into static shadow caster LOD so larger islands do not shadow-map every far prop.'
);
