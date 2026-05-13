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
import { stepCreature, stepCaterpillar, stepButterfly, stepBee, wakeCreature } from "./src/fauna.js";
import { stepFlock } from "./src/birds.js";
import { stepParticles, stepWater, stepDirtPuffs, stepDustKicks } from "./src/environment.js";
import { stepGrass } from "./src/grass.js";
import { stepShadowDisks } from "./src/shadows.js";
import { stepClouds } from "./src/sky.js";
import { LOWFX } from "./src/lowfx.js";
import { sharedFurUniforms } from "./src/fur.js";
import { initPostFX } from "./src/postfx.js";
import { updateWaterReflection } from "./src/reflection.js";
import {
  initUi,
  loadSettings,
  getFollowTarget,
  setFollowTarget,
  isStrolling,
  stepStroll,
  isPhotoMode,
} from "./src/ui.js";
import { INSPECT, setupInspect, stepInspect } from "./src/inspect.js";

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
  0.03,   // tight near plane so first-person walking close to walls / slopes
          // doesn't slice the terrain into the view frustum.
  400
);
camera.position.set(20, 14, 20);

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

// Persisted settings must be applied BEFORE initPostFX so the composer is
// built with the user's saved bloom / tilt-shift / softParticles / outline /
// ao / depthFog values rather than the defaults. initUi runs later in this
// file and re-loads settings to drive its checkboxes — harmless on the
// second call since localStorage is the source of truth.
loadSettings();

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
  // Soft-particle shader samples tDepth by gl_FragCoord/uResolution.
  if (state.particles && state.particles.material.uniforms.uResolution) {
    state.particles.material.uniforms.uResolution.value.set(w, h);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
// FPS counter — exponential moving average so the readout doesn't jitter.
const _fpsEl = document.getElementById("fps-value");
let _fpsEma = 60;
let _fpsLastUpdate = 0;
function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const rawT = clock.elapsedTime;
  if (rawDt > 0 && _fpsEl) {
    const instFps = 1 / rawDt;
    _fpsEma += (instFps - _fpsEma) * 0.08;
    if (rawT - _fpsLastUpdate > 0.25) {
      _fpsEl.textContent = _fpsEma.toFixed(0);
      _fpsLastUpdate = rawT;
    }
  }
  // Photo mode freezes the simulation so users can capture a still frame.
  // We hold dt at 0 AND freeze `t` (step funcs use sin(t*speed) for idle
  // bobbing, which would still drift if t kept advancing). Camera input
  // and rendering keep running on the frozen state.
  const paused = isPhotoMode();
  if (!paused) state.lastSimT = rawT;
  const dt = paused ? 0 : rawDt;
  const t = paused ? (state.lastSimT ?? rawT) : rawT;

  // Fur shells read these once per frame — shared across all fur instances.
  // Done before INSPECT branch so fuzzy specimens get lit correctly.
  if (state.sunLight) {
    sharedFurUniforms.uLightDir.value
      .copy(state.sunLight.position)
      .normalize();
  }

  if (INSPECT) {
    // shared wind shader time still needs to advance for any swaying flora
    state.windUniforms.uTime.value = t;
    stepInspect(dt, t);
    controls.update();
    // Bypass the composer in inspect — the renderer's tone mapping plus
    // OutputPass tone mapping inside the composer crushes the neutral-gray
    // studio backdrop to black. Inspect mode doesn't need bloom anyway.
    renderer.render(scene, camera);
    return;
  }

  if (!paused) {
    // shared wind shader time
    state.windUniforms.uTime.value = t;
    stepGrass(camera);
    updateDayNight(t);
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
    // Walk-up wake: any sleeping creature within ~2.5 mesh-local units of
    // the player pops awake. Camera lives in world space; creatures live
    // inside state.world (scaled by worldScale), so convert camera XZ to
    // mesh-local before comparing. Wakes both spawned sleepers and any
    // walker that has curled up from the night sleepiness cycle.
    const ws = state.userSettings.worldScale ?? 1;
    const wsi = 1 / ws;
    const camLx = camera.position.x * wsi;
    const camLz = camera.position.z * wsi;
    const WAKE_DIST_SQ = 2.5 * 2.5;
    for (const c of state.creatures) {
      const asleep = c.isSleeper || (!c.flies && c.sleepiness > 0.4);
      if (!asleep) continue;
      const p = c.group.position;
      const dx = p.x - camLx;
      const dz = p.z - camLz;
      if (dx * dx + dz * dz < WAKE_DIST_SQ) wakeCreature(c);
    }
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

  // Update tilt-shift focus: project the orbit target to screen-Y for the
  // sharp band, and measure camera→target distance for the depth focus.
  if (postfx.isActive && postfx.isActive()) {
    const focusPoint = controls.target;
    const v = focusPoint.clone().project(camera);
    // v.y is in NDC [-1, 1]; convert to UV [0, 1]. Three's UV origin is at
    // bottom-left, so (v.y * 0.5 + 0.5) gives the right vertical axis.
    const focusY = v.y * 0.5 + 0.5;
    const focusZ = camera.position.distanceTo(focusPoint);
    postfx.updateTiltShiftFocus(focusY, focusZ);
    postfx.render(scene, camera);
  } else {
    renderer.render(scene, camera);
  }
}

initUi({ camera, canvas, controls, renderer });

// kickoff — honour ?seed=XXXX in the URL if present, or ?inspect=1 for studio
if (INSPECT) {
  setupInspect(scene, renderer, camera, controls);
} else {
  const initialSeed = readSeedFromUrl() ?? newRandomSeed();
  generateWorld(initialSeed);
}
animate();
