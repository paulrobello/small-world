#!/usr/bin/env python3
"""Static regression checks for fauna obstacle avoidance and crawler trails."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORLD_JS = ROOT / "src" / "world.js"
CATERPILLAR_JS = ROOT / "src" / "fauna" / "caterpillar.js"
SHARED_JS = ROOT / "src" / "fauna" / "shared.js"


def extract_const_block(source: str, name: str) -> str:
    marker = f"const {name}"
    start = source.find(marker)
    if start == -1:
        raise AssertionError(f"{name} declaration not found")
    brace = source.find("{", start)
    bracket = source.find("[", start)
    opener = min(i for i in (brace, bracket) if i != -1)
    closer = "}" if source[opener] == "{" else "]"
    depth = 0
    for index in range(opener, len(source)):
        char = source[index]
        if char == source[opener]:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return source[opener : index + 1]
    raise AssertionError(f"{name} declaration end not found")


class FaunaObstacleAndTrailStaticTest(unittest.TestCase):
    def test_cactuses_are_static_obstacles_with_height_filter(self) -> None:
        source = WORLD_JS.read_text()
        obstacle_kinds = extract_const_block(source, "OBSTACLE_KINDS")
        obstacle_top = extract_const_block(source, "OBSTACLE_TOP")

        self.assertIn('"cactus"', obstacle_kinds)
        self.assertRegex(obstacle_top, r"\bcactus:\s*1\.[0-9]+")

    def test_crawler_trails_are_retained_by_distance_not_frame_count(self) -> None:
        source = CATERPILLAR_JS.read_text()

        self.assertIn("trailMaxDistance", source)
        self.assertIn("ringTrimByDistance(c.trail, c.trailMaxDistance)", source)
        self.assertNotIn("if (c.trail.length > 300) c.trail.length = 300", source)

    def test_crawlers_turn_in_place_on_static_obstacles(self) -> None:
        caterpillar_source = CATERPILLAR_JS.read_text()
        shared_source = SHARED_JS.read_text()

        self.assertIn('staticResponse: "turn"', caterpillar_source)
        self.assertIn('staticResponse = opts?.staticResponse ?? "slide"', shared_source)
        self.assertIn('staticResponse === "turn"', shared_source)

    def test_ground_creatures_do_not_spawn_inside_fairy_rings(self) -> None:
        source = WORLD_JS.read_text()
        creature_block_kinds = extract_const_block(source, "GROUND_CREATURE_BLOCK_KINDS")

        self.assertIn('"fairyring"', creature_block_kinds)
        self.assertIn('blocksPlacement(p.x, p.z, 0.35, GROUND_CREATURE_BLOCK_KINDS)', source)
        self.assertIn('blocksPlacement(nx, nz, 0.3, GROUND_CREATURE_BLOCK_KINDS)', source)

    def test_crawler_body_segments_yaw_along_the_trail_tangent(self) -> None:
        source = CATERPILLAR_JS.read_text()

        self.assertIn('seg.rotation.order = "YXZ"', source)
        self.assertIn('const frontPt = ringFindAt(c.trail, Math.max(0, d - c.segSpacing * 0.5))', source)
        self.assertIn('const backPt = ringFindAt(c.trail, d + c.segSpacing * 0.5)', source)
        self.assertIn('const bodyHeading = Math.atan2(frontPt.z - backPt.z, frontPt.x - backPt.x)', source)
        self.assertIn('seg.rotation.y = -bodyHeading + Math.PI / 2', source)


if __name__ == "__main__":
    unittest.main()
