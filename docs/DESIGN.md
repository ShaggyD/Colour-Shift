# Design & Roadmap

Status of the features you picked, plus the two new ones (custom RGB tint +
CRT mode). Everything below was verified against the **GNOME Shell 50.1**
sources on this machine, not assumed.

## What's already confirmed feasible

| Area | Verdict | Evidence |
|------|---------|----------|
| Intensity slider | 🟢 Easy | Add a `cs_strength` uniform, `mix(in, M·in, s)` |
| Keyboard shortcut | 🟢 Easy | `Main.wm.addKeybinding(name, settings, flags, modes, handler)` exists (`js/ui/wm.js`) |
| Smooth fade | 🟢 Easy | Animatable effect props via `actor.ease_property('@effects.<name>.<prop>', …)` |
| Settings panel (prefs) | 🟢 Easy | `ExtensionPreferences.fillPreferencesWindow()`, **libadwaita 1.9.0** (`Adw.PreferencesPage/Group/SpinRow/ActionRow/SwitchRow/ComboRow/ExpanderRow` all present) |
| Custom RGB tint | 🟢 Easy | Derive a 3×3 matrix from a chosen colour |
| CRT mode | ✅ **Done (1.1.0)** | shader walks scanlines + shadow mask + multi-tap bloom + glow/vignette + curvature |
| Per-monitor | 🔴 No | All monitors render from the single `uiGroup` stage |

### The key technical unlock: multi-tap sampling

`Shell.GLSLEffect` copies the offscreen source texture onto pipeline layer 0
(`cogl_pipeline_set_layer_texture(pipeline, 0, texture)`), and Cogl exposes the
builtins `cogl_sampler` (sampler2D) and `cogl_tex_coord_in[0]` / `cogl_tex_coord`.
libshell's own generated fragment code is literally:

```glsl
cogl_texel = texture2D (cogl_sampler, cogl_tex_coord.st);
```

So we can sample neighbours → **real phosphor bloom / glow**, not just per-pixel
tricks. (The shell's own `FadeEffect` also samples the offscreen texture in a
`FRAGMENT` snippet, confirming the pattern.)

## ⚠️ Architectural risk discovered

The **Pasynkov Tint** extension documents a Mutter bug: heavy *stacked offscreen
effects on `Main.uiGroup`* can throw **"Failed to create offscreen effect
framebuffer"** and crash when Wayland surfaces resize (Qt/Electron apps). Their
fix is a **per-actor single-pass** architecture (effect on each
`Meta.WindowActor` + panel + background).

Implications:
- Our current single uiGroup effect is fine on this single-display laptop, but a
  **heavier CRT shader (multi-tap bloom) increases the risk**.
- Moving to per-actor effects later would **also unlock the "app-aware" feature**
  (tint/exclude specific windows) — so phase 5 below kills two birds.

## Proposed phases

### Phase 1 — Core UX (you approved these: #1, #2, #6)
- Schema: `intensity` (d), `toggle-keybinding` (as), `cycle-keybinding` (as).
- Effect: `cs_strength` uniform + `mix()`; expose a `strength` GObject property.
- Intensity slider row inside the dropdown (shell's `SliderItem` pattern).
- Keybindings: toggle + cycle presets, via `Main.wm.addKeybinding` under
  `Shell.ActionMode.NORMAL | OVERVIEW`.
- Smooth fade on toggle via `uiGroup.ease_property('@effects.colorshift.strength', …)`.
- A "Settings…" item in the dropdown → `extension.openPreferences()`.

### Phase 2 — Custom colour + preferences window (Feature A)
- `prefs.js` (Adw) with:
  - **Custom colour** card: `Gtk.ColorDialogButton` + **R/G/B sliders**
    (`Adw.SpinRow` or `Gtk.Scale`) kept in sync, live preview.
  - Intensity slider.
  - Shortcut capture rows.
- New `custom` preset: matrix built from the chosen colour
  (proposed semantics: `out = luminance × colour`, i.e. a true arbitrary tint —
  see open question Q2).
- Live updates via the existing `settings 'changed'` handler.

### Phase 3 — CRT mode (Feature B) ✅ DONE in 1.1.0
New shader mode composed of independent, toggleable terms (all in one pass):
1. **Scanlines** — `0.5 + 0.5*cos(uv.y * tex_h * 2π)`.
2. **"Window screen"** — RGB aperture-grille pattern via `mod(gl_FragCoord.x, 3.0)`.
3. **Amber/green phosphor tint** — luminance mapped to the phosphor colour,
   weighted by `crt-tint-amount`.
4. **Phosphor glow / bloom** — 8-tap cross over `cogl_sampler` (real neighbour
   sampling, not a per-pixel fake).
5. **Centre glass glow + edge vignette** — radial term (Q1 answer (c)).
6. **Barrel distortion** — toggleable via `crt-curvature` (Q3).
- Implemented as a second `Shell.GLSLEffect` (`CrtEffect`) with a `CRT tuning`
  submenu (5 sliders + curvature switch) in the dropdown.
- **GLSL validation:** no shell-level paint in the headless harness, so the
  shader is validated offline by wrapping the snippet in a synthetic ES-100
  program with Cogl builtins stubbed, compiled by `glslangValidator`
  (`apt-get download glslang-tools` + `dpkg-deb -x`, no root needed).
- **Perf caveat:** multi-tap full-screen offscreen pass is the heaviest mode;
  tap count could be trimmed on weak GPUs (Intel HD 615 here).

### Phase 4 — Scheduling (#5)
- Schema: `schedule-enabled` (b), `schedule-from` (d), `schedule-to` (d).
- A `GLib.timeout_add_seconds(60, …)` window check; saved manual toggle wins
  while the window is open.
- Optional later: sunset/sunrise from Night Light's stored coordinates.

### Phase 5 — (later) Per-actor refactor → app-aware
- Move from one `uiGroup` effect to per-actor effects.
- Fixes the framebuffer risk and enables an **exclude list** (e.g. don't tint
  video players / colour-critical apps).

## Decisions (answered)

1. **CRT glass glow** → **(c)** centre bloom **plus** edge vignette. Done.
2. **Custom tint semantics** → **deferred to last** (Q2 unresolved).
3. **Curvature** → **yes, toggleable** (`crt-curvature`). Done.
4. **Scheduling** → **both** fixed time range **and** sunset→sunrise.

## Order of work

1. ✅ **CRT mode** (1.1.0)
2. Core UX — intensity slider, keybindings, smooth fade
3. Scheduling — fixed window + sunset→sunrise
4. Custom RGB tint + preferences window (last)
5. Per-actor refactor → app-aware (later)
