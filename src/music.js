/**
 * Ambient background music system.
 *
 * Streams one MP3 at a time via a single <audio> element.
 * Biome name → filename mapping: PascalCase the biome's `name`, look for
 *   `/music/<Name>.mp3`.  Falls back to `Default.mp3`.
 * Volume is capped low (15 %) and scaled by the persisted musicVolume setting.
 */

import { state } from "./state.js";

const MAX_VOLUME = 0.15;
const FADE_MS = 800;

// Static map: PascalCase name → filename.  Add entries as new tracks land.
const TRACKS = {
  AshenWastes: "AshenWastes.mp3",
  CrimsonDunes: "CrimsonDunes.mp3",
};

const DEFAULT_TRACK = "Default.mp3";

let _audio = null; // lazy-created <audio> element
let _currentSrc = null; // currently-loaded track path (avoid redundant loads)
let _fadeId = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert a biome name like "ashen wastes" → "AshenWastes". */
function nameToKey(name) {
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function trackForBiome(biome) {
  const key = nameToKey(biome.name);
  return TRACKS[key] ?? DEFAULT_TRACK;
}

function ensureAudio() {
  if (_audio) return _audio;
  _audio = new Audio();
  _audio.loop = true;
  _audio.volume = 0;
  _audio.preload = "none"; // stream, don't download upfront
  return _audio;
}

function targetVolume() {
  const volume = state.userSettings.musicVolume ?? 0.5;
  return MAX_VOLUME * Math.max(0, Math.min(1, volume));
}

function clampAudioVolume(volume) {
  return Math.max(0, Math.min(1, volume));
}

function fadeTo(targetVol, duration) {
  const el = ensureAudio();
  const fadeId = ++_fadeId;
  const start = el.volume;
  const diff = targetVol - start;
  if (Math.abs(diff) < 0.001) return; // already there
  const t0 = performance.now();
  function step(now) {
    if (fadeId !== _fadeId) return;
    const p = Math.min((now - t0) / duration, 1);
    el.volume = clampAudioVolume(start + diff * p);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function playIfEnabled() {
  const el = _audio;
  if (!el || !el.src) return;
  if (!state.userSettings.musicEnabled) return;
  el.play().catch(() => {}); // autoplay may be blocked until user gesture
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call after each world generation with the new biome.
 * Streams the matching track (or Default.mp3) and crossfades.
 */
export function switchMusic(biome) {
  const track = trackForBiome(biome);
  const src = `/music/${track}`;

  // Same track already playing — just ensure volume if enabled.
  if (_currentSrc === src && _audio && !_audio.paused) {
    if (state.userSettings.musicEnabled) fadeTo(targetVolume(), FADE_MS);
    return;
  }

  const el = ensureAudio();
  _currentSrc = src;

  // If music is currently playing, fade out then swap.
  if (!el.paused && el.volume > 0.001) {
    fadeTo(0, FADE_MS);
    setTimeout(() => {
      el.src = src;
      el.load(); // start streaming new track
      playIfEnabled();
      if (state.userSettings.musicEnabled) fadeTo(targetVolume(), FADE_MS);
    }, FADE_MS);
  } else {
    el.src = src;
    el.load();
    playIfEnabled();
    if (state.userSettings.musicEnabled) fadeTo(targetVolume(), FADE_MS);
  }
}

/** Toggle music on/off. Called from the UI checkbox. */
export function setMusicEnabled(enabled) {
  state.userSettings.musicEnabled = enabled;
  const el = _audio;
  if (!el || !el.src) return;
  if (enabled) {
    el.play().catch(() => {});
    fadeTo(targetVolume(), FADE_MS);
  } else {
    fadeTo(0, FADE_MS);
    setTimeout(() => {
      if (el && !state.userSettings.musicEnabled) el.pause();
    }, FADE_MS + 50);
  }
}

/** Set the music volume multiplier from the settings slider. */
export function setMusicVolume(volume) {
  state.userSettings.musicVolume = Math.max(0, Math.min(1, volume));
  if (!_audio || !state.userSettings.musicEnabled) return;
  _fadeId++;
  _audio.volume = clampAudioVolume(targetVolume());
}

/**
 * Resume playback on the first user gesture (required by autoplay policy).
 * Call once from a top-level click/touch handler.
 */
export function tryResumeOnGesture() {
  if (!state.userSettings.musicEnabled) return;
  if (_audio && _audio.paused && _audio.src) {
    _audio.play().catch(() => {});
  }
}
