import * as THREE from "three";
import { state } from "./state.js";
import { readSeedFromUrl, newRandomSeed } from "./seed.js";
import { generateWorld, setFollowReleaseCallback } from "./world.js";
import { wakeCreature } from "./fauna.js";

let followTarget = null;
let selectingCreature = false;

export function getFollowTarget() {
  return followTarget;
}

let _settingsPanel = null;
let _followButton = null;
let _followBanner = null;
let _canvas = null;

export function setFollowTarget(creatureOrNull) {
  followTarget = creatureOrNull;
  if (!_followButton) return;
  _followButton.classList.toggle("active", !!followTarget);
  _followButton.querySelector(".setting-button-label").textContent = followTarget
    ? "release follow"
    : "follow a creature";
  _followButton.querySelector(".setting-button-hint").textContent = followTarget
    ? "tracking · click to release"
    : "click to select";
}

function setSettingsOpen(open) {
  _settingsPanel.classList.toggle("open", open);
  _settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
}

function setSelectingCreature(on) {
  selectingCreature = on;
  _followBanner.classList.toggle("visible", on);
  _followBanner.setAttribute("aria-hidden", on ? "false" : "true");
  _canvas.style.cursor = on ? "crosshair" : "";
}

export function initUi({ camera, canvas, controls, renderer }) {
  _canvas = canvas;
  _settingsPanel = document.getElementById("settings-panel");
  _followBanner = document.getElementById("follow-banner");
  _followButton = document.getElementById("setting-follow");
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsClose = document.getElementById("settings-close");

  // Hand world.js a release callback so generateWorld() can drop a stale follow.
  setFollowReleaseCallback(() => setFollowTarget(null));

  settingsToggle.addEventListener("click", () =>
    setSettingsOpen(!_settingsPanel.classList.contains("open"))
  );
  settingsClose.addEventListener("click", () => setSettingsOpen(false));

  _followButton.addEventListener("click", () => {
    if (followTarget) {
      setFollowTarget(null);
      return;
    }
    setSelectingCreature(!selectingCreature);
  });

  document.getElementById("setting-reset-camera").addEventListener("click", () => {
    setFollowTarget(null);
    setSelectingCreature(false);
    controls.target.set(0, 1.5, 0);
  });

  const autoRotateInput = document.getElementById("setting-auto-rotate");
  autoRotateInput.addEventListener("change", () => {
    controls.autoRotate = autoRotateInput.checked;
  });

  const autoCycleInput = document.getElementById("setting-auto-cycle");
  const timeSlider = document.getElementById("setting-time");
  const timeValue = document.getElementById("setting-time-value");
  function timeLabel(f) {
    if (f < 0.08) return "midnight";
    if (f < 0.28) return "dawn";
    if (f < 0.72) return "day";
    if (f < 0.92) return "dusk";
    return "night";
  }
  function syncTimeUi() {
    const f = state.userSettings.manualDayFactor;
    timeValue.textContent = state.userSettings.autoCycle ? "auto" : timeLabel(f);
    timeSlider.disabled = state.userSettings.autoCycle;
    timeSlider.style.opacity = state.userSettings.autoCycle ? "0.4" : "";
  }
  autoCycleInput.addEventListener("change", () => {
    state.userSettings.autoCycle = autoCycleInput.checked;
    syncTimeUi();
  });
  timeSlider.addEventListener("input", () => {
    state.userSettings.manualDayFactor = Number(timeSlider.value) / 1000;
    syncTimeUi();
  });

  const fogSlider = document.getElementById("setting-fog");
  const fogValue = document.getElementById("setting-fog-value");
  fogSlider.addEventListener("input", () => {
    const v = Number(fogSlider.value);
    state.userSettings.fogMultiplier = v / 100;
    fogValue.textContent = v + "%";
  });

  syncTimeUi();

  // Regenerate world button
  document.getElementById("regen").addEventListener("click", () => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; background:#000; z-index:50; pointer-events:none;
      opacity:0; transition:opacity .35s ease;`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => (overlay.style.opacity = "0.7"));
    setTimeout(() => {
      generateWorld(newRandomSeed(state.currentBiome?.id));
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 400);
    }, 360);
  });

  // Also regenerate when seed changes via back/forward navigation.
  window.addEventListener("popstate", () => {
    const s = readSeedFromUrl();
    if (s !== null && s !== state.currentSeed) generateWorld(s);
  });

  function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  // Click-to-pick a creature when in selection mode.
  const _raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  canvas.addEventListener("click", (e) => {
    if (!selectingCreature) return;
    const rect = canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    const targets = [
      ...state.creatures.map((c) => c.group),
      ...state.caterpillars.map((c) => c.group),
    ];
    const hits = _raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return;
    let hitRoot = hits[0].object;
    while (hitRoot && !targets.includes(hitRoot)) hitRoot = hitRoot.parent;
    if (!hitRoot) return;
    const creature =
      state.creatures.find((c) => c.group === hitRoot) ||
      state.caterpillars.find((c) => c.group === hitRoot);
    if (creature) {
      setFollowTarget(creature);
      setSelectingCreature(false);
    }
  });

  // Hover-to-wake — when the cursor passes over a sleeping creature we wake
  // them. Throttled so it only raycasts when there's something to wake.
  let _lastHoverTs = 0;
  canvas.addEventListener("mousemove", (e) => {
    const now = performance.now();
    if (now - _lastHoverTs < 60) return; // throttle to ~16Hz
    _lastHoverTs = now;
    // short-circuit if no sleepers in the world
    const sleepers = state.creatures.filter((c) => c.isSleeper);
    if (sleepers.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    const groups = sleepers.map((c) => c.group);
    const hits = _raycaster.intersectObjects(groups, true);
    if (!hits.length) return;
    let root = hits[0].object;
    while (root && !groups.includes(root)) root = root.parent;
    if (!root) return;
    const c = sleepers.find((s) => s.group === root);
    if (c) wakeCreature(c);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (selectingCreature) setSelectingCreature(false);
      else if (followTarget) setFollowTarget(null);
      else if (_settingsPanel.classList.contains("open")) setSettingsOpen(false);
    }
  });
}
