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


def extract_biome_block(source: str, biome_id: str) -> str:
    marker = f'id: "{biome_id}"'
    marker_index = source.find(marker)
    if marker_index == -1:
        raise AssertionError(f"Biome {biome_id!r} not found")

    block_start = source.rfind("{", 0, marker_index)
    if block_start == -1:
        raise AssertionError(f"Biome {biome_id!r} block start not found")

    depth = 0
    for index in range(block_start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[block_start : index + 1]

    raise AssertionError(f"Biome {biome_id!r} block end not found")


class GroundMarksStaticTest(unittest.TestCase):
    def test_ground_mark_system_exports_and_shader_alpha(self) -> None:
        source = ENVIRONMENT_JS.read_text()
        # Scope assertions to the ground marks section only — InstancedMesh
        # and PlaneGeometry are used elsewhere in environment.js.
        start = source.index("// ─── soft-ground creature marks")
        end = source.index("// ─── fly swarms", start)
        section = source[start:end]

        self.assertIn("export function makeGroundMarks", section)
        self.assertIn("export function emitGroundMark", section)
        self.assertIn("export function stepGroundMarks", section)
        self.assertIn("installGroundMarkShader", section)
        self.assertIn("onBeforeCompile", section)
        self.assertIn("new THREE.CanvasTexture", section)
        self.assertIn("uGroundMarkTex", section)
        self.assertIn("texture2D(uGroundMarkTex", section)
        self.assertIn("diffuseColor.rgb = mix", section)
        self.assertNotIn("GROUND_MARK_LIFT", section)
        self.assertNotIn("new THREE.InstancedMesh", section)
        self.assertNotIn("new THREE.PlaneGeometry", section)
        self.assertNotIn("attribute float aAlpha", section)
        self.assertNotIn("polygonOffset: true", section)

    def test_state_world_and_main_wire_ground_marks(self) -> None:
        state_source = STATE_JS.read_text()
        world_source = WORLD_JS.read_text()
        main_source = MAIN_JS.read_text()

        self.assertIn("groundMarks: null", state_source)
        self.assertIn("makeGroundMarks", world_source)
        self.assertIn("state.groundMarks = null", world_source)
        self.assertIn("state.groundMarks = makeGroundMarks(biome)", world_source)
        self.assertIn("stepGroundMarks", main_source)
        self.assertIn("stepGroundMarks(state.groundMarks, dt)", main_source)

    def test_soft_ground_biomes_are_configured(self) -> None:
        source = BIOMES_JS.read_text()

        for biome_id in ("verdant", "desert", "frozen", "golden", "mossy", "twilight", "grove"):
            biome_block = extract_biome_block(source, biome_id)
            self.assertIn("groundMarks:", biome_block, biome_id)

        desert_block = extract_biome_block(source, "desert")
        self.assertIn('poof: "sand"', desert_block)

    def test_walkers_and_fliers_emit_marks(self) -> None:
        source = CREATURE_JS.read_text()

        self.assertIn("emitGroundMark", source)
        self.assertIn("emitWalkerFootprint", source)
        self.assertIn("emitFlierLandingMarks", source)
        self.assertIn("groundMarkOffset", source)
        self.assertIn("poof: true", source)
        self.assertIn("makeDustKick", source)

    def test_walker_footprints_are_not_gated_by_shared_dust_cooldown(self) -> None:
        source = CREATURE_JS.read_text()

        self.assertIn("if (sVal > 0.85 && prev <= 0.85) {", source)
        self.assertIn("emitWalkerFootprint(c, i, heightFn);", source)
        self.assertIn("if (t - c.lastDustAt > 0.18) {", source)
        self.assertNotIn(
            "if (sVal > 0.85 && prev <= 0.85 && t - c.lastDustAt > 0.18) {",
            source,
        )

    def test_crawlers_emit_continuous_trails(self) -> None:
        source = CATERPILLAR_JS.read_text()

        self.assertIn("emitGroundMark", source)
        self.assertIn("emitCrawlerGroundMark", source)
        self.assertIn("lastGroundMarkX", source)
        self.assertIn("lastGroundSampleX", source)
        self.assertIn("lastGroundSampleZ", source)
        self.assertIn("groundMarkDistance", source)
        self.assertIn('c.type === "snail"', source)


if __name__ == "__main__":
    unittest.main()
