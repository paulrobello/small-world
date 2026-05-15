# Creature Footprints and Soft-Ground Trails Design

## Goal

Add cute, readable creature marks on soft ground:

- Four-legged walkers leave soft paired oval footprints.
- Fliers leave soft oval landing marks, plus a tiny poof when landing on sand.
- Caterpillars and snails leave short continuous soft trails.
- Marks are strongest in sand and subtler in other soft-ground biomes.

The effect should feel gentle and cartoony, not muddy, gritty, or realistic.

## Scope

This is a visual environmental effect only. It does not change terrain geometry, collision, creature navigation, or saved seed output.

In scope:

- Runtime marks emitted by existing creature movement.
- Biome-tuned color, opacity, lifetime, and poof behavior.
- Bounded GPU/CPU cost with lower caps under `LOWFX`.
- Manual verification on the crimson dunes seed `0xa156` and at least one non-desert soft biome.

Out of scope:

- Persistent terrain deformation.
- Painting into terrain textures.
- Footprints for birds, butterflies, bees, fish, or airborne fliers.
- UI controls for enabling/disabling trails.

## Recommended Approach

Use a capped instanced ground-mark layer parented to `state.world`.

A new `GroundMarks` system will manage a fixed pool of flat, transparent mark instances. Each mark records position, heading, scale, color, opacity, age, and lifetime. `stepGroundMarks` fades old marks and hides expired instances. Because the mesh is parented under `state.world`, normal world regeneration and `disposeGroup` teardown handle cleanup.

This approach matches existing project patterns such as `shadowDisks`, `dustKicks`, and grass pushers: small visual state, explicit per-frame stepping, bounded resource use, and no new dependencies.

## State and Module Boundaries

Add `state.groundMarks = null` in `src/state.js`.

Add these exports to `src/environment.js`:

- `makeGroundMarks(biome)` — creates the instanced mark pool or returns `null` when the biome has no soft-ground marks.
- `emitGroundMark(markSystem, opts)` — reserves/reuses a slot for an oval or ribbon mark.
- `stepGroundMarks(markSystem, dt, heightFn)` — ages/fades/lifts active marks to the current terrain height.

`src/world.js` creates the mark system after terrain and biome setup, then adds it to `state.world`.

`main.js` calls `stepGroundMarks(state.groundMarks, dt, state.heightFn)` after fauna stepping and before rendering.

Creature modules emit marks at movement events but do not own mark rendering.

## Biome Tuning

Add optional `groundMarks` config to biome definitions:

```js
groundMarks: {
  color: "#5f2424",
  opacity: 0.34,
  life: 7.0,
  softness: 1.0,
  poof: "sand",
}
```

Interpretation:

- `color`: mark tint, usually a darker/desaturated ground color.
- `opacity`: maximum opacity before fade.
- `life`: seconds before the mark fully disappears.
- `softness`: visual scale multiplier for blur/size tuning.
- `poof`: optional tiny touchdown particle style, initially only `"sand"`.

Initial tuning:

- Desert / crimson dunes: strongest, warm dark-red sand marks, landing poof enabled.
- Verdant, golden, mossy, twilight: subtle flattened-ground marks.
- Water-heavy, snowy, rocky, ashen, coral, cloudlike biomes: omitted or very faint unless visual testing shows they read well.

This keeps the effect soft-ground focused without hardcoding behavior to biome IDs in creature code.

## Walker Footprints

Walkers already have footstep phase detection in `stepCreature`. Replace the current center-position dust-only emission with per-foot mark emission:

1. Detect the existing rising-edge footstep timing.
2. Transform that foot's local `(x,z)` offset by the creature heading.
3. Place an oval mark at the transformed world-local XZ and `heightFn(x,z) + lift`.
4. Rotate the oval along the heading with a small side-dependent toe angle.
5. Emit only for moving, non-sleeping ground walkers on soft-ground biomes.

Because walkers have four feet, the visible pattern should alternate diagonal pairs, matching the existing trot phases.

## Flier Landing Marks

Fliers emit marks when their landing state transitions into `landed`.

Add a previous-state field on each creature, or compare before/after in `stepCreature`, so landing emission fires once per touchdown. On touchdown:

- Emit a compact cluster of two to four soft oval marks under the body.
- If `biome.groundMarks.poof === "sand"`, also emit one tiny `makeDustKick`-style poof with reduced particle count/opacity.
- Do not emit for fish or fliers landing on water.

This avoids trails while flying and makes landing feel physical on soft ground.

## Caterpillar and Snail Trails

Caterpillars and snails already maintain a head trail. Emit short ribbon-like ground marks from the head path at a throttled cadence:

- Caterpillars: narrow, soft, segmented ribbon marks.
- Snails: slightly wider/slower, glossier-looking soft trail if the biome color supports it; otherwise the same subtle flattened mark.
- Emit no more than every fixed movement distance or small time interval to avoid dense overdraw.

Each ribbon mark is a short, scaled oval/rounded rectangle aligned with movement heading. Overlap creates a continuous trail without needing a custom curve mesh.

## Rendering Details

Use `THREE.InstancedMesh` with a small plane geometry rotated flat on XZ. The material should be transparent, depth-tested, and depth-write disabled. Each active instance sits a small lift above the terrain to avoid z-fighting.

Instance data:

- Matrix: position, heading, and non-uniform scale.
- Color: biome mark color, faded toward transparent through material opacity or per-instance color brightness.
- User data arrays: age, life, base opacity, base scale, active flag.

If per-instance alpha is awkward with the stock material, use a small `ShaderMaterial` with instanced `aAlpha` and a soft oval fragment mask. This is still local to `environment.js` and avoids terrain shader changes.

## Performance

Use a fixed capacity:

- Normal: approximately 180–260 marks.
- `LOWFX`: approximately 60–90 marks.

When full, reuse the oldest slot. This prevents unbounded allocation and keeps the effect stable during long sessions.

Emission throttles:

- Walker marks only on footstep events.
- Flier marks only on touchdown transitions.
- Caterpillar/snail marks by distance or a short timer.

## Edge Cases

- Paused/photo/selection mode: no new marks because `dt` is zero and creature stepping is frozen.
- World regeneration: marks are disposed with `state.world` and `state.groundMarks` is reset.
- Water: skip marks below the dry threshold used by fauna water avoidance.
- Steep slopes: sample `heightFn` each frame or at emission; use a small lift so marks stay attached without flicker.
- Follow/stroll modes: no special behavior; marks remain world-local.

## Verification

Manual checks:

1. Load `http://localhost:1999/?seed=0xa156` and confirm crimson dunes walkers leave four-leg oval footprints.
2. Wait for a flier to land and confirm it leaves landing prints plus a tiny sand poof.
3. Confirm caterpillars/snails leave continuous soft trails rather than discrete paired prints.
4. Check one soft non-desert biome for subtler marks.
5. Check a non-soft or water-heavy biome to confirm marks are absent or unobtrusive.
6. Confirm marks fade and do not grow unbounded over time.

Automated verification:

- Run the existing test suite after implementation.
- Run the app with the dev server and inspect the browser console for runtime errors.
