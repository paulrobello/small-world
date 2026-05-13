---
name: bloom-design
description: small-world bloom pipeline — layer-gated, HalfFloat full-res, depth-shared with prepass, multipass 5-tap linear-sampling Gaussian
metadata:
  type: project
---

# Bloom design (src/postfx.js)

## Choices and rationale

- **Layer-gated, not luminance-gated.** Meshes opt in via `mesh.layers.enable(BLOOM_LAYER)` at construction. Bloom pass restricts the camera to layer 1 for the scene render. Decouples bloom from material brightness — cute pastel creature bodies stay non-bloomed even if bright.
- **HalfFloat RT (`THREE.HalfFloatType`).** Needed for HDR headroom — emissives at linear values >1 (glow flowers, lantern orbs) contribute to bloom in proportion to their brightness instead of being clamped at 1. Also kills 8-bit gradient banding in soft halo falloffs.
- **Full resolution.** Because the bloom RT shares its `depthTexture` with the depth pre-pass for depth-occluded emissives (glow-eye-behind-tree gets culled). Shared depth attachment requires matching dimensions.
- **5-tap linear-sampling Gaussian.** Each tap pairs two Gaussian samples by reading at their bilinear-weighted midpoint. Same shape as a 9-tap kernel with ~half the fetches.
- **Multipass for radius.** Per-pass radius ≤ 1 (safe no-gap zone for the 5-tap kernel). Slider ≤100% scales per-pass radius on 3 base pairs; slider >100% pins per-pass at 1 and enables more pairs (up to 8). Stacked convolutions give effective σ ≈ √N × σ_base.
- **Shared `uRadius` uniform.** `ShaderPass` constructor deep-clones uniforms via `UniformsUtils.clone`, so each pass would get its own disconnected `{value:1}`. After construction, `pass.uniforms.uRadius = bloomRadiusUniform` re-points back to the shared ref.
- **`bloomCompositePass.enabled = false` when off.** EffectComposer skips disabled passes entirely — one fewer fullscreen quad per frame.

## Hazards

- **Shared depth attachment.** Bloom render with `autoClearDepth=false` + default `depthWrite=true` writes emissive depth back into the shared texture. Values match the prepass because the emissive geometry is the same — currently benign, but the design is fragile.
- **EffectComposer's RT2 clone.** Constructor clones the supplied RT, including the depth attachment. Explicitly disposed (`postfx.js:440-444`) and re-pointed at the shared instance.
- **Custom RT pins `_pixelRatio=1`.** All resize math in `onResize` must multiply by `renderer.getPixelRatio()` manually.

## Open question

The `darkBiome` bloom gate (`src/world.js:223`) cites UnrealBloomPass precision issues — but UnrealBloomPass isn't in this pipeline anymore. See [[darkbiome-bloom-gate]] — possibly unnecessary now, gating away a feature that would actually look great on obsidian/ashen.

## Perf escape hatch

If bloom becomes the dominant fragment cost (likely on mid-tier mobile at slider=300%, 8 pairs × full res), the obvious move is half-resolution bloom RT. Cost: lose depth-occluded emissives (glow eyes would shine through trees). For the cute aesthetic that's probably acceptable.

## See also
- [[pipeline-overview]]
- [[darkbiome-bloom-gate]]
