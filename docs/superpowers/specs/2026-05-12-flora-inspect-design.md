# Flora / Scenery Inspect View — Design

**Date:** 2026-05-12
**Scope:** Extend `src/inspect.js` so the `?inspect=1` view can frame flora,
crystals, lanterns, single grass/wildflower/pebble specimens, and a small
water disc the same way it currently frames creatures.

## Motivation

`src/inspect.js` already gives us a turntable studio for one creature at a
time, with seeded reproducibility and URL sync. The same affordance — pick a
biome, pick a kind, see it isolated on a neutral backdrop — is just as useful
for flora and scenery. Today, debugging a crystal's silhouette or comparing
the mushroom under every biome's palette means regenerating worlds until the
right thing happens to spawn near the camera.

## Scope

In scope:

- All 16 entries in `FLORA_BUILDERS` (tree, pine, mushroom, fern, rock, grass,
  deadtree, pillar, archstone, crystal, bigmushroom, berrybush, lantern,
  coral, balloontree, obsidianshard).
- Four synthetic single-instance scenery variants: `wildflower`, `grassblade`,
  `pebble`, `water`. These are field/instanced things in normal worlds — we
  build a single-mesh stand-in for inspect.

Out of scope (and stays the same):

- Creature variants (walker / flier / sleeper / burrower / caterpillar / snail)
  — left alone.
- Particle systems, birds, dust kicks, dirt puffs — these are global effects,
  not per-instance specimens.
- Reflection RT for the water variant — keep the inspect water disc minimal
  (base color + transparency + roughness/metalness), no sky reflection scene.

## Design

### State

`inspect.js` gains a category axis on top of the existing variant axis:

```
CATEGORIES = ["creature", "flora"]
VARIANTS_BY_CATEGORY = {
  creature: [walker, flier, sleeper, burrower, caterpillar, snail],
  flora:    [tree, pine, mushroom, fern, rock, grass, deadtree, pillar,
             archstone, crystal, bigmushroom, berrybush, lantern, coral,
             balloontree, obsidianshard,
             wildflower, grassblade, pebble, water]
}
```

Module-scope state adds `_categoryIdx` alongside the existing
`_biomeIdx` / `_variantIdx`. `_variantIdx` becomes an index into the current
category's list, not a global index. Switching category resets
`_variantIdx` to 0.

A variant entry shape is `{ name, kind, build(biome) }` where `kind` is one
of `"creature"`, `"caterpillar"`, `"flora"`. The first two preserve the
existing step path; `"flora"` is a no-step path — wind sway and material
animation come from the already-running `windUniforms.uTime` advance in
`main.js`.

### Synthetic scenery variants

These live in `inspect.js` as `INSPECT_SCENERY_BUILDERS` (siblings to the
existing variant list, not exported to `environment.js` — they're inspect-only
single-instance stand-ins, not reusable):

- **wildflower** — one `IcosahedronGeometry(0.05, 0)` scaled `(1, 0.7, 1)`,
  biome's first `WILDFLOWER_PALETTES` entry, `emissive` set when
  `biome.glowFlowers`. Scaled up ~6× for the disc so it reads.
- **grassblade** — three blades using the same `PlaneGeometry(0.06, 0.34, 1, 3)`
  + tip-color shader patch as `makeGrassField`, clustered as a tiny tuft
  centered on the disc. Single tuft, not a field.
- **pebble** — one `jitterGeo(IcosahedronGeometry(0.08, 0), 0.025)` scaled
  `(1.3, 0.45, 1.3)` with biome `cliff` color offset. Scaled up ~3× for visibility.
- **water** — `PlaneGeometry(1.8, 1.8)` rotated flat, transparent
  `MeshStandardMaterial` with `biome.water || biome.fog` color, `opacity 0.55`,
  `roughness 0.32`, `metalness 0.18`. No reflection RT patch.

### Spawn / lift

`spawnSpecimen` branches by `variant.kind`:

- `creature` / `caterpillar`: existing paths, unchanged.
- `flora`: call `variant.build(biome)` (which returns a `THREE.Group`), add
  to scene at `(0, lift, 0)`. `lift` defaults to 0, with per-variant
  overrides for variants whose authored origin sits below the disc surface
  (computed empirically from current builders; `crystal` and `obsidianshard`
  embed a base shard, others sit at y=0).

A simple fallback: compute the group's bounding box after building and set
`lift = -bbox.min.y` clamped to `>= 0` so any flora author who places
geometry below y=0 still rests on the disc.

### Determinism

`spawnSpecimen` already wraps the build call in
`Math.random = mulberry32(seed)` for creatures. Apply the same wrap for
flora variants. Flora builders that call `Math.random()` (rock palette
jitter, pine tier count, grass per-blade color offset, wildflower palette
shuffles) will therefore reproduce from the seed.

For variants that are 100% deterministic from biome, the seed has no
visible effect — that's fine, "r" just becomes a no-op visually. The hint
text is hidden in flora category (per user choice).

### Keyboard

- `[` / `]` — biome (unchanged)
- `,` / `.` — variant within current category (unchanged semantics)
- **`k` — switch category** (creature ↔ flora). Resets `_variantIdx` to 0.
- `r` — reroll seed (unchanged; visible effect on flora is variant-dependent)
- `space` / `←` / `→` — pause + step (unchanged; flora has no per-frame
  step, but `space` already gates `windUniforms.uTime` via main.js, so wind
  sway pauses correctly with no extra code)

### URL

Add `category=creature|flora`. Read at boot via `_findCategoryIdx`,
defaulting to `creature` (back-compat with existing inspect URLs). Written
back by `_syncUrl` on every state change.

URL shape after change:

```
?inspect=1&category=flora&biome=meadow&variant=mushroom&seed=0x3f2a
```

### HUD

`updateHud` adds a category label between biome and variant:

```
INSPECT · meadow · flora · mushroom    [/] biome  k category  ,/. variant  ...
```

The `r reroll` hint is suppressed when category is `flora`.

## Components touched

| File | Change |
|---|---|
| `src/inspect.js` | Refactor `VARIANTS` → `VARIANTS_BY_CATEGORY`, add `_categoryIdx`, add `INSPECT_SCENERY_BUILDERS`, add `k` key handler, branch `spawnSpecimen` on `variant.kind`, update HUD + URL sync. |
| `src/inspect.js` | Import `FLORA_BUILDERS` from `./flora.js` and `WILDFLOWER_PALETTES` from `./biomes.js`. |

No other files change. `CLAUDE.md` "What's in `inspect.js`" paragraph gets
a one-sentence update describing the new category axis.

## Risks / non-obvious bits

1. **Wind-sway shader uses `windUniforms.uTime`** — verify that `main.js`'s
   uniform advance runs even when no creature path is active. (Spot check:
   `main.js` advances it in the global frame, not inside any kind-specific
   branch — safe.)
2. **`applyWindSway` materials are cached per-world in `_pool`** — flora
   inspect calls `resetFloraPool()` is NOT currently invoked, so cycling
   variants accumulates materials in the pool. We need to call
   `resetFloraPool()` from `spawnSpecimen` for the flora branch to avoid
   leaks. (Existing creature path doesn't touch the pool.)
3. **`crystal` / `obsidianshard` lift** — verify post-build bbox approach
   handles these; if not, hard-code per-variant lift values.
4. **Lantern's emissive orb** — bloom is gated by the post-FX composer
   which isn't used in inspect (the comment in `postfx.js` says inspect
   skips the composer). The orb will render flat-bright but not bloomed.
   That's acceptable for inspect — it's a faithful "what does this mesh
   look like without bloom" view.

## Verification

After implementation:

1. `make restart` then open
   `http://localhost:1999/?inspect=1&category=flora&biome=meadow&variant=tree`
   in the browser via `agentchrome`. Confirm the tree is centered, lit,
   and frames the disc.
2. Press `]` a few times — biome changes. The same tree variant retints
   per biome.
3. Press `.` a few times — variant changes through the flora list.
4. Press `k` — switches back to creature category, walker selected.
5. Press `k` again — flora, tree selected.
6. Reload page — URL params restore last-viewed state.
7. Spot check `crystal`, `obsidianshard`, `pebble`, `water` — they sit on
   the disc, no clipping below.

No automated tests (project has none).
