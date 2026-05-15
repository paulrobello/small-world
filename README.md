# a small world

A Three.js terrarium that grows a tiny floating-island world — biome, terrain, flora, creatures, birds, and weather — from a 16-bit seed. Cute and painterly by design.

**Live demo:** https://small-world.pardev.net/

Every world is deterministic from its seed (visible in the URL as `?seed=0x____`), so a link reproduces exactly what you see. Hit *regenerate* for a fresh roll, or share your URL to send someone the exact same island.

## Screenshots

A handful of seeds across different biomes — click any image to load that exact world.

|   |   |
|---|---|
| [![verdant grove (0xcfff)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-verdant-cfff.png)](https://small-world.pardev.net/?seed=0xcfff) | [![coral atoll (0x0ac5)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-coral-0ac5.png)](https://small-world.pardev.net/?seed=0x0ac5) |
| [![lavender marsh (0xe480)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-marsh-e480.png)](https://small-world.pardev.net/?seed=0xe480) | [![twilight meadow (0x07de)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-twilight-07de.png)](https://small-world.pardev.net/?seed=0x07de) |
| [![golden steppe (0xc32c)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-golden-c32c.png)](https://small-world.pardev.net/?seed=0xc32c) | [![cloud island (0x3f2a)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-cloud-3f2a.png)](https://small-world.pardev.net/?seed=0x3f2a) |
| [![frozen vale (0x7462)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-frozen-7462.png)](https://small-world.pardev.net/?seed=0x7462) | |

## Features

- Twelve biomes, each with its own palette, weather, flora, and creature variants.
- Big-eyed creatures that wander, sleep, burrow, and occasionally travel in families. Walkers and caterpillars in **fuzzy biomes** (mossy ruins, cloud island, frozen vale, mushroom grove) wear a shell-fur shader for a soft hairy silhouette.
- Caterpillars, butterflies, bees, and flocks of birds that pick targets within the world.
- Day/night cycle with per-biome dusk and night palettes.
- Per-frame visual polish: selective bloom on emissive elements (glow flowers, lanterns, sun), optional tilt-shift miniature blur, soft circular shadows under every creature, sky reflections on water biomes, parallax mountain backdrop, GPU-particle shader with per-particle life/size, dust kicks under footsteps.
- Photo mode (freeze the sim, save a PNG) and first-person stroll mode.
- **Inspect mode** (`?inspect=1`) — a neutral studio backdrop for examining a single creature or caterpillar. Cycle biome/variant with keyboard, pause and frame-step animation, copy the URL to share an exact recreation.
- Follow-a-creature camera, bookmarks, biome filter, shareable seed links.
- Mobile-friendly — touch gestures, low-FX mode (`?lowfx=1`) on lower-end devices that drops fur, post-FX, and particle counts.

## Running it locally

No build step, no npm. Just a static HTTP server. The Makefile wraps Python's `http.server` with cache disabled:

```sh
make start      # serves at http://localhost:1999
make stop
make restart
make status
make logs
```

Then open http://localhost:1999. Edits to any source file (`main.js`, `src/*.js`, `style.css`, `index.html`) take effect on browser reload.

## Development notes

- There is intentionally no build step, package manager, test runner, linter, or formatter in this repo.
- Deployment is via GitHub Pages at the live demo URL above; completed enhancements are typically committed and pushed to publish.
- AI coding agents should start with [`CLAUDE.md`](CLAUDE.md), which is also referenced by `AGENTS.md` and `GEMINI.md` compatibility stubs.

## Stack

- [Three.js](https://threejs.org/) r0.184 (ES module, loaded via importmap from jsDelivr)
- [simplex-noise](https://github.com/jwagner/simplex-noise.js) for terrain
- Plain vanilla JS — no bundler, no package manager, no transpilation

## Project layout

- `main.js` — boots the renderer, camera, and animation loop
- `src/` — world generation, entities, UI, terrain, biomes, etc. (one file per concern)
- `index.html` / `style.css` — static HUD shell
- `server.py` / `Makefile` — local dev server
- [`CLAUDE.md`](CLAUDE.md) — architecture notes, conventions, and the project's design constraints
- [`ideas.md`](ideas.md) — running enhancement list
