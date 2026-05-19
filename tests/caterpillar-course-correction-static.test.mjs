import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/fauna/caterpillar.js', import.meta.url), 'utf8');

const slideStart = source.indexOf('if (slide) {');
const waterGuardStart = source.indexOf('// Post-slide water guard.', slideStart);
assert(slideStart > -1 && waterGuardStart > slideStart, 'test should locate the caterpillar slide correction block');
const slideBlock = source.slice(slideStart, waterGuardStart);

assert(
  slideBlock.includes('c.headingTarget = slide.heading;'),
  'Caterpillar obstacle correction should retarget the heading so normal slew smoothing handles the visual turn.'
);

assert(
  !slideBlock.includes('c.heading = slide.heading;'),
  'Caterpillar obstacle correction should not snap c.heading directly; that causes visible head jerks.'
);
