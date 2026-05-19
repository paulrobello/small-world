import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const { BIOMES } = await import('../src/biomes.js');
const { makeCreature, stepCreature } = await import('../src/fauna/creature.js');
const { sampleTerrainNormal } = await import('../src/fauna/shared.js');

const originalRandom = Math.random;
Math.random = () => 0.5;
const sleeper = makeCreature(BIOMES[0], { sleeper: true });
Math.random = originalRandom;

sleeper.heading = 0;
sleeper.zSpawnTimer = 1;
sleeper.group.rotation.set(0, 0, 0, 'YXZ');
sleeper.group.position.set(0, 2, 0);

const heightFn = (x) => x;
stepCreature(sleeper, 0, 0, heightFn);

const expectedNormal = sampleTerrainNormal(0, 0, heightFn);
const actualUp = new THREE.Vector3(0, 1, 0).applyQuaternion(sleeper.group.quaternion);

assert.ok(
  actualUp.angleTo(expectedNormal) < 1e-6,
  'spawned sleepers should yaw before applying heading-local pitch/roll so their body up vector matches the terrain normal'
);
