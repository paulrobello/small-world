# a small world

A Three.js terrarium that grows a tiny floating-island world — biome, terrain, flora, creatures, birds, and weather — from a 16-bit seed. Cute and painterly by design.

**Live demo:** https://paulrobello.github.io/small-world/

Every world is deterministic from its seed (visible in the URL as `?seed=0x____`), so a link reproduces exactly what you see. Hit *regenerate* for a fresh roll, or share your URL to send someone the exact same island.

## Screenshots

A handful of seeds across different biomes — click any image to load that exact world.

|   |   |
|---|---|
| [![verdant grove (0xcfff)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-verdant-cfff.png)](https://paulrobello.github.io/small-world/?seed=0xcfff) | [![coral atoll (0x0ac5)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-coral-0ac5.png)](https://paulrobello.github.io/small-world/?seed=0x0ac5) |
| [![lavender marsh (0xe480)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-marsh-e480.png)](https://paulrobello.github.io/small-world/?seed=0xe480) | [![twilight meadow (0x07de)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-twilight-07de.png)](https://paulrobello.github.io/small-world/?seed=0x07de) |
| [![golden steppe (0xc32c)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-golden-c32c.png)](https://paulrobello.github.io/small-world/?seed=0xc32c) | [![cloud island (0x3f2a)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-cloud-3f2a.png)](https://paulrobello.github.io/small-world/?seed=0x3f2a) |
| [![frozen vale (0x7462)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-frozen-7462.png)](https://paulrobello.github.io/small-world/?seed=0x7462) | [![frozen vale (0xdd2b)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-frozen-dd2b.png)](https://paulrobello.github.io/small-world/?seed=0xdd2b) |

## Features

- Twelve biomes, each with its own palette, weather, flora, and creature variants.
- Big-eyed creatures that wander, sleep, burrow, and occasionally travel in families.
- Caterpillars, butterflies, bees, and flocks of birds that pick targets within the world.
- Day/night cycle with per-biome dusk and night palettes.
- Photo mode (freeze the sim, save a PNG) and first-person stroll mode.
- Follow-a-creature camera, bookmarks, biome filter, shareable seed links.
- Mobile-friendly — touch gestures, low-FX mode on lower-end devices.

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
