# Ideas for Enhancing small-world

A running list of enhancement ideas for the Three.js terrarium. Each idea is tagged with rough scope (S/M/L) and notes about which parts of `main.js` it would touch. All ideas should respect the project's **cute / rounded / painterly / soft-motion** vibe — see `CLAUDE.md` § Vibe.

Remove completed items from this list, commit and push so its live on github pages

---

## World Generation

- **Caves / arches** (L) — carve negative-space holes through the island using a third noise field with a CSG-style threshold. Probably needs a marching-cubes pass instead of `PlaneGeometry` — large change, save for later.

## Audio

- **Ambient bed per biome** (S) — soft loop chosen by biome id (wind, rustle, drips, crackle). One `<audio>` element, crossfade on regenerate. Mute toggle in HUD.
- **Creature chirps** (S) — occasional very-soft pitched blip when a creature transitions states. Web Audio API, tiny `OscillatorNode` envelope, no samples needed.

## Performance & Code Health

- **Pool geometries/materials** (S) — flora builders currently create fresh geometries each call; biomes have many duplicates. Cache by `(kind, biomeId)` key.
- **Reduce per-frame allocations** (S) — audit `stepCreature` / `stepButterfly` for `new THREE.Vector3()` in the loop; reuse scratch vectors.
- **Lazy world rebuild** (S) — debounce regeneration when the user clicks repeatedly.
- **Optional `?lowfx=1` URL param** (S) — drop particle count, instance counts, and pixel ratio for slow devices.

## Stretch / Big Swings

- **Seasonal overlay** (L) — each biome has a `spring/summer/autumn/winter` palette delta; URL `?season=` (or auto from real-world date) tints flora and ground.
- **Save & share full snapshots** (M) — export the current scene state (seed + camera + season + time-of-day) as a compact URL fragment, not just the seed.
- **Two-island composition** (L) — render two islands side-by-side from two seeds for comparison or storytelling.
- **Tiny narrative cards** (M) — a one-sentence procedurally-generated "what's happening here" caption per world, seeded from the same RNG. Pure flavor text.

---

_Conventions reminder for any of the above: no build step, no npm. New libraries (if truly needed) go through the importmap in `index.html`. Determinism-sensitive code must run synchronously inside `generateWorld` before `Math.random` is restored._
