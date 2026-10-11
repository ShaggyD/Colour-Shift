# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] - 2026-10-10

### Added

- **CRT mode** (`crt-amber`, `crt-green` presets) with a single-pass GLSL
  fragment shader:
  - scanlines
  - RGB shadow-mask / aperture-grille ("window screen") pattern
  - multi-tap phosphor bloom (samples neighbours via `cogl_sampler`)
  - centre glass glow + edge vignette
  - toggleable barrel distortion (glass curvature)
- **CRT tuning** submenu in the Quick Settings dropdown with live sliders
  (scanlines, shadow mask, phosphor glow, glass glow, vignette) and a
  curvature switch.
- GSettings keys for all CRT parameters.

### Changed

- Refactored the extension to hold two effects (matrix + CRT) and switch
  between them by preset `kind`.

## [1.0.0] - 2026-10-10

### Added

- Initial release.
- Quick Settings tile with an on/off toggle and a colour dropdown.
- Panel indicator shown while active.
- Presets: `red`, `green`, `blue`, `red-mono`, `green-mono`, `amber`, `sepia`,
  `grayscale`.
- GSettings-backed persistence (`preset`, `enabled`).
- Full-screen `Shell.GLSLEffect` shader applied via `Main.layoutManager.uiGroup`.
