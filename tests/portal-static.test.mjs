import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const portalUrl = new URL('../src/portal.js', import.meta.url);
assert(existsSync(portalUrl), 'A dedicated portal module should own portal preview rendering.');

const portalSource = readFileSync(portalUrl, 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('portal: null'),
  'Shared state should track the active biome portal for render-loop updates and disposal.'
);

assert(
  stateSource.includes('portalPreviewGrass: false')
    && stateSource.includes('portalPreviewFlora: true')
    && stateSource.includes('portalPreviewCreatures: false')
    && stateSource.includes('portalPreviewFx: true')
    && stateSource.includes('portalPanelOpen: false')
    && uiSource.includes('"portalPreviewGrass"')
    && uiSource.includes('"portalPreviewFlora"')
    && uiSource.includes('"portalPreviewCreatures"')
    && uiSource.includes('"portalPreviewFx"')
    && uiSource.includes('"portalPanelOpen"'),
  'Portal preview detail settings should have persisted defaults for grass, flora, creatures, and local FX.'
);

assert(
  portalSource.includes('export function createBiomePortal')
    && portalSource.includes('export function updatePortalPreview')
    && portalSource.includes('export function disposePortal')
    && portalSource.includes('new THREE.WebGLRenderTarget')
    && portalSource.includes('PortalPreview')
    && portalSource.includes('PortalRing')
    && portalSource.includes('PortalView'),
  'portal.js should create, update, and dispose a render-target-backed portal ring and view.'
);

assert(
  portalSource.includes('const PORTAL_RT_SIZE = LOWFX ? 192 : 384')
    && portalSource.includes('lastRenderAt')
    && portalSource.includes('PORTAL_RENDER_INTERVAL_MS')
    && portalSource.includes('const PORTAL_ACTIVE_DISTANCE = LOWFX ? 52 : 90')
    && portalSource.includes('camera.position.distanceTo(portal.group.position)'),
  'Portal preview rendering should be low resolution and throttled/distance-gated for FPS.'
);

assert(
  portalSource.includes('side: THREE.DoubleSide'),
  'Portal view material should render from either side for first-person traversal.'
);

assert(
  portalSource.includes('const PORTAL_VIEW_RADIUS = PORTAL_RING_RADIUS - 0.04')
    && portalSource.includes('smoothstep(0.86, 1.0, d)')
    && portalSource.includes('smoothstep(0.985, 1.0, d)'),
  'Portal view should overlap under the ring with only a narrow rim fade so the preview fills the opening.'
);

assert(
  portalSource.includes('depthWrite: true'),
  'Portal view should write depth so screen-space depth outlines do not draw terrain/object edges over it.'
);

assert(
  portalSource.includes('uTime: { value: 0 }')
    && portalSource.includes('uDistortStrength: { value: LOWFX ? 0.009 : 0.015 }')
    && portalSource.includes('atan(p.y, p.x)')
    && portalSource.includes('texture2D(tPortalFront, warpedUv)')
    && portalSource.includes('texture2D(tPortalBack, warpedUv)')
    && portalSource.includes('portal.view.material.uniforms.uTime.value = nowSeconds'),
  'Portal view shader should animate a radial UV distortion for a wavy, shimmery portal surface.'
);

assert(
  portalSource.includes('tPortalFront')
    && portalSource.includes('tPortalBack')
    && portalSource.includes('gl_FrontFacing ? frontCol : backCol')
    && portalSource.includes('frontRt')
    && portalSource.includes('backRt')
    && portalSource.includes('previewFrontCamera')
    && portalSource.includes('previewBackCamera')
    && portalSource.includes('renderer.render(portal.previewScene, portal.previewFrontCamera)')
    && portalSource.includes('renderer.render(portal.previewScene, portal.previewBackCamera)'),
  'Portal disc should render opposite connected-world viewpoints on its front and back faces.'
);

assert(
  portalSource.includes('buildPortalPreviewScene')
    && portalSource.includes('makeHeightFn')
    && portalSource.includes('makeSkyDome')
    && portalSource.includes('previewScene.add')
    && !portalSource.includes('makeCreature(')
    && !portalSource.includes('makeCaterpillar('),
  'The portal preview should render a lightweight connected biome scene without creatures.'
);

assert(
  portalSource.includes('function normalizePortalPreviewSettings')
    && portalSource.includes('function makePreviewGrass')
    && portalSource.includes('function makePreviewCreatures')
    && portalSource.includes('if (settings.portalPreviewFlora) previewScene.add(makePreviewFlora')
    && portalSource.includes('if (settings.portalPreviewGrass) previewScene.add(makePreviewGrass')
    && portalSource.includes('if (settings.portalPreviewCreatures) previewScene.add(makePreviewCreatures')
    && portalSource.includes('uFxStrength: { value: settings.portalPreviewFx ? 1 : 0 }')
    && portalSource.includes('export function updatePortalPreviewSettings')
    && portalSource.includes('disposeGroup(portal.previewScene)'),
  'Portal preview settings should gate grass, flora, preview creatures, and lightweight local FX, with live rebuild support.'
);

assert(
  worldSource.includes('createBiomePortal')
    && worldSource.includes('disposePortal(worldState.portal)')
    && worldSource.includes('worldState.portal = null')
    && worldSource.includes('const portal = createBiomePortal')
    && worldSource.includes('previewSettings: worldState.userSettings')
    && worldSource.includes('floraPlacementBlocks.push(portal.blocker)')
    && worldSource.includes('worldState.obstacles.push(portal.obstacle)')
    && portalSource.includes('kind: "portal"'),
  'World generation should dispose prior portals, place one new portal, and register it as a flora/creature blocker.'
);

assert(
  uiSource.includes('updatePortalPreviewSettings')
    && uiSource.includes('setting-portal-details')
    && uiSource.includes('setting-portal-grass')
    && uiSource.includes('setting-portal-flora')
    && uiSource.includes('setting-portal-creatures')
    && uiSource.includes('setting-portal-fx')
    && uiSource.includes('updatePortalPreviewSettings(state.portal, state.userSettings)')
    && uiSource.includes('state.userSettings.portalPanelOpen'),
  'The settings UI should expose live portal preview toggles and persist the portal panel open state.'
);

assert(
  mainSource.includes('updatePortalPreview')
    && mainSource.includes('measurePerfPhase("portalPreview"')
    && mainSource.includes('updatePortalPreview(state.portal, renderer, camera, rawT)'),
  'The animation loop should update the portal preview in a dedicated measured phase before the main render.'
);
