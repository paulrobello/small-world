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
const { getPortalArrivalPose, getPortalSideEntryPose } = await import('../src/portal.js');

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

assert(
  portalSource.includes('export function getPortalSideEntryPose')
    && portalSource.includes('const sideSign = side >= 0 ? 1 : -1')
    && portalSource.includes('yaw: Math.atan2(normal.x * sideSign, normal.z * sideSign)'),
  'portal.js should expose a click-entry pose on either side of the portal facing into the ring.'
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

{
  const portal = {
    group: {
      position: { x: 0, z: 0 },
      rotation: { y: 0 },
    },
  };
  const frontPose = getPortalSideEntryPose(portal, 1);
  const backPose = getPortalSideEntryPose(portal, -1);
  assert(frontPose.z > 0, 'front-side click entry should stand in front of the clicked portal side.');
  assert(backPose.z < 0, 'back-side click entry should stand behind the clicked portal side.');
  for (const pose of [frontPose, backPose]) {
    const forward = { x: -Math.sin(pose.yaw), z: -Math.cos(pose.yaw) };
    const towardPortal = { x: -pose.x, z: -pose.z };
    const dot = forward.x * towardPortal.x + forward.z * towardPortal.z;
    assert(dot > 0, 'click entry yaw should face into the portal from the clicked side.');
  }
}

assert(
  worldSource.includes('portalTargetBiomeId: overrides.portalTargetBiomeId ?? readPortalTargetBiomeIdFromUrl()')
    && worldSource.includes('readPortalTargetBiomeIdFromUrl()')
    && worldSource.includes('function getPortalTargetBiomes')
    && worldSource.includes('BIOMES.find((b) => b.id === portalTargetBiomeId && b.id !== sourceBiome.id)')
    && worldSource.includes('findNextPortalBiome(sourceBiome, excludedIds)')
    && worldSource.includes('context.portalTargetBiomeId'),
  'world generation should let a portal URL/context override the first portal target biome for return links.'
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
  uiSource.includes('getPortalSideEntryPose')
    && uiSource.includes('function getPortalClickSide')
    && uiSource.includes('state.world.worldToLocal(camera.position.clone())')
    && uiSource.includes('_raycaster.intersectObjects(portals.map((portal) => portal.group), true)')
    && uiSource.includes('enterStrollFromPortal(pose.x, pose.z, pose.yaw)'),
  'Clicking a portal should enter first-person on the clicked side facing into the ring.'
);

assert(
  mainSource.includes('formatSeed')
    && mainSource.includes('isCameraPassingThroughPortal')
    && mainSource.includes('getPortalCameraSide')
    && mainSource.includes('getPortalSideArrivalPose')
    && mainSource.includes('enterStrollFromPortal')
    && mainSource.includes('function getActivePortals()')
    && mainSource.includes('let portalTravelInProgress = false')
    && mainSource.includes('const portal = getActivePortals().find((candidate) => isCameraPassingThroughPortal(candidate, camera, ws))')
    && mainSource.includes('const targetSeed = portal.targetSeed ?? newRandomSeed({ allowedBiomeIds: [targetBiome.id]')
    && mainSource.includes('const portalSide = getPortalCameraSide(portal, camera, ws)')
    && mainSource.includes('url.searchParams.set("portal", sourceBiome.id)')
    && mainSource.includes('url.searchParams.set("portalSide", String(portalSide))')
    && mainSource.includes('window.location.href = url.toString()')
    && mainSource.includes('const params = new URLSearchParams(window.location.search)')
    && mainSource.includes('const arrivalSide = params.get("portalSide") === "-1" ? -1 : 1')
    && mainSource.includes('const PORTAL_ARRIVAL_RETRY_LIMIT = 45')
    && mainSource.includes('requestAnimationFrame(() => enterPortalArrivalIfRequested(attempt + 1))')
    && mainSource.includes('getActivePortals().find((candidate) => candidate.targetBiome?.id === portalParam)')
    && mainSource.includes('if (!enterStrollFromPortal(arrivalPose.x, arrivalPose.z, arrivalPose.yaw)'),
  'main.js should reload through URL seed/portal/side params, test all placed portals for traversal, and start first-person at the matching side of the return portal.'
);
