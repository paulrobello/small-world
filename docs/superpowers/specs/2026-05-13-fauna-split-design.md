# Spec — Split `src/fauna.js` into per-entity modules

**Date:** 2026-05-13
**Scope:** Pure structural refactor of `src/fauna.js` (1901 lines). No behavior changes.

## Goal

`src/fauna.js` has grown to 1901 lines spanning four distinct entity types
(creature, caterpillar/snail, butterfly, bee) plus shared collision helpers.
Split it into a `src/fauna/` directory of per-entity modules so each entity
can be opened in isolation, and extract the two shared collision helpers so
their reuse across entities is explicit. Public API is preserved exactly via
a barrel file at `src/fauna.js`, so no consumer changes are required.

## Non-goals

- **No behavior changes.** Same outputs from `makeX` constructors, same per-frame
  behavior from `stepX` updaters, same RNG consumption order (critical for
  the seed determinism contract — see CLAUDE.md "The determinism trick").
- **No further decomposition of `creature.js`** beyond the entity split.
  `makeCreature` body-part construction and `stepCreature` sub-FSMs
  (landing/burrower/sleep/locomotion) stay together. Confirmed with user.
- **No new abstractions or base classes.** Each entity stays a `{group, ...state}`
  plain object built by a function; the parallel-arrays animation loop in
  `main.js` is unchanged.
- **No file deletions of existing modules** other than the in-place replacement
  of `src/fauna.js` (see "Migration" below).

## Target layout

```
src/fauna/
  shared.js        — WATER_AVOID_Y, avoidObstacles, pushOutOfObstacles, colorsClose
  creature.js      — makeCreature, stepCreature, lookAtCreature, wakeCreature
                     + private: PERSONALITIES, PERSONALITY_NAMES,
                       getZTexture, makeZSprite, nearestBuzzer,
                       herdInfluence, pickPerchForFlier
  caterpillar.js   — makeCaterpillar, stepCaterpillar
                     + private: findTrailPointAt
  butterfly.js     — makeButterfly, stepButterfly
                     + private: pickFlower, _bflyTarget
  bee.js           — makeSwarm, makeBee, stepBee
                     + private: pickBeeFlower, _beeTarget, _beeOffset
src/fauna.js       — barrel: re-exports the public API listed above
```

Approximate sizes after split:

| Module | Lines |
|---|---|
| `fauna/shared.js` | ~80 |
| `fauna/creature.js` | ~1140 |
| `fauna/caterpillar.js` | ~275 |
| `fauna/butterfly.js` | ~195 |
| `fauna/bee.js` | ~180 |
| `fauna.js` (barrel) | ~15 |

## Module boundaries

### `fauna/shared.js`

Pure helpers with no dependency on entity-specific state. Exports:

- `WATER_AVOID_Y` — terrain-Y threshold used by every entity for water avoidance.
- `avoidObstacles(px, pz, nx, nz, heading, step, cr, y, skipX, skipZ)` — heading-based
  tangent slide. Consumed by `stepCreature` (walkers + descending fliers with
  height filter + optional skip-perch) and `stepCaterpillar` (no height filter,
  no skip).
- `pushOutOfObstacles(pos, vel, bodyR)` — velocity-based push-out + reflection.
  Consumed by `stepButterfly` and `stepBee`.
- `colorsClose(a, b)` — RGB-distance helper. Currently only used by
  `herdInfluence` inside `creature.js`. Keeping it in shared keeps creature
  imports symmetrical with the other entity modules and makes it discoverable
  if a future entity wants similar herding logic. (If preferred, can move
  inline into `creature.js` — judgment call, not load-bearing.)

Imports: `state` (only inside the obstacle helpers, for `state.obstacles`).

### `fauna/creature.js`

Owns the creature subsystem in full. Exports:

- `makeCreature(biome, opts)` — walker / flier / fish / sleeper / burrower
  variants, fur, family roles, personality, eyes, antennae, legs, wings, fins.
- `stepCreature(c, dt, t, heightFn)` — per-frame updater with the landing FSM,
  burrower FSM, night-sleep / wake animation, herd influence, hop, look-at,
  squash-stretch, foot dust kicks, perch homing, water avoidance.
- `lookAtCreature(c)` — UI hover trigger.
- `wakeCreature(c)` — UI / stroll-proximity trigger.

Private (not exported): personality table, the `zZz` canvas texture cache,
`nearestBuzzer`, `herdInfluence`, `pickPerchForFlier`.

Imports: `THREE`, `state`, `jitterGeo`, `applyShellFur`, `makeDirtPuff`,
`makeDustKick`, `BLOOM_LAYER`, and from `./shared.js`: `WATER_AVOID_Y`,
`avoidObstacles`, `colorsClose`.

### `fauna/caterpillar.js`

Exports `makeCaterpillar(biome, opts)` and `stepCaterpillar(c, dt, t, heightFn)`.
Private: `findTrailPointAt`. Imports `THREE`, `state`, `jitterGeo`,
`pickGroundPoint`, `nearestCenter`, `applyShellFur`, `BLOOM_LAYER`, and from
`./shared.js`: `WATER_AVOID_Y`, `avoidObstacles`.

### `fauna/butterfly.js`

Exports `makeButterfly(palette, biome)` and `stepButterfly(b, dt, t, flowerSpots, heightFn)`.
Private: `pickFlower`, the reusable `_bflyTarget` vector. Imports `THREE`,
`state`, `nearestCenter`, and from `./shared.js`: `WATER_AVOID_Y`,
`pushOutOfObstacles`.

### `fauna/bee.js`

Exports `makeSwarm()`, `makeBee(swarm, biome)`, `stepBee(b, dt, t, flowerSpots, heightFn)`.
Private: `pickBeeFlower`, the reusable `_beeTarget` / `_beeOffset` vectors.
Imports `THREE`, `state`, `nearestCenter`, and from `./shared.js`:
`WATER_AVOID_Y`, `pushOutOfObstacles`.

### `src/fauna.js` (barrel)

```js
export { makeCreature, stepCreature, lookAtCreature, wakeCreature } from "./fauna/creature.js";
export { makeCaterpillar, stepCaterpillar } from "./fauna/caterpillar.js";
export { makeButterfly, stepButterfly } from "./fauna/butterfly.js";
export { makeBee, makeSwarm, stepBee } from "./fauna/bee.js";
```

This preserves the import paths used by `main.js`, `world.js`, `ui.js`, and
`inspect.js` verbatim — no consumer edits needed.

## Determinism contract

`generateWorld` monkey-patches `Math.random = mulberry32(seed)` for the
duration of world construction. **The order and count of `Math.random()` calls
inside `makeCreature`, `makeCaterpillar`, `makeButterfly`, and `makeBee` must
not change.** Specifically:

- No new `Math.random()` calls may be added by the refactor.
- No existing calls may be removed, reordered, or moved across module
  boundaries in a way that changes when they execute.
- Module top-level code must not call `Math.random()` (it would consume
  entropy at import time, before `generateWorld` patches the RNG).

The pre-allocated `_bflyTarget`, `_beeTarget`, `_beeOffset` vectors at module
top level are fine — they call `new THREE.Vector3()` (no RNG). The lazy
`_zTexture` cache lives in `creature.js`; it's built on the first sleepy
creature at runtime and reused across worlds.

## Migration

1. Create `src/fauna/` directory.
2. Create `src/fauna/shared.js` with the three shared helpers + constant.
   Copy verbatim from the existing source — do not rewrite. Verify imports.
3. Create `src/fauna/creature.js`. Copy lines 12-23 (personality), 25-69
   (z-sprite + colorsClose-or-import), 77-429 (`makeCreature`), 431-437
   (`lookAtCreature`), 439-498 (`nearestBuzzer` + `herdInfluence`), 500-520
   (`wakeCreature`), 583-606 (`pickPerchForFlier`), 636-1214 (`stepCreature`).
   `WATER_AVOID_Y`, `avoidObstacles`, and `colorsClose` now come from
   `./shared.js`.
4. Create `src/fauna/caterpillar.js`. Copy lines 1219-1519. Imports come from
   `./shared.js`.
5. Create `src/fauna/butterfly.js`. Copy lines 1524-1714.
6. Create `src/fauna/bee.js`. Copy lines 1721-1899.
7. Replace `src/fauna.js` contents with the barrel re-exports listed above.
8. Manual verification (browser smoke test — see "Verification").

Each step is an isolated commit so a regression can be bisected per-module.

## Verification

There are no automated tests in this project (per CLAUDE.md). Verification is
manual:

1. `make restart` to bounce the dev server.
2. Open `http://localhost:1999/` and confirm a world generates.
3. Check the browser console for errors (especially import-resolution
   errors — they're the most likely failure mode for a barrel split).
4. Smoke-walk key behaviors on multiple seeds:
   - Walker creatures move, herd, hop near butterflies, sleep at night, wake
     on hover.
   - Fliers cruise, descend toward mushroom perches, land, take off.
   - Burrower biomes — descend, teleport, emerge with a dirt puff.
   - Caterpillars trail correctly; snails carry a shell.
   - Butterflies fly to wildflowers and hover.
   - Bee swarms migrate together.
5. Test `?inspect=1` mode — `makeCreature` / `makeCaterpillar` /
   `stepCreature` / `stepCaterpillar` are also called from `inspect.js`.
6. Sanity check at least one specific seed (e.g. `0x3f2a`) reproduces the same
   biome / creature count / placement after the split — confirms the
   determinism contract held.

## Risk + rollback

- **Risk:** import-cycle or wrong-path import. Mitigation: each step is its
  own commit so `git revert` peels back to the working state.
- **Risk:** accidentally moving a `Math.random()` across the helper boundary,
  altering seed determinism. Mitigation: helpers in `shared.js` (`avoidObstacles`,
  `pushOutOfObstacles`, `colorsClose`) make zero RNG calls today — confirmed
  by reading the source. The refactor copies them verbatim.
- **Risk:** loss of file history attribution. Mitigation: `git log --follow`
  works across renames; the per-step commits should be moves+edits so git
  detects the rename.

## Out of scope follow-ups

These are noted only so they're not lost — not part of this refactor:

- Eventual creature.js sub-decomposition (sub-FSMs into their own files).
- A potential shared `fauna/movement.js` for the heading-vs-velocity steering
  patterns if a 5th entity type ever appears.
- A `fauna/types.d.ts` jsdoc reference for the entity state shapes.
