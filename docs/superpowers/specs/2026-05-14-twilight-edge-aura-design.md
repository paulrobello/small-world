# Twilight Meadow Edge Aura Design

## Goal

Make the island-edge cloud/mist ring more tuneable and reusable, starting with the `twilight meadow` biome. For twilight, the ring should read as a lightweight wind-swept field aura rather than cloud or fog, while keeping the existing default mist look for other biomes.

## Approach

Replace the hardcoded island-edge mist tuning with a reusable edge-aura configuration read from the biome. The builder remains a single transparent ring mesh around round island layouts, so it stays lightweight and requires no new per-frame entity state.

Biomes may optionally provide an `edgeAura` config with:

- `pattern`: initially `"mist"` or `"grass"`.
- color palette for base, highlight, and optional warm accents.
- alpha and fade controls.
- inward and outward overlap controls.
- noise / streak scale controls.
- wind influence controls.

When a biome does not provide `edgeAura`, the current mist defaults remain in effect.

## Twilight Meadow Behavior

`twilight meadow` uses `edgeAura.pattern = "grass"`.

The visual target is a low translucent field halo:

- elongated, directional grass-like streaks around the ring.
- purple-blue base color with warm gold highlights matching fireflies and glow flowers.
- opacity strongest near the island edge.
- soft inward overlap onto terrain so it blends with the real grass field.
- outward fade past the island boundary.
- subtle wind animation driven by the existing shared wind time uniform.

This should feel like wind moving through tall twilight grass, not like a cloud bank.

## Implementation Notes

- Primary code changes should be limited to `src/sky.js` and `src/biomes.js`.
- Continue using `state.windUniforms.uTime` for animation so no new animation loop hook is needed.
- Prefer a shader-only ring for the first pass; do not add instanced blades unless the shader-only version proves too flat.
- Keep default biome behavior visually stable by preserving existing mist constants as fallback values.
- The design should leave room for later reusable variants such as water, swamp, or denser mist without implementing them now.

## Verification

The repository has no automated tests or build step. Verify visually by:

1. Starting or reusing the local server on port 1999.
2. Loading `http://localhost:1999/?seed=0xb415`.
3. Confirming twilight meadow reads as a wind-swept field aura with slight inward overlap.
4. Checking at least one other round-layout biome to confirm default mist still looks essentially unchanged.
5. If practical, toggling wind off and confirming the aura stops drifting with the shared wind time behavior.
