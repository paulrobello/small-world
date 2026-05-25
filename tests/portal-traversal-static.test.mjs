import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const portalSource = readFileSync(new URL('../src/portal.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  devicePixelRatio: 2,
  innerWidth: 1280,
  innerHeight: 720,
};
const { getPortalArrivalPose } = await import('../src/portal.js');

assert(
  portalSource.includes('export function isCameraPassingThroughPortal')
    && portalSource.includes('PORTAL_TRAVEL_PLANE_EPSILON')
    && portalSource.includes('PORTAL_TRAVEL_RADIUS')
    && portalSource.includes('camera.position.x * invWorldScale')
    && portalSource.includes('return planeDist < PORTAL_TRAVEL_PLANE_EPSILON'),
  'portal.js should expose a first-person traversal hit test against the portal disc.'
);

assert(
  portalSource.includes('export function getPortalArrivalPose')
    && portalSource.includes('PORTAL_ARRIVAL_OFFSET')
    && portalSource.includes('yaw: Math.atan2(normal.x, normal.z) + Math.PI'),
  'portal.js should expose a landing pose just outside a destination portal facing away from it.'
);

{
  const pose = getPortalArrivalPose({
    group: {
      position: { x: 0, z: 0 },
      rotation: { y: 0 },
    },
  });
  const forward = { x: -Math.sin(pose.yaw), z: -Math.cos(pose.yaw) };
  const away = { x: pose.x, z: pose.z };
  const dot = forward.x * away.x + forward.z * away.z;
  assert(dot > 0, 'portal arrival yaw should face away from the portal on the arrival side.');
}

assert(
  worldSource.includes('portalTargetBiomeId: overrides.portalTargetBiomeId ?? readPortalTargetBiomeIdFromUrl()')
    && worldSource.includes('readPortalTargetBiomeIdFromUrl()')
    && worldSource.includes('BIOMES.find((b) => b.id === context.portalTargetBiomeId)')
    && worldSource.includes('?? BIOMES[(biomeIndex + 1 + BIOMES.length) % BIOMES.length]'),
  'world generation should let a portal URL/context override the next portal target biome for return links.'
);

assert(
  uiSource.includes('export function setStrollLocalPose')
    && uiSource.includes('if (!_stroll) return false')
    && uiSource.includes('_stroll.camera.position.set(localX * ws, groundY + 1.9 * ws, localZ * ws)')
    && uiSource.includes('_stroll.keys = { w: false, a: false, s: false, d: false, shift: false }')
    && uiSource.includes('export function enterStrollFromPortal'),
  'ui.js should be able to start/reposition the first-person stroll camera after portal travel.'
);

assert(
  uiSource.includes('let _requestStrollPointerLock = () => {};')
    && uiSource.includes('function requestStrollPointerLock(armRetry = false)')
    && uiSource.includes('canvas.addEventListener("pointerdown", retryPointerLock, { once: true })')
    && uiSource.includes('_requestStrollPointerLock(true);')
    && uiSource.includes('if (document.pointerLockElement !== canvas) return;')
    && uiSource.includes('hasPointerLock: false')
    && uiSource.includes('_stroll.hasPointerLock = true')
    && uiSource.includes('if (_stroll.hasPointerLock) exitStroll();'),
  'Portal arrival should request pointer lock again on the next canvas gesture and ignore mouse-look deltas until locked.'
);

assert(
  mainSource.includes('formatSeed')
    && mainSource.includes('isCameraPassingThroughPortal')
    && mainSource.includes('getPortalArrivalPose')
    && mainSource.includes('enterStrollFromPortal')
    && mainSource.includes('let portalTravelInProgress = false')
    && mainSource.includes('newRandomSeed({ allowedBiomeIds: [targetBiome.id]')
    && mainSource.includes('url.searchParams.set("portal", sourceBiome.id)')
    && mainSource.includes('window.location.href = url.toString()')
    && mainSource.includes('new URLSearchParams(window.location.search).get("portal")')
    && mainSource.includes('const PORTAL_ARRIVAL_RETRY_LIMIT = 45')
    && mainSource.includes('requestAnimationFrame(() => enterPortalArrivalIfRequested(attempt + 1))')
    && mainSource.includes('if (!enterStrollFromPortal(arrivalPose.x, arrivalPose.z, arrivalPose.yaw)'),
  'main.js should reload through URL seed/portal params and start first-person at the return portal.'
);
