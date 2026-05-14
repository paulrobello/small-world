# Ashen Wastes Volcanic Fissures Design

## Goal

Update the Ashen Wastes biome so it reads as a cute scorched volcanic plain with glowing lava fissures, warm ember light, and subtle creature/flora avoidance, while staying distinct from the darker existing Volcanic Glass biome.

## User-approved direction

- Visual direction: **Cozy Lava Fissures**.
- Implementation approach: **new flora kind** (`lavafissure`) rather than a terrain shader or separate world-generation system.
- Behavior scope: **subtle world effects**. Fissures should provide warm light and modest avoidance, but they must not damage, scare, or strongly repel creatures.

## Visual design

Ashen Wastes should keep its soft, smoky, cute terrarium feel. The new feature should appear as low-profile lava seams rather than tall threatening volcanoes.

A fissure is a small ground-level flora group made from:

- dark rounded basalt/ash stones around a seam,
- 2–4 glowing orange/yellow crack segments,
- a faint translucent orange ground halo,
- an optional tiny central vent/glow point.

The fissures should feel hand-placed and blobby, not realistic or sharp. They should use warm saturated colors from the Ashen Wastes accent palette, but avoid harsh neon.

## Architecture

Add `lavafissure` to the `FLORA_BUILDERS` registry in `src/flora.js`. This follows existing biome-flora conventions and keeps the behavior discoverable in inspect mode.

Update the Ashen Wastes entry in `src/biomes.js` to include `lavafissure` in its `flora` list. Reduce repeated filler items only if necessary so fissures are visible without dominating the biome.

Use the existing bloom/glow pipeline:

- emissive materials for crack segments,
- `BLOOM_LAYER` on the glowing meshes,
- a subtle translucent halo similar in spirit to existing lantern/obsidian-shard halos.

## Subtle world effects

During flora placement in `src/world.js`, fissures should register as small low obstacles so creatures and later flora do not sit directly on top of the hot seam. The obstacle height should be low enough that fliers can pass above it through the existing air-passing obstacle filter.

Each fissure may get a small warm `PointLight`, but the number of lights must be capped or conditional so the biome remains performant. The light should read as warm ground glow, not a harsh spotlight.

No gameplay hazard is included. Creatures should route around fissures naturally through the existing obstacle avoidance system, not flee from them.

## Determinism

Fissures must be generated synchronously inside the existing `generateWorld(seed)` deterministic window. The same seed, including `0x7622`, should produce the same Ashen Wastes fissure count, shape details, positions, and lighting choices.

Do not introduce async randomness, timers, or user-interaction-driven randomness into fissure construction.

## Verification

This repo has no build, test runner, or linter. Verification is manual:

1. Run `make start`.
2. Open `http://localhost:1999/?seed=0x7622`.
3. Confirm Ashen Wastes includes visible glowing fissures.
4. Confirm the fissures look cute, rounded, and low-profile rather than scary or realistic.
5. Confirm no browser console errors.
6. Confirm creatures and flora do not spawn directly on top of fissures.
7. Confirm fliers can still pass above fissures.
8. Inspect the flora variant at `http://localhost:1999/?inspect=1&category=flora&biome=ashen&variant=lavafissure` if the inspect variant ordering supports it after implementation.

## Out of scope

- Flowing lava simulation.
- Terrain shader cracks.
- Creature damage, fear, or hazard reactions.
- Large volcano cones or eruptions.
- Changes to the existing Volcanic Glass biome, except avoiding visual overlap in the Ashen Wastes implementation.
