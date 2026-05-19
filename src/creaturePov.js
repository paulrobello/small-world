import * as THREE from "three";
import { state } from "./state.js";

const POV_EYE_LIFT = 0.35;
const POV_LOOK_DISTANCE = 8;

const _eyeA = new THREE.Vector3();
const _eyeB = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();

let _hiddenCreature = null;
let _hiddenWasVisible = true;

function getCreaturePovAnchor(creature) {
  return creature?.segments?.[0] ?? creature?.group ?? null;
}

function getEyeCenter(creature, out) {
  const eyes = creature?.eyeParts;
  if (!eyes || eyes.length < 3 || !eyes[0] || !eyes[2]) return false;
  eyes[0].updateWorldMatrix(true, false);
  eyes[2].updateWorldMatrix(true, false);
  eyes[0].getWorldPosition(_eyeA);
  eyes[2].getWorldPosition(_eyeB);
  out.copy(_eyeA).add(_eyeB).multiplyScalar(0.5);
  return true;
}

export function syncCreaturePovCamera(camera, controls, followedCreature) {
  const anchor = getCreaturePovAnchor(followedCreature);
  if (!camera || !anchor || !followedCreature?.group?.parent) return false;

  anchor.updateWorldMatrix(true, true);
  anchor.getWorldQuaternion(_quat);
  _forward.set(0, 0, 1).applyQuaternion(_quat).normalize();
  _up.set(0, 1, 0).applyQuaternion(_quat).normalize();

  if (!getEyeCenter(followedCreature, _pos)) {
    anchor.getWorldPosition(_pos);
    const ws = state.userSettings.worldScale ?? 1;
    const bodyScale = followedCreature.scale ?? 1;
    const radius = followedCreature.segRadius ?? 0.42;
    _pos.addScaledVector(_forward, radius * bodyScale * ws);
  }

  const liftScale = (followedCreature.scale ?? 1) * (state.userSettings.worldScale ?? 1);
  _pos.addScaledVector(_up, POV_EYE_LIFT * liftScale);
  _lookAt.copy(_pos).addScaledVector(_forward, POV_LOOK_DISTANCE * (state.userSettings.worldScale ?? 1));

  camera.position.copy(_pos);
  camera.lookAt(_lookAt);
  if (controls?.target) controls.target.copy(_lookAt);
  return true;
}

export function restoreCreaturePovRenderHidden() {
  if (!_hiddenCreature) return;
  if (_hiddenCreature.group) _hiddenCreature.group.visible = _hiddenWasVisible;
  _hiddenCreature = null;
}

export function setCreaturePovRenderHidden(followedCreature) {
  if (!followedCreature?.group) {
    restoreCreaturePovRenderHidden();
    return;
  }
  if (_hiddenCreature !== followedCreature) {
    restoreCreaturePovRenderHidden();
    _hiddenCreature = followedCreature;
  }
  _hiddenWasVisible = followedCreature.group.visible;
  followedCreature.group.visible = false;
}
