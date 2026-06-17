// HUD / URL / spatial-index tail of generateWorld (QA-005 extraction).
//
// This phase runs AFTER every deterministic placement (flora, creatures,
// birds, particles) and AFTER the final yieldIfNeeded(true). It performs
// no Math.random() calls and lives entirely outside the seeded PRNG
// window, so moving it out of generateWorld cannot perturb determinism.
//
// Inputs are passed explicitly; worldState is mutated in place to mirror
// the previous inline behavior. Nothing here reads or restores Math.random.

import { formatSeed } from "./seed.js";
import { generateIslandName } from "./islandname.js";
import { buildObstacleGrid } from "./fauna.js";

/**
 * Write biome/creature/flora/bird/seed stats to the HUD, mirror them into
 * the mobile help panel, dispatch the world-ready signal, restore the
 * user's auto-rotate preference, write the seed back through the context,
 * build the obstacle spatial grid + creature color buckets, and arm the
 * reveal animation timestamp.
 *
 * @param {object} args
 * @param {object} args.worldState     Shared mutable state singleton.
 * @param {object} args.biome          Resolved BIOMES entry.
 * @param {number} args.seed           16-bit numeric seed.
 * @param {object|null} args.forcedBiome Non-null when the biome was forced
 *        via options.biomeId (catalog navigation); used to decide whether
 *        writeSeed records the biome override.
 * @param {object} [args.worldControls] OrbitControls instance (may be null
 *        in tests); autoRotate is restored from user settings.
 * @param {object} args.context        World-build context (dispatchWorldReady,
 *        writeSeed).
 * @param {number} args.placed         Flora placement count.
 * @param {number} args.totalBirds     Bird count across all flocks.
 */
export function finalizeWorldHud({
  worldState,
  biome,
  seed,
  forcedBiome,
  worldControls,
  context,
  placed,
  totalBirds,
}) {
  const padStat = (n) => String(n).padStart(2, "0");
  const groundCreatureCount = worldState.creatures.filter((c) => !c.flies && !c.isFish).length + worldState.caterpillars.length;
  const flyCreatureCount = worldState.creatures.filter((c) => c.flies && !c.isFish).length;
  const swimCreatureCount = worldState.creatures.filter((c) => c.isFish).length;
  document.getElementById("biome-name").textContent = biome.name;
  const islandNameEl = document.getElementById("island-name");
  if (islandNameEl) islandNameEl.textContent = generateIslandName(seed);
  document.getElementById("biome-sub").textContent = biome.sub;
  document.getElementById("ground-creature-count").textContent = padStat(groundCreatureCount);
  document.getElementById("fly-creature-count").textContent = padStat(flyCreatureCount);
  document.getElementById("swim-creature-count").textContent = padStat(swimCreatureCount);
  document.getElementById("flora-count").textContent = padStat(placed);
  document.getElementById("bird-count").textContent = padStat(totalBirds);
  document.getElementById("seed").textContent = formatSeed(seed);

  // Mobile help panel — mirror the same stats
  const hBiome = document.getElementById("help-biome");
  if (hBiome) hBiome.textContent = biome.name;
  const hIsland = document.getElementById("help-island-name");
  if (hIsland) hIsland.textContent = generateIslandName(seed);
  const hSeed = document.getElementById("help-seed");
  if (hSeed) hSeed.textContent = formatSeed(seed);
  const hGround = document.getElementById("help-ground-creatures");
  if (hGround) hGround.textContent = padStat(groundCreatureCount);
  const hFly = document.getElementById("help-fly-creatures");
  if (hFly) hFly.textContent = padStat(flyCreatureCount);
  const hSwim = document.getElementById("help-swim-creatures");
  if (hSwim) hSwim.textContent = padStat(swimCreatureCount);
  const hFl = document.getElementById("help-flora");
  if (hFl) hFl.textContent = padStat(placed);
  const hBi = document.getElementById("help-birds");
  if (hBi) hBi.textContent = padStat(totalBirds);

  // Notify mobile UI that world is ready (triggers header auto-hide)
  context.dispatchWorldReady();

  // restore the user's auto-rotate preference (regen shouldn't override it)
  if (worldControls) worldControls.autoRotate = worldState.userSettings.autoRotate;
  context.writeSeed(seed, { biomeId: forcedBiome ? biome.id : null });

  // Build the spatial grid for static obstacle queries so avoidObstacles()
  // can use O(nearby) lookups instead of scanning the full list.
  buildObstacleGrid(worldState.obstacles);

  // Build color buckets for O(1) herding lookups — group creatures by
  // their bodyColor hex string so herdInfluence only scans same-colored
  // peers instead of the full creature list.
  const buckets = {};
  for (const c of worldState.creatures) {
    const key = c.colorBucket;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(c);
  }
  worldState.creatureColorBuckets = buckets;

  // kick off the reveal animation — updateDayNight reads this timestamp
  worldState.revealStart = performance.now();
}
