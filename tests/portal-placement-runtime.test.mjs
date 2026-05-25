import assert from 'node:assert/strict';
import { createNoise2D } from 'simplex-noise';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  dispatchEvent() {},
};
globalThis.document = {
  getElementById() {
    return {
      textContent: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
    };
  },
  body: { classList: { contains() { return false; } } },
};
globalThis.performance = { now: () => 0 };

const { mulberry32 } = await import('../src/seed.js');
const { makeHeightFn, pickLayout } = await import('../src/terrain.js');
const { makeSeededPortalPlacement } = await import('../src/portal.js');

function makeLayoutForSeed(seed) {
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);
  Math.random(); // consume biome roll
  const layout = pickLayout();
  Math.random = originalRandom;
  return layout;
}

function makePortalPair(seed) {
  const layout = makeLayoutForSeed(seed);
  const heightFn = makeHeightFn(createNoise2D(mulberry32((seed ^ 0x5eed5eed) >>> 0)), layout, 3.2);
  const anchors = [];
  const minDistSq = layout.boundRadius * layout.boundRadius;
  const placements = [];

  for (let i = 0; i < 2; i++) {
    const p = makeSeededPortalPlacement({
      seed,
      index: i,
      layout,
      heightFn,
      maxRadiusFrac: 0.72,
      minRadiusFrac: 0.48,
      preferredAngle: anchors.length ? Math.atan2(anchors[0].z, anchors[0].x) + Math.PI : null,
      isBlocked: (x, z) => anchors.some((a) => {
        const dx = x - a.x;
        const dz = z - a.z;
        return dx * dx + dz * dz < minDistSq;
      }),
    });
    placements.push(p);
    anchors.push({ x: p.x, z: p.z });
  }

  return { layout, placements };
}

const { layout, placements } = makePortalPair(0x00e9);
const dx = placements[0].x - placements[1].x;
const dz = placements[0].z - placements[1].z;

assert.equal(placements.length, 2, 'Double portal placement should produce two portals.');
assert.ok(
  Math.hypot(dx, dz) >= layout.boundRadius,
  'Double portals should be at least one island radius apart for seed 0x00e9.'
);
