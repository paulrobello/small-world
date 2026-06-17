// Shared world-construction constants (ARC-002).
//
// The portal preview reconstructs a faithful slice of the destination world,
// so it must derive terrain noise and the flora footprint table from the SAME
// source of truth as `generateWorld`. Hand-copying these silently diverges
// the preview from the real destination whenever a flora kind is added or the
// noise seed changes. Both `src/world.js` and `src/portal.js` import from here.

import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "./seed.js";

// XORed into the world seed before deriving the terrain noise permutation so
// the terrain noise stream is decorrelated from the placement RNG stream.
export const TERRAIN_NOISE_SEED_XOR = 0x5eed5eed;

// Build the canonical terrain-noise permutation from a world seed. Both the
// real world and the portal preview must call this with the same seed so the
// destination terrain matches what the user will actually travel to.
export function terrainNoiseFromSeed(seed) {
  return createNoise2D(mulberry32((seed ^ TERRAIN_NOISE_SEED_XOR) >>> 0));
}

// Per-kind footprint radius — how far around the trunk axis we sample
// heightFn to find the lowest ground the base needs to reach. Bigger trunks
// need a wider sample so the downhill side stays buried on slopes.
// Anything not listed falls back to FLORA_FOOTPRINT_DEFAULT.
export const FLORA_FOOTPRINT = {
  // Footprints describe the root/base contact patch for slope planting.
  // Broad crowns are spaced separately by CANOPY_SPACING_KINDS; using the
  // canopy width here samples far downhill and can bury the trunk center.
  tree: 0.28, leafballtree: 0.32, pine: 0.28, snowpine: 0.28, deadtree: 0.22, mushroom: 0.18,
  bigmushroom: 0.45, fairyring: 1.15, lantern: 0.18, pillar: 0.30, archstone: 0.55,
  balloontree: 0.22, crystal: 0.30, obsidianshard: 0.28, obsidianglass: 0.34, skull: 0.22,
  berrybush: 0.30, coral: 0.25, braincoral: 0.26, cupcoral: 0.22,
  fern: 0.18, dandylion: 0.16, flyer_nest: 0.612, rock: 0.30, limestonerock: 0.30, reed: 0.10,
  seaweed: 0.12, beach_succulent: 0.20, lavafissure: 1.45,
};

export const FLORA_FOOTPRINT_DEFAULT = 0.20;
