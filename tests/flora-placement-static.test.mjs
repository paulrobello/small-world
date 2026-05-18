import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

function extractSetBlock(source, name) {
  const marker = `const ${name} = new Set([`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} declaration not found`);

  const end = source.indexOf(']);', start);
  assert.notEqual(end, -1, `${name} declaration end not found`);

  return source.slice(start, end + 3);
}

const canopySpacingKinds = extractSetBlock(worldSource, 'CANOPY_SPACING_KINDS');

assert(
  canopySpacingKinds.includes('"tree"')
    && canopySpacingKinds.includes('"leafballtree"')
    && canopySpacingKinds.includes('"pine"')
    && canopySpacingKinds.includes('"berrybush"'),
  'Tree and berry bush flora should share broad spacing so their visible masses do not overlap.'
);

assert(
  worldSource.includes('blocksFloraPlacement(p.x, p.z, fp * CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS)'),
  'Broad visual flora spacing should be checked before building the flora mesh.'
);

assert(
  worldSource.includes('r: fp * (CANOPY_SPACING_KINDS.has(kind) ? CANOPY_SPACING_PAD : 1.2)'),
  'Broad-spaced flora should reserve the same radius that future broad flora checks use.'
);
