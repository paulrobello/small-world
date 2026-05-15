#!/usr/bin/env python3
"""Static regression checks for the inspect-mode fur toggle."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSPECT_JS = ROOT / "src" / "inspect.js"
CREATURE_JS = ROOT / "src" / "fauna" / "creature.js"
CATERPILLAR_JS = ROOT / "src" / "fauna" / "caterpillar.js"
UI_JS = ROOT / "src" / "ui.js"
STYLE_CSS = ROOT / "style.css"
MAIN_JS = ROOT / "main.js"


class InspectFurToggleStaticTest(unittest.TestCase):
    def test_inspect_url_accepts_and_writes_fur_param(self) -> None:
        inspect = INSPECT_JS.read_text()

        self.assertIn("&fur=0|1", inspect)
        self.assertIn('let _furOverride = _parseBoolParam(_params.get("fur"))', inspect)
        self.assertIn('sp.set("fur", _inspectFurEnabled ? "1" : "0")', inspect)

    def test_inspect_f_key_toggles_forced_fur_and_respawns_specimen(self) -> None:
        inspect = INSPECT_JS.read_text()

        self.assertIn('e.key === "f" || e.key === "F"', inspect)
        self.assertIn('_inspectFurEnabled = !_inspectFurEnabled', inspect)
        self.assertIn('_furOverride = _inspectFurEnabled', inspect)
        self.assertIn('spawnSpecimen(scene)', inspect)

    def test_creature_builders_support_inspect_fur_override(self) -> None:
        inspect = INSPECT_JS.read_text()
        creature = CREATURE_JS.read_text()
        caterpillar = CATERPILLAR_JS.read_text()

        self.assertIn('...(_furOverride == null ? {} : { furry: _furOverride })', inspect)
        self.assertIn('opts.furry ?? (furProb > 0 && furRoll < furProb)', creature)
        self.assertIn('opts.furry ?? (furProb > 0 && furRoll < furProb)', caterpillar)
        self.assertIn('group.userData.inspect.fur = furShells ? "1" : "0"', creature)
        self.assertIn('group.userData.inspect.fur = furShells ? "1" : "0"', caterpillar)

    def test_shift_click_inspect_links_include_existing_fur_state(self) -> None:
        ui = UI_JS.read_text()

        self.assertIn('if (n.userData.inspect.fur != null) sp.set("fur", n.userData.inspect.fur)', ui)

    def test_shift_click_and_fur_toggle_preserve_creature_color(self) -> None:
        inspect = INSPECT_JS.read_text()
        creature = CREATURE_JS.read_text()
        caterpillar = CATERPILLAR_JS.read_text()
        ui = UI_JS.read_text()

        self.assertIn("&color=<rrggbb>", inspect)
        self.assertIn('let _colorOverride = _parseColorParam(_params.get("color"))', inspect)
        self.assertIn('sp.set("color", _colorOverride.getHexString())', inspect)
        self.assertIn('color: _colorOverride ?? undefined', inspect)
        self.assertIn('opts.color instanceof THREE.Color', creature)
        self.assertIn('group.userData.inspect.color = bodyCol.getHexString()', creature)
        self.assertIn('opts.color instanceof THREE.Color', caterpillar)
        self.assertIn('group.userData.inspect.color = baseCol.getHexString()', caterpillar)
        self.assertIn('if (n.userData.inspect.color != null) sp.set("color", n.userData.inspect.color)', ui)

    def test_normal_ui_shortcuts_are_disabled_in_inspect_mode(self) -> None:
        ui = UI_JS.read_text()

        self.assertIn('import { INSPECT } from "./inspect.js"', ui)
        self.assertIn("if (INSPECT) return;", ui)
        self.assertLess(ui.index("if (INSPECT) return;"), ui.index('e.key === "f" || e.key === "F"'))

    def test_normal_ui_is_not_initialized_in_inspect_mode(self) -> None:
        main = MAIN_JS.read_text()

        self.assertIn("if (!INSPECT) {\n  initUi({ camera, canvas, controls, renderer });\n}", main)
        self.assertLess(main.index("if (!INSPECT)"), main.index("if (INSPECT) {\n  setupInspect"))

    def test_inspect_key_handler_preempts_page_level_shortcuts(self) -> None:
        inspect = INSPECT_JS.read_text()

        self.assertIn("{ capture: true }", inspect)
        self.assertIn("e.stopImmediatePropagation();", inspect)
        self.assertLess(inspect.index("e.stopImmediatePropagation();"), inspect.index("spawnSpecimen(scene);", inspect.index('e.key === "f"')))

    def test_inspect_footer_can_fit_the_fur_hint(self) -> None:
        inspect = INSPECT_JS.read_text()
        style = STYLE_CSS.read_text()

        self.assertIn('f fur', inspect)
        self.assertIn('max-width: calc(100vw - 32px);', style)
        self.assertIn('flex-wrap: wrap;', style)
        self.assertIn('justify-content: center;', style)


if __name__ == "__main__":
    unittest.main()
