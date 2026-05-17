import assert from 'node:assert/strict';

// Minimal browser-ish globals for importing the app module graph in Node.
globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const shared = await import('../src/fauna/shared.js');

assert.equal(
  typeof shared.slopeTargetsFromGradient,
  'function',
  'walker slope cache needs a helper that converts cached world gradients back to heading-local pitch/roll'
);

const ds = 0.25;
const heightFn = (x) => x; // 45° slope rising along world +X.

const initial = shared.sampleSlopes(0, 0, 0, ds, heightFn);
assert.equal(initial.gradientX, 1, 'sampleSlopes should expose the world X gradient for caching');
assert.equal(initial.gradientZ, 0, 'sampleSlopes should expose the world Z gradient for caching');

const directAfterTurn = shared.sampleSlopes(0, 0, Math.PI / 2, ds, heightFn);
const cachedAfterTurn = shared.slopeTargetsFromGradient(
  initial.gradientX,
  initial.gradientZ,
  Math.PI / 2
);

assert.ok(Math.abs(cachedAfterTurn.pitchTarget - directAfterTurn.pitchTarget) < 1e-12);
assert.ok(Math.abs(cachedAfterTurn.rollTarget - directAfterTurn.rollTarget) < 1e-12);

// Regression: the old cache stored heading-local forward/right values as if
// they were world X/Z. After a 90° turn, that incorrectly pitched the walker
// forward instead of rolling it onto the same world-X slope.
assert.ok(Math.abs(cachedAfterTurn.pitchTarget) < 1e-12);
assert.ok(cachedAfterTurn.rollTarget > 0.7 && cachedAfterTurn.rollTarget < 0.8);
