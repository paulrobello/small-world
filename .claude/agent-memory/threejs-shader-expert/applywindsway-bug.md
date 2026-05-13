---
name: applywindsway-bug
description: applyWindSway in src/util.js has a no-op chain check and applies wind in mesh-local axes for InstancedMesh (incoherent wildflower bending)
metadata:
  type: project
---

Two related issues in `src/util.js:26-58`:

## 1. Dead chain guard
```js
const prev = material.onBeforeCompile;
material.onBeforeCompile = (shader) => {
  if (prev && prev !== material.onBeforeCompile) prev(shader);  // always true
```
`prev` is captured BEFORE the reassignment, so `prev !== material.onBeforeCompile` is always true once the closure runs. The `!==` check does nothing. Should be `if (prev) prev(shader);`.

**Why:** misleads readers into thinking recursion is guarded; no real-world consequence today.
**How to apply:** during any cleanup pass on util.js, drop the comparison. If a future patch needs to detect itself, capture a sentinel before assignment.

## 2. Mesh-local bend on InstancedMesh
The vertex patch writes wind delta to `transformed.x` and `transformed.z` (mesh-local axes), but each `InstancedMesh` instance has a random Y yaw in its `instanceMatrix`. So a yawed wildflower bends along its own rotated local-X, not in a coherent world-X direction. A field of wildflowers reads as "every flower bouncing randomly" instead of "wind blowing through."

`src/grass.js:155-181` already solved this: extract world-space images of mesh-local axes from `instanceMatrix[0].xz` and `instanceMatrix[2].xz`, then inverse-rotate the world-space bend delta back into local space.

**Why:** the only InstancedMesh consumer of applyWindSway today is `makeWildflowerField` in environment.js — each wildflower has `e.set((Math.random()-0.5)*tilt, fullRotation ? Math.random()*PI*2 : 0, ...)`. Wildflower instances DO get full Y rotation, so the bug is live.
**How to apply:** when fixing the wind incoherence, copy the `axW`/`azW`/`invXZScaleSq` pattern from grass.js verbatim into applyWindSway's GLSL patch. Build world-space delta as `vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05)`, then `dot(axW, delta) * invXZScaleSq` for X, same for Z.

## See also
- [[pipeline-overview]] (grass shader's correct pattern)
