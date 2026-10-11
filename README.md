# Colour Shift

A GNOME Shell extension that turns the **entire display a single colour** —
red-only, green-only or blue-only light, monochrome tints, amber, sepia, or
grayscale — from a **Quick Settings** tile with a dropdown to choose the colour.

Unlike a Night-Light-style white-point shift, the channel-isolation presets
actually *zero* the other channels, so a red-only screen emits only red light
(red darkroom / night-vision use, OLED stress testing, accessibility).

## Features

- **Quick Settings tile** with:
  - a **main button** that toggles the filter on/off, and
  - a **dropdown** (radio list) to pick the shift colour.
- A panel indicator that appears only while the filter is active.
- **8 presets** (see below), persisted across reboots via GSettings.
- Works on **Wayland and X11** — it is a compositor effect, not an XRandR gamma hack.
- Tints **every application on every monitor** via one shader.

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
- click the **arrow** → choose a colour (choosing one turns the filter on)

## Presets

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

## Settings

The extension is driven by two GSettings keys:

```sh
EXT=~/.local/share/gnome-shell/extensions/colorshift@dchadwick.local

gsettings --schemadir "$EXT/schemas" \
  set org.gnome.shell.extensions.colorshift preset 'green'
gsettings --schemadir "$EXT/schemas" \
  set org.gnome.shell.extensions.colorshift enabled true
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `preset` | string | `red` | which colour to apply |
| `enabled` | boolean | `false` | whether the filter is applied |

## How it works

A `Shell.GLSLEffect` (GLSL fragment shader) is attached to
`Main.layoutManager.uiGroup`. That actor **contains `global.window_group`**, so a
single effect tints the whole composited desktop — every app, every monitor:

```js
this.uiGroup.add_child(global.window_group);
```

Each preset is a 3×3 colour matrix passed to the shader as three `vec3` uniforms
(`cs_row_r`, `cs_row_g`, `cs_row_b`); the fragment snippet computes
`out.rgb = (dot(rowR, in), dot(rowG, in), dot(rowB, in))`. Adding a colour is one
line in the `PRESETS` array in `extension.js`.

The effect object is created once and its `enabled` flag is toggled — the same
pattern the shell uses for its own desaturate/brightness effects on `uiGroup`.

### Caveats

- Because the tint lives in the compositor, **screenshots and screencasts capture
  it** too.
- The tint applies to the **whole desktop across all monitors**, not per-monitor.

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

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).
