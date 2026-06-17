#!/usr/bin/env python3
"""Static regression checks for sleeping/drowsy creature hover behavior."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CREATURE_JS = ROOT / "src" / "fauna" / "creature.js"
UI_JS = ROOT / "src" / "ui.js"


class SleepingCreatureHoverStaticTest(unittest.TestCase):
    def test_wake_creature_handles_drowsy_landed_fliers(self) -> None:
        source = CREATURE_JS.read_text()

        self.assertIn("const drowsyFlier = c.flies && !c.isFish && c.sleepiness > 0.05", source)
        self.assertIn("if (!c.isSleeper && !naturallyAsleep && !drowsyFlier) return", source)
        self.assertIn('if (drowsyFlier && (c.landState === "landed" || c.landState === "descending"))', source)
        self.assertIn('c.landState = "ascending"', source)
        # QA-010: the previously duplicated walker/flier alert-window override
        # is now shared via sleepinessTarget(). Both the walker (!c.flies) and
        # flier (c.flies && !c.isFish) branches call it, and the helper itself
        # contains the alert override — so the override still covers both paths.
        self.assertIn("if (c.alertUntil && c.age < c.alertUntil) target = 0", source)
        self.assertIn("function sleepinessTarget(c, nf, smoothstep)", source)
        self.assertGreaterEqual(source.count("sleepinessTarget(c, state.nightFactor ?? 0,"), 2)

    def test_hover_wakes_visible_sleeping_or_drowsy_creatures(self) -> None:
        source = UI_JS.read_text()

        self.assertIn("const looksAsleep =", source)
        self.assertIn("c.isSleeper ||", source)
        self.assertIn("(!c.flies && c.sleepiness > 0.4) ||", source)
        self.assertIn("(c.flies && !c.isFish && c.sleepiness > 0.4)", source)
        self.assertIn("if (looksAsleep) {", source)
        self.assertIn("if (!furOnly) wakeCreature(c)", source)


if __name__ == "__main__":
    unittest.main()
