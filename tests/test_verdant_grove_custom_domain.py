#!/usr/bin/env python3
"""Static invariants for Verdant Grove polish and custom domain setup."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class VerdantGroveCustomDomainTest(unittest.TestCase):
    def test_github_pages_custom_domain_is_configured(self) -> None:
        self.assertEqual((ROOT / "CNAME").read_text().strip(), "small-world.pardev.net")

    def test_public_docs_use_custom_domain(self) -> None:
        for rel in ["README.md", "CLAUDE.md"]:
            text = (ROOT / rel).read_text()
            self.assertIn("https://small-world.pardev.net/", text)
            self.assertNotIn("https://paulrobello.github.io/small-world/", text)

    def test_verdant_biome_declares_grove_detail_flags(self) -> None:
        source = (ROOT / "src" / "biomes.js").read_text()
        verdant_block = source[source.index('id: "verdant"') : source.index('id: "desert"')]
        self.assertIn("groveDetails", verdant_block)
        self.assertIn("mushroomFamilies", verdant_block)
        self.assertIn("fairyRing", verdant_block)

    def test_verdant_grove_has_no_grass_edge_disc(self) -> None:
        source = (ROOT / "src" / "biomes.js").read_text()
        verdant_block = source[source.index('id: "verdant"') : source.index('id: "desert"')]
        self.assertNotIn("edgeAura", verdant_block)
        self.assertNotIn('pattern: "grass"', verdant_block)

    def test_world_places_verdant_detail_layers(self) -> None:
        world = (ROOT / "src" / "world.js").read_text()
        env = (ROOT / "src" / "environment.js").read_text()
        flora = (ROOT / "src" / "flora.js").read_text()
        inspect = (ROOT / "src" / "inspect.js").read_text()

        self.assertIn("makeVerdantGroveDetails", env)
        self.assertIn("makeVerdantGroveDetails", world)
        self.assertIn("FLORA_BUILDERS.fairyring", world)
        self.assertIn("fairyring(biome)", flora)
        self.assertIn('"fairyring"', inspect)

    def test_tree_and_large_mushroom_canopies_block_each_other(self) -> None:
        world = (ROOT / "src" / "world.js").read_text()
        self.assertIn("CANOPY_SPACING_KINDS", world)
        self.assertIn('"tree", "leafballtree", "pine", "deadtree", "bigmushroom"', world)
        self.assertIn("CANOPY_SPACING_PAD", world)
        self.assertIn("CANOPY_SPACING_KINDS.has(kind)", world)
        self.assertIn("blocksFloraPlacement(p.x, p.z, fp * CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS)", world)

    def test_grove_spores_are_smaller_and_animated(self) -> None:
        flora = (ROOT / "src" / "flora.js").read_text()
        self.assertIn("applySporeDrift", flora)
        self.assertIn("uSporeDrift", flora)
        self.assertIn("new THREE.SphereGeometry(0.0195", flora)
        self.assertNotIn("new THREE.SphereGeometry(0.026, 6, 5)", flora)
        self.assertNotIn("new THREE.SphereGeometry(0.032, 6, 5)", flora)

    def test_grass_edge_discs_can_be_disabled_and_default_off_in_lowfx(self) -> None:
        state = (ROOT / "src" / "state.js").read_text()
        sky = (ROOT / "src" / "sky.js").read_text()
        ui = (ROOT / "src" / "ui.js").read_text()
        html = (ROOT / "index.html").read_text()

        self.assertIn("grassEdgeDiscs", state)
        self.assertIn("grassEdgeDiscs", ui)
        self.assertIn("setting-grass-edge-discs", html)
        self.assertIn("if (isGrassAura && (LOWFX || state.userSettings.grassEdgeDiscs === false)) return null;", sky)

    def test_only_bare_biome_grass_density_overrides_are_present(self) -> None:
        biomes = (ROOT / "src" / "biomes.js").read_text()
        self.assertIn("export const GRASS_DENSITY = { ashen: 0, desert: 0 };", biomes)
        self.assertIn("export const GRASS_HEIGHT = {};", biomes)
        self.assertNotIn("verdant: 300", biomes)
        self.assertNotIn("grove: 0.75", biomes)

    def test_settings_panel_has_reset_to_defaults_button(self) -> None:
        html = (ROOT / "index.html").read_text()
        ui = (ROOT / "src" / "ui.js").read_text()
        self.assertIn("setting-reset-defaults", html)
        self.assertIn("reset all to defaults", html)
        self.assertIn("localStorage.removeItem(SETTINGS_KEY)", ui)
        self.assertIn("window.location.reload()", ui)

    def test_mushroom_perches_follow_wind_sway(self) -> None:
        flora = (ROOT / "src" / "flora.js").read_text()
        world = (ROOT / "src" / "world.js").read_text()
        creature = (ROOT / "src" / "fauna" / "creature.js").read_text()

        self.assertIn("g.userData.perchWind", flora)
        self.assertIn("perchWind: f.userData.perchWind", world)
        self.assertIn("function currentPerchPoint(perch)", creature)
        self.assertIn("state.windUniforms.uTime.value", creature)
        self.assertIn("modelMatrix * vec4(transformed, 1.0)", creature)
        self.assertIn("perchOffsetX", creature)
        self.assertIn("perchOffsetZ", creature)
        self.assertIn("currentPerchPoint(c.perchTarget)", creature)

    def test_mushrooms_caterpillars_and_snails_use_smooth_shading(self) -> None:
        flora = (ROOT / "src" / "flora.js").read_text()
        caterpillar = (ROOT / "src" / "fauna" / "caterpillar.js").read_text()

        for marker in [
            "mushroom.stem.mat.smooth",
            "bigmushroom.stem.mat.smooth",
            "grove.babyMushroom.stem.mat.smooth",
        ]:
            self.assertIn(marker, flora)
        self.assertIn("caterpillar.head.mat.smooth", caterpillar)
        self.assertIn("caterpillar.segment.mat.smooth", caterpillar)
        self.assertIn("snail.shell.mat.smooth", caterpillar)
        self.assertIn("snail.ridge.mat.smooth", caterpillar)
        self.assertIn("const segDetail = wantsFur ? 1 : 2", caterpillar)
        self.assertIn("new THREE.IcosahedronGeometry(segRadius, segDetail)", caterpillar)
        self.assertNotIn("new THREE.IcosahedronGeometry(segRadius, 0)", caterpillar)
        self.assertIn("3 + Math.floor(Math.random() * 6)", caterpillar)
        self.assertNotIn("3 + Math.floor(Math.random() * 4)", caterpillar)
        self.assertNotIn("caterpillar.head.mat.flat", caterpillar)
        self.assertNotIn("snail.shell.mat.flat", caterpillar)

    def test_leafballtree_trunk_height_varies_up_to_twenty_five_percent(self) -> None:
        flora = (ROOT / "src" / "flora.js").read_text()
        world = (ROOT / "src" / "world.js").read_text()

        self.assertIn("leafballtreeTrunkHeightMul = 1 + Math.random() * 0.25", flora)
        self.assertIn("canopyYOffset = 1.45 * (leafballtreeTrunkHeightMul - 1)", flora)
        self.assertIn("trunk.scale.y = leafballtreeTrunkHeightMul", flora)
        self.assertIn("canopyCenter = new THREE.Vector3(0, 1.46 + canopyYOffset, 0)", flora)
        self.assertIn("g.userData.obstacleTopY = 2.25 + canopyYOffset", flora)
        self.assertIn("f.userData.obstacleTopY ?? OBSTACLE_TOP[kind]", world)

    def test_verdant_walker_palette_is_softer_and_walker_parts_are_smooth(self) -> None:
        biomes = (ROOT / "src" / "biomes.js").read_text()
        creature = (ROOT / "src" / "fauna" / "creature.js").read_text()
        verdant_block = biomes[biomes.index('id: "verdant"') : biomes.index('id: "desert"')]

        self.assertIn('creatureColors: ["#53693e", "#657a45", "#7b7045", "#8a6a3f"]', verdant_block)
        self.assertNotIn("#fff8e0\"],", verdant_block)
        self.assertNotIn("#d8cfa3", verdant_block)
        self.assertIn("walker.body.mat.smooth", creature)
        self.assertIn("walker.belly.mat.smooth", creature)
        self.assertIn("walker.leg.mat.smooth", creature)
        self.assertIn("walker.foot.mat.smooth", creature)
        self.assertIn("const bodyDetail = wantsFur ? 1 : 2", creature)
        self.assertIn("new THREE.IcosahedronGeometry(0.42, bodyDetail)", creature)
        self.assertNotIn("new THREE.IcosahedronGeometry(0.42, 0)", creature)

    def test_walker_fur_roll_happens_before_geometry_jitter(self) -> None:
        creature = (ROOT / "src" / "fauna" / "creature.js").read_text()

        self.assertIn("const furRoll = furProb > 0 ? Math.random() : 1", creature)
        self.assertIn("const wantsFur = isBumblebee || (!isFish && (opts.furry ?? (furProb > 0 && furRoll < furProb)))", creature)
        self.assertLess(creature.index("const furRoll"), creature.index("const bodyGeo"))
        self.assertLess(creature.index("const wantsFur"), creature.index("const bodyGeo"))
        self.assertIn("if (wantsFur) {", creature)

    def test_lowfx_keeps_a_reduced_fur_stack(self) -> None:
        fur = (ROOT / "src" / "fur.js").read_text()

        self.assertNotIn("if (LOWFX) return null", fur)
        self.assertIn("const layers = opts.layers ?? (LOWFX ? 4 : 8);", fur)
        self.assertIn("const furLength = opts.length ?? biome.furLength ?? (LOWFX ? 0.082 : 0.072);", fur)

    def test_mushroom_grove_creature_palette_uses_muted_spore_tones(self) -> None:
        biomes = (ROOT / "src" / "biomes.js").read_text()
        grove_block = biomes[biomes.index('id: "grove"') : biomes.index('id: "obsidian"')]

        self.assertIn('creatureColors: ["#ff90c0", "#c7a0c8", "#9c84d4", "#ffd1a3"]', grove_block)
        self.assertNotIn('"#fff2b3"', grove_block)

    def test_verdant_fur_is_readable_in_live_world(self) -> None:
        biomes = (ROOT / "src" / "biomes.js").read_text()
        creature = (ROOT / "src" / "fauna" / "creature.js").read_text()
        fur = (ROOT / "src" / "fur.js").read_text()
        verdant_block = biomes[biomes.index('id: "verdant"') : biomes.index('id: "desert"')]

        self.assertIn("furProbability: 1.0", verdant_block)
        self.assertIn("furLength: 0.075", verdant_block)
        self.assertNotIn("furTip", verdant_block)
        self.assertIn("tipColor: bodyCol.clone()", creature)
        self.assertNotIn("new THREE.Color(biome.furTip)", creature)
        self.assertIn("vec3 cell = floor(vPos * 80.0);", fur)

    def test_verdant_fliers_get_fur_but_fish_do_not(self) -> None:
        creature = (ROOT / "src" / "fauna" / "creature.js").read_text()

        self.assertIn("const wantsFur = isBumblebee || (!isFish && (opts.furry ?? (furProb > 0 && furRoll < furProb)))", creature)
        self.assertIn("Fish never get fur; fliers use the same", creature)

    def test_verdant_uses_leafballtree_with_custom_leaf_wind(self) -> None:
        biomes = (ROOT / "src" / "biomes.js").read_text()
        flora = (ROOT / "src" / "flora.js").read_text()
        world = (ROOT / "src" / "world.js").read_text()
        inspect = (ROOT / "src" / "inspect.js").read_text()
        verdant_block = biomes[biomes.index('id: "verdant"') : biomes.index('id: "desert"')]

        self.assertIn('"leafballtree"', verdant_block)
        self.assertNotIn('"tree"', verdant_block)
        self.assertIn("leafballtree(biome)", flora)
        self.assertIn("applyLeafPlateWind", flora)
        self.assertIn("uLeafPlateWind", flora)
        self.assertIn("leafOrigin", flora)
        self.assertIn("tipFlex", flora)
        self.assertNotIn("float height = max(wp.y, 0.0);", flora)
        self.assertIn("applyLeafPlateGradient", flora)
        self.assertIn("uLeafTipLift", flora)
        self.assertIn("vLeafPlateVein", flora)
        self.assertIn("uLeafSideShade", flora)
        self.assertIn("vLeafPlateSide", flora)
        self.assertIn("shingleLift", flora)
        self.assertIn("leafballtree", world)
        self.assertIn('"leafballtree"', inspect)
        self.assertIn("Curved, anchored leaf", flora)
        self.assertNotIn("leafballtree.leaf.mat.inner", flora)
        self.assertNotIn("inner underside fill", flora)
        self.assertIn("leafballtree.branch.geo", flora)

    def test_leafballtree_leaves_have_subtle_instanced_outlines(self) -> None:
        flora = (ROOT / "src" / "flora.js").read_text()

        self.assertIn("leafballtree.leaf.outline.geo", flora)
        self.assertIn("leafballtree.leaf.outline.mat", flora)
        self.assertIn("pos.setX(i, pos.getX(i) * 1.075)", flora)
        self.assertIn("pos.setZ(i, pos.getZ(i) - 0.006)", flora)
        self.assertIn("new THREE.MeshBasicMaterial", flora)
        self.assertIn("outline: getLeafballOutlineColor(leaves, trunk)", flora)
        self.assertIn("function getLeafballOutlineColor(leaves, trunk)", flora)
        self.assertIn("color: palette.outline", flora)
        self.assertIn("polygonOffset: true", flora)
        self.assertIn("const outline = makeInstancedLeafBatch(leafOutlineGeo, leafOutlineMat, leafBuckets[i])", flora)
        self.assertIn("outline.renderOrder = -1", flora)
        self.assertLess(flora.index("const outline = makeInstancedLeafBatch"), flora.index("const leaves = makeInstancedLeafBatch"))

    def test_leafballtree_uses_instanced_leaf_batches(self) -> None:
        flora = (ROOT / "src" / "flora.js").read_text()

        self.assertIn("makeInstancedLeafBatch", flora)
        self.assertIn("new THREE.InstancedMesh(geometry, material, matrices.length)", flora)
        self.assertIn("leafBuckets", flora)
        self.assertIn("leafBuckets[matIndex].push(matrix.clone())", flora)
        self.assertIn("USE_INSTANCING", flora)
        self.assertIn("modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)", flora)
        self.assertNotIn("const leaf = new THREE.Mesh(leafGeo, mat);", flora)

    def test_inspect_supports_initial_view_param_and_default_pause(self) -> None:
        inspect = (ROOT / "src" / "inspect.js").read_text()
        state = (ROOT / "src" / "state.js").read_text()
        main = (ROOT / "main.js").read_text()

        self.assertIn("INSPECT_VIEW_DIRECTIONS", inspect)
        for view in ["default", "top", "left", "right", "front", "back", "up"]:
            self.assertIn(f'{view}: new THREE.Vector3', inspect)
        self.assertIn('_params.get("view")', inspect)
        self.assertIn('sp.set("view", _viewName)', inspect)
        self.assertIn('_parseVectorParam(_params.get("camera"))', inspect)
        self.assertIn('_parseVectorParam(_params.get("target"))', inspect)
        self.assertIn('sp.set("camera", _formatVectorParam(_cameraOverride))', inspect)
        self.assertIn('sp.set("target", _formatVectorParam(_targetOverride))', inspect)
        self.assertIn('camera.position.copy(_cameraOverride)', inspect)
        self.assertIn('controls.target.copy(_targetOverride)', inspect)
        self.assertIn('let _paused = _params.get("paused") !== "0";', inspect)
        self.assertIn("controls.autoRotate = !_paused", inspect)
        self.assertIn("autoRotate: false", state)
        self.assertIn("controls.autoRotate = false", main)

    def test_inspect_wind_toggle_defaults_off(self) -> None:
        inspect = (ROOT / "src" / "inspect.js").read_text()
        self.assertIn('_params.get("wind") === "1"', inspect)
        self.assertIn("_inspectWindEnabled", inspect)
        self.assertIn("applyInspectWindSetting", inspect)
        self.assertIn("state.windUniforms.uFoliageWind.value = _inspectWindEnabled ? 1 : 0", inspect)
        self.assertIn('e.key === "w" || e.key === "W"', inspect)
        self.assertIn('sp.set("wind", "1")', inspect)
        self.assertIn("WIND", inspect)

    def test_inspect_supports_screenshot_param_and_keybind(self) -> None:
        inspect = (ROOT / "src" / "inspect.js").read_text()
        main = (ROOT / "main.js").read_text()

        self.assertIn('_params.get("screenshot") === "1"', inspect)
        self.assertIn("downloadInspectScreenshot", inspect)
        self.assertIn("renderer.domElement.toDataURL", inspect)
        self.assertIn('a.download = `small-world-inspect-${biomeTag}-${variantTag}-${seedTag}-${_viewName}.png`', inspect)
        self.assertIn('e.key === "s" || e.key === "S"', inspect)
        self.assertIn("scheduleAutoScreenshot", inspect)
        self.assertIn("preserveDrawingBuffer: true", main)


if __name__ == "__main__":
    unittest.main()
