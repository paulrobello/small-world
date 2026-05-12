import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { state } from "./src/state.js";
import { readSeedFromUrl, newRandomSeed } from "./src/seed.js";
import {
  generateWorld,
  updateDayNight,
  setSceneRef,
  setControlsRef,
} from "./src/world.js";
import { stepCreature, stepCaterpillar, stepButterfly, stepBee } from "./src/fauna.js";
import { stepFlock } from "./src/birds.js";
import { stepParticles, stepWater, stepDirtPuffs, stepDustKicks } from "./src/environment.js";
import { stepShadowDisks } from "./src/shadows.js";
import { stepClouds } from "./src/sky.js";
import { LOWFX } from "./src/lowfx.js";
import { sharedFurUniforms } from "./src/fur.js";
import { initPostFX } from "./src/postfx.js";
import { updateWaterReflection } from "./src/reflection.js";
import {
  initUi,
  getFollowTarget,
  setFollowTarget,
  isStrolling,
  stepStroll,
  isPhotoMode,
} from "./src/ui.js";

// ─────────────────────────────────────────────────────────────────────────────
// Renderer / scene / camera
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
  // Lets us grab the canvas pixels via toDataURL after a render — needed
  // for photo-mode capture. Negligible perf cost for this scene.
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOWFX ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.add(state.world);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.1,
  400
);
camera.position.set(34, 25, 34);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.22;
controls.minDistance = 14;
controls.maxDistance = 72;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minPolarAngle = Math.PI / 6;
controls.target.set(0, 1.5, 0);
// touch gestures: one finger rotates, two-finger pinch dollies (no pan)
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_ROTATE,
};

setSceneRef(scene);
setControlsRef(controls);
state.camera = camera;
state.renderer = renderer;

const postfx = initPostFX(renderer, scene, camera);
state.postfx = postfx;

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postfx.onResize(w, h);
  if (state.waterMesh && state.waterMesh.material.userData.reflectionUniforms) {
    state.waterMesh.material.userData.reflectionUniforms.uInvViewport.value.set(
      1 / w,
      1 / h
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const rawT = clock.elapsedTime;
  // Photo mode freezes the simulation so users can capture a still frame.
  // We hold dt at 0 AND freeze `t` (step funcs use sin(t*speed) for idle
  // bobbing, which would still drift if t kept advancing). Camera input
  // and rendering keep running on the frozen state.
  const paused = isPhotoMode();
  if (!paused) state.lastSimT = rawT;
  const dt = paused ? 0 : rawDt;
  const t = paused ? (state.lastSimT ?? rawT) : rawT;

  if (!paused) {
    // shared wind shader time
    state.windUniforms.uTime.value = t;
    updateDayNight(t);
    // Fur shells read these once per frame — shared across all fur instances.
    if (state.sunLight) {
      sharedFurUniforms.uLightDir.value
        .copy(state.sunLight.position)
        .normalize();
      sharedFurUniforms.uLightIntensity.value = state.sunLight.intensity;
    }
  }

  for (const c of state.creatures) stepCreature(c, dt, t, state.heightFn);
  for (const c of state.caterpillars) stepCaterpillar(c, dt, t, state.heightFn);
  for (const b of state.butterflies)
    stepButterfly(b, dt, t, state.flowerSpots, state.heightFn);
  for (const b of state.bees)
    stepBee(b, dt, t, state.flowerSpots, state.heightFn);
  for (const f of state.flocks) stepFlock(f, dt, t);
  stepParticles(state.particles, dt, t);
  stepWater(state.waterMesh, dt, t);
  stepDirtPuffs(state.dirtPuffs, dt);
  stepDustKicks(state.dustKicks, dt);
  stepShadowDisks(state.shadowDisks, state.heightFn);
  stepClouds(state.clouds, dt);

  // Sky dome and starfield follow the camera so the gradient zenith and the
  // star sphere are always centered on the viewer — otherwise they read as
  // fixed-in-world objects (a bright "circle" of zenith color in the sky
  // that drifts across the view as the camera orbits). Both live under
  // state.world which has worldScale applied; divide by it so the final
  // position lands on the camera regardless of scale.
  const invWorldScale = 1 / (state.userSettings.worldScale || 1);
  if (state.skyDome) {
    state.skyDome.position.copy(camera.position).multiplyScalar(invWorldScale);
  }
  if (state.starfield) {
    state.starfield.position.copy(camera.position).multiplyScalar(invWorldScale);
  }

  // Subtle parallax: mountains drift opposite to camera azimuth so they read
  // as farther from the camera than the islands.
  if (state.mountains && state.mountainBasePos) {
    const az = Math.atan2(camera.position.x, camera.position.z);
    state.mountains.position.x = state.mountainBasePos.x - Math.sin(az) * 0.6;
    state.mountains.position.z = state.mountainBasePos.z - Math.cos(az) * 0.6;
  }

  if (isStrolling()) {
    stepStroll(dt);
  } else {
    // Smoothly track a followed creature, if any.
    const ft = getFollowTarget();
    if (ft && ft.group && ft.group.parent) {
      const p = ft.group.position;
      const k = Math.min(1, dt * 4);
      controls.target.x += (p.x - controls.target.x) * k;
      controls.target.y += (p.y + 0.6 - controls.target.y) * k;
      controls.target.z += (p.z - controls.target.z) * k;
    } else if (ft) {
      setFollowTarget(null);
    }
    controls.update();
  }
  // Refresh sky-only reflection RT for water biomes. One extra render pass
  // per frame at 256×256 — cheap, and shared uniforms mean day/night updates
  // flow through without extra wiring.
  if (state.waterReflection) {
    updateWaterReflection(state.waterReflection, renderer, camera, controls);
  }

  // Update tilt-shift focus band: project the island origin to screen-Y so
  // the sharp band tracks the island as the camera orbits.
  if (postfx.isActive && postfx.isActive()) {
    const v = new THREE.Vector3(0, 1.5, 0).project(camera);
    // v.y is in NDC [-1, 1]; convert to UV [0, 1]. Three's UV origin is at
    // bottom-left, so (v.y * 0.5 + 0.5) gives the right vertical axis.
    postfx.updateTiltShiftFocus(v.y * 0.5 + 0.5);
    postfx.render(scene, camera);
  } else {
    renderer.render(scene, camera);
  }
}

initUi({ camera, canvas, controls, renderer });

// kickoff — honour ?seed=XXXX in the URL if present
const initialSeed = readSeedFromUrl() ?? newRandomSeed();
generateWorld(initialSeed);
animate();
