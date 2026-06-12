import * as THREE from "three";
import { state } from "./state.js";
import { LOWFX, MIDFX } from "./lowfx.js";

// Build a small dedicated scene containing clones of the sky elements so we
// can render a sky-only reflection into a low-res render target without
// reparenting the live sky each frame. Uniforms on the cloned materials
// share references with the live materials' uniforms, so day/night updates
// flow through naturally without any extra wiring.

export function makeWaterReflection(_biome) {
  const rt = new THREE.WebGLRenderTarget(
    LOWFX || MIDFX ? 128 : 256,
    LOWFX || MIDFX ? 128 : 256,
    { depthBuffer: false }
  );
  const scene = new THREE.Scene();

  // Clone the live sky dome / starfield / aurora into the reflection scene.
  // makeSkyDome / makeStarfield / makeAurora are factories — calling them
  // again here would give independent uniforms, so we instead clone the live
  // meshes and re-bind their materials to the live refs. Live position is
  // synced each frame in updateWaterReflection (see "follow refs" below) —
  // the live dome / starfield follow the camera, so the clones have to
  // follow too or the reflection RT renders mostly black.
  let domeClone = null;
  let starfieldClone = null;
  let auroraClone = null;
  let cloudsClone = null;
  let cloudPairs = null;
  if (state.skyDome) {
    domeClone = state.skyDome.clone();
    // The reflection camera mirrors the main camera across y=0 by flipping
    // its `up` vector. That makes the view matrix's determinant negative
    // (a true mirror), which inverts what counts as "back face" from the
    // GPU's perspective. The live dome uses `side: THREE.BackSide` (visible
    // from inside the sphere); through the mirrored view its faces become
    // front-facing and get culled, leaving a hole in the reflection RT —
    // visible to the water shader as a dark polygon on the lake surface.
    //
    // Clone the material with `side: DoubleSide` so the dome renders
    // regardless of winding interpretation, and re-bind its uniforms back
    // to the live refs so `updateDayNight` mutations still flow through.
    const m = state.skyDome.material.clone();
    m.side = THREE.DoubleSide;
    if (state.skyDome.material.uniforms) {
      for (const k of Object.keys(state.skyDome.material.uniforms)) {
        m.uniforms[k] = state.skyDome.material.uniforms[k];
      }
    }
    domeClone.material = m;
    scene.add(domeClone);
  }
  if (state.starfield) {
    starfieldClone = state.starfield.clone();
    starfieldClone.material = state.starfield.material;
    scene.add(starfieldClone);
  }
  if (state.aurora) {
    // Aurora is a group; clone each curtain mesh individually so its shader
    // material (and live uniforms) persist into the reflection scene.
    auroraClone = new THREE.Group();
    state.aurora.traverse((o) => {
      if (o.isMesh && o.material && o.material.uniforms) {
        const m = o.clone();
        m.material = o.material;
        auroraClone.add(m);
      }
    });
    scene.add(auroraClone);
  }
  if (state.clouds) {
    // Clouds are a Group of Sprites, each with its own SpriteMaterial clone
    // (so the tint can drift per-sprite). Share each live material with its
    // reflection-side twin so day/night tinting updates flow through. Track
    // (live, clone) pairs so we can sync per-sprite positions each frame —
    // each sprite drifts independently via stepClouds.
    cloudsClone = new THREE.Group();
    cloudPairs = [];
    state.clouds.traverse((o) => {
      if (o.isSprite) {
        const s = o.clone();
        s.material = o.material;
        cloudsClone.add(s);
        cloudPairs.push([o, s]);
      }
    });
    scene.add(cloudsClone);
  }

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 800);

  return { rt, scene, camera, domeClone, starfieldClone, auroraClone, cloudsClone, cloudPairs };
}

// Tear down a reflection target safely. The cloned scene reuses live sky
// materials (which `disposeGroup` will have just disposed at regen time), so
// the scene must NOT be rendered again after this point. Clearing it makes
// the hazard structural rather than ordering-dependent — any stray future
// `updateWaterReflection` call against the disposed reflection becomes a
// no-op draw of an empty scene instead of a GPU read of disposed resources.
export function disposeWaterReflection(refl) {
  if (!refl) return;
  if (refl.scene) {
    refl.scene.clear();
    refl.scene = null;
  }
  // Drop clone refs so a stray frame doesn't try to follow disposed sky meshes.
  refl.domeClone = null;
  refl.starfieldClone = null;
  refl.auroraClone = null;
  refl.cloudsClone = null;
  refl.cloudPairs = null;
  if (refl.rt) refl.rt.dispose();
}

// Y=0 reflection matrix. Allocated once at module scope; reused every
// frame. Static — never mutated after construction.
const _reflectMat = new THREE.Matrix4().makeScale(1, -1, 1);

export function updateWaterReflection(refl, renderer, mainCamera, controls) {
  if (!refl) return;
  // Mirror across y=0 by composing the main camera's world matrix with an
  // explicit reflection matrix. This avoids the lookAt-degeneracy that the
  // old `up.set(0,-1,0); lookAt(...)` approach hit when the user looks
  // straight down — at that angle the mirrored camera's forward vector
  // becomes parallel to its up vector, lookAt returns garbage matrices,
  // and the reflection RT renders mostly black (manifesting as a dark
  // circular patch on the lake surface).
  //
  // The reflection scales space by (1, -1, 1), which gives the view a
  // negative determinant — winding-order is inverted from the GPU's
  // perspective. The cloned sky-dome material is set to DoubleSide so it
  // renders regardless of winding interpretation (see makeWaterReflection).
  // controls is unused now but kept in the signature for compatibility.
  void controls;
  refl.camera.matrixAutoUpdate = false;
  refl.camera.matrix.multiplyMatrices(_reflectMat, mainCamera.matrixWorld);
  refl.camera.matrix.decompose(
    refl.camera.position,
    refl.camera.quaternion,
    refl.camera.scale
  );
  refl.camera.matrixWorld.copy(refl.camera.matrix);
  refl.camera.matrixWorldInverse.copy(refl.camera.matrixWorld).invert();

  // Build a perspective projection from the main camera's FOV/aspect, but
  // with an extended far plane. The sky dome follows the live camera and
  // has radius 380; the reflection camera sits across y=0 from the live
  // camera, so the dome's far surface relative to the reflection camera
  // can be up to ~`380 + 2 * |camY|` units away — beyond the main camera's
  // far=400. Clipping the dome's far surface produces a black hole at the
  // center of the reflection RT, which then samples onto the lake as a
  // dark circular patch. 1200 covers any reasonable orbit altitude.
  refl.camera.fov = mainCamera.fov;
  refl.camera.aspect = mainCamera.aspect;
  refl.camera.near = Math.max(0.1, mainCamera.near);
  refl.camera.far = 1200;
  refl.camera.updateProjectionMatrix();

  if (!refl.scene) return; // defensive: scene was torn down by disposeWaterReflection

  // Follow refs — the live sky dome / starfield / aurora are repositioned
  // each frame in main.js to track the camera (otherwise the dome's edge
  // would slide off-screen at any non-zero scale). The clones in the
  // reflection scene have to be kept in sync, or the reflection camera
  // looks "up" at a stale dome position and renders mostly empty/clear
  // background — which the water shader then samples and Fresnel-mixes
  // into a circular dark patch on the lake. Copying the world transform
  // is the minimum needed; we don't sync rotation/scale because none of
  // these meshes get rotated/scaled per-frame.
  if (refl.domeClone && state.skyDome) {
    refl.domeClone.position.copy(state.skyDome.position);
  }
  if (refl.starfieldClone && state.starfield) {
    refl.starfieldClone.position.copy(state.starfield.position);
  }
  if (refl.auroraClone && state.aurora) {
    refl.auroraClone.position.copy(state.aurora.position);
  }
  // Each cloud sprite drifts independently in stepClouds, so sync each one.
  if (refl.cloudPairs) {
    for (const [live, clone] of refl.cloudPairs) {
      clone.position.copy(live.position);
    }
  }

  renderer.setRenderTarget(refl.rt);
  renderer.clear();
  renderer.render(refl.scene, refl.camera);
  renderer.setRenderTarget(null);
}
