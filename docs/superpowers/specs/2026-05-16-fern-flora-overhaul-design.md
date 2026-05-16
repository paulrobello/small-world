# Fern Flora Visual Overhaul Design

Date: 2026-05-16

## Goal

Replace the current basic fern specimen with a more fern-like, polished lacy frond clump that fits Small World's cute painterly style.

## Approved direction

Use the **lacy frond clump** direction:

- 5–7 arcing fronds arranged radially from a small base.
- Each frond has a central rib with paired leaflets.
- Leaflets are chunkier near the base and smaller near the tips.
- No fiddleheads or curled tips.
- The silhouette should be soft, rounded, airy, and irregular rather than spiky.

## Implementation scope

Keep the change surgical:

- Update only the `fern(biome)` flora builder in `src/flora.js`, unless a small footprint adjustment is needed in `src/world.js`.
- Preserve deterministic variation through existing seeded `Math.random()` world generation.
- Preserve wind sway via `applyWindSway`.
- Use pooled materials/geometries where practical, matching existing flora conventions.
- Do not change biome flora counts, mushroom grove composition, or unrelated flora.

## Visual requirements

- Read clearly as a fern in inspect mode and in the full grove world.
- Maintain Small World's cute style: rounded, stylized, painterly, not realistic or sharp.
- Avoid the current crossed-cone look.
- Vary instances through frond count, height, spread, leaflet count, and subtle color tint.
- Work across fern-using biomes, especially grove, mossy ruins, mushroom grove, twilight meadow, and frozen vale.

## Verification plan

Visual verification is the primary success criterion because this is a geometry/art update and the repo has no automated test suite.

Check:

1. Inspect mode fern at the user's reference URL:
   `http://localhost:1999/?inspect=1&category=flora&biome=grove&variant=fern&seed=0x1398&view=default&fur=0&paused=1`
2. Full-world grove readability at normal camera distance.
3. At least mossy ruins, mushroom grove, twilight meadow, and frozen vale palettes in inspect mode.
4. No console errors after reload.
5. No obvious performance issue from increased mesh count.

## Out of scope

- New fern variants per biome.
- New shaders beyond the existing wind sway path.
- Changes to terrain, grass, mushrooms, or general flora placement.
- Any global art-direction changes outside ferns.
