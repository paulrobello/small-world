import assert from 'node:assert/strict';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const { state } = await import('../src/state.js');
const { avoidObstacles, buildObstacleGrid } = await import('../src/fauna/shared.js');

state.dynamicObstacles = [];
state.obstacles = [{ x: 1.5, z: 0, r: 0.5, top: 1.5 }];
buildObstacleGrid(state.obstacles);

const step = 0.1;
const heading = 0;
const result = avoidObstacles(
  0,
  0,
  step,
  0,
  heading,
  step,
  0.25
);

assert.ok(result, 'walker should begin steering before entering the hard collision radius');
assert.equal(result.nx, step, 'proactive steering should preserve the current smooth forward step');
assert.equal(result.nz, 0, 'proactive steering should not lateral-snap the position');
assert.ok(
  Math.abs(result.heading - heading) > 0.01 && Math.abs(result.heading - heading) < Math.PI / 2,
  'proactive steering should apply a small heading correction rather than a last-moment tangent snap'
);

const turnResult = avoidObstacles(
  0,
  0,
  step,
  0,
  heading,
  step,
  0.25,
  undefined,
  undefined,
  undefined,
  {},
  { staticResponse: 'turn' }
);

assert.ok(turnResult, 'turn response should also steer before hard contact');
assert.equal(turnResult.nx, step, 'proactive turn response should keep moving forward');
assert.equal(turnResult.nz, 0, 'proactive turn response should not freeze at the current position');

state.obstacles = [{ x: 0, z: 0, r: 0.5, top: 1.5 }];
buildObstacleGrid(state.obstacles);

const stuckRingStep = 0.05;
const stuckRingResult = avoidObstacles(
  0.6,
  0,
  0.6,
  stuckRingStep,
  Math.PI / 2,
  stuckRingStep,
  0.25,
  undefined,
  undefined,
  undefined,
  {},
  { staticResponse: 'turn' }
);

assert.ok(stuckRingResult, 'crawler inside a tree clearance ring should get an escape response');
assert.ok(
  Math.hypot(stuckRingResult.nx, stuckRingResult.nz) > 0.6,
  'crawler escape response should increase distance from the tree instead of orbiting in place'
);

state.obstacles = [
  { x: -20, z: 0, r: 0.5, top: 1.5 },
  { x: 20, z: 0, r: 0.5, top: 1.5 },
];
buildObstacleGrid(state.obstacles);
state.obstacles = [{ x: -20, z: 0, r: 0.5, top: 1.5 }];

assert.doesNotThrow(
  () => avoidObstacles(19.8, 0, 20, 0, 0, 0.1, 0.25),
  'stale obstacle-grid indices should fall back to the current obstacle array during async world rebuilds'
);
