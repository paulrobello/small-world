import * as THREE from "three";
import { state } from "./state.js";
import { readSeedFromUrl, newRandomSeed, formatSeed } from "./seed.js";
import { generateWorld, setFollowReleaseCallback } from "./world.js";
import { islandFalloff, nearestCenter } from "./terrain.js";
import { wakeCreature, lookAtCreature } from "./fauna.js";
import { BIOMES } from "./biomes.js";
import { LOWFX } from "./lowfx.js";

let followTarget = null;
let selectingCreature = false;
// Auto-release timestamp for transient focus (click-to-focus). performance.now()
// in ms; 0 means "follow indefinitely until manually released".
let _transientUntil = 0;
const TRANSIENT_FOCUS_MS = 5000;

// First-person stroll state — populated when enabled, null otherwise.
let _stroll = null;
// Bound exit function for the Escape handler; set inside initUi().
let _exitStroll = () => {};

// Persisted settings ----------------------------------------------------------
// Only fields explicitly listed here are read/written; unknown keys in
// localStorage are ignored so we can change the schema later without breaking.
const SETTINGS_KEY = "smallworld:settings:v1";
const PERSISTED_KEYS = [
  "fogMultiplier",
  "autoCycle",
  "manualDayFactor",
  "autoRotate",
  "ambientBoost",
  "worldScale",
  "autoRegen",
  "autoRegenMinutes",
  "bloom",
  "tiltShift",
  "softParticles",
  "outline",
  "ao",
  "depthFog",
  "fxPanelOpen",
  "showFps",
];
const BOOKMARKS_KEY = "smallworld:bookmarks:v1";
const BIOME_FILTER_KEY = "smallworld:biomefilter:v1";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const k of PERSISTED_KEYS) {
      if (k in saved) state.userSettings[k] = saved[k];
    }
  } catch {
    // corrupted or unavailable — fall back to defaults
  }
}

function saveSettings() {
  try {
    const out = {};
    for (const k of PERSISTED_KEYS) out[k] = state.userSettings[k];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
  } catch {
    // localStorage may throw in private mode / quota — non-fatal
  }
}

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveBookmarks(list) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / private mode
  }
}

function loadBiomeFilter() {
  // Default: all biomes enabled. Returns a Set for quick membership checks.
  try {
    const raw = localStorage.getItem(BIOME_FILTER_KEY);
    if (!raw) return new Set(BIOMES.map((b) => b.id));
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0)
      return new Set(BIOMES.map((b) => b.id));
    return new Set(arr.filter((id) => BIOMES.some((b) => b.id === id)));
  } catch {
    return new Set(BIOMES.map((b) => b.id));
  }
}

function saveBiomeFilter(set) {
  try {
    localStorage.setItem(BIOME_FILTER_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

export function getFollowTarget() {
  if (followTarget && _transientUntil && performance.now() > _transientUntil) {
    setFollowTarget(null);
  }
  return followTarget;
}

export function isStrolling() {
  return _stroll !== null;
}

export function isPhotoMode() {
  return document.body.classList.contains("photo-mode");
}

// Advance the first-person camera using accumulated WASD keys and current
// yaw/pitch. Caller (main.js) calls this in lieu of controls.update() each
// frame while stroll mode is active.
export function stepStroll(dt) {
  if (!_stroll) return;
  const { camera, keys, savedTarget } = _stroll;
  // Move speed scales with the world — at higher worldScale the island is
  // bigger in world coords, so a fixed-units speed feels slower. Multiply
  // by ws so traversal time stays roughly constant across scales.
  const wsMove = state.userSettings.worldScale ?? 1;
  const speed = (keys.shift ? 12 : 6) * wsMove * dt;
  let fx = 0;
  let fz = 0;
  if (keys.w) fz -= 1;
  if (keys.s) fz += 1;
  if (keys.a) fx -= 1;
  if (keys.d) fx += 1;
  if (fx !== 0 || fz !== 0) {
    const len = Math.hypot(fx, fz);
    fx /= len;
    fz /= len;
    // World-space movement: forward at yaw y is (-sin y, 0, -cos y); right
    // is (cos y, 0, -sin y). With fz=-1 for W (forward) and fx=+1 for D
    // (right), Δp = fx·right + (-fz)·forward, which simplifies to:
    const cy = Math.cos(_stroll.yaw);
    const sy = Math.sin(_stroll.yaw);
    const dx = (fx * cy + fz * sy) * speed;
    const dz = (-fx * sy + fz * cy) * speed;
    camera.position.x += dx;
    camera.position.z += dz;
  }
  // Lock camera to terrain height + eye offset, but never sink below the
  // base plane so walking off an island just hovers at minimum height.
  // state.world is uniformly scaled by userSettings.worldScale, so terrain
  // mesh vertices live at (localX*ws, heightFn(localX,localZ)*ws, localZ*ws)
  // in world coords. The camera moves in world coords, so convert XZ to
  // mesh-local before sampling heightFn, then scale the result back up.
  const ws = state.userSettings.worldScale ?? 1;
  const wsi = 1 / ws;
  const cx = camera.position.x * wsi;
  const cz = camera.position.z * wsi;
  // Probe radius is 0.45 in world units — convert to mesh-local before sampling.
  const probe = 0.45 * wsi;
  // Sample center + four short cardinal offsets so a slope or small ridge
  // close to the player lifts the camera over it instead of letting the
  // terrain mesh slice through the near plane.
  const hC = state.heightFn(cx, cz);
  const hN = state.heightFn(cx, cz + probe);
  const hS = state.heightFn(cx, cz - probe);
  const hE = state.heightFn(cx + probe, cz);
  const hW = state.heightFn(cx - probe, cz);
  const groundY = Math.max(hC, hN, hS, hE, hW) * ws;
  // Eye height: clears grass (~0.7 world units at default scale) and small flora.
  const targetY = groundY + 1.9 * ws;
  // Smooth Y for soft cresting on bumps — but clamp so the camera never
  // dips below groundY + 1.0×ws (high enough that the near plane stays
  // out of the terrain even when you're inches from a wall on a slope).
  const next = camera.position.y + (targetY - camera.position.y) * Math.min(1, dt * 8);
  camera.position.y = Math.max(next, groundY + 1.0 * ws);

  // Apply yaw / pitch as a quaternion so the camera doesn't roll.
  camera.rotation.order = "YXZ";
  camera.rotation.y = _stroll.yaw;
  camera.rotation.x = _stroll.pitch;
  camera.rotation.z = 0;

  // Keep OrbitControls' target far ahead so when we exit, the orbit
  // anchor lands somewhere sensible (avoids snapping the camera back).
  savedTarget.set(
    camera.position.x - Math.sin(_stroll.yaw) * 8,
    camera.position.y - Math.sin(_stroll.pitch) * 8,
    camera.position.z - Math.cos(_stroll.yaw) * 8
  );
}

let _settingsPanel = null;
let _followButton = null;
let _followBanner = null;
let _canvas = null;

export function setFollowTarget(creatureOrNull, opts = {}) {
  followTarget = creatureOrNull;
  _transientUntil = creatureOrNull && opts.transient
    ? performance.now() + TRANSIENT_FOCUS_MS
    : 0;
  if (!_followButton) return;
  _followButton.classList.toggle("active", !!followTarget);
  const label = followTarget
    ? (opts.transient ? "focusing…" : "release follow")
    : "follow a creature";
  const hint = followTarget
    ? (opts.transient ? "auto-release shortly · esc to cancel" : "tracking · click to release")
    : "click to select";
  _followButton.querySelector(".setting-button-label").textContent = label;
  _followButton.querySelector(".setting-button-hint").textContent = hint;
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
  // Restore persisted settings before reading any defaults — UI inputs and
  // controls below sync themselves from state.userSettings.
  loadSettings();
  controls.autoRotate = state.userSettings.autoRotate;

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

  const helpPanel = document.getElementById("help-panel");
  const helpToggle = document.getElementById("help-toggle");
  const helpClose = document.getElementById("help-close");
  function setHelpOpen(open) {
    helpPanel.classList.toggle("open", open);
    helpPanel.setAttribute("aria-hidden", open ? "false" : "true");
  }
  helpToggle.addEventListener("click", () =>
    setHelpOpen(!helpPanel.classList.contains("open"))
  );
  helpClose.addEventListener("click", () => setHelpOpen(false));

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

  // First-person stroll ----------------------------------------------------
  const strollBtn = document.getElementById("setting-stroll");
  function syncStrollButton() {
    const on = isStrolling();
    strollBtn.classList.toggle("active", on);
    strollBtn.querySelector(".setting-button-label").textContent = on
      ? "exit stroll mode"
      : "first-person stroll";
    strollBtn.querySelector(".setting-button-hint").textContent = on
      ? "wasd · mouse-look · esc to exit"
      : "wasd · mouse-look · esc to exit";
  }
  function enterStroll() {
    if (_stroll) return;
    // Release any other active camera mode so they don't fight.
    setFollowTarget(null);
    setSelectingCreature(false);
    // Get the settings panel out of the way so the player can actually see.
    setSettingsOpen(false);
    const savedAutoRotate = controls.autoRotate;
    controls.autoRotate = false;
    controls.enabled = false;
    // Remember the look target for yaw — computed AFTER any XZ snap below so
    // the player still faces what they were looking at, even if we moved them.
    const lookX = controls.target.x;
    const lookZ = controls.target.z;
    // Pitch resets to 0 (horizontal) — the orbit camera is usually angled
    // downward, which makes for an awful first-person starting view.
    const pitch = 0;
    // If the camera is currently over the void (off-island), walk it toward
    // the nearest island center until it hits solid ground — so the player
    // lands at the edge from their viewing direction rather than dropping
    // straight down into nothing. heightFn isn't reliable for this check
    // (it returns negative inside the island wherever noise dips below 0),
    // so detect off-island via islandFalloff across all layout centers.
    const onIsland = (x, z) => {
      for (const c of state.currentLayout.centers) {
        if (islandFalloff(c, x, z) > 0.15) return true;
      }
      return false;
    };
    if (!onIsland(camera.position.x, camera.position.z)) {
      const c = nearestCenter(camera.position.x, camera.position.z);
      let tx = camera.position.x;
      let tz = camera.position.z;
      const ddx = c.cx - tx;
      const ddz = c.cz - tz;
      const dist = Math.hypot(ddx, ddz);
      if (dist > 0.01) {
        const step = Math.max(0.5, c.radius * 0.05);
        const ux = ddx / dist;
        const uz = ddz / dist;
        for (let i = 0; i < 200 && !onIsland(tx, tz); i++) {
          tx += ux * step;
          tz += uz * step;
        }
      } else {
        tx = c.cx;
        tz = c.cz;
      }
      camera.position.x = tx;
      camera.position.z = tz;
    }
    // Initial yaw from the (possibly snapped) camera position toward the
    // original look-target, so the player faces what they were viewing.
    const dx = lookX - camera.position.x;
    const dz = lookZ - camera.position.z;
    const yaw = Math.atan2(-dx, -dz);
    // Drop the camera to creature-eye height on the terrain at its XZ.
    // Account for state.world's scale — heightFn is mesh-local.
    const ws0 = state.userSettings.worldScale ?? 1;
    const groundY = state.heightFn(
      camera.position.x / ws0,
      camera.position.z / ws0
    ) * ws0;
    _stroll = {
      camera,
      keys: { w: false, a: false, s: false, d: false, shift: false },
      yaw,
      pitch,
      savedCam: {
        pos: camera.position.clone(),
        target: controls.target.clone(),
        autoRotate: savedAutoRotate,
      },
      savedTarget: controls.target,
      handlers: {},
    };
    camera.position.y = groundY + 1.9 * ws0;

    // Pointer lock so the mouse can move infinitely without leaving the
    // canvas. Browsers require this from a user gesture (button click).
    canvas.requestPointerLock?.();

    const onMove = (e) => {
      if (!_stroll) return;
      const sens = 0.0022;
      _stroll.yaw -= e.movementX * sens;
      _stroll.pitch -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.05;
      if (_stroll.pitch > lim) _stroll.pitch = lim;
      if (_stroll.pitch < -lim) _stroll.pitch = -lim;
    };
    const onKey = (down) => (e) => {
      if (!_stroll) return;
      const k = e.key.toLowerCase();
      if (k === "w") _stroll.keys.w = down;
      else if (k === "a") _stroll.keys.a = down;
      else if (k === "s") _stroll.keys.s = down;
      else if (k === "d") _stroll.keys.d = down;
      else if (k === "shift") _stroll.keys.shift = down;
      else return;
      e.preventDefault();
    };
    const onKeyDown = onKey(true);
    const onKeyUp = onKey(false);
    const onLockChange = () => {
      if (document.pointerLockElement !== canvas) exitStroll();
    };
    document.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerlockchange", onLockChange);
    _stroll.handlers = { onMove, onKeyDown, onKeyUp, onLockChange };
    syncStrollButton();
  }
  function exitStroll() {
    if (!_stroll) return;
    const { handlers, savedCam } = _stroll;
    document.removeEventListener("mousemove", handlers.onMove);
    window.removeEventListener("keydown", handlers.onKeyDown);
    window.removeEventListener("keyup", handlers.onKeyUp);
    document.removeEventListener("pointerlockchange", handlers.onLockChange);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    // Restore the orbit anchor and camera. Re-enable orbit controls so the
    // user can rotate again from where they left off.
    camera.position.copy(savedCam.pos);
    controls.target.copy(savedCam.target);
    controls.autoRotate = savedCam.autoRotate && state.userSettings.autoRotate;
    controls.enabled = true;
    _stroll = null;
    syncStrollButton();
  }
  strollBtn.addEventListener("click", () => {
    if (_stroll) exitStroll();
    else enterStroll();
  });
  syncStrollButton();
  // Expose for the Escape handler below
  _exitStroll = exitStroll;

  const scaleSlider = document.getElementById("setting-scale");
  const scaleValue = document.getElementById("setting-scale-value");
  scaleSlider.value = String(Math.round((state.userSettings.worldScale ?? 1) * 100));
  scaleValue.textContent = scaleSlider.value + "%";
  state.world.scale.setScalar(state.userSettings.worldScale ?? 1);
  scaleSlider.addEventListener("input", () => {
    const v = Number(scaleSlider.value);
    state.userSettings.worldScale = v / 100;
    state.world.scale.setScalar(state.userSettings.worldScale);
    scaleValue.textContent = v + "%";
    saveSettings();
  });

  const autoRotateInput = document.getElementById("setting-auto-rotate");
  autoRotateInput.checked = state.userSettings.autoRotate;
  autoRotateInput.addEventListener("change", () => {
    controls.autoRotate = autoRotateInput.checked;
    state.userSettings.autoRotate = autoRotateInput.checked;
    saveSettings();
  });

  const autoCycleInput = document.getElementById("setting-auto-cycle");
  autoCycleInput.checked = state.userSettings.autoCycle;
  const timeSlider = document.getElementById("setting-time");
  timeSlider.value = String(Math.round(state.userSettings.manualDayFactor * 1000));
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
    saveSettings();
  });
  timeSlider.addEventListener("input", () => {
    state.userSettings.manualDayFactor = Number(timeSlider.value) / 1000;
    syncTimeUi();
    saveSettings();
  });

  const fogSlider = document.getElementById("setting-fog");
  const fogValue = document.getElementById("setting-fog-value");
  fogSlider.value = String(Math.round(state.userSettings.fogMultiplier * 100));
  fogValue.textContent = fogSlider.value + "%";
  fogSlider.addEventListener("input", () => {
    const v = Number(fogSlider.value);
    state.userSettings.fogMultiplier = v / 100;
    fogValue.textContent = v + "%";
    saveSettings();
  });

  const ambientSlider = document.getElementById("setting-ambient");
  const ambientValue = document.getElementById("setting-ambient-value");
  ambientSlider.value = String(Math.round(state.userSettings.ambientBoost * 100));
  ambientValue.textContent = ambientSlider.value + "%";
  ambientSlider.addEventListener("input", () => {
    const v = Number(ambientSlider.value);
    state.userSettings.ambientBoost = v / 100;
    ambientValue.textContent = v + "%";
    saveSettings();
  });

  syncTimeUi();

  const fxDetailsEl = document.getElementById("setting-fx-details");
  const bloomEl = document.getElementById("setting-bloom");
  const tiltEl = document.getElementById("setting-tiltshift");
  const softParticlesEl = document.getElementById("setting-softparticles");
  const outlineEl = document.getElementById("setting-outline");
  const aoEl = document.getElementById("setting-ao");
  const depthFogEl = document.getElementById("setting-depthfog");
  const lowfxHint = document.getElementById("setting-lowfx-hint");

  fxDetailsEl.open = !!state.userSettings.fxPanelOpen;
  bloomEl.checked = state.userSettings.bloom;
  tiltEl.checked = state.userSettings.tiltShift;
  softParticlesEl.checked = state.userSettings.softParticles;
  outlineEl.checked = state.userSettings.outline;
  aoEl.checked = state.userSettings.ao;
  depthFogEl.checked = state.userSettings.depthFog;

  if (LOWFX) {
    // The depth pre-pass and composer are stubbed out under LOWFX, so every
    // FX in this section is a no-op there.
    for (const el of [bloomEl, tiltEl, softParticlesEl, outlineEl, aoEl, depthFogEl]) {
      el.disabled = true;
    }
    lowfxHint.hidden = false;
  }

  fxDetailsEl.addEventListener("toggle", () => {
    state.userSettings.fxPanelOpen = fxDetailsEl.open;
    saveSettings();
  });

  bloomEl.addEventListener("change", () => {
    state.userSettings.bloom = bloomEl.checked;
    // darkBiome biomes (obsidian, ashen) collapse to pure black under bloom
    // due to additive-blend precision against their near-zero linear values;
    // world.js applies the same gate after every regen.
    const allowBloom = bloomEl.checked && !state.currentBiome?.darkBiome;
    if (state.postfx) state.postfx.setBloom(allowBloom);
    saveSettings();
  });
  tiltEl.addEventListener("change", () => {
    state.userSettings.tiltShift = tiltEl.checked;
    if (state.postfx) state.postfx.setTiltShift(tiltEl.checked);
    saveSettings();
  });
  softParticlesEl.addEventListener("change", () => {
    state.userSettings.softParticles = softParticlesEl.checked;
    // Particle material's uSoftParticles is a runtime float toggle (no
    // shader recompile). Only live particle systems need the update.
    const p = state.particles;
    if (p && p.material.uniforms.uSoftParticles && state.depthTexture) {
      p.material.uniforms.uSoftParticles.value = softParticlesEl.checked ? 1.0 : 0.0;
    }
    saveSettings();
  });
  outlineEl.addEventListener("change", () => {
    state.userSettings.outline = outlineEl.checked;
    if (state.postfx) state.postfx.setOutline(outlineEl.checked);
    saveSettings();
  });
  aoEl.addEventListener("change", () => {
    state.userSettings.ao = aoEl.checked;
    if (state.postfx) state.postfx.setAo(aoEl.checked);
    saveSettings();
  });
  depthFogEl.addEventListener("change", () => {
    state.userSettings.depthFog = depthFogEl.checked;
    if (state.postfx) state.postfx.setDepthFog(depthFogEl.checked);
    saveSettings();
  });

  const fpsToggleEl = document.getElementById("setting-show-fps");
  const fpsCounterEl = document.getElementById("fps-counter");
  fpsToggleEl.checked = !!state.userSettings.showFps;
  fpsCounterEl.hidden = !state.userSettings.showFps;
  fpsToggleEl.addEventListener("change", () => {
    state.userSettings.showFps = fpsToggleEl.checked;
    fpsCounterEl.hidden = !fpsToggleEl.checked;
    saveSettings();
  });

  // Auto-regenerate timer — fires the regen button on an interval so the
  // world cycles itself without user input. Persisted via userSettings.
  const autoRegenInput = document.getElementById("setting-auto-regen");
  const autoRegenMins = document.getElementById("setting-auto-regen-mins");
  const autoRegenMinsValue = document.getElementById("setting-auto-regen-mins-value");
  autoRegenInput.checked = !!state.userSettings.autoRegen;
  autoRegenMins.value = String(state.userSettings.autoRegenMinutes ?? 2);
  autoRegenMinsValue.textContent = autoRegenMins.value + " min";
  let _autoRegenAt = performance.now() + (state.userSettings.autoRegenMinutes ?? 2) * 60000;
  function resetAutoRegenClock() {
    _autoRegenAt =
      performance.now() + (state.userSettings.autoRegenMinutes ?? 2) * 60000;
  }
  autoRegenInput.addEventListener("change", () => {
    state.userSettings.autoRegen = autoRegenInput.checked;
    resetAutoRegenClock();
    saveSettings();
  });
  autoRegenMins.addEventListener("input", () => {
    const v = Math.max(1, Number(autoRegenMins.value));
    state.userSettings.autoRegenMinutes = v;
    autoRegenMinsValue.textContent = v + " min";
    resetAutoRegenClock();
    saveSettings();
  });
  // poll every 5s — cheap, no need to thread the timer through animate()
  setInterval(() => {
    if (!state.userSettings.autoRegen) return;
    if (document.body.classList.contains("photo-mode")) return;
    if (performance.now() < _autoRegenAt) return;
    resetAutoRegenClock();
    document.getElementById("regen").click();
  }, 5000);

  // Biome filter — restore from storage, build the chip row, and use it
  // to constrain regen below.
  const biomeFilter = loadBiomeFilter();
  const biomeFilterEl = document.getElementById("biome-filter");
  function renderBiomeFilter() {
    biomeFilterEl.innerHTML = "";
    for (const b of BIOMES) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "biome-chip" + (biomeFilter.has(b.id) ? " active" : "");
      chip.style.setProperty("--chip-color", b.sky);
      chip.setAttribute("aria-label", b.name);
      chip.setAttribute("aria-pressed", biomeFilter.has(b.id) ? "true" : "false");
      const tip = document.createElement("span");
      tip.className = "biome-chip-tooltip";
      tip.textContent = b.name;
      chip.appendChild(tip);
      chip.addEventListener("click", () => {
        if (biomeFilter.has(b.id)) {
          // Don't allow disabling the last enabled biome — otherwise regen has
          // nothing to land on. Just re-mark this chip and bail.
          if (biomeFilter.size <= 1) return;
          biomeFilter.delete(b.id);
        } else {
          biomeFilter.add(b.id);
        }
        saveBiomeFilter(biomeFilter);
        renderBiomeFilter();
      });
      biomeFilterEl.appendChild(chip);
    }
  }
  renderBiomeFilter();

  function pickRegenSeed() {
    // If every biome is enabled, the filter is a no-op — keep the old
    // "avoid same biome twice" behaviour. Otherwise constrain to the set.
    const all = biomeFilter.size === BIOMES.length;
    return newRandomSeed({
      excludeBiomeId: state.currentBiome?.id,
      allowedBiomeIds: all ? undefined : [...biomeFilter],
    });
  }

  // Regenerate world button — guarded so a rapid double-click can't queue a
  // second rebuild while the fade-out + generateWorld pass is still in flight.
  let _regenInFlight = false;
  document.getElementById("regen").addEventListener("click", () => {
    if (_regenInFlight) return;
    _regenInFlight = true;
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; background:#000; z-index:50; pointer-events:none;
      opacity:0; transition:opacity .35s ease;`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => (overlay.style.opacity = "0.7"));
    setTimeout(() => {
      generateWorld(pickRegenSeed());
      overlay.style.opacity = "0";
      setTimeout(() => {
        overlay.remove();
        _regenInFlight = false;
      }, 400);
    }, 360);
  });

  // Share — copy current URL (which always reflects the current seed)
  const copyBtn = document.getElementById("setting-copy-link");
  const copyHint = document.getElementById("setting-copy-hint");
  const _copyDefault = copyHint.textContent;
  let _copyResetTimer = 0;
  copyBtn.addEventListener("click", async () => {
    const url = window.location.href;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        // fallback for older browsers / non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      }
    } catch {
      ok = false;
    }
    copyHint.textContent = ok ? "copied to clipboard" : "copy failed";
    clearTimeout(_copyResetTimer);
    _copyResetTimer = setTimeout(() => {
      copyHint.textContent = _copyDefault;
    }, 1800);
  });

  // Bookmarks ----------------------------------------------------------------
  let bookmarks = loadBookmarks();
  const bookmarkBtn = document.getElementById("setting-bookmark");
  const bookmarkLabel = document.getElementById("setting-bookmark-label");
  const bookmarkHint = document.getElementById("setting-bookmark-hint");
  const bookmarkListEl = document.getElementById("bookmark-list");
  const bookmarkEmptyEl = document.getElementById("bookmark-empty");

  function biomeById(id) {
    return BIOMES.find((b) => b.id === id);
  }

  function isCurrentBookmarked() {
    return bookmarks.some((bm) => bm.seed === state.currentSeed);
  }

  function syncBookmarkButton() {
    const saved = isCurrentBookmarked();
    bookmarkLabel.textContent = saved ? "★ remove bookmark" : "☆ save this seed";
    bookmarkHint.textContent = saved
      ? "stored · click to remove"
      : "store in your browser";
    bookmarkBtn.classList.toggle("active", saved);
  }

  function renderBookmarks() {
    bookmarkListEl.innerHTML = "";
    for (const bm of bookmarks) {
      const row = document.createElement("div");
      row.className = "bookmark-row";
      const biome = biomeById(bm.biomeId);
      const swatch = document.createElement("span");
      swatch.className = "bookmark-swatch";
      swatch.style.background = biome ? biome.sky : "#888";
      const text = document.createElement("button");
      text.type = "button";
      text.className = "bookmark-text";
      const bn = document.createElement("span");
      bn.className = "bookmark-biome";
      bn.textContent = bm.biomeName || biome?.name || "—";
      const seed = document.createElement("span");
      seed.className = "bookmark-seed";
      seed.textContent = formatSeed(bm.seed);
      text.appendChild(bn);
      text.appendChild(seed);
      text.addEventListener("click", () => {
        if (bm.seed === state.currentSeed) return;
        generateWorld(bm.seed);
        syncBookmarkButton();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "bookmark-remove";
      remove.setAttribute("aria-label", "remove bookmark");
      remove.textContent = "×";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        bookmarks = bookmarks.filter((x) => x.seed !== bm.seed);
        saveBookmarks(bookmarks);
        renderBookmarks();
        syncBookmarkButton();
      });
      row.appendChild(swatch);
      row.appendChild(text);
      row.appendChild(remove);
      bookmarkListEl.appendChild(row);
    }
    bookmarkEmptyEl.classList.toggle("visible", bookmarks.length === 0);
  }

  bookmarkBtn.addEventListener("click", () => {
    if (state.currentSeed == null || !state.currentBiome) return;
    if (isCurrentBookmarked()) {
      bookmarks = bookmarks.filter((x) => x.seed !== state.currentSeed);
    } else {
      bookmarks.push({
        seed: state.currentSeed,
        biomeId: state.currentBiome.id,
        biomeName: state.currentBiome.name,
        ts: Date.now(),
      });
    }
    saveBookmarks(bookmarks);
    renderBookmarks();
    syncBookmarkButton();
  });

  // Refresh the button label whenever the world changes (regen via button,
  // popstate, or bookmark click). The simplest hook is a polling watcher on
  // state.currentSeed — it changes rarely and the cost is trivial.
  const photoSeedEl = document.getElementById("photo-seed");
  const photoSeedValueEl = document.getElementById("photo-seed-value");
  let _lastSeenSeed = state.currentSeed;
  setInterval(() => {
    if (state.currentSeed !== _lastSeenSeed) {
      _lastSeenSeed = state.currentSeed;
      syncBookmarkButton();
      photoSeedValueEl.textContent = formatSeed(state.currentSeed);
    }
  }, 250);
  photoSeedValueEl.textContent = formatSeed(state.currentSeed);

  // Photo mode — toggled with P. Hides every overlay, freezes auto-rotate,
  // and shows the seed at the bottom of the canvas for clean screenshots.
  let _photoSavedAutoRotate = controls.autoRotate;
  function capturePhoto() {
    // canvas already holds the most recent render (preserveDrawingBuffer:true)
    // so we can grab pixels straight from it. The hud is in CSS overlay layers
    // and isn't part of the WebGL canvas, so toDataURL gives us a clean shot
    // of just the scene — which is what photo mode is for.
    const seedTag = formatSeed(state.currentSeed).replace(/^0x/, "");
    const biomeTag = (state.currentBiome?.id ?? "world").replace(/\s+/g, "-");
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `small-world-${biomeTag}-${seedTag}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // brief flash so the user sees the capture happened
    const flash = document.createElement("div");
    flash.style.cssText =
      "position:fixed;inset:0;background:#fff;z-index:50;pointer-events:none;opacity:0.6;transition:opacity .35s ease;";
    document.body.appendChild(flash);
    requestAnimationFrame(() => (flash.style.opacity = "0"));
    setTimeout(() => flash.remove(), 400);
  }
  const photoModeBtn = document.getElementById("setting-photo");
  const photoModeLabel = document.getElementById("setting-photo-label");
  function syncPhotoModeButton() {
    const on = document.body.classList.contains("photo-mode");
    photoModeBtn.classList.toggle("active", on);
    photoModeLabel.textContent = on ? "exit photo mode" : "photo mode";
  }
  function setPhotoMode(on) {
    if (on) {
      _photoSavedAutoRotate = controls.autoRotate;
      controls.autoRotate = false;
      document.body.classList.add("photo-mode");
      photoSeedEl.setAttribute("aria-hidden", "false");
    } else {
      controls.autoRotate = _photoSavedAutoRotate;
      document.body.classList.remove("photo-mode");
      photoSeedEl.setAttribute("aria-hidden", "true");
    }
    syncPhotoModeButton();
  }
  photoModeBtn.addEventListener("click", () => {
    setPhotoMode(!document.body.classList.contains("photo-mode"));
  });
  document.getElementById("photo-save").addEventListener("click", capturePhoto);
  document.getElementById("photo-exit").addEventListener("click", () => setPhotoMode(false));
  syncPhotoModeButton();

  renderBookmarks();
  syncBookmarkButton();

  // Also regenerate when seed changes via back/forward navigation.
  window.addEventListener("popstate", () => {
    const s = readSeedFromUrl();
    if (s !== null && s !== state.currentSeed) generateWorld(s);
  });

  function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOWFX ? 1 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  // Click-to-pick a creature. In selection mode, a hit promotes to permanent
  // follow. Outside selection mode, a hit triggers a transient focus that
  // auto-releases after a few seconds (so casual clicks linger but don't trap
  // the camera). Drags are distinguished from clicks by motion threshold so
  // OrbitControls can still rotate freely.
  const _raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  let _downX = 0;
  let _downY = 0;
  let _downT = 0;
  canvas.addEventListener("pointerdown", (e) => {
    _downX = e.clientX;
    _downY = e.clientY;
    _downT = performance.now();
  });
  canvas.addEventListener("pointerup", (e) => {
    const moved = Math.hypot(e.clientX - _downX, e.clientY - _downY);
    const dur = performance.now() - _downT;
    if (moved > 6 || dur > 400) return; // a drag, not a click
    const rect = canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    const targets = [
      ...state.creatures.map((c) => c.group),
      ...state.caterpillars.map((c) => c.group),
    ];
    const hits = _raycaster.intersectObjects(targets, true);
    if (hits.length === 0) {
      // empty-space click cancels selection mode (existing UX)
      if (selectingCreature) setSelectingCreature(false);
      return;
    }
    let hitRoot = hits[0].object;
    while (hitRoot && !targets.includes(hitRoot)) hitRoot = hitRoot.parent;
    if (!hitRoot) return;
    const creature =
      state.creatures.find((c) => c.group === hitRoot) ||
      state.caterpillars.find((c) => c.group === hitRoot);
    if (!creature) return;
    // brief look-at-camera response — applies to creatures, not caterpillars
    if (state.creatures.includes(creature)) lookAtCreature(creature);
    if (selectingCreature) {
      setFollowTarget(creature);
      setSelectingCreature(false);
    } else {
      setFollowTarget(creature, { transient: true });
    }
  });

  // Hover behavior — wakes sleepers, and triggers a brief look-at-camera
  // response on any awake creature the cursor lingers over. Throttled and
  // gated on a "different creature than last frame" check so a stationary
  // cursor doesn't continually re-trigger the same look.
  let _lastHoverTs = 0;
  let _lastLookedAt = null;
  canvas.addEventListener("mousemove", (e) => {
    const now = performance.now();
    if (now - _lastHoverTs < 60) return; // throttle to ~16Hz
    _lastHoverTs = now;
    if (state.creatures.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    const groups = state.creatures.map((c) => c.group);
    const hits = _raycaster.intersectObjects(groups, true);
    if (!hits.length) {
      _lastLookedAt = null;
      return;
    }
    const hitObj = hits[0].object;
    let root = hitObj;
    while (root && !groups.includes(root)) root = root.parent;
    if (!root) return;
    const c = state.creatures.find((s) => s.group === root);
    if (!c) return;
    // Fur shells extend the body's raycast silhouette outward, which would
    // wake fuzzy sleepers from cursor positions that aren't actually over the
    // visible body. Treat a fur-shell-only hit as a passive look-at.
    const furOnly = !!hitObj?.userData?.isFurShell;
    if (c.isSleeper) {
      if (!furOnly) wakeCreature(c);
    } else if (c !== _lastLookedAt) {
      lookAtCreature(c);
      _lastLookedAt = c;
    }
  });

  window.addEventListener("keydown", (e) => {
    // Ignore keys when an input/textarea has focus (e.g., dev tools, browser
    // address bar overlays aren't relevant — but a user-typed range is).
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "Escape") {
      if (_stroll) _exitStroll();
      else if (document.body.classList.contains("photo-mode")) setPhotoMode(false);
      else if (selectingCreature) setSelectingCreature(false);
      else if (followTarget) setFollowTarget(null);
      else if (helpPanel.classList.contains("open")) setHelpOpen(false);
      else if (_settingsPanel.classList.contains("open")) setSettingsOpen(false);
    } else if (e.key === "p" || e.key === "P") {
      setPhotoMode(!document.body.classList.contains("photo-mode"));
    } else if ((e.key === "s" || e.key === "S") && document.body.classList.contains("photo-mode")) {
      e.preventDefault();
      capturePhoto();
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      if (_stroll) exitStroll();
      else enterStroll();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      document.getElementById("regen").click();
    }
  });
}
