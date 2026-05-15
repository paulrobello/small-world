# Bumblebee Flyer Variant Design

## Summary

Add a new Verdant Grove-only normal flyer variant that reads as a cute bumblebee. It should remain part of the existing `makeCreature` / `stepCreature` system so it is followable, shadowed, paused, and landed like other normal fliers.

## Goals

- Create a normal flyer variant, not a tiny existing bee swarm insect.
- Make the variant visually read as a bumblebee at small scale.
- Keep the default stripe system biome-adaptive, with explicit per-biome override support.
- Use classic black/yellow stripes for the initial Verdant Grove implementation.
- Add bumblebees only to Verdant Grove for now.
- Have bumblebees fly between and land on tree-like things.

## Non-goals

- Do not replace the existing small bee swarms that orbit flowers.
- Do not add bumblebees to other biomes yet.
- Do not create a separate movement system unless the existing flyer landing FSM cannot support the behavior.
- Do not introduce new dependencies, build tooling, or package management.

## Architecture

### Creature variant

Extend the existing normal creature builder with a bumblebee variant option, for example `makeCreature(biome, { variant: "bumblebee" })` or an equivalent project-consistent option name.

The variant should reuse the existing flyer data shape and `stepCreature` movement/landing FSM. This keeps it integrated with:

- follow camera selection,
- creature shadows,
- pause/photo behavior,
- terrain and water safeguards,
- obstacle avoidance,
- seeded world generation.

### Biome gating

Add a biome-level configuration entry to Verdant Grove only. Prefer a flag or variant list over a hardcoded biome id check in the creature builder. A suitable shape is:

```js
flyerVariants: [
  {
    kind: "bumblebee",
    stripeOverride: ["#111111", "#ffd13b"],
  },
]
```

Exact field names can follow nearby project conventions during implementation. The important design point is that the builder receives variant intent from biome/world generation rather than branching globally on Verdant Grove.

### Spawn behavior

During Verdant Grove creature generation, select some normal flyer spawns as bumblebees. Bumblebees are still normal creatures; they should not be counted or stepped through `state.bees`.

The implementation should avoid changing all existing Verdant Grove fliers unless a small count would be visually too rare. A modest deterministic mix is preferred so the biome still has normal creature variety.

## Visual Design

Bumblebee fliers should keep the project’s cute, rounded style:

- half the size of a normal flyer,
- body elongated 25% along the forward/body axis,
- black/yellow stripe override in Verdant Grove,
- biome-adaptive stripe fallback for future biome use,
- always fuzzy via shell fur,
- always has antennae,
- six tiny legs instead of the normal flyer’s two dangling feet,
- rounded cartoon stinger at the rear,
- big friendly eyes retained from normal creatures.

The stinger should be readable but not sharp or threatening. Use the same soft, blobby geometry language as the rest of the fauna.

## Stripe Palette Rules

Use this precedence:

1. Explicit variant/biome stripe override.
2. Biome-derived adaptive stripes.
3. Safe classic fallback.

For Verdant Grove, rule 1 applies: dark/black plus yellow. Future biomes can omit the override and inherit adaptive stripes from biome colors, flower palettes, or accent colors.

## Landing Targets

Bumblebees should fly between and land on all tree-like things in Verdant Grove.

Implementation should expand the existing perch target data rather than adding a parallel landing system. Tree-like flora that expose a meaningful canopy/top point should register perch spots during flora placement, similar to mushroom cap perches. The perch metadata should allow bumblebees to prefer tree-like spots while other fliers can keep their current behavior.

Potential target kinds include Verdant Grove canopy-bearing/tree-like flora such as leafball trees and any larger tree-like props. Big mushrooms can remain valid if they are treated as tree-like in the generated scene.

## Behavior

Bumblebees should use existing normal flyer movement with these tuning goals:

- gentle buzzy flight, but not as tiny or frantic as existing swarm bees,
- normal landing FSM for descending, landed, and ascending states,
- preference for tree-like perch targets,
- continue using obstacle and water safeguards already present for fliers.

If custom tuning is needed, keep it localized to variant properties rather than duplicating `stepCreature`.

## Testing and Verification

This repository has no configured test runner, linter, or build step. Verification should therefore be code-review plus browser/runtime checks:

1. Start the local server with `make start`.
2. Load a Verdant Grove seed.
3. Confirm at least one bumblebee-style normal flyer appears when the deterministic spawn mix selects it.
4. Confirm bumblebee fliers are smaller than normal fliers, fuzzy, striped, antennaed, six-legged, and have a stinger.
5. Confirm they fly between tree-like targets and land on them without snapping.
6. Confirm other biomes do not spawn bumblebee variants.
7. Check browser console for runtime errors.
8. Exercise inspect mode if the variant is exposed there.

## Open Decisions Resolved

- Stripe direction: biome-adaptive by default with overrides.
- Initial Verdant Grove override: black/yellow.
- Landing targets: all tree-like things.
- Creature system: normal flyer variant, not existing swarm bees.
