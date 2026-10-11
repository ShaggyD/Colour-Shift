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
  - a compact **dropdown** of your **favourite modes** (radio list) plus a
    **Settings…** row that opens the full preferences window.
- **CRT mode**:
  - horizontal **scanlines**
  - RGB **shadow-mask / aperture-grille** ("window screen") pattern
  - multi-tap **phosphor glow / bloom**
  - **centre glass glow** + **edge vignette**
  - toggleable **barrel distortion** (glass curvature)
  - amber or green phosphor tint
- **Preferences window** (Extensions app → Settings, or
  `gnome-extensions prefs`) with the full mode list, Quick Settings favourites,
  and every CRT parameter — all applied live.
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
- click the **arrow** → pick any of your **favourite modes** (radio list)
- flip the **CRT** switch in the dropdown to layer the CRT effect on top of
  whatever colour is selected
- use the **Settings…** row (or the Extensions app's gear button) to open the
  preferences window

## Preferences

Open the preferences window from the Extensions app ("Colour Shift → Settings")
or from a terminal:

```sh
gnome-extensions prefs colorshift@dchadwick.local
```

It has two pages, and every change applies live:

- **Modes**
  - *Current mode* — pick any colour mode (applies and enables it).
  - *Enabled* — the on/off switch.
  - *CRT overlay* — layers the CRT effect on top of the current colour.
  - *Quick Settings favourites* — one switch per mode; only the modes switched
    on here appear in the Quick Settings dropdown.
- **CRT** — all CRT parameters: scanlines, shadow mask, phosphor glow, glass
  glow, edge vignette, curvature (switch + amount).

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

### CRT overlay

CRT is **not** a preset — it is a switch that layers on top of any colour
mode. The shader first applies the selected colour matrix, then the CRT terms
in one pass: barrel distortion → bright-pass multi-tap phosphor bloom →
scanlines → soft shadow mask ("window screen") → centre glass glow → edge
vignette. It samples neighbouring texels from the effect's own source texture
(declared `sampler2D` on unit 0 — the same trick the shell's `FadeEffect`
uses), so the bloom is a real blur rather than a per-pixel fake.

## Settings

```sh
EXT=~/.local/share/gnome-shell/extensions/colorshift@dchadwick.local
GS="gsettings --schemadir $EXT/schemas"

$GS set org.gnome.shell.extensions.colorshift preset 'green'
$GS set org.gnome.shell.extensions.colorshift crt true
$GS set org.gnome.shell.extensions.colorshift crt-scanline 0.4
$GS set org.gnome.shell.extensions.colorshift enabled true
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `preset` | string | `amber` | colour mode to apply |
| `crt` | boolean | `false` | CRT overlay on top of the colour |
| `enabled` | boolean | `false` | whether the filter is applied |
| `favorites` | string[] | `red, green, amber` | modes shown in the Quick Settings dropdown |
| `crt-scanline` | double | `0.30` | scanline darkening (0–1) |
| `crt-mask` | double | `0.20` | shadow-mask strength (0–1) |
| `crt-bloom` | double | `0.30` | phosphor bloom (0–1) |
| `crt-glow` | double | `0.20` | centre glass glow (0–1) |
| `crt-vignette` | double | `0.20` | edge vignette (0–1) |
| `crt-curvature` | boolean | `true` | enable barrel distortion |
| `crt-curvature-amount` | double | `0.05` | distortion strength |

## How it works

A `Shell.GLSLEffect` (GLSL fragment shader) is attached to
`Main.layoutManager.uiGroup`. That actor **contains `global.window_group`**, so a
single effect tints the whole composited desktop — every app, every monitor:

```js
this.uiGroup.add_child(global.window_group);
```

Each colour preset is a 3×3 colour matrix passed as three `vec3` uniforms. The
CRT effect embeds the same matrix (so it works on top of any colour) and adds
the CRT terms; exactly one of the two effects is enabled at a time. Adding a
colour is one line in the `PRESETS` array in `extension.js`.

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

### Testing caveat (important)

Static checks and offline GLSL validation are safe:

```sh
node --check extension.js        # JS syntax
make schemas                     # schema compiles
```

The CRT/colour shaders are validated offline as GLSL ES 100 with
glslangValidator (fetched root-free via `apt-get download` + `dpkg-deb -x`)
against a synthetic Cogl-style harness (`varying cogl_tex_coord_in[]`, declared
uniform `sampler2D`). Use an *honest* harness: naming a nonexistent builtin
(e.g. `cogl_sampler`) as a stub will hide real compile errors.

**Do not** boot a second `gnome-shell` on the same seat while you are logged in:

```sh
dbus-run-session -- gnome-shell --wayland --headless --mode=ubuntu   # AVOID
```

The throwaway shell has no `XDG_SESSION_ID`, logs *"getCurrentSessionProxy()
called outside a user session. Asking logind directly."*, and then **takes
control of seat0's input devices** — logind revokes them from your live session,
so the touchpad/keyboard pause until it exits. It is transient and self-heals,
but it is disruptive. Test in your real session after a login, or run the
second shell on a separate seat.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the roadmap.

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).
