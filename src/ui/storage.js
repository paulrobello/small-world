// LocalStorage persistence layer for UI settings, bookmarks, biome filter,
// and first-visit help state.
//
// Extracted from src/ui.js as part of ARC-003 / QA-004 (splitting the ui.js
// God module). This module owns every localStorage read/write and the schema
// constants. It has NO dependency on initUi()'s closures or the mode/panel
// state machine — it only touches localStorage, state.userSettings, and the
// BIOMES table. Callers import { loadSettings, saveSettings, ... } from here.
import { state } from "../state.js";
import { BIOMES } from "../biomes.js";

// Persisted settings ----------------------------------------------------------
// Only fields explicitly listed here are read/written; unknown keys in
// localStorage are ignored so we can change the schema later without breaking.
const SETTINGS_KEY = "smallworld:settings:v1";
const GRASS_DENSITY_BASE = 25;
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
  "bloomRadius",
  "tiltShift",
  "outline",
  "ao",
  "depthFog",
  "fxPanelOpen",
  "portalEnabled",
  "portalDoublePlacement",
  "portalPreviewGrass",
  "portalPreviewFlora",
  "portalPreviewCreatures",
  "portalPreviewFx",
  "portalPanelOpen",
  "showFps",
  "windEnabled",
  "windStrength",
  "windNoiseScale",
  "windPanelOpen",
  "foliageWindEnabled",
  "grassEnabled",
  "grassDensity",
  "grassDensityBase",
  "grassHeight",
  "groundMarkLifeScale",
  "grassPanelOpen",
  "musicEnabled",
  "musicVolume",
  "musicTrackOverrides",
];
const BOOKMARKS_KEY = "smallworld:bookmarks:v1";
const BIOME_FILTER_KEY = "smallworld:biomefilter:v1";
const HELP_SEEN_KEY = "smallworld:help-seen:v1";

function shouldUseMobileHud() {
  const mobileParam = new URLSearchParams(window.location.search).get("mobile");
  if (mobileParam === "1") return true;
  if (mobileParam === "0") return false;

  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const shortViewport = Math.min(window.innerWidth, window.innerHeight);
  const shortScreen = Math.min(screen.width || 9999, screen.height || 9999);
  return hasTouch && (shortViewport < 768 || shortScreen < 768);
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const k of PERSISTED_KEYS) {
      if (k in saved) state.userSettings[k] = saved[k];
    }
    const savedGrassDensityBase = Number(saved.grassDensityBase ?? 12.5);
    if ("grassDensity" in saved && savedGrassDensityBase > 0 && savedGrassDensityBase !== GRASS_DENSITY_BASE) {
      state.userSettings.grassDensity = saved.grassDensity * (GRASS_DENSITY_BASE / savedGrassDensityBase);
    }
    state.userSettings.grassDensityBase = GRASS_DENSITY_BASE;
  } catch {
    // corrupted or unavailable — fall back to defaults
  }
}

export function saveSettings() {
  try {
    const out = {};
    for (const k of PERSISTED_KEYS) out[k] = state.userSettings[k];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
  } catch {
    // localStorage may throw in private mode / quota — non-fatal
  }
}

function shouldShowFirstVisitHelp() {
  try {
    if (localStorage.getItem(HELP_SEEN_KEY)) return false;
    localStorage.setItem(HELP_SEEN_KEY, "1");
    return true;
  } catch {
    return false;
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

export {
  SETTINGS_KEY,
  GRASS_DENSITY_BASE,
  PERSISTED_KEYS,
  BOOKMARKS_KEY,
  BIOME_FILTER_KEY,
  HELP_SEEN_KEY,
  shouldUseMobileHud,
  shouldShowFirstVisitHelp,
  loadBookmarks,
  saveBookmarks,
  loadBiomeFilter,
  saveBiomeFilter,
};
