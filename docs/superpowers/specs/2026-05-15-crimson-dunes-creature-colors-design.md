# Crimson Dunes Creature Colors Design

## Goal

Make crimson dunes creatures better match the biome palette while preserving the existing cute, soft, stylized feel.

## Current state

The `desert` biome in `src/biomes.js` uses these creature body colors:

```js
["#fefae0", "#dda15e", "#bc6c25", "#3d405b"]
```

These are readable, but the cream and cool blue-gray creature colors can feel less connected to the biome's crimson terrain, terracotta sand, and warm fog.

## Selected direction

Use the approved “Sandstone crimson” palette:

```js
["#f3c68f", "#d97757", "#a94a3f", "#7a3438"]
```

This palette borrows directly from the crimson dunes ground ramp and adds darker red-brown body options for soft contrast.

## Implementation scope

- Update only `desert.creatureColors` in `src/biomes.js`.
- Keep the palette length at four entries so seeded creature color selection consumes the same number of random values and keeps generation structure stable.
- Do not change creature counts, creature shapes, biome id/name, flora, particles, dusk/night palettes, or behavior.

## Verification

- Inspect the diff to confirm only the desert creature palette changed.
- Run the app with the local server and view a crimson dunes seed, or use inspect mode for the desert biome, to confirm the creatures read as warm sandstone/crimson rather than generic desert cream/blue-gray.
