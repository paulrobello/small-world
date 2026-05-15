import * as THREE from "three";
import { state } from "./state.js";

// Shared soft-disc texture — radial gradient, white centre fading to alpha 0.
// Re-built once per session, never disposed (cheap, persistent across regens).
let _shadowTex = null;
function getShadowTexture() {
  if (_shadowTex) return _shadowTex;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.85)");
  g.addColorStop(0.55, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _shadowTex = new THREE.CanvasTexture(c);
  _shadowTex.colorSpace = THREE.SRGBColorSpace;
  return _shadowTex;
}

// One InstancedMesh holds all shadow discs. Slots are reassigned each frame so
// the buffer can outlive creature lifetimes (e.g. burrowers disappearing). Any
// unused slot gets a zero-scale matrix and is effectively invisible.
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function makeShadowDisks(biome) {
  const tex = getShadowTexture();
  // Sized to a generous upper bound — creatures + caterpillars + 16 slack.
  const cap = Math.max(64, state.creatures.length + state.caterpillars.length + 16);
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // Tint the shadow with a darkened biome fog so it feels grounded. Cloudlike
  // islands get softer, lighter shadows so the surface keeps its airy feel.
  const tint = new THREE.Color(biome.fog).offsetHSL(0, 0, biome.cloudlike ? -0.18 : -0.4);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: tint,
    transparent: true,
    depthWrite: false,
    opacity: biome.cloudlike ? 0.26 : 0.45,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  // Buffer is rewritten every frame from stepShadowDisks — declare the
  // streaming usage hint up front so the driver picks the right upload path
  // from frame 1 instead of heuristically migrating after a few frames.
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5; // sit below most flora, above the terrain
  // Start with every slot zero-scaled so nothing flashes before the first step.
  for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, _ZERO);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.capacity = cap;
  // High-water mark — tracks the highest active slot index written last
  // frame. stepShadowDisks only zeros slots between the current count and
  // this mark, instead of zero-filling every unused slot every frame.
  mesh.userData.prevActive = 0;
  return mesh;
}

export function stepShadowDisks(disks, heightFn) {
  if (!disks || !heightFn) return;
  const cap = disks.userData.capacity;
  let i = 0;

  for (const c of state.creatures) {
    if (i >= cap) break;
    if (!c.group || !c.group.visible) {
      disks.setMatrixAt(i++, _ZERO);
      continue;
    }
    const p = c.group.position;
    const y = heightFn(p.x, p.z);
    _v.set(p.x, y + 0.02, p.z);
    let scale = c.scale * 1.6;
    if (c.flies) {
      // Soaring fliers cast a small, faint disc. currentHover is animated
      // each frame in stepCreature.
      const t = Math.min(1, (c.currentHover ?? 0) / 3);
      scale *= 1 - 0.7 * t;
    }
    _s.set(scale, scale, scale);
    _q.identity();
    _m.compose(_v, _q, _s);
    disks.setMatrixAt(i++, _m);
  }

  for (const c of state.caterpillars) {
    if (i >= cap) break;
    if (!c.segments || c.segments.length === 0) {
      disks.setMatrixAt(i++, _ZERO);
      continue;
    }
    // Single disc beneath the head segment is enough — body follows trail.
    const seg = c.segments[0];
    const y = heightFn(seg.position.x, seg.position.z);
    _v.set(seg.position.x, y + 0.02, seg.position.z);
    const scale = c.scale * 0.7;
    _s.set(scale, scale, scale);
    _q.identity();
    _m.compose(_v, _q, _s);
    disks.setMatrixAt(i++, _m);
  }

  // Zero only the slots that were active last frame but aren't this frame
  // (the "newly-empty" tail). Slots beyond the previous high-water mark
  // were already zeroed earlier and don't need rewriting.
  const prevActive = disks.userData.prevActive ?? cap;
  const zeroEnd = Math.min(cap, prevActive);
  for (let j = i; j < zeroEnd; j++) disks.setMatrixAt(j, _ZERO);
  disks.userData.prevActive = i;
  disks.instanceMatrix.needsUpdate = true;
}
