#!/usr/bin/env python3
"""Static invariants for flora rendering details."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FLORA_JS = ROOT / "src" / "flora.js"


def flora_factory_block(source: str, name: str) -> str:
    marker = f"  {name}() {{"
    start = source.find(marker)
    if start == -1:
        raise AssertionError(f"flora factory {name!r} not found")

    depth = 0
    body_start = source.find("{", start)
    for index in range(body_start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]

    raise AssertionError(f"flora factory {name!r} block end not found")


class FloraStaticTest(unittest.TestCase):
    def test_skull_cranium_uses_smooth_shading(self) -> None:
        source = FLORA_JS.read_text()
        block = flora_factory_block(source, "skull")

        self.assertIn('pooled("skull.mat"', block)
        self.assertIn("new THREE.SphereGeometry(0.18, 10, 8)", block)
        self.assertNotIn("flatShading: true", block)


if __name__ == "__main__":
    unittest.main()
