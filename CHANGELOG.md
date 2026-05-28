# Changelog

## 1.3.9 - 2026-05-28

### Added
- Added static regression coverage for doubled island sizing without increasing flora or creature spawn counts.
- Added static regression coverage for island-aware orbit framing, renderer pixel-ratio caps, contact-shadow LOD, and Verdant static shadow LOD.
- Added static regression coverage for Mossy Ruins using the mist edge ring.

### Changed
- Doubled the base island size while keeping flora and creature counts tied to the old density target so islands have more breathing room.
- Changed the default orbit camera to frame the generated island from its actual layout radius.
- Lowered the renderer pixel-ratio cap for mobile viewports.
- Added Verdant Grove shadow LOD so far static flora no longer all submit to the shadow map.
- Limited creature and caterpillar contact-shadow discs to the active camera or orbit focus area.
- Changed Mossy Ruins from the black grass-edge ring to a translucent mist ring.
- Doubled default grass density for grass-enabled biomes, including a saved-setting migration so existing browsers move from the old 12.5 baseline to the new 25 baseline.
- Extended the perf probe output with the active static shadow LOD radius.

### Fixed
- Reduced the mobile fly joystick look sensitivity by 50%.
- Fixed stale obstacle-grid reuse during async world generation so fauna steering falls back to the current obstacle array.

### Verified
- Verified with focused JS tests for grass density, island sizing, mobile fly touch, fauna obstacle avoidance, Mossy Ruins mist ring, orbit/render/shadow LOD, and perf-probe reporting.
- Verified with rendered Chrome smoke tests for Verdant Grove and Mossy Ruins, including a Verdant probe showing doubled grass count from `276950` to `553900` with FX disabled.
- Verified with `make checkall` and `graphify update .`.

## 1.3.8 - 2026-05-28

### Changed
- Reworked mobile fly controls into circular touch controls pinned above the bottom HUD.
- Replaced the mobile fly direction arrows with a left-side look joystick.
- Changed the right-side mobile fly buttons to drive forward and backward movement.

### Verified
- Verified with `node tests/mobile-fly-touch-static.test.mjs`, `make checkall`, a mobile viewport smoke test, and `graphify update .`.

## 1.3.7 - 2026-05-28

### Added
- Added compact mobile touch controls for fly camera mode, with edge-pinned movement and altitude buttons plus touch-drag look on the open view.
- Added static regression coverage for the mobile fly camera touch controls.

### Changed
- Changed the fresh-load auto-rotate camera setting to default off in both runtime state and the static settings markup.

### Verified
- Verified with `node tests/mobile-fly-touch-static.test.mjs`, the focused auto-rotate unittest, `make checkall`, and `git diff --check`.

## 1.3.6 - 2026-05-28

### Changed
- Changed the footer fly control into an explicit orbit/fly toggle with clearer active-state text.
- Improved the mobile footer grid so camera toggles and regenerate actions keep balanced touch targets on narrow screens.

### Verified
- Verified with `node tests/pov-toggle-static.test.mjs`, `make checkall`, and a 390px-wide Playwright mobile render/click check.

## 1.3.3 - 2026-05-26

### Added
- Added first-visit help that opens the full help modal once per browser.
- Added a main-view fly camera mode, available from settings or the `V` key, with WASD movement, mouse look, and `E`/`Q` vertical movement.
- Added regression coverage for HUD readability, help modal layout, music toggle state, and immediate music shutdown.
- Added static regression coverage for the fly camera mode UI wiring and tilt-shift gating.

### Changed
- Improved HUD readability with stronger mono text, translucent backdrops, higher contrast secondary labels, and title-cased biome names.
- Changed the help panel into a centered modal with fixed `Help & Controls`, `Modes`, and `Controls` header content while only the body rows scroll.
- Changed help and camera settings copy to document fly camera controls.
- Removed the persistent `drag · zoom · observe` hint above the lower controls.
- Made the top-left title block fade out after five seconds.
- Updated the music toggle icon and accessible labels to distinguish music-on from muted state.

### Fixed
- Fixed music toggle-off behavior so the shared background audio element is silenced and paused immediately.
- Fixed same-origin tab behavior so music-off settings propagate to other open Small World tabs.
- Fixed tilt-shift gating so it also stays disabled while the main-view fly camera is active.

### Verified
- UI/music changes were committed in `959e521` after `make checkall`, focused UI/music regression tests, rendered browser checks for the help modal, music toggle, and title fade, `git diff --check`, and `graphify update .`.
- Fly camera changes were verified with focused fly-mode and tilt-shift static tests, `make checkall`, `graphify update .`, and a Playwright smoke test for `V`, `W`, and `Esc`.
- Release version bump and documentation updates were verified with `make checkall`.

## 1.3.2 - 2026-05-25

### Added
- Added biome portals that can render a preview of the destination biome and allow first-person traversal by reloading into the target seed.
- Added portal settings for enabling portals, double portal placement, and preview rendering details for grass, flora, creatures, and local FX.
- Added original biome music scores and a biome music track selector that can override the default track per biome.

### Changed
- Biome music now streams from `https://static.pardev.net/small-world/music/` so MP3 files stay out of the GitHub Pages build and git history.
- Portal rings now use the destination biome palette and sit deeper in the ground.
- Double portal placement now spreads portals across the island instead of clustering them.
- Portal previews now use higher-fidelity render targets, player-matched projection, and destination biome terrain/flora/grass/creature generation.
- Portals now default to off.

### Fixed
- Fixed portal-side arrival orientation and pointer-lock handling after traversal.
- Fixed portal placement and terrain flattening so portals avoid obstacles and reduce nearby flora/grass clipping.
- Fixed portal previews that could render the wrong side, upside-down back views, or placeholder-like destination scenes.
