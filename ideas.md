# Ideas for Enhancing small-world

A running list of enhancement ideas for the Three.js terrarium. Each idea is tagged with rough scope (S/M/L) and notes about which parts of `main.js` it would touch. All ideas should respect the project's **cute / rounded / painterly / soft-motion** vibe — see `CLAUDE.md` § Vibe.

Remove completed items from this list, commit and push so its live on github pages

---

## Weather & Atmosphere

- **Passing storm** (M) — occasionally drift a darker cloud across the island that casts a soft ground shadow, briefly intensifies fog, and triggers rain particles if biome allows. Touches `src/sky.js` + `src/environment.js`.
- **Rainbow after rain** (S) — when a rain biome's storm ends, fade in a thin arc rainbow ring opposite the sun for ~10s. Pure shader/sprite. Touches `src/sky.js`.
- **Snow accumulation** (M) — for cold biomes, gradually whiten the top of terrain vertices facing up while snow particles play; reset on regenerate. Touches `src/environment.js` + `src/terrain.js`.
- **Petals & pollen drift** (S) — meadow/bloom biomes get a slow horizontal pollen drift layer (cheap point sprites) alongside existing particles. Touches `src/environment.js` + `src/biomes.js`.

## Audio

- **Ambient bed per biome** (S) — soft loop chosen by biome id (wind, rustle, drips, crackle). One `<audio>` element, crossfade on regenerate. Mute toggle in HUD.
- **Creature chirps** (S) — occasional very-soft pitched blip when a creature transitions states. Web Audio API, tiny `OscillatorNode` envelope, no samples needed.
- **Wind-chime ping on landmark discover** (S) — single soft chime when a hidden landmark first becomes visible after regenerate. Web Audio. Depends on **Hidden landmarks**.

## Stretch / Big Swings

- **Sandbox mode** (L) — a `?sandbox=1` HUD panel that lets the user override individual biome knobs (creature count, fog, water on/off, flora kinds) on top of the chosen seed. Touches `src/ui.js` + `src/world.js`.
- **Secret seeds** (S) — a small lookup table mapping a handful of cute seeds (e.g. `0xC0FE`, `0xBEEF`) to easter-egg combinations: tuned biome + camera + extra landmark. Touches `src/seed.js` + `src/world.js`.

---

_Conventions reminder for any of the above: runtime dependencies are npm packages bundled by Vite; use `make dev` for local HMR and `make build` for production verification. Determinism-sensitive code must run synchronously inside `generateWorld` before `Math.random` is restored._
