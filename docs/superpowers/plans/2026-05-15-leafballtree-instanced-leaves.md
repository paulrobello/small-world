# Leafballtree Instanced Leaves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `leafballtree` leaves from many individual `Mesh` objects into three reusable `InstancedMesh` batches while preserving the current leaf gradient and wind flutter.

**Architecture:** Keep trunk and branch meshes unchanged. Add small foliage-instancing helpers in `src/flora.js`, bucket leaf transforms by the existing three materials, and patch the leaf wind shader to derive per-leaf phase from `instanceMatrix` when instanced. Add static Python invariants to lock in the optimization and shader behavior.

**Tech Stack:** Vanilla ES modules, Three.js `InstancedMesh`, `MeshStandardMaterial.onBeforeCompile`, Python `unittest` static invariant tests.

---

### Task 1: Add test coverage for instanced leafballtree leaves

**Files:**
- Modify: `tests/test_verdant_grove_custom_domain.py`

- [ ] **Step 1: Add a static invariant test**

Append this method inside `VerdantGroveCustomDomainTest` after `test_verdant_uses_leafballtree_with_custom_leaf_wind`:

```python
    def test_leafballtree_uses_instanced_leaf_batches(self) -> None:
        flora = (ROOT / "src" / "flora.js").read_text()

        self.assertIn("makeInstancedLeafBatch", flora)
        self.assertIn("new THREE.InstancedMesh(geometry, material, matrices.length)", flora)
        self.assertIn("leafBuckets", flora)
        self.assertIn("leafBuckets[matIndex].push(matrix.clone())", flora)
        self.assertIn("USE_INSTANCING", flora)
        self.assertIn("modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)", flora)
        self.assertNotIn("const leaf = new THREE.Mesh(leafGeo, mat);", flora)
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
python3 -m unittest tests.test_verdant_grove_custom_domain.VerdantGroveCustomDomainTest.test_leafballtree_uses_instanced_leaf_batches
```

Expected: FAIL because `makeInstancedLeafBatch`, `leafBuckets`, and `USE_INSTANCING` are not implemented yet.

---

### Task 2: Implement instanced leaf batches and shader origin support

**Files:**
- Modify: `src/flora.js`

- [ ] **Step 1: Patch `applyLeafPlateWind()` for instancing**

Replace the existing `leafOrigin` line in the injected vertex shader:

```glsl
          vec3 leafOrigin = vec3(modelMatrix[3].x, modelMatrix[3].y, modelMatrix[3].z);
```

with:

```glsl
          #ifdef USE_INSTANCING
            vec3 leafOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 leafOrigin = vec3(modelMatrix[3].x, modelMatrix[3].y, modelMatrix[3].z);
          #endif
```

Keep the existing phase, gust, flutter, and transformed offsets unchanged.

- [ ] **Step 2: Add a helper above `FLORA_BUILDERS`**

Add this helper near the other local helper functions before `export const FLORA_BUILDERS = {`:

```javascript
function makeInstancedLeafBatch(geometry, material, matrices) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}
```

- [ ] **Step 3: Bucket leaf transforms in `leafballtree()`**

Inside `leafballtree()`, after `const basis = new THREE.Matrix4();`, add scratch objects:

```javascript
    const leafBuckets = leafMats.map(() => []);
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
```

Change `addLeafRing` so its default argument is a material index, not a material object:

```javascript
    const addLeafRing = ({ count, phi, shell = 1, scale = 0.8, matIndex = 1, phase = 0, lift = 0.12, yOffset = 0 }) => {
```

Within the loop, replace the individual leaf mesh creation and `g.add(leaf)` path with an Object3D transform carrier:

```javascript
        const leaf = new THREE.Object3D();
        leaf.position.set(
          canopyCenter.x + normal.x * canopyRadius.x * shell,
          canopyCenter.y + normal.y * canopyRadius.y * shell + yOffset,
          canopyCenter.z + normal.z * canopyRadius.z * shell
        );
        orientLeaf(leaf, normal, lift);
        leaf.rotateX(0.02 + lift * 0.18);
        leaf.rotateZ((Math.random() - 0.5) * 0.08);
        const s = scale * (0.92 + Math.random() * 0.16);
        scaleVec.set(s * 0.94, s * 1.18, s);
        matrix.compose(leaf.position, leaf.quaternion, scaleVec);
        leafBuckets[matIndex].push(matrix.clone());
```

Update call sites:

```javascript
    addLeafRing({ count: 7, phi: 0.07, shell: 0.54, scale: 0.72, matIndex: 1, phase: 0.18, lift: 0.32, yOffset: 0.40 });
```

and in the row loop:

```javascript
      const matIndex = row === 0 ? 2 : row > 5 ? 0 : 1;
      addLeafRing({
        count: rowCounts[row],
        phi,
        shell: 1.09 - t * 0.15 + (Math.random() - 0.5) * 0.01,
        scale: rowScale,
        matIndex,
        phase: (row % 2) * (Math.PI / rowCounts[row]),
        lift: 0.22 - t * 0.10,
      });
```

After all rings are generated and before branch generation, add the instanced batches:

```javascript
    for (let i = 0; i < leafBuckets.length; i++) {
      const leaves = makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i]);
      if (leaves) g.add(leaves);
    }
```

- [ ] **Step 4: Verify focused tests pass**

Run:

```bash
python3 -m unittest tests.test_verdant_grove_custom_domain.VerdantGroveCustomDomainTest.test_leafballtree_uses_instanced_leaf_batches tests.test_verdant_grove_custom_domain.VerdantGroveCustomDomainTest.test_verdant_uses_leafballtree_with_custom_leaf_wind
```

Expected: PASS.

---

### Task 3: Run full verification and review diff

**Files:**
- Verify: `src/flora.js`
- Verify: `tests/test_verdant_grove_custom_domain.py`

- [ ] **Step 1: Run all static tests**

Run:

```bash
python3 -m unittest discover -s tests
```

Expected: all tests pass.

- [ ] **Step 2: Check the app server starts**

Run:

```bash
make start
make status
make stop
```

Expected: server starts on port 1999, reports running, then stops cleanly.

- [ ] **Step 3: Review the implementation diff**

Run:

```bash
git diff -- src/flora.js tests/test_verdant_grove_custom_domain.py
```

Expected: only the shader origin patch, instanced-batch helper, leafballtree leaf batching, and static invariant test changed.
