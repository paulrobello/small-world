#!/usr/bin/env python3
"""Static rendering invariants for no-build Three.js modules."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKY_JS = ROOT / "src" / "sky.js"
BIOMES_JS = ROOT / "src" / "biomes.js"


def _function_body(source: str, name: str) -> str:
    marker = f"export function {name}"
    start = source.index(marker)
    brace = source.index("{", start)
    depth = 0
    for i in range(brace, len(source)):
        ch = source[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[brace : i + 1]
    raise AssertionError(f"Could not find end of {name}()")


class SkyRenderingInvariantsTest(unittest.TestCase):
    def test_aurora_respects_scene_depth_without_writing_depth(self) -> None:
        sky_source = SKY_JS.read_text()
        aurora_body = _function_body(sky_source, "makeAurora")

        self.assertNotIn(
            "depthTest: false",
            aurora_body,
            "Aurora is a transparent backdrop effect, but it must still depth-test "
            "against foreground trees/grass so it cannot draw over them.",
        )
        self.assertIn(
            "depthWrite: false",
            aurora_body,
            "Aurora should remain non-depth-writing so its transparent curtains blend softly.",
        )

    def test_aurora_has_soft_edges_color_variation_and_shimmer(self) -> None:
        sky_source = SKY_JS.read_text()
        aurora_body = _function_body(sky_source, "makeAurora")

        self.assertIn("tints[2]", aurora_body, "Aurora should support a per-biome third tint for richer color.")
        self.assertIn("uC", aurora_body, "Aurora should blend a third tint for richer color.")
        self.assertIn("edgeFade", aurora_body, "Aurora alpha should feather horizontally to avoid hard panel edges.")
        self.assertIn("shimmer", aurora_body, "Aurora should include a time-varying shimmer term.")
        self.assertIn("hash", aurora_body, "Aurora should use soft noise breakup instead of solid bands.")

    def test_aurora_biomes_define_three_distinct_tints(self) -> None:
        biomes_source = BIOMES_JS.read_text()

        self.assertIn('frozen:   ["#7df0c8", "#a98cff",', biomes_source)
        self.assertIn('twilight: ["#ffd97a", "#c9a8e8",', biomes_source)
        self.assertIn('cloud:    ["#a8e0ff", "#ffd0e8",', biomes_source)


if __name__ == "__main__":
    unittest.main()
