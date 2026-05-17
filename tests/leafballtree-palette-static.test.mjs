import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const biomesSource = readFileSync(new URL('../src/biomes.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

function extractObjectBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} marker not found`);

  const blockStart = source.lastIndexOf('{', markerIndex);
  assert.notEqual(blockStart, -1, `${marker} block start not found`);

  let depth = 0;
  for (let index = blockStart; index < source.length; index++) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(blockStart, index + 1);
  }

  throw new Error(`${marker} block end not found`);
}

const goldenBlock = extractObjectBlock(biomesSource, 'id: "golden"');

assert(
  floraSource.includes('function getLeafballTreePalette(biome)'),
  'leafballtree should resolve colors through a biome-aware palette helper.'
);
assert(
  floraSource.includes('biome.leafballTreePalette'),
  'leafballtree should read optional biome.leafballTreePalette overrides.'
);
assert(
  floraSource.includes('palette.leaves[0]')
    && floraSource.includes('palette.leaves[1]')
    && floraSource.includes('palette.leaves[2]'),
  'leafballtree should apply all three resolved leaf palette colors.'
);
assert(
  goldenBlock.includes('leafballTreePalette:'),
  'golden steppe should define a specific leafball tree palette.'
);
assert(
  goldenBlock.includes('leaves: ["#9a6d24", "#c49a3d", "#f1c86b"]'),
  'golden steppe leafball palette should use bronze, ochre, and honey leaf colors.'
);
assert(
  !goldenBlock.includes('#6f7f35'),
  'golden steppe leafball palette should not leave the lower canopy olive green.'
);
assert(
  goldenBlock.includes('"leafballtree", "leafballtree"'),
  'golden steppe should use leafballtree entries instead of regular tree entries.'
);
assert(
  !goldenBlock.includes('"tree"'),
  'golden steppe flora should no longer include regular tree entries.'
);
assert(
  worldSource.includes('biome.id === "golden" && (kind === "tree" || kind === "leafballtree")'),
  'golden steppe leafballtrees should keep the wider tree placement radius used by former regular trees.'
);
assert(
  biomesSource.includes('golden: 0.00'),
  'golden steppe grass blade bald/spot percentage should be 0.'
);
assert(
  floraSource.includes('const branchReach = 0.62'),
  'leafballtree internal branches should reach closer to the canopy than the old 0.46 radius.'
);
assert(
  floraSource.includes('const minLeafMotionGap = 0.20') && floraSource.includes('canopyRadius.x - minLeafMotionGap'),
  'leafballtree branch reach should retain a clearance gap for leaf wind motion.'
);
