import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.__APP_VERSION__ = 'test';

const {
  findCatalogSubjectInHits,
  getCatalogSubjectFromObject,
} = await import('../src/photoSubject.js');

const root = new THREE.Group();
root.userData.catalog = {
  key: 'fauna:snail:grove',
  category: 'fauna',
  variant: 'snail',
  biomeId: 'grove',
  label: 'Snail',
};
const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
root.add(child);

assert.deepEqual(
  getCatalogSubjectFromObject(child),
  root.userData.catalog,
  'Subject lookup should walk ancestors until it finds catalog metadata.'
);

const terrain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
const flower = new THREE.Group();
flower.userData.catalog = {
  key: 'flora:wildflower:verdant',
  category: 'flora',
  variant: 'wildflower',
  biomeId: 'verdant',
  label: 'Wildflower',
};

const hit = findCatalogSubjectInHits([
  { distance: 1, object: terrain },
  { distance: 2, object: child },
  { distance: 3, object: flower },
]);
assert.equal(hit.subject.key, 'fauna:snail:grove', 'Subject detection should ignore nearer uncatalogable hits.');
assert.equal(hit.object, child, 'Subject detection should keep the actual hit object for review/debug UI.');

const nearerFlower = findCatalogSubjectInHits([
  { distance: 5, object: child },
  { distance: 2, object: flower },
]);
assert.equal(nearerFlower.subject.key, 'flora:wildflower:verdant', 'Subject detection should use the nearest catalogable hit.');

assert.equal(findCatalogSubjectInHits([]), null, 'Empty raycast hits should report no catalog subject.');
assert.equal(findCatalogSubjectInHits([{ distance: 1, object: terrain }]), null, 'Uncatalogable-only hits should report no catalog subject.');
