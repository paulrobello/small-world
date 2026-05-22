import { mulberry32 } from "./seed.js";

const PREFIXES = [
  "Moss", "Vel", "Quill", "Bram", "Fern", "Hazel", "Dew", "Lark",
  "Thorn", "Ash", "Ember", "Willow", "Clover", "Ivy", "Rune",
  "Cedar", "Wren", "Pip", "Briar", "Mist", "Sage", "Reed",
  "Moth", "Vine", "Lupin", "Alder", "Basil", "Tansy", "Fennel",
  "Rowan", "Coral", "Silk", "Bloom", "Gale", "Honey", "Jade", "Opal",
  "Wren", "Sorrel", "Elm", "Yew",
];

const SUFFIXES = [
  "brim", "hollow", "mere", "vale", "haven", "wick", "thorn", "berry",
  "keep", "reach", "glen", "den", "fell", "croft", "leigh", "rest",
  "holt", "drift", "stone", "field", "brook", "shade", "wood", "ward",
  "mead", "peak", "rise", "comb", "bury", "fell",
];

export function generateIslandName(seed) {
  const rng = mulberry32(seed);
  const prefix = PREFIXES[Math.floor(rng() * PREFIXES.length)];
  const suffix = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  return prefix + suffix;
}
