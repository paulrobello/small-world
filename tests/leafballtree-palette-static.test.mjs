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
  goldenBlock.includes('edgeAura:') && goldenBlock.includes('pattern: "mist"'),
  'golden steppe should have a mist edge aura.'
);
assert(
  !goldenBlock.includes('pattern: "grass"'),
  'golden steppe should not render the grass edge/ring aura.'
);
assert(
  floraSource.includes('const branchReach = 0.62'),
  'leafballtree internal branches should reach closer to the canopy than the old 0.46 radius.'
);
assert(
  floraSource.includes('const minLeafMotionGap = 0.20') && floraSource.includes('canopyRadius.x - minLeafMotionGap'),
  'leafballtree branch reach should retain a clearance gap for leaf wind motion.'
);

const leafballFootprintMatch = worldSource.match(/leafballtree:\s*([0-9.]+)/);
assert(leafballFootprintMatch, 'leafballtree should have an explicit slope-plant footprint.');
assert(
  Number.parseFloat(leafballFootprintMatch[1]) <= 0.35,
  'leafballtree slope-plant footprint should describe the trunk base, not the canopy width, so bases stay near the terrain surface.'
);
assert(
  worldSource.includes('CANOPY_SPACING_KINDS = new Set(["tree", "leafballtree"'),
  'leafballtree broad-canopy spacing should remain handled by canopy spacing, not slope-plant footprint.'
);
assert(
  worldSource.includes('if (kind === "berrybush") s *= 1 + Math.random() * 0.25;'),
  'berry bushes should keep the existing size as the minimum and vary up to 25% larger.'
);
assert(
  floraSource.includes('addLeafRing({ count: 6, phi: 0.07, shell: 0.54, scale: 0.72, matIndex: 2')
    && floraSource.includes('pitchOffset: topMotionTuckAngle')
    && floraSource.includes('const topHighlightRows = 3;')
    && floraSource.includes('const matIndex = row < topHighlightRows ? 2 : row > 6 ? 0 : 1;'),
  'leafballtree top cap and upper rows should use the same highlight leaf palette and tuck angle.'
);
assert(
  floraSource.includes('const topMotionTuckRows = 4;')
    && floraSource.includes('const topMotionTuckAngle = -(0.045 + THREE.MathUtils.degToRad(2));')
    && floraSource.includes('const firstTopRowBackoffAngle = THREE.MathUtils.degToRad(2);')
    && floraSource.includes('pitchOffset: row === 0 ? topMotionTuckAngle + firstTopRowBackoffAngle : row < topMotionTuckRows ? topMotionTuckAngle : 0,'),
  'leafballtree first top row should back off two degrees while the cap and next top rows keep the stronger tuck.'
);
assert(
  floraSource.includes('const earlyRowPhaseOffsets = [0.16, 0.48, -0.08, 0.31];')
    && floraSource.includes('const rowPhase = row < earlyRowPhaseOffsets.length ? earlyRowPhaseOffsets[row] : staggerPhase;')
    && floraSource.includes('phase: rowPhase,')
    && floraSource.includes('if (row >= earlyRowPhaseOffsets.length) staggerPhase += Math.PI / rowCounts[row];'),
  'leafballtree rows 0-3 should use explicit non-cumulative phase offsets so their first leaves do not form a visible seam.'
);

const verdantBlock = extractObjectBlock(biomesSource, 'id: "verdant"');
assert(
  verdantBlock.includes('leafballCanopyProxy: true'),
  'Verdant grove should opt into a simplified leafball canopy shadow proxy.'
);
assert(
  floraSource.includes('function shouldUseLeafballCanopyShadowProxy(biome)')
    && floraSource.includes('biome.shadowLod?.leafballCanopyProxy === true'),
  'Leafball tree shadow proxy usage should be controlled by a biome shadow LOD flag.'
);
assert(
  floraSource.includes('const useCanopyShadowProxy = shouldUseLeafballCanopyShadowProxy(biome);')
    && floraSource.includes('makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i], !useCanopyShadowProxy)')
    && floraSource.includes('makeLeafballCanopyShadowProxy(canopyCenter, canopyRadius)')
    && floraSource.includes('leafballtree.canopy.shadowProxy.geo'),
  'Leafball tree canopies should keep visible leaf batches but replace their shadow casting with one proxy mesh when the LOD is enabled.'
);
