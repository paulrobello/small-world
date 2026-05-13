---
name: darkbiome-bloom-gate
description: src/world.js disables bloom on darkBiome (obsidian, ashen) citing UnrealBloomPass precision — but UnrealBloomPass isn't used anymore, gate may be stale
metadata:
  type: project
---

`src/world.js:223` does `state.postfx.setBloom(state.userSettings.bloom && !biome.darkBiome)`. The comment block at `src/postfx.js:218-222` justifies this by claiming "Very dark biomes interact poorly with UnrealBloomPass: additive blend on HalfFloat target loses precision against their near-zero linear values and crushes to pure black."

**Problem:** the pipeline doesn't use UnrealBloomPass. It uses a custom layer-gated bloom render + multipass 5-tap Gaussian + additive `_bloomCompositeShader` that runs AFTER tone mapping (so its inputs are LDR base + LDR bloom). The precision argument doesn't apply the same way.

**Why this matters:** obsidian and ashen biomes have glow eyes, obsidian shards with emissive halos, and ember/spark particles — exactly the things bloom was designed to make pretty. They're silently disabled on the moodiest biomes in the game.

**How to apply / verify:** in a future session, A/B test the obsidian biome with bloom enabled (remove the `!biome.darkBiome` clause OR flip it manually in devtools via `window.__sw.postfx.setBloom(true)`). If the blackout doesn't reproduce on the current pipeline, drop the gate. The comment block in postfx.js needs to be updated either way.

**Don't blind-fix:** the original author may have observed a real issue on a specific platform; verify before deleting the safeguard.

## See also
- [[bloom-design]]
- [[pipeline-overview]]
