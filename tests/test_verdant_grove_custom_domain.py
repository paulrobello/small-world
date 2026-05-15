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
        self.assertIn('"tree", "pine", "deadtree", "bigmushroom"', world)
        self.assertIn("CANOPY_SPACING_PAD", world)
        self.assertIn("CANOPY_SPACING_KINDS.has(kind)", world)
        self.assertIn("blocksFloraPlacement(p.x, p.z, fp * CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS)", world)


if __name__ == "__main__":
    unittest.main()
