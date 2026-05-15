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
        self.assertIn("new THREE.SphereGeometry(0.024", flora)
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

    def test_verdant_grove_grass_density_is_reduced_again(self) -> None:
        biomes = (ROOT / "src" / "biomes.js").read_text()
        self.assertIn("verdant: 75", biomes)
        self.assertNotIn("verdant: 150", biomes)
        self.assertNotIn("verdant: 300", biomes)
        self.assertNotIn("verdant: 600", biomes)

    def test_settings_panel_has_reset_to_defaults_button(self) -> None:
        html = (ROOT / "index.html").read_text()
        ui = (ROOT / "src" / "ui.js").read_text()
        self.assertIn("setting-reset-defaults", html)
        self.assertIn("reset all to defaults", html)
        self.assertIn("localStorage.removeItem(SETTINGS_KEY)", ui)
        self.assertIn("window.location.reload()", ui)

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
