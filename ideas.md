# Ideas for Enhancing small-world

A running list of enhancement ideas for the Three.js terrarium. Each idea is tagged with rough scope (S/M/L) and notes about which parts of `main.js` it would touch. All ideas should respect the project's **cute / rounded / painterly / soft-motion** vibe — see `CLAUDE.md` § Vibe.

Remove completed items from this list, commit and push so its live on github pages

---

## Particles

- **`bubble`** — for water-adjacent biomes (marsh, coral). Slow upward drift with slight wobble.
- **`leaf`** — drifting falling leaves in verdant/golden biomes. Slower than dust, with rotation.
- **`spark`** — for ashen/volcanic; smaller, hotter, faster-rising than `ember`.
- **`rain`** — vertical streaks in marsh. Could combine with a subtle ground-ripple shader on terrain.

## World Generation

- **Caves / arches** (L) — carve negative-space holes through the island using a third noise field with a CSG-style threshold. Probably needs a marching-cubes pass instead of `PlaneGeometry` — large change, save for later.

## Camera & Interaction

- **Click-to-focus** (S) — clicking a creature smoothly pans the OrbitControls target to it and follows for a few seconds before releasing. Raycaster on the creatures array.
- **Photo mode** (S) — `P` hides HUD, freezes auto-rotate, prints the seed at the bottom of the canvas. Useful for shareable screenshots.
- **Time-of-day slider** (M) — manipulate sun color/position + fog density. Each biome defines `sun.day` / `sun.dusk` / `sun.night` palettes. Auto-cycle option.
- **First-person stroll** (M) — a "ground-walk" camera mode that hovers at creature height and uses `heightFn` to follow terrain. Mouse-look only, no physics.
- **Pinch-to-shrink / -grow** (S) — gentle scale knob on the whole `world` group so the terrarium can fit different layouts.

## Audio

- **Ambient bed per biome** (S) — soft loop chosen by biome id (wind, rustle, drips, crackle). One `<audio>` element, crossfade on regenerate. Mute toggle in HUD.
- **Creature chirps** (S) — occasional very-soft pitched blip when a creature transitions states. Web Audio API, tiny `OscillatorNode` envelope, no samples needed.

## UX / HUD

- **Seed bookmarks** (S) — small drawer where the user can star the current seed; stored in `localStorage` and listed with biome thumbnails (rendered offscreen at low res).
- **"Surprise me" with biome filter** (S) — a small biome-icon row that toggles which biomes `newRandomSeed` is allowed to land on.
- **Shareable URL copy button** (S) — already write the seed to the URL; add a one-click "copy link" button.
- **Reveal animation** (S) — when a new world is generated, fade fog density from high → biome-default over ~1.5s so the world emerges from mist.

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
