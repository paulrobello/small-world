# a small world

A Three.js terrarium that grows a tiny floating-island world — biome, terrain, flora, creatures, birds, and weather — from a 16-bit seed. Cute and painterly by design.

**Live demo:** https://small-world.pardev.net/

Every world is deterministic from its seed (visible in the URL as `?seed=0x____`), so a link reproduces exactly what you see. Hit *regenerate* for a fresh roll, or share your URL to send someone the exact same island.

## Screenshots

All twelve biomes — click any image to load that exact world.

|   |   |
|---|---|
| [![verdant grove (0x2676)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-verdant-2676.png)](https://small-world.pardev.net/?seed=0x2676) | [![coral atoll (0x160d)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-coral-160d.png)](https://small-world.pardev.net/?seed=0x160d) |
| [![twilight meadow (0x5766)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-twilight-5766.png)](https://small-world.pardev.net/?seed=0x5766) | [![lavender marsh (0xd246)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-marsh-d246.png)](https://small-world.pardev.net/?seed=0xd246) |
| [![golden steppe (0x3bf3)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-golden-3bf3.png)](https://small-world.pardev.net/?seed=0x3bf3) | [![cloud island (0xc8f6)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-cloud-c8f6.png)](https://small-world.pardev.net/?seed=0xc8f6) |
| [![ashen wastes (0x79d1)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-ashen-79d1.png)](https://small-world.pardev.net/?seed=0x79d1) | [![frozen vale (0xed6e)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-frozen-ed6e.png)](https://small-world.pardev.net/?seed=0xed6e) |
| [![crimson dunes (0x4f1f)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-desert-4f1f.png)](https://small-world.pardev.net/?seed=0x4f1f) | [![mushroom grove (0x9708)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-grove-9708.png)](https://small-world.pardev.net/?seed=0x9708) |
| [![mossy ruins (0x19ea)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-mossy-19ea.png)](https://small-world.pardev.net/?seed=0x19ea) | [![volcanic glass (0x589a)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-obsidian-589a.png)](https://small-world.pardev.net/?seed=0x589a) |

A fairy ring in the verdant grove:

[![fairy ring — verdant grove (0xaf5e)](https://raw.githubusercontent.com/paulrobello/small-world/main/screenshots/small-world-verdant-af5e-fairy_ring.png)](https://small-world.pardev.net/?seed=0xaf5e)

## Features

- **Twelve biomes** — each with a unique palette, weather, flora mix, creature variants, and original instrumental music score.
- **Procedural fauna** — big-eyed creatures that wander, sleep, burrow, and travel in families; caterpillars, butterflies, bees, will-o'-wisps, and flocks of birds. Fuzzy biomes (mossy ruins, cloud island, frozen vale, mushroom grove) give walkers and caterpillars a shell-fur shader for a soft hairy silhouette.
- **Day/night cycle** — 120-second cycle with per-biome dusk and night palettes. Creatures respond to darkness: walkers curl up and sleep, fliers descend and grow drowsy, each personality (shy, bold, sleepy, bouncy) has a different sleep threshold.
- **Visual polish** — selective bloom on emissive elements (glow flowers, lanterns, sun), optional tilt-shift miniature blur, soft circular shadows under every creature, sky reflections on water biomes, parallax mountain backdrop, GPU-particle shader with per-particle life/size, dust kicks under footsteps.
- **Photo mode** — freeze the sim and save a PNG; first-person stroll mode lets you walk among the creatures.
- **Inspect mode** (`?inspect=1`) — a neutral studio backdrop for examining a single creature or flora variant. Cycle biome/variant with keyboard, pause and frame-step animation, copy the URL to share an exact recreation.
- **Interactive UI** — follow-a-creature camera, bookmarks, biome filter, shareable seed links, wind and grass density controls, FX toggles, auto-regenerate timer, and per-biome music track selection.
- **Mobile-friendly** — touch gestures, low-FX mode (`?lowfx=1`) on lower-end devices that drops fur, post-FX, and particle counts.

## Running it locally

Install dependencies, then start the Vite dev server with hot reload:

```sh
npm install
make dev        # foreground server at http://localhost:2001
make dev-start  # background server at http://localhost:2001
make dev-stop
make dev-restart
```

Production build and preview:

```sh
make build
make preview    # serves the built app at http://localhost:2001
```

Edits to `main.js`, `src/*.js`, `style.css`, and `index.html` are reflected by Vite HMR when possible.

## Development notes

- Runtime dependencies are installed via npm and bundled by Vite.
- `make lint` runs ESLint over `main.js` and `src/`; `make checkall` runs all JS/Python tests, lint, and the production build.
- Deployment is via GitHub Pages at the live demo URL above; completed enhancements are typically committed and pushed to publish. Original music scores for each biome are served separately from `https://static.pardev.net/small-world/music/` so large MP3 files stay out of git.
- AI coding agents should start with [`CLAUDE.md`](CLAUDE.md), which is also referenced by `AGENTS.md` and `GEMINI.md` compatibility stubs.

## Stack

- [Three.js](https://threejs.org/) r0.184, bundled by Vite
- [simplex-noise](https://github.com/jwagner/simplex-noise.js) for terrain
- Plain vanilla JS modules with Vite for development and production builds

## Project layout

- `main.js` — boots the renderer, camera, and animation loop
- `src/` — world generation, entities, UI, terrain, biomes, etc. (one file per concern)
- `src/fauna/` — per-entity modules (creatures, caterpillars, butterflies, bees, will-o'-wisps)
- `index.html` / `style.css` — static HUD shell
- `Makefile` — Vite dev/build/preview/lint shortcuts
- `dist/` — deployment build (GitHub Pages)
- [`CLAUDE.md`](CLAUDE.md) — architecture notes, conventions, and the project's design constraints
- [`ideas.md`](ideas.md) — running enhancement list
