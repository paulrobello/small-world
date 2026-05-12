import * as THREE from "three";
import { state } from "./state.js";
import { readSeedFromUrl, newRandomSeed, formatSeed } from "./seed.js";
import { generateWorld, setFollowReleaseCallback } from "./world.js";
import { wakeCreature } from "./fauna.js";
import { BIOMES } from "./biomes.js";

let followTarget = null;
let selectingCreature = false;

// Persisted settings ----------------------------------------------------------
// Only fields explicitly listed here are read/written; unknown keys in
// localStorage are ignored so we can change the schema later without breaking.
const SETTINGS_KEY = "smallworld:settings:v1";
const PERSISTED_KEYS = ["fogMultiplier", "autoCycle", "manualDayFactor", "autoRotate", "ambientBoost"];
const BOOKMARKS_KEY = "smallworld:bookmarks:v1";
const BIOME_FILTER_KEY = "smallworld:biomefilter:v1";

function loadSettings() {
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

  // Regenerate world button
  document.getElementById("regen").addEventListener("click", () => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; background:#000; z-index:50; pointer-events:none;
      opacity:0; transition:opacity .35s ease;`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => (overlay.style.opacity = "0.7"));
    setTimeout(() => {
      generateWorld(pickRegenSeed());
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 400);
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
  let _lastSeenSeed = state.currentSeed;
  setInterval(() => {
    if (state.currentSeed !== _lastSeenSeed) {
      _lastSeenSeed = state.currentSeed;
      syncBookmarkButton();
    }
  }, 250);

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
