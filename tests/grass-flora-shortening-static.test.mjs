import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

assert.match(
  grassSource,
  /const SHORT_GRASS_CELL_SIZE = 1\.25;/,
  'Grass flora-shortening should use a spatial grid instead of scanning every flora circle per blade.'
);

assert.match(
  grassSource,
  /export function makeFloraShortGrassIndex\(circles = \[\]\)/,
  'Grass should expose a helper that indexes flora shortening circles.'
);

assert.match(
  grassSource,
  /const fade = t \* t \* \(3 - 2 \* t\);[\s\S]*const circleScale = circle\.shortenTo \+ \(1 - circle\.shortenTo\) \* fade;/,
  'Grass shortening should smoothly fade back to normal height near flora edges.'
);

assert.match(
  grassSource,
  /const shortGrassIndex = makeFloraShortGrassIndex\(shortGrassCircles\);/,
  'Grass placement should build the flora-shortening index once per field.'
);

assert.match(
  grassSource,
  /const floraHeightMul = grassHeightScaleAt\(x,\s*z,\s*shortGrassIndex\);[\s\S]*baseScale \* heightMul \* biomeHeightMul \* floraHeightMul/,
  'Grass placement should apply flora shortening to per-instance Y scale.'
);

assert.match(
  worldSource,
  /grassRadius:\s*grassShortenRadius/,
  'Flora placement should store a dedicated grass shortening radius instead of reusing canopy spacing.'
);

assert.match(
  worldSource,
  /const GRASS_SHORTEN_MIN_HEIGHT = 0\.14;/,
  'Grass rooted under placed flora should be cut to half of the previous 0.28 minimum height.'
);

assert.match(
  worldSource,
  /makeGrassField\(biome,\s*worldState\.heightFn,\s*coverExclusions,\s*grassShorteners\)/,
  'World generation should pass flora shortening circles into instanced grass placement.'
);
