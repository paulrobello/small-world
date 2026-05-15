#!/usr/bin/env python3
"""Static invariants for soft-ground creature footprint/trail wiring."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
STATE_JS = ROOT / "src" / "state.js"
BIOMES_JS = ROOT / "src" / "biomes.js"
ENVIRONMENT_JS = ROOT / "src" / "environment.js"
WORLD_JS = ROOT / "src" / "world.js"
MAIN_JS = ROOT / "main.js"
CREATURE_JS = ROOT / "src" / "fauna" / "creature.js"
CATERPILLAR_JS = ROOT / "src" / "fauna" / "caterpillar.js"


class GroundMarksStaticTest(unittest.TestCase):
    def test_ground_mark_system_exports_and_shader_alpha(self) -> None:
        source = ENVIRONMENT_JS.read_text()

        self.assertIn("export function makeGroundMarks", source)
        self.assertIn("export function emitGroundMark", source)
        self.assertIn("export function stepGroundMarks", source)
        self.assertIn("attribute float aAlpha", source)
        self.assertIn("depthWrite: false", source)
        self.assertIn("polygonOffset: true", source)

    def test_state_world_and_main_wire_ground_marks(self) -> None:
        state_source = STATE_JS.read_text()
        world_source = WORLD_JS.read_text()
        main_source = MAIN_JS.read_text()

        self.assertIn("groundMarks: null", state_source)
        self.assertIn("makeGroundMarks", world_source)
        self.assertIn("state.groundMarks = null", world_source)
        self.assertIn("state.groundMarks = makeGroundMarks(biome)", world_source)
        self.assertIn("stepGroundMarks", main_source)
        self.assertIn("stepGroundMarks(state.groundMarks, dt, state.heightFn)", main_source)

    def test_soft_ground_biomes_are_configured(self) -> None:
        source = BIOMES_JS.read_text()

        self.assertGreaterEqual(source.count("groundMarks:"), 6)
        self.assertIn('poof: "sand"', source)
        self.assertIn('id: "desert"', source)
        self.assertIn('id: "golden"', source)
        self.assertIn('id: "mossy"', source)

    def test_walkers_and_fliers_emit_marks(self) -> None:
        source = CREATURE_JS.read_text()

        self.assertIn("emitGroundMark", source)
        self.assertIn("emitWalkerFootprint", source)
        self.assertIn("emitFlierLandingMarks", source)
        self.assertIn("groundMarkOffset", source)
        self.assertIn("poof: true", source)
        self.assertIn("makeDustKick", source)

    def test_crawlers_emit_continuous_trails(self) -> None:
        source = CATERPILLAR_JS.read_text()

        self.assertIn("emitGroundMark", source)
        self.assertIn("emitCrawlerGroundMark", source)
        self.assertIn("lastGroundMarkX", source)
        self.assertIn("groundMarkDistance", source)
        self.assertIn('c.type === "snail"', source)


if __name__ == "__main__":
    unittest.main()
