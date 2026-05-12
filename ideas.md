# Ideas for Enhancing small-world

A running list of enhancement ideas for the Three.js terrarium. Each idea is tagged with rough scope (S/M/L) and notes about which parts of `main.js` it would touch. All ideas should respect the project's **cute / rounded / painterly / soft-motion** vibe — see `CLAUDE.md` § Vibe.

Remove completed items from this list, commit and push so its live on github pages

---

## World Generation

- **Caves / arches** (L) — carve negative-space holes through the island using a third noise field with a CSG-style threshold. Probably needs a marching-cubes pass instead of `PlaneGeometry` — large change, save for later.
- **Procedural island name** (S) — generate a two-syllable name ("Mossbrim", "Velin", "Quillhollow") from the seed and show it under the biome label in the HUD. Pure flavor, deterministic. Touches `src/world.js` + `index.html`.
- **Hidden landmarks** (M) — 1-in-N chance per world of spawning a single tiny set piece (stone arch, tilted obelisk, mushroom ring, bird's nest with eggs) at a chosen `pickGroundPoint`. Surface "found: <thing>" in the HUD. New module `src/landmarks.js`.
- **Footpaths** (M) — when a creature is followed for a while, leave a faint worn dirt path along its trace by tinting the underlying terrain colors. Touches `src/fauna.js` + `src/terrain.js`.

## Weather & Atmosphere

- **Passing storm** (M) — occasionally drift a darker cloud across the island that casts a soft ground shadow, briefly intensifies fog, and triggers rain particles if biome allows. Touches `src/sky.js` + `src/environment.js`.
- **Rainbow after rain** (S) — when a rain biome's storm ends, fade in a thin arc rainbow ring opposite the sun for ~10s. Pure shader/sprite. Touches `src/sky.js`.
- **Snow accumulation** (M) — for cold biomes, gradually whiten the top of terrain vertices facing up while snow particles play; reset on regenerate. Touches `src/environment.js` + `src/terrain.js`.
- **Petals & pollen drift** (S) — meadow/bloom biomes get a slow horizontal pollen drift layer (cheap point sprites) alongside existing particles. Touches `src/environment.js` + `src/biomes.js`.

## Audio

- **Ambient bed per biome** (S) — soft loop chosen by biome id (wind, rustle, drips, crackle). One `<audio>` element, crossfade on regenerate. Mute toggle in HUD.
- **Creature chirps** (S) — occasional very-soft pitched blip when a creature transitions states. Web Audio API, tiny `OscillatorNode` envelope, no samples needed.
- **Wind-chime ping on landmark discover** (S) — single soft chime when a hidden landmark first becomes visible after regenerate. Web Audio. Depends on **Hidden landmarks**.

## UI / HUD / Photo

- **Postcard export** (S) — extend photo mode's PNG save to compose biome name + seed + date in the corner with the existing eyebrow font before download. Touches `src/ui.js`.
- **Cinematic auto-tour** (M) — toggleable mode that slowly orbits the island, occasionally cutting to a follow on a random creature for a few seconds, then back. Reuses follow + orbit machinery. Touches `src/ui.js`.

## Stretch / Big Swings

- **Seasonal overlay** (L) — each biome has a `spring/summer/autumn/winter` palette delta; URL `?season=` (or auto from real-world date) tints flora and ground.
- **Sandbox mode** (L) — a `?sandbox=1` HUD panel that lets the user override individual biome knobs (creature count, fog, water on/off, flora kinds) on top of the chosen seed. Touches `src/ui.js` + `src/world.js`.
- **Secret seeds** (S) — a small lookup table mapping a handful of cute seeds (e.g. `0xC0FE`, `0xBEEF`) to easter-egg combinations: tuned biome + camera + extra landmark. Touches `src/seed.js` + `src/world.js`.

---

_Conventions reminder for any of the above: no build step, no npm. New libraries (if truly needed) go through the importmap in `index.html`. Determinism-sensitive code must run synchronously inside `generateWorld` before `Math.random` is restored._
