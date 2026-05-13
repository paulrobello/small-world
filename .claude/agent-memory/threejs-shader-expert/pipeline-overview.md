---
name: pipeline-overview
description: Per-frame render order and depth/feedback-loop structure of the small-world post-FX pipeline
metadata:
  type: project
---

# small-world FX pipeline (as of 2026-05-13)

Per frame in `main.js animate()`:

1. **stepGrass / stepCreature / stepCaterpillar / stepWater / stepShadowDisks / stepClouds** mutate scene state.
2. **updateWaterReflection** (if water biome): renders sky-dome+starfield+aurora-only into a 256×256 (LOWFX 128) RT via a mirrored camera. Cloned meshes share materials with live `state.world` — fragile during regen; works because no frame renders inside `generateWorld`.
3. **postfx.render()** (if any FX is active):
   a. **Depth pre-pass** — renders full scene into `depthRT` (WebGLRenderTarget with `DepthTexture` attached). Pre-pass is OUTSIDE the composer's ping-pong (sampling a depth tex while writing to its FBO is a feedback loop).
   b. **Bloom composer** (only if bloom enabled): saves camera layer mask, sets `cam.layers.set(BLOOM_LAYER=1)`, sets `renderer.autoClearDepth = false`, renders into `bloomRT` (HalfFloat, full physical resolution, shares `depthTexture` with depthRT). Then 1-8 H+V Gaussian blur pairs (5-tap linear-sampling, `depthTest=false`, `depthWrite=false`). Result goes to `_bloomCompositeShader` via `tBloom`.
   c. **Main composer**: RenderPass → bloomCompositePass (additive `tBloom * uStrength`) → depthFXPass (outlines+AO+depth-fog, all reading shared `tDepth`) → tiltShiftPass (hybrid band+depth focus, gamma-2.0 perceptual blur) → sRGB-only output pass.
4. Else: `renderer.render(scene, camera)` direct.

## Key shared resources
- `depthTexture` is attached to both `depthRT` and `bloomRT`. The bloom layer-filtered render runs with `autoClearDepth=false` and writes depth (default depthWrite=true on meshes). Values match the prepass because the emissive geometry is the same — but the design is fragile.
- `bloomComposer.renderTarget2.depthTexture` gets orphaned by EffectComposer's clone — explicitly disposed and re-pointed at the shared instance in `initPostFX` (`postfx.js:440-444`).
- Custom RT pins `EffectComposer._pixelRatio = 1`. `onResize` must multiply dims by `renderer.getPixelRatio()` for `bloomComposer.setSize`, `depthRT.setSize`, and the blur shaders' `uResolution`.

## Layer convention
- Layer 1 (`BLOOM_LAYER`) is enabled on glow eyes, glow flowers, crystal cores, lantern orbs, halos, obsidian shards, and antenna tips. Layer-gated bloom, not luminance-gated.

## Why custom sRGB output pass (not three's OutputPass)
RenderPass tone-maps to LDR; OutputPass would tone-map again, crushing darkBiome scenes (obsidian, ashen) to pure black. The custom `_srgbOutputShader` does only the linear→sRGB OETF.

## See also
- [[applywindsway-bug]]
- [[bloom-design]]
- [[darkbiome-bloom-gate]]
- [[lowfx-opt-in]]
