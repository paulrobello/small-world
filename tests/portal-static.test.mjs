import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const portalUrl = new URL('../src/portal.js', import.meta.url);
assert(existsSync(portalUrl), 'A dedicated portal module should own portal preview rendering.');

const portalSource = readFileSync(portalUrl, 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('portal: null')
    && stateSource.includes('portals: []'),
  'Shared state should track the active biome portal plus every placed portal for render-loop updates and disposal.'
);

assert(
  stateSource.includes('portalEnabled: false')
    && stateSource.includes('portalDoublePlacement: false')
    && stateSource.includes('portalPreviewGrass: false')
    && stateSource.includes('portalPreviewFlora: true')
    && stateSource.includes('portalPreviewCreatures: false')
    && stateSource.includes('portalPreviewFx: true')
    && stateSource.includes('portalPanelOpen: false')
    && uiSource.includes('"portalEnabled"')
    && uiSource.includes('"portalDoublePlacement"')
    && uiSource.includes('"portalPreviewGrass"')
    && uiSource.includes('"portalPreviewFlora"')
    && uiSource.includes('"portalPreviewCreatures"')
    && uiSource.includes('"portalPreviewFx"')
    && uiSource.includes('"portalPanelOpen"'),
  'Portal settings should persist default-off portals, default-off double placement, and preview detail defaults.'
);

assert(
  portalSource.includes('export function createBiomePortal')
    && portalSource.includes('export function updatePortalPreview')
    && portalSource.includes('export function disposePortal')
    && portalSource.includes('targetSeed = seed')
    && portalSource.includes('targetSeed,')
    && portalSource.includes('new THREE.WebGLRenderTarget')
    && portalSource.includes('PortalPreview')
    && portalSource.includes('PortalRing')
    && portalSource.includes('PortalView')
    && portalSource.includes('const PORTAL_GROUND_SINK = 0.18 + PORTAL_RING_RADIUS * 0.1')
    && portalSource.includes('group.position.set(x, y + PORTAL_RING_RADIUS - PORTAL_GROUND_SINK, z)')
    && portalSource.includes('color: new THREE.Color(targetBiome.cliff).lerp(new THREE.Color(targetBiome.accent), 0.35)')
    && portalSource.includes('emissive: new THREE.Color(targetBiome.accent).multiplyScalar(0.18)'),
  'portal.js should create a destination-palette render-target-backed portal ring and view, sunk into the ground.'
);

assert(
  portalSource.includes('const PORTAL_RT_SIZE = LOWFX ? 256 : 768')
    && portalSource.includes('lastRenderAt')
    && portalSource.includes('PORTAL_RENDER_INTERVAL_MS')
    && portalSource.includes('const PORTAL_ACTIVE_DISTANCE = LOWFX ? 52 : 90')
    && portalSource.includes('camera.position.distanceTo(portal.group.position)'),
  'Portal preview rendering should be high enough fidelity for close viewing while remaining throttled/distance-gated for FPS.'
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
    && portalSource.includes('uDistortStrength: { value: LOWFX ? 0.00675 : 0.01125 }')
    && portalSource.includes('atan(p.y, p.x)')
    && portalSource.includes('vec2 backUv = vec2(1.0 - warpedUv.x, warpedUv.y)')
    && portalSource.includes('texture2D(tPortalFront, warpedUv)')
    && portalSource.includes('texture2D(tPortalBack, backUv)')
    && portalSource.includes('portal.view.material.uniforms.uTime.value = nowSeconds'),
  'Portal view shader should animate a radial UV distortion for a wavy, shimmery portal surface.'
);

assert(
  portalSource.includes('tPortalFront')
    && portalSource.includes('tPortalBack')
    && portalSource.includes('gl_FrontFacing ? frontCol : backCol')
    && portalSource.includes('PORTAL_ARRIVAL_OFFSET')
    && portalSource.includes('function previewPortalEyeY(heightFn, x, z)')
    && portalSource.includes('return heightFn(x, z) + 1.9')
    && portalSource.includes('function positionPreviewCamera(camera, portalAnchor, heightFn, side)')
    && portalSource.includes('portalAnchor.x + portalAnchor.nx * PORTAL_ARRIVAL_OFFSET * side')
    && portalSource.includes('camera.position.set(x, y, z)')
    && portalSource.includes('camera.lookAt(lookX, y, lookZ)')
    && portalSource.includes('export function getPortalSideArrivalPose(portal, side = 1)')
    && portalSource.includes('yaw: Math.atan2(normal.x * sideSign, normal.z * sideSign) + Math.PI')
    && portalSource.includes('export function getPortalCameraSide(portal, camera, worldScale = 1)')
    && portalSource.includes('return (dx * normal.x + dz * normal.z) >= 0 ? 1 : -1')
    && portalSource.includes('function syncPreviewProjectionToCamera(previewCamera, camera)')
    && portalSource.includes('const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * aspect)')
    && portalSource.includes('previewCamera.fov = THREE.MathUtils.radToDeg(Math.max(vFov, hFov))')
    && portalSource.includes('previewCamera.zoom = camera.zoom')
    && portalSource.includes('previewCamera.updateProjectionMatrix()')
    && portalSource.includes('positionPreviewCamera(previewFrontCamera, portalAnchor, heightFn, 1)')
    && portalSource.includes('positionPreviewCamera(previewBackCamera, portalAnchor, heightFn, -1)')
    && portalSource.includes('frontRt')
    && portalSource.includes('backRt')
    && portalSource.includes('previewFrontCamera')
    && portalSource.includes('previewBackCamera')
    && portalSource.includes('syncPreviewProjectionToCamera(portal.previewFrontCamera, camera)')
    && portalSource.includes('syncPreviewProjectionToCamera(portal.previewBackCamera, camera)')
    && portalSource.includes('renderer.render(portal.previewScene, portal.previewFrontCamera)')
    && portalSource.includes('renderer.render(portal.previewScene, portal.previewBackCamera)'),
  'Portal disc should render opposite connected-world viewpoints using a player-matched preview projection.'
);

assert(
  portalSource.includes('buildPortalPreviewScene')
    && portalSource.includes('makeHeightFn')
    && portalSource.includes('pickLayout')
    && portalSource.includes('Math.random(); // consume the biome roll exactly like generateWorld')
    && portalSource.includes('const TERRAIN_NOISE_SEED_XOR = 0x5eed5eed')
    && portalSource.includes('createNoise2D(mulberry32((seed ^ TERRAIN_NOISE_SEED_XOR) >>> 0))')
    && portalSource.includes('const terrainAmp = targetBiome.cloudlike ? 2.15 : 3.2')
    && portalSource.includes('targetBiome.water')
    && portalSource.includes('export function makeSeededPortalPlacement')
    && portalSource.includes('const rngSeed = ((seed >>> 0)')
    && portalSource.includes('maxRadiusFrac = 0.54')
    && portalSource.includes('minRadiusFrac = 0')
    && portalSource.includes('preferredAngle = null')
    && portalSource.includes('const isInsideMinRadius = (x, z) =>')
    && portalSource.includes('const buildPlacement = (p, y) =>')
    && portalSource.includes('withSeededRandom(rngSeed + tries, () => pickGroundPoint(maxRadiusFrac, { layout }))')
    && portalSource.includes('isInsideMinRadius(p.x, p.z)')
    && portalSource.includes('const radius = (layout?.boundRadius ?? 0) * Math.max(minRadiusFrac, maxRadiusFrac * 0.92)')
    && portalSource.includes('const baseAngle = preferredAngle ?? (mulberry32(rngSeed)() * Math.PI * 2)')
    && portalSource.includes('const heading = Math.atan2(-p.x, -p.z)')
    && portalSource.includes('flatZones: [')
    && portalSource.includes('function applyPreviewFlatZones')
    && portalSource.includes('const portalAnchor = makeSeededPortalPlacement({ seed, index: 0, layout, heightFn: rawHeightFn })')
    && portalSource.includes('function isInPortalPreviewSightline')
    && portalSource.includes('targetBiome.flora[Math.floor(rng() * targetBiome.flora.length)]')
    && portalSource.includes('import { FLORA_BUILDERS }')
    && portalSource.includes('clonePreviewObjectUnique(builder(targetBiome))')
    && portalSource.includes('makeGrassField(targetBiome, heightFn')
    && portalSource.includes('makeCreature(targetBiome).group')
    && portalSource.includes('function makePreviewFloraGroundY')
    && portalSource.includes('const PREVIEW_FLORA_BURY = 0.08')
    && portalSource.includes('heightFn(x + fp, z)')
    && portalSource.includes('function isNearPortalPreviewClearance')
    && portalSource.includes('if (isNearPortalPreviewClearance(p.x, p.z, fp, portalAnchor)) continue')
    && portalSource.includes('makeSkyDome')
    && portalSource.includes('previewScene.add')
    && !portalSource.includes('PREVIEW_HERO_FLORA_SPOTS')
    && !portalSource.includes('PREVIEW_HERO_CREATURE_SPOTS')
    && !portalSource.includes('PREVIEW_GRASS_PATCHES')
    && !portalSource.includes('function makePreviewFloraObject')
    && !portalSource.includes('maxDensityMultiplier: 1')
    && !portalSource.includes('initialDensity: 1')
    && !portalSource.includes('makeCaterpillar('),
  'The portal preview should replay the destination seed terrain/layout and render the destination biome with production flora, grass, and creature builders.'
);

assert(
  portalSource.includes('function normalizePortalPreviewSettings')
    && portalSource.includes('function makePreviewGrass')
    && portalSource.includes('function makePreviewCreatures')
    && portalSource.includes('while (placed < targetCount && attempts < targetCount * 10)')
    && portalSource.includes('while (placed < count && attempts < count * 10)')
    && portalSource.includes('if (isInPortalPreviewSightline(p.x, p.z, portalAnchor)) continue')
    && portalSource.includes('function withPreviewWorldState')
    && portalSource.includes('x: portalAnchor.x')
    && portalSource.includes('z: portalAnchor.z')
    && portalSource.includes('nx: portalAnchor.nx')
    && portalSource.includes('nz: portalAnchor.nz')
    && portalSource.includes('const portalClearCapsules = [{')
    && portalSource.includes('halfLength: PORTAL_GRASS_CLEAR_HALF_LENGTH')
    && portalSource.includes('const grass = makeGrassField(targetBiome, heightFn, [], portalShortGrass, portalClearCapsules)')
    && portalSource.includes('makePreviewFloraGroundY(kind, scaleMul, p.x, p.z, heightFn)')
    && portalSource.includes('creature.position.set(p.x, y + 0.18, p.z)')
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
    && worldSource.includes('newRandomSeed')
    && worldSource.includes('disposeWorldPortals(worldState)')
    && worldSource.includes('worldState.portal = null')
    && worldSource.includes('worldState.portals = []')
    && worldSource.includes('function getPortalTargetBiomes')
    && worldSource.includes('worldState.userSettings.portalDoublePlacement === true')
    && worldSource.includes('const portalTargets = getPortalTargetBiomes')
    && worldSource.includes('const TERRAIN_NOISE_SEED_XOR = 0x5eed5eed')
    && worldSource.includes('createNoise2D(mulberry32((seed ^ TERRAIN_NOISE_SEED_XOR) >>> 0))')
    && worldSource.includes('for (let portalIndex = 0; portalIndex < portalTargets.length; portalIndex++)')
    && worldSource.includes('const targetBiome = portalTargets[portalIndex]')
    && worldSource.includes('const portalPlacementAnchors = []')
    && worldSource.includes('const portalMinDistSq = worldState.ISLAND_RADIUS * worldState.ISLAND_RADIUS')
    && worldSource.includes('const p = makeSeededPortalPlacement')
    && worldSource.includes('index: portalIndex')
    && worldSource.includes('maxRadiusFrac: worldState.userSettings.portalDoublePlacement === true ? 0.72 : 0.54')
    && worldSource.includes('minRadiusFrac: worldState.userSettings.portalDoublePlacement === true ? 0.48 : 0')
    && worldSource.includes('preferredAngle: portalPlacementAnchors.length')
    && worldSource.includes('isBlocked: (x, z) => blocksFloraPlacement(x, z, 2.2)')
    && worldSource.includes('portalPlacementAnchors.some((anchor) =>')
    && worldSource.includes('portalPlacementAnchors.push({ x: p.x, z: p.z })')
    && worldSource.includes('const portal = createBiomePortal')
    && worldSource.includes('const targetSeed = newRandomSeed({ allowedBiomeIds: [targetBiome.id], excludeBiomeId: biome.id })')
    && worldSource.includes('const portalGroundY = p.y')
    && worldSource.includes('for (const zone of p.flatZones) flattenTerrainCircle(zone.cx, zone.cz, zone.r, zone.flatY)')
    && worldSource.includes('worldState.portals.push(portal)')
    && worldSource.includes('if (worldState.userSettings.portalEnabled !== false)')
    && worldSource.includes('previewSettings: worldState.userSettings')
    && worldSource.includes('targetSeed')
    && worldSource.includes('floraPlacementBlocks.push(portal.blocker)')
    && worldSource.includes('const portalGrassClearances = floraPlacementBlocks')
    && worldSource.includes('const groundCoverExclusions = floraPlacementBlocks')
    && worldSource.includes('.filter(b => b.kind === "fairyring" || b.kind === "portal")')
    && worldSource.includes('.filter(b => b.kind === "portal" && b.grassClearance)')
    && worldSource.includes('makeGrassField(biome, worldState.heightFn, coverExclusions, grassShorteners, portalGrassClearances)')
    && worldSource.includes('makeWildflowerField(biome, worldState.heightFn, groundCoverExclusions)')
    && worldSource.includes('makeVerdantGroveDetails(biome, worldState.heightFn, groundCoverExclusions)')
    && worldSource.includes('worldState.obstacles.push(portal.obstacle)')
    && worldSource.includes('PLACEMENT_BLOCK_KINDS = new Set(["lavafissure", "portal"])')
    && worldSource.includes('"portal", "berrybush"')
    && worldSource.includes('GROUND_CREATURE_BLOCK_KINDS = new Set(["lavafissure", "fairyring", "portal"])')
    && worldSource.includes('CRAWLER_BLOCK_KINDS = new Set(["lavafissure", "fairyring", "portal"])')
    && worldSource.includes('makeSeededPortalPlacement')
    && portalSource.includes('const PORTAL_FLORA_BLOCK_RADIUS = PORTAL_RING_RADIUS + 1.0')
    && portalSource.includes('const PORTAL_GRASS_CLEAR_HALF_LENGTH = 2.08')
    && portalSource.includes('const PORTAL_GRASS_SHORTEN_RADIUS = PORTAL_RING_RADIUS * 1.45')
    && portalSource.includes('const PORTAL_GRASS_SHORTEN_TO = 0.14')
    && portalSource.includes('const PORTAL_PREVIEW_FLATTEN_RADIUS = 4.2')
    && portalSource.includes('const PORTAL_PREVIEW_FLATTEN_SIDE_RADIUS = 2.8')
    && portalSource.includes('const PORTAL_PREVIEW_GROUND_SINK = 0.15')
    && portalSource.includes('r: PORTAL_FLORA_BLOCK_RADIUS')
    && portalSource.includes('halfLength: PORTAL_GRASS_CLEAR_HALF_LENGTH')
    && worldSource.includes('const footprintBase = FLORA_FOOTPRINT[kind] ?? FLORA_FOOTPRINT_DEFAULT')
    && worldSource.includes('let fp = footprintBase * s')
    && worldSource.includes('const giantFp = footprintBase * giantS')
    && worldSource.includes('if (blocksFloraPlacement(p.x, p.z, giantFp * 1.2, placementBlockKinds)) continue')
    && worldSource.includes('fp = giantFp')
    && grassSource.includes('function pointInExcludedCapsule')
    && grassSource.includes('const along = Math.max(-c.halfLength, Math.min(c.halfLength, dx * c.nx + dz * c.nz))')
    && grassSource.includes('for (const c of excludedCapsules)')
    && portalSource.includes('kind: "portal"'),
  'World generation should dispose prior portals, optionally place two unique-target portals, flatten their terrain pads, sink them, clear grass along their normals, and register them as flora/creature blockers.'
);

assert(
  uiSource.includes('updatePortalPreviewSettings')
    && uiSource.includes('disposePortal')
    && uiSource.includes('function eachPortal')
    && uiSource.includes('function disposeStatePortals')
    && uiSource.includes('setting-portal-details')
    && uiSource.includes('setting-portal-enabled')
    && uiSource.includes('setting-portal-double')
    && uiSource.includes('setting-portal-grass')
    && uiSource.includes('setting-portal-flora')
    && uiSource.includes('setting-portal-creatures')
    && uiSource.includes('setting-portal-fx')
    && uiSource.includes('state.userSettings.portalEnabled = portalEnabledEl.checked')
    && uiSource.includes('state.userSettings.portalDoublePlacement = portalDoubleEl.checked')
    && uiSource.includes('state.obstacles = state.obstacles.filter((o) => o.kind !== "portal")')
    && uiSource.includes('buildObstacleGrid(state.obstacles)')
    && uiSource.includes('void generateWorld(state.currentSeed)')
    && uiSource.includes('eachPortal((portal) => updatePortalPreviewSettings(portal, state.userSettings))')
    && uiSource.includes('state.userSettings.portalPanelOpen'),
  'The settings UI should expose live portal enable/double/preview toggles and persist the portal panel open state.'
);

assert(
  mainSource.includes('updatePortalPreview')
    && mainSource.includes('measurePerfPhase("portalPreview"')
    && mainSource.includes('function getActivePortals()')
    && mainSource.includes('for (const portal of getActivePortals())')
    && mainSource.includes('updatePortalPreview(portal, renderer, camera, rawT)'),
  'The animation loop should update every portal preview in a dedicated measured phase before the main render.'
);
