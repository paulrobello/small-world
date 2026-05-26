import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { state } from "./src/state.js";
import { readSeedFromUrl, newRandomSeed, formatSeed } from "./src/seed.js";
import {
  generateWorld,
  updateDayNight,
  setSceneRef,
  setControlsRef,
} from "./src/world.js";
import { stepCreature, stepCaterpillar, stepButterfly, stepBee, wakeCreature, stepWillOWisp } from "./src/fauna.js";
import { stepFlock } from "./src/birds.js";
import {
  stepParticles,
  stepWater,
  stepDirtPuffs,
  stepDustKicks,
  stepFlySwarms,
  stepGroundMarks,
} from "./src/environment.js";
import { stepGrass } from "./src/grass.js";
import { stepShadowDisks } from "./src/shadows.js";
import { stepClouds } from "./src/sky.js";
import { LOWFX } from "./src/lowfx.js";
import { sharedFurUniforms } from "./src/fur.js";
import { initPostFX } from "./src/postfx.js";
import { updateWaterReflection } from "./src/reflection.js";
import {
  getPortalCameraSide,
  getPortalSideArrivalPose,
  isCameraPassingThroughPortal,
  updatePortalPreview,
} from "./src/portal.js";
import {
  restoreCreaturePovRenderHidden,
  setCreaturePovRenderHidden,
  syncCreaturePovCamera,
} from "./src/creaturePov.js";
import {
  initUi,
  loadSettings,
  getFollowTarget,
  setFollowTarget,
  stepStroll,
  stepTour,
  isAnyFP,
  isFlyMode,
  isPhotoFP,
  isStrolling,
  enterStrollFromPortal,
  getPhotoReviewGroup,
  isSelectingCreature,
  isManualPaused,
} from "./src/ui.js";
import { INSPECT, setupInspect, stepInspect } from "./src/inspect.js";
import {
  beginPerfFrame,
  endPerfFrame,
  measurePerfPhase,
  startPerfProbe,
} from "./src/perfProbe.js";

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
// PCFSoftShadowMap was deprecated in r180; PCFShadowMap is the supported
// PCF path now. The visual difference at the kernel sizes we use is
// negligible and the deprecated path internally falls back to this anyway.
renderer.shadowMap.type = THREE.PCFShadowMap;
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
controls.autoRotate = false;
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
// Debug-only handle for poking at the running scene from devtools/agentchrome
// during development. Safe to leave — it's just a window ref. Remove if it
// becomes load-bearing for anything besides debugging.
if (typeof window !== "undefined") window.__sw = { state, controls, scene, camera, renderer };
startPerfProbe({ state, scene, renderer });

// Persisted settings must be applied BEFORE initPostFX so the composer is
// built with the user's saved bloom / tilt-shift / outline / ao / depthFog
// values rather than the defaults. initUi runs later in this
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
});

let portalTravelInProgress = false;
const PORTAL_ARRIVAL_RETRY_LIMIT = 45;

function getActivePortals() {
  return state.portals?.length ? state.portals : (state.portal ? [state.portal] : []);
}

function travelThroughPortalIfNeeded() {
  if (portalTravelInProgress || state.isGeneratingWorld || !isStrolling()) return;
  const sourceBiome = state.currentBiome;
  const ws = state.userSettings.worldScale ?? 1;
  const portal = getActivePortals().find((candidate) => isCameraPassingThroughPortal(candidate, camera, ws));
  const targetBiome = portal?.targetBiome;
  if (!portal || !sourceBiome || !targetBiome) return;
  const targetSeed = portal.targetSeed ?? newRandomSeed({ allowedBiomeIds: [targetBiome.id], excludeBiomeId: sourceBiome.id });
  const portalSide = getPortalCameraSide(portal, camera, ws);
  const url = new URL(window.location.href);
  url.searchParams.set("seed", formatSeed(targetSeed));
  url.searchParams.set("portal", sourceBiome.id);
  url.searchParams.set("portalSide", String(portalSide));
  portalTravelInProgress = true;
  window.location.href = url.toString();
}

function enterPortalArrivalIfRequested(attempt = 0) {
  const params = new URLSearchParams(window.location.search);
  const portalParam = params.get("portal");
  if (!portalParam) return;
  const arrivalPortal = getActivePortals().find((candidate) => candidate.targetBiome?.id === portalParam) ?? state.portal;
  if (!arrivalPortal) {
    if (attempt < PORTAL_ARRIVAL_RETRY_LIMIT) requestAnimationFrame(() => enterPortalArrivalIfRequested(attempt + 1));
    return;
  }
  const arrivalSide = params.get("portalSide") === "-1" ? -1 : 1;
  const arrivalPose = getPortalSideArrivalPose(arrivalPortal, arrivalSide);
  if (!enterStrollFromPortal(arrivalPose.x, arrivalPose.z, arrivalPose.yaw)
    && attempt < PORTAL_ARRIVAL_RETRY_LIMIT) {
    requestAnimationFrame(() => enterPortalArrivalIfRequested(attempt + 1));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────────────────────────────────────
// THREE.Timer is the post-r180 replacement for the deprecated THREE.Clock.
// Calling `connect(document)` enables the Page Visibility API integration so
// switching tabs doesn't return a huge delta on the first frame back.
const timer = new THREE.Timer();
timer.connect(document);
// FPS counter — exponential moving average so the readout doesn't jitter.
const _fpsEl = document.getElementById("fps-value");
let _fpsEma = 60;
let _fpsLastUpdate = 0;
// Reused per-frame scratch vectors for projecting the active focus point into NDC.
const _focusProj = new THREE.Vector3();
const _focusDir = new THREE.Vector3();
const _underwaterColor = new THREE.Color();
function shouldApplyTiltShift() {
  if (isPhotoFP()) return state.userSettings.tiltShift;
  return state.userSettings.tiltShift && !isStrolling() && !isFlyMode() && !getFollowTarget();
}
function updateUnderwaterTint() {
  if (!postfx.setUnderwaterTint) return;
  const WATER_SURFACE_Y = -0.12 * (state.userSettings.worldScale || 1);
  const underwater = !!state.waterMesh && !!state.currentBiome?.water && camera.position.y < WATER_SURFACE_Y;
  const depth = underwater ? WATER_SURFACE_Y - camera.position.y : 0;
  const strength = underwater ? THREE.MathUtils.clamp(0.18 + depth * 0.18, 0, 0.42) : 0;
  const waterColor = _underwaterColor.set(state.currentBiome?.water || state.currentBiome?.fog || 0x3f9fb5);
  postfx.setUnderwaterTint(waterColor, strength);
}
function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const rawDt = Math.min(timer.getDelta(), 0.05);
  const rawT = timer.getElapsed();
  if (rawDt > 0 && _fpsEl) {
    const instFps = 1 / rawDt;
    _fpsEma += (instFps - _fpsEma) * 0.08;
    if (rawT - _fpsLastUpdate > 0.25) {
      _fpsEl.textContent = _fpsEma.toFixed(0);
      _fpsLastUpdate = rawT;
    }
  }
  // Photo mode AND creature-selection mode both freeze the simulation so
  // users can either capture a still frame or carefully click on a moving
  // target without it darting away. We hold dt at 0 AND freeze `t` (step
  // funcs use sin(t*speed) for idle bobbing, which would still drift if t
  // kept advancing). Camera input and rendering keep running on the frozen
  // state so the user can still rotate and aim.
  const paused = state.isGeneratingWorld || isSelectingCreature() || isManualPaused();
  if (!paused) state.lastSimT = rawT;
  const dt = paused ? 0 : rawDt;
  const t = paused ? (state.lastSimT ?? rawT) : rawT;
  beginPerfFrame();
  restoreCreaturePovRenderHidden();

  // Fur shells read these once per frame — shared across all fur instances.
  // Done before INSPECT branch so fuzzy specimens get lit correctly.
  if (state.sunLight) {
    sharedFurUniforms.uLightDir.value
      .copy(state.sunLight.position)
      .normalize();
  }

  if (INSPECT) {
    measurePerfPhase("inspect", () => {
      // shared wind shader time still needs to advance for any swaying flora
      state.windUniforms.uTime.value = t;
      stepInspect(dt, t);
      controls.update();
      // Bypass the composer in inspect — the renderer's tone mapping plus
      // OutputPass tone mapping inside the composer crushes the neutral-gray
      // studio backdrop to black. Inspect mode doesn't need bloom anyway.
      renderer.render(scene, camera);
    });
    endPerfFrame();
    return;
  }

  measurePerfPhase("windGrassDayNight", () => {
    if (!paused) {
      // shared wind shader time — frozen when the user disables wind in
      // settings, so grass and applyWindSway-driven foliage settle into a
      // still pose (easier to see other effects like the creature-push bend).
      if (state.userSettings.windEnabled !== false) {
        state.windUniforms.uTime.value = t;
      }
      stepGrass(camera, isAnyFP() ? camera.position : controls.target);
      updateDayNight(t);
    }
  });

  // Rebuild the per-frame mover-vs-mover collision list before any step
  // runs (so each stepX sees an up-to-date snapshot of where everyone is).
  // Walkers contribute one disc each; caterpillars contribute one disc per
  // body segment (`owner = c` shared across all of them, so the head skips
  // its own body via selfOwner in avoidObstacles). Fliers in the air are
  // excluded — their collision with walkers below them is uninteresting
  // and the height filter alone isn't enough since walkers pass `y=undefined`.
  //
  // Pool objects to avoid GC pressure from per-frame object literal
  // allocation. Grows if needed but never shrinks.
  measurePerfPhase("dynamicCollisionObstacles", () => {
    const dyn = state.dynamicObstacles;
    let _dynPool = state._dynPool;
    if (!_dynPool) {
      _dynPool = [];
      state._dynPool = _dynPool;
    }
    let di = 0;
    function nextDyn() {
      if (di < _dynPool.length) return _dynPool[di++];
      const obj = { x: 0, z: 0, r: 0, top: 0, owner: null };
      _dynPool.push(obj);
      di++;
      return obj;
    }
    dyn.length = 0;
    for (const c of state.creatures) {
      if (c.flies) continue;
      const p = c.group.position;
      const obj = nextDyn();
      obj.x = p.x; obj.z = p.z;
      obj.r = 0.32 * c.scale;
      obj.top = p.y + 0.5 * c.scale;
      obj.owner = c;
      dyn.push(obj);
    }
    for (const c of state.caterpillars) {
      const r = 0.22 * c.scale;
      for (let i = 0; i < c.segments.length; i++) {
        const sp = c.segments[i].position;
        const obj = nextDyn();
        obj.x = sp.x; obj.z = sp.z;
        obj.r = r;
        obj.top = sp.y + 0.25 * c.scale;
        obj.owner = c;
        dyn.push(obj);
      }
    }
  });

  measurePerfPhase("creatureMovement", () => {
    for (const c of state.creatures) stepCreature(c, dt, t, state.heightFn);
  });
  measurePerfPhase("caterpillarMovement", () => {
    for (const c of state.caterpillars) stepCaterpillar(c, dt, t, state.heightFn);
  });
  measurePerfPhase("airborneMovement", () => {
    for (const b of state.butterflies)
      stepButterfly(b, dt, t, state.flowerSpots, state.heightFn);
    for (const b of state.bees)
      stepBee(b, dt, t, state.flowerSpots, state.heightFn);
    for (const f of state.flocks) stepFlock(f, dt, t);
  });
  measurePerfPhase("environmentAnimation", () => {
    stepParticles(state.particles, dt, t);
    stepWater(state.waterMesh, dt, t);
    stepDirtPuffs(state.dirtPuffs, dt);
    stepDustKicks(state.dustKicks, dt);
    stepGroundMarks(state.groundMarks, dt);
    stepFlySwarms(state.flySwarms, t);
    stepShadowDisks(state.shadowDisks, state.heightFn);
    stepClouds(state.clouds, dt);
  });
  measurePerfPhase("airborneMovement", () => {
    for (const w of state.willowisps) stepWillOWisp(w, dt, t, state.heightFn);
  });

  // Sky dome and starfield follow the camera so the gradient zenith and the
  // star sphere are always centered on the viewer — otherwise they read as
  // fixed-in-world objects (a bright "circle" of zenith color in the sky
  // that drifts across the view as the camera orbits). Both live under
  // state.world which has worldScale applied; divide by it so the final
  // position lands on the camera regardless of scale.
  measurePerfPhase("backgroundAnimation", () => {
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
  });

  measurePerfPhase("cameraFollowAndWake", () => {
    if (isAnyFP()) {
      const followedCreature = isStrolling() ? getFollowTarget() : null;
      stepStroll(followedCreature ? 0 : isPhotoFP() ? rawDt : dt);
      if (followedCreature) {
        if (syncCreaturePovCamera(camera, controls, followedCreature)) {
          setCreaturePovRenderHidden(followedCreature);
        } else {
          setFollowTarget(null);
        }
      }
      if (state.currentBiome?.cloudlike && scene.fog) {
        // Cloud fog is tuned for orbit mode; from eye level it can flatten the
        // whole frame. Pull it back only while strolling so nearby puffs and
        // hills keep readable depth.
        scene.fog.density *= 0.55;
      }
      // Walk-up wake: any sleeping creature within ~2.5 mesh-local units of
      // the player pops awake. Camera lives in world space; creatures live
      // inside state.world (scaled by worldScale), so convert camera XZ to
      // mesh-local before comparing. Wakes both spawned sleepers and any
      // walker that has curled up from the night sleepiness cycle.
      const ws = state.userSettings.worldScale ?? 1;
      if (!followedCreature) travelThroughPortalIfNeeded();
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
      // Smoothly track a followed creature, if any. Caterpillars/snails keep
      // their root group at the origin and animate the head + body segment
      // meshes inside it — so for those we focus on the head's position,
      // otherwise camera target snaps to (0,0,0) and the follow looks broken.
      const ft = getFollowTarget();
      if (ft && ft.group && ft.group.parent) {
        const anchor = ft.segments ? ft.segments[0] : ft.group;
        const p = anchor.position;
        const k = Math.min(1, dt * 4);
        controls.target.x += (p.x - controls.target.x) * k;
        controls.target.y += (p.y + 0.6 - controls.target.y) * k;
        controls.target.z += (p.z - controls.target.z) * k;
      } else if (ft) {
        setFollowTarget(null);
      }
      controls.update();
    }
  });
  measurePerfPhase("tour", () => {
    if (!paused) stepTour(dt);
  });
  // Refresh sky-only reflection RT for water biomes. One extra render pass
  // per frame at 256×256 — cheap, and shared uniforms mean day/night updates
  // flow through without extra wiring.
  measurePerfPhase("waterReflection", () => {
    if (state.waterReflection) {
      updateWaterReflection(state.waterReflection, renderer, camera, controls);
    }
  });
  measurePerfPhase("portalPreview", () => {
    for (const portal of getActivePortals()) {
      updatePortalPreview(portal, renderer, camera, rawT);
    }
  });

  // Update tilt-shift focus: project the active camera focus point to
  // screen-Y for the sharp band, and measure camera→focus distance for the
  // depth focus.
  measurePerfPhase("render", () => {
    updateUnderwaterTint();
    postfx.setTiltShift(shouldApplyTiltShift());
    if (postfx.isActive && postfx.isActive()) {
      let focusZ;
      if (isAnyFP()) {
        focusZ = 8;
        camera.getWorldDirection(_focusDir);
        _focusProj.copy(camera.position).addScaledVector(_focusDir, focusZ).project(camera);
      } else {
        _focusProj.copy(controls.target).project(camera);
        focusZ = camera.position.distanceTo(controls.target);
      }
      // _focusProj.y is in NDC [-1, 1]; convert to UV [0, 1]. Three's UV origin
      // is at bottom-left, so (.y * 0.5 + 0.5) gives the right vertical axis.
      const focusY = _focusProj.y * 0.5 + 0.5;
      postfx.updateTiltShiftFocus(focusY, focusZ);
      postfx.render(scene, camera);
    } else {
      renderer.render(scene, camera);
    }
  });
  // Render photo review ON TOP of post-fx (not affected by outlines/tilt-shift)
  measurePerfPhase("photoReviewRender", () => {
    const reviewGroup = getPhotoReviewGroup();
    if (reviewGroup) {
      renderer.autoClear = false;
      renderer.clearDepth();
      reviewGroup.updateMatrixWorld(true);
      renderer.render(reviewGroup, camera);
      renderer.autoClear = true;
    }
  });
  endPerfFrame();
}

if (!INSPECT) {
  initUi({ camera, canvas, controls, renderer });
}

// kickoff — honour ?seed=XXXX in the URL if present, or ?inspect=1 for studio
if (INSPECT) {
  setupInspect(scene, renderer, camera, controls);
} else {
  const initialSeed = readSeedFromUrl() ?? newRandomSeed();
  void generateWorld(initialSeed).then(() => {
    enterPortalArrivalIfRequested();
  }).catch((error) => {
    console.error("World generation failed", error);
  });
}
animate();
