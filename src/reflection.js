import * as THREE from "three";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";

// Build a small dedicated scene containing clones of the sky elements so we
// can render a sky-only reflection into a low-res render target without
// reparenting the live sky each frame. Uniforms on the cloned materials
// share references with the live materials' uniforms, so day/night updates
// flow through naturally without any extra wiring.

export function makeWaterReflection(_biome) {
  const rt = new THREE.WebGLRenderTarget(
    LOWFX ? 128 : 256,
    LOWFX ? 128 : 256,
    { depthBuffer: false }
  );
  const scene = new THREE.Scene();

  // Clone the live sky dome / starfield / aurora into the reflection scene.
  // makeSkyDome / makeStarfield / makeAurora are factories — calling them
  // again here would give independent uniforms, so we instead clone the live
  // meshes and re-bind their materials to the live refs.
  if (state.skyDome) {
    const dome = state.skyDome.clone();
    dome.material = state.skyDome.material; // share material (and uniforms)
    scene.add(dome);
  }
  if (state.starfield) {
    const sf = state.starfield.clone();
    sf.material = state.starfield.material;
    scene.add(sf);
  }
  if (state.aurora) {
    // Aurora is a group; clone each curtain mesh individually so its shader
    // material (and live uniforms) persist into the reflection scene.
    const grp = new THREE.Group();
    state.aurora.traverse((o) => {
      if (o.isMesh && o.material && o.material.uniforms) {
        const m = o.clone();
        m.material = o.material;
        grp.add(m);
      }
    });
    scene.add(grp);
  }

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 800);

  return { rt, scene, camera };
}

export function updateWaterReflection(refl, renderer, mainCamera, controls) {
  if (!refl) return;
  // Mirror across y=0 (water sits at y=-0.12; close enough for a stylized look).
  refl.camera.position.set(
    mainCamera.position.x,
    -mainCamera.position.y,
    mainCamera.position.z
  );
  refl.camera.up.set(0, -1, 0); // flipped because we're underneath
  refl.camera.lookAt(controls.target.x, -controls.target.y, controls.target.z);
  refl.camera.up.set(0, 1, 0); // restore for any other consumers
  refl.camera.aspect = mainCamera.aspect;
  refl.camera.projectionMatrix.copy(mainCamera.projectionMatrix);
  refl.camera.projectionMatrixInverse.copy(mainCamera.projectionMatrixInverse);

  renderer.setRenderTarget(refl.rt);
  renderer.clear();
  renderer.render(refl.scene, refl.camera);
  renderer.setRenderTarget(null);
}
