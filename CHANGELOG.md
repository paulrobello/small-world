# Changelog

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
