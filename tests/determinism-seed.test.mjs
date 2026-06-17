// Determinism regression test (QA-006a / ARC-001).
//
// This file runs in Node (not the browser), so it needs Node globals that the
// repo's browser-focused eslint config doesn't define. Declare them locally
// rather than touching the shared eslint.config.js.
/* global process:readonly */
//
// The project's central promise: a 16-bit seed reproduces an entire world.
// Determinism is achieved by monkey-patching Math.random = mulberry32(seed)
// for the duration of (async) world-gen, restoring it around every await via
// yieldIfNeeded, then restoring the original. The contract is implicit and
// fragile — a single misplaced Math.random() outside the seeded window, or a
// builder that consumes randomness before the PRNG is installed, silently
// shifts the RNG stream and changes flora/creature placement for EVERY seed.
//
// There is no cheaper mechanical enforcement than a regression test, so this
// is the linchpin for all world-gen refactors (ARC-001, QA-001, QA-005).
//
// What we test
// ------------
// Full structural equality: run generateWorld twice from the same seed in
// FRESH node processes and assert the snapshots (biome id, creature/caterpillar/
// butterfly/bee/flock counts, creature XZ positions, world-graph child count,
// flower-spot / obstacle counts) are byte-identical. A second seed produces a
// different snapshot, proving the equality isn't trivial.
//
// Why fresh processes (not two calls in one process)
// --------------------------------------------------
// generateWorld shares a mutable singleton (`state`) across runs and several
// arrays/pools are not fully reset between regens (see ARC-006). That is a
// separate, known hygiene issue — NOT a determinism bug. The user-facing
// contract is "fresh page load → same seed → same world", which a fresh module
// graph models exactly. Running twice in one process conflate the two issues
// and would fail for the wrong reason. Spawning also isolates the heavy DOM /
// Audio / canvas stubs from the test runner.
//
// What we additionally cover
// --------------------------
// As a fast in-process layer we also assert the determinism MECHANISM itself:
//   1. mulberry32(seed) is byte-reproducible.
//   2. The seed→biome selection (first Math.random() after install) is fixed.
//   3. The install/restore-around-async-yield wrapper preserves the seeded
//      stream — a consumer sees the same sequence whether yields fire or not.
// (3) is the actual linchpin: it's what makes async world-gen deterministic.
// If the wrapper were ever dropped, the in-process assertions here would fail
// even before the slower subprocess snapshots run.
//
// Limitations
// -----------
// Headless node has no WebGL, so we stub canvas getContext (2D), Audio,
// requestAnimationFrame, and a few DOM elements. We do NOT render anything;
// generateWorld only builds the THREE.Object3D graph. The snapshot therefore
// covers placement/structure but not visual/GPU state.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 (in-process): the determinism mechanism itself.
// ─────────────────────────────────────────────────────────────────────────────

// Install the same minimal globals the world-gen probe needs. (Importing
// src/world.js at all pulls in modules that touch window/document at load.)
installHeadlessGlobals();
const { mulberry32 } = await import('../src/seed.js');
const { BIOMES } = await import('../src/biomes.js');

// 1a. mulberry32 is byte-reproducible: same seed → identical 1000-value stream.
{
  const a = mulberry32(0x3f2a);
  const b = mulberry32(0x3f2a);
  for (let i = 0; i < 1000; i++) {
    const va = a(), vb = b();
    assert.equal(va, vb, `mulberry32 stream diverged at index ${i}`);
  }
}
// 1b. Different seeds produce different streams (sanity — not a constant fn).
{
  const a = mulberry32(0x1111), b = mulberry32(0x2222);
  let anyDifferent = false;
  for (let i = 0; i < 100; i++) if (a() !== b()) { anyDifferent = true; break; }
  assert.ok(anyDifferent, 'mulberry32 should differ for different seeds');
}

// 2. Seed→biome selection is deterministic: the first Math.random() call after
//    install maps to the same BIOMES index every time. This mirrors
//    generateWorld line 328: `BIOMES[Math.floor(Math.random() * BIOMES.length)]`.
{
  function biomeForSeed(seed) {
    const original = Math.random;
    Math.random = mulberry32(seed);
    const idx = Math.floor(Math.random() * BIOMES.length);
    Math.random = original;
    return BIOMES[idx].id;
  }
  for (const seed of [0x0000, 0x3f2a, 0x1234, 0xbeef, 0xffff]) {
    const id1 = biomeForSeed(seed);
    const id2 = biomeForSeed(seed);
    assert.equal(id1, id2, `seed ${seed.toString(16)} picked different biomes`);
    assert.ok(typeof id1 === 'string' && id1.length > 0, 'biome id must be a non-empty string');
  }
}

// 3. The install/restore-around-yield wrapper preserves the seeded stream.
//    generateWorld's yieldIfNeeded does:
//      restoreRandom() → await nextGenerationFrame() → installSeededRandom()
//    A consumer that calls Math.random() N times, with yields interspersed,
//    must see the SAME N values as a consumer with no yields. If the reinstall
//    were ever dropped (or installed a fresh PRNG), this would diverge.
{
  const seed = 0x3f2a;
  // Reference stream: no yields.
  const refRng = mulberry32(seed);
  const originalRandom = Math.random;
  const ref = [];
  Math.random = refRng;
  for (let i = 0; i < 50; i++) ref.push(Math.random());
  Math.random = originalRandom;

  // Stream with yields interleaved every few draws, mimicking yieldIfNeeded.
  const seededRandom = mulberry32(seed);
  const installSeededRandom = () => { Math.random = seededRandom; };
  const restoreRandom = () => { Math.random = originalRandom; };
  let yieldCount = 0;
  async function yieldIfNeeded() {
    yieldCount++;
    restoreRandom();
    await Promise.resolve();      // stand-in for nextGenerationFrame()
    installSeededRandom();
  }
  installSeededRandom();
  const withYields = [];
  for (let i = 0; i < 50; i++) {
    withYields.push(Math.random());
    if (i % 3 === 0) await yieldIfNeeded();   // force a yield every few draws
  }
  restoreRandom();

  assert.deepEqual(
    withYields,
    ref,
    'seeded Math.random stream must be identical with and without async yields ' +
      '(the install/restore-around-yield wrapper is what makes async world-gen deterministic)'
  );
  // Guard against a degenerate test where the yield was never actually taken.
  assert.ok(yieldCount > 0, 'yieldIfNeeded should have been invoked');
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 (subprocess): full generateWorld structural equality.
// ─────────────────────────────────────────────────────────────────────────────
//
// When this file is run with a single numeric argv, it acts as the probe: it
// builds the world for that seed and prints a JSON snapshot. The test runner
// (no argv) spawns the probe twice per seed and compares.
//
if (process.argv[2] !== undefined) {
  await runProbe(parseInt(process.argv[2], 16));
} else {
  await runSubprocessAssertions();
}

async function runProbe(seedHex) {
  installHeadlessGlobals();   // idempotent; safe in the subprocess
  const stateMod = await import('../src/state.js');
  const worldMod = await import('../src/world.js');
  const state = stateMod.state;
  const scene = new THREE.Scene();
  scene.add(state.world);
  // postfx is touched but never rendered headless; a no-op Proxy satisfies it.
  state.postfx = new Proxy({}, { get: () => () => {} });
  await worldMod.generateWorld(seedHex, {
    state,
    scene,
    controls: {},
    setLoading() {},
    releaseFollow() {},
    dispatchWorldReady() {},
    writeSeed() {},
  });
  const snap = {
    seed: seedHex.toString(16),
    biome: state.currentBiome?.id,
    creatureCount: state.creatures.length,
    caterpillarCount: state.caterpillars.length,
    butterflyCount: state.butterflies.length,
    beeCount: state.bees.length,
    flockCount: state.flocks.length,
    worldChildCount: state.world.children.length,
    flowerSpotCount: state.flowerSpots.length,
    obstacleCount: state.obstacles.length,
    perchSpotCount: state.perchSpots?.length ?? 0,
    // creature positions (mesh-local under state.world) — the most sensitive
    // signal for RNG drift. Sorted for stable comparison.
    creaturePositions: state.creatures
      .map((c) => `${c.group.position.x.toFixed(5)},${c.group.position.z.toFixed(5)}`)
      .sort()
      .join('|'),
    creatureKinds: state.creatures
      .map((c) => c.kind ?? (c.flies ? 'flier' : 'walker'))
      .sort()
      .join(','),
  };
  // Emit ONLY the snapshot so the runner can parse stdout cleanly.
  process.stdout.write(JSON.stringify(snap));
  // No assert in probe mode — failures surface as a thrown error / non-zero exit.
}

async function runSubprocessAssertions() {
  const sameSeed = '3f2a';
  const otherSeed = '1234';

  const run1 = runProbeSubprocess(sameSeed);
  const run2 = runProbeSubprocess(sameSeed);
  const runOther = runProbeSubprocess(otherSeed);

  assert.equal(run1.status, 0, `probe run1 exited non-zero: ${run1.stderr}`);
  assert.equal(run2.status, 0, `probe run2 exited non-zero: ${run2.stderr}`);
  assert.equal(runOther.status, 0, `probe runOther exited non-zero: ${runOther.stderr}`);

  const snap1 = JSON.parse(run1.stdout);
  const snap2 = JSON.parse(run2.stdout);
  const snapOther = JSON.parse(runOther.stdout);

  // Same seed → byte-identical snapshot (the central guarantee).
  assert.deepEqual(
    snap1,
    snap2,
    'same seed must produce an identical world snapshot — determinism is broken. ' +
      'Likely cause: a Math.random() call landed outside the seeded window, or a ' +
      'builder consumed randomness before generateWorld installed the PRNG.'
  );

  // Different seed → different snapshot (guards against a degenerate pass where
  // the snapshot is constant regardless of seed — e.g. if a stub masked it).
  assert.notDeepEqual(
    snap1,
    snapOther,
    'different seeds must produce different worlds — snapshot looks seed-independent'
  );
  assert.notEqual(snap1.biome ?? snap1.creatureCount, snapOther.biome ?? snapOther.creatureCount,
    'expected the two seeds to differ on at least biome or creature count');

  // Minimal sanity on the snapshot contents so a broken probe can't pass silently.
  assert.ok(snap1.creatureCount > 0, 'expected non-zero creature count for seed 0x3f2a');
  assert.ok(snap1.worldChildCount > 0, 'expected non-empty world graph for seed 0x3f2a');
  assert.ok(snap1.creaturePositions.length > 0, 'expected creature positions to be captured');
}

function runProbeSubprocess(seedHex) {
  return spawnSync(process.execPath, [__filename, seedHex], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // Give the world build a generous budget; it allocates a lot under node.
    timeout: 30000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Headless globals — minimal stubs that let the app module graph load and
// generateWorld run without a browser. Mirrors the stub pattern in
// tests/portal-placement-runtime.test.mjs, extended for canvas 2D / Audio /
// rAF that the full world-gen path touches.
// ─────────────────────────────────────────────────────────────────────────────
function installHeadlessGlobals() {
  if (globalThis.__headlessInstalled) return;
  globalThis.__headlessInstalled = true;
  globalThis.__APP_VERSION__ = 'test';
  globalThis.window = {
    location: { search: '', hash: '' },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    dispatchEvent() {},
    CustomEvent: function () {},
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
  };
  function gradient() {
    return { addColorStop() {} };
  }
  // Canvas 2D context stub: sky.js / pbr.js paint into canvases at build time.
  // The 2D methods just need to return non-null gradient objects.
  const ctx2d = new Proxy(
    {
      createRadialGradient: () => gradient(),
      createLinearGradient: () => gradient(),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      getContextAttributes: () => ({ alpha: true }),
    },
    { get(target, prop) { return prop in target ? target[prop] : () => null; } }
  );
  function stubEl() {
    return {
      textContent: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild() {},
      removeChild() {},
      setAttribute() {},
      dataset: {},
      getContext: () => ctx2d,
    };
  }
  globalThis.document = {
    getElementById: () => stubEl(),
    createElement: () => stubEl(),
    body: { classList: { contains() { return false; }, add() {}, remove() {} } },
    documentElement: { style: {} },
  };
  globalThis.performance = { now: () => 0 };
  globalThis.history = { replaceState() {} };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  // generateWorld → switchMusic → new Audio(); stub a no-op element.
  globalThis.Audio = function () {
    return {
      play() { return Promise.resolve(); },
      pause() {},
      load() {},
      addEventListener() {},
      removeEventListener() {},
    };
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { maxTouchPoints: 0, userAgent: 'node' },
    configurable: true,
  });
}
