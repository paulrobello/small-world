import { BIOMES } from "./biomes.js";

// mulberry32 — small, fast, decent quality, takes a 32-bit seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatSeed(seed) {
  return "0x" + (seed >>> 0).toString(16).padStart(4, "0");
}

export function parseSeed(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16) >>> 0;
  if (/^[0-9a-f]{1,8}$/i.test(s) && /[a-f]/i.test(s))
    return parseInt(s, 16) >>> 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n >>> 0 : null;
}

export function readSeedFromUrl() {
  return parseSeed(new URLSearchParams(window.location.search).get("seed"));
}

export function readBiomeFromUrl() {
  const biomeId = new URLSearchParams(window.location.search).get("biome");
  return BIOMES.some((biome) => biome.id === biomeId) ? biomeId : null;
}

export function writeSeedToUrl(seed, { biomeId = null } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", formatSeed(seed));
  if (biomeId && BIOMES.some((biome) => biome.id === biomeId)) {
    url.searchParams.set("biome", biomeId);
  } else {
    url.searchParams.delete("biome");
  }
  history.replaceState(null, "", url.toString());
}

export function newRandomSeed(opts = {}) {
  // Back-compat: accept a bare biome id string in addition to the options form.
  const o = typeof opts === "string" ? { excludeBiomeId: opts } : opts;
  const excludeBiomeId = o.excludeBiomeId;
  const allowedBiomeIds = o.allowedBiomeIds; // undefined or empty = no filter
  const filterOn =
    Array.isArray(allowedBiomeIds) && allowedBiomeIds.length > 0;
  // Reroll to satisfy both the filter and the no-repeat rule when possible.
  for (let i = 0; i < 64; i++) {
    const s = Math.floor(Math.random() * 0x10000);
    const peekBiome = BIOMES[Math.floor(mulberry32(s)() * BIOMES.length)];
    if (filterOn && !allowedBiomeIds.includes(peekBiome.id)) continue;
    if (excludeBiomeId && peekBiome.id === excludeBiomeId) continue;
    return s;
  }
  // Couldn't satisfy both — relax the no-repeat rule but keep the filter.
  if (filterOn) {
    for (let i = 0; i < 32; i++) {
      const s = Math.floor(Math.random() * 0x10000);
      const peekBiome = BIOMES[Math.floor(mulberry32(s)() * BIOMES.length)];
      if (allowedBiomeIds.includes(peekBiome.id)) return s;
    }
  }
  return Math.floor(Math.random() * 0x10000);
}
