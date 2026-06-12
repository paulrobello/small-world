# Reddit Release Announcement

> Marketing draft — title options and post copy for announcing the project on
> Reddit. Not part of the build or runtime; kept here for reuse on the next
> public update.

## Title Options

- Small World: a browser-based floating island terrarium with fully procedural biomes and creatures

## Post Draft

I just put the first public version of Small World online:

Live demo: https://small-world.pardev.net/
GitHub: https://github.com/paulrobello/small-world

Small World is a single-page Three.js terrarium that generates a tiny floating island from a 16-bit seed. Each seed picks a biome, terrain shape, flora, creatures, birds, weather, particles, music, and visual treatment. The URL stores the seed, so if you find a world you like, the link recreates the same island for someone else.

The project has twelve biomes right now, including things like verdant grove, coral atoll, cloud island, ashen wastes, frozen vale, mushroom grove, mossy ruins, and volcanic glass. The creatures are intentionally simple and cute: they wander, sleep, burrow, fly, perch, and react to the day/night cycle. There are also caterpillars, butterflies, bees, birds, glow flowers, fur shaders, water reflections, bloom, tilt-shift, grass controls, photo mode, first-person stroll mode, and an inspect mode for looking at individual creatures and plants.

This was built as a solo dev project, but with heavy AI assistance. I used AI coding agents for a lot of the implementation, iteration, test writing, debugging, and cleanup, while I handled direction, taste, acceptance testing, and all the "no, that looks wrong" decisions. It was a useful experiment in treating AI less like a one-shot generator and more like a very fast pair programmer that still needs supervision, constraints, and review.

The stack is intentionally plain:

- Three.js
- Vanilla JavaScript modules
- Vite
- Deterministic seeded generation with simplex noise
- GitHub Pages for deployment

The thing I am most interested in is whether it feels pleasant to explore for a few minutes. It is not a game with goals yet. It is more of a procedural toy box: roll a world, follow a creature, walk around, take a photo, share a seed, repeat.

I would appreciate feedback on:

- Which biomes feel strongest or weakest
- Performance on different devices and browsers
- Whether the UI is understandable without reading instructions
- Any seeds that produce especially good or broken worlds
- Ideas for making the world feel more alive without turning it into a full game

If you try it, send me any seeds you like. The seed is the `?seed=0x____` value in the URL.

