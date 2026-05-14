# Marsh Angler Fish Design

## Goal
Add a small number of cute angler fish to lavender marsh water areas, including seed `0x35c2`, without replacing the existing marsh creature mix.

## Scope
- Add a biome opt-in flag such as `anglerFish: true` to the lavender marsh biome.
- Spawn a small extra population of aquatic angler fish only for opted-in water biomes.
- Keep coral atoll fish behavior unchanged.
- Preserve seeded determinism by building and placing anglers synchronously inside `generateWorld`.

## Visual Design
Angler fish should match the project vibe: rounded body, big eyes, soft fins, gentle swim motion, and no sharp or scary silhouette. The lure is a tiny emissive orb on a curved/tilted stalk, using the biome accent color and the existing bloom layer so it glows softly at dusk/night.

## Architecture
Reuse the existing `makeCreature` / `stepCreature` fish path rather than adding a new entity system. Add an option such as `opts.angler` that only applies when the creature is fish-like. The option adds the lure and a slightly distinct body/fin scale while leaving movement, placement, follow mode, shadows, and disposal integrated through `state.creatures`.

World generation will add a small angler top-up after normal creature spawning when `biome.anglerFish && biome.water`. Placement will reuse the existing underwater shelf constraints (`pickGroundPoint`, fish max/min ground Y, and swim band setup), rejecting invalid samples instead of clamping into bad positions.

## Testing / Verification
There is no automated test suite. Verify by running the local server and loading `http://localhost:1999/?seed=0x35c2`, then confirming anglers appear underwater with glowing lures and existing marsh creatures still spawn normally. Also inspect `?inspect=1` fish/angler behavior if an inspect variant is added.
