# Colour Shift

A GNOME Shell extension that turns the **entire display a single colour** —
red-only, green-only or blue-only light, monochrome tints, amber, sepia,
grayscale — **or emulates a CRT monitor**, from a **Quick Settings** tile.

Unlike a Night-Light-style white-point shift, the channel-isolation presets
actually *zero* the other channels, so a red-only screen emits only red light
(red darkroom / night-vision use, OLED stress testing, accessibility).

## Features

- **Quick Settings tile** with:
  - a **main button** that toggles the filter on/off, and
  - a **dropdown** (radio list) to pick the mode.
- **CRT mode** with a live **CRT tuning** submenu:
  - horizontal **scanlines**
  - RGB **shadow-mask / aperture-grille** ("window screen") pattern
  - multi-tap **phosphor glow / bloom**
  - **centre glass glow** + **edge vignette**
  - toggleable **barrel distortion** (glass curvature)
  - amber or green phosphor tint
- A panel indicator that appears only while the filter is active.
- Works on **Wayland and X11** — it is a compositor effect, not an XRandR gamma hack.
- Tints **every application on every monitor** via one shader.
- Persisted across reboots via GSettings.

## Requirements

- GNOME Shell **48, 49 or 50**
- `glib-compile-schemas` (from `glib2.0` / `libglib2.0-bin`)

## Install

```sh
git clone <this-repo> colorshift@dchadwick.local
cd colorshift@dchadwick.local
make install
```

Then **log out and back in once**: GNOME Shell only scans for extensions at
startup, so a freshly added extension cannot be picked up live on Wayland.
After that it is enabled and toggling is instant.

To enable it explicitly:

```sh
make enable            # or: gnome-extensions enable colorshift@dchadwick.local
```

## Usage

Open the system menu (top-right corner) and find the **Colour Shift** tile:

- click the tile body → toggle the filter on/off
- click the **arrow** → choose a mode, and tune the CRT parameters in the
  **CRT tuning** submenu (sliders update live)

## Modes

### Colour presets

| id | Label | Effect |
|----|-------|--------|
| `red` | Red only | only the red channel passes — true red light |
| `green` | Green only | only the green channel passes |
| `blue` | Blue only | only the blue channel passes |
| `red-mono` | Red monochrome | luminance reproduced in red (keeps detail) |
| `green-mono` | Green monochrome | luminance reproduced in green |
| `amber` | Amber | warm low-blue night mode |
| `sepia` | Sepia | classic warm photo tint |
| `grayscale` | Grayscale | fully desaturated |

### CRT presets

| id | Label |
|----|-------|
| `crt-amber` | CRT Amber (P3 phosphor) |
| `crt-green` | CRT Green (P1 phosphor) |

The CRT shader is a single fragment pass: barrel distortion → sample +
multi-tap phosphor bloom → phosphor tint → scanlines → shadow mask → centre
glow → edge vignette. It samples neighbouring texels via `cogl_sampler`, so the
bloom is a real blur rather than a per-pixel fake.

## Settings

```sh
EXT=~/.local/share/gnome-shell/extensions/colorshift@dchadwick.local
GS="gsettings --schemadir $EXT/schemas"

$GS set org.gnome.shell.extensions.colorshift preset 'crt-amber'
$GS set org.gnome.shell.extensions.colorshift enabled true
$GS set org.gnome.shell.extensions.colorshift crt-scanline 0.4
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `preset` | string | `red` | which mode to apply |
| `enabled` | boolean | `false` | whether the filter is applied |
| `crt-scanline` | double | `0.35` | scanline darkening (0–1) |
| `crt-mask` | double | `0.30` | shadow-mask strength (0–1) |
| `crt-bloom` | double | `0.45` | phosphor bloom (0–1) |
| `crt-glow` | double | `0.30` | centre glass glow (0–1) |
| `crt-vignette` | double | `0.25` | edge vignette (0–1) |
| `crt-curvature` | boolean | `true` | enable barrel distortion |
| `crt-curvature-amount` | double | `0.06` | distortion strength |
| `crt-tint-amount` | double | `0.80` | 0 = full colour, 1 = single phosphor |

## How it works

A `Shell.GLSLEffect` (GLSL fragment shader) is attached to
`Main.layoutManager.uiGroup`. That actor **contains `global.window_group`**, so a
single effect tints the whole composited desktop — every app, every monitor:

```js
this.uiGroup.add_child(global.window_group);
```

Each colour preset is a 3×3 colour matrix passed as three `vec3` uniforms. The
CRT effect is a separate `Shell.GLSLEffect` with its own uniforms; exactly one of
the two effects is enabled at a time. Adding a colour is one line in the
`PRESETS` array in `extension.js`.

The effects are created once and their `enabled` flag is toggled — the same
pattern the shell uses for its own desaturate/brightness effects on `uiGroup`.

### Caveats

- Because the tint lives in the compositor, **screenshots and screencasts capture
  it** too.
- The tint applies to the **whole desktop across all monitors**, not per-monitor.
- The CRT bloom is a full-screen multi-tap offscreen pass; it is the most
  expensive mode. On very high resolutions / weak GPUs it may cost frames.

## Development

```sh
make schemas     # compile schemas/gschemas.compiled
make install     # install into ~/.local/share/gnome-shell/extensions/
make pack        # build colorshift@dchadwick.local.shell-extension.zip
make uninstall
```

To test without disturbing a running session, boot a throwaway shell:

```sh
dbus-run-session -- gnome-shell --wayland --headless --mode=ubuntu
```

See [`docs/DESIGN.md`](docs/DESIGN.md) for the roadmap.

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).
