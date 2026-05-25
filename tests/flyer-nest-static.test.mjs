import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const creatureSource = readFileSync(new URL('../src/fauna/creature.js', import.meta.url), 'utf8');
const pbrSource = readFileSync(new URL('../src/pbr.js', import.meta.url), 'utf8');
const inspectSource = readFileSync(new URL('../src/inspect.js', import.meta.url), 'utf8');

assert(
  floraSource.includes('flyer_nest(biome)'),
  'flyer_nest should be registered as a named flora builder.'
);

for (const biome of BIOMES) {
  assert(
    !biome.flora.includes('flyer_nest'),
    `${biome.id} should not spend random flora budget on flyer nests; nests are placed from the actual flyer count.`
  );
}

const cloudBiome = BIOMES.find((biome) => biome.id === 'cloud');
assert.equal(
  cloudBiome?.noFlyerNests,
  true,
  'cloud island should keep balloon trees but opt out of flyer nest generation.'
);

const nestStart = floraSource.indexOf('flyer_nest(biome)');
const nestEnd = floraSource.indexOf('deadtree(biome)', nestStart);
const nestBlock = floraSource.slice(nestStart, nestEnd);

assert(nestStart >= 0 && nestEnd > nestStart, 'flyer_nest builder should live before deadtree flora.');
assert(
  nestBlock.includes('makeFlyerNestPBRMaterial')
    && nestBlock.includes('FLYER_NEST_PERCH_RADIUS = 0.612')
    && nestBlock.includes('new THREE.TorusGeometry(0.558, 0.252, 8, 24)')
    && nestBlock.includes('geo.scale(1, 0.62, 1)')
    && !nestBlock.includes('flatShading: false')
    && nestBlock.includes('flatShading: true')
    && nestBlock.includes('side: THREE.DoubleSide')
    && nestBlock.includes('const bowl = new THREE.Mesh(innerBowlGeo, bowlMat)')
    && nestBlock.includes('new THREE.CylinderGeometry(0.0432, 0.0612, 1, 5)')
    && floraSource.includes('function getFlyerNestPalette(biome)')
    && floraSource.includes('new THREE.Color(biome.ground[0])')
    && floraSource.includes('new THREE.Color(biome.cliff)')
    && floraSource.includes('new THREE.Color(biome.accent ?? biome.sun ?? biome.cliff)')
    && nestBlock.includes('const nestPalette = getFlyerNestPalette(biome)')
    && nestBlock.includes('const lightTwigColor = nestPalette.light')
    && nestBlock.includes('const twigLightMat = makeFlyerNestPBRMaterial')
    && nestBlock.includes('i % 4 === 1 || i % 7 === 3 ? twigLightMat : mat')
    && nestBlock.includes('flyer_nest.outerRing.geo')
    && nestBlock.includes('flyer_nest.innerBowl.geo')
    && nestBlock.includes('g.userData.capTopY')
    && nestBlock.includes('g.userData.perchRadius'),
  'flyer_nest should build a broad twig-textured bowl with biome-derived colors, explicit perch height, and radius.'
);

const balloonStart = floraSource.indexOf('balloontree(biome)');
const balloonEnd = floraSource.indexOf('lavafissure(biome)', balloonStart);
const balloonBlock = floraSource.slice(balloonStart, balloonEnd);

assert(balloonStart >= 0 && balloonEnd > balloonStart, 'balloontree builder should live before lavafissure flora.');
assert(
  balloonBlock.includes('g.userData.capTopY = trunkH + 0.95')
    && balloonBlock.includes('g.userData.obstacleTopY = trunkH + (biome.cloudlike ? 1.08 : 0.95)'),
  'balloontree should publish a per-instance crown height so hosted flyer nests sit on the puff canopy instead of using the loose obstacle fallback.'
);

assert(
  pbrSource.includes('export function makeFlyerNestPBRMaterial')
    && pbrSource.includes('buildFlyerNestTwigTextures')
    && pbrSource.includes('cachedDetailTextures("flyer-nest-twigs", buildFlyerNestTwigTextures)')
    && pbrSource.includes('const nestColorCanvas = makeCanvas(size)')
    && pbrSource.includes('const ringFlow = v +')
    && pbrSource.includes('const bowlSwirl =')
    && pbrSource.includes('bowlAngle * 2.4 + bowlRadius * 18.0')
    && pbrSource.includes('v * 34.0 + u * 0.65')
    && pbrSource.includes('v * 52.0 - u * 1.0')
    && pbrSource.includes('const lightTwigSwirl = clamp01(raised * 0.58 + twigStrand * 0.36 + bowlSwirl * 0.52')
    && pbrSource.includes('colorTexture: configureColorTexture(new THREE.CanvasTexture(nestColorCanvas))')
    && pbrSource.includes('const { colorTexture, normalTexture, materialTexture } = cachedDetailTextures("flyer-nest-twigs", buildFlyerNestTwigTextures)')
    && pbrSource.includes('material.color.set(0xffffff)')
    && pbrSource.includes('twigStrand')
    && pbrSource.includes('crossWeave')
    && pbrSource.includes('material.normalScale.set(1.05, 1.05)'),
  'flyer_nest PBR should expose cached procedural twig normal/material detail with light-brown color swirls aligned to raised twig bumps.'
);

assert(
  worldSource.includes('flyer_nest: 0.612')
    && worldSource.includes('"flyer_nest"')
    && worldSource.includes('function placeFlyerNest()')
    && worldSource.includes('const kind = "flyer_nest"')
    && worldSource.includes('let s = Math.max(1.05, 0.7 + Math.random() * 0.7)')
    && worldSource.includes('kind === "flyer_nest"')
    && worldSource.includes('perchRadius: (f.userData.perchRadius ?? 0.4) * s'),
  'world generation should place flyer_nest as a large obstacle/perch with a scaled landing radius.'
);

assert(
  worldSource.includes('const NEST_HOST_KINDS = new Set(["tree", "leafballtree", "pine", "snowpine", "balloontree", "bigmushroom", "pillar"])')
    && worldSource.includes('const biomeHasNestHosts = biome.flora.some((kind) => NEST_HOST_KINDS.has(kind))')
    && worldSource.includes('const MIN_NEST_HOST_RADIUS')
    && worldSource.includes('const nestHosts = []')
    && worldSource.includes('function blocksNestPlacement')
    && worldSource.includes('if (block === allowedHostBlock) continue')
    && worldSource.includes('function nestTouchesWater(x, z, r)')
    && worldSource.includes('function sampleTerrainFootprint(x, z, r)')
    && worldSource.includes('function getFlyerNestGroundPose(x, z, r, scale)')
    && worldSource.includes('Math.max(...heights) - FLYER_NEST_BASE_CLEARANCE * scale')
    && worldSource.includes('function pickNestHost')
    && worldSource.includes('if (!choices.length) return null')
    && worldSource.includes('if (nestTouchesWater(host.x, host.z, r * 1.2)) continue')
    && worldSource.includes('let nestHost = biomeHasNestHosts ? pickNestHost(fp) : null')
    && worldSource.includes('if (biomeHasNestHosts) return false')
    && worldSource.includes('const candidatePose = getFlyerNestGroundPose(candidate.x, candidate.z, fp, s)')
    && worldSource.includes('if (!candidatePose) continue')
    && worldSource.includes('if (nestTouchesWater(candidate.x, candidate.z, fp * 1.2)) continue')
    && worldSource.includes('kind === "flyer_nest" && nestHost')
    && worldSource.includes('perchKind: "flyer_nest"')
    && worldSource.includes('perchKind: kind')
    && worldSource.includes('nestHosts.push({')
    && worldSource.includes('hostKind: kind'),
  'flyer_nest placement should avoid ground flora, other nests, water overlap, and terrain clipping, using eligible trees, large mushrooms, or wide pillars as hosts.'
);

assert(
  worldSource.includes('const flyerCount = worldState.creatures.filter((c) => c.flies && !c.isFish && !c.isBee).length')
    && worldSource.includes('const flyerNestTarget = biome.noFlyerNests ? 0 : flyerCount < 4 ? flyerCount : Math.ceil(flyerCount / 2)')
    && worldSource.includes('while (flyerNestPlaced < flyerNestTarget')
    && worldSource.includes('if (placeFlyerNest()) flyerNestPlaced++')
    && !worldSource.includes('worldState.bees.filter')
    && !worldSource.includes('worldState.flocks.filter'),
  'world generation should match nest count to perch-using flyers below four, then round up half for larger counts, without counting bees or flocks.'
);

assert(
  creatureSource.includes('function releasePerchForFlier(c)')
    && creatureSource.includes('function claimPerchForFlier(c, perch)')
    && creatureSource.includes('isBee: isBumblebee')
    && creatureSource.includes('if (c.isFish || c.isBee) return')
    && creatureSource.includes('perch.occupant')
    && creatureSource.includes('let nearestNest = null')
    && creatureSource.includes('let nearestOther = null')
    && creatureSource.includes('if (p.perchKind === "flyer_nest")')
    && creatureSource.includes('const nearest = nearestNest ?? nearestOther')
    && creatureSource.includes('claimPerchForFlier(c, nearest)')
    && creatureSource.includes('releasePerchForFlier(c);'),
  'flier perch targeting should reserve and release perches so only one eligible flier occupies a perch target, preferring free nests before other perch types.'
);

assert(
  creatureSource.includes('PERCHED_WING_DOWN_Z')
    && creatureSource.includes('PERCHED_WING_BACK_Y')
    && creatureSource.includes('const restRotZ = sign * PERCHED_WING_DOWN_Z')
    && creatureSource.includes('const restRotY = sign * PERCHED_WING_BACK_Y'),
  'perched fliers should hold wings down and back instead of the old raised/tucked pose.'
);

assert(
  inspectSource.includes('"flyer_nest"'),
  'Inspect flora catalog should expose the flyer nest specimen.'
);
