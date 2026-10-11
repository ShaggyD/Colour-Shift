# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] - 2026-10-10

### Added

- **Preferences window** (`prefs.js`, Adw) with the full mode list, an
  *Enabled* switch, per-mode **Quick Settings favourites** toggles, and a
  **CRT page** with every parameter (scanlines, shadow mask, phosphor glow,
  glass glow, edge vignette, curvature switch + amount, phosphor tint) — all
  applied live. Opened via Extensions app → Settings, `gnome-extensions
  prefs …`, or a **Settings…** row in the Quick Settings dropdown.
- `favorites` GSettings key: the modes shown in the Quick Settings dropdown.

### Changed

- Quick Settings dropdown is now a short radio list of **favourites** only;
  the CRT tuning submenu and sliders moved out of the shell into the
  preferences window (fits small screens, keeps the dropdown simple).
- Removed the now-unneeded dropdown slider styles.

## [1.1.1] - 2026-10-10

### Fixed

- **CRT mode shell crash.** `cogl_sampler` is not a valid builtin in Cogl's
  `FRAGMENT` hook (the journal showed `error: 'cogl_sampler' undeclared` and a
  failed link after enabling CRT, taking the session down). The CRT shader now
  declares its own `uniform sampler2D cs_source` and is a replacement snippet
  that fully controls `cogl_color_out` — the same pattern as the shell's own
  `FadeEffect`, which is proven on this exact GNOME 50. Revalidated offline
  against GLSL ES 100 with an honest harness (no fabricated builtins).
- **Dropdown overflowed small screens.** Colour presets moved into a **Colour ▸**
  submenu and CRT modes + tuning into a **CRT ▸** submenu; submenus are capped
  at 420px and wheel-scroll.

## [1.1.0] - 2026-10-10

### Added

- **CRT mode** (`crt-amber`, `crt-green` presets) with a single-pass GLSL
  fragment shader:
  - scanlines
  - RGB shadow-mask / aperture-grille ("window screen") pattern
  - multi-tap phosphor bloom (samples neighbours from the effect's source
    texture)
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
